// -----------------------------------------------------------------------------
// The hub: one VlcInstance per configured slot, and everything Gladys sees of
// them — devices, states, connection status, scene events, commands, artwork.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { SLOTS } from './config.js';
import { ArtworkError, MAX_ARTWORK_DOWNLOAD, prepareArtwork } from './artwork-resize.js';
import {
  BUTTONS,
  REPEAT_MODES,
  buildDevice,
  buildStates,
  deviceIds,
  featureKeyOf,
  nowPlaying,
  slotOf,
} from './devices.js';
import { createIssueLog } from './issues.js';
import { VlcInstance } from './instance.js';
import { VlcError } from './vlc/client.js';
import { loggableMrl, normalizeMrl } from './vlc/mrl.js';
import {
  NO_VALUE,
  STATE_LABELS,
  STATUS_TEXT,
  TEST_TEXT,
  UNKNOWN_TITLE,
  commandMessage,
} from './texts.js';

const logger = createLogger({ name: 'vlc-hub' });

export const WIDGET_KEY = 'player';

// Scene trigger keys (manifest `scene_triggers`), by playback event type.
export const TRIGGERS = {
  started: 'playback_started',
  paused: 'playback_paused',
  resumed: 'playback_resumed',
  stopped: 'playback_stopped',
};

// The core refuses a widget image over 300 KB (decoded).
export const MAX_IMAGE_BYTES = 300 * 1024;

// A new item waits this long at most for its artwork before its now-playing
// is published (one redraw instead of two); a later artwork follows alone.
export const ARTWORK_WAIT_MS = 2_000;

// Music artwork keys served (onMusicGetArtwork), the most recent ones.
const MAX_MUSIC_IMAGES = 12;

// /art asked this many times per item at most (VLC finds the art a moment
// after the item starts).
const ART_ATTEMPTS = 3;

// A stable value is published again at least this often: past 48 h without a
// state, the front shows "no recent value".
export const HEARTBEAT_MS = 6 * 60 * 60 * 1000;

// requestWidgetRefresh is dropped by the core beyond one call per 10 s.
const WIDGET_REFRESH_GAP_MS = 10_500;

/** An Error carrying a coded, multi-language message. */
export class CommandError extends Error {
  constructor(code, language) {
    const message = commandMessage(code);
    super(message[language] ?? message.en);
    this.code = code;
    this.messages = message;
  }
}

/** Which image a magic number says (the core accepts these three). */
export function imageType(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return 'png';
  }
  if (
    bytes.length > 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/** What identifies the artwork of an item: VLC serves only the current one. */
const artworkId = (snapshot) =>
  snapshot.hasArt ? `${snapshot.itemId}|${snapshot.title}|${snapshot.album}` : null;

export class Hub {
  constructor({ gladys, store, fetch, timings, now = Date.now }) {
    this.gladys = gladys;
    this.store = store;
    this.fetch = fetch;
    this.timings = timings;
    this.now = now;
    this.config = { instances: [], invalidSlots: [], language: 'fr' };
    // slot -> { slot, settings, vlc, artwork: { id, key, base64, attempts } | null }
    this.instances = new Map();
    // music artwork key -> raw base64 (onMusicGetArtwork), most recent last
    this.musicImages = new Map();
    this.saved = { mute: {} };
    this.lastStatus = '';
    this.widgetRefreshAt = 0;
    this.widgetTimer = null;
    this.issues = createIssueLog(logger);
    this.stopped = false;
  }

  get language() {
    return this.config.language;
  }

  async start(config) {
    const saved = await this.store.load();
    this.saved = { mute: saved?.mute && typeof saved.mute === 'object' ? saved.mute : {} };
    await this.reconfigure(config);
  }

  /** New configuration: restart the instances whose address or password changed. */
  async reconfigure(config) {
    const languageChanged = config.language !== this.config.language;
    this.config = config;
    const wanted = new Map(config.instances.map((settings) => [settings.slot, settings]));
    for (const [slot, entry] of this.instances) {
      const next = wanted.get(slot);
      if (!next || next.url !== entry.settings.url || next.password !== entry.settings.password) {
        entry.vlc.stop();
        this.instances.delete(slot);
      }
    }
    for (const [slot, settings] of wanted) {
      if (!this.instances.has(slot)) {
        this.#addInstance(settings);
      }
    }
    await this.publishDevices();
    if (languageChanged) {
      await this.publishAllStates();
    }
    await this.updateConnectionStatus();
    this.refreshWidget();
  }

  /** Gladys reconnected (it may have restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    await this.reconfigure(config);
    await this.publishAllStates();
    this.lastStatus = '';
    await this.updateConnectionStatus();
  }

  stop() {
    this.stopped = true;
    for (const entry of this.instances.values()) {
      entry.vlc.stop();
    }
    clearTimeout(this.widgetTimer);
    return this.store.flush();
  }

  #addInstance(settings) {
    const vlc = new VlcInstance({
      ...settings,
      fetch: this.fetch,
      timings: this.timings,
      now: this.now,
      isWatched: () => this.isCreated(settings.slot),
    });
    const saved = this.saved.mute[settings.slot];
    if (saved?.url === settings.url && Number.isFinite(saved.volume)) {
      vlc.muteBackup = saved.volume;
    }
    const entry = { slot: settings.slot, settings, vlc, artwork: null };
    this.instances.set(settings.slot, entry);
    vlc.on('update', (snapshot, previous) => this.#onUpdate(entry, snapshot, previous));
    vlc.on('playback', (event) => this.#onPlayback(entry, event));
    vlc.on('read', (snapshot) => this.#fetchArtwork(entry, snapshot));
    vlc.on('mute', (volume) => this.#onMute(entry, volume));
    vlc.on('connection', () => {
      this.updateConnectionStatus();
      this.refreshWidget();
    });
    vlc.start();
  }

  #isCurrent(entry) {
    return !this.stopped && this.instances.get(entry.slot) === entry;
  }

  // --- Devices and states -------------------------------------------------

  #deviceOf(entry) {
    return buildDevice(this.gladys, entry.settings, this.language);
  }

  buildDevices() {
    return [...this.instances.values()]
      .sort((a, b) => a.slot - b.slot)
      .map((entry) => this.#deviceOf(entry));
  }

  async publishDevices() {
    if (this.stopped) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(this.buildDevices());
    } catch (err) {
      logger.error('Cannot publish the devices', err);
    }
  }

  async #onUpdate(entry, snapshot, previous) {
    if (!this.#isCurrent(entry)) {
      return;
    }
    const artwork = this.#fetchArtwork(entry, snapshot);
    if (entry.artwork?.pending) {
      let timer;
      await Promise.race([
        artwork,
        new Promise((resolve) => {
          timer = setTimeout(resolve, ARTWORK_WAIT_MS);
          timer.unref?.();
        }),
      ]);
      clearTimeout(timer);
    }
    await this.#publishStates(entry);
    if (
      snapshot.state !== previous.state ||
      snapshot.itemId !== previous.itemId ||
      snapshot.title !== previous.title ||
      snapshot.artist !== previous.artist ||
      snapshot.volumeRaw !== previous.volumeRaw
    ) {
      this.refreshWidget();
    }
  }

  async #publishStates(entry) {
    // Gladys drops the states of a device it does not know: the device the
    // user has not added yet gets its states when it is (onDeviceCreated).
    if (!this.#isCurrent(entry) || !this.isCreated(entry.slot)) {
      return;
    }
    const { vlc } = entry;
    const states = buildStates(this.gladys, entry.slot, vlc.snapshot, this.language);
    // During an announcement and the resume after it, only the playback state
    // follows: the announcement is not a track to show.
    const music = vlc.hold
      ? { playback_state: nowPlaying(vlc.snapshot).playback_state }
      : nowPlaying(vlc.snapshot, {
          artworkUrl: this.musicArtworkUrl(entry),
          muteBackup: vlc.muteBackup,
        });
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
      await this.gladys.publishNowPlaying(deviceIds(this.gladys, entry.slot).device, music);
      this.issues.ok('states', 'States published again');
    } catch (err) {
      // Gladys away: one line, not one per read until it is back.
      this.issues.fail('states', `Cannot publish the states of VLC ${entry.slot}: ${err.message}`);
    }
  }

  async publishAllStates() {
    for (const entry of this.instances.values()) {
      await this.#publishStates(entry);
    }
  }

  /** The user added a device: states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    const entry = this.instances.get(slotOf(this.gladys, device?.external_id));
    if (!entry) {
      return;
    }
    this.gladys.forgetPublishedStates?.(device.external_id);
    // Read now: the pace of an added device is faster than before.
    await entry.vlc.refresh().catch(() => {});
    await this.#publishStates(entry);
    this.refreshWidget();
  }

  #onMute(entry, volume) {
    if (volume === null) {
      delete this.saved.mute[entry.slot];
    } else {
      this.saved.mute[entry.slot] = { url: entry.settings.url, volume };
    }
    this.store.save({ mute: this.saved.mute });
  }

  // --- Scene events ---------------------------------------------------------

  async #onPlayback(entry, event) {
    const key = TRIGGERS[event.type];
    if (!key || !this.#isCurrent(entry) || !this.isCreated(entry.slot)) {
      return;
    }
    const { snapshot } = event;
    const data = {
      device: deviceIds(this.gladys, entry.slot).device,
      vlc: this.deviceName(entry),
      title: snapshot.title || (UNKNOWN_TITLE[this.language] ?? UNKNOWN_TITLE.en),
      artist: snapshot.artist || NO_VALUE,
      album: snapshot.album || NO_VALUE,
    };
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.issues.ok('scene-events', 'Scene events accepted again');
    } catch (err) {
      this.issues.fail('scene-events', `Cannot fire ${key}: ${err.message}`);
    }
    this.refreshWidget();
  }

  /** The name of the device in Gladys (the user may have renamed it). */
  deviceName(entry) {
    const created = (this.gladys.devices ?? []).find(
      (device) => device.external_id === deviceIds(this.gladys, entry.slot).device,
    );
    return created?.name ?? this.#deviceOf(entry).name;
  }

  isCreated(slot) {
    const id = deviceIds(this.gladys, slot).device;
    return (this.gladys.devices ?? []).some((device) => device.external_id === id);
  }

  // --- Widget -------------------------------------------------------------

  /** Nudge the open dashboards, with a trailing call inside the core's 10 s gap. */
  refreshWidget() {
    if (this.stopped) {
      return;
    }
    const wait = this.widgetRefreshAt + WIDGET_REFRESH_GAP_MS - this.now();
    if (wait <= 0) {
      this.widgetRefreshAt = this.now();
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
      return;
    }
    if (!this.widgetTimer) {
      this.widgetTimer = setTimeout(() => {
        this.widgetTimer = null;
        this.refreshWidget();
      }, wait);
      this.widgetTimer.unref?.();
    }
  }

  /**
   * Fetch the artwork of a new item (VLC's /art serves the current item's),
   * keep it under the core's limit, then nudge the widget. VLC finds the
   * artwork of a file a moment after it starts: /art may still answer 404 at
   * the first read, so it is asked again at the next reads, a few times.
   */
  async #fetchArtwork(entry, snapshot) {
    const id = artworkId(snapshot);
    const known = entry.artwork?.id === id ? entry.artwork : null;
    if (!id || known?.key || known?.pending || known?.attempts >= ART_ATTEMPTS) {
      if (!id) {
        entry.artwork = null;
      }
      return;
    }
    const artwork = { id, key: null, base64: null, attempts: (known?.attempts ?? 0) + 1 };
    artwork.pending = true;
    entry.artwork = artwork;
    try {
      const raw = await entry.vlc.art(MAX_ARTWORK_DOWNLOAD);
      if (!raw) {
        return;
      }
      if (!imageType(raw)) {
        artwork.attempts = ART_ATTEMPTS;
        throw new Error('not a JPEG, PNG or WebP image');
      }
      // VLC serves the artwork as found (a cover embedded in a file is often
      // a few megabytes): made a JPEG of 400 px at most, under 300 KB.
      const bytes = await prepareArtwork(raw, { maxBytes: MAX_IMAGE_BYTES });
      if (artworkId(entry.vlc.snapshot) !== id || !this.#isCurrent(entry)) {
        return; // the item changed meanwhile: that art is not the current one
      }
      // The core caches an image by key for an hour: the key follows the bytes.
      const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 24);
      artwork.key = `cover-${hash}`;
      artwork.base64 = bytes.toString('base64');
      artwork.musicUrl = `vlc-artwork:${entry.slot}:${hash}`;
      const musicKey = this.gladys.artworkKey(artwork.musicUrl);
      this.musicImages.delete(musicKey);
      this.musicImages.set(musicKey, artwork.base64);
      while (this.musicImages.size > MAX_MUSIC_IMAGES) {
        this.musicImages.delete(this.musicImages.keys().next().value);
      }
      artwork.pending = false;
      await this.#publishStates(entry);
      this.refreshWidget();
    } catch (err) {
      if (err instanceof ArtworkError) {
        artwork.attempts = ART_ATTEMPTS;
      }
      logger.debug(`VLC ${entry.slot}: no artwork (${err.message})`);
    } finally {
      artwork.pending = false;
    }
  }

  /** The image key of what an instance plays, once fetched. */
  artworkKey(entry) {
    const { artwork } = entry;
    return artwork && artwork.id === artworkId(entry.vlc.snapshot) ? artwork.key : null;
  }

  /** The artwork source of what an instance plays, for publishNowPlaying. */
  musicArtworkUrl(entry) {
    const { artwork } = entry;
    return artwork?.key && artwork.id === artworkId(entry.vlc.snapshot) ? artwork.musicUrl : null;
  }

  /** onMusicGetArtwork: the raw base64 of a music artwork key. */
  musicArtwork(key) {
    const image = this.musicImages.get(key);
    if (!image) {
      throw new Error(`Unknown artwork ${key}`);
    }
    return image;
  }

  /** onWidgetGetImage: the raw base64 of a cover key. */
  widgetImage(key) {
    for (const entry of this.instances.values()) {
      if (entry.artwork?.key === key) {
        return entry.artwork.base64;
      }
    }
    throw new Error(`Unknown image ${key}`);
  }

  // --- Connection status --------------------------------------------------

  statusMessage() {
    const lines = Object.fromEntries(Object.keys(STATUS_TEXT).map((language) => [language, []]));
    const add = (key, slot) => {
      for (const [language, table] of Object.entries(STATUS_TEXT)) {
        lines[language].push(table[key](slot));
      }
    };
    for (const { slot, error } of this.config.invalidSlots) {
      add(error === 'loopback' ? 'loopback' : 'invalid', slot);
    }
    for (const slot of SLOTS) {
      const vlc = this.instances.get(slot)?.vlc;
      if (!vlc) {
        continue;
      }
      if (vlc.unauthorized) {
        add('unauthorized', slot);
      } else if (vlc.invalidAnswer) {
        add('invalidAnswer', slot);
      } else if (!vlc.reachable && vlc.lastError) {
        add('unreachable', slot);
      }
    }
    if (this.instances.size === 0 && this.config.invalidSlots.length === 0) {
      for (const [language, table] of Object.entries(STATUS_TEXT)) {
        lines[language].push(table.none);
      }
    }
    if (lines.en.length === 0) {
      return null;
    }
    return Object.fromEntries(
      Object.entries(lines).map(([language, list]) => [language, list.join(' ').slice(0, 500)]),
    );
  }

  async updateConnectionStatus() {
    if (this.stopped) {
      return;
    }
    const message = this.statusMessage();
    const instances = [...this.instances.values()].map((entry) => entry.vlc);
    const connected = instances.some((vlc) => vlc.reachable);
    // An instance still on its first attempt, nothing known yet: wait.
    if (!connected && message === null && instances.some((vlc) => !vlc.known)) {
      return;
    }
    const fingerprint = JSON.stringify({ connected, message });
    if (fingerprint === this.lastStatus) {
      return;
    }
    this.lastStatus = fingerprint;
    try {
      await this.gladys.setConnectionStatus(connected, message ?? undefined);
    } catch (err) {
      logger.warn(`Cannot set the connection status: ${err.message}`);
    }
  }

  // --- Commands -------------------------------------------------------------

  entryOf(externalId) {
    const entry = this.instances.get(slotOf(this.gladys, externalId));
    if (!entry) {
      throw new CommandError('unknown_device', this.language);
    }
    return entry;
  }

  /**
   * Run `action(vlc)` on the VLC of a device external id; VLC's refusals
   * become CommandErrors (coded, multi-language).
   */
  async run(externalId, action) {
    const entry = this.entryOf(externalId);
    try {
      return await action(entry.vlc);
    } catch (err) {
      if (err instanceof VlcError) {
        const code = ['unauthorized', 'unreachable'].includes(err.kind) ? err.kind : 'refused';
        logger.warn(`VLC ${entry.slot}: command failed (${err.message})`);
        entry.vlc.refreshSoon();
        throw new CommandError(code, this.language);
      }
      throw err;
    }
  }

  checkVolume(value) {
    const number = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > 100) {
      throw new CommandError('out_of_range', this.language);
    }
    return Math.round(number);
  }

  checkMrl(value) {
    const mrl = normalizeMrl(value);
    if (!mrl) {
      throw new CommandError('bad_url', this.language);
    }
    return mrl;
  }

  /** onSetValue: the volume slider, the buttons, the core's notifications. */
  async setValue(device, feature, value) {
    const key = featureKeyOf(feature?.external_id);
    const where = `VLC ${slotOf(this.gladys, device?.external_id) ?? '?'}`;
    if (key === 'volume') {
      const volume = this.checkVolume(value);
      logger.info(`${where}: volume ${volume} %`);
      await this.run(device.external_id, (vlc) => vlc.setVolume(volume));
      return;
    }
    if (key === 'notification') {
      const mrl = this.checkMrl(value);
      await this.run(device.external_id, (vlc) => vlc.announce(mrl));
      return;
    }
    if (key in BUTTONS) {
      logger.info(`${where}: ${key}`);
      await this.run(device.external_id, (vlc) => this.#press(vlc, key));
      return;
    }
    if (key === 'mute') {
      // A television push button before the "Update" of the Discover tab: it
      // toggles, as in 1.0.
      const legacy = feature?.category === 'television';
      const mode = legacy ? 'toggle' : this.#choice(value, { 0: 'unmute', 1: 'mute' });
      logger.info(`${where}: mute ${mode}`);
      await this.run(device.external_id, (vlc) => vlc.setMute(mode));
      return;
    }
    if (key === 'playback_state') {
      const state = this.#choice(value, { 0: 0, 1: 1, 2: 2 });
      logger.info(`${where}: playback ${['pause', 'play', 'stop'][state]}`);
      await this.run(device.external_id, (vlc) => vlc.setPlayback(state));
      return;
    }
    if (key === 'position') {
      const seconds = Number(value);
      if (!Number.isFinite(seconds) || seconds < 0) {
        throw new CommandError('bad_value', this.language);
      }
      logger.info(`${where}: seek to ${Math.round(seconds)} s`);
      await this.run(device.external_id, (vlc) => vlc.seek(seconds));
      return;
    }
    if (key === 'shuffle') {
      const on = this.#choice(value, { 0: false, 1: true });
      logger.info(`${where}: shuffle ${on ? 'on' : 'off'}`);
      await this.run(device.external_id, (vlc) => vlc.setShuffle(on));
      return;
    }
    if (key === 'repeat') {
      const modes = Object.fromEntries(Object.entries(REPEAT_MODES).map(([m, v]) => [v, m]));
      const mode = this.#choice(value, modes);
      logger.info(`${where}: repeat ${mode}`);
      await this.run(device.external_id, (vlc) => vlc.setRepeat(mode));
      return;
    }
    throw new Error(`Feature ${key} cannot be controlled`);
  }

  /** The meaning of an enum value written by Gladys, or a coded error. */
  #choice(value, table) {
    const number = Number(value);
    if (!Object.hasOwn(table, number)) {
      throw new CommandError('bad_value', this.language);
    }
    return table[number];
  }

  #press(vlc, key) {
    switch (key) {
      case 'play':
        return vlc.play();
      case 'pause':
        return vlc.pause();
      case 'stop':
        return vlc.stopPlayback();
      case 'previous':
        return vlc.previous();
      default:
        return vlc.next();
    }
  }

  /** Play an MRL (scene action), optionally at a volume. */
  async playMrl(externalId, { mrl, mode, volume }) {
    await this.run(externalId, async (vlc) => {
      if (volume !== null) {
        await vlc.setVolume(volume);
      }
      await vlc.playMrl(mrl, mode);
    });
    logger.info(`VLC ${slotOf(this.gladys, externalId)}: ${mode} ${loggableMrl(mrl)}`);
  }

  /** onPoll (the devices are not polled by the core; this only serves a Gladys that would). */
  async poll(device) {
    await this.instances
      .get(slotOf(this.gladys, device?.external_id))
      ?.vlc.refresh()
      .catch(() => {});
  }

  // --- "Test the connection" ----------------------------------------------

  async testReport() {
    if (this.instances.size === 0) {
      return Object.fromEntries(Object.entries(TEST_TEXT).map(([lang, t]) => [lang, t.none]));
    }
    const lines = Object.fromEntries(Object.keys(TEST_TEXT).map((language) => [language, []]));
    for (const entry of [...this.instances.values()].sort((a, b) => a.slot - b.slot)) {
      const { vlc } = entry;
      await vlc.freshRead().catch(() => {});
      for (const [language, table] of Object.entries(TEST_TEXT)) {
        if (vlc.unauthorized) {
          lines[language].push(table.unauthorized(entry.slot));
        } else if (vlc.invalidAnswer) {
          lines[language].push(table.invalidAnswer(entry.slot));
        } else if (!vlc.reachable) {
          lines[language].push(table.failed(entry.slot));
        } else {
          const state = STATE_LABELS[language][vlc.snapshot.state].toLowerCase();
          lines[language].push(
            table.ok(entry.slot, this.deviceName(entry), vlc.version ?? '?', state),
          );
        }
      }
    }
    logger.info(`Connection test: ${lines.en.join(' ')}`);
    return Object.fromEntries(
      Object.entries(lines).map(([language, list]) => [language, list.join(' ').slice(0, 1000)]),
    );
  }
}

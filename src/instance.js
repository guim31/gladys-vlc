// -----------------------------------------------------------------------------
// One VLC: its web interface client, the snapshot of what plays, the playback
// events, the commands.
//
// VLC pushes nothing: the container reads status.json by itself, at a pace
// no fixed poll frequency of the core can express (Gladys#3198 aside):
// - device added to Gladys, something loaded: every `activeInterval` (3 s);
// - device added, stopped: every `idleInterval` (5 s);
// - device not added (yet): every `unwatchedInterval` (1 min), enough for
//   the connection status of the Configuration screen;
// - VLC closed or unreachable: every `offlineInterval` (30 s);
// - right after a command: once more after `afterCommand` (0.3 s);
// - while an announcement plays: every `announceInterval` (1 s).
// A local request answered in a few milliseconds; no quota on VLC's side.
//
// One failed read does not make VLC "off": a busy computer may miss one
// answer. It takes FAILURES_BEFORE_OFF in a row.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { createLogger } from '@gladysassistant/integration-sdk';
import { createIssueLog } from './issues.js';
import { VlcClient } from './vlc/client.js';
import {
  cleanText,
  emptySnapshot,
  isActive,
  playbackEvents,
  readSnapshot,
  repeatModeOf,
  toVlcVolume,
  VLC_VOLUME_100,
} from './vlc/model.js';
import { loggableMrl } from './vlc/mrl.js';

const logger = createLogger({ name: 'vlc' });

export const DEFAULT_TIMINGS = {
  activeInterval: 3_000,
  idleInterval: 5_000,
  unwatchedInterval: 60_000,
  offlineInterval: 30_000,
  announceInterval: 1_000,
  afterCommand: 300,
  // An announcement that has not started after this is given up (bad URL).
  announceStart: 10_000,
  // Nobody announces for a quarter of an hour: stop watching it.
  announceMax: 15 * 60_000,
  // After an announcement, what played before must be back within this.
  resumeGrace: 10_000,
};

export const FAILURES_BEFORE_OFF = 2;

// The volume a "mute" brings back when the one before is unknown: 50 %.
const DEFAULT_UNMUTE = VLC_VOLUME_100 / 2;

// What VLC goes back to after an announcement: a file restarts where it was
// (a few seconds earlier is not worth a seek).
const MIN_SEEK_SECONDS = 5;

const sameSnapshot = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The id of the last item of VLC's playlist (playlist.json), or null. */
export function lastItemId(tree) {
  const nodes = Array.isArray(tree?.children) ? tree.children : [];
  // The "Playlist" node has id 1 (its name follows VLC's language).
  const playlist = nodes.find((node) => String(node?.id) === '1') ?? nodes[0];
  const items = Array.isArray(playlist?.children) ? playlist.children : [];
  const id = Number(items.at(-1)?.id);
  return Number.isInteger(id) ? id : null;
}

export class VlcInstance extends EventEmitter {
  /**
   * @param {object} options
   * @param {number} options.slot
   * @param {string} options.url base URL of the web interface
   * @param {string} options.password
   * @param {Function} [options.fetch]
   * @param {Partial<typeof DEFAULT_TIMINGS>} [options.timings]
   * @param {() => boolean} [options.isWatched] whether the device is added to Gladys
   * @param {() => number} [options.now]
   */
  constructor({ slot, url, password, fetch, timings, isWatched = () => true, now = Date.now }) {
    super();
    this.slot = slot;
    this.url = url;
    this.client = new VlcClient({ url, password, fetch });
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.isWatched = isWatched;
    this.now = now;
    this.issues = createIssueLog(logger);
    this.snapshot = emptySnapshot('off');
    // At least one read concluded (an answer, or VLC found off).
    this.known = false;
    this.reachable = false;
    this.everReached = false;
    this.unauthorized = false;
    this.invalidAnswer = false;
    this.lastError = null;
    this.failures = 0;
    // reachable|unauthorized|invalid, last emitted as a 'connection' event.
    this.connectionKey = null;
    this.version = null;
    // The volume (VLC scale) "mute" saved, to bring it back.
    this.muteBackup = null;
    this.announcing = null;
    // Events are held (compared with this snapshot) around an announcement.
    this.hold = null;
    this.timer = null;
    this.reading = null;
    this.soon = false;
    this.stopped = true;
  }

  get label() {
    return `VLC ${this.slot}`;
  }

  start() {
    this.stopped = false;
    this.#schedule(0);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
  }

  // --- Reading ----------------------------------------------------------------

  #schedule(delay) {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.refresh().catch(() => {});
    }, delay);
  }

  /** The delay before the next read. */
  nextDelay() {
    const t = this.timings;
    if (this.soon) {
      this.soon = false;
      return t.afterCommand;
    }
    if (this.announcing || this.hold) {
      return t.announceInterval;
    }
    if (!this.reachable) {
      // A first missed answer is retried at the normal pace.
      return this.failures > 0 && this.failures < FAILURES_BEFORE_OFF && this.everReached
        ? t.activeInterval
        : t.offlineInterval;
    }
    if (!this.isWatched()) {
      return t.unwatchedInterval;
    }
    return isActive(this.snapshot) ? t.activeInterval : t.idleInterval;
  }

  /** Read VLC now (or join the read in progress). Throws the VlcError. */
  refresh() {
    if (!this.reading) {
      this.reading = this.#read().finally(() => {
        this.reading = null;
        this.#schedule(this.nextDelay());
      });
    }
    return this.reading;
  }

  /** A read that starts after this call (after a command, for a scene). */
  async freshRead() {
    await this.reading?.catch(() => {});
    return this.refresh();
  }

  /** Read again shortly: a command was sent. */
  refreshSoon() {
    this.soon = true;
    if (!this.reading) {
      this.#schedule(this.nextDelay());
    }
  }

  async #read() {
    let status;
    try {
      status = await this.client.status();
    } catch (err) {
      this.#onFailure(err);
      throw err;
    }
    this.#onAnswer(status);
    return this.snapshot;
  }

  #emitConnection() {
    const key = `${this.reachable}|${this.unauthorized}|${this.invalidAnswer}`;
    if (key !== this.connectionKey) {
      this.connectionKey = key;
      this.emit('connection');
    }
  }

  #onAnswer(status) {
    this.failures = 0;
    this.reachable = true;
    this.unauthorized = false;
    this.invalidAnswer = false;
    this.lastError = null;
    this.version = cleanText(status.version) || null;
    const recovered = this.issues.ok('connection', `${this.label} reachable again at ${this.url}`);
    if (!this.everReached && !recovered) {
      logger.info(`${this.label} reachable at ${this.url} (VLC ${this.version ?? '?'})`);
    }
    this.everReached = true;
    this.#apply(readSnapshot(status));
    this.#emitConnection();
    this.emit('read', this.snapshot);
  }

  #onFailure(err) {
    this.lastError = err;
    const wasReachable = this.reachable;
    this.unauthorized = err?.kind === 'unauthorized';
    this.invalidAnswer = err?.kind === 'invalid';
    if (this.unauthorized || this.invalidAnswer) {
      this.failures = FAILURES_BEFORE_OFF;
    } else {
      this.failures += 1;
    }
    if (this.failures < FAILURES_BEFORE_OFF && this.known && wasReachable) {
      logger.debug(`${this.label}: one answer missed (${err?.message})`);
      return;
    }
    this.reachable = false;
    this.issues.fail('connection', `${this.label}: ${err?.message ?? err}`);
    this.#apply(emptySnapshot('off'));
    this.#emitConnection();
  }

  #apply(next) {
    const previous = this.known ? this.snapshot : null;
    this.known = true;
    this.snapshot = next;
    this.#followAnnouncement(next);

    let events = [];
    const held = this.hold !== null;
    if (this.hold) {
      if (this.#holdIsOver(next)) {
        events = playbackEvents(this.hold.before, next);
        this.hold = null;
      }
    } else {
      events = playbackEvents(previous, next);
    }

    // The end of a hold is an update too: during it, the hub published the
    // playback state alone (src/hub.js), the rest follows now.
    const released = held && this.hold === null;
    if (!previous || released || !sameSnapshot(previous, next)) {
      this.emit('update', next, previous ?? emptySnapshot('off'));
    }
    for (const event of events) {
      logger.debug(`${this.label}: playback ${event.type}`);
      this.emit('playback', event);
    }
  }

  // --- Announcements ----------------------------------------------------------
  //
  // The core's "Talk on a speaker" scene action sends an MP3 URL (a text to
  // speech) to the `music/play_notification` feature. VLC adds it at the end
  // of its playlist and plays it at once. When it ends, the integration
  // removes it from the playlist and, if something was playing before, plays
  // it again (a file where it was, a radio from now). The scene triggers stay
  // quiet meanwhile: an announcement is not a playback that starts and stops.

  /**
   * @param {string} mrl validated by normalizeMrl
   */
  async announce(mrl) {
    // A second announcement during the first: what played before the first
    // is what comes back, and both are removed from the playlist.
    const ongoing = this.announcing;
    const before = ongoing?.before ?? readSnapshot(await this.client.status());
    const earlier = ongoing ? [...ongoing.earlier, ongoing.itemId].filter((id) => id !== null) : [];
    this.announcing = { before, earlier, startedAt: this.now(), itemId: null, seen: false };
    this.hold = { before: this.hold?.before ?? before, until: null };
    try {
      await this.client.status('in_play', { input: mrl });
    } catch (err) {
      this.announcing = null;
      this.hold = null;
      throw err;
    }
    logger.info(`${this.label}: announcement ${loggableMrl(mrl)}`);
    // in_play appends to the playlist: its last item is the announcement,
    // known even if it ends (or fails) before the next read.
    const itemId = await this.client
      .playlist()
      .then(lastItemId)
      .catch(() => null);
    if (this.announcing && itemId !== null && itemId !== before.itemId) {
      this.announcing.itemId ??= itemId;
    }
    this.refreshSoon();
  }

  #followAnnouncement(next) {
    const announcement = this.announcing;
    if (!announcement) {
      return;
    }
    const elapsed = this.now() - announcement.startedAt;
    const playsIt =
      isActive(next) &&
      next.itemId !== null &&
      next.itemId !== announcement.before.itemId &&
      !announcement.earlier.includes(next.itemId) &&
      (announcement.itemId === null || next.itemId === announcement.itemId);
    let over = elapsed > this.timings.announceMax;
    if (!announcement.seen) {
      if (playsIt) {
        announcement.seen = true;
        announcement.itemId ??= next.itemId;
      } else if (elapsed > this.timings.announceStart) {
        // Never seen playing: too short to be seen, or an address VLC cannot open.
        over = true;
      }
    } else if (!playsIt) {
      over = true;
    }
    if (over) {
      this.announcing = null;
      this.#afterAnnouncement(announcement, next).catch((err) =>
        logger.warn(`${this.label}: cannot resume after the announcement (${err.message})`),
      );
    }
  }

  async #afterAnnouncement({ before, earlier, itemId }, next) {
    this.hold.until = this.now() + this.timings.resumeGrace;
    for (const id of [...earlier, itemId].filter((value) => value !== null)) {
      // pl_delete is marked "unsupported" by VLC's README, and works on 3.0.
      await this.client.status('pl_delete', { id }).catch((err) => {
        logger.debug(`${this.label}: announcement left in the playlist (${err.message})`);
      });
    }
    const resume = before.state === 'playing' && before.itemId !== null && !isActive(next);
    if (!resume) {
      this.hold.until = this.now();
      this.refreshSoon();
      return;
    }
    this.hold.resumeItem = before.itemId;
    await this.client.status('pl_play', { id: before.itemId });
    if (before.length !== null && before.time >= MIN_SEEK_SECONDS) {
      await this.client.status('seek', { val: Math.floor(before.time) });
    }
    this.refreshSoon();
  }

  #holdIsOver(next) {
    if (this.announcing || this.hold.until === null) {
      return false;
    }
    if (this.hold.resumeItem !== undefined) {
      if (next.state === 'playing' && next.itemId === this.hold.resumeItem) {
        return true;
      }
    }
    return this.now() >= this.hold.until;
  }

  // --- Commands ---------------------------------------------------------------
  // Each throws the VlcError of a refused or unanswered request.

  async #command(command, params) {
    await this.client.status(command, params);
    this.refreshSoon();
  }

  /** Play: resume a paused item, start the playlist when stopped. */
  async play() {
    const { state } = await this.client.status();
    if (state === 'paused') {
      await this.#command('pl_forceresume');
    } else if (state !== 'playing') {
      await this.#command('pl_play');
    }
  }

  /** Pause what plays (nothing when nothing plays). */
  pause() {
    return this.#command('pl_forcepause');
  }

  /** Pause or play, whatever the state (from stopped, starts the playlist). */
  playPause() {
    return this.#command('pl_pause');
  }

  stopPlayback() {
    return this.#command('pl_stop');
  }

  next() {
    return this.#command('pl_next');
  }

  previous() {
    return this.#command('pl_previous');
  }

  /** @param {number} percent 0-100 */
  async setVolume(percent) {
    await this.#command('volume', { val: toVlcVolume(percent) });
    if (percent > 0 && this.muteBackup !== null) {
      this.#setMuteBackup(null);
    }
  }

  /**
   * VLC's web interface neither reports nor sets its mute: like Home
   * Assistant's vlc_telnet, muting sets the volume to 0 and remembers the one
   * before, unmuting brings it back. Resolves whether VLC is now muted.
   * @param {'mute'|'unmute'|'toggle'} mode
   */
  async setMute(mode = 'toggle') {
    const status = await this.client.status();
    const current = readSnapshot(status).volumeRaw ?? 0;
    const mute = mode === 'toggle' ? current > 0 : mode === 'mute';
    if (mute && current > 0) {
      this.#setMuteBackup(current);
      await this.#command('volume', { val: 0 });
    } else if (!mute && current === 0) {
      await this.#command('volume', { val: this.muteBackup ?? DEFAULT_UNMUTE });
      this.#setMuteBackup(null);
    }
    return mute;
  }

  #setMuteBackup(value) {
    this.muteBackup = value;
    this.emit('mute', value);
  }

  /**
   * @param {string} mrl validated by normalizeMrl
   * @param {'play'|'replace'|'enqueue'} mode
   */
  async playMrl(mrl, mode) {
    if (mode === 'enqueue') {
      await this.#command('in_enqueue', { input: mrl });
      return;
    }
    if (mode === 'replace') {
      await this.client.status('pl_empty');
    }
    await this.#command('in_play', { input: mrl });
  }

  clearPlaylist() {
    return this.#command('pl_empty');
  }

  // --- Gladys 5.3 player ------------------------------------------------------

  /** playback_state written by Gladys: 0 pause, 1 play, 2 stop. */
  setPlayback(state) {
    if (state === 0) {
      return this.pause();
    }
    return state === 1 ? this.play() : this.stopPlayback();
  }

  /** Seek to `seconds` in the current item; nothing when nothing is loaded. */
  async seek(seconds) {
    const { state } = await this.client.status();
    if (state === 'playing' || state === 'paused') {
      await this.#command('seek', { val: Math.max(0, Math.round(seconds)) });
    }
  }

  /** random is a toggle in VLC's web interface: read it first. */
  async setShuffle(on) {
    const status = await this.client.status();
    if ((status.random === true) !== on) {
      await this.#command('pl_random');
    }
  }

  /**
   * loop and repeat are toggles, and over HTTP turning one on turns the other
   * off: read them, toggle what differs.
   * @param {'off'|'all'|'one'} mode
   */
  async setRepeat(mode) {
    let current = readSnapshot(await this.client.status());
    if (repeatModeOf(current) === mode) {
      return;
    }
    if (mode === 'all' && !current.loop) {
      current = readSnapshot(await this.client.status('pl_loop'));
    }
    if (mode === 'one' && !current.repeat) {
      current = readSnapshot(await this.client.status('pl_repeat'));
    }
    if (mode !== 'all' && current.loop) {
      current = readSnapshot(await this.client.status('pl_loop'));
    }
    if (mode !== 'one' && current.repeat) {
      await this.client.status('pl_repeat');
    }
    this.refreshSoon();
  }

  /** Replace the playlist with an MRL and play it (the music panel). */
  replaceWith(mrl) {
    return this.playMrl(mrl, 'replace');
  }

  /** Play the playlist item of that id. */
  playItem(id) {
    return this.#command('pl_play', { id });
  }

  /** The artwork of the current item (VLC's /art), or null. */
  art(maxBytes) {
    return this.client.art(maxBytes);
  }
}

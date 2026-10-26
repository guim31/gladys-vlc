// -----------------------------------------------------------------------------
// VLC instance -> Gladys device, and snapshot -> feature states.
//
// Couples chosen among those the Gladys front knows (test/gladys-rules.test.js):
// - play, pause, previous, next, volume: the `music` category, the one the
//   core's Music dashboard box reads — the precedent of gladys-dlna;
// - Gladys 5.3 player (capabilities/music.md), published by publishNowPlaying:
//   playback_state (0 paused, 1 playing, 2 stopped; writable: pause, play,
//   stop), title, artist, album, artwork (an image key served by the
//   integration, src/catalog.js), duration and position (seconds; position
//   writable = seek), shuffle (VLC's random), repeat (off, all = VLC's loop,
//   one = VLC's repeat), mute. Title, artist and album were text/text and mute
//   a television button before 1.1.0: same external ids, converted in place by
//   the "Update" of the Discover tab;
// - notification: music/play_notification, the target of the core's "Talk on
//   a speaker" scene action (the value is the URL of an MP3);
// - stop: the core's music category has none, it borrows the television
//   remote-control key, rendered as a push button in the device box;
// - state: text/text, the state in words (kept from 1.0);
// - progress: level-sensor/liquid-level-percent, the only read-only percent
//   couple with a label (precedent of gladys-kodi, gladys-octoprint);
// - time_left: duration/integer in minutes (duration/decimal is a slider).
//
// The structure does not depend on what VLC plays nor on its version: the
// device is published as soon as an address is configured, even while VLC is
// closed. Feature keys are forever.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
  MUSIC_PLAYBACK_STATE,
  MUSIC_REPEAT_MODE,
} from '@gladysassistant/integration-sdk';
import { isActive, minutesLeftOf, progressOf, repeatModeOf, volumePercent } from './vlc/model.js';
import { NAMES, NOTHING_PLAYING, STATE_LABELS, UNKNOWN_TITLE } from './texts.js';

export const DEVICE_TYPE = 'vlc';

// The push buttons (value 1), and what they do.
export const BUTTONS = {
  play: { category: CAT.MUSIC, type: TYPE.MUSIC.PLAY },
  pause: { category: CAT.MUSIC, type: TYPE.MUSIC.PAUSE },
  stop: { category: CAT.TELEVISION, type: TYPE.TELEVISION.STOP },
  previous: { category: CAT.MUSIC, type: TYPE.MUSIC.PREVIOUS },
  next: { category: CAT.MUSIC, type: TYPE.MUSIC.NEXT },
};

// MUSIC_PLAYBACK_STATE of the core, by state of src/vlc/model.js.
export const PLAYBACK_STATES = {
  playing: MUSIC_PLAYBACK_STATE.PLAYING,
  paused: MUSIC_PLAYBACK_STATE.PAUSED,
  stopped: MUSIC_PLAYBACK_STATE.IDLE,
  off: MUSIC_PLAYBACK_STATE.IDLE,
};

export const REPEAT_MODES = {
  off: MUSIC_REPEAT_MODE.OFF,
  all: MUSIC_REPEAT_MODE.ALL,
  one: MUSIC_REPEAT_MODE.ONE,
};

const MAX_MINUTES = 6_000; // 100 hours
// Bound of the duration and the position (100 hours, like time_left).
export const MAX_SECONDS = MAX_MINUTES * 60;

export function deviceIds(gladys, slot) {
  return gladys.externalIds(DEVICE_TYPE, String(slot));
}

/** `VLC (192.0.2.30)`: tells three VLC apart in the Discovery tab. */
export function defaultName(host) {
  return `VLC (${host})`.slice(0, 60);
}

/**
 * @param {object} gladys
 * @param {{ slot: number, url: string, host: string }} instance
 * @param {string} language
 */
export function buildDevice(gladys, { slot, url, host }, language) {
  const names = NAMES[language] ?? NAMES.en;
  const ids = deviceIds(gladys, slot);
  const feature = (key, fields) => ({
    name: names[key],
    external_id: ids.feature(key),
    read_only: true,
    has_feedback: false,
    ...fields,
  });
  const text = { category: CAT.TEXT, type: TYPE.TEXT.TEXT, min: 0, max: 0 };

  const music = (key, type, fields = {}) =>
    feature(key, { category: CAT.MUSIC, type, min: 0, max: 0, keep_history: false, ...fields });
  // Writable music features: VLC is read back right after a command.
  const control = { read_only: false, has_feedback: true };

  const features = [
    // Read-only, max 1 before 1.1.0: same external id, the "Update" of the
    // Discover tab makes it writable.
    music('playback_state', TYPE.MUSIC.PLAYBACK_STATE, { max: 2, ...control }),
    feature('state', text),
    // text/text before 1.1.0: same external ids, converted in place.
    music('title', TYPE.MUSIC.TITLE),
    music('artist', TYPE.MUSIC.ARTIST),
    music('album', TYPE.MUSIC.ALBUM),
    music('artwork', TYPE.MUSIC.ARTWORK),
    music('duration', TYPE.MUSIC.DURATION, { unit: UNIT.SECONDS, max: MAX_SECONDS }),
    music('position', TYPE.MUSIC.POSITION, { unit: UNIT.SECONDS, max: MAX_SECONDS, ...control }),
    music('shuffle', TYPE.MUSIC.SHUFFLE, { max: 1, ...control }),
    music('repeat', TYPE.MUSIC.REPEAT, { max: MUSIC_REPEAT_MODE.ONE, ...control }),
    feature('progress', {
      category: CAT.LEVEL_SENSOR,
      type: TYPE.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
      unit: UNIT.PERCENT,
      min: 0,
      max: 100,
      keep_history: false,
    }),
    feature('time_left', {
      category: CAT.DURATION,
      type: TYPE.DURATION.INTEGER,
      unit: UNIT.MINUTES,
      min: 0,
      max: MAX_MINUTES,
      keep_history: false,
    }),
    music('volume', TYPE.MUSIC.VOLUME, { unit: UNIT.PERCENT, max: 100, ...control }),
  ];
  for (const [key, couple] of Object.entries(BUTTONS)) {
    features.push(feature(key, { ...couple, min: 0, max: 1, read_only: false }));
  }
  // A television push button before 1.1.0 (it toggled): same external id.
  features.push(music('mute', TYPE.MUSIC.MUTE, { max: 1, ...control }));
  features.push(
    feature('notification', {
      category: CAT.MUSIC,
      type: TYPE.MUSIC.PLAY_NOTIFICATION,
      min: 0,
      max: 0,
      read_only: false,
    }),
  );

  return {
    name: defaultName(host),
    external_id: ids.device,
    model: 'VLC media player',
    // Polled by the container itself, faster while something plays than any
    // fixed pace of the core scheduler (see src/instance.js).
    should_poll: false,
    features,
    params: [{ name: 'VLC_URL', value: url }],
  };
}

const pick = (table, language) => table[language] ?? table.en;

/** The `title` state of a snapshot. */
export function titleText(snapshot, language) {
  if (!isActive(snapshot)) {
    return pick(NOTHING_PLAYING, language);
  }
  return snapshot.title || pick(UNKNOWN_TITLE, language);
}

/**
 * The legacy feature states of a snapshot (publishChangedStates): the state
 * in words, progress in whole percent and time left in whole minutes (they
 * change a few times a minute at most). Everything of the music category goes
 * through nowPlaying() instead: one channel per feature.
 */
export function buildStates(gladys, slot, snapshot, language) {
  const ids = deviceIds(gladys, slot);
  return [
    {
      device_feature_external_id: ids.feature('state'),
      text: pick(STATE_LABELS, language)[snapshot.state],
    },
    { device_feature_external_id: ids.feature('progress'), state: progressOf(snapshot) },
    {
      device_feature_external_id: ids.feature('time_left'),
      state: Math.min(MAX_MINUTES, minutesLeftOf(snapshot)),
    },
  ];
}

/**
 * The snapshot given to publishNowPlaying (Gladys 5.3).
 * - Nothing loaded (stopped: VLC forgets the current item; VLC closed): the
 *   texts and the artwork are cleared explicitly (an absent key means
 *   "unchanged").
 * - A web radio: the song it announces as title, its station as artist when
 *   the song has none (describeItem), duration 0, position counted by VLC.
 * - Mute: VLC's web interface has none; the integration mutes by setting the
 *   volume to 0 and remembering the one before (src/instance.js). A volume of
 *   0 is shown muted, with the remembered volume on the slider.
 * - VLC closed: the modes and the volume are left as they were.
 * @param {object} snapshot
 * @param {object} [options]
 * @param {string|null} [options.artworkUrl] the source given to artworkKey
 * @param {number|null} [options.muteBackup] the volume (VLC scale) a mute keeps
 */
export function nowPlaying(snapshot, { artworkUrl = null, muteBackup = null } = {}) {
  const active = isActive(snapshot);
  const duration = active && snapshot.length !== null ? Math.min(MAX_SECONDS, snapshot.length) : 0;
  const time = active && snapshot.time !== null ? snapshot.time : 0;
  const result = {
    playback_state: PLAYBACK_STATES[snapshot.state] ?? MUSIC_PLAYBACK_STATE.IDLE,
    title: active ? snapshot.title : '',
    artist: active ? snapshot.artist : '',
    album: active ? snapshot.album : '',
    artwork_url: active ? artworkUrl : null,
    duration,
    position: duration > 0 ? Math.min(time, duration) : time,
  };
  if (snapshot.state === 'off') {
    return result;
  }
  result.shuffle = snapshot.random;
  result.repeat = REPEAT_MODES[repeatModeOf(snapshot)];
  if (snapshot.volumeRaw !== null) {
    const muted = snapshot.volumeRaw === 0;
    result.mute = muted;
    const shown =
      muted && muteBackup !== null
        ? volumePercent({ volumeRaw: muteBackup })
        : volumePercent(snapshot);
    result.volume = Math.min(100, shown);
  }
  return result;
}

/** `ext:...:vlc:2` -> 2, or null when the id is not one of ours. */
export function slotOf(gladys, externalId) {
  const prefix = gladys.externalId(`${DEVICE_TYPE}:`);
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const slot = Number(externalId.slice(prefix.length).split(':')[0]);
  return Number.isInteger(slot) ? slot : null;
}

/** The feature key of a feature external id (`...:vlc:1:volume` -> `volume`). */
export function featureKeyOf(externalId) {
  return typeof externalId === 'string' ? externalId.split(':').at(-1) : '';
}

// -----------------------------------------------------------------------------
// VLC instance -> Gladys device, and snapshot -> feature states.
//
// Couples chosen among those the Gladys front knows (test/gladys-rules.test.js):
// - play, pause, previous, next, volume, playback_state: the `music` category,
//   the one the core's Music dashboard box reads (play/pause, previous, next,
//   volume slider) — the precedent of gladys-dlna;
// - notification: music/play_notification, the target of the core's "Talk on
//   a speaker" scene action (the value is the URL of an MP3);
// - stop, mute: the core's music category has neither, so they borrow the
//   television remote-control keys, rendered as push buttons in the device box;
// - state, title, artist, album: text/text (several of them: the dashboard
//   shows their names);
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
} from '@gladysassistant/integration-sdk';
import { isActive, minutesLeftOf, progressOf, volumePercent } from './vlc/model.js';
import { NAMES, NOTHING_PLAYING, NO_VALUE, STATE_LABELS, UNKNOWN_TITLE } from './texts.js';

export const DEVICE_TYPE = 'vlc';

// The push buttons (value 1), and what they do.
export const BUTTONS = {
  play: { category: CAT.MUSIC, type: TYPE.MUSIC.PLAY },
  pause: { category: CAT.MUSIC, type: TYPE.MUSIC.PAUSE },
  stop: { category: CAT.TELEVISION, type: TYPE.TELEVISION.STOP },
  previous: { category: CAT.MUSIC, type: TYPE.MUSIC.PREVIOUS },
  next: { category: CAT.MUSIC, type: TYPE.MUSIC.NEXT },
  mute: { category: CAT.TELEVISION, type: TYPE.TELEVISION.VOLUME_MUTE },
};

// MUSIC_PLAYBACK_STATE of the core: 1 playing, 0 anything else.
export const PLAYBACK_STATE = { PLAYING: 1, NOT_PLAYING: 0 };

const MAX_MINUTES = 6_000; // 100 hours

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

  const features = [
    feature('playback_state', {
      category: CAT.MUSIC,
      type: TYPE.MUSIC.PLAYBACK_STATE,
      min: 0,
      max: 1,
      keep_history: true,
    }),
    feature('state', text),
    feature('title', text),
    feature('artist', text),
    feature('album', text),
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
    feature('volume', {
      category: CAT.MUSIC,
      type: TYPE.MUSIC.VOLUME,
      unit: UNIT.PERCENT,
      min: 0,
      max: 100,
      read_only: false,
      // The volume is read back from VLC right after a change.
      has_feedback: true,
    }),
  ];
  for (const [key, couple] of Object.entries(BUTTONS)) {
    features.push(feature(key, { ...couple, min: 0, max: 1, read_only: false }));
  }
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
 * Feature states of a snapshot, in the publishStates format. Progress in
 * whole percent and time left in whole minutes: they change a few times a
 * minute at most (Gladys takes 300 states a minute for the whole
 * integration). The volume is capped at 100 % (VLC goes up to 125 % and
 * beyond); an unknown volume is left out (Gladys keeps the last one).
 */
export function buildStates(gladys, slot, snapshot, language) {
  const ids = deviceIds(gladys, slot);
  const active = isActive(snapshot);
  const states = [];
  const add = (key, value) => {
    if (value !== null && value !== undefined) {
      states.push({ device_feature_external_id: ids.feature(key), state: value });
    }
  };
  const addText = (key, value) => {
    states.push({ device_feature_external_id: ids.feature(key), text: value });
  };
  add(
    'playback_state',
    snapshot.state === 'playing' ? PLAYBACK_STATE.PLAYING : PLAYBACK_STATE.NOT_PLAYING,
  );
  addText('state', pick(STATE_LABELS, language)[snapshot.state]);
  addText('title', titleText(snapshot, language));
  addText('artist', (active && snapshot.artist) || NO_VALUE);
  addText('album', (active && snapshot.album) || NO_VALUE);
  add('progress', progressOf(snapshot));
  add('time_left', Math.min(MAX_MINUTES, minutesLeftOf(snapshot)));
  const volume = snapshot.state === 'off' ? null : volumePercent(snapshot);
  add('volume', volume === null ? null : Math.min(100, volume));
  return states;
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

// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// An unreachable VLC, an unknown device or an address that is not a media
// throws: the action fails, the scene continues and logs it.
//
// The playback controls (play, pause, next, volume...) are not repeated here:
// they are device features, reachable from the core's "Control a device"
// action. These two are what a device feature cannot carry: an address to
// play, and the playlist as a whole.
//
// The triggers (`playback_started`...) are fired from what VLC reports,
// whatever started the playback: `play_url` is followed by `playback_started`
// like a play from VLC's window. A scene that reacts to `playback_started` by
// starting a playback would loop: the documentation says so.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'vlc-scenes' });

// `play`: add at the end of the playlist and play it now; `replace`: empty the
// playlist first; `enqueue`: add at the end, play nothing.
export const PLAY_MODES = ['play', 'replace', 'enqueue'];
export const DEFAULT_PLAY_MODE = 'play';

function number(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return typeof value === 'string' ? Number(value.replace(',', '.')) : value;
}

export const SCENE_ACTIONS = {
  async play_url(hub, { fields }) {
    const mrl = hub.checkMrl(fields.url);
    const mode = PLAY_MODES.includes(fields.mode) ? fields.mode : DEFAULT_PLAY_MODE;
    const wanted = number(fields.volume);
    const volume = wanted === null ? null : hub.checkVolume(wanted);
    await hub.playMrl(fields.device, { mrl, mode, volume });
  },

  async clear_playlist(hub, { fields }) {
    await hub.run(fields.device, (vlc) => vlc.clearPlaylist());
    logger.info(`Playlist emptied on ${fields.device}`);
  },
};

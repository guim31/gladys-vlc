// -----------------------------------------------------------------------------
// What VLC answers (status.json) -> a snapshot of what plays, and two
// snapshots -> the playback events the scene triggers fire.
//
// Recorded on VLC 3.0.20 (test/fixtures/vlc/):
// - `state` is "playing", "paused" or "stopped";
// - `volume` is VLC's own scale: 256 is 100 %, the interface goes up to 125 %
//   (320) and the web interface accepts more (512 and beyond);
// - `time` and `length` are whole seconds, `length` is 0 for a live stream;
// - `currentplid` is the id of the current playlist item, -1 when stopped;
// - `information.category.meta` holds the tags: `title`, `artist`, `album`,
//   `filename`, and `now_playing` for a web radio (its ICY StreamTitle, while
//   `title` is the station name), `artwork_url` when the item has a cover.
// -----------------------------------------------------------------------------

export const STATES = ['off', 'stopped', 'playing', 'paused'];

// VLC's volume scale: 256 = 100 %.
export const VLC_VOLUME_100 = 256;

const MAX_TEXT = 200;

/** `playing` or `paused`: an item is loaded. */
export const isActive = (snapshot) => snapshot.state === 'playing' || snapshot.state === 'paused';

/** The snapshot of a VLC that does not answer, or not read yet. */
export function emptySnapshot(state = 'off') {
  return {
    state,
    title: '',
    artist: '',
    album: '',
    itemId: null,
    time: null,
    length: null,
    volumeRaw: null,
    hasArt: false,
    // Playback modes: VLC's `random`, `loop` (the playlist) and `repeat`
    // (the current item). Over HTTP, setting loop clears repeat and back.
    random: false,
    loop: false,
    repeat: false,
  };
}

/** A tag as text: trimmed, without control characters, capped. */
export function cleanText(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return '';
  }
  return (
    String(value)
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_TEXT)
  );
}

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * Title, artist and album of the current item, the way Home Assistant's
 * vlc_telnet integration reads them: a web radio puts the song in
 * `now_playing` and its own name in `title`; a file without tags falls back to
 * its file name.
 * @param {Record<string, unknown>} meta
 */
export function describeItem(meta = {}) {
  let title = cleanText(meta.title);
  let artist = cleanText(meta.artist);
  const album = cleanText(meta.album);
  const nowPlaying = cleanText(meta.now_playing);
  if (nowPlaying) {
    if (!artist) {
      artist = title;
    }
    title = nowPlaying;
  }
  if (!title) {
    // A file served with a signed URL would show its signature: cut the query.
    title = cleanText(String(meta.filename ?? '').split('?')[0]);
  }
  return { title, artist, album };
}

/**
 * The snapshot of a status.json answer.
 * @param {object} status
 */
export function readSnapshot(status) {
  const state = ['playing', 'paused', 'stopped'].includes(status?.state) ? status.state : 'stopped';
  const snapshot = emptySnapshot(state);
  const volume = finite(status?.volume);
  snapshot.volumeRaw = volume === null ? null : Math.max(0, Math.round(volume));
  snapshot.random = status?.random === true;
  snapshot.loop = status?.loop === true;
  snapshot.repeat = status?.repeat === true;
  if (state === 'stopped') {
    return snapshot;
  }
  const meta = status?.information?.category?.meta ?? {};
  Object.assign(snapshot, describeItem(meta));
  const itemId = finite(status.currentplid);
  snapshot.itemId = itemId !== null && itemId >= 0 ? itemId : null;
  const time = finite(status.time);
  const length = finite(status.length);
  snapshot.time = time === null ? null : Math.max(0, time);
  snapshot.length = length !== null && length > 0 ? length : null;
  snapshot.hasArt = typeof meta.artwork_url === 'string' && meta.artwork_url !== '';
  return snapshot;
}

/** The repeat mode of a snapshot: repeat (the item) wins over loop (the playlist). */
export function repeatModeOf(snapshot) {
  if (snapshot.repeat) {
    return 'one';
  }
  return snapshot.loop ? 'all' : 'off';
}

/** VLC's volume as a percentage (may exceed 100), or null. */
export function volumePercent(snapshot) {
  return snapshot.volumeRaw === null
    ? null
    : Math.round((snapshot.volumeRaw * 100) / VLC_VOLUME_100);
}

/** A percentage (0-100) on VLC's scale. */
export function toVlcVolume(percent) {
  return Math.round((Math.min(100, Math.max(0, percent)) * VLC_VOLUME_100) / 100);
}

/** Whole percent of the item played, 0 for a live stream or when nothing plays. */
export function progressOf(snapshot) {
  if (!isActive(snapshot) || snapshot.length === null || snapshot.time === null) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.floor((snapshot.time * 100) / snapshot.length)));
}

/** Whole minutes left, rounded up; 0 for a live stream or when nothing plays. */
export function minutesLeftOf(snapshot) {
  if (!isActive(snapshot) || snapshot.length === null || snapshot.time === null) {
    return 0;
  }
  return Math.max(0, Math.ceil((snapshot.length - snapshot.time) / 60));
}

/**
 * The playback events between two snapshots, for the scene triggers:
 * - `started`: something plays and nothing did, or another item plays;
 * - `paused`: what played is paused;
 * - `resumed`: the paused item plays again;
 * - `stopped`: nothing plays anymore (stopped, VLC closed or unreachable).
 * A web radio announcing its next song keeps the same item: no event.
 * The first read (previous unknown) fires nothing: a restart of the
 * integration is not a playback that starts.
 * @param {object|null} previous
 * @param {object} next
 * @returns {{ type: 'started'|'paused'|'resumed'|'stopped', snapshot: object }[]}
 */
export function playbackEvents(previous, next) {
  if (!previous) {
    return [];
  }
  const sameItem = previous.itemId !== null && previous.itemId === next.itemId;
  if (next.state === 'playing') {
    if (previous.state === 'paused' && sameItem) {
      return [{ type: 'resumed', snapshot: next }];
    }
    if (!isActive(previous) || !sameItem) {
      return [{ type: 'started', snapshot: next }];
    }
    return [];
  }
  if (next.state === 'paused') {
    if (previous.state === 'playing') {
      return [{ type: 'paused', snapshot: next }];
    }
    return [];
  }
  if (isActive(previous)) {
    // Nothing plays anymore: what was playing is what stopped.
    return [{ type: 'stopped', snapshot: previous }];
  }
  return [];
}

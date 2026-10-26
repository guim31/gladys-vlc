// -----------------------------------------------------------------------------
// The music panel of Gladys 5.3 (capabilities/music.md, section 4): browse
// the folders of the computer running VLC, read and jump in VLC's playlist,
// play a file or a folder; and the artwork of what plays.
//
// What VLC's web interface allows (VLC 3.0, share/lua/http/requests):
// - browse.json lists a folder (`uri=file:///…`, or `dir=~` for the home
//   folder of VLC's user): one level, unsorted, with `..`;
// - in_play / in_enqueue add at the END of the playlist, and nothing moves an
//   item (no pl_move): "play next" cannot be honoured, so the manifest
//   declares neither `append` (it covers next and append) nor `search`
//   (VLC has no search);
// - a folder is playable: VLC expands it into its files when it reaches it;
// - playlist.json is the playlist tree; the items are the leaves under the
//   "Playlist" node (id 1), `current` marks the one playing.
//
// Ids: a folder or a file is its file:// URI (what in_play takes back, checked
// again by normalizeMrl: an id is chosen by whoever writes a scene); the two
// entry points are `vlc:home` and `vlc:computer`. A queue line is its URI, or
// `vlc-item:<id>` when it has none or it is too long, so no line is ever lost.
// No thumbnails: VLC serves the artwork of an item only at its full size.
// -----------------------------------------------------------------------------

import { MUSIC_MEDIA_TYPES, MUSIC_PLAY_MODES } from '@gladysassistant/integration-sdk';
import { CommandError } from './hub.js';
import { normalizeMrl } from './vlc/mrl.js';
import { CATALOG_ROOTS } from './texts.js';

export const ROOT_IDS = { home: 'vlc:home', computer: 'vlc:computer' };
const MAX_ID = 512;

const AUDIO = new Set(
  'mp3 flac ogg oga opus m4a aac wav wma aif aiff alac ape mka mpc wv dsf dff ac3 mid midi'.split(
    ' ',
  ),
);
const VIDEO = new Set('mp4 mkv avi mov webm wmv m4v mpg mpeg ts m2ts flv 3gp ogv vob'.split(' '));
const PLAYLISTS = new Set('m3u m3u8 pls xspf asx cue'.split(' '));

const extensionOf = (name) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

const stripExtension = (name) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
};

/** A browse.json element as a MediaItem, or null when it is not media. */
export function elementToItem(element) {
  const name = typeof element?.name === 'string' ? element.name : '';
  const uri = typeof element?.uri === 'string' ? element.uri : '';
  if (!name || name.startsWith('.') || !uri || uri.length > MAX_ID) {
    return null;
  }
  if (element.type === 'dir') {
    return {
      id: uri,
      type: MUSIC_MEDIA_TYPES.FOLDER,
      title: name,
      browsable: true,
      playable: true,
    };
  }
  const extension = extensionOf(name);
  if (PLAYLISTS.has(extension)) {
    return {
      id: uri,
      type: MUSIC_MEDIA_TYPES.PLAYLIST,
      title: stripExtension(name),
      browsable: false,
      playable: true,
    };
  }
  if (AUDIO.has(extension) || VIDEO.has(extension)) {
    return {
      id: uri,
      type: MUSIC_MEDIA_TYPES.TRACK,
      title: stripExtension(name),
      browsable: false,
      playable: true,
    };
  }
  return null;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Folders first, then by name, the way a file manager shows them. */
function sortItems(items) {
  return items.sort(
    (a, b) =>
      (a.type === MUSIC_MEDIA_TYPES.FOLDER ? 0 : 1) -
        (b.type === MUSIC_MEDIA_TYPES.FOLDER ? 0 : 1) || collator.compare(a.title, b.title),
  );
}

/** The leaves of the "Playlist" node of playlist.json, in order. */
export function playlistItems(tree) {
  const nodes = Array.isArray(tree?.children) ? tree.children : [];
  // The "Playlist" node has id 1 (its name follows VLC's language).
  const playlist = nodes.find((node) => String(node?.id) === '1') ?? nodes[0];
  const leaves = [];
  const walk = (node) => {
    for (const child of Array.isArray(node?.children) ? node.children : []) {
      if (child?.type === 'node') {
        walk(child);
      } else if (child) {
        leaves.push(child);
      }
    }
  };
  walk(playlist);
  return leaves;
}

/** A playlist leaf as a MediaItem: never dropped (fallback id and title). */
export function leafToItem(leaf) {
  const uri = typeof leaf.uri === 'string' ? leaf.uri : '';
  const name = typeof leaf.name === 'string' && leaf.name.trim() ? leaf.name.trim() : '';
  const stream = /^(https?|mms|rtsp|rtp|udp):/i.test(uri);
  const duration = Number(leaf.duration);
  let title = name;
  if (!title) {
    try {
      title = decodeURIComponent(uri.split('/').pop() ?? '');
    } catch {
      title = uri.split('/').pop() ?? '';
    }
  }
  return {
    id: uri && uri.length <= MAX_ID ? uri : `vlc-item:${leaf.id}`,
    type: stream && !(duration > 0) ? MUSIC_MEDIA_TYPES.RADIO : MUSIC_MEDIA_TYPES.TRACK,
    title: title || `#${leaf.id}`,
    duration: duration > 0 ? Math.round(duration) : null,
    browsable: false,
    playable: true,
  };
}

const page = (items, offset = 0, limit = 50) => items.slice(offset, offset + limit);

/** onMusicBrowse: the two entry points, then any folder. */
export async function browse(hub, device, { parentId = null, offset = 0, limit = 50 } = {}) {
  if (parentId === null || parentId === undefined || parentId === '') {
    const names = CATALOG_ROOTS[hub.language] ?? CATALOG_ROOTS.en;
    const items = [
      { id: ROOT_IDS.home, type: MUSIC_MEDIA_TYPES.FOLDER, title: names.home },
      { id: ROOT_IDS.computer, type: MUSIC_MEDIA_TYPES.FOLDER, title: names.computer },
    ].map((item) => ({ ...item, browsable: true, playable: false }));
    return { items: page(items, offset, limit), total: items.length };
  }
  let where;
  if (parentId === ROOT_IDS.home) {
    where = { dir: '~' };
  } else if (parentId === ROOT_IDS.computer) {
    where = { uri: 'file:///' };
  } else if (typeof parentId === 'string' && /^file:\/\//i.test(parentId)) {
    where = { uri: parentId };
  } else {
    throw new CommandError('bad_value', hub.language);
  }
  const elements = await hub.run(device.external_id, (vlc) => vlc.client.browse(where));
  const items = sortItems(elements.map(elementToItem).filter(Boolean));
  return { items: page(items, offset, limit), total: items.length };
}

/** onMusicPlay (and the `music.play-media` scene action): replace and play. */
export async function play(hub, device, media, mode = MUSIC_PLAY_MODES.REPLACE) {
  if (mode !== MUSIC_PLAY_MODES.REPLACE) {
    // Not declared in the manifest: the core never sends it.
    throw new CommandError('bad_value', hub.language);
  }
  const id = typeof media?.id === 'string' ? media.id : '';
  if (id.startsWith('vlc-item:')) {
    const itemId = Number(id.slice('vlc-item:'.length));
    if (!Number.isInteger(itemId) || itemId < 0) {
      throw new CommandError('bad_value', hub.language);
    }
    await hub.run(device.external_id, (vlc) => vlc.playItem(itemId));
    return;
  }
  const mrl = normalizeMrl(id);
  if (!mrl) {
    throw new CommandError('bad_url', hub.language);
  }
  await hub.run(device.external_id, (vlc) => vlc.replaceWith(mrl));
}

/** onMusicQueueGet: a page of VLC's playlist. */
export async function queueGet(hub, device, { offset = 0, limit = 50 } = {}) {
  const leaves = playlistItems(await hub.run(device.external_id, (vlc) => vlc.client.playlist()));
  const current = leaves.findIndex((leaf) => leaf.current === 'current');
  return {
    items: page(leaves, offset, limit).map(leafToItem),
    currentIndex: current >= 0 ? current : null,
    total: leaves.length,
  };
}

/** onMusicQueuePlay: jump to the item at that index of the playlist. */
export async function queuePlay(hub, device, index) {
  await hub.run(device.external_id, async (vlc) => {
    const leaves = playlistItems(await vlc.client.playlist());
    const id = Number(leaves[index]?.id);
    if (!Number.isInteger(id)) {
      throw new CommandError('not_found', hub.language);
    }
    await vlc.playItem(id);
  });
}

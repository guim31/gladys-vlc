// -----------------------------------------------------------------------------
// The Gladys 5.3 music player: now playing through publishNowPlaying, the
// artwork made small enough, the commands of the music features, and the
// music panel (browse, playlist, play), against the fake VLC and the SDK's
// fake Gladys.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import { validateMediaItems } from '@gladysassistant/integration-sdk';
import { ROOT_IDS, elementToItem, leafToItem } from '../src/catalog.js';
import { MEDIA, fixture, settle, until } from './helpers/fakeVlc.js';
import { createAddedWorld, deviceId, featureId, stateOf } from './helpers/world.js';

const device = () => ({ external_id: deviceId(1) });
const feature = (key) => ({ external_id: featureId(key), category: 'music' });

/** A noisy JPEG well over the 300 KB the core accepts (a cover embedded in a file). */
function heavyJpeg(size = 1400) {
  const data = Buffer.alloc(size * size * 4);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = (i * 2654435761) % 251;
  }
  return Buffer.from(jpeg.encode({ data, width: size, height: size }, 95).data);
}

test('now playing: texts, duration, position, modes, then cleared when stopped', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  const { gladys, vlc } = world;
  vlc.open(MEDIA.tone1);
  vlc.advance(12);
  await until(() => stateOf(gladys, 'title') === 'Test Tone 1', 2000, 'title');
  assert.equal(stateOf(gladys, 'playback_state'), 1);
  assert.equal(stateOf(gladys, 'artist'), 'Gladys Test Orchestra');
  assert.equal(stateOf(gladys, 'album'), 'Synthetic Album');
  assert.equal(stateOf(gladys, 'duration'), 60);
  assert.equal(stateOf(gladys, 'position'), 12);
  assert.equal(stateOf(gladys, 'shuffle'), 0);
  assert.equal(stateOf(gladys, 'repeat'), 0);
  assert.equal(stateOf(gladys, 'mute'), 0);
  assert.equal(stateOf(gladys, 'artwork'), '');

  vlc.repeat = true;
  vlc.random = true;
  await until(() => stateOf(gladys, 'repeat') === 2, 2000, 'repeat one');
  assert.equal(stateOf(gladys, 'shuffle'), 1);

  vlc.pause();
  await until(() => stateOf(gladys, 'playback_state') === 0, 2000, 'paused');

  // A web radio: no duration, the song it announces as title.
  vlc.open(MEDIA.radio);
  await until(() => stateOf(gladys, 'artist') === 'Radio Synthetique', 2000, 'radio');
  assert.equal(stateOf(gladys, 'duration'), 0);

  vlc.stop();
  await until(() => stateOf(gladys, 'playback_state') === 2, 2000, 'stopped');
  assert.equal(stateOf(gladys, 'title'), '');
  assert.equal(stateOf(gladys, 'artist'), '');
  assert.equal(stateOf(gladys, 'album'), '');
  assert.equal(stateOf(gladys, 'position'), 0);
});

test('artwork: a heavy cover is made a small JPEG, served under its key', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  const { gladys, vlc } = world;
  const heavy = heavyJpeg();
  assert.ok(heavy.length > 300 * 1024, `fixture of ${heavy.length} bytes`);
  vlc.open(MEDIA.covered).art = heavy;
  await until(() => /^art-[0-9a-f]{12}$/.test(stateOf(gladys, 'artwork') ?? ''), 3000, 'artwork');
  const ack = await gladys.fake.musicGetArtwork(stateOf(gladys, 'artwork'));
  assert.equal(ack.success, true, ack.error);
  const bytes = Buffer.from(ack.data.image, 'base64');
  assert.ok(bytes.length <= 300 * 1024, `${bytes.length} bytes`);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  const { width, height } = jpeg.decode(bytes, { maxMemoryUsageInMB: 64 });
  assert.ok(Math.max(width, height) <= 400, `${width} x ${height}`);

  const unknown = await gladys.fake.musicGetArtwork('art-000000000000');
  assert.equal(unknown.success, false);

  // The next item has no artwork: the key is cleared.
  vlc.open(MEDIA.tone1);
  await until(() => stateOf(gladys, 'artwork') === '', 2000, 'artwork cleared');
});

test('music features: playback state, seek, shuffle and repeat toggled by reading first', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  const { gladys, vlc } = world;
  const set = (key, value) => gladys.fake.setValue(device(), feature(key), value);
  vlc.open(MEDIA.tone1);
  vlc.enqueue(MEDIA.tone2);
  await until(() => stateOf(gladys, 'playback_state') === 1, 2000, 'playing');

  assert.equal((await set('playback_state', 0)).success, true);
  assert.equal(vlc.state, 'paused');
  assert.equal((await set('playback_state', 1)).success, true);
  assert.equal(vlc.state, 'playing');
  assert.equal((await set('playback_state', 3)).success, false, 'buffering is not a command');

  assert.equal((await set('position', 30.4)).success, true);
  assert.equal(vlc.time, 30);
  await until(() => stateOf(gladys, 'position') === 30, 2000, 'seek confirmed');
  assert.equal((await set('position', -1)).success, false);

  assert.equal((await set('shuffle', 1)).success, true);
  assert.equal((await set('shuffle', 1)).success, true);
  assert.equal(vlc.random, true, 'a toggle sent once');
  await until(() => stateOf(gladys, 'shuffle') === 1, 2000, 'shuffle confirmed');

  await set('repeat', 1);
  assert.deepEqual([vlc.loop, vlc.repeat], [true, false]);
  await set('repeat', 2);
  assert.deepEqual([vlc.loop, vlc.repeat], [false, true]);
  await until(() => stateOf(gladys, 'repeat') === 2, 2000, 'repeat one confirmed');
  await set('repeat', 0);
  assert.deepEqual([vlc.loop, vlc.repeat], [false, false]);
  assert.equal((await set('repeat', 5)).success, false);

  assert.equal((await set('playback_state', 2)).success, true);
  assert.equal(vlc.state, 'stopped');
  // Seeking while stopped does nothing (VLC has no current item).
  assert.equal((await set('position', 10)).success, true);
  assert.ok(!vlc.commands.includes('seek=10'));
});

test('music panel: browse the folders of the computer running VLC', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  const { gladys, vlc } = world;
  const browse = async (parentId, options = {}) => {
    const ack = await gladys.fake.musicBrowse(device(), { parentId, ...options });
    assert.equal(ack.success, true, ack.error);
    assert.deepEqual(validateMediaItems(ack.data.items), []);
    return ack.data;
  };

  const root = await browse(null);
  assert.deepEqual(
    root.items.map((item) => [item.id, item.title]),
    [
      [ROOT_IDS.home, 'Dossier personnel'],
      [ROOT_IDS.computer, 'Ordinateur'],
    ],
  );

  vlc.folders.set('dir:~', [
    { type: 'dir', name: '..', uri: 'file:///home/' },
    { type: 'dir', name: '.cache', uri: 'file:///home/alice/.cache' },
    { type: 'file', name: 'notes.txt', uri: 'file:///home/alice/notes.txt' },
    { type: 'file', name: 'b side.flac', uri: 'file:///home/alice/b%20side.flac' },
    { type: 'file', name: 'Mix.m3u', uri: 'file:///home/alice/Mix.m3u' },
    { type: 'dir', name: 'Music', uri: 'file:///home/alice/Music' },
  ]);
  const home = await browse(ROOT_IDS.home);
  assert.deepEqual(
    home.items.map((item) => [item.type, item.title, item.browsable, item.playable]),
    [
      ['folder', 'Music', true, true],
      ['track', 'b side', false, true],
      ['playlist', 'Mix', false, true],
    ],
  );
  assert.equal(home.total, 3);
  assert.equal((await browse(ROOT_IDS.home, { offset: 1, limit: 1 })).items[0].title, 'b side');

  // The answer recorded on VLC 3.0.21.
  const recorded = fixture('browse-folder.json').element;
  vlc.folders.set('file:///music/Gamma/Small%20Embedded', recorded);
  const folder = await browse('file:///music/Gamma/Small%20Embedded');
  assert.deepEqual(
    folder.items.map((item) => item.id),
    [
      'file:///music/Gamma/Small%20Embedded/01%20-%20Tiny%201.mp3',
      'file:///music/Gamma/Small%20Embedded/02%20-%20Tiny%202.mp3',
    ],
  );

  // A folder VLC cannot open (an HTML error page), an id that is not ours.
  assert.equal(
    (await gladys.fake.musicBrowse(device(), { parentId: 'file:///nope' })).success,
    false,
  );
  assert.equal(
    (await gladys.fake.musicBrowse(device(), { parentId: 'vlc://quit' })).success,
    false,
  );
});

test('music panel: play replaces the playlist, the queue is VLC playlist', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  const { gladys, vlc } = world;
  vlc.open(MEDIA.tone1);
  vlc.enqueue(MEDIA.tone2);

  const ack = await gladys.fake.musicPlay(
    device(),
    { id: MEDIA.covered.uri, type: 'track' },
    'replace',
  );
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(vlc.commands.slice(-2), ['pl_empty', `in_play=${MEDIA.covered.uri}`]);
  assert.deepEqual(
    vlc.playlist.map((item) => item.uri),
    [MEDIA.covered.uri],
  );
  const bad = await gladys.fake.musicPlay(device(), { id: 'vlc://quit', type: 'track' }, 'replace');
  assert.equal(bad.success, false, 'only media schemes');

  vlc.enqueue(MEDIA.tone1);
  vlc.enqueue(MEDIA.radio);
  const queue = await gladys.fake.musicQueueGet(device(), { offset: 0, limit: 50 });
  assert.equal(queue.success, true, queue.error);
  assert.deepEqual(validateMediaItems(queue.data.items), []);
  assert.equal(queue.data.total, 3);
  assert.equal(queue.data.current_index, 0);
  assert.deepEqual(
    queue.data.items.map((item) => item.type),
    ['track', 'track', 'radio'],
  );

  const jump = await gladys.fake.musicQueuePlay(device(), 1);
  assert.equal(jump.success, true, jump.error);
  assert.equal(vlc.current.uri, MEDIA.tone1.uri);
  assert.equal((await gladys.fake.musicQueuePlay(device(), 9)).success, false);
  await settle();
});

test('MediaItems: never a line lost, never a non-media file', () => {
  assert.equal(
    elementToItem({ type: 'file', name: 'cover.jpg', uri: 'file:///a/cover.jpg' }),
    null,
  );
  assert.equal(elementToItem({ type: 'dir', name: '..', uri: 'file:///' }), null);
  const long = `file:///${'a'.repeat(600)}.mp3`;
  assert.equal(leafToItem({ id: '7', uri: long, name: '' }).id, 'vlc-item:7');
  assert.equal(leafToItem({ id: '8', uri: 'file:///x/My%20Song.mp3' }).title, 'My Song.mp3');
  assert.equal(leafToItem({ id: '9', duration: -1 }).title, '#9');
});

test('volume: a percentage 0-100 for the Music box slider, VLC scale (256 = 100 %) inside', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  const { gladys, vlc } = world;
  const volume = gladys.fake.discoveredDevices[0].features.find(
    (f) => f.external_id === featureId('volume'),
  );
  assert.deepEqual([volume.min, volume.max, volume.unit], [0, 100, 'percent']);
  assert.equal((await gladys.fake.setValue(device(), feature('volume'), 50)).success, true);
  assert.equal(vlc.volume, 128);
  await until(() => stateOf(gladys, 'volume') === 50, 2000, '50 %');
  // VLC's own slider goes to 125 % (320): shown as 100.
  vlc.volume = 320;
  await until(() => stateOf(gladys, 'volume') === 100, 2000, 'capped');
});

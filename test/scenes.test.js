// -----------------------------------------------------------------------------
// The scene actions: play an address (three ways, optionally at a volume),
// empty the playlist; what they refuse.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEDIA, until } from './helpers/fakeVlc.js';
import { createAddedWorld, deviceId, stateOf } from './helpers/world.js';

test('play_url: add and play now (default), at a volume', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  const { gladys, vlc } = world;
  vlc.open(MEDIA.tone1);
  const ack = await gladys.fake.sceneAction('play_url', {
    device: deviceId(1),
    url: ` ${MEDIA.radio.uri} `,
    volume: 25,
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(vlc.commands, ['volume=64', `in_play=${MEDIA.radio.uri}`]);
  assert.equal(vlc.playlist.length, 2, 'added to what was there');
  await until(() => stateOf(gladys, 'artist') === 'Radio Synthetique', 2000, 'radio');
  assert.equal(stateOf(gladys, 'volume'), 25);
});

test('play_url: replace the playlist, or enqueue without playing', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  const { gladys, vlc } = world;
  vlc.open(MEDIA.tone1);
  vlc.enqueue(MEDIA.tone2);
  await gladys.fake.sceneAction('play_url', {
    device: deviceId(1),
    url: '/home/alice/Music/covered.mp3',
    mode: 'replace',
  });
  assert.deepEqual(vlc.commands, ['pl_empty', 'in_play=/home/alice/Music/covered.mp3']);
  assert.deepEqual(
    vlc.playlist.map((item) => item.uri),
    [MEDIA.covered.uri],
  );
  assert.equal(vlc.state, 'playing');

  await gladys.fake.sceneAction('play_url', {
    device: deviceId(1),
    url: MEDIA.untagged.uri,
    mode: 'enqueue',
  });
  assert.equal(vlc.current.uri, MEDIA.covered.uri, 'still playing the same');
  assert.equal(vlc.playlist.at(-1).uri, MEDIA.untagged.uri);
});

test('play_url refuses what is not a media, a volume out of range, an unknown VLC', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  const { gladys, vlc } = world;
  const run = (fields) => gladys.fake.sceneAction('play_url', { device: deviceId(1), ...fields });
  for (const url of ['vlc://quit', 'screen://', 'radio.example.com', '']) {
    const ack = await run({ url });
    assert.equal(ack.success, false, url);
    assert.match(ack.error, /Indiquez une adresse http\(s\)/);
  }
  const loud = await run({ url: MEDIA.radio.uri, volume: 150 });
  assert.match(loud.error, /entre 0 et 100/);
  const unknown = await gladys.fake.sceneAction('play_url', {
    device: deviceId(3),
    url: MEDIA.radio.uri,
  });
  assert.match(unknown.error, /plus configuré/);
  assert.deepEqual(vlc.commands, []);
  vlc.down = true;
  const closed = await run({ url: MEDIA.radio.uri });
  assert.match(closed.error, /VLC ne répond pas/);
});

test('clear_playlist empties the playlist and stops', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  const { gladys, vlc } = world;
  vlc.open(MEDIA.tone1);
  vlc.enqueue(MEDIA.tone2);
  const ack = await gladys.fake.sceneAction('clear_playlist', { device: deviceId(1) });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(vlc.commands, ['pl_empty']);
  assert.equal(vlc.playlist.length, 0);
  await until(() => stateOf(gladys, 'state') === 'Arrêté', 2000, 'stopped');
});

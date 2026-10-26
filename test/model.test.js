// -----------------------------------------------------------------------------
// status.json -> snapshot, on the answers recorded on VLC 3.0.20
// (test/fixtures/vlc/), and the playback events between two snapshots.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeItem,
  emptySnapshot,
  minutesLeftOf,
  playbackEvents,
  progressOf,
  readSnapshot,
  toVlcVolume,
  volumePercent,
} from '../src/vlc/model.js';
import { fixture } from './helpers/fakeVlc.js';

test('a file with tags: title, artist, album, position, length, item, volume', () => {
  const snapshot = readSnapshot(fixture('status-playing.json'));
  assert.deepEqual(snapshot, {
    state: 'playing',
    title: 'Test Tone 1',
    artist: 'Gladys Test Orchestra',
    album: 'Synthetic Album',
    itemId: 4,
    time: 2,
    length: 60,
    volumeRaw: 128,
    hasArt: false,
    random: false,
    loop: false,
    repeat: false,
  });
  assert.equal(volumePercent(snapshot), 50);
  assert.equal(progressOf(snapshot), 3);
  assert.equal(minutesLeftOf(snapshot), 1);
});

test('paused keeps the item and its tags', () => {
  const snapshot = readSnapshot(fixture('status-paused.json'));
  assert.equal(snapshot.state, 'paused');
  assert.equal(snapshot.title, 'Test Tone 1');
  assert.equal(snapshot.itemId, 4);
});

test('a web radio: the song from now_playing, the station as artist, no length', () => {
  const snapshot = readSnapshot(fixture('status-playing-radio.json'));
  assert.equal(snapshot.title, 'Gladys Test Orchestra - Live Tone');
  assert.equal(snapshot.artist, 'Radio Synthetique');
  assert.equal(snapshot.album, '');
  assert.equal(snapshot.length, null);
  assert.equal(progressOf(snapshot), 0);
  assert.equal(minutesLeftOf(snapshot), 0);
});

test('a file without tags or over http: the file name', () => {
  assert.equal(readSnapshot(fixture('status-playing-untagged.json')).title, 'untagged.wav');
  const http = readSnapshot(fixture('status-playing-http.json'));
  assert.equal(http.title, 'tone2.mp3');
  assert.equal(http.artist, '');
  assert.equal(describeItem({ filename: 'video.mp4?authSig=secret' }).title, 'video.mp4');
});

test('an item with a cover says so (VLC serves it at /art)', () => {
  assert.equal(readSnapshot(fixture('status-playing-cover.json')).hasArt, true);
  assert.equal(readSnapshot(fixture('status-playing.json')).hasArt, false);
});

test('stopped: no item, but the volume is known', () => {
  for (const name of [
    'status-fresh-start.json',
    'status-stopped-empty.json',
    'status-stopped-queued.json',
    'status-stopped-after.json',
  ]) {
    const snapshot = readSnapshot(fixture(name));
    assert.equal(snapshot.state, 'stopped', name);
    assert.equal(snapshot.itemId, null, name);
    assert.equal(snapshot.title, '', name);
    assert.equal(typeof snapshot.volumeRaw, 'number', name);
  }
  assert.equal(volumePercent(readSnapshot(fixture('status-fresh-start.json'))), 78);
});

test('odd answers: unknown state, missing fields, control characters, long tags', () => {
  const snapshot = readSnapshot({
    state: 'opening',
    volume: 'loud',
  });
  assert.equal(snapshot.state, 'stopped');
  assert.equal(snapshot.volumeRaw, null);
  assert.equal(volumePercent(snapshot), null);
  const tags = describeItem({ title: `A\u0000B\n  C${'x'.repeat(300)}`, artist: 42 });
  assert.equal(tags.title.length, 200);
  assert.ok(tags.title.startsWith('A B C'));
  assert.equal(tags.artist, '42');
  const noMeta = readSnapshot({ state: 'playing', currentplid: -1, time: -3, length: 0 });
  assert.equal(noMeta.itemId, null);
  assert.equal(noMeta.time, 0);
  assert.equal(noMeta.title, '');
});

test('volume: 256 is 100 %, VLC goes beyond, Gladys values are capped to 0-100', () => {
  assert.equal(toVlcVolume(100), 256);
  assert.equal(toVlcVolume(50), 128);
  assert.equal(toVlcVolume(0), 0);
  assert.equal(toVlcVolume(140), 256);
  assert.equal(toVlcVolume(-5), 0);
  assert.equal(volumePercent({ volumeRaw: 320 }), 125);
  assert.equal(volumePercent({ volumeRaw: 512 }), 200);
});

test('progress and time left at the end of an item', () => {
  const end = { ...readSnapshot(fixture('status-playing.json')), time: 60 };
  assert.equal(progressOf(end), 100);
  assert.equal(minutesLeftOf(end), 0);
  assert.equal(minutesLeftOf({ ...end, time: 0, length: 3600 }), 60);
  assert.equal(progressOf(emptySnapshot()), 0);
});

test('playback events between two snapshots', () => {
  const stopped = readSnapshot(fixture('status-stopped-empty.json'));
  const playing = readSnapshot(fixture('status-playing.json'));
  const paused = readSnapshot(fixture('status-paused.json'));
  const second = readSnapshot(fixture('status-playing-second.json'));
  const radio = readSnapshot(fixture('status-playing-radio.json'));
  const off = emptySnapshot('off');
  const types = (previous, next) => playbackEvents(previous, next).map((event) => event.type);

  assert.deepEqual(types(null, playing), [], 'first read: nothing');
  assert.deepEqual(types(stopped, playing), ['started']);
  assert.deepEqual(types(off, playing), ['started'], 'VLC opened with a file');
  assert.deepEqual(types(playing, { ...playing, time: 5 }), [], 'the position moves');
  assert.deepEqual(types(playing, second), ['started'], 'next item');
  assert.deepEqual(types(playing, paused), ['paused']);
  assert.deepEqual(types(paused, playing), ['resumed']);
  assert.deepEqual(types(paused, second), ['started'], 'next while paused');
  assert.deepEqual(types(paused, stopped), ['stopped']);
  assert.deepEqual(types(playing, stopped), ['stopped']);
  assert.deepEqual(types(playing, off), ['stopped'], 'VLC closed while playing');
  assert.deepEqual(types(stopped, off), []);
  assert.deepEqual(types(stopped, paused), []);
  assert.deepEqual(types(radio, { ...radio, title: 'Another song' }), [], 'same radio');

  // A stop describes what stopped.
  assert.equal(playbackEvents(playing, stopped)[0].snapshot.title, 'Test Tone 1');
});

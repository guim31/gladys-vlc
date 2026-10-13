import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loggableMrl, normalizeMrl } from '../src/vlc/mrl.js';

test('media addresses and absolute paths are let through', () => {
  for (const mrl of [
    'https://radio.example.com/live.mp3',
    'http://192.0.2.81:8000/stream',
    'rtsp://192.0.2.50:554/stream1',
    'udp://@239.0.0.1:1234',
    'smb://nas/music/song.flac',
    'file:///home/alice/Music/song.mp3',
    '/home/alice/Music/song with spaces.mp3',
    'C:\\Users\\alice\\Music\\song.mp3',
    'D:/Videos/film.mkv',
    '\\\\nas\\music\\song.mp3',
  ]) {
    assert.equal(normalizeMrl(`  ${mrl} `), mrl, mrl);
  }
});

test('anything else is refused: VLC commands, devices, junk', () => {
  for (const mrl of [
    '',
    '   ',
    null,
    42,
    'vlc://quit',
    'screen://',
    'dshow://',
    'v4l2:///dev/video0',
    'javascript:alert(1)',
    'radio.example.com/live.mp3',
    'music/song.mp3',
    'http://',
    'https://radio.example.com/\nlive.mp3',
    `https://radio.example.com/${'a'.repeat(2000)}`,
  ]) {
    assert.equal(normalizeMrl(mrl), null, String(mrl));
  }
});

test('a logged address has no credentials and no query string', () => {
  assert.equal(
    loggableMrl('https://user:secret@radio.example.com/live.mp3?token=abc#x'),
    'https://radio.example.com/live.mp3',
  );
  assert.equal(loggableMrl('/home/alice/song.mp3'), '/home/alice/song.mp3');
});

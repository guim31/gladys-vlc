// -----------------------------------------------------------------------------
// What the container writes at the default level (info): the lifecycle only.
// A normal session (reads, states, scene events) writes nothing; an outage
// writes one line when it starts and one when it ends, not one per attempt;
// no password of the configuration ever reaches a log, at any level.
// The SDK logger writes through console.log/console.error.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeVlc, MEDIA, settle, until } from './helpers/fakeVlc.js';
import { configFor, createAddedWorld, stateOf } from './helpers/world.js';

/** Capture the lines written from now on, at the given LOG_LEVEL. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const lines = [];
  const keep = (...args) => lines.push(args.map(String).join(' '));
  t.mock.method(console, 'log', keep);
  t.mock.method(console, 'error', keep);
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}

test('a normal session writes nothing at info', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  const { gladys, vlc } = world;
  const lines = captureLogs(t);

  vlc.open(MEDIA.covered);
  vlc.enqueue(MEDIA.tone1);
  await until(() => stateOf(gladys, 'state') === 'En lecture', 2000, 'playing');
  for (let i = 0; i < 5; i += 1) {
    vlc.advance(10);
    await settle(40); // several reads, new progress states
  }
  vlc.pause();
  await until(() => stateOf(gladys, 'state') === 'En pause', 2000, 'paused');
  vlc.resume();
  vlc.finish();
  await until(() => stateOf(gladys, 'title') === 'Test Tone 1', 2000, 'next item');
  vlc.stop();
  await until(() => stateOf(gladys, 'state') === 'Arrêté', 2000, 'stopped');
  await settle(100);

  assert.ok(gladys.fake.sceneEvents.length >= 4, 'scene events were fired');
  assert.deepEqual(lines, []);
});

test('VLC closed for a while: one line when it goes, one when it comes back', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  const { vlc, gladys } = world;
  const lines = captureLogs(t);

  vlc.down = true;
  await until(() => stateOf(gladys, 'state') === 'Éteint ou injoignable', 2000, 'off');
  for (const code of ['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH']) {
    vlc.downCode = code; // the reason varies from one attempt to the next
    await settle(100); // a few attempts, 40 ms apart
  }
  vlc.down = false;
  await until(() => stateOf(gladys, 'state') === 'Arrêté', 2000, 'back');
  await settle(100);

  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[0], /\[WARN\].*VLC 1: no answer from http:\/\/192\.0\.2\.30:8080/);
  assert.match(lines[1], /\[INFO\].*VLC 1 reachable again at http:\/\/192\.0\.2\.30:8080$/);
});

test('Gladys refusing the states: one line, then one when it accepts them again', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  const { gladys, vlc } = world;
  const lines = captureLogs(t);

  const publish = gladys.publishChangedStates;
  let refused = 0;
  gladys.publishChangedStates = async () => {
    refused += 1;
    throw new Error('Gladys unavailable');
  };
  vlc.open(MEDIA.tone1);
  for (let i = 0; i < 4; i += 1) {
    await settle(40);
    vlc.advance(10); // new progress states on the next read
  }
  assert.ok(refused >= 3, `${refused} publications refused`);
  gladys.publishChangedStates = publish;
  vlc.pause();
  await until(() => stateOf(gladys, 'state') === 'En pause', 2000, 'published again');
  await settle(60);

  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[0], /\[WARN\].*Cannot publish the states of VLC 1: Gladys unavailable/);
  assert.match(lines[1], /\[INFO\].*States published again/);
});

test('one line per user action, and no password at any level', async (t) => {
  const vlc = new FakeVlc({ password: 'Sup3r-s3cret!' });
  const lines = captureLogs(t, 'debug');
  const world = await createAddedWorld({ vlcs: [vlc], config: configFor([vlc]) });
  t.after(() => world.app.stop());
  const { gladys } = world;
  const device = { external_id: 'ext:test-integration:vlc:1' };
  const feature = (key) => ({ external_id: `${device.external_id}:${key}` });

  await gladys.fake.setValue(device, feature('volume'), 30);
  await gladys.fake.sceneAction('play_url', {
    device: device.external_id,
    url: 'https://listener:radio-pass@radio.example.com/live.mp3?token=abc',
    mode: 'play',
  });
  await gladys.fake.action('test_connection', {});
  vlc.password = 'wrong-one';
  await gladys.fake.setValue(device, feature('play'), 1);
  await settle(100);
  vlc.down = true;
  await settle(200);

  const all = lines.join('\n');
  assert.doesNotMatch(all, /Sup3r-s3cret!/);
  assert.doesNotMatch(all, /radio-pass|token=abc/);
  assert.doesNotMatch(all, new RegExp(Buffer.from(':Sup3r-s3cret!').toString('base64')));
  const info = lines.filter((line) => /\[INFO\]/.test(line) && !/gladys-sdk/.test(line));
  assert.ok(
    info.some((line) => /VLC 1: volume 30 %/.test(line)),
    all,
  );
  assert.ok(
    info.some((line) => /VLC 1: play https:\/\/radio\.example\.com\/live\.mp3$/.test(line)),
  );
  assert.ok(info.some((line) => /Connection test: VLC 1/.test(line)));
});

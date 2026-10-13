// -----------------------------------------------------------------------------
// The whole integration on the SDK's fake Gladys and fake VLC: the container
// reads VLC by itself (never through onPoll), publishes the changes, fires the
// scene triggers, runs the commands, plays the core's announcements.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FakeVlc, MEDIA, settle, until } from './helpers/fakeVlc.js';
import {
  configFor,
  createAddedWorld,
  createWorld,
  created,
  deviceId,
  featureId,
  stateOf,
} from './helpers/world.js';

const feature = (key, slot = 1) => ({ external_id: featureId(key, slot) });
const device = (slot = 1) => ({ external_id: deviceId(slot) });

test('the states refresh by themselves, without any onPoll', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  const { gladys, vlc } = world;
  const onPoll = t.mock.fn();
  gladys.onPoll(onPoll); // replaces the fallback: it must never be needed

  await until(() => stateOf(gladys, 'state') === 'Arrêté', 2000, 'stopped');
  vlc.open(MEDIA.tone1);
  await until(() => stateOf(gladys, 'title') === 'Test Tone 1', 2000, 'title');
  assert.equal(stateOf(gladys, 'playback_state'), 1);
  assert.equal(stateOf(gladys, 'state'), 'En lecture');
  assert.equal(stateOf(gladys, 'artist'), 'Gladys Test Orchestra');
  assert.equal(stateOf(gladys, 'album'), 'Synthetic Album');
  assert.equal(stateOf(gladys, 'volume'), 100);
  assert.equal(stateOf(gladys, 'time_left'), 1);

  vlc.advance(30);
  await until(() => stateOf(gladys, 'progress') === 50, 2000, 'progress');
  vlc.pause();
  await until(() => stateOf(gladys, 'state') === 'En pause', 2000, 'paused');
  assert.equal(stateOf(gladys, 'playback_state'), 0);
  vlc.stop();
  await until(() => stateOf(gladys, 'title') === 'Rien en lecture', 2000, 'stopped');
  assert.equal(stateOf(gladys, 'artist'), '—');
  assert.equal(stateOf(gladys, 'progress'), 0);
  assert.equal(onPoll.mock.callCount(), 0);
});

test('only the changes are published, and nothing for a device not added yet', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const { gladys, hub } = world;
  await until(() => hub.instances.get(1).vlc.known, 2000, 'first read');
  await settle(150); // several reads
  assert.equal(gladys.fake.states.length, 0, 'the device is not in Gladys yet');
  assert.equal(gladys.fake.discoveredDevices.length, 1, 'but it is in the Discovery tab');

  await gladys.fake.deviceCreated(created(gladys));
  await until(() => stateOf(gladys, 'state') === 'Arrêté', 2000, 'states after creation');
  const count = gladys.fake.states.length;
  await settle(150); // several reads of a VLC that does not change
  assert.equal(gladys.fake.states.length, count);
});

test('a stable value is sent again within 12 hours (heartbeat)', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const { gladys } = world;
  const publish = t.mock.method(gladys, 'publishChangedStates');
  await gladys.fake.deviceCreated(created(gladys));
  await until(() => publish.mock.callCount() > 0, 2000, 'states');
  for (const call of publish.mock.calls) {
    const { heartbeat } = call.arguments[1] ?? {};
    assert.ok(heartbeat > 0 && heartbeat <= 12 * 3600 * 1000, `heartbeat ${heartbeat}`);
  }
});

test('the pace: fast while added and playing, slow when not added', async (t) => {
  const world = await createWorld({
    timings: {
      activeInterval: 20,
      idleInterval: 40,
      unwatchedInterval: 400,
      offlineInterval: 400,
      afterCommand: 5,
    },
  });
  t.after(() => world.app.stop());
  const { vlc, hub, gladys } = world;
  await until(() => hub.instances.get(1).vlc.known, 2000, 'first read');
  const reads = () => vlc.requests.filter((r) => r.path === '/requests/status.json').length;
  let start = reads();
  await settle(200);
  assert.ok(reads() - start <= 2, `not added: ${reads() - start} reads in 200 ms`);

  await gladys.fake.deviceCreated(created(gladys));
  vlc.open(MEDIA.tone1);
  await settle(20);
  start = reads();
  await settle(200);
  assert.ok(reads() - start >= 5, `added and playing: ${reads() - start} reads in 200 ms`);
});

test('scene triggers: started, paused, resumed, next item, stopped', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  const { gladys, vlc } = world;
  const events = () => gladys.fake.sceneEvents.map((e) => e.key);

  vlc.enqueue(MEDIA.tone1);
  vlc.enqueue(MEDIA.tone2);
  vlc.open(MEDIA.radio);
  await until(() => events().length === 1, 2000, 'started');
  vlc.pause();
  await until(() => events().length === 2, 2000, 'paused');
  vlc.resume();
  await until(() => events().length === 3, 2000, 'resumed');
  vlc.stop();
  await until(() => events().length === 4, 2000, 'stopped');
  assert.deepEqual(events(), [
    'playback_started',
    'playback_paused',
    'playback_resumed',
    'playback_stopped',
  ]);
  const [started, , , stopped] = gladys.fake.sceneEvents;
  assert.deepEqual(started.data, {
    device: deviceId(1),
    vlc: 'VLC (192.0.2.30)',
    title: 'Gladys Test Orchestra - Live Tone',
    artist: 'Radio Synthetique',
    album: '—',
  });
  assert.equal(stopped.data.title, 'Gladys Test Orchestra - Live Tone', 'what stopped');

  // A web radio announcing its next song is not a new start.
  vlc.open(MEDIA.radio);
  await until(() => events().length === 5, 2000, 'radio again');
  vlc.current.meta = { ...vlc.current.meta, now_playing: 'Another artist - Another song' };
  await until(() => stateOf(gladys, 'title') === 'Another artist - Another song', 2000, 'song');
  assert.equal(events().length, 5, 'no event for a new song of the radio');
  // The playlist moves on: a start.
  vlc.enqueue(MEDIA.untagged);
  vlc.finish();
  await until(() => events().length === 6, 2000, 'next item');
  assert.equal(events()[5], 'playback_started');
  assert.equal(gladys.fake.sceneEvents[5].data.title, 'untagged.wav');
});

test('the first read after a restart fires nothing, the renamed device name is used', async (t) => {
  const vlc = new FakeVlc();
  vlc.open(MEDIA.tone1);
  const world = await createWorld({
    vlcs: [vlc],
    devices: [{ external_id: deviceId(1), name: 'Salon', features: [] }],
  });
  t.after(() => world.app.stop());
  await until(() => stateOf(world.gladys, 'title') === 'Test Tone 1', 2000, 'first states');
  await settle(60);
  assert.deepEqual(world.gladys.fake.sceneEvents, []);
  vlc.stop();
  await until(() => world.gladys.fake.sceneEvents.length === 1, 2000, 'stopped');
  assert.equal(world.gladys.fake.sceneEvents[0].data.vlc, 'Salon');
});

test('VLC closed: off after two missed answers, a stop event, then back', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  const { gladys, vlc, hub } = world;
  vlc.open(MEDIA.tone1);
  await until(() => stateOf(gladys, 'state') === 'En lecture', 2000, 'playing');
  vlc.down = true;
  await until(() => stateOf(gladys, 'state') === 'Éteint ou injoignable', 2000, 'off');
  assert.equal(hub.instances.get(1).vlc.failures >= 2, true);
  assert.deepEqual(
    gladys.fake.sceneEvents.map((e) => e.key),
    ['playback_started', 'playback_stopped'],
  );
  assert.equal(stateOf(gladys, 'playback_state'), 0);
  await until(() => gladys.fake.connectionStatus?.connected === false, 2000, 'status');
  assert.match(gladys.fake.connectionStatus.message.fr, /VLC 1 : pas de réponse/);

  vlc.down = false;
  await until(() => stateOf(gladys, 'state') === 'En lecture', 2000, 'back');
  await until(() => gladys.fake.connectionStatus?.connected === true, 2000, 'connected');
});

test('one missed answer is not a stop', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  const { gladys, vlc } = world;
  vlc.open(MEDIA.tone1);
  await until(() => stateOf(gladys, 'state') === 'En lecture', 2000, 'playing');
  const fetch = vlc.fetch.bind(vlc);
  let missed = 0;
  vlc.fetch = async (url, init) => {
    if (missed === 0) {
      missed += 1;
      throw new TypeError('fetch failed', { cause: { code: 'ETIMEDOUT' } });
    }
    return fetch(url, init);
  };
  await settle(150);
  assert.equal(missed, 1);
  assert.notEqual(stateOf(gladys, 'state'), 'Éteint ou injoignable');
  assert.deepEqual(
    gladys.fake.sceneEvents.map((e) => e.key),
    ['playback_started'],
  );
});

test('device commands: buttons, volume, mute', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  const { gladys, vlc } = world;
  const set = (key, value) => gladys.fake.setValue(device(), feature(key), value);
  vlc.enqueue(MEDIA.tone1);
  vlc.enqueue(MEDIA.tone2);

  assert.equal((await set('play', 1)).success, true);
  assert.equal(vlc.state, 'playing');
  assert.equal((await set('play', 1)).success, true, 'play while playing: nothing');
  assert.equal((await set('pause', 1)).success, true);
  assert.equal(vlc.state, 'paused');
  assert.equal((await set('pause', 1)).success, true, 'pause while paused: still paused');
  assert.equal(vlc.state, 'paused');
  await set('play', 1);
  assert.equal(vlc.state, 'playing', 'play resumes');
  await set('next', 1);
  assert.equal(vlc.current.uri, MEDIA.tone2.uri);
  await set('previous', 1);
  assert.equal(vlc.current.uri, MEDIA.tone1.uri);
  await set('stop', 1);
  assert.equal(vlc.state, 'stopped');
  assert.deepEqual(vlc.commands, [
    'pl_play',
    'pl_forcepause',
    'pl_forcepause',
    'pl_forceresume',
    'pl_next',
    'pl_previous',
    'pl_stop',
  ]);

  assert.equal((await set('volume', 40)).success, true);
  assert.equal(vlc.volume, 102);
  await until(() => stateOf(gladys, 'volume') === 40, 2000, 'volume read back');
  assert.equal((await set('volume', 140)).success, false, 'out of range');
  assert.equal(vlc.volume, 102);

  // Mute: VLC's web interface has no mute state, the volume goes to 0 and back.
  await set('mute', 1);
  assert.equal(vlc.volume, 0);
  await until(() => stateOf(gladys, 'volume') === 0, 2000, 'muted');
  await set('mute', 1);
  assert.equal(vlc.volume, 102);

  // A volume above 100 % in VLC (its slider goes to 125 %) shows as 100.
  vlc.volume = 320;
  await until(() => stateOf(gladys, 'volume') === 100, 2000, 'capped');

  const ack = await gladys.fake.setValue(device(), feature('title'), 'x');
  assert.equal(ack.success, false, 'a read-only feature');
  const unknown = await gladys.fake.setValue(device(7), feature('play', 7), 1);
  assert.match(unknown.error, /plus configuré/);
});

test('mute survives a restart of the integration (/data)', async (t) => {
  const vlc = new FakeVlc({ volume: 200 });
  const first = await createAddedWorld({ vlcs: [vlc] });
  await first.gladys.fake.setValue(device(), feature('mute'), 1);
  assert.equal(vlc.volume, 0);
  await first.app.stop();
  const saved = JSON.parse(await readFile(join(first.dataDir, 'vlc-state.json'), 'utf8'));
  assert.deepEqual(saved, { mute: { 1: { url: 'http://192.0.2.30:8080', volume: 200 } } });

  const second = await createAddedWorld({ vlcs: [vlc], dataDir: first.dataDir });
  t.after(() => second.app.stop());
  await second.gladys.fake.setValue(device(), feature('mute'), 1);
  assert.equal(vlc.volume, 200);
  // Turned down to 0 in VLC's window, then unmuted: no saved volume, 50 %.
  vlc.volume = 0;
  await second.gladys.fake.setValue(device(), feature('mute'), 1);
  assert.equal(vlc.volume, 128);
});

test('VLC refusing the password, closed or not VLC: the command says why', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  const { gladys, vlc } = world;
  vlc.down = true;
  let ack = await gladys.fake.setValue(device(), feature('play'), 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /VLC ne répond pas/);
  vlc.down = false;
  vlc.password = 'changed';
  ack = await gladys.fake.setValue(device(), feature('play'), 1);
  assert.match(ack.error, /mot de passe/);
  await until(() => gladys.fake.connectionStatus?.connected === false, 2000, 'status');
  assert.match(gladys.fake.connectionStatus.message.en, /VLC 1: password refused/);
});

test('announcement: the core notification plays, then what played comes back', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  const { gladys, vlc, hub } = world;
  vlc.enqueue(MEDIA.tone1);
  vlc.open(MEDIA.tone2);
  vlc.advance(42);
  await until(() => stateOf(gladys, 'title') === 'Test Tone 2', 2000, 'playing');
  const before = vlc.currentId;
  const eventsBefore = gladys.fake.sceneEvents.length;

  const ack = await gladys.fake.setValue(device(), feature('notification'), MEDIA.announcement.uri);
  assert.equal(ack.success, true, ack.error);
  assert.equal(vlc.current.uri, MEDIA.announcement.uri);
  await until(() => stateOf(gladys, 'title') === 'announcement.mp3', 2000, 'announcing');
  vlc.finish(); // the last item: VLC stops
  await until(() => vlc.state === 'playing' && vlc.currentId === before, 2000, 'resumed');
  assert.equal(vlc.time, 42, 'the file goes on where it was');
  assert.ok(!vlc.playlist.some((item) => item.uri === MEDIA.announcement.uri), 'removed');
  await until(() => stateOf(gladys, 'title') === 'Test Tone 2', 2000, 'title back');
  await until(() => !hub.instances.get(1).vlc.hold, 2000, 'hold released');
  await settle(60);
  assert.equal(gladys.fake.sceneEvents.length, eventsBefore, 'no trigger for an announcement');
  assert.deepEqual(vlc.commands.slice(-4), [
    'in_play=https://gladys.example.com/tts/announcement.mp3',
    'pl_delete=5',
    `pl_play=${before}`,
    'seek=42',
  ]);
});

test('two announcements in a row: both removed, the music comes back once', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  const { gladys, vlc, hub } = world;
  vlc.open(MEDIA.radio);
  await until(() => stateOf(gladys, 'artist') === 'Radio Synthetique', 2000, 'radio');
  const radio = vlc.currentId;
  const events = gladys.fake.sceneEvents.length;
  await gladys.fake.setValue(device(), feature('notification'), MEDIA.announcement.uri);
  await until(() => stateOf(gladys, 'title') === 'announcement.mp3', 2000, 'first');
  await gladys.fake.setValue(device(), feature('notification'), 'https://gladys.example.com/b.mp3');
  await until(() => stateOf(gladys, 'title') === 'b.mp3', 2000, 'second');
  vlc.finish();
  await until(() => vlc.state === 'playing' && vlc.currentId === radio, 2000, 'radio back');
  await until(() => !hub.instances.get(1).vlc.hold, 2000, 'released');
  assert.deepEqual(
    vlc.playlist.map((item) => item.uri),
    [MEDIA.radio.uri],
  );
  assert.equal(gladys.fake.sceneEvents.length, events);
  assert.ok(!vlc.commands.some((c) => c.startsWith('seek')), 'a live stream is not sought');
});

test('announcement while stopped or paused: nothing comes back, a bad address is refused', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  const { gladys, vlc, hub } = world;
  await gladys.fake.setValue(device(), feature('notification'), MEDIA.announcement.uri);
  vlc.finish();
  await until(() => !hub.instances.get(1).vlc.hold, 2000, 'done');
  assert.equal(vlc.state, 'stopped');
  assert.equal(vlc.playlist.length, 0);

  const ack = await gladys.fake.setValue(device(), feature('notification'), 'vlc://quit');
  assert.equal(ack.success, false);
  assert.match(ack.error, /http\(s\)/);
  assert.ok(!vlc.commands.some((c) => c.includes('vlc://quit')));

  // An address VLC cannot open: VLC stays stopped, the announcement is given up.
  await gladys.fake.setValue(device(), feature('notification'), 'https://gladys.example.com/x.mp3');
  vlc.stop();
  await until(() => !hub.instances.get(1).vlc.announcing, 2000, 'given up');
  await until(() => !hub.instances.get(1).vlc.hold, 2000, 'released');
});

test('a new configuration: new address, new language, removed VLC', async (t) => {
  const one = new FakeVlc();
  const two = new FakeVlc({ host: '192.0.2.31', port: 9090 });
  const world = await createAddedWorld({ vlcs: [one, two] });
  t.after(() => world.app.stop());
  const { gladys } = world;
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.name),
    ['VLC (192.0.2.30)', 'VLC (192.0.2.31)'],
  );
  assert.deepEqual(gladys.fake.discoveredDevices[1].params, [
    { name: 'VLC_URL', value: 'http://192.0.2.31:9090' },
  ]);
  await until(() => stateOf(gladys, 'state') === 'Arrêté', 2000, 'french');
  await gladys.fake.configUpdated({ ...configFor([one, two]), language: 'en' });
  await until(() => stateOf(gladys, 'state') === 'Stopped', 2000, 'english');
  assert.equal(gladys.fake.discoveredDevices[0].features[0].name, 'Playing');

  await gladys.fake.configUpdated({ host_1: one.address, password_1: one.password });
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.external_id),
    [deviceId(1)],
  );
  await gladys.fake.configUpdated({ host_1: 'localhost' });
  assert.deepEqual(gladys.fake.discoveredDevices, []);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /not localhost/);
});

test('no VLC configured: a status that says what to do', async (t) => {
  const world = await createWorld({ config: {} });
  t.after(() => world.app.stop());
  assert.deepEqual(world.gladys.fake.connectionStatus, {
    connected: false,
    message: {
      en: 'Type the address of a VLC to start.',
      fr: "Saisissez l'adresse d'un VLC pour commencer.",
      de: 'Gib die Adresse eines VLC ein, um zu beginnen.',
      es: 'Introduzca la dirección de un VLC para empezar.',
    },
  });
});

test('something else than VLC on that port', async (t) => {
  const vlc = new FakeVlc();
  vlc.impostor = true;
  const world = await createWorld({ vlcs: [vlc] });
  t.after(() => world.app.stop());
  await until(() => world.gladys.fake.connectionStatus !== undefined, 2000, 'status');
  assert.match(world.gladys.fake.connectionStatus.message.en, /does not answer like VLC/);
  const report = await world.gladys.fake.action('test_connection', {});
  assert.match(report.data?.message?.en ?? report.data?.en ?? JSON.stringify(report), /like VLC/);
});

test('"Test the connection" reports each VLC', async (t) => {
  const one = new FakeVlc();
  one.open(MEDIA.tone1);
  const two = new FakeVlc({ host: '192.0.2.31' });
  two.down = true;
  const world = await createWorld({ vlcs: [one, two] });
  t.after(() => world.app.stop());
  const ack = await world.gladys.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  const message = ack.data?.message ?? ack.data;
  assert.equal(
    message.en,
    'VLC 1 (VLC (192.0.2.30)): connected, VLC 3.0.20 Vetinari, playing. ' +
      'VLC 2: no answer. Is VLC open, with its web interface on?',
  );
  assert.match(message.fr, /VLC 1 \(VLC \(192\.0\.2\.30\)\) : connecté/);
});

test('the onPoll fallback reads VLC when a core polls anyway', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  const reads = world.vlc.requests.length;
  const ack = await world.gladys.fake.poll(created(world.gladys));
  assert.equal(ack.success, true);
  assert.ok(world.vlc.requests.length > reads);
});

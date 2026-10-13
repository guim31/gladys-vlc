// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, LANGUAGES, SLOTS, hostKey, passwordKey } from '../src/config.js';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { DEFAULT_PLAY_MODE, PLAY_MODES, SCENE_ACTIONS } from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';
import { MEDIA, until } from './helpers/fakeVlc.js';
import { createAddedWorld, createWorld, created, deviceId } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const optionsOf = (field) => field.options.map((option) => option.value);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('identity: name, image, local transport, multimedia category, no discovery', () => {
  assert.equal(manifest.name, 'VLC');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-vlc:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-vlc/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['multimedia']);
  // VLC's web interface announces itself on no protocol the core can browse.
  assert.equal(manifest.network_discovery, undefined);
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    `docker_image must be tagged :${manifest.version}, got "${manifest.docker_image}"`,
  );
});

test('scene triggers, scene actions and widgets require Gladys >= 5.1.0', () => {
  assert.ok(isAtLeast(minGladysVersion(), [5, 1, 0]), manifest.gladys_version);
  // No widget button opens a form: 5.2.0 is not needed.
  assert.ok(!isAtLeast(minGladysVersion(), [5, 2, 0]), 'keep 5.1 users');
  for (const widget of manifest.widgets) {
    assert.equal(JSON.stringify(widget).includes('"fields"'), false, widget.key);
  }
});

test('config_schema: three VLC slots, the defaults and options of the code', () => {
  const field = (key) => manifest.config_schema.find((f) => f.key === key);
  for (const slot of SLOTS) {
    assert.equal(field(hostKey(slot)).type, 'string');
    assert.equal(field(passwordKey(slot)).type, 'secret');
    for (const key of [hostKey(slot), passwordKey(slot)]) {
      assert.equal(field(key).required, false, key);
    }
  }
  for (const entry of manifest.config_schema) {
    if (entry.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[entry.key], entry.default, `default of ${entry.key}`);
    }
  }
  const keys = manifest.config_schema.filter((f) => f.type !== 'section').map((f) => f.key);
  assert.deepEqual(Object.keys(DEFAULT_CONFIG).sort(), keys.sort());
  const languages = field('language');
  assert.deepEqual(optionsOf(languages), LANGUAGES);
  assert.equal(languages.default, 'fr');
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('every manifest action, scene action and widget has a handler, and vice versa', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const fake = world.gladys.fake;
  assert.match((await fake.action('nope')).error, /not implemented/i);
  for (const action of manifest.actions) {
    const ack = await fake.action(action.key, {});
    assert.equal(ack.success, true, `action ${action.key}: ${ack.error}`);
  }
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  for (const action of manifest.scene_actions) {
    const ack = await fake.sceneAction(action.key, {
      device: 'unknown',
      url: 'https://radio.example.com/live.mp3',
    });
    assert.doesNotMatch(ack.error ?? '', /not implemented/i, action.key);
  }
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(Object.keys(WIDGETS), [WIDGET_KEY]);
  assert.equal((await fake.widgetGet(WIDGET_KEY, { settings: {} })).success, true);
});

test('scene action fields are the ones the code reads; no output is declared', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  const action = (key) => manifest.scene_actions.find((a) => a.key === key);
  const field = (key, name) => action(key).fields.find((f) => f.key === name);
  assert.deepEqual(optionsOf(field('play_url', 'mode')), PLAY_MODES);
  assert.equal(field('play_url', 'mode').default, DEFAULT_PLAY_MODE);
  assert.equal(field('play_url', 'volume').min, 0);
  assert.equal(field('play_url', 'volume').max, 100);
  assert.equal(field('play_url', 'volume').required, false);
  assert.equal(field('play_url', 'url').type, 'string');

  const fields = {
    device: deviceId(1),
    url: MEDIA.radio.uri,
    mode: 'play',
    volume: 20,
  };
  for (const entry of manifest.scene_actions) {
    for (const declared of entry.fields) {
      assert.ok(declared.key in fields, `${entry.key}.${declared.key} is exercised`);
      if (declared.key === 'device') {
        assert.equal(declared.source, 'devices');
        assert.equal(declared.required, true);
      }
    }
    assert.equal(entry.outputs, undefined, entry.key);
    const ack = await world.gladys.fake.sceneAction(entry.key, fields);
    assert.equal(ack.success, true, `${entry.key}: ${ack.error}`);
  }
});

test('the scene triggers the hub fires are declared, with their filters and variables', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  const { vlc } = world;
  const count = () => world.gladys.fake.sceneEvents.length;
  vlc.open(MEDIA.tone1);
  await until(() => count() === 1, 2000, 'started');
  vlc.pause();
  await until(() => count() === 2, 2000, 'paused');
  vlc.resume();
  await until(() => count() === 3, 2000, 'resumed');
  vlc.stop();
  await until(() => count() === 4, 2000, 'stopped');
  const events = world.gladys.fake.sceneEvents;
  for (const trigger of manifest.scene_triggers) {
    const event = events.find((e) => e.key === trigger.key);
    assert.ok(event, `${trigger.key} fired`);
    for (const key of [...keysOf(trigger.fields), ...keysOf(trigger.variables)]) {
      assert.ok(key in event.data, `${trigger.key}: "${key}" is in the event data`);
    }
    for (const variable of trigger.variables) {
      assert.equal(variable.type, 'string', variable.key);
      assert.equal(typeof event.data[variable.key], 'string', variable.key);
    }
    assert.deepEqual(keysOf(trigger.fields), ['device']);
    assert.equal(trigger.fields[0].source, 'devices');
  }
  assert.equal(events[0].data.device, deviceId(1));
});

test('the widget settings: one VLC, chosen among the devices', () => {
  assert.deepEqual(manifest.widgets[0].settings, [
    {
      key: 'device',
      type: 'select',
      source: 'devices',
      label: { en: 'VLC', fr: 'VLC', de: 'VLC', es: 'VLC' },
      required: true,
    },
  ]);
});

test('dynamic selects declare a source and no static options', () => {
  const dynamicSelects = allFields.filter((f) => f.source !== undefined);
  assert.ok(dynamicSelects.length > 0);
  for (const field of dynamicSelects) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, `field "${field.key}": source and options together`);
  }
});

test('number fields have integer bounds and defaults (the form has no step)', () => {
  for (const field of allFields.filter((f) => f.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      if (field[key] !== undefined) {
        assert.ok(Number.isInteger(field[key]), `field "${field.key}".${key} must be an integer`);
      }
    }
  }
});

test('actions declare no secret field, no required field (Gladys#3154/#3155)', () => {
  for (const action of manifest.actions ?? []) {
    for (const field of action.fields ?? []) {
      assert.notEqual(field.type, 'secret', `${action.key}.${field.key}`);
      assert.notEqual(field.required, true, `${action.key}.${field.key}`);
    }
  }
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});

test('the device: 15 features, keys frozen, published without core polling', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const device = created(world.gladys);
  assert.equal(device.should_poll, false);
  assert.equal(device.poll_frequency, undefined);
  assert.deepEqual(
    device.features.map((f) => f.external_id.split(':').at(-1)),
    [
      'playback_state',
      'state',
      'title',
      'artist',
      'album',
      'progress',
      'time_left',
      'volume',
      'play',
      'pause',
      'stop',
      'previous',
      'next',
      'mute',
      'notification',
    ],
  );
  assert.deepEqual(
    device.features.filter((f) => !f.read_only).map((f) => `${f.category}/${f.type}`),
    [
      'music/volume',
      'music/play',
      'music/pause',
      'television/stop',
      'music/previous',
      'music/next',
      'television/volume-mute',
      'music/play_notification',
    ],
  );
});

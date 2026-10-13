// -----------------------------------------------------------------------------
// The "VLC player" widget: its content in every state, within the core's
// vocabulary and budget (validateWidgetContent of the SDK), its live tiles
// bound to features that exist, its artwork and its buttons.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { ART, MEDIA, settle, until } from './helpers/fakeVlc.js';
import { createAddedWorld, createWorld, created, deviceId } from './helpers/world.js';
import { WIDGET_KEY } from '../src/widgets.js';

const settings = { device: deviceId(1) };

async function content(world, language = 'fr') {
  const ack = await world.gladys.fake.widgetGet(WIDGET_KEY, { settings, language });
  assert.equal(ack.success, true, ack.error);
  const result = ack.data?.content ?? ack.data;
  assert.deepEqual(validateWidgetContent(result), [], JSON.stringify(result));
  // A live tile points at a feature of the device.
  const ids = new Set(created(world.gladys).features.map((f) => f.external_id));
  for (const component of result.components) {
    if (component.device_feature) {
      assert.ok(ids.has(component.device_feature), component.device_feature);
    }
  }
  return result;
}

const types = (result) => result.components.map((c) => c.type);
const buttons = (result) =>
  result.components.filter((c) => c.type === 'button').map((c) => c.action.key);
const status = (result) =>
  Object.fromEntries(
    result.components.find((c) => c.type === 'status').items.map((i) => [i.label, i.value]),
  );

test('playing a file with a cover: artwork, title, artist, state, position, volume, 4 buttons', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  world.vlc.open(MEDIA.covered);
  world.vlc.advance(83);
  await until(() => world.hub.artworkKey(world.hub.instances.get(1)), 2000, 'artwork');
  const result = await content(world);
  assert.deepEqual(types(result), [
    'image',
    'text',
    'text',
    'status',
    'button',
    'button',
    'button',
    'button',
  ]);
  assert.equal(result.components[1].text, 'Covered Tone');
  assert.equal(
    result.components[2].text,
    'Gladys Test Orchestra · Album With Cover · VLC (192.0.2.30)',
  );
  assert.deepEqual(status(result), {
    État: 'En lecture',
    Position: '1:23 / 1:30',
    Volume: '100 %',
  });
  assert.deepEqual(buttons(result), ['play_pause', 'next', 'volume_down', 'volume_up']);
  assert.equal(result.components[4].icon, 'pause');
  assert.equal(result.ttl_seconds, 15);

  // The artwork, by its key.
  const image = await world.gladys.fake.widgetGetImage(result.components[0].key);
  assert.equal(image.success, true);
  assert.equal(image.data?.image ?? image.data, ART.toString('base64'));
});

test('the artwork VLC finds a moment after the start is asked again', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  world.vlc.artMisses = 2;
  world.vlc.open(MEDIA.covered);
  await until(() => world.hub.artworkKey(world.hub.instances.get(1)), 2000, 'artwork');
  const result = await content(world);
  assert.equal(result.components[0].type, 'image');
  const asked = world.vlc.requests.filter((r) => r.path === '/art').length;
  assert.equal(asked, 3);
  await settle(100);
  assert.equal(world.vlc.requests.filter((r) => r.path === '/art').length, 3, 'once found, kept');
});

test('a radio without artwork, a file with a length: the gauge of the device', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  world.vlc.open(MEDIA.radio);
  await settle(80);
  let result = await content(world, 'en');
  assert.deepEqual(types(result).slice(0, 3), ['text', 'text', 'status']);
  assert.equal(result.components[0].text, 'Gladys Test Orchestra - Live Tone');
  assert.equal(status(result).Position, '0:00');

  world.vlc.open(MEDIA.tone1);
  await settle(80);
  result = await content(world, 'en');
  assert.equal(result.components[0].type, 'gauge');
  assert.equal(result.components[0].device_feature, `${deviceId(1)}:progress`);
});

test('stopped, paused, muted, closed', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  const { vlc } = world;
  let result = await content(world, 'de');
  assert.equal(result.components[0].text, 'Nichts läuft');
  assert.deepEqual(buttons(result), ['play_pause', 'volume_down', 'volume_up']);
  assert.equal(result.components.find((c) => c.type === 'button').icon, 'play');
  assert.equal(result.ttl_seconds, 120);

  vlc.open(MEDIA.untagged);
  vlc.pause();
  vlc.volume = 0;
  await settle(80);
  result = await content(world, 'es');
  assert.equal(result.components[1].text, 'untagged.wav');
  assert.deepEqual(status(result), {
    Estado: 'En pausa',
    Posición: '0:00 / 0:30',
    Volumen: '0 % (silenciado)',
  });

  vlc.down = true;
  await until(() => world.hub.instances.get(1).vlc.snapshot.state === 'off', 2000, 'off');
  result = await content(world, 'en');
  assert.equal(result.components[0].text, 'Off or unreachable');
  assert.deepEqual(buttons(result), []);
});

test('a long title is cut in the heading and given whole in the caption', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  const long = 'A very long title that goes well beyond forty characters';
  world.vlc.open(`/home/alice/Music/${long}.mp3`);
  await settle(80);
  const result = await content(world, 'en');
  assert.equal(result.components[0].text, `${long}.mp3`.slice(0, 40));
  assert.match(result.components[1].text, /^A very long title that goes well beyond forty/);
});

test('no device chosen, or a device removed from the configuration', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  let ack = await world.gladys.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'fr' });
  assert.deepEqual(validateWidgetContent(ack.data?.content ?? ack.data), []);
  assert.match(JSON.stringify(ack.data), /Choisissez un VLC/);
  ack = await world.gladys.fake.widgetGet(WIDGET_KEY, {
    settings: { device: deviceId(2) },
    language: 'en',
  });
  assert.match(JSON.stringify(ack.data), /not configured in the integration anymore/);
});

test('the buttons: play/pause, next, volume steps of 5 % within 0-100', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  const { vlc, gladys } = world;
  const press = (key) => gladys.fake.widgetAction(WIDGET_KEY, key, {}, { settings });
  vlc.enqueue(MEDIA.tone1);
  vlc.enqueue(MEDIA.tone2);
  vlc.volume = 128;
  await settle(60);

  let ack = await press('play_pause');
  assert.equal(ack.success, true);
  assert.equal(vlc.state, 'playing');
  assert.equal((ack.data?.message ?? ack.data).fr, 'Lecture / pause envoyée à VLC.');
  await press('next');
  assert.equal(vlc.current.uri, MEDIA.tone2.uri);
  await press('volume_up');
  assert.equal(vlc.volume, 141); // 55 %
  await until(() => world.hub.instances.get(1).vlc.snapshot.volumeRaw === 141, 2000, 'read');
  await press('volume_down');
  assert.equal(vlc.volume, 128);

  vlc.volume = 320; // 125 % set in VLC's window
  await until(() => world.hub.instances.get(1).vlc.snapshot.volumeRaw === 320, 2000, 'read');
  await press('volume_up');
  assert.equal(vlc.volume, 256, 'capped at 100 %');

  vlc.down = true;
  ack = await press('play_pause');
  assert.equal(ack.success, true, 'the toast says why');
  assert.match((ack.data?.message ?? ack.data).en, /VLC does not answer/);
  ack = await press('unknown');
  assert.equal(ack.success, false);
});

test('a playback change nudges the open dashboards, within the core rate limit', async (t) => {
  const world = await createAddedWorld();
  t.after(() => world.app.stop());
  const before = world.gladys.fake.widgetRefreshes.length;
  world.vlc.open(MEDIA.tone1);
  await until(() => world.gladys.fake.widgetRefreshes.length > before, 12_000, 'nudge');
  assert.ok(
    world.gladys.fake.widgetRefreshes.every((r) => r === WIDGET_KEY || r.key === WIDGET_KEY),
  );
});

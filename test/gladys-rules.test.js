// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures (answers recorded on VLC 3.0.20): three VLC at once — one playing a
// tagged file, one playing a web radio on another port, one closed — in every
// feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FakeVlc, MEDIA, until } from './helpers/fakeVlc.js';
import { configFor, createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

function threeVlc() {
  const living = new FakeVlc({ host: '192.0.2.30' });
  living.open(MEDIA.covered);
  const kitchen = new FakeVlc({ host: '192.0.2.31', port: 9090, password: 'other' });
  kitchen.open(MEDIA.radio);
  const office = new FakeVlc({ host: '192.0.2.32' });
  office.down = true;
  return [living, kitchen, office];
}

const scenarios = [
  { label: 'default language (French)', language: undefined },
  { label: 'English names', language: 'en' },
  { label: 'German names', language: 'de' },
  { label: 'Spanish names', language: 'es' },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const vlcs = threeVlc();
    const { gladys, app, hub } = await createWorld({
      vlcs,
      config: configFor(vlcs, scenario.language ? { language: scenario.language } : {}),
    });
    try {
      await until(() => [...hub.instances.values()].every((e) => e.vlc.known), 2000, 'reads');
      const devices = gladys.fake.discoveredDevices;
      assert.equal(devices.length, 3, 'one device per VLC');

      for (const device of devices) {
        const where = device.name;

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
            const allowed = table.units_by_category[feature.category];
            if (allowed) {
              assert.ok(allowed.includes(feature.unit), `${at}: ${feature.unit} on its category`);
            }
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
        }
      }
      const allIds = devices.flatMap((d) => [
        d.external_id,
        ...d.features.map((f) => f.external_id),
      ]);
      assert.equal(new Set(allIds).size, allIds.length, 'external ids unique across devices');
    } finally {
      await app.stop();
    }
  });
}

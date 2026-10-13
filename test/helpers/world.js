// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys (a real GladysIntegration on an
// in-memory transport), the integration wired on it by registerHandlers, and
// fake VLC instances on a fake network. Store under a temporary folder.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { FakeVlc, network, settle, until } from './fakeVlc.js';

export const FAST_TIMINGS = {
  activeInterval: 30,
  idleInterval: 30,
  unwatchedInterval: 60,
  offlineInterval: 40,
  announceInterval: 10,
  afterCommand: 5,
  announceStart: 300,
  announceMax: 5_000,
  resumeGrace: 300,
};

/** The configuration of the given fake VLC instances, slot by slot. */
export function configFor(vlcs, extra = {}) {
  return {
    ...Object.fromEntries(
      vlcs.flatMap((vlc, index) => [
        [`host_${index + 1}`, vlc.address],
        [`password_${index + 1}`, vlc.password],
      ]),
    ),
    ...extra,
  };
}

export const deviceId = (slot = 1) => `ext:test-integration:vlc:${slot}`;
export const featureId = (key, slot = 1) => `${deviceId(slot)}:${key}`;

/**
 * @param {object} [options]
 * @param {FakeVlc[]} [options.vlcs] fake instances (default: one)
 * @param {object} [options.config] integration config (default: slot 1 on the first instance)
 * @param {object[]} [options.devices] devices already created in Gladys
 */
export async function createWorld({
  vlcs,
  config,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'vlc-test-')),
  timings = FAST_TIMINGS,
  now,
} = {}) {
  const servers = vlcs ?? [new FakeVlc()];
  const gladys = createFakeGladys({ config: config ?? configFor(servers), devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    fetch: network(...servers),
    timings,
    now,
  });
  if (connect) {
    await gladys.connect();
    await settle(10);
  }
  return { gladys, app, hub: app.hub, vlcs: servers, vlc: servers[0], dataDir };
}

/** The device as Gladys stores it once the user added it (with its features). */
export function created(gladys, slot = 1) {
  const device = gladys.fake.discoveredDevices.find((d) => d.external_id === deviceId(slot));
  return { ...device, features: device.features.map((f) => ({ ...f })) };
}

/** A world whose VLC device the user added, after the first read. */
export async function createAddedWorld(options) {
  const world = await createWorld(options);
  await until(() => world.hub.instances.get(1)?.vlc.known, 2000, 'first read');
  await world.gladys.fake.deviceCreated(created(world.gladys));
  await settle();
  return world;
}

/** The last state Gladys received for a feature of slot 1. */
export const stateOf = (gladys, key, slot = 1) => gladys.fake.lastState(featureId(key, slot));

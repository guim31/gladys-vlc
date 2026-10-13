import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeAddress, normalizeConfig } from '../src/config.js';

test('an address: IP, host name, port, full URL', () => {
  assert.deepEqual(normalizeAddress('192.0.2.30'), {
    host: '192.0.2.30',
    url: 'http://192.0.2.30:8080',
  });
  assert.deepEqual(normalizeAddress(' 192.0.2.30:9090 '), {
    host: '192.0.2.30',
    url: 'http://192.0.2.30:9090',
  });
  assert.deepEqual(normalizeAddress('kitchen.lan'), {
    host: 'kitchen.lan',
    url: 'http://kitchen.lan:8080',
  });
  assert.deepEqual(normalizeAddress('http://192.0.2.30:8080/'), {
    host: '192.0.2.30',
    url: 'http://192.0.2.30:8080',
  });
  assert.deepEqual(normalizeAddress('http://192.0.2.30:8080/requests/status.json'), {
    host: '192.0.2.30',
    url: 'http://192.0.2.30:8080',
  });
  assert.deepEqual(normalizeAddress('https://vlc.example.com'), {
    host: 'vlc.example.com',
    url: 'https://vlc.example.com',
  });
  assert.equal(normalizeAddress('[2001:db8::30]:8080').url, 'http://[2001:db8::30]:8080');
});

test('an address that cannot work is reported, not used', () => {
  assert.equal(normalizeAddress(''), null);
  assert.equal(normalizeAddress(undefined), null);
  for (const raw of [
    'http://user:pass@192.0.2.30',
    'ftp://192.0.2.30',
    'http://192.0.2.30/x',
    'a b',
  ]) {
    assert.deepEqual(normalizeAddress(raw), { error: 'invalid' }, raw);
  }
  for (const raw of ['localhost', '127.0.0.1:8080', 'http://localhost:8080', '0.0.0.0']) {
    assert.deepEqual(normalizeAddress(raw), { error: 'loopback' }, raw);
  }
});

test('the configuration: slots, passwords kept as typed, language', () => {
  const config = normalizeConfig({
    host_1: '192.0.2.30',
    password_1: ' with spaces ',
    host_2: '',
    host_3: 'localhost',
    password_3: 'x',
    language: 'de',
  });
  assert.deepEqual(config, {
    instances: [
      { slot: 1, host: '192.0.2.30', url: 'http://192.0.2.30:8080', password: ' with spaces ' },
    ],
    invalidSlots: [{ slot: 3, error: 'loopback' }],
    language: 'de',
  });
  assert.equal(normalizeConfig({ language: 'it' }).language, 'fr');
  assert.deepEqual(normalizeConfig(null), { instances: [], invalidSlots: [], language: 'fr' });
  assert.deepEqual(normalizeConfig(DEFAULT_CONFIG), {
    instances: [],
    invalidSlots: [],
    language: 'fr',
  });
});

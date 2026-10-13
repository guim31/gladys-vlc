// -----------------------------------------------------------------------------
// The web interface client against a stub `fetch`: authentication, command
// encoding, errors, artwork. Never the network.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VlcClient, VlcError } from '../src/vlc/client.js';
import { ART, fixture } from './helpers/fakeVlc.js';

/** A fetch answering `answer()` (a fresh Response each time). */
function stub(answer) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return answer();
  };
  return { calls, fetch };
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'text/plain' } });

const client = (fetch) =>
  new VlcClient({ url: 'http://192.0.2.30:8080', password: 'pa:ss', fetch });

test('status: Basic authentication with an empty user, no redirect, the parsed answer', async () => {
  const { calls, fetch } = stub(() => json(fixture('status-playing.json')));
  const status = await client(fetch).status();
  assert.equal(status.state, 'playing');
  assert.equal(calls[0].url, 'http://192.0.2.30:8080/requests/status.json');
  assert.equal(
    calls[0].init.headers.authorization,
    `Basic ${Buffer.from(':pa:ss').toString('base64')}`,
  );
  assert.equal(calls[0].init.redirect, 'manual');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test('commands are URL-encoded the way VLC decodes them', async () => {
  const { calls, fetch } = stub(() => json(fixture('status-playing.json')));
  await client(fetch).status('in_play', { input: 'https://radio.example.com/a b+c.mp3?x=1&y=2' });
  await client(fetch).status('volume', { val: 128 });
  const first = new URL(calls[0].url);
  assert.equal(first.searchParams.get('command'), 'in_play');
  assert.equal(first.searchParams.get('input'), 'https://radio.example.com/a b+c.mp3?x=1&y=2');
  assert.match(calls[0].url, /input=https%3A%2F%2Fradio\.example\.com%2Fa\+b%2Bc\.mp3/);
  assert.equal(calls[1].url, 'http://192.0.2.30:8080/requests/status.json?command=volume&val=128');
});

test('a refused password, a closed VLC, a timeout, something else than VLC', async () => {
  const kind = async (fetch) => {
    try {
      await client(fetch).status();
    } catch (err) {
      assert.ok(err instanceof VlcError);
      assert.doesNotMatch(err.message, /pa:ss/);
      return err.kind;
    }
    return 'resolved';
  };
  assert.equal(
    await kind(stub(() => new Response('<html/>', { status: 401 })).fetch),
    'unauthorized',
  );
  assert.equal(await kind(stub(() => new Response('', { status: 403 })).fetch), 'unauthorized');
  const refused = async () => {
    throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
  };
  assert.equal(await kind(refused), 'unreachable');
  const timeout = async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError');
  };
  assert.equal(await kind(timeout), 'unreachable');
  assert.equal(await kind(stub(() => new Response('<html>router</html>')).fetch), 'invalid');
  assert.equal(await kind(stub(() => json({ hello: 'world' })).fetch), 'invalid');
  assert.equal(await kind(stub(() => new Response('Error', { status: 404 })).fetch), 'invalid');
  assert.equal(await kind(stub(() => new Response('', { status: 500 })).fetch), 'http');
  assert.equal(await kind(stub(() => new Response('', { status: 302 })).fetch), 'http');
});

test('the unreachable message names the cause, never the password', async () => {
  const fetch = async () => {
    throw new TypeError('fetch failed', { cause: { code: 'EHOSTUNREACH' } });
  };
  await assert.rejects(client(fetch).status(), {
    message: 'no answer from http://192.0.2.30:8080 (EHOSTUNREACH)',
  });
});

test('playlist', async () => {
  const { calls, fetch } = stub(() => json(fixture('playlist-playing.json')));
  const tree = await client(fetch).playlist();
  assert.equal(tree.children[0].children.length, 4);
  assert.equal(calls[0].url, 'http://192.0.2.30:8080/requests/playlist.json');
});

test('art: the bytes, null without a cover, refused when too large', async () => {
  const png = () => new Response(ART, { headers: { 'content-type': 'image/png' } });
  assert.deepEqual(await client(stub(png).fetch).art(300 * 1024), ART);
  assert.equal(
    await client(stub(() => new Response('Error', { status: 404 })).fetch).art(1000),
    null,
  );
  await assert.rejects(client(stub(png).fetch).art(100), /too large/);
  const declared = () => new Response(ART, { headers: { 'content-length': '999999' } });
  await assert.rejects(client(stub(declared).fetch).art(1000), /too large \(999999 bytes\)/);
  await assert.rejects(client(stub(() => new Response('', { status: 401 })).fetch).art(1000), {
    kind: 'unauthorized',
  });
});

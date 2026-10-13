// -----------------------------------------------------------------------------
// lenientFetch against a loopback socket replaying VLC 3.0.20's own bytes:
// its /art answer separates the headers by a bare "\n", which Node's fetch
// refuses (an HTTPParserError). Nothing leaves the test process.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { lenientFetch } from '../src/vlc/http.js';
import { VlcClient } from '../src/vlc/client.js';
import { ART } from './helpers/fakeVlc.js';

/** A TCP server answering every request with `reply(requestText)`. */
async function rawServer(t, reply) {
  const requests = [];
  const server = createServer((socket) => {
    socket.once('data', (data) => {
      requests.push(data.toString('latin1'));
      const answer = reply(data.toString('latin1'));
      if (answer) {
        socket.end(answer);
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}`, requests };
}

// Recorded from VLC 3.0.20: "HTTP/1.0 200 OK\r\n", then bare "\n".
const vlcArt = () =>
  Buffer.concat([
    Buffer.from(`HTTP/1.0 200 OK\r\nContent-Type: image/png\nContent-Length: ${ART.length}\n\n`),
    ART,
    Buffer.from('\n'),
  ]);

test("VLC's /art answer, refused by Node's fetch, is read", async (t) => {
  const { url } = await rawServer(t, () => vlcArt());
  await assert.rejects(fetch(`${url}/art`), (err) => err.cause?.name === 'HTTPParserError');
  const response = await lenientFetch(`${url}/art`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), ART);
});

test('the client reads the artwork and the status through it, with the password', async (t) => {
  const status = JSON.stringify({ state: 'stopped', volume: 256, version: '3.0.20 Vetinari' });
  const { url, requests } = await rawServer(t, (request) =>
    request.startsWith('GET /art')
      ? vlcArt()
      : `HTTP/1.1 200 OK\r\nContent-type: text/plain\r\nContent-Length: ${status.length}\r\n\r\n${status}`,
  );
  const client = new VlcClient({ url, password: 'pw' });
  assert.deepEqual(await client.art(300 * 1024), ART);
  assert.equal((await client.status()).state, 'stopped');
  assert.match(requests[0], /^GET \/art HTTP\/1\.1\r\n/);
  assert.match(requests[1], /authorization: Basic OnB3\r\n/i);
});

test('errors look like fetch errors: refused, timeout', async (t) => {
  const { url } = await rawServer(t, () => null); // never answers
  await assert.rejects(
    lenientFetch(`${url}/x`, { signal: AbortSignal.timeout(50) }),
    (err) => err.name === 'TimeoutError',
  );
  const closed = new VlcClient({ url: 'http://127.0.0.1:1', password: 'pw' });
  await assert.rejects(closed.status(), { kind: 'unreachable', message: /ECONNREFUSED/ });
});

test('a redirect is not followed', async (t) => {
  const { url, requests } = await rawServer(
    t,
    () => 'HTTP/1.1 302 Found\r\nLocation: http://192.0.2.99/\r\nContent-Length: 0\r\n\r\n',
  );
  const response = await lenientFetch(`${url}/requests/status.json`);
  assert.equal(response.status, 302);
  assert.equal(requests.length, 1);
});

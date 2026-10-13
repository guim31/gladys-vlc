// -----------------------------------------------------------------------------
// A `fetch` for VLC's web interface, on node:http with the lenient parser.
//
// VLC's Lua web server writes the headers of /art (the artwork) separated by
// a bare "\n" instead of "\r\n" (share/lua/intf/http.lua, callback_art).
// Node's fetch refuses such an answer (HPE_INVALID_HEADER_TOKEN), curl and
// the browsers accept it. node:http with `insecureHTTPParser` accepts it too;
// it is used for every request to VLC, on the local network only.
//
// Only what VlcClient uses: GET, headers, `signal`; redirects are never
// followed (node:http does not), the answer is a standard Response.
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';

/**
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string, string>, signal?: AbortSignal }} [init]
 * @returns {Promise<Response>}
 */
export function lenientFetch(url, init = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    const request = transport.request(
      target,
      {
        method: init.method ?? 'GET',
        headers: init.headers,
        signal: init.signal,
        insecureHTTPParser: true,
      },
      (response) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          for (const item of Array.isArray(value) ? value : [value]) {
            headers.append(name, String(item));
          }
        }
        // A Response cannot carry a status outside 200-599, nor a body on 204/304.
        const status = Math.min(599, Math.max(200, response.statusCode ?? 500));
        const empty = [204, 205, 304].includes(status);
        if (empty) {
          response.resume();
        }
        resolve(
          new Response(empty ? null : Readable.toWeb(response), {
            status,
            statusText: response.statusMessage ?? '',
            headers,
          }),
        );
      },
    );
    request.on('error', (err) => {
      // The shape of fetch's errors: the cause carries the system code.
      if (err?.name === 'AbortError' && init.signal?.reason) {
        reject(init.signal.reason);
        return;
      }
      reject(new TypeError('fetch failed', { cause: err }));
    });
    request.end();
  });
}

// -----------------------------------------------------------------------------
// VLC's web interface (the Lua "http" interface: `--intf http` or
// `--extraintf http`, port 8080 by default), as documented in
// share/lua/http/requests/README.txt of VLC's source:
//
// - GET /requests/status.json[?command=...] runs the command (if any), then
//   answers the state: playback state, volume (256 = 100 %), position,
//   length, current playlist item and its metadata;
// - GET /requests/playlist.json answers the playlist tree;
// - GET /art answers the artwork of the current item (404 without one).
//
// Basic authentication with an empty user name and the password set in VLC.
// VLC answers `Content-Type: text/plain` for JSON: the body is parsed as text.
// Redirects are never followed: the password only goes to the typed address.
// The default transport is lenientFetch (src/vlc/http.js): VLC's /art answer
// is not valid HTTP for Node's own fetch.
// -----------------------------------------------------------------------------

import { lenientFetch } from './http.js';

export const HTTP_TIMEOUT_MS = 4_000;
export const ART_TIMEOUT_MS = 8_000;

/**
 * Error of a call to VLC. `kind`:
 * - `unreachable`: no answer (VLC closed, network, timeout, connection refused);
 * - `unauthorized`: HTTP 401 or 403, the password is refused;
 * - `http`: another HTTP status;
 * - `invalid`: something answered, but not VLC's web interface.
 */
export class VlcError extends Error {
  constructor(kind, message, { status } = {}) {
    super(message);
    this.name = 'VlcError';
    this.kind = kind;
    this.status = status;
  }
}

export class VlcClient {
  /**
   * @param {{ url: string, password: string, fetch?: Function, timeout?: number }} options
   */
  constructor({ url, password, fetch = lenientFetch, timeout = HTTP_TIMEOUT_MS }) {
    this.baseUrl = url;
    this.fetch = fetch;
    this.timeout = timeout;
    this.authorization = `Basic ${Buffer.from(`:${password}`).toString('base64')}`;
  }

  async #request(path, timeout) {
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers: { authorization: this.authorization },
        redirect: 'manual',
        signal: AbortSignal.timeout(timeout),
      });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? 'timeout' : (err?.cause?.code ?? err?.message);
      throw new VlcError('unreachable', `no answer from ${this.baseUrl} (${reason})`);
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => {});
      throw new VlcError('unauthorized', `password refused by VLC at ${this.baseUrl}`, {
        status: response.status,
      });
    }
    return response;
  }

  async #json(path) {
    const response = await this.#request(path, this.timeout);
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const kind = response.status === 404 ? 'invalid' : 'http';
      throw new VlcError(kind, `HTTP ${response.status} from ${this.baseUrl}`, {
        status: response.status,
      });
    }
    try {
      return JSON.parse(await response.text());
    } catch {
      throw new VlcError('invalid', `not VLC's web interface at ${this.baseUrl}`);
    }
  }

  /**
   * The state of VLC, after running `command` when one is given.
   * @param {string} [command] e.g. `pl_pause`, `volume`, `in_play`
   * @param {Record<string, string|number>} [params] e.g. `{ val: 128 }`, `{ input: url }`
   * @returns {Promise<object>} the parsed status.json
   */
  async status(command, params = {}) {
    const query = new URLSearchParams();
    if (command) {
      query.set('command', command);
      for (const [key, value] of Object.entries(params)) {
        query.set(key, String(value));
      }
    }
    const search = query.size > 0 ? `?${query}` : '';
    const status = await this.#json(`/requests/status.json${search}`);
    if (!status || typeof status !== 'object' || typeof status.state !== 'string') {
      throw new VlcError('invalid', `not VLC's web interface at ${this.baseUrl}`);
    }
    return status;
  }

  /** The playlist tree (playlist.json). */
  playlist() {
    return this.#json('/requests/playlist.json');
  }

  /**
   * The artwork of the current item, as a Buffer, or null when it has none.
   * Refused beyond `maxBytes` without reading the rest.
   * @param {number} maxBytes
   * @returns {Promise<Buffer | null>}
   */
  async art(maxBytes) {
    const response = await this.#request('/art', ART_TIMEOUT_MS);
    if (response.status === 404) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new VlcError('http', `HTTP ${response.status} from ${this.baseUrl}/art`, {
        status: response.status,
      });
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel().catch(() => {});
      throw new VlcError('http', `artwork too large (${declared} bytes)`);
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body ?? []) {
      size += chunk.length;
      if (size > maxBytes) {
        // Leaving the loop cancels the stream: the rest is never downloaded.
        throw new VlcError('http', `artwork too large (over ${maxBytes} bytes)`);
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
}

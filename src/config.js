// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// Up to three VLC instances, one "slot" each (`host_1`, `password_1`...). The
// slot number is the identity of the Gladys device: VLC has no serial number
// nor any id of its own, and a VLC that changes address (new DHCP lease) must
// keep its device, its history and its scenes.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const SLOTS = [1, 2, 3];

// The port of VLC's web interface (`--http-port`), 8080 unless changed.
export const DEFAULT_PORT = 8080;

export const DEFAULT_CONFIG = {
  host_1: '',
  password_1: '',
  host_2: '',
  password_2: '',
  host_3: '',
  password_3: '',
  language: 'fr',
};

export const hostKey = (slot) => `host_${slot}`;
export const passwordKey = (slot) => `password_${slot}`;

// The integration runs in its own container: "localhost" is the container
// itself, never the computer running VLC.
const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|::1|\[::1\]|0\.0\.0\.0)$/i;

/**
 * Turn what the user typed into the base URL of a VLC web interface:
 * `192.0.2.30`, `192.0.2.30:9090`, `kitchen.lan` or a full `http(s)://` URL.
 * @param {unknown} raw
 * @returns {{ url: string, host: string } | { error: 'invalid' | 'loopback' } | null}
 *   null when nothing is typed
 */
export function normalizeAddress(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return null;
  }
  const text = raw.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { error: 'invalid' };
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.hostname === '') {
    return { error: 'invalid' };
  }
  if (url.username || url.password) {
    // Credentials in the address would end up in logs and error messages.
    return { error: 'invalid' };
  }
  // The interface lives at the root of VLC's web server; a pasted
  // `/requests/status.json` or `/index.html` points at the same place.
  if (!/^\/(?:requests\/[a-z_]+\.(?:json|xml)|index\.html)?$/i.test(url.pathname)) {
    return { error: 'invalid' };
  }
  if (LOOPBACK.test(url.hostname)) {
    return { error: 'loopback' };
  }
  const port = url.port || (url.protocol === 'https:' ? '' : String(DEFAULT_PORT));
  return {
    host: url.hostname,
    url: `${url.protocol}//${url.host.replace(/:\d+$/, '')}${port ? `:${port}` : ''}`,
  };
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 * @returns {{
 *   instances: { slot: number, url: string, host: string, password: string }[],
 *   invalidSlots: { slot: number, error: 'invalid' | 'loopback' }[],
 *   language: string,
 * }}
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const instances = [];
  const invalidSlots = [];
  for (const slot of SLOTS) {
    const address = normalizeAddress(source[hostKey(slot)]);
    if (address === null) {
      continue;
    }
    if (address.error) {
      invalidSlots.push({ slot, error: address.error });
      continue;
    }
    // Not trimmed: a password may start or end with a space.
    const password = typeof source[passwordKey(slot)] === 'string' ? source[passwordKey(slot)] : '';
    instances.push({ slot, ...address, password });
  }
  return {
    instances,
    invalidSlots,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}

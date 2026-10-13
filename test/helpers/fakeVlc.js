// -----------------------------------------------------------------------------
// A VLC in memory: its web interface as a `fetch` implementation (Basic
// authentication with an empty user name, /requests/status.json and its
// commands, /requests/playlist.json, /art), answering with the bodies
// recorded on VLC 3.0.20 (test/fixtures/vlc/). The tests drive it: play,
// pause, change the volume, reach the end of an item, close VLC.
//
// The behaviours copied from the real VLC, as measured while recording:
// - `pl_pause` toggles, and plays when stopped; `pl_forcepause` and
//   `pl_forceresume` only act in the right state;
// - `in_play` adds the item at the end of the playlist and plays it;
// - the end of the last item stops VLC (no repeat);
// - `pl_empty` stops the playback;
// - `volume` takes VLC's scale (256 = 100 %), with no upper bound;
// - JSON is served as `text/plain`, a wrong password is a 401.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

// Silent integration logs (LOG_LEVEL is read on every log call);
// LOG_LEVEL=debug npm test shows them.
process.env.LOG_LEVEL ??= 'silent';

export function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/vlc/${name}`, import.meta.url), 'utf8'));
}

export const ART = readFileSync(new URL('../fixtures/vlc/art.png', import.meta.url));

export const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until `check()` is true (or fail after `timeout` ms). */
export async function until(check, timeout = 2000, what = 'condition') {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await settle(5);
  }
}

const metaOf = (name) => fixture(name).information.category.meta;

/** Media the fake knows, described as the real VLC described them. */
export const MEDIA = {
  tone1: {
    uri: 'file:///home/alice/Music/tone1.mp3',
    length: 60,
    meta: metaOf('status-playing.json'),
  },
  tone2: {
    uri: 'file:///home/alice/Music/tone2.mp3',
    length: 120,
    meta: metaOf('status-playing-second.json'),
  },
  untagged: {
    uri: 'file:///home/alice/Music/untagged.wav',
    length: 30,
    meta: metaOf('status-playing-untagged.json'),
  },
  radio: {
    uri: 'http://192.0.2.81:8000/stream',
    length: 0,
    meta: metaOf('status-playing-radio.json'),
  },
  covered: {
    uri: 'file:///home/alice/Music/covered.mp3',
    length: 90,
    meta: metaOf('status-playing-cover.json'),
    art: ART,
  },
  announcement: {
    uri: 'https://gladys.example.com/tts/announcement.mp3',
    length: 3,
    meta: { filename: 'announcement.mp3' },
  },
};

const text = (status, body, headers = {}) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain', ...headers } });

function refused(code) {
  return new TypeError('fetch failed', { cause: { code } });
}

export class FakeVlc {
  constructor({ host = '192.0.2.30', port = 8080, password = 'test-password', volume = 256 } = {}) {
    this.host = host;
    this.port = port;
    this.password = password;
    this.version = '3.0.20 Vetinari';
    this.state = 'stopped';
    this.playlist = [];
    this.nextId = 3; // VLC's own nodes take ids 0 to 2
    this.currentId = null;
    this.time = 0;
    this.volume = volume;
    this.down = false;
    this.downCode = 'ECONNREFUSED';
    // Something else than VLC answers on that port.
    this.impostor = false;
    // /art answers 404 this many times first: VLC finds a cover a moment
    // after the item starts.
    this.artMisses = 0;
    this.requests = [];
  }

  /** What the user types in the configuration. */
  get address() {
    return this.port === 8080 ? this.host : `${this.host}:${this.port}`;
  }

  get current() {
    return this.playlist.find((item) => item.id === this.currentId) ?? null;
  }

  /** The commands VLC received, in order (`pl_pause`, `volume=128`...). */
  get commands() {
    return this.requests
      .filter((request) => request.command)
      .map(({ command, params }) => {
        const value = params.val ?? params.input ?? params.id;
        return value === undefined ? command : `${command}=${value}`;
      });
  }

  // --- Driven by the tests ---------------------------------------------------

  #add(media) {
    // VLC turns a path into a file:// URI (vlc.strings.make_uri).
    const uri = media.startsWith('/') ? `file://${encodeURI(media)}` : media;
    const known = Object.values(MEDIA).find((candidate) => candidate.uri === uri);
    const item = known
      ? { ...known, id: this.nextId++ }
      : {
          uri,
          length: 0,
          meta: { filename: decodeURIComponent(uri.split('/').at(-1) || uri) },
          id: this.nextId++,
        };
    this.playlist.push(item);
    return item;
  }

  /** The user opens a media in VLC's window. */
  open(media) {
    const item = this.#add(typeof media === 'string' ? media : media.uri);
    this.#play(item.id);
    return item;
  }

  enqueue(media) {
    return this.#add(typeof media === 'string' ? media : media.uri);
  }

  pause() {
    if (this.state === 'playing') {
      this.state = 'paused';
    }
  }

  resume() {
    if (this.state === 'paused') {
      this.state = 'playing';
    }
  }

  stop() {
    this.state = 'stopped';
    this.currentId = null;
    this.time = 0;
  }

  advance(seconds) {
    if (this.state === 'playing') {
      this.time += seconds;
    }
  }

  /** The current item reaches its end: the next one plays, or VLC stops. */
  finish() {
    const index = this.playlist.findIndex((item) => item.id === this.currentId);
    const next = this.playlist[index + 1];
    if (next) {
      this.#play(next.id);
    } else {
      this.stop();
    }
  }

  #play(id) {
    this.currentId = id;
    this.state = 'playing';
    this.time = 0;
  }

  // --- The web interface ------------------------------------------------------

  #run(command, params) {
    const id = params.id === undefined ? null : Number(params.id);
    switch (command) {
      case 'in_play':
        this.open(params.input);
        break;
      case 'in_enqueue':
        this.enqueue(params.input);
        break;
      case 'pl_play':
        if (id !== null && id >= 0) {
          if (this.playlist.some((item) => item.id === id)) {
            this.#play(id);
          }
        } else if (this.state === 'paused') {
          this.resume();
        } else if (this.state === 'stopped' && this.playlist.length > 0) {
          this.#play(this.playlist[0].id);
        }
        break;
      case 'pl_pause':
        if (this.state === 'stopped') {
          this.#run('pl_play', {});
        } else {
          this.state = this.state === 'playing' ? 'paused' : 'playing';
        }
        break;
      case 'pl_forcepause':
        this.pause();
        break;
      case 'pl_forceresume':
        this.resume();
        break;
      case 'pl_stop':
        this.stop();
        break;
      case 'pl_next':
      case 'pl_previous': {
        const index = this.playlist.findIndex((item) => item.id === this.currentId);
        const target = this.playlist[index + (command === 'pl_next' ? 1 : -1)];
        if (target && this.state !== 'stopped') {
          this.#play(target.id);
        }
        break;
      }
      case 'pl_empty':
        this.playlist = [];
        this.stop();
        break;
      case 'pl_delete':
        this.playlist = this.playlist.filter((item) => item.id !== id);
        if (this.currentId === id) {
          this.stop();
        }
        break;
      case 'volume':
        this.volume = Math.max(0, Number(params.val));
        break;
      case 'seek':
        this.time = Number(params.val);
        break;
      default:
        break;
    }
  }

  status() {
    if (this.state === 'stopped' || !this.current) {
      return { ...fixture('status-stopped-empty.json'), volume: this.volume, state: 'stopped' };
    }
    const item = this.current;
    const status = fixture('status-playing.json');
    return {
      ...status,
      volume: this.volume,
      state: this.state,
      time: this.time,
      length: item.length,
      position: item.length > 0 ? this.time / item.length : 0,
      currentplid: item.id,
      information: {
        ...status.information,
        category: {
          ...status.information.category,
          meta: { ...item.meta },
        },
      },
    };
  }

  playlistTree() {
    const tree = fixture('playlist-empty.json');
    tree.children[0].children = this.playlist.map((item) => ({
      name: item.meta.title ?? item.meta.filename,
      id: String(item.id),
      uri: item.uri,
      ...(item.id === this.currentId ? { current: 'current' } : {}),
      duration: item.length,
      type: 'leaf',
      ro: 'rw',
    }));
    return tree;
  }

  async fetch(url, init = {}) {
    if (this.down) {
      throw refused(this.downCode);
    }
    const { pathname, searchParams } = new URL(url);
    if (this.impostor) {
      return text(200, '<html><body>A router</body></html>', { 'content-type': 'text/html' });
    }
    const expected = `Basic ${Buffer.from(`:${this.password}`).toString('base64')}`;
    if (init.headers?.authorization !== expected) {
      return text(401, '<html>Unauthorized</html>', {
        'content-type': 'text/html',
        'www-authenticate': 'Basic realm="VLC stream"',
      });
    }
    const params = Object.fromEntries(searchParams);
    const { command, ...rest } = params;
    this.requests.push({ path: pathname, command, params: rest });
    if (pathname === '/requests/status.json') {
      if (command) {
        this.#run(command, rest);
      }
      return text(200, JSON.stringify(this.status(), null, 2));
    }
    if (pathname === '/requests/playlist.json') {
      return text(200, JSON.stringify(this.playlistTree(), null, 2));
    }
    if (pathname === '/art') {
      const art = this.state !== 'stopped' ? this.current?.art : null;
      if (art && this.artMisses > 0) {
        this.artMisses -= 1;
        return text(404, 'Error');
      }
      return art
        ? new Response(art, {
            status: 200,
            headers: { 'content-type': 'image/png', 'content-length': String(art.length) },
          })
        : text(404, 'Error');
    }
    return text(404, 'Error');
  }
}

/** A network of fake VLC: the `fetch` the integration uses in the tests. */
export function network(...servers) {
  return async (url, init) => {
    const { hostname, port } = new URL(url);
    const server = servers.find((s) => s.host === hostname && String(s.port) === port);
    if (!server) {
      throw refused('ECONNREFUSED');
    }
    return server.fetch(url, init);
  };
}

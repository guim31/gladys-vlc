# VLC for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that follows and controls [VLC media player](https://www.videolan.org/vlc/) —
on a computer, a Raspberry Pi or a server — over the local network, through
VLC's web interface. No cloud, no account.

This integration is not affiliated with VideoLAN. VLC is a trademark of
VideoLAN.

> **Tested against a real VLC, not yet inside a real Gladys: feedback
> welcome.** The integration was exercised against VLC 3.0.20 on Linux
> (headless `cvlc`, silent sound card): files with and without tags, a web
> radio with ICY metadata, play, pause, next, previous, volume, mute, artwork,
> the core's announcement and the resume after it, a closed VLC and its
> return, a wrong password. Its Gladys side ran against the SDK's fake Gladys,
> not a real Gladys instance; Windows, macOS and VLC 4 were not tried. Please
> report what works and what does not in the
> [issues](https://github.com/guim31/gladys-vlc/issues).

## Features

- **One device per VLC** (up to three): playing (0/1), playback state, title,
  artist, album, progress, time left, a volume slider, and play / pause /
  stop / previous / next / mute buttons. Web radios show their current song
  (ICY `now_playing`) and their station.
- **Gladys 5.3 Music player**: the core's Music dashboard box shows the
  artwork (reduced in the container to a JPEG of 400 px at most), title,
  artist, album, a progress bar, shuffle, repeat and mute; its panel browses
  the folders of the computer running VLC (home folder, computer) and VLC's
  playlist, and plays a file, a folder or a playlist. No search and no
  "play next" (VLC's web interface has neither). Already added VLC: click
  **Update** in the Discover tab to get the new features (same ids).
- Gladys 5.3 or later (1.0.x works with 5.1 and 5.2).
- **Announcements**: the core's "Talk on a speaker" scene action plays the
  text-to-speech MP3 on VLC; then the integration removes it from the playlist
  and plays again what was playing (a file at its position, a radio live).
- **Dashboard widget "VLC player"**: artwork, title, artist, album, state,
  position, volume, and four buttons (play/pause, next, volume down and up).
- **Scene triggers**: playback started, paused, resumed, stopped — filtered by
  VLC, with the VLC name, the title, the artist and the album as variables.
- **Scene actions**: play an address (web radio, stream, file: add and play,
  replace the playlist, or enqueue; optional volume), empty the playlist.
- Texts in English, French, German and Spanish.

## Requirements

- Gladys Assistant 5.1 or later.
- VLC 3.0 or later with its **web interface** on and a password set: in VLC,
  _Tools → Preferences → Show settings: All → Interface → Main interfaces_,
  tick _Web_, then _Main interfaces → Lua_, set the _Lua HTTP password_, and
  restart VLC. Or start it with `vlc --extraintf http --http-password <pw>`
  (`cvlc --intf http --http-password <pw>` without a window).

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter
   `https://github.com/guim31/gladys-vlc` (or find **VLC** in the catalog).
2. In **Configuration**, type the address of the computer running VLC (port
   8080 unless changed) and the password, then **Test the connection**.
3. Add each VLC from the **Discover** tab.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

- **Why the web interface, not telnet.** VLC offers two remote interfaces.
  The Lua web interface (`/requests/status.json`) answers JSON with the state,
  the volume, the position, the length, the current playlist item and all its
  tags — including `now_playing` for a web radio and `artwork_url` — and
  serves the artwork at `/art`; each request stands alone, authenticated by
  Basic auth with an empty user name. The telnet interface (used by Home
  Assistant through `aiovlc`) needs a session kept open and answers text whose
  labels follow VLC's language. The web interface gives more, more reliably.
- VLC pushes nothing: the container reads `status.json` itself, every 3 s
  while something plays, 5 s when stopped, 1 min for a VLC not added to Gladys
  yet, 30 s when VLC is closed (two missed answers in a row). Only the changes
  are published, and each value again every 6 hours. The devices are published
  with `should_poll: false`: the core's poll scheduler is not relied upon
  (Gladys#3198), `onPoll` is only a fallback.
- Commands map to VLC's own: `pl_forceresume` / `pl_play`, `pl_forcepause`,
  `pl_stop`, `pl_next`, `pl_previous`, `volume` (256 = 100 %), `in_play`,
  `in_enqueue`, `pl_empty`, `pl_delete`, `seek`. The web interface has no mute
  state: mute sets the volume to 0 and remembers the previous one (as Home
  Assistant does).
- VLC's `/art` answer separates its headers with a bare `\n`, which Node's
  `fetch` rejects: requests go through `node:http` with its lenient parser
  (`src/vlc/http.js`).
- A scene can only make VLC play `http(s)`, `rtsp`, `rtp`, `udp`, `mms`,
  `rtmp`, `ftp`, `sftp`, `smb` and `file` addresses or absolute paths: not
  `vlc://quit`, the screen nor a capture device.
- `/data/vlc-state.json` keeps the volume each VLC had before a mute. The
  passwords stay in the Gladys configuration and never reach the logs.

## Limits

- No discovery: VLC's web interface does not announce itself (no mDNS/SSDP).
- Up to three VLC. No seek, shuffle or repeat from Gladys.
- The announcement plays at the current volume: the core does not pass its
  volume to integrations.
- Developed without Windows or macOS machines and without a Gladys instance:
  feedback welcome.

## Development

```bash
npm install
npm test              # node --test, against the SDK's fake Gladys and a fake VLC
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store . --skip-image-check
```

The fake VLC (`test/helpers/fakeVlc.js`) answers with bodies recorded on a real
VLC 3.0.20 (`test/fixtures/vlc/`, paths and addresses anonymized).

## Credits

- The reading of VLC's metadata (title from `now_playing` for a web radio,
  station as artist, file name as fallback) and the volume-to-zero mute follow
  Home Assistant's [`vlc_telnet`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/vlc_telnet)
  integration (Apache-2.0), and its library
  [`aiovlc`](https://github.com/MartinHjelmare/aiovlc) by Martin Hjelmare
  (Apache-2.0).
- VLC's web interface is documented in `share/lua/http/requests/README.txt` of
  [VLC's source](https://code.videolan.org/videolan/vlc) (GPL-2.0, read, not
  copied).
- Built from the official
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js)
  and the [integration SDK](https://github.com/GladysAssistant/integration-sdk-js).

## License

Apache-2.0, see [LICENSE](LICENSE).

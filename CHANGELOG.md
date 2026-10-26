# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Gladys 5.3 Music player: artwork, duration, position (seek), shuffle and
  repeat (off, all = VLC's loop, one = VLC's repeat) features, published with
  `publishNowPlaying`; writable playback state (pause, play, stop).
- Music panel: browse the home folder and the whole computer running VLC
  (folders, audio and video files, playlists; a folder plays as a whole),
  VLC's playlist as the queue (jump to an item), play = replace the playlist.
  No search and no "play next / add" (VLC's web interface cannot move an
  item).
- Artwork larger than 300 KB (a cover embedded in a file is often several
  megabytes) is reduced in the container to a JPEG of 400 px at most, in
  plain JavaScript (`jpeg-js`); it used to be dropped.

### Changed

- Requires Gladys 5.3.0 (`music` manifest field), SDK 0.16.
- Title, artist and album become music features (they were text features),
  mute becomes a music on/off feature (it was a television push button),
  with the same ids: click **Update** in the Discover tab to convert them and
  get the new features; until then the mute button keeps toggling.
- The playing feature reads 2 when VLC is stopped or closed (it read 0):
  a scene waiting for 0 to detect a stop needs 2 now.
- Nothing playing: title, artist and album are empty (they read "Nothing
  playing" and "—").
- During an announcement, the music box keeps showing the song (only the
  playback state follows).
- A muted VLC (volume 0) is shown muted, its slider at the volume before.

## [1.0.1] - 2026-10-13

### Added

- One device per VLC (up to three), through VLC's web interface: playing
  (0/1), playback state, title, artist, album, progress, time left, volume,
  and play, pause, stop, previous, next and mute buttons. Web radios show
  their current song and their station.
- The core's Music dashboard box works with each VLC.
- Announcements: the core's "Talk on a speaker" scene action plays on VLC,
  then what was playing comes back.
- "VLC player" dashboard widget: artwork, title, artist, album, state,
  position, volume, play/pause, next, volume down and up.
- Scene triggers: playback started, paused, resumed, stopped, with the VLC
  name, title, artist and album.
- Scene actions: play an address in VLC (add and play, replace the playlist,
  or enqueue, with an optional volume), empty the playlist.
- "Test the connection" action, connection status per VLC.
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-vlc/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-vlc/releases/tag/v1.0.1

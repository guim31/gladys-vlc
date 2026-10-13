# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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

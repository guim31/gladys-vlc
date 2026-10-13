// -----------------------------------------------------------------------------
// What a scene may ask VLC to play: a media resource locator (MRL).
//
// VLC opens whatever its `in_play` command receives, including its own
// `vlc://quit` (which closes it) and the screen or a capture card. A scene can
// put a variable in the address, so only the media schemes are let through,
// plus absolute file paths (VLC turns them into file:// itself).
// -----------------------------------------------------------------------------

export const MRL_SCHEMES = [
  'http',
  'https',
  'rtsp',
  'rtp',
  'udp',
  'mms',
  'mmsh',
  'rtmp',
  'ftp',
  'sftp',
  'smb',
  'file',
];

export const MAX_MRL_LENGTH = 2000;

/**
 * The MRL to hand to VLC, or null when it is not one we let through.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalizeMrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  // eslint-disable-next-line no-control-regex
  if (text === '' || text.length > MAX_MRL_LENGTH || /[\u0000-\u001f\u007f]/.test(text)) {
    return null;
  }
  // /home/me/music.mp3, C:\Users\me\music.mp3, \\nas\music\song.mp3
  if (text.startsWith('/') || /^[a-z]:[\\/]/i.test(text) || text.startsWith('\\\\')) {
    return text;
  }
  const scheme = text.match(/^([a-z][a-z0-9+.-]*):\/\/./i)?.[1]?.toLowerCase();
  return scheme && MRL_SCHEMES.includes(scheme) ? text : null;
}

/** An MRL fit for a log line: no credentials, no query string. */
export function loggableMrl(mrl) {
  return String(mrl)
    .replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1')
    .replace(/[?#].*$/, '')
    .slice(0, 200);
}

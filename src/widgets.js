// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `player`, "VLC player".
//
// What it adds to the core's Music box: the artwork, the title, the artist
// and the album, the state, the position, the volume, and four buttons —
// play/pause, next, volume down and up.
//
// Budget (8 components, 2 texts at most): artwork, heading, caption, status
// list, four buttons — exactly 8. Without artwork, the progress gauge of the
// device takes its place when the item has a length. No button opens a form,
// so Gladys 5.1 is enough.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { deviceIds } from './devices.js';
import { CommandError, WIDGET_KEY } from './hub.js';
import { isActive, volumePercent } from './vlc/model.js';
import {
  DONE_TEXT,
  NOTHING_PLAYING,
  STATE_LABELS,
  UNKNOWN_TITLE,
  formatPosition,
} from './texts.js';

export { WIDGET_KEY };

// One step of the volume buttons, in percent.
export const VOLUME_STEP = 5;

export const TEXT = {
  pick: {
    en: 'Choose a VLC in the widget settings.',
    fr: 'Choisissez un VLC dans les réglages du widget.',
    de: 'Wähle ein VLC in den Widget-Einstellungen.',
    es: 'Elija un VLC en los ajustes del widget.',
  },
  unknown: {
    en: 'This VLC is not configured in the integration anymore.',
    fr: "Ce VLC n'est plus configuré dans l'intégration.",
    de: 'Dieses VLC ist in der Integration nicht mehr eingerichtet.',
    es: 'Este VLC ya no está configurado en la integración.',
  },
  state: { en: 'State', fr: 'État', de: 'Status', es: 'Estado' },
  position: { en: 'Position', fr: 'Position', de: 'Position', es: 'Posición' },
  volume: { en: 'Volume', fr: 'Volume', de: 'Lautstärke', es: 'Volumen' },
  muted: { en: 'muted', fr: 'coupé', de: 'stumm', es: 'silenciado' },
  progress: { en: 'Progress', fr: 'Progression', de: 'Fortschritt', es: 'Progreso' },
  play: { en: 'Play', fr: 'Lire', de: 'Abspielen', es: 'Reproducir' },
  pause: { en: 'Pause', fr: 'Pause', de: 'Pause', es: 'Pausa' },
  next: { en: 'Next', fr: 'Suivant', de: 'Weiter', es: 'Siguiente' },
  volume_down: { en: 'Volume −', fr: 'Volume −', de: 'Leiser', es: 'Volumen −' },
  volume_up: { en: 'Volume +', fr: 'Volume +', de: 'Lauter', es: 'Volumen +' },
  cover: { en: 'Artwork', fr: 'Pochette', de: 'Cover', es: 'Carátula' },
};

export const WIDGET_ACTIONS = ['play_pause', 'next', 'volume_down', 'volume_up'];

const STATE_COLORS = {
  off: WIDGET_COLORS.NEUTRAL,
  stopped: WIDGET_COLORS.NEUTRAL,
  playing: WIDGET_COLORS.SUCCESS,
  paused: WIDGET_COLORS.WARNING,
};

const HEADING_MAX = 40;
const CAPTION_MAX = 80;

const pick = (table, language) => table[language] ?? table.en;
const textOnly = (text, ttl = 60) => ({
  ttl_seconds: ttl,
  components: [{ type: 'text', variant: 'body', text }],
});

function button(language, key, icon, label = key) {
  return { type: 'button', label: pick(TEXT[label], language), icon, action: { key } };
}

/**
 * The widget content for a VLC.
 * @param {object} hub
 * @param {{ settings?: object, language?: string }} request
 */
export function buildContent(hub, { settings = {}, language = 'en' }) {
  const lang = STATE_LABELS[language] ? language : 'en';
  if (typeof settings.device !== 'string' || settings.device === '') {
    return textOnly(pick(TEXT.pick, lang), 300);
  }
  const entry = [...hub.instances.values()].find(
    (candidate) => deviceIds(hub.gladys, candidate.slot).device === settings.device,
  );
  if (!entry) {
    return textOnly(pick(TEXT.unknown, lang), 300);
  }
  const { snapshot } = entry.vlc;
  const active = isActive(snapshot);
  const components = [];

  const artwork = active ? hub.artworkKey(entry) : null;
  if (artwork) {
    components.push({ type: 'image', key: artwork, alt: pick(TEXT.cover, lang), fit: 'contain' });
  } else if (active && snapshot.length !== null && hub.isCreated(entry.slot)) {
    components.push({
      type: 'gauge',
      label: pick(TEXT.progress, lang),
      device_feature: deviceIds(hub.gladys, entry.slot).feature('progress'),
      color: WIDGET_COLORS.PRIMARY,
    });
  }

  let title = pick(NOTHING_PLAYING, lang);
  if (snapshot.state === 'off') {
    title = pick(STATE_LABELS, lang).off;
  } else if (active) {
    title = snapshot.title || pick(UNKNOWN_TITLE, lang);
  }
  components.push({ type: 'text', variant: 'heading', text: title.slice(0, HEADING_MAX) });
  const caption = [];
  if (title.length > HEADING_MAX) {
    // The heading is cut: the caption gives the whole title.
    caption.push(title);
  }
  if (active) {
    caption.push(...[snapshot.artist, snapshot.album].filter(Boolean));
  }
  caption.push(hub.deviceName(entry));
  components.push({
    type: 'text',
    variant: 'caption',
    text: caption.join(' · ').slice(0, CAPTION_MAX),
  });

  const items = [
    {
      label: pick(TEXT.state, lang),
      value: pick(STATE_LABELS, lang)[snapshot.state].slice(0, 40),
      color: STATE_COLORS[snapshot.state],
    },
  ];
  if (active && snapshot.time !== null) {
    const position =
      snapshot.length !== null
        ? `${formatPosition(snapshot.time)} / ${formatPosition(snapshot.length)}`
        : formatPosition(snapshot.time);
    items.push({ label: pick(TEXT.position, lang), value: position, icon: 'clock' });
  }
  const volume = snapshot.state === 'off' ? null : volumePercent(snapshot);
  if (volume !== null) {
    items.push({
      label: pick(TEXT.volume, lang),
      value: volume === 0 ? `0 % (${pick(TEXT.muted, lang)})` : `${volume} %`,
      icon: volume === 0 ? 'volume-x' : 'volume-2',
    });
  }
  components.push({ type: 'status', items });

  if (snapshot.state !== 'off') {
    components.push(
      snapshot.state === 'playing'
        ? button(lang, 'play_pause', 'pause', 'pause')
        : button(lang, 'play_pause', 'play', 'play'),
    );
    if (active) {
      components.push(button(lang, 'next', 'skip-forward'));
    }
    if (volume !== null) {
      components.push(
        button(lang, 'volume_down', 'volume-1'),
        button(lang, 'volume_up', 'volume-2'),
      );
    }
  }

  // The position moves: re-read every 15 s while playing.
  return { ttl_seconds: snapshot.state === 'playing' ? 15 : 120, components };
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    get(hub, request) {
      return buildContent(hub, request ?? {});
    },

    /** Resolves the toast (the widget action receives no language: all four). */
    async action(hub, { actionKey, settings = {} }) {
      const device = settings.device;
      try {
        switch (actionKey) {
          case 'play_pause':
            await hub.run(device, (vlc) => vlc.playPause());
            break;
          case 'next':
            await hub.run(device, (vlc) => vlc.next());
            break;
          case 'volume_down':
          case 'volume_up':
            await hub.run(device, async (vlc) => {
              const current = Math.min(100, volumePercent(vlc.snapshot) ?? 50);
              const step = actionKey === 'volume_up' ? VOLUME_STEP : -VOLUME_STEP;
              await vlc.setVolume(Math.min(100, Math.max(0, current + step)));
            });
            break;
          default:
            throw new Error(`Unknown widget action ${actionKey}`);
        }
      } catch (err) {
        if (err instanceof CommandError) {
          return err.messages;
        }
        throw err;
      }
      return DONE_TEXT[actionKey];
    },
  },
};

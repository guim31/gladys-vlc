// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface. German says "du", Spanish "usted" (test/i18n.test.js).
// A device integration never receives the user's language: the `language`
// field of the configuration picks one (default: French).
// -----------------------------------------------------------------------------

/** Feature names, frozen when the device is added to Gladys. */
export const NAMES = {
  en: {
    playback_state: 'Playing',
    state: 'Playback state',
    title: 'Title',
    artist: 'Artist',
    album: 'Album',
    progress: 'Progress',
    time_left: 'Time left',
    volume: 'Volume',
    mute: 'Mute',
    play: 'Play',
    pause: 'Pause',
    stop: 'Stop',
    previous: 'Previous',
    next: 'Next',
    notification: 'Notification',
    artwork: 'Artwork',
    duration: 'Duration',
    position: 'Position',
    shuffle: 'Shuffle',
    repeat: 'Repeat',
  },
  fr: {
    playback_state: 'En lecture',
    state: 'État de la lecture',
    title: 'Titre',
    artist: 'Artiste',
    album: 'Album',
    progress: 'Progression',
    time_left: 'Temps restant',
    volume: 'Volume',
    mute: 'Sourdine',
    play: 'Lire',
    pause: 'Pause',
    stop: 'Stop',
    previous: 'Précédent',
    next: 'Suivant',
    notification: 'Notification',
    artwork: 'Pochette',
    duration: 'Durée',
    position: 'Position',
    shuffle: 'Aléatoire',
    repeat: 'Répétition',
  },
  de: {
    playback_state: 'Spielt',
    state: 'Wiedergabestatus',
    title: 'Titel',
    artist: 'Interpret',
    album: 'Album',
    progress: 'Fortschritt',
    time_left: 'Restzeit',
    volume: 'Lautstärke',
    mute: 'Stumm',
    play: 'Abspielen',
    pause: 'Pause',
    stop: 'Stopp',
    previous: 'Zurück',
    next: 'Weiter',
    notification: 'Benachrichtigung',
    artwork: 'Cover',
    duration: 'Dauer',
    position: 'Position',
    shuffle: 'Zufallswiedergabe',
    repeat: 'Wiederholung',
  },
  es: {
    playback_state: 'Reproduciendo',
    state: 'Estado de reproducción',
    title: 'Título',
    artist: 'Artista',
    album: 'Álbum',
    progress: 'Progreso',
    time_left: 'Tiempo restante',
    volume: 'Volumen',
    mute: 'Silencio',
    play: 'Reproducir',
    pause: 'Pausa',
    stop: 'Detener',
    previous: 'Anterior',
    next: 'Siguiente',
    notification: 'Notificación',
    artwork: 'Carátula',
    duration: 'Duración',
    position: 'Posición',
    shuffle: 'Aleatorio',
    repeat: 'Repetición',
  },
};

/** The `state` feature (text), one label per state of src/vlc/model.js. */
export const STATE_LABELS = {
  en: { off: 'Off or unreachable', stopped: 'Stopped', playing: 'Playing', paused: 'Paused' },
  fr: {
    off: 'Éteint ou injoignable',
    stopped: 'Arrêté',
    playing: 'En lecture',
    paused: 'En pause',
  },
  de: {
    off: 'Aus oder nicht erreichbar',
    stopped: 'Gestoppt',
    playing: 'Wiedergabe',
    paused: 'Pausiert',
  },
  es: {
    off: 'Apagado o inaccesible',
    stopped: 'Detenido',
    playing: 'Reproduciendo',
    paused: 'En pausa',
  },
};

/** The `title` feature when no item is loaded. */
export const NOTHING_PLAYING = {
  en: 'Nothing playing',
  fr: 'Rien en lecture',
  de: 'Nichts läuft',
  es: 'Nada en reproducción',
};

/** The `title` of an item VLC describes with nothing at all. */
export const UNKNOWN_TITLE = {
  en: 'Unknown title',
  fr: 'Titre inconnu',
  de: 'Unbekannter Titel',
  es: 'Título desconocido',
};

/** The `artist` and `album` features without a value (a text state is never empty). */
export const NO_VALUE = '—';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les journaux de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh in den Protokollen der Integration nach.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

/** Connection status lines, shown in the Configuration screen. */
export const STATUS_TEXT = {
  en: {
    invalid: (slot) => `VLC ${slot}: the address is not valid.`,
    loopback: (slot) =>
      `VLC ${slot}: use the network address of the computer (e.g. 192.168.1.20), not localhost.`,
    unauthorized: (slot) => `VLC ${slot}: password refused.`,
    unreachable: (slot) => `VLC ${slot}: no answer (closed, or web interface off).`,
    invalidAnswer: (slot) => `VLC ${slot}: this address does not answer like VLC.`,
    none: 'Type the address of a VLC to start.',
  },
  fr: {
    invalid: (slot) => `VLC ${slot} : l'adresse n'est pas valide.`,
    loopback: (slot) =>
      `VLC ${slot} : indiquez l'adresse réseau de l'ordinateur (ex. 192.168.1.20), pas localhost.`,
    unauthorized: (slot) => `VLC ${slot} : mot de passe refusé.`,
    unreachable: (slot) => `VLC ${slot} : pas de réponse (fermé, ou interface web désactivée).`,
    invalidAnswer: (slot) => `VLC ${slot} : cette adresse ne répond pas comme VLC.`,
    none: "Saisissez l'adresse d'un VLC pour commencer.",
  },
  de: {
    invalid: (slot) => `VLC ${slot}: Die Adresse ist ungültig.`,
    loopback: (slot) =>
      `VLC ${slot}: Gib die Netzwerkadresse des Computers an (z. B. 192.168.1.20), nicht localhost.`,
    unauthorized: (slot) => `VLC ${slot}: Passwort abgelehnt.`,
    unreachable: (slot) => `VLC ${slot}: keine Antwort (geschlossen oder Weboberfläche aus).`,
    invalidAnswer: (slot) => `VLC ${slot}: Diese Adresse antwortet nicht wie VLC.`,
    none: 'Gib die Adresse eines VLC ein, um zu beginnen.',
  },
  es: {
    invalid: (slot) => `VLC ${slot}: la dirección no es válida.`,
    loopback: (slot) =>
      `VLC ${slot}: indique la dirección de red del equipo (p. ej. 192.168.1.20), no localhost.`,
    unauthorized: (slot) => `VLC ${slot}: contraseña rechazada.`,
    unreachable: (slot) => `VLC ${slot}: sin respuesta (cerrado o interfaz web desactivada).`,
    invalidAnswer: (slot) => `VLC ${slot}: esta dirección no responde como VLC.`,
    none: 'Introduzca la dirección de un VLC para empezar.',
  },
};

/** Lines of the "Test the connection" action. */
export const TEST_TEXT = {
  en: {
    ok: (slot, name, version, state) =>
      `VLC ${slot} (${name}): connected, VLC ${version}, ${state}.`,
    unauthorized: (slot) => `VLC ${slot}: password refused.`,
    failed: (slot) => `VLC ${slot}: no answer. Is VLC open, with its web interface on?`,
    invalidAnswer: (slot) => `VLC ${slot}: this address does not answer like VLC.`,
    none: 'No VLC configured: type its address and password first.',
  },
  fr: {
    ok: (slot, name, version, state) =>
      `VLC ${slot} (${name}) : connecté, VLC ${version}, ${state}.`,
    unauthorized: (slot) => `VLC ${slot} : mot de passe refusé.`,
    failed: (slot) => `VLC ${slot} : pas de réponse. VLC est-il ouvert, avec son interface web ?`,
    invalidAnswer: (slot) => `VLC ${slot} : cette adresse ne répond pas comme VLC.`,
    none: "Aucun VLC configuré : saisissez d'abord son adresse et son mot de passe.",
  },
  de: {
    ok: (slot, name, version, state) =>
      `VLC ${slot} (${name}): verbunden, VLC ${version}, ${state}.`,
    unauthorized: (slot) => `VLC ${slot}: Passwort abgelehnt.`,
    failed: (slot) => `VLC ${slot}: keine Antwort. Ist VLC offen, mit aktiver Weboberfläche?`,
    invalidAnswer: (slot) => `VLC ${slot}: Diese Adresse antwortet nicht wie VLC.`,
    none: 'Kein VLC eingerichtet: Gib zuerst seine Adresse und sein Passwort ein.',
  },
  es: {
    ok: (slot, name, version, state) =>
      `VLC ${slot} (${name}): conectado, VLC ${version}, ${state}.`,
    unauthorized: (slot) => `VLC ${slot}: contraseña rechazada.`,
    failed: (slot) => `VLC ${slot}: sin respuesta. ¿Está VLC abierto, con su interfaz web activa?`,
    invalidAnswer: (slot) => `VLC ${slot}: esta dirección no responde como VLC.`,
    none: 'Ningún VLC configurado: introduzca primero su dirección y su contraseña.',
  },
};

/** Errors of a command (device, scene action, widget), by code. */
export const COMMAND_ERRORS = {
  en: {
    unknown_device: 'This VLC is not configured in the integration anymore.',
    unreachable: 'VLC does not answer: is it open, with its web interface on?',
    unauthorized: 'VLC refused the password.',
    refused: 'VLC refused the command.',
    out_of_range: 'The volume must be between 0 and 100.',
    bad_value: 'This value is not supported.',
    not_found: 'This item is no longer in the VLC playlist.',
    bad_url: 'Give an http(s), rtsp, rtp, udp, mms, ftp, smb or file address, or a full file path.',
  },
  fr: {
    unknown_device: "Ce VLC n'est plus configuré dans l'intégration.",
    unreachable: 'VLC ne répond pas : est-il ouvert, avec son interface web ?',
    unauthorized: 'VLC a refusé le mot de passe.',
    refused: 'VLC a refusé la commande.',
    out_of_range: 'Le volume doit être compris entre 0 et 100.',
    bad_value: "Cette valeur n'est pas prise en charge.",
    not_found: "Cet élément n'est plus dans la liste de lecture de VLC.",
    bad_url:
      'Indiquez une adresse http(s), rtsp, rtp, udp, mms, ftp, smb ou file, ou un chemin de fichier complet.',
  },
  de: {
    unknown_device: 'Dieses VLC ist in der Integration nicht mehr eingerichtet.',
    unreachable: 'VLC antwortet nicht: Ist es offen, mit aktiver Weboberfläche?',
    unauthorized: 'VLC hat das Passwort abgelehnt.',
    refused: 'VLC hat den Befehl abgelehnt.',
    out_of_range: 'Die Lautstärke muss zwischen 0 und 100 liegen.',
    bad_value: 'Dieser Wert wird nicht unterstützt.',
    not_found: 'Dieser Eintrag ist nicht mehr in der Wiedergabeliste von VLC.',
    bad_url:
      'Gib eine http(s)-, rtsp-, rtp-, udp-, mms-, ftp-, smb- oder file-Adresse an, oder einen vollständigen Dateipfad.',
  },
  es: {
    unknown_device: 'Este VLC ya no está configurado en la integración.',
    unreachable: 'VLC no responde: ¿está abierto, con su interfaz web activa?',
    unauthorized: 'VLC ha rechazado la contraseña.',
    refused: 'VLC ha rechazado la orden.',
    out_of_range: 'El volumen debe estar entre 0 y 100.',
    bad_value: 'Este valor no es compatible.',
    not_found: 'Este elemento ya no está en la lista de reproducción de VLC.',
    bad_url:
      'Indique una dirección http(s), rtsp, rtp, udp, mms, ftp, smb o file, o una ruta de archivo completa.',
  },
};

/** The multi-language message of a command error code. */
export function commandMessage(code) {
  return Object.fromEntries(
    Object.entries(COMMAND_ERRORS).map(([language, table]) => [
      language,
      table[code] ?? table.refused,
    ]),
  );
}

/** Toasts of the widget buttons (the widget action receives no language). */
export const DONE_TEXT = {
  play_pause: {
    en: 'Play / pause sent to VLC.',
    fr: 'Lecture / pause envoyée à VLC.',
    de: 'Wiedergabe / Pause an VLC gesendet.',
    es: 'Reproducir / pausa enviado a VLC.',
  },
  next: {
    en: 'Next item.',
    fr: 'Élément suivant.',
    de: 'Nächster Eintrag.',
    es: 'Elemento siguiente.',
  },
  volume_down: {
    en: 'Volume down.',
    fr: 'Volume baissé.',
    de: 'Leiser gestellt.',
    es: 'Volumen bajado.',
  },
  volume_up: {
    en: 'Volume up.',
    fr: 'Volume monté.',
    de: 'Lauter gestellt.',
    es: 'Volumen subido.',
  },
};

/** `1:23:45`, `3:45`: a position in seconds. Empty when unknown. */
export function formatPosition(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return '';
  }
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** The entry points of the music panel (Gladys 5.3), by language. */
export const CATALOG_ROOTS = {
  en: { home: 'Home folder', computer: 'Computer' },
  fr: { home: 'Dossier personnel', computer: 'Ordinateur' },
  de: { home: 'Persönlicher Ordner', computer: 'Computer' },
  es: { home: 'Carpeta personal', computer: 'Equipo' },
};

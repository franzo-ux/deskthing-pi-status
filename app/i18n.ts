// User-facing strings, English (default) and Italian.
// Used by both the server (settings labels) and the client (screen texts).

export type Lang = "en" | "it";

const STRINGS = {
  en: {
    // screen
    connecting: "connecting",
    unreachable: "Pi host unreachable",
    asksOne: "Pi is asking",
    asksMany: "{n} questions for you",
    working: "working",
    idleOne: "instance idle",
    idleMany: "instances idle",
    noAnswer: "no answer",
    noInstances: "No Pi instance running",
    rowAsking: "asking · {d}",
    rowDone: "done {d} ago",
    rowWaiting: "waiting",
    tapToClose: "tap to close",
    stackAlert: "Stack Status alert",
    stackStatus: "Stack Status",
    // settings
    setLanguage: "Language",
    setLanguageDesc: "Language of the app (setting labels change after restarting DeskThing)",
    setUrl: "Pi status URL",
    setUrlDesc: "URL of the pi-status service on the machine running Pi",
    setSleep: "Turn screen off after (minutes)",
    setSleepDesc: "Minutes without activity before the Car Thing screen turns off (0 = never)",
    setSwitch: "Switch to Stack Status on alerts",
    setSwitchDesc: "When Stack Status reports a service down, the Car Thing switches to it",
    setMascot: "Mascot",
    setMascotDesc: "Who runs on screen while Pi works",
  },
  it: {
    connecting: "collegamento",
    unreachable: "host di Pi non raggiungibile",
    asksOne: "Pi ti chiede",
    asksMany: "{n} domande per te",
    working: "al lavoro",
    idleOne: "istanza libera",
    idleMany: "istanze libere",
    noAnswer: "nessuna risposta",
    noInstances: "Nessuna istanza di Pi aperta",
    rowAsking: "ti chiede · {d}",
    rowDone: "finito {d} fa",
    rowWaiting: "in attesa",
    tapToClose: "tocca per chiudere",
    stackAlert: "allarme Stack Status",
    stackStatus: "Stack Status",
    setLanguage: "Lingua",
    setLanguageDesc: "Lingua dell'app (le voci delle impostazioni cambiano dopo il riavvio di DeskThing)",
    setUrl: "Indirizzo stato Pi",
    setUrlDesc: "URL del servizio pi-status sulla macchina con Pi",
    setSleep: "Spegni schermo dopo (minuti)",
    setSleepDesc: "Minuti senza attività prima di spegnere lo schermo del Car Thing (0 = mai)",
    setSwitch: "Passa a Stack Status sugli allarmi",
    setSwitchDesc: "Quando Stack Status segnala un servizio giù, il Car Thing passa a quell'app",
    setMascot: "Mascotte",
    setMascotDesc: "Chi corre sullo schermo mentre Pi lavora",
  },
};

export type Key = keyof typeof STRINGS.en;

export const LANGUAGE_OPTIONS = [
  { label: "English", value: "en" },
  { label: "Italiano", value: "it" },
];

export function isLang(v: unknown): v is Lang {
  return v === "en" || v === "it";
}

/** Translate a key; {n} and {d} placeholders are filled from vars. */
export function t(lang: Lang, key: Key, vars: Record<string, string | number> = {}): string {
  let s: string = (STRINGS[lang] || STRINGS.en)[key] || STRINGS.en[key];
  for (const k in vars) s = s.split("{" + k + "}").join(String(vars[k]));
  return s;
}

import { createDeskThing } from "@deskthing/server";
import { DESKTHING_EVENTS, SETTING_TYPES } from "@deskthing/types";
import { isLang, LANGUAGE_OPTIONS, t, type Lang } from "../i18n";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkMusic, ensureScreenIdle, setScreenTimeout, wakeScreen } from "./screen";

type PiSession = {
  pid: number;
  label: string;
  cwd: string;
  state: "busy" | "idle" | "asking";
  since: number;
  lastDone: number | null;
};

type PiStatus = {
  online: boolean;
  error: string | null;
  checked: number;
  sessions: PiSession[];
};

const DeskThing = createDeskThing();

const DEFAULT_URL = "http://pi-host.local:8765/status"; // example: set yours in the app settings
const POLL_MS = 2000;

let statusUrl = DEFAULT_URL;
let switchOnAlert = true;
let lang: Lang = "en";
let mascot = "robottina";
let timer: ReturnType<typeof setInterval> | null = null;
let screenTimer: ReturnType<typeof setInterval> | null = null;
let musicTimer: ReturnType<typeof setInterval> | null = null;
let last: PiStatus = { online: false, error: null, checked: 0, sessions: [] };
let lastStates = new Map<number, PiSession>();
let firstPoll = true;

const sendMascot = () => DeskThing.send({ type: "mascot", payload: mascot });
// The mascot travels with every status update: a one-off reply can be lost
// if the client asks before its connection is ready.
const send = () => {
  // "now": the Car Thing clock is not synced, the display uses ours
  DeskThing.send({ type: "pi_status", payload: { ...last, now: Date.now(), lang } });
  sendMascot();
};

async function poll() {
  try {
    const res = await fetch(statusUrl, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { sessions: PiSession[] };
    const sessions = data.sessions || [];

    // Announce instances that went from busy to idle since the previous poll.
    if (!firstPoll) {
      for (const s of sessions) {
        const prev = lastStates.get(s.pid);
        if (prev && prev.state === "idle" && s.state === "busy") wakeScreen("Pi started");
        if (prev && prev.state !== "asking" && s.state === "asking") wakeScreen("Pi asks a question");
        if (prev && prev.state === "busy" && s.state === "idle") {
          wakeScreen("Pi finished");
          DeskThing.send({
            type: "pi_done",
            payload: { label: s.label, duration: (s.lastDone ?? Date.now()) - prev.since },
          });
        }
      }
    }
    firstPoll = false;
    lastStates = new Map(sessions.map((s) => [s.pid, s]));
    last = { online: true, error: null, checked: Date.now(), sessions };
  } catch (err) {
    last = {
      ...last,
      online: false,
      error: err instanceof Error ? err.message : String(err),
      checked: Date.now(),
    };
  }
  send();
}

function startPolling() {
  if (timer) clearInterval(timer);
  firstPoll = true;
  poll();
  timer = setInterval(poll, POLL_MS);
}

const MASCOT_OPTIONS = [{ label: "Robottina", value: "robottina" }];

DeskThing.on(DESKTHING_EVENTS.START, async () => {
  const saved = (await DeskThing.getSettings()) as any;
  if (typeof saved?.mascot?.value === "string") mascot = saved.mascot.value;
  if (isLang(saved?.language?.value)) lang = saved.language.value;
  await DeskThing.initSettings({
    language: {
      id: "language",
      label: t(lang, "setLanguage"),
      description: t(lang, "setLanguageDesc"),
      type: SETTING_TYPES.SELECT,
      value: lang,
      options: LANGUAGE_OPTIONS,
    },
    status_url: {
      id: "status_url",
      label: t(lang, "setUrl"),
      description: t(lang, "setUrlDesc"),
      type: SETTING_TYPES.STRING,
      value: DEFAULT_URL,
    },
    screen_timeout: {
      id: "screen_timeout",
      label: t(lang, "setSleep"),
      description: t(lang, "setSleepDesc"),
      type: SETTING_TYPES.NUMBER,
      value: 25,
      min: 0,
      max: 240,
    },
    homelab_switch: {
      id: "homelab_switch",
      label: t(lang, "setSwitch"),
      description: t(lang, "setSwitchDesc"),
      type: SETTING_TYPES.BOOLEAN,
      value: true,
    },
    mascot: {
      id: "mascot",
      label: t(lang, "setMascot"),
      description: t(lang, "setMascotDesc"),
      type: SETTING_TYPES.SELECT,
      value: mascot,
      options: MASCOT_OPTIONS,
    },
  });
  // initSettings keeps a setting as it was first saved: refresh the mascot
  // options so new mascots show up for existing installs.
  await DeskThing.setSettingOptions("mascot", MASCOT_OPTIONS);
  if (typeof saved?.homelab_switch?.value === "boolean") switchOnAlert = saved.homelab_switch.value;
  const minutes = Number(saved?.screen_timeout?.value);
  setScreenTimeout(Number.isFinite(minutes) ? minutes : 25);
  ensureScreenIdle();
  // re-check every minute: the Car Thing may have rebooted or reconnected
  if (screenTimer) clearInterval(screenTimer);
  screenTimer = setInterval(ensureScreenIdle, 60000);
  if (musicTimer) clearInterval(musicTimer);
  musicTimer = setInterval(checkMusic, 15000); // the Spotify app polls too: stay well under the rate limit
  if (alertTimer) clearInterval(alertTimer);
  checkStackAlert();
  alertTimer = setInterval(checkStackAlert, 2000);
  startPolling();
});

DeskThing.on(DESKTHING_EVENTS.SETTINGS, (data) => {
  const m = (data.payload as any)?.mascot?.value;
  if (typeof m === "string" && m !== mascot) {
    mascot = m;
    sendMascot();
  }
  const l = (data.payload as any)?.language?.value;
  if (isLang(l) && l !== lang) {
    lang = l;
    send(); // the display follows at once; setting labels at next start
  }
  const sw = (data.payload as any)?.homelab_switch?.value;
  if (typeof sw === "boolean") switchOnAlert = sw;
  const minutes = Number((data.payload as any)?.screen_timeout?.value);
  if (Number.isFinite(minutes)) setScreenTimeout(minutes);
  const url = (data.payload as any)?.status_url?.value;
  if (typeof url === "string" && url && url !== statusUrl) {
    statusUrl = url;
    startPolling();
  }
});

DeskThing.on(DESKTHING_EVENTS.GET, (data) => {
  if (data.request === "pi_status") send();
  if (data.request === "mascot") sendMascot();
});

// Alerts from the Stack Status app (deskThing.sendToApp): show them on the display
// and, if enabled, switch the Car Thing over to Stack Status.
function onStackAlert(payload: any) {
  const text = String(payload?.text || t(lang, "stackAlert"));
  console.log("Stack Status alert received: " + text);
  wakeScreen("Stack Status alert");
  DeskThing.send({ type: "homelab_alert", payload: { text, switch: switchOnAlert } });
}
// DeskThing 0.11 delivers sendToApp messages back to the sender, so Stack Status (app id "homelab")
// writes its alerts to apps/homelab/alert.json and we poll that file.
declare const __dirname: string;
const HOMELAB_ALERT = join(__dirname, "..", "..", "homelab", "alert.json");
let lastAlertAt: number | null = null;

function checkStackAlert() {
  let alert: { text?: string; at?: number } | null = null;
  try {
    alert = JSON.parse(readFileSync(HOMELAB_ALERT, "utf8"));
  } catch {
    alert = null;
  }
  const at = alert && typeof alert.at === "number" ? alert.at : 0;
  if (lastAlertAt === null) {
    lastAlertAt = at; // first look: do not replay an old alert
    return;
  }
  if (at > lastAlertAt) {
    lastAlertAt = at;
    onStackAlert(alert);
  }
}
let alertTimer: ReturnType<typeof setInterval> | null = null;

DeskThing.on(DESKTHING_EVENTS.STOP, () => {
  if (timer) clearInterval(timer);
  if (screenTimer) clearInterval(screenTimer);
  if (musicTimer) clearInterval(musicTimer);
  if (alertTimer) clearInterval(alertTimer);
  timer = screenTimer = musicTimer = alertTimer = null;
});

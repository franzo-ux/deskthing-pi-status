// Car Thing screen sleep: keeps screen-idle.sh running on the device over adb
// and wakes the screen on events (Pi activity, music starting).
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import SCRIPT from "./screen-idle.sh";

// DeskThing runs apps without the usual Windows environment (no TEMP/APPDATA),
// so paths are derived from this file: .../deskthing/apps/pistatus/server
declare const __dirname: string;
const DESKTHING_DIR = join(__dirname, "..", "..", "..");

const REMOTE_DIR = "/var/screen-idle";
const REMOTE_SCRIPT = REMOTE_DIR + "/screen-idle.sh";
const SCRIPT_VERSION = (/echo (\d+) > "\$RUN\/version"/.exec(SCRIPT) || [])[1] || "0";

function findAdb(): string | null {
  const candidates = [
    join(dirname(process.execPath), "resources", "win", "adb.exe"),
    join(DESKTHING_DIR, "..", "..", "Local", "Programs", "deskthing", "resources", "win", "adb.exe"),
  ];
  return candidates.find((p) => existsSync(p)) || null;
}

const ADB = findAdb();

function adb(args: string[], timeout = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!ADB) return reject(new Error("adb not found"));
    execFile(ADB, args, { timeout, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
  });
}

async function connected(): Promise<boolean> {
  try {
    return /\tdevice\b/.test(await adb(["devices"]));
  } catch {
    return false;
  }
}

let timeoutMin = 25;

/** Make sure the idle script runs on the device with the configured timeout. */
export async function ensureScreenIdle() {
  if (!(await connected())) return;
  try {
    const seconds = Math.max(0, Math.round(timeoutMin * 60));
    const state = await adb([
      "shell",
      "cat /tmp/screen-idle/timeout 2>/dev/null; echo v$(cat /tmp/screen-idle/version 2>/dev/null); [ -f /tmp/screen-idle/pid ] && kill -0 $(cat /tmp/screen-idle/pid) 2>/dev/null && echo RUNNING",
    ]);
    const running = state.includes("RUNNING");
    const current = parseInt(state, 10);
    if (seconds === 0) {
      if (running) await adb(["shell", "kill $(cat /tmp/screen-idle/pid)"]);
      return;
    }
    if (running && current === seconds && state.split(/\s+/).indexOf("v" + SCRIPT_VERSION) >= 0) return; // adb ends lines with \r\r\n
    const local = join(__dirname, "screen-idle.sh");
    writeFileSync(local, SCRIPT.replace(/\r\n/g, "\n"));
    await adb(["shell", "mkdir -p " + REMOTE_DIR]);
    await adb(["push", local, REMOTE_SCRIPT]);
    await adb([
      "shell",
      "chmod +x " + REMOTE_SCRIPT + "; setsid sh " + REMOTE_SCRIPT + " " + seconds + " </dev/null >" + REMOTE_DIR + "/log 2>&1 & sleep 1", // without the sleep adb ends the session before setsid detaches
    ]);
    console.log(`Screen idle started on the Car Thing (${timeoutMin} min)`);
  } catch (e) {
    console.warn("Screen idle: " + (e instanceof Error ? e.message : e));
  }
}

export function setScreenTimeout(minutes: number) {
  if (!Number.isFinite(minutes) || minutes < 0 || minutes === timeoutMin) return;
  timeoutMin = minutes;
  ensureScreenIdle();
}

/** Register activity on the device: turns the screen on and restarts the countdown. */
export function wakeScreen(reason: string) {
  if (timeoutMin === 0) return;
  adb(["shell", "date +%s > /tmp/screen-idle/last"])
    .then(() => console.debug("Screen woken: " + reason))
    .catch(() => {});
}

// ---- music: wake when playback starts, resumes, or the track changes ----

const SPOTIFY_DATA = join(DESKTHING_DIR, "data", "spotify.json");
let lastPlaying: boolean | null = null;
let lastTrack: string | null = null;
let musicPausedUntil = 0; // Spotify said "too many requests": wait


/** Poll Spotify with the DeskThing Spotify app's own login (read-only). */
export async function checkMusic() {
  let token: string | undefined;
  try {
    token = JSON.parse(readFileSync(SPOTIFY_DATA, "utf8"))?.data?.access_token;
  } catch {
    return;
  }
  if (!token || Date.now() < musicPausedUntil) return;
  try {
    const res = await fetch("https://api.spotify.com/v1/me/player?additional_types=episode", {
      headers: { Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(4000),
    });
    // 204: nothing playing; 401: the Spotify app refreshes its token on its own
    if (res.status === 204) {
      lastPlaying = false;
      return;
    }
    if (res.status === 429) {
      // shared limit with the DeskThing Spotify app: back off generously
      const wait = Math.max(60, Number(res.headers.get("retry-after")) || 0);
      musicPausedUntil = Date.now() + wait * 1000;
      console.warn("Spotify rate limit: music check paused for " + wait + " s");
      return;
    }
    if (!res.ok) return;
    const p = (await res.json()) as any;
    const playing = !!p?.is_playing;
    const track = p?.item?.id ?? null;
    if (lastPlaying !== null && playing && (!lastPlaying || track !== lastTrack)) {
      wakeScreen(lastPlaying ? "new track" : "playback started");
    }
    lastPlaying = playing;
    lastTrack = track;
  } catch {
    // network hiccup: try again on the next poll
  }
}

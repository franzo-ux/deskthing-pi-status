import { createDeskThing } from "@deskthing/client";
import * as Robottina from "./robot";

type Mascot = {
  RUN: string[];
  WALK: string[];
  IDLE: string;
  BLINK: string;
  WIDTH: number;
  // optional left-facing frames: used instead of mirroring the right-facing ones
  RUN_LEFT?: string[];
  WALK_LEFT?: string[];
  DIRECTIONAL?: boolean;
};
const MASCOTS: Record<string, Mascot> = { robottina: Robottina };

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

// Never take keyboard focus away from the DeskThing page: if this iframe gets
// focus (a tap does that), the Car Thing buttons and knob stop driving
// DeskThing's own UI (app wheel, app switching). Taps and clicks still work.
document.addEventListener("mousedown", (e) => e.preventDefault(), true);

const $ = (id: string) => document.getElementById(id) as HTMLElement;
let status: PiStatus | null = null;
let doneTimer: ReturnType<typeof setTimeout> | null = null;
// PC time minus Car Thing time: the device clock is not synced
let skew = 0;
const now_ = () => Date.now() + skew;
let firstStatus = true;
let mascotName = "robottina";
let doneUntil = 0;

function esc(s: string) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}

function duration(ms: number, short = false) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return short ? m + "m" : m + "m " + String(s % 60).padStart(2, "0") + "s";
  return Math.floor(m / 60) + "h " + String(m % 60).padStart(2, "0") + "m";
}

function clock(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? h + ":" + mm + ":" + ss : mm + ":" + ss;
}

// ---------- status screen (style B) ----------

function render() {
  const app = $("app");
  const list = $("list");
  if (!status) {
    app.className = "app wait";
    $("big").textContent = "…";
    $("lbl").textContent = "collegamento";
    list.innerHTML = "";
    robot.setWalking(false);
    return;
  }
  const now = now_();
  const busy = status.sessions.filter((s) => s.state === "busy");
  const asking = status.sessions.filter((s) => s.state === "asking");

  if (!status.online) {
    app.className = "app offline";
    $("big").textContent = "!";
    $("lbl").textContent = "VM non raggiungibile";
  } else if (asking.length) {
    app.className = "app ask";
    $("big").textContent = "?";
    $("lbl").textContent = asking.length === 1 ? "Pi ti chiede" : asking.length + " domande per te";
  } else if (busy.length) {
    app.className = "app busy";
    $("big").textContent = String(busy.length);
    $("lbl").textContent = "al lavoro";
  } else {
    app.className = "app idle";
    $("big").textContent = String(status.sessions.length);
    $("lbl").textContent = status.sessions.length === 1 ? "istanza libera" : "istanze libere";
  }
  const isAsking = status.online && asking.length > 0;
  robot.setWalking(status.online && !isAsking && busy.length > 0);
  robot.setGlitch(isAsking);

  if (!status.online) {
    list.innerHTML = '<div class="empty">' + esc(status.error || "nessuna risposta") + "</div>";
    return;
  }
  if (!status.sessions.length) {
    list.innerHTML = '<div class="empty">Nessuna istanza di Pi aperta</div>';
    return;
  }
  list.innerHTML = status.sessions
    .map((s) => {
      const isBusy = s.state === "busy";
      const isAsk = s.state === "asking";
      const recent = !isBusy && !isAsk && s.lastDone !== null && now - s.lastDone < 30 * 60 * 1000;
      const cls = isAsk ? "ask" : isBusy ? "busy" : recent ? "fin" : "wait";
      const right = isAsk
        ? "ti chiede · " + duration(now - s.since, true)
        : isBusy
        ? duration(now - s.since, true)
        : s.lastDone
          ? "finito " + duration(now - s.lastDone, true) + " fa"
          : "in attesa";
      return (
        '<div class="row ' + cls + '"><span class="sq"></span>' +
        '<span class="label">' + esc(s.label) + "</span>" +
        '<span class="tm">' + right + "</span></div>"
      );
    })
    .join("");
}

// ---------- running mascot ----------

const robot = (() => {
  const track = $("track");
  const el = $("robot");
  const makeFrames = (set: string[]) => set.map((svg) => {
    const f = document.createElement("div");
    f.className = "frame";
    f.innerHTML = svg;
    el.appendChild(f);
    return f;
  });
  let sprite: Mascot = Robottina;
  let run: HTMLElement[] = [];
  let walk: HTMLElement[] = [];
  let runLeft: HTMLElement[] = [];
  let walkLeft: HTMLElement[] = [];
  let all: HTMLElement[] = [];
  let still = document.createElement("div");
  let slices: HTMLElement[] = [];
  let glitching = false;

  function load(m: Mascot) {
    sprite = m;
    el.innerHTML = "";
    run = makeFrames(m.RUN);
    walk = makeFrames(m.WALK);
    runLeft = m.RUN_LEFT ? makeFrames(m.RUN_LEFT) : run;
    walkLeft = m.WALK_LEFT ? makeFrames(m.WALK_LEFT) : walk;
    all = run.concat(walk, runLeft === run ? [] : runLeft, walkLeft === walk ? [] : walkLeft);
    still = document.createElement("div");
    still.className = "frame";
    el.appendChild(still);
    // two offset, tinted copies of the current frame for the glitch effect
    slices = ["s1", "s2"].map((c) => {
      const d = document.createElement("div");
      d.className = "slice " + c;
      el.appendChild(d);
      return d;
    });
  }

  // Glitch: every ~90ms copy the visible frame into the slices with a random
  // horizontal band and offset (chromatic aberration comes from the CSS).
  setInterval(() => {
    if (!glitching) return;
    const visible = all.concat([still]).filter((f) => f.style.display === "block")[0];
    const html = visible ? visible.innerHTML : "";
    slices.forEach((sl, i) => {
      if (sl.getAttribute("data-h") !== String(html.length)) {
        sl.innerHTML = html;
        sl.setAttribute("data-h", String(html.length));
      }
      const top = Math.floor(Math.random() * 80);
      const height = 4 + Math.floor(Math.random() * 22);
      const clip = "inset(" + top + "% 0 " + Math.max(0, 100 - top - height) + "% 0)";
      const st = sl.style as any;
      st.visibility = Math.random() < 0.75 ? "visible" : "hidden";
      st.webkitClipPath = clip;
      st.clipPath = clip;
      st.transform = "translateX(" + ((Math.random() * 14 - 7) * (i ? -1 : 1)).toFixed(0) + "px)";
    });
  }, 90);
  load(sprite);

  let walking = false;
  let frame = 0;
  let x = 0;
  let dir = 1;
  let lastTick = 0;
  let blinkUntil = 0;
  let nextBlink = Date.now() + 2500;
  const RUN_SPEED = 120; // px per second
  const WALK_SPEED = 45;

  const show = (set: HTMLElement[] | null, i: number) =>
    all.forEach((f) => (f.style.display = set !== null && f === set[i] ? "block" : "none"));

  function setStill(blink: boolean) {
    const html = blink ? sprite.BLINK : sprite.IDLE;
    if (still.getAttribute("data-k") !== html.length + String(blink)) {
      still.innerHTML = html;
      still.setAttribute("data-k", html.length + String(blink));
    }
  }

  function step(t: number) {
    const dt = lastTick ? Math.min(100, t - lastTick) : 16;
    lastTick = t;
    const max = Math.max(0, track.clientWidth - sprite.WIDTH);
    if (walking) {
      x += dir * RUN_SPEED * (dt / 1000);
      if (x >= max) { x = max; dir = -1; }
      if (x <= 0) { x = 0; dir = 1; }
      frame = Math.floor(t / 90) % run.length;
      show(dir < 0 ? runLeft : run, frame);
      still.style.display = "none";
    } else {
      // Drift back to the centre, then stand still and blink now and then.
      const centre = max / 2;
      const stepPx = WALK_SPEED * (dt / 1000);
      if (Math.abs(x - centre) > stepPx) {
        dir = x < centre ? 1 : -1;
        x += dir * stepPx;
        show(dir < 0 ? walkLeft : walk, Math.floor(t / 160) % walk.length);
        still.style.display = "none";
      } else {
        x = centre;
        dir = 1;
        const now = Date.now();
        if (now > nextBlink) { blinkUntil = now + 160; nextBlink = now + 2500 + Math.random() * 3000; }
        setStill(now < blinkUntil);
        show(null, 0);
        still.style.display = "block";
      }
    }
    const flip = sprite.DIRECTIONAL ? 1 : dir;
    el.style.transform = "translateX(" + Math.round(x) + "px) scaleX(" + flip + ")";
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);

  return {
    setWalking(w: boolean) {
      walking = w;
    },
    setGlitch(on: boolean) {
      if (on === glitching) return;
      glitching = on;
      track.classList[on ? "add" : "remove"]("glitch");
    },
    setMascot(name: string) {
      const m = MASCOTS[name];
      if (m && m !== sprite) load(m);
    },
  };
})();

// ---------- "done" overlay (style C) ----------

function showDone(label: string, ms: number) {
  $("done-label").textContent = label;
  $("done-time").textContent = "exit 0 · " + clock(ms);
  $("done").className = "done show";
  if (doneTimer) clearTimeout(doneTimer);
  doneTimer = setTimeout(() => ($("done").className = "done"), 15000);
}

$("done").addEventListener("click", () => {
  $("done").className = "done";
});

DeskThing.on("pi_status", (data: any) => {
  status = data.payload as PiStatus;
  if (typeof (data.payload as any).now === "number") skew = (data.payload as any).now - Date.now();
  // Arriving here right after a job finished (e.g. switched over from another
  // app): show the "done" banner we would otherwise have missed.
  if (firstStatus) {
    firstStatus = false;
    const recent = status.sessions.filter((s) => s.state === "idle" && s.lastDone !== null && now_() - (s.lastDone as number) < 20000);
    if (recent.length) {
      const s = recent[0];
      doneUntil = now_() + 15000;
      showDone(s.label, (s.lastDone as number) - s.since);
    }
  }
  render();
});

DeskThing.on("mascot", (data: any) => {
  if (String(data.payload) === mascotName) return;
  mascotName = String(data.payload);
  document.body.className = "m-" + mascotName;
  robot.setMascot(mascotName);
  render();
});

// Homelab alert: glitchy banner, then jump to the Homelab app.
DeskThing.on("homelab_alert", (data: any) => {
  const p = data.payload || {};
  $("alert-text").textContent = "⚠ " + (p.text || "allarme Homelab");
  $("alert").className = "alert show";
  setTimeout(() => ($("alert").className = "alert"), 6000);
  if (p.switch) {
    setTimeout(() => {
      try {
        (DeskThing as any).triggerAction({ id: "open", value: "homelab", source: "server" });
      } catch (e) {
        console.warn("could not switch to Homelab", e);
      }
    }, 1400);
  }
});

DeskThing.on("pi_done", (data: any) => {
  doneUntil = now_() + 15000;
  showDone(data.payload.label, data.payload.duration);
  render();
});

// Keep the elapsed times ticking between polls.
setInterval(render, 1000);
render();
DeskThing.send({ type: "get", request: "pi_status" } as any);
DeskThing.send({ type: "get", request: "mascot" } as any);

# Pi Status for DeskThing

🇮🇹 [Leggi in italiano](README.it.md)

A [DeskThing](https://deskthing.app) app for the Spotify **Car Thing** that shows what your
[Pi coding agent](https://pi.dev) instances are doing, with a little pixel-art mascot
("Robottina") that runs while Pi works.

- **Live status of every Pi instance**: busy, idle, finished N minutes ago.
- **"Pi is asking you something"**: when Pi stops to ask a question (the `ask_user` tool of
  [pi-ask](https://www.npmjs.com/package/@eko24ive/pi-ask), the *grilling* skill, or a reply that
  ends with a question) the screen turns into a **glitch** effect.
- **"✓ DONE" banner** when a job finishes.
- **Screen sleep** for the Car Thing: the display turns off after N minutes without touches,
  knob or buttons, and wakes up on its own when Pi starts/finishes/asks, or when music starts.
- **Homelab alerts**: if the companion app
  [Stack Status](https://github.com/franzo-ux/deskthing-stack-status) reports a service down, Pi Status
  shows the alert and switches the Car Thing to it.

```
 ┌────────── VM / server running Pi ──────────┐        ┌──────── PC running DeskThing ───────┐
 │ pi + extension deskthing-status.ts         │        │ Pi Status app (server)              │
 │   writes ~/.pi/agent/deskthing-status/*.json│ HTTP  │   polls the VM every 2 s            │ USB/ADB ┌───────────┐
 │ pi-status-server.py  (port 8765) ──────────┼──────▶ │   screen sleep, music, alerts ──────┼────────▶│ Car Thing │
 └────────────────────────────────────────────┘        └─────────────────────────────────────┘         └───────────┘
```

## Requirements

- A Car Thing flashed for DeskThing, connected via USB to a PC running **DeskThing ≥ 0.11**.
- **Node.js ≥ 20** on the PC (only to build the app).
- On the machine running Pi: **Pi ≥ 1.1**, **Python 3**, and (for the service) **systemd**.

## 1. Machine running Pi

```bash
# the Pi extension: every Pi instance reports busy / idle / asking
cp vm/deskthing-status.ts ~/.pi/agent/extensions/

# the status service (plain Python, no dependencies)
mkdir -p ~/scripts ~/.config/systemd/user
cp vm/pi-status-server.py ~/scripts/
cp vm/pi-status.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now pi-status.service
loginctl enable-linger "$USER"   # keep it running when you are logged out

curl http://localhost:8765/status   # → {"busy": 0, "sessions": [...]}
```

Already running Pi instances load the extension after `/reload`; new ones load it automatically.
The port can be changed with the `PI_STATUS_PORT` environment variable in the service file.
Make sure the PC can reach `http://<machine>:8765/status` (firewall).

## 2. Build and install the DeskThing app

```bash
npm install
npm run build          # → dist/pistatus
# close DeskThing (tray icon → Quit), then:
npm run deploy         # copies the app into DeskThing and registers it
```

Start DeskThing again and open **Pi Status** on the Car Thing.
To update an already installed app: `npm run build` then `npm run deploy -- --files` and restart DeskThing.

> Why not "upload zip"? DeskThing 0.11 has no reliable local-upload in its UI, so `deploy` copies the
> app into `%APPDATA%\deskthing\apps\pistatus` (Windows; `~/Library/Application Support/deskthing` on
> macOS, `~/.config/deskthing` on Linux, or set `DESKTHING_DIR`) and adds it to `apps.json`.

## 3. Settings (DeskThing → Apps → Pi Status)

| Setting | Meaning |
|---|---|
| Indirizzo stato Pi | URL of the status service, e.g. `http://pi-host.local:8765/status` |
| Spegni schermo dopo (minuti) | Car Thing screen sleep; `0` = never |
| Passa a Homelab sugli allarmi | switch to Stack Status when it reports a service down |
| Mascotte | mascot running on screen |

## How it works

- **Pi extension** (`vm/deskthing-status.ts`): listens to `agent_start`, `tool_execution_start/end`
  (questions) and `agent_settled`; writes one small JSON file per Pi process.
- **Status service** (`vm/pi-status-server.py`): serves those files as JSON and drops the ones of
  processes that no longer exist.
- **Screen sleep** (`app/server/screen-idle.sh`): pushed to the Car Thing over ADB into `/var`
  (the root filesystem is read-only) and started by the app; it watches the input devices and turns
  the backlight off/on. The app re-checks it every minute, so it survives reboots.
- The Car Thing clock is not synced: all times shown come from the PC.

## Troubleshooting

- **Knob/buttons stop working**: an app iframe had keyboard focus. The apps here never take focus
  on tap; restart the DeskThing client if it happens with other apps.
- **Icons do not change after an update**: DeskThing tells the Car Thing to cache icons for 24 h.
- **"VM non raggiungibile"**: check the URL in the settings and that port 8765 is reachable.

## Notes

- DeskThing 0.11 delivers `sendToApp` messages back to the sender, so Stack Status passes alerts
  through a file (`apps/homelab/alert.json`) that Pi Status watches.
- The mascot artwork in this repository (Robottina) is original pixel art.

#!/usr/bin/env python3
"""Publish the state of running Pi instances for the DeskThing "Pi Status" app.

Reads ~/.pi/agent/deskthing-status/<pid>.json (written by the
deskthing-status.ts Pi extension) and serves them as JSON on GET /status.
"""

import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

STATUS_DIR = Path.home() / ".pi" / "agent" / "deskthing-status"
PORT = int(os.environ.get("PI_STATUS_PORT", "8765"))


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def read_sessions():
    sessions = []
    if not STATUS_DIR.is_dir():
        return sessions
    for f in STATUS_DIR.glob("*.json"):
        try:
            data = json.loads(f.read_text())
            pid = int(data.get("pid", f.stem))
        except (OSError, ValueError):
            continue
        if not pid_alive(pid):
            # Pi crashed or was killed without session_shutdown.
            try:
                f.unlink()
            except OSError:
                pass
            continue
        sessions.append(data)
    sessions.sort(key=lambda s: (s.get("state") != "busy", str(s.get("label", "")).lower()))
    return sessions


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?")[0] not in ("/status", "/"):
            self.send_error(404)
            return
        sessions = read_sessions()
        body = json.dumps({
            "now": int(time.time() * 1000),
            "busy": sum(1 for s in sessions if s.get("state") == "busy"),
            "sessions": sessions,
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    STATUS_DIR.mkdir(parents=True, exist_ok=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()

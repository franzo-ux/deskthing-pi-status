/**
 * DeskThing status extension
 *
 * Writes this Pi instance's state (busy / idle) to
 * ~/.pi/agent/deskthing-status/<pid>.json so pi-status-server.py can
 * publish it to the Car Thing.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const DIR = join(homedir(), ".pi", "agent", "deskthing-status");
const FILE = join(DIR, `${process.pid}.json`);

type State = "idle" | "busy" | "asking";

// Tools that stop the run to ask the user something (pi-ask registers ask_user).
const ASK_TOOLS = new Set(["ask_user", "ask", "question"]);

// A run that ends with questions in the reply is waiting for the user too:
// the grilling skill ("❓ **Q1** - ...") or a last paragraph ending with "?".
function endsWithQuestion(text: string): boolean {
	if (/❓|\*\*Q\d+\*\*/.test(text)) return true;
	const paragraphs = text.trim().split(/\n\s*\n/);
	const last = (paragraphs[paragraphs.length - 1] || "").replace(/[\s*_`)\]]+$/, "");
	return last.endsWith("?");
}

function messageText(message: any): string {
	if (!message || message.role !== "assistant") return "";
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((c: any) => c && c.type === "text" && typeof c.text === "string")
		.map((c: any) => c.text)
		.join("\n");
}

function tmuxSession(): string | undefined {
	const pane = process.env.TMUX_PANE;
	if (!process.env.TMUX || !pane) return undefined;
	try {
		return execFileSync("tmux", ["display-message", "-p", "-t", pane, "#S"], {
			encoding: "utf8",
			timeout: 1000,
		}).trim() || undefined;
	} catch {
		return undefined;
	}
}

// If your launcher names tmux sessions "<prefix>-<name>", set the prefix here:
// renamed sessions keep it, so the launcher can still find them. Empty: the
// tmux session simply takes the Pi session name.
const TMUX_PREFIX = "";

/**
 * Give the tmux session the Pi session name (/name), with the characters
 * tmux and the launcher accept. Returns the new tmux name, or undefined if
 * Pi is not in tmux or tmux refused (e.g. another session has that name).
 */
function renameTmux(name: string): string | undefined {
	const pane = process.env.TMUX_PANE;
	if (!process.env.TMUX || !pane) return undefined;
	const clean = name.trim().replace(/[^A-Za-z0-9_-]/g, "_");
	if (!clean) return undefined;
	try {
		const current = execFileSync("tmux", ["display-message", "-p", "-t", pane, "#S"], { encoding: "utf8", timeout: 1000 }).trim();
		const safe = TMUX_PREFIX && current.startsWith(TMUX_PREFIX) ? TMUX_PREFIX + "-" + clean : clean;
		if (current === safe) return safe;
		execFileSync("tmux", ["rename-session", "-t", current, safe], { timeout: 1000 });
		return safe;
	} catch {
		return undefined;
	}
}

export default function (pi: ExtensionAPI) {
	let cwd = process.cwd();
	let tmux: string | undefined;
	let state: State = "idle";
	let since = Date.now();
	let lastDone: number | null = null;
	let active = false;
	const pendingQuestions = new Set<string>();
	let lastReply = "";
	let lastNames = "";
	let nameTimer: ReturnType<typeof setInterval> | null = null;

	const sessionName = (): string | undefined => {
		try {
			return pi.getSessionName() || undefined;
		} catch {
			return undefined;
		}
	};

	const write = () => {
		if (!active) return;
		const name = sessionName();
		lastNames = (name ?? "") + "|" + (tmux ?? "");
		const data = {
			pid: process.pid,
			label: name || tmux || basename(cwd), // /name in Pi wins over the tmux session
			session: name ?? null,
			tmux: tmux ?? null,
			cwd,
			state,
			since,
			lastDone,
			updated: Date.now(),
		};
		try {
			mkdirSync(DIR, { recursive: true });
			const tmp = `${FILE}.tmp`;
			writeFileSync(tmp, JSON.stringify(data));
			renameSync(tmp, FILE);
		} catch {
			// Status reporting must never disturb Pi.
		}
	};

	const setState = (next: State) => {
		if (next === "idle" && state !== "idle") lastDone = Date.now();
		if (next !== state) since = Date.now();
		state = next;
		write();
	};

	pi.on("session_start", async (_event, ctx) => {
		active = true;
		cwd = ctx.cwd;
		tmux = tmuxSession();
		// a resumed session that already has a name: give it to tmux too
		const named = sessionName();
		if (named) tmux = renameTmux(named) ?? tmux;
		state = "idle";
		since = Date.now();
		write();
		// The tmux session or the Pi session can be renamed at any time:
		// look again every 3 minutes and publish the new name.
		if (nameTimer) clearInterval(nameTimer);
		nameTimer = setInterval(() => {
			tmux = tmuxSession();
			if ((sessionName() ?? "") + "|" + (tmux ?? "") !== lastNames) write();
		}, 3 * 60 * 1000);
		nameTimer.unref?.();
	});

	// /name in Pi: rename the tmux session and update the Car Thing at once
	pi.on("session_info_changed", async (event) => {
		if (event.name) tmux = renameTmux(event.name) ?? tmuxSession();
		write();
	});

	pi.on("agent_start", async () => {
		lastReply = "";
		setState("busy");
	});

	pi.on("message_end", async (event) => {
		const text = messageText(event.message);
		if (text) lastReply = text;
	});

	// A question to the user pauses the run until it is answered.
	pi.on("tool_execution_start", async (event) => {
		if (!ASK_TOOLS.has(event.toolName)) return;
		pendingQuestions.add(event.toolCallId);
		setState("asking");
	});
	pi.on("tool_execution_end", async (event) => {
		if (!pendingQuestions.delete(event.toolCallId)) return;
		if (pendingQuestions.size === 0 && state === "asking") setState("busy");
	});

	// agent_end can be followed by retries or queued work; agent_settled is final.
	pi.on("agent_settled", async () => {
		pendingQuestions.clear();
		setState(endsWithQuestion(lastReply) ? "asking" : "idle");
	});

	pi.on("session_shutdown", async () => {
		active = false;
		if (nameTimer) clearInterval(nameTimer);
		nameTimer = null;
		try {
			rmSync(FILE, { force: true });
		} catch {
			// ignore
		}
	});
}

#!/usr/bin/env node
// Pingo CLI wrapper.
//
//   pingo <command> [...args]
//
// Launches the target agent inside a pseudo-terminal (PTY) so it behaves
// exactly as if run directly — interactive TUI agents like Claude Code see a
// real TTY. Pingo streams the agent's output to the terminal untouched,
// analyzes it in real time against the detection rules, and forwards matched
// events to the desktop app over a localhost WebSocket.

import * as fs from "fs";
import * as path from "path";
import * as pty from "@lydell/node-pty";
import WebSocket from "ws";
import { Detector, DEFAULT_RULES, Rule, DetectionResult } from "./detector";

const WS_URL = "ws://127.0.0.1:4001";
// Suppress repeat notifications of the same category within this window (ms)
// so a chatty agent doesn't spam the user.
const DEBOUNCE_MS = 2500;

function prettyAgentName(command: string): string {
  const base = (command.split(/[\\/]/).pop() ?? command).replace(
    /\.(exe|cmd|bat|sh|ps1|js)$/i,
    ""
  );
  if (!base) return command;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

// On Windows, a bare command like `claude` is usually a `.cmd`/`.ps1`/`.exe`
// shim on PATH. CreateProcess (used by the PTY) does not apply PATHEXT, so we
// resolve the real file ourselves and pick an appropriate launcher.
function resolveWindowsExecutable(command: string): string | null {
  if (path.isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    return fs.existsSync(command) ? command : null;
  }
  const exts = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((e) => e.trim())
    .filter(Boolean);
  const hasExt = exts.some((e) => command.toLowerCase().endsWith(e.toLowerCase()));
  const candidates = hasExt ? [command] : [...exts.map((e) => command + e), command];
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const cand of candidates) {
      const full = path.join(dir, cand);
      try {
        if (fs.statSync(full).isFile()) return full;
      } catch {
        /* not here */
      }
    }
  }
  return null;
}

function buildSpawn(command: string, args: string[]): { file: string; args: string[] } {
  if (process.platform !== "win32") {
    return { file: command, args };
  }
  const resolved = resolveWindowsExecutable(command);
  if (resolved && /\.(cmd|bat)$/i.test(resolved)) {
    return { file: process.env.ComSpec || "cmd.exe", args: ["/c", resolved, ...args] };
  }
  if (resolved && /\.ps1$/i.test(resolved)) {
    return {
      file: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolved, ...args],
    };
  }
  return { file: resolved || command, args };
}

class AppLink {
  private ws: WebSocket | null = null;
  private connected = false;
  private closing = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private onRules: (rules: Rule[]) => void;

  constructor(onRules: (rules: Rule[]) => void) {
    this.onRules = onRules;
  }

  connect(): void {
    if (this.closing) return;
    try {
      this.ws = new WebSocket(WS_URL);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.on("open", () => {
      this.connected = true;
      this.send({ type: "get_rules" });
    });

    this.ws.on("message", (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "rules" && Array.isArray(msg.data)) {
          this.onRules(msg.data as Rule[]);
        }
      } catch {
        /* ignore malformed frames */
      }
    });

    this.ws.on("close", () => {
      this.connected = false;
      this.scheduleReconnect();
    });

    // Swallow connection errors: the agent must keep running even if the
    // desktop app is closed.
    this.ws.on("error", () => {
      this.connected = false;
    });
  }

  private scheduleReconnect(): void {
    if (this.closing || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
  }

  send(payload: unknown): void {
    if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(payload));
      } catch {
        /* ignore */
      }
    }
  }

  close(): void {
    this.closing = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}

// Buffer partial lines so detection runs on complete lines of output.
function makeAnalyzer(
  detector: Detector,
  emit: (r: DetectionResult) => void
): (chunk: string) => void {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.search(/\r\n|\n|\r/)) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + (buffer[idx] === "\r" && buffer[idx + 1] === "\n" ? 2 : 1));
      const result = detector.detect(line);
      if (result) emit(result);
    }
    // Also detect on a long unterminated buffer (e.g. a prompt with no newline).
    if (buffer.length > 0) {
      const result = detector.detect(buffer);
      if (result) emit(result);
    }
    // Avoid unbounded growth if the agent never emits newlines.
    if (buffer.length > 8192) buffer = buffer.slice(-2048);
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(
      [
        "Pingo — get notified when your coding agent needs attention.",
        "",
        "Usage:",
        "  pingo <command> [...args]",
        "",
        "Examples:",
        "  pingo claude",
        "  pingo codex",
        "  pingo opencode",
        "  pingo aider",
        "  pingo gemini",
        "",
      ].join("\n")
    );
    process.exit(argv.length === 0 ? 1 : 0);
  }

  const command = argv[0];
  const commandArgs = argv.slice(1);
  const agent = prettyAgentName(command);
  const startTime = new Date().toISOString();

  const detector = new Detector();
  detector.setRules(DEFAULT_RULES);

  const link = new AppLink((rules) => detector.setRules(rules));
  link.connect();

  const { file, args } = buildSpawn(command, commandArgs);
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  let child: pty.IPty;
  try {
    child = pty.spawn(file, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: process.cwd(),
      env: process.env as { [key: string]: string },
    });
  } catch (err) {
    process.stderr.write(
      `pingo: failed to start ${command}: ${(err as Error).message}\n`
    );
    link.close();
    process.exit(127);
  }

  const childPid = child.pid ?? 0;
  link.send({
    type: "status",
    data: {
      agent,
      pid: childPid,
      status: "running",
      start_time: startTime,
      last_activity: startTime,
    },
  });

  const lastFired: Record<string, number> = {};
  function emit(result: DetectionResult): void {
    const now = Date.now();
    const last = lastFired[result.category] ?? 0;
    if (now - last < DEBOUNCE_MS) return;
    lastFired[result.category] = now;

    link.send({
      type: "status",
      data: {
        agent,
        pid: childPid,
        status:
          result.category === "permission" || result.category === "authentication"
            ? "waiting"
            : result.category === "error"
              ? "error"
              : "running",
        start_time: startTime,
        last_activity: new Date().toISOString(),
      },
    });

    const message =
      result.line.length > 200 ? result.line.slice(0, 197) + "..." : result.line;
    link.send({
      type: "event",
      data: {
        agent,
        event_type: result.category,
        message: message || result.ruleName,
        priority: result.priority,
      },
    });
  }

  const analyze = makeAnalyzer(detector, emit);

  // Stream the PTY output to the terminal untouched while analyzing it.
  child.onData((data: string) => {
    process.stdout.write(data);
    analyze(data);
  });

  // Forward terminal input to the child. Raw mode passes individual keystrokes
  // (including Ctrl+C, arrows, Enter) straight through so the agent's TUI works.
  const stdin = process.stdin;
  if (stdin.isTTY && typeof stdin.setRawMode === "function") {
    stdin.setRawMode(true);
  }
  stdin.resume();
  const onStdin = (data: Buffer) => {
    try {
      child.write(data.toString("utf8"));
    } catch {
      /* child gone */
    }
  };
  stdin.on("data", onStdin);

  // Keep the PTY size in sync with the real terminal.
  const onResize = () => {
    try {
      child.resize(process.stdout.columns || 80, process.stdout.rows || 24);
    } catch {
      /* ignore */
    }
  };
  process.stdout.on("resize", onResize);

  // Forward termination signals to the child.
  process.on("SIGINT", () => {
    try {
      child.write("\x03");
    } catch {
      /* ignore */
    }
  });
  process.on("SIGTERM", () => {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  });

  child.onExit(({ exitCode }) => {
    link.send({
      type: "status",
      data: {
        agent,
        pid: childPid,
        status: "idle",
        start_time: startTime,
        last_activity: new Date().toISOString(),
      },
    });
    link.close();

    stdin.removeListener("data", onStdin);
    if (stdin.isTTY && typeof stdin.setRawMode === "function") {
      stdin.setRawMode(false);
    }
    stdin.pause();
    process.stdout.removeListener("resize", onResize);

    // Give the WebSocket a moment to flush the final frames.
    setTimeout(() => process.exit(exitCode ?? 0), 80);
  });
}

main();

#!/usr/bin/env node
// Pingo CLI wrapper.
//
//   pingo <command> [...args]
//
// Launches the target agent, streams its stdout/stderr to the terminal
// untouched, analyzes the output in real time against the detection rules,
// and forwards matched events to the Pingo desktop app over a localhost
// WebSocket. The user experience is identical to running the agent directly.

import spawn from "cross-spawn";
import WebSocket from "ws";
import { Detector, DEFAULT_RULES, Rule, DetectionResult } from "./detector";

const WS_URL = "ws://127.0.0.1:4001";
// Suppress repeat notifications of the same category within this window (ms)
// so a chatty agent doesn't spam the user.
const DEBOUNCE_MS = 2500;

function prettyAgentName(command: string): string {
  const base = (command.split(/[\\/]/).pop() ?? command)
    .replace(/\.(exe|cmd|bat|sh|js)$/i, "");
  if (!base) return command;
  return base.charAt(0).toUpperCase() + base.slice(1);
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

  const child = spawn(command, commandArgs, {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  child.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") {
      process.stderr.write(`pingo: command not found: ${command}\n`);
    } else {
      process.stderr.write(`pingo: failed to start ${command}: ${err.message}\n`);
    }
    link.close();
    process.exit(127);
  });

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

  // Forward terminal input to the child. Raw mode passes individual keystrokes
  // (and Ctrl+C, Enter, etc.) straight through so interactive prompts work.
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  if (child.stdin) {
    process.stdin.pipe(child.stdin);
    child.stdin.on("error", () => {
      /* child closed stdin — ignore EPIPE */
    });
  }

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

    const message = result.line.length > 200 ? result.line.slice(0, 197) + "..." : result.line;
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

  // Buffer partial lines per stream so detection runs on complete lines.
  function makeAnalyzer(): (chunk: Buffer) => void {
    let buffer = "";
    return (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let idx: number;
      while ((idx = buffer.search(/\r\n|\n|\r/)) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + (buffer[idx] === "\r" && buffer[idx + 1] === "\n" ? 2 : 1));
        const result = detector.detect(line);
        if (result) emit(result);
      }
      // Detect on a long unterminated buffer too (e.g. a prompt with no newline).
      if (buffer.length > 0) {
        const result = detector.detect(buffer);
        if (result) emit(result);
      }
    };
  }

  const analyzeStdout = makeAnalyzer();
  const analyzeStderr = makeAnalyzer();

  child.stdout?.on("data", (chunk: Buffer) => {
    process.stdout.write(chunk);
    analyzeStdout(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
    analyzeStderr(chunk);
  });

  // Forward termination signals to the child.
  const forward = (signal: NodeJS.Signals) => () => {
    try {
      child.kill(signal);
    } catch {
      /* ignore */
    }
  };
  process.on("SIGINT", forward("SIGINT"));
  process.on("SIGTERM", forward("SIGTERM"));

  child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
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

    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();

    // Give the WebSocket a moment to flush the final frames.
    setTimeout(() => {
      if (signal) {
        process.exit(1);
      } else {
        process.exit(code ?? 0);
      }
    }, 80);
  });
}

main();

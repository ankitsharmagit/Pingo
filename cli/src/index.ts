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
import * as os from "os";
import * as path from "path";
import { exec } from "child_process";
import * as pty from "@lydell/node-pty";
import WebSocket from "ws";
import { Detector, DEFAULT_RULES, Rule, DetectionResult } from "./detector";

const WS_URL = "ws://127.0.0.1:4001";
// Suppress repeat notifications of the same category within this window (ms)
// so a chatty agent doesn't spam the user.
const DEBOUNCE_MS = 1500;

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
  connected = false;
  private closing = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private onRules: (rules: Rule[]) => void;
  private onIgnorePatterns: (patterns: string[]) => void;

  constructor(onRules: (rules: Rule[]) => void, onIgnorePatterns: (patterns: string[]) => void) {
    this.onRules = onRules;
    this.onIgnorePatterns = onIgnorePatterns;
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
        if (msg.type === "rules") {
          if (Array.isArray(msg.data)) {
            this.onRules(msg.data as Rule[]);
          }
          if (Array.isArray(msg.ignore_patterns)) {
            this.onIgnorePatterns(msg.ignore_patterns);
          }
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

// ── Config ──────────────────────────────────────────────────────────────
const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8")) as { version: string };

interface PingoConfig {
  notify: "voice" | "sound" | "both" | "none";
}

function configPath(): string {
  const dir = process.env.APPDATA
    ? path.join(process.env.APPDATA, "pingo")
    : path.join(os.homedir(), ".config", "pingo");
  return path.join(dir, "config.json");
}

function loadConfig(): PingoConfig {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    return JSON.parse(raw) as PingoConfig;
  } catch {
    return { notify: "voice" };
  }
}

function saveConfig(cfg: PingoConfig): void {
  const p = configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
}

function setupWizard(): void {
  const rl = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  process.stdout.write(
    [
      "",
      "╔══════════════════════════════════════╗",
      "║       Pingo — Notification Setup     ║",
      "╚══════════════════════════════════════╝",
      "",
      "How would you like to be notified when your agent needs attention?",
      "",
      "  1) Voice  — speaks the event aloud (e.g. \"Permission required\")",
      "  2) Sound  — plays a WAV notification sound",
      "  3) Both   — voice + sound together",
      "  4) None   — no audio notifications (desktop app only)",
      "",
      "(or press Enter to keep current)",
      "",
      "Enter 1, 2, 3, or 4: ",
    ].join("\n")
  );
  rl.on("line", (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) { rl.close(); return; }
    const map: Record<string, "voice" | "sound" | "both" | "none"> = {
      "1": "voice", "2": "sound", "3": "both", "4": "none",
    };
    const choice = map[trimmed];
    if (choice) {
      saveConfig({ notify: choice });
      const label = choice === "both" ? "voice and sound" : choice === "none" ? "no audio" : choice;
      process.stdout.write(`\nSaved! You'll get ${label} notifications. Restart your agent to apply settings.\n`);
      rl.close();
    } else {
      process.stdout.write("Please enter 1, 2, or 3: ");
    }
  });
}

// ── Doctor ──────────────────────────────────────────────────────────────
async function cmdDoctor(): Promise<void> {
  const ok: string[] = [];
  const fail: string[] = [];

  // CLI version
  ok.push(`CLI installed  (v${PKG.version})`);

  // Config
  const cfg = loadConfig();
  ok.push(`Notifications  (${cfg.notify})`);

  // Desktop WebSocket
  try {
    const ws = new WebSocket(WS_URL);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => { ws.close(); resolve(); };
      ws.onerror = () => reject(new Error("connection refused"));
      setTimeout(() => reject(new Error("timeout")), 3000);
    });
    ok.push("Desktop app    connected");
  } catch {
    fail.push("Desktop app    not reachable  (run desktop app or use CLI standalone)");
  }

  // Audio
  try {
    await new Promise<void>((resolve, reject) => {
      exec(
        `powershell -NoProfile -c "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('test'); [Console]::Beep(800,100)"`,
        (err) => { err ? reject(err) : resolve(); }
      );
    });
    ok.push("Audio          working");
  } catch {
    fail.push("Audio          not available");
  }

  process.stdout.write("\n  Pingo Doctor\n  ============\n\n");
  for (const m of ok) process.stdout.write(`  ✓ ${m}\n`);
  for (const m of fail) process.stdout.write(`  ✗ ${m}\n`);
  process.stdout.write("\n");
  process.exit(fail.length > 0 ? 1 : 0);
}

// ── Test ─────────────────────────────────────────────────────────────────
function cmdTest(): void {
  const cfg = loadConfig();
  process.stdout.write("  Sending test notification…\n");

  if (cfg.notify === "voice" || cfg.notify === "both") {
    exec(
      `powershell -NoProfile -c "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('Pingo test notification')"`,
    );
  }
  if (cfg.notify === "sound" || cfg.notify === "both") {
    exec(
      `powershell -NoProfile -c "(New-Object Media.SoundPlayer '$env:WINDIR\\media\\Windows Notify.wav').PlaySync()"`,
    );
  }
  if (cfg.notify === "none") {
    process.stdout.write("  (notifications disabled — run `pingo setup` to enable)\n");
  }
  process.stdout.write("  Done.\n");
}

// ── Known agents ─────────────────────────────────────────────────────────
const KNOWN_AGENTS: { name: string; desc: string }[] = [
  { name: "claude", desc: "Claude Code" },
  { name: "opencode", desc: "OpenCode" },
  { name: "codex", desc: "Codex CLI" },
  { name: "gemini", desc: "Gemini CLI" },
  { name: "aider", desc: "Aider" },
  { name: "cursor", desc: "Cursor" },
];

function findOnPath(name: string): boolean {
  if (process.platform !== "win32") {
    const dirs = (process.env.PATH || "").split(":").filter(Boolean);
    for (const dir of dirs) {
      const full = path.join(dir, name);
      try { if (fs.statSync(full).isFile()) return true; } catch {}
    }
    return false;
  }
  const exts = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").map((e) => e.trim()).filter(Boolean);
  const hasExt = exts.some((e) => name.toLowerCase().endsWith(e.toLowerCase()));
  const candidates = hasExt ? [name] : [...exts.map((e) => name + e), name];
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const cand of candidates) {
      const full = path.join(dir, cand);
      try { if (fs.statSync(full).isFile()) return true; } catch {}
    }
  }
  return false;
}

function cmdDiscover(): void {
  process.stdout.write("\n  Scanning PATH for known agents…\n\n");
  let found = 0;
  for (const agent of KNOWN_AGENTS) {
    const installed = findOnPath(agent.name);
    if (installed) found++;
    process.stdout.write(
      `  ${installed ? "✓" : " "}  ${agent.name.padEnd(12)} ${agent.desc}\n`
    );
  }
  process.stdout.write(`\n  ${found} of ${KNOWN_AGENTS.length} agents found.\n\n`);
  if (found > 0) {
    process.stdout.write("  Run any detected agent:\n\n");
    for (const agent of KNOWN_AGENTS) {
      if (findOnPath(agent.name)) {
        process.stdout.write(`    pingo ${agent.name.padEnd(12)} ${agent.desc}\n`);
      }
    }
    process.stdout.write("\n");
  }
}

function cmdInit(): void {
  process.stdout.write(
    [
      "",
      "╔══════════════════════════════════════╗",
      "║       Pingo — First-Time Setup      ║",
      "╚══════════════════════════════════════╝",
      "",
    ].join("\n")
  );

  // Discover agents
  const detected: { name: string; desc: string }[] = [];
  process.stdout.write("  Scanning for installed agents…\n\n");
  for (const agent of KNOWN_AGENTS) {
    const installed = findOnPath(agent.name);
    if (installed) detected.push(agent);
    process.stdout.write(`  ${installed ? "✓" : " "}  ${agent.name.padEnd(12)} ${agent.desc}\n`);
  }

  process.stdout.write(`\n  ${detected.length} agent(s) detected.\n\n`);

  if (detected.length > 0) {
    process.stdout.write("  Ready to start. Run:\n\n");
    for (const agent of detected) {
      process.stdout.write(`    pingo ${agent.name.padEnd(12)} ${agent.desc}\n`);
    }
    process.stdout.write("\n");
  } else {
    process.stdout.write(
      "  No coding agents found on your PATH.\n" +
      "  Install one first, or run any command with:\n" +
      "    pingo <your-command>\n\n"
    );
  }

  // Run the notification setup wizard
  const rl = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  process.stdout.write("  ── Notification Setup ──\n\n");
  process.stdout.write(
    "  How would you like to be notified?\n\n" +
    "    1) Voice  — speaks events aloud\n" +
    "    2) Sound  — plays notification sounds (default)\n" +
    "    3) Both   — voice + sound\n" +
    "    4) None   — silent\n\n" +
    "  Enter 1-4 (or press Enter for defaults): "
  );
  rl.on("line", (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) {
      saveConfig({ notify: "sound" });
      process.stdout.write("\n  Saved! Using sound notifications.\n");
      rl.close();
      return;
    }
    const map: Record<string, "voice" | "sound" | "both" | "none"> = {
      "1": "voice", "2": "sound", "3": "both", "4": "none",
    };
    const choice = map[trimmed];
    if (choice) {
      saveConfig({ notify: choice });
      const label = choice === "both" ? "voice and sound" : choice === "none" ? "no audio" : choice;
      process.stdout.write(`\n  Saved! You'll get ${label} notifications.\n`);
      rl.close();
    } else {
      process.stdout.write("  Please enter 1, 2, 3, or 4: ");
    }
  });
}

function main(): void {
  const argv = process.argv.slice(2);

  if (argv[0] === "setup") {
    setupWizard();
    return;
  }

  if (argv[0] === "doctor") {
    cmdDoctor();
    return;
  }

  if (argv[0] === "test") {
    cmdTest();
    return;
  }

  if (argv[0] === "discover") {
    cmdDiscover();
    return;
  }

  if (argv[0] === "init") {
    cmdInit();
    return;
  }

  if (argv[0] === "--version" || argv[0] === "-v") {
    process.stdout.write(`${PKG.version}\n`);
    return;
  }

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(
      [
        "Pingo — get notified when your coding agent needs attention.",
        "",
        "Usage:",
        "  pingo <command> [...args]    monitor a coding agent",
        "  pingo setup                 configure notifications (voice / sound / both / none)",
        "  pingo doctor                diagnose installation",
        "  pingo test                  send a test notification",
        "  pingo discover              scan PATH for known coding agents",
        "  pingo init                  first-time setup wizard (discover + configure)",
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
    // First-run: prompt setup if no config exists.
    try {
      fs.accessSync(configPath());
    } catch {
      process.stdout.write("\nFirst run detected! Run `pingo init` for guided setup.\n");
    }
    process.exit(argv.length === 0 ? 1 : 0);
  }

  const command = argv[0];
  const commandArgs = argv.slice(1);
  const agent = prettyAgentName(command);
  const startTime = new Date().toISOString();

  const detector = new Detector();
  detector.setAgentName(agent.toLowerCase());
  detector.setRules(DEFAULT_RULES);

  const link = new AppLink(
    (rules) => detector.setRules(rules),
    (patterns) => detector.setIgnorePatterns(patterns)
  );
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

  // ── Notification: voice (TTS) ──────────────────────────────────────────
  const MAX_QUEUE = 16;
  const voiceQueue: string[] = [];
  let voiceBusy = false;
  function speakQueued(): void {
    if (voiceBusy || voiceQueue.length === 0) return;
    voiceBusy = true;
    const phrase = voiceQueue.shift()!;
    exec(
      `powershell -NoProfile -c "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${phrase}')"`,
      () => { voiceBusy = false; speakQueued(); }
    );
  }
  function speakPhrase(category: string): void {
    const map: Record<string, string> = {
      permission: `${agent} needs permission`,
      success: `${agent} completed a task`,
      error: `${agent} hit an error`,
      authentication: `${agent} needs authentication`,
      ratelimit: `${agent} hit a rate limit`,
      input: `${agent} is waiting for input`,
    };
    if (voiceQueue.length >= MAX_QUEUE) voiceQueue.shift();
    voiceQueue.push(map[category] ?? `${agent} needs attention`);
    speakQueued();
  }

  // ── Notification: WAV sound ────────────────────────────────────────────
  const soundQueue: string[] = [];
  let soundBusy = false;
  function playQueued(): void {
    if (soundBusy || soundQueue.length === 0) return;
    soundBusy = true;
    const wav = soundQueue.shift()!;
    exec(
      `powershell -NoProfile -c "(New-Object Media.SoundPlayer '${wav}').PlaySync()"`,
      () => { soundBusy = false; playQueued(); }
    );
  }
  function playSound(category: string): void {
    const map: Record<string, string> = {
      permission: "Windows Exclamation.wav",
      success: "Windows Notify.wav",
      error: "Windows Critical Stop.wav",
      authentication: "Windows Exclamation.wav",
      ratelimit: "Windows Critical Stop.wav",
      input: "Windows Foreground.wav",
    };
    if (soundQueue.length >= MAX_QUEUE) soundQueue.shift();
    soundQueue.push(`${process.env.WINDIR}\\media\\${map[category] ?? "Windows Notify.wav"}`);
    playQueued();
  }

  // ── Notification: dispatch based on config ─────────────────────────────
  const notifCfg = loadConfig();
  function notify(category: string): void {
    if (notifCfg.notify === "none") return;
    if (notifCfg.notify === "voice" || notifCfg.notify === "both") speakPhrase(category);
    if (notifCfg.notify === "sound" || notifCfg.notify === "both") playSound(category);
  }

  const lastFired: Record<string, number> = {};
  let lastOutputTime = Date.now();
  let repeatTimer: NodeJS.Timeout | null = null;
  function clearRepeat(): void {
    if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = null; }
  }
  function emit(result: DetectionResult): void {
    const now = Date.now();
    const key = `${result.category}:${result.matchedPattern}`;
    const last = lastFired[key] ?? 0;
    if (now - last < DEBOUNCE_MS) return;
    lastFired[key] = now;

    // Only fire input/permission if agent has been quiet for 500ms+.
    // This avoids false triggers from mid-reasoning text that happens to
    // match a pattern while the agent is still generating output.
    if ((result.category === "input" || result.category === "permission") && now - lastOutputTime < 500) return;

    if (!link.connected) {
      notify(result.category);
      // Repeat permission/authentication every 5s until user responds.
      if ((result.category === "permission" || result.category === "authentication") && !repeatTimer) {
        repeatTimer = setInterval(() => notify(result.category), 5000);
      }
      // Non-blocking categories cancel the repeat.
      if (result.category !== "permission" && result.category !== "authentication") {
        clearRepeat();
      }
    }

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
    lastOutputTime = Date.now();
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
    clearRepeat();
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
    clearRepeat();
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

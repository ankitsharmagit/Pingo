// Passive terminal monitor — the heart of the extension-first design.
//
// Users keep typing `claude` / `opencode` / `codex` / `gemini` / `aider`
// exactly as before. VS Code's stable Shell Integration API lets us read the
// terminal's output stream live (onDidStartTerminalShellExecution + read()).
//
// A coding agent is a full-screen TUI: it repaints with cursor-addressing, so
// stripping ANSI from the raw stream yields scrambled fragments. Instead we
// feed the byte stream into a headless terminal emulator (@xterm/headless),
// which reconstructs the actual screen grid. We then read the rendered lines —
// clean, in reading order — and run the shared Detector over them.
//
// No CLI, no localhost server, no WebSocket required.

import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { Terminal } from "@xterm/headless";
import { Detector, DEFAULT_RULES, type DetectionResult } from "@pingo/detector";
import type { PingoEvent, StatusUpdate, EventType } from "@pingo/shared";

export interface MonitorHandlers {
  // `terminal` is the agent's terminal, so the presentation layer can decide
  // whether you're actually looking at *this* agent (vs another tab/window).
  onEvent: (event: PingoEvent, terminal?: vscode.Terminal) => void;
  onStatus: (status: StatusUpdate) => void;
  // The agent's execution ended (it exited or its terminal closed) — any held
  // alert for this terminal should be cleared, not fired.
  onAgentEnd?: (terminal: vscode.Terminal) => void;
}

// Diagnostic log: session starts and every detection are always recorded;
// when debug is on, the full reconstructed screen is dumped each scan so we can
// see exactly what each agent renders and tune detection patterns.
const MONITOR_LOG = path.join(os.tmpdir(), "pingo-monitor.log");
function monLog(line: string): void {
  try {
    fs.appendFileSync(MONITOR_LOG, `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    /* ignore */
  }
}

// Agents we recognise on the command line. Keep in sync with the CLI's
// KNOWN_AGENTS (cli/src/index.ts).
const KNOWN_AGENTS: Record<string, string> = {
  claude: "Claude",
  opencode: "OpenCode",
  codex: "Codex",
  gemini: "Gemini",
  aider: "Aider",
};

// Emulator grid. We don't get the real terminal's dimensions from the stable
// API, so use a generous grid to avoid clipping/misalignment of reconstructed
// lines. Scrollback lets us also catch text that scrolled just out of view.
const EMU_COLS = 220;
const EMU_ROWS = 50;
const EMU_SCROLLBACK = 200;

// Serialize the reconstructed screen this long after the last write settles.
// A settled screen means a displayed prompt is real, not mid-render.
const SETTLE_MS = 250;

// Suppress repeats of the same detection (category+pattern) within this window
// so a constantly-repainting TUI doesn't spam notifications.
const DEBOUNCE_MS = 4000;

// Pull the agent name out of a command line like "opencode --port 31374" or
// "C:\\bin\\claude.cmd". Returns the pretty name, or null if not a known agent
// (or if it's a `pingo …` wrapper, which the optional CLI path handles).
function agentFromCommand(commandLine: string): string | null {
  const trimmed = commandLine.trim();
  if (!trimmed) return null;
  const firstToken = trimmed.split(/\s+/)[0];
  const base = (firstToken.split(/[\\/]/).pop() ?? firstToken)
    .replace(/\.(exe|cmd|bat|ps1|sh|js)$/i, "")
    .toLowerCase();
  if (base === "pingo") return null; // fallback path owns wrapped sessions
  return KNOWN_AGENTS[base] ?? null;
}

// Detect an agent from a terminal we didn't see start (the re-attach path).
// We can't read its command line via the stable API, so infer from the two
// signals we do have: the terminal's name (VS Code often derives it from the
// launched command) and creationOptions.shellPath (for terminals the host or
// another extension launched with an explicit shell).
function agentFromTerminal(t: vscode.Terminal): string | null {
  const fromName = agentFromCommand(t.name);
  if (fromName) return fromName;
  const opts = t.creationOptions as { shellPath?: string; name?: string } | undefined;
  if (opts?.shellPath) {
    const fromShell = agentFromCommand(opts.shellPath);
    if (fromShell) return fromShell;
  }
  return null;
}

// One emulator + detector per running agent execution.
class Session {
  private term: Terminal;
  private detector = new Detector();
  private settleTimer: NodeJS.Timeout | null = null;
  private lastFired: Record<string, number> = {};
  private disposed = false;

  constructor(
    readonly agent: string,
    private handlers: MonitorHandlers,
    ignorePatterns: string[],
    private debug: boolean,
    readonly terminal: vscode.Terminal
  ) {
    this.term = new Terminal({
      cols: EMU_COLS,
      rows: EMU_ROWS,
      scrollback: EMU_SCROLLBACK,
      allowProposedApi: true,
    });
    this.detector.setRules(DEFAULT_RULES);
    this.detector.setAgentName(agent.toLowerCase());
    this.detector.setIgnorePatterns(ignorePatterns);
  }

  write(chunk: string): void {
    if (this.disposed) return;
    this.term.write(chunk);
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => this.scan(), SETTLE_MS);
  }

  // Read the reconstructed visible screen (plus a little scrollback) and run
  // detection on each rendered line.
  private scan(): void {
    if (this.disposed) return;
    const buf = this.term.buffer.active;
    // Scan from a bit above the viewport down to the cursor row, so we catch
    // recently-scrolled output as well as the current screen.
    const start = Math.max(0, buf.viewportY - EMU_SCROLLBACK);
    const end = buf.baseY + this.term.rows;
    const screen: string[] = [];
    for (let y = start; y < end; y++) {
      const line = buf.getLine(y);
      if (!line) continue;
      const text = line.translateToString(true);
      if (!text.trim()) continue;
      if (this.debug) screen.push(text.trimEnd());
      const result = this.detector.detect(text);
      if (result) this.emit(result);
    }
    if (this.debug && screen.length) {
      monLog(`--- ${this.agent} reconstructed screen (${screen.length} lines) ---\n${screen.join("\n")}`);
    }
  }

  private emit(result: DetectionResult): void {
    const now = Date.now();
    const key = `${result.category}:${result.matchedPattern}`;
    if (now - (this.lastFired[key] ?? 0) < DEBOUNCE_MS) return;
    this.lastFired[key] = now;

    if (this.debug) monLog(`DETECT ${this.agent}: category=${result.category} pattern="${result.matchedPattern}" line="${result.line}"`);

    const category = result.category as EventType;
    const status: StatusUpdate["status"] =
      category === "permission" || category === "authentication"
        ? "waiting"
        : category === "error"
          ? "error"
          : "running";
    this.handlers.onStatus({
      agent: this.agent,
      pid: 0,
      status,
      startTime: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    });

    const message =
      result.line.length > 200 ? result.line.slice(0, 197) + "..." : result.line;
    this.handlers.onEvent(
      {
        agent: this.agent,
        type: category,
        message: message || result.ruleName,
        priority: result.priority as PingoEvent["priority"],
        timestamp: new Date().toISOString(),
      },
      this.terminal
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    try {
      this.term.dispose();
    } catch {
      /* ignore */
    }
  }
}

export class TerminalMonitor {
  private subs: vscode.Disposable[] = [];
  private sessions = new Map<vscode.TerminalShellExecution, Session>();
  // Agents detected on existing terminals (post-reload re-attach), so we don't
  // mark them "running" twice and can clear status when they close.
  private attached = new Map<vscode.Terminal, string>();
  private enabled = true;
  private ignorePatterns: string[] = [];
  private debug = false;

  constructor(private handlers: MonitorHandlers) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.endAll();
  }

  setIgnorePatterns(patterns: string[]): void {
    this.ignorePatterns = patterns;
  }

  setDebug(debug: boolean): void {
    this.debug = debug;
  }

  start(): void {
    this.subs.push(
      vscode.window.onDidStartTerminalShellExecution((e) => this.onStart(e)),
      vscode.window.onDidEndTerminalShellExecution((e) => this.onEnd(e.execution))
    );
    // After a window reload, terminals that were already running an agent are
    // invisible to onDidStartTerminalShellExecution (that only fires for
    // executions started after we listen). Recovering the *agent* is possible;
    // recovering its *past output* is not (the stable API offers no way to read
    // a terminal's history — only future chunks via execution.read()). So we
    // do best-effort recovery: detect the agent from the terminal's name/launch
    // command and mark it running so the status bar + away-gate track it, then
    // rely on a later live shell execution (e.g. the agent's next command, or a
    // resumed session) to start full output scanning.
    this.rescan();
    this.subs.push(vscode.window.onDidOpenTerminal((t) => this.considerAttach(t)));
    this.subs.push(
      vscode.window.onDidCloseTerminal((t) => {
        this.attached.delete(t);
      })
    );
  }

  // Best-effort re-attach of existing terminals on activation (and for ones the
  // user opens later but which already had an agent running before Pingo
  // started, e.g. opening a terminal with an agent mid-conversation). We detect
  // the agent from the terminal name (VS Code derives it from the launched
  // command) or its creationOptions shellPath. We canNOT scan its prior output
  // — only mark it running so alerts/gating still work and a future live
  // execution will pick up full scanning.
  rescan(): void {
    if (!this.enabled) return;
    for (const t of vscode.window.terminals) this.considerAttach(t);
  }

  private considerAttach(t: vscode.Terminal): void {
    if (!this.enabled) return;
    if (this.attached.has(t)) return;
    const agent = agentFromTerminal(t);
    if (this.debug) monLog(`RESCAN terminal name="${t.name}" → agent=${agent ?? "(ignored)"}`);
    if (!agent) return;
    this.attached.set(t, agent);
    this.handlers.onStatus({
      agent,
      pid: 0,
      status: "running",
      startTime: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    });
  }

  private onStart(e: vscode.TerminalShellExecutionStartEvent): void {
    if (!this.enabled) return;
    const cmd = e.execution.commandLine?.value ?? "";
    const agent = agentFromCommand(cmd);
    if (this.debug) monLog(`EXEC START command="${cmd}" → agent=${agent ?? "(ignored)"}`);
    if (!agent) return;

    const session = new Session(agent, this.handlers, this.ignorePatterns, this.debug, e.terminal);
    this.sessions.set(e.execution, session);

    this.handlers.onStatus({
      agent,
      pid: 0,
      status: "running",
      startTime: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    });

    // Drain the live output stream into the emulator. read() yields chunks as
    // the agent produces them; the loop ends when the execution ends.
    void (async () => {
      try {
        for await (const data of e.execution.read()) {
          session.write(data);
        }
      } catch {
        /* stream ended or errored — onEnd handles cleanup */
      }
    })();
  }

  private onEnd(execution: vscode.TerminalShellExecution): void {
    const session = this.sessions.get(execution);
    if (!session) return;
    this.sessions.delete(execution);
    this.handlers.onStatus({
      agent: session.agent,
      pid: 0,
      status: "idle",
      startTime: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    });
    this.handlers.onAgentEnd?.(session.terminal);
    session.dispose();
  }

  private endAll(): void {
    for (const session of this.sessions.values()) session.dispose();
    this.sessions.clear();
  }

  dispose(): void {
    this.endAll();
    for (const sub of this.subs) sub.dispose();
    this.subs = [];
  }
}

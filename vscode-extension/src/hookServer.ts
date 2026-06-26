// Coding-agent hook bridge.
//
// The Claude Code VS Code extension runs `claude` in its own pseudoterminal —
// no shell — so VS Code's Shell Integration API can't see it and the passive
// TerminalMonitor is blind to it. Claude Code's first-class hooks system is the
// supported signal: it can POST to an HTTP endpoint on `Notification` (permission
// / idle / auth / rate-limit) and `Stop` (turn finished) events.
//
// This hosts a tiny localhost listener that turns those POSTs into the same
// PingoEvent / StatusUpdate the rest of the extension consumes. No CLI, no
// WebSocket — just an in-process HTTP server bound to 127.0.0.1.
//
// It's agent-agnostic: a HookMap describes how an agent's hook payloads map to
// Pingo event categories. Claude's map ships built-in; other agents (Codex,
// Gemini, …) can register their own via setHookMap / registerAgent so the same
// server works for everyone.

import * as http from "http";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import type { PingoEvent, StatusUpdate, EventType, Priority } from "@pingo/shared";

export interface HookHandlers {
  onEvent: (event: PingoEvent) => void;
  onStatus: (status: StatusUpdate) => void;
  // The agent's turn ended → any held alert for it is resolved (clear silently).
  onResolve: (agent: string) => void;
}

// Notification-type → Pingo event category. `null` means "genuinely ignore"
// (we never want an event for it). Built-in map mirrors what Claude Code emits.
const CLAUDE_HOOK_MAP: HookMap = {
  permission_prompt: "permission",
  idle_prompt: "input",
  auth_success: "success",
  rate_limit: "ratelimit",
  ratelimit: "ratelimit",
};

// A hook payload's field layout, per agent. Defaults assume Claude Code's
// schema ({ hook_event_name, notification_type, message }). Other agents can
// override the field names and/or provide their own notification-type map.
export interface HookSchema {
  // Field carrying the hook event name ("Notification", "Stop", …).
  eventField?: string;
  // Field carrying the notification sub-type ("permission_prompt", …).
  notificationField?: string;
  // Field carrying the human-readable message.
  messageField?: string;
  // Field carrying the agent name, if the payload identifies it.
  agentField?: string;
  // Value of `eventField` that means "an attention/notification event".
  notifyEvent?: string;
  // Value of `eventField` that means "the turn ended" → resolve.
  stopEvent?: string;
  // notification-type → EventType (or null to ignore).
  map?: HookMap;
}

type HookMap = Record<string, EventType | null>;

const DEFAULT_SCHEMA: Required<HookSchema> = {
  eventField: "hook_event_name",
  notificationField: "notification_type",
  messageField: "message",
  agentField: "agent",
  notifyEvent: "Notification",
  stopEvent: "Stop",
  map: CLAUDE_HOOK_MAP,
};

// Diagnostic log of every hook POST, so we can see exactly what an agent sends
// (event name, notification_type) and when. Only written when debug is on
// (pingo.debug) — off by default so nothing is logged to disk in normal use.
const HOOK_LOG = path.join(os.tmpdir(), "pingo-hooks.log");
function hookLog(line: string): void {
  try {
    fs.appendFileSync(HOOK_LOG, `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    /* ignore */
  }
}

export type HookServerStatus = "listening" | "port-in-use" | "stopped" | "error";

export interface HookServerOptions {
  // Pretty agent name used when a payload doesn't identify itself. "Claude" by
  // default for backward compatibility.
  defaultAgent?: string;
  schema?: HookSchema;
  // Notified whenever the server's listening state changes — lets the host
  // surface "port in use" / errors in the status bar instead of failing silently.
  onStatusChange?: (status: HookServerStatus, info?: string) => void;
}

export class ClaudeHookServer {
  private server: http.Server | null = null;
  private listening = false;
  private status: HookServerStatus = "stopped";
  private currentPort: number;
  private defaultAgent: string;
  private schema: Required<HookSchema>;
  // Extra per-agent schemas, keyed by lowercase agent name from the payload.
  private agents = new Map<string, Required<HookSchema>>();
  private onStatusChange?: (status: HookServerStatus, info?: string) => void;

  constructor(
    private port: number,
    private handlers: HookHandlers,
    private debug = false,
    options?: HookServerOptions
  ) {
    this.currentPort = port;
    this.defaultAgent = options?.defaultAgent ?? "Claude";
    this.schema = { ...DEFAULT_SCHEMA, ...(options?.schema ?? {}) } as Required<HookSchema>;
    this.onStatusChange = options?.onStatusChange;
  }

  setDebug(debug: boolean): void {
    this.debug = debug;
  }

  get isListening(): boolean {
    return this.listening;
  }

  get actualPort(): number {
    return this.currentPort;
  }

  // Register (or replace) the hook schema for a specific agent, so its payload
  // layout and notification-type map are honoured when it identifies itself.
  registerAgent(name: string, schema: HookSchema): void {
    this.agents.set(name.toLowerCase(), { ...DEFAULT_SCHEMA, ...schema } as Required<HookSchema>);
  }

  private setStatus(status: HookServerStatus, info?: string): void {
    if (this.status === status && info === undefined) return;
    this.status = status;
    this.onStatusChange?.(status, info);
  }

  start(): void {
    if (this.server) return;
    const server = http.createServer((req, res) => this.handleRequest(req, res));
    server.on("error", (err: NodeJS.ErrnoException) => this.onError(err));
    server.on("listening", () => {
      this.listening = true;
      this.setStatus("listening");
      if (this.debug) hookLog(`hook server listening on 127.0.0.1:${this.currentPort}`);
    });
    server.listen(this.currentPort, "127.0.0.1");
    this.server = server;
  }

  private onError(err: NodeJS.ErrnoException): void {
    this.listening = false;
    // Port already taken (another window/instance) — common with multiple VS
    // Code windows. Report it so the host can warn the user; stay alive so a
    // later setPort() can retry.
    if (err.code === "EADDRINUSE") {
      this.setStatus("port-in-use", `port ${this.currentPort} in use`);
    } else {
      this.setStatus("error", err.message);
    }
    if (this.debug) hookLog(`hook server error: ${err.code ?? ""} ${err.message}`);
    // A server that never finishes listening still holds a handle — drop it so
    // dispose()/setPort() can cleanly start a fresh one.
    try {
      this.server?.close();
    } catch {
      /* ignore */
    }
    this.server = null;
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy(); // guard against runaway bodies
    });
    req.on("end", () => {
      if (this.debug) hookLog(`POST ${body || "(empty body)"}`);
      try {
        this.handle(JSON.parse(body));
      } catch {
        /* malformed payload — ignore */
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  }

  setPort(port: number): void {
    if (port === this.currentPort) return;
    this.currentPort = port;
    this.dispose();
    this.start();
  }

  // Map a hook payload to a Pingo event. Resolves the agent-specific schema from
  // the payload's agent field (if present), falling back to the default.
  private handle(payload: Record<string, unknown>): void {
    const schema = this.resolveSchema(payload);
    const hookEvent = String(payload?.[schema.eventField] ?? "");
    let category: EventType | null = null;
    let message = "";

    if (hookEvent === schema.notifyEvent) {
      const nt = String(payload?.[schema.notificationField] ?? "");
      message = String(payload?.[schema.messageField] ?? "");
      category = schema.map[nt] ?? "input"; // unknown notification → attention/input
    } else if (hookEvent === schema.stopEvent) {
      // Turn ended → you've dealt with the agent (or it moved on). Resolve any
      // held alert silently; never make a sound on Stop (it fires every turn).
      const agent = this.resolveAgent(payload, schema);
      if (this.debug) hookLog(`  → event="Stop" resolve ${agent}`);
      this.handlers.onResolve(agent);
      return;
    }

    if (this.debug) hookLog(`  → event="${hookEvent}" mapped to category=${category ?? "(skipped)"}`);
    if (!category) return;

    const agent = this.resolveAgent(payload, schema);
    const now = new Date().toISOString();
    const priority: Priority = category === "permission" || category === "authentication" ? "high" : "medium";
    this.handlers.onStatus({
      agent,
      pid: 0,
      status: category === "permission" || category === "authentication" ? "waiting" : "running",
      startTime: now,
      lastActivity: now,
    });
    this.handlers.onEvent({
      agent,
      type: category,
      message: message || category,
      priority,
      timestamp: now,
    });
  }

  // Which schema applies to this payload? If it names an agent we've registered
  // a schema for, use that; otherwise the default (built-in Claude) schema.
  private resolveSchema(payload: Record<string, unknown>): Required<HookSchema> {
    const raw = String(payload?.[this.schema.agentField] ?? "").toLowerCase();
    if (raw && this.agents.has(raw)) return this.agents.get(raw)!;
    return this.schema;
  }

  // The pretty agent name for this event: the payload's own value if present,
  // else the configured default ("Claude" unless the host overrode it).
  private resolveAgent(payload: Record<string, unknown>, schema: Required<HookSchema>): string {
    const raw = String(payload?.[schema.agentField] ?? "").trim();
    return raw || this.defaultAgent;
  }

  dispose(): void {
    try {
      this.server?.close();
    } catch {
      /* ignore */
    }
    this.server = null;
    this.listening = false;
    this.setStatus("stopped");
  }
}
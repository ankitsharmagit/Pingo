// Pingo VS Code extension — the presentation layer.
//
// Primary path: it passively monitors the integrated terminals (TerminalMonitor)
// so agents run with no `pingo` prefix are detected automatically. It plays
// sound/voice, shows VS Code notifications, keeps event history, and renders a
// status bar item.
//
// Optional fallback: when `pingo.useCliFallback` is on, it also subscribes to
// the `pingo <agent>` CLI's localhost event server (CliClient). Events from
// both sources feed the same handlers and are de-duplicated.

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
  Notifier,
  voicePhrase,
  EVENT_LABELS,
  EVENT_EMOJI,
  EVENT_SEVERITY,
  WS_PORT,
  type PingoEvent,
  type StatusUpdate,
  type EventType,
} from "@pingo/shared";
import { CliClient, type ConnectionState } from "./client";
import { TerminalMonitor } from "./monitor";
import { ClaudeHookServer } from "./hookServer";
import { enableClaudeHooks, claudeHooksEnabled } from "./claudeSetup";
import { EventHistory } from "./history";
import { NotificationsPanel } from "./notifications";

type NotifyMode = "both" | "sound" | "voice" | "disabled";

const DEFAULT_HOOK_PORT = 4100;
// If the default hook port is taken (common with several VS Code windows open),
// walk forward this many ports before giving up — keeps the Claude Code bridge
// working across multi-window setups. The chosen port is surfaced in the UI.
const HOOK_PORT_ATTEMPTS = 10;
let hookPortLabel = DEFAULT_HOOK_PORT;
let fallbackWarned = false;

let statusBar: vscode.StatusBarItem;
let monitor: TerminalMonitor;
let hookServer: ClaudeHookServer | null = null;
let client: CliClient | null = null;
let notifier: Notifier;
let history: EventHistory;
let notifications: NotificationsPanel;
let connection: ConnectionState = "disconnected";
let monitoring = false;
// Extension context, captured at activation so helper functions can persist
// UI state (e.g. the mute toggle) across reloads.
let extContext: vscode.ExtensionContext | null = null;
// Deadline until which the "Approval Needed" flash holds the status bar. It
// is absolute (Date.now() + ms) so a render storm can't prematurely cancel it —
// any render within the window simply re-applies the attention styling instead
// of overwriting it with the normal countdown.
let attentionUntil: number | null = null;
let attentionTimer: NodeJS.Timeout | null = null;
const ATTENTION_FLASH_MS = 8000;

// "Away" gating, per agent. An alert is held silently while you're *attending*
// that agent — i.e. its terminal is the active terminal and the VS Code window
// is focused. It only sounds once you've been away from it (different tab, or
// window unfocused) for awaySeconds. This way an agent in a background tab still
// pings you while you work in another tab. A held alert is dropped after
// MAX_PENDING_MS so it can't fire much later as a stale ping.
//
// Hook events (the Claude Code panel) have no terminal, so "attending" them just
// means the window is focused.
interface PendingAlert {
  event: PingoEvent;
  terminal?: vscode.Terminal;
  createdAt: number;
  awaySince: number | null; // when you last stopped attending this agent
  alerting: boolean; // true = will sound; false = silent indicator (never occurs with current ALERTING set)
}
let muted = false;
let windowFocused = true;
const pendingAlerts = new Map<vscode.Terminal | string, PendingAlert>();
let countdownTimer: NodeJS.Timeout | null = null;
let repeatTimer: NodeJS.Timeout | null = null;
let repeatEvent: PingoEvent | null = null;
let repeatTerminal: vscode.Terminal | string | undefined = undefined;
const MAX_PENDING_MS = 5 * 60 * 1000;

// De-dupe identical events arriving close together (e.g. the passive monitor
// and the CLI fallback both reporting the same prompt).
const recentEvents = new Map<string, number>();
const DEDUPE_MS = 1500;

// All event types play sound/voice and run the away countdown, matching the
// CLI behaviour where every detected event alerts the user.
const ALERTING: ReadonlySet<EventType> = new Set<EventType>([
  "permission",
  "authentication",
  "error",
  "ratelimit",
  "success",
  "input",
]);

function config() {
  const c = vscode.workspace.getConfiguration("pingo");
  return {
    notify: c.get<NotifyMode>("notify", "both"),
    port: c.get<number>("port", WS_PORT),
    showVscodeNotifications: c.get<boolean>("showVscodeNotifications", true),
    monitorTerminals: c.get<boolean>("monitorTerminals", true),
    ignorePatterns: c.get<string[]>("ignorePatterns", []),
    useCliFallback: c.get<boolean>("useCliFallback", false),
    claudeHooks: c.get<boolean>("claudeHooks", true),
    hookPort: c.get<number>("hookPort", DEFAULT_HOOK_PORT),
    debug: c.get<boolean>("debug", false),
    awaySeconds: c.get<number>("awaySeconds", 30),
  };
}

// Hook-server status, surfaced in the status bar tooltip so users can diagnose
// a silent Claude Code bridge (port clash, error) without digging through logs.
type HookStatus = "listening" | "port-in-use" | "error" | "stopped";
let hookStatus: HookStatus = "stopped";
let hookStatusDetail = "";

function hookStatusText(): string | null {
  if (!hookServer) return null;
  switch (hookStatus) {
    case "listening":
      return `Claude Code hook bridge on port ${hookPortLabel}.`;
    case "port-in-use":
      return `⚠ Claude Code hook bridge OFF: ${hookStatusDetail || "port in use"}. Try "Pingo: Open Settings" → hookPort, or close other VS Code windows.`;
    case "error":
      return `⚠ Claude Code hook bridge error: ${hookStatusDetail}.`;
    default:
      return null;
  }
}

// Build a hook server bound to `port`, retrying forward if that port is taken
// (so multi-window setups don't silently lose the Claude Code bridge). The
// registered hooks already point at `cfg.hookPort`, so when we land on a
// different port we warn the user to re-run the integration command.
function createHookServer(port: number): ClaudeHookServer {
  return startHookServerAt(port, 0);
}

// Recursive bind: try `base + attempt`; if it reports port-in-use, dispose and
// try the next port up to HOOK_PORT_ATTEMPTS. The status callback is the only
// authoritative signal for "did it bind", since listen() is async.
function startHookServerAt(base: number, attempt: number): ClaudeHookServer {
  const tryPort = base + attempt;
  const server = new ClaudeHookServer(
    tryPort,
    { onEvent: handleEvent, onStatus: handleStatus, onResolve: handleResolve },
    config().debug,
    {
      onStatusChange: (status, info) => {
        hookStatus = status;
        hookStatusDetail = info ?? "";
        if (status === "listening" && hookServer === server) {
          hookPortLabel = tryPort;
          // Landed on a fallback port — the hooks registered in ~/.claude still
          // point at `base`, so warn once so Claude Code actually hears us.
          if (tryPort !== base && !fallbackWarned) {
            fallbackWarned = true;
            vscode.window.showWarningMessage(
              `Pingo: hook port ${base} was busy — the Claude Code bridge is on ${tryPort} instead. Re-run "Pingo: Enable Claude Code Integration" so your hooks point at the right port.`
            );
          }
        }
        if (status === "port-in-use" && attempt + 1 < HOOK_PORT_ATTEMPTS) {
          // Current window's server lost the port race; try the next one. Only
          // recurse if this server is still the "current" one — a setPort/restart
          // may have replaced it.
          if (hookServer === server) {
            server.dispose();
            hookServer = startHookServerAt(base, attempt + 1);
          }
        }
        renderStatusBar();
      },
    }
  );
  server.start();
  return server;
}

export function activate(context: vscode.ExtensionContext): void {
  extContext = context;
  // Restore the mute toggle across reloads (workspace-scoped so it's per-project).
  muted = context.workspaceState.get<boolean>("pingo.muted", false);

  // One-time diagnostic (#10): if the bundled sound files aren't present, tell
  // the user once per workspace so a broken package isn't a silent no-audio.
  void checkSoundAssets(context);

  history = new EventHistory(context);
  notifier = new Notifier(path.join(context.extensionPath, "media", "sounds"));
  notifications = new NotificationsPanel();

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = "pingo.showEvents";
  context.subscriptions.push(statusBar);
  context.subscriptions.push(notifications);

  const cfg = config();

  // The visual indicator is opt-out via `pingo.showVscodeNotifications`. When
  // off, events still alert via sound/voice; the activity-bar tree just stays
  // empty. This is the non-modal path — we never raise toast popups for alerts.
  notifications.setEnabled(cfg.showVscodeNotifications);

  // Mark notifications as read when the panel becomes visible or the user
  // clicks the status bar to view events.
  context.subscriptions.push(
    notifications.onDidBecomeVisible(() => {
      if (notifications.unread > 0) renderStatusBar();
    })
  );

  // Primary path: passive terminal monitoring.
  monitor = new TerminalMonitor({ onEvent: handleEvent, onStatus: handleStatus, onAgentEnd: clearPendingForTerminal });
  monitor.setIgnorePatterns(cfg.ignorePatterns);
  monitor.setDebug(cfg.debug);
  monitor.setEnabled(cfg.monitorTerminals);
  monitoring = cfg.monitorTerminals;
  if (cfg.monitorTerminals) monitor.start();
  context.subscriptions.push({ dispose: () => monitor.dispose() });

  // Claude Code bridge: host the localhost hook listener so the Claude Code
  // extension (which runs in its own shell-less pseudoterminal, invisible to
  // the passive monitor) can notify us via its Notification/Stop hooks.
  if (cfg.claudeHooks) {
    hookServer = createHookServer(cfg.hookPort);
  }
  context.subscriptions.push({ dispose: () => hookServer?.dispose() });

  // Optional fallback: subscribe to the `pingo <agent>` CLI event server.
  if (cfg.useCliFallback) startClient(cfg.port);
  context.subscriptions.push({ dispose: () => client?.dispose() });

  // Track whether you're at the VS Code window and which terminal is active —
  // used to decide whether you're "attending" a given agent.
  windowFocused = vscode.window.state.focused;
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((s) => {
      windowFocused = s.focused;
      checkRepeatAttended();
      renderStatusBar();
    }),
    vscode.window.onDidChangeActiveTerminal(() => {
      checkRepeatAttended();
      renderStatusBar();
    }),
    // A closed terminal can't be "waiting" — drop its held alert so it doesn't
    // sound after you've closed it.
    vscode.window.onDidCloseTerminal((term) => clearPendingForTerminal(term))
  );

  renderStatusBar();
  statusBar.show();

  // React to relevant setting changes.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("pingo")) {
        const next = config();
        monitor.setIgnorePatterns(next.ignorePatterns);
        monitor.setDebug(next.debug);
        if (next.monitorTerminals !== monitoring) {
          monitoring = next.monitorTerminals;
          monitor.setEnabled(monitoring);
          if (monitoring) monitor.start();
        }
        if (next.useCliFallback && !client) startClient(next.port);
        else if (!next.useCliFallback && client) {
          client.dispose();
          client = null;
          connection = "disconnected";
        } else if (client && e.affectsConfiguration("pingo.port")) {
          client.setPort(next.port);
        }
        // Claude hook server lifecycle.
        if (next.claudeHooks && !hookServer) {
          hookServer = createHookServer(next.hookPort);
        } else if (!next.claudeHooks && hookServer) {
          hookServer.dispose();
          hookServer = null;
          hookStatus = "stopped";
        } else if (hookServer) {
          hookServer.setDebug(next.debug);
          if (e.affectsConfiguration("pingo.hookPort")) {
            fallbackWarned = false;
            hookServer.setPort(next.hookPort);
          }
        }
        // Visual indicator toggle.
        notifications.setEnabled(next.showVscodeNotifications);
        renderStatusBar();
      }
    })
  );

  // Commands.
  context.subscriptions.push(
    vscode.commands.registerCommand("pingo.testNotification", () => {
      const sample: PingoEvent = {
        agent: "Claude",
        type: "permission",
        message: "Pingo test — Claude needs approval",
        priority: "high",
        timestamp: new Date().toISOString(),
      };
      history.add(sample);
      fireAlert(sample); // bypass the away-gate so the test always alerts
    }),
    vscode.commands.registerCommand("pingo.testSound", () => notifier.playSound("permission")),
    vscode.commands.registerCommand("pingo.testVoice", () =>
      notifier.speak(voicePhrase("Claude", "permission"))
    ),
    vscode.commands.registerCommand("pingo.showEvents", showEvents),
    vscode.commands.registerCommand("pingo.openSettings", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "pingo")
    ),
    vscode.commands.registerCommand("pingo.enableClaudeHooks", enableClaudeHooksCommand),
    vscode.commands.registerCommand("pingo.toggleMute", toggleMute),
    vscode.commands.registerCommand("pingo.mute", () => setMuted(true)),
    vscode.commands.registerCommand("pingo.unmute", () => setMuted(false)),
    vscode.commands.registerCommand("pingo.rescanTerminals", () => {
      monitor.rescan();
      renderStatusBar();
    })
  );
}

export function deactivate(): void {
  if (attentionTimer) clearTimeout(attentionTimer);
  stopCountdown();
  clearRepeat();
  pendingAlerts.clear();
  monitor?.dispose();
  client?.dispose();
}

// ── Fallback CLI client ──────────────────────────────────────────────────────

function startClient(port: number): void {
  client = new CliClient(port, {
    onEvent: handleEvent,
    onStatus: handleStatus,
    onConnectionChange: handleConnectionChange,
  });
  client.start();
}

// ── Event handling ─────────────────────────────────────────────────────────

function handleEvent(event: PingoEvent, terminal?: vscode.Terminal): void {
  // Drop duplicates from overlapping sources (passive monitor + CLI fallback).
  const key = `${event.type}:${event.agent}:${event.message}`;
  const now = Date.now();
  if (now - (recentEvents.get(key) ?? 0) < DEDUPE_MS) return;
  if (recentEvents.size > 500) recentEvents.clear();
  recentEvents.set(key, now);

  history.add(event);

  // Clear repeating alerts when a non-permission/non-auth event arrives
  // for the same agent — the situation has changed (matches CLI behavior).
  if (event.type !== "permission" && event.type !== "authentication") {
    if (repeatEvent?.agent === event.agent) clearRepeat();
  }

  const alerting = ALERTING.has(event.type);

  // Blocking events with gating disabled sound immediately, no countdown.
  if (alerting && Math.max(0, config().awaySeconds) === 0) {
    fireAlert(event, terminal);
    return;
  }

  // Track the agent as a pending entry so the status bar always shows a live
  // timer while an agent is active — all events count down and sound.
  // Re-detections of the same state preserve timing so the timer doesn't jump.
  //
  // Keying matters: terminals are keyed by their object (reference), hook
  // events (no terminal) by a per-agent string `hook:<Agent>` instead of one
  // shared HOOK_KEY — so a Claude hook alert and a Codex hook alert no longer
  // clobber each other into a single held entry.
  const pendKey: vscode.Terminal | string = terminal ?? `hook:${event.agent}`;
  const prev = pendingAlerts.get(pendKey);
  const sameState = prev?.event.type === event.type;
  pendingAlerts.set(pendKey, {
    event,
    terminal,
    createdAt: sameState ? prev!.createdAt : Date.now(),
    awaySince: sameState ? prev!.awaySince : null,
    alerting,
  });
  if (!countdownTimer) countdownTimer = setInterval(tickCountdown, 250);
  renderStatusBar();
}

// You're "attending" an agent when its terminal is the active terminal and the
// VS Code window is focused.
//
// Hook events (Claude Code panel, no terminal) are treated as attended when the
// window is focused — we can't tell whether you're actually on the Claude view,
// but erring on the side of silence when you're at VS Code is better than
// buzzing you while you're clearly at the keyboard. You'll see the event in the
// status bar. When the window loses focus, hook events count down and sound
// after awaySeconds like any other alert.
function isAttending(p: PendingAlert): boolean {
  if (!windowFocused) return false;
  if (!p.terminal) return true; // hook events: attended when window is focused
  return vscode.window.activeTerminal === p.terminal;
}

// Seconds until a pending alert sounds: paused at the full threshold while you
// attend it, counting down once you're away.
function remainingSeconds(p: PendingAlert, awayMs: number): number {
  if (isAttending(p) || p.awaySince === null) return Math.ceil(awayMs / 1000);
  return Math.max(0, Math.ceil((awayMs - (Date.now() - p.awaySince)) / 1000));
}

// Shows a non-modal notification by adding it to the activity-bar panel.
// Sound/voice handles the actual alert; this is the visual indicator only.
function showNotification(event: PingoEvent): void {
  notifications.add(event);
  renderStatusBar();
}

// Fires the actual alert: status-bar flash, VS Code notification, sound/voice.
function fireAlert(event: PingoEvent, terminal?: vscode.Terminal): void {
  flashAttention(event.type);
  showNotification(event);

  const cfg = config();
  const wantSound = (cfg.notify === "sound" || cfg.notify === "both") && !muted;
  const wantVoice = (cfg.notify === "voice" || cfg.notify === "both") && !muted;
  if (wantSound) notifier.playSound(event.type);
  if (wantVoice) notifier.speak(voicePhrase(event.agent, event.type));

  // Repeat sound/voice every 5s for permission/auth events (matches CLI behavior).
  if ((event.type === "permission" || event.type === "authentication") && !repeatTimer) {
    repeatEvent = event;
    repeatTerminal = terminal;
    repeatTimer = setInterval(() => {
      if (repeatEvent) {
        const rcfg = config();
        const rs = (rcfg.notify === "sound" || rcfg.notify === "both") && !muted;
        const rv = (rcfg.notify === "voice" || rcfg.notify === "both") && !muted;
        if (rs) notifier.playSound(repeatEvent.type);
        if (rv) notifier.speak(voicePhrase(repeatEvent.agent, repeatEvent.type));
      }
    }, 5000);
  }

  // flashAttention repaints the bar for permission/auth; for other events,
  // clear any lingering countdown text back to the normal state.
  if (event.type !== "permission" && event.type !== "authentication") renderStatusBar();
}

// Drives the per-agent away gate each tick: fires alerts you've been away from
// long enough, holds the ones you're attending, and drops stale ones.
function tickCountdown(): void {
  if (pendingAlerts.size === 0) {
    stopCountdown();
    return;
  }
  const awayMs = Math.max(0, config().awaySeconds) * 1000;
  const now = Date.now();
  for (const [key, p] of pendingAlerts) {
    if (now - p.createdAt > MAX_PENDING_MS) {
      pendingAlerts.delete(key); // held too long → drop
      continue;
    }
    if (!p.alerting) continue; // silent indicator — keep showing, never fires
    if (isAttending(p)) {
      p.awaySince = null; // you're on it → reset and hold
      continue;
    }
    if (p.awaySince === null) p.awaySince = now;
    if (now - p.awaySince >= awayMs) {
      pendingAlerts.delete(key);
      fireAlert(p.event, p.terminal);
    }
  }
  // If alerts fired and none remain, leave the post-fire status bar intact;
  // otherwise refresh the countdown display.
  if (pendingAlerts.size === 0) stopCountdown();
  else renderStatusBar();
}

function stopCountdown(): void {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function clearRepeat(): void {
  if (repeatTimer) {
    clearInterval(repeatTimer);
    repeatTimer = null;
    repeatEvent = null;
    repeatTerminal = undefined;
  }
}

// Stop repeating alerts when the user is back attending the agent
// — no need to keep pinging if you're clearly at the keyboard.
function checkRepeatAttended(): void {
  if (!repeatTimer || !repeatEvent) return;
  // Hook events (no terminal): if the window is focused you're attending,
  // so clear the repeat.
  if (!repeatTerminal) {
    if (windowFocused) clearRepeat();
    return;
  }
  // Terminal-backed agents: clear when you re-focus their tab.
  if (windowFocused && vscode.window.activeTerminal === repeatTerminal) {
    clearRepeat();
  }
}

function handleStatus(status: StatusUpdate): void {
  // The "waiting" state is now reflected by the held-alert countdown in the
  // status bar (and fireAlert flashes when it actually sounds), so we don't
  // flash here — that would flicker against the countdown. Just refresh on idle.
  if (status.status === "idle") renderStatusBar();
}

// Drop a held alert when its terminal closes or the agent exits — a gone agent
// isn't waiting for anything, so it must not sound.
function clearPendingForTerminal(terminal: vscode.Terminal): void {
  if (pendingAlerts.delete(terminal)) {
    if (pendingAlerts.size === 0) stopCountdown();
  }
  if (repeatTerminal === terminal) clearRepeat();
  renderStatusBar();
}

// Clear a held alert for an agent without firing it — e.g. Claude's turn ended,
// so a pending permission/idle alert no longer needs you.
function handleResolve(agent: string): void {
  let changed = false;
  for (const [key, p] of pendingAlerts) {
    if (p.event.agent === agent) {
      pendingAlerts.delete(key);
      changed = true;
    }
  }
  if (changed && pendingAlerts.size === 0) stopCountdown();
  if (repeatEvent?.agent === agent) clearRepeat();
  if (changed || repeatEvent?.agent === agent) renderStatusBar();
}

function handleConnectionChange(state: ConnectionState): void {
  connection = state;
  renderStatusBar();
}

// ── Status bar ───────────────────────────────────────────────────────────────

function flashAttention(type: EventType): void {
  if (type !== "permission" && type !== "authentication") return;
  // Hold the "Approval Needed" styling until an absolute deadline. A render
  // storm (window state changes, countdown ticks) within the window re-applies
  // this styling rather than cancelling the flash — see renderStatusBar.
  attentionUntil = Date.now() + ATTENTION_FLASH_MS;
  applyAttention();
  if (attentionTimer) clearTimeout(attentionTimer);
  attentionTimer = setTimeout(() => {
    attentionUntil = null;
    attentionTimer = null;
    renderStatusBar();
  }, ATTENTION_FLASH_MS);
}

// Paint the status bar with the "Approval Needed" attention styling.
function applyAttention(): void {
  statusBar.text = "$(warning) Approval Needed";
  statusBar.tooltip =
    "Pingo — your agent needs attention. Click to view events." + (hookStatusText() ? `\n${hookStatusText()}` : "");
  statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
}

// Choose which pending entry the status bar shows. Priority: a blocking alert
// that's counting down to sound (least time first), then a held blocking alert.
function pickPending(): { p: PendingAlert; attending: boolean } | null {
  if (pendingAlerts.size === 0) return null;
  const awayMs = Math.max(0, config().awaySeconds) * 1000;
  let best: { p: PendingAlert; attending: boolean; rank: number; secs: number } | null = null;
  for (const p of pendingAlerts.values()) {
    const attending = isAttending(p);
    const rank = !p.alerting ? 2 : attending ? 1 : 0;
    const secs = remainingSeconds(p, awayMs);
    if (!best || rank < best.rank || (rank === best.rank && secs < best.secs)) {
      best = { p, attending, rank, secs };
    }
  }
  return best ? { p: best.p, attending: best.attending } : null;
}

function renderStatusBar(): void {
  // If the "Approval Needed" flash window is still open, keep that styling —
  // a render storm (countdown ticks, window-state changes) must NOT knock it
  // out. Only overwrite it once the deadline has passed (the timeout clears
  // attentionUntil and re-renders to the normal state).
  if (attentionUntil !== null) {
    if (Date.now() < attentionUntil) {
      applyAttention();
      return;
    }
    attentionUntil = null;
  }
  statusBar.backgroundColor = undefined;

  // While any agent is active, the status bar shows it with a live timer so you
  // can see Pingo is tracking. All alerts count down to a sound.
  const pend = pickPending();
  if (pend) {
    const { p, attending } = pend;
    const who = `${capitalize(p.event.agent)} ${EVENT_LABELS[p.event.type]}`;
    const more = pendingAlerts.size > 1 ? ` (+${pendingAlerts.size - 1})` : "";
    if (p.alerting) {
      const secs = remainingSeconds(p, Math.max(0, config().awaySeconds) * 1000);
      const icon = attending ? "$(bell-slash)" : "$(watch)";
      statusBar.text = `$(bell) Pingo · ${who} ${icon} ${secs}s${more}`;
      statusBar.tooltip = attending
        ? `Pingo: ${who} — held while you're viewing it; sounds ${secs}s after you switch away. Click to view events.`
        : `Pingo: ${who} — sounds in ${secs}s unless you switch back to it. Click to view events.`;
    } else {
      const elapsed = Math.max(0, Math.round((Date.now() - p.createdAt) / 1000));
      statusBar.text = `$(bell) Pingo · ${who} $(watch) ${elapsed}s${more}`;
      statusBar.tooltip = `Pingo: ${who} — tracking (silent, no sound). Click to view events.`;
    }
    return;
  }

  // Mute indicator + hook-bridge diagnostics fold into the tooltip so the
  // status bar stays a one-glance summary.
  const mutedSuffix = muted ? " (muted)" : "";
  const hookLine = hookStatusText() ? `\n${hookStatusText()}` : "";
  if (monitoring) {
    const badge = notifications.unread > 0 ? ` ${notifications.unread}` : "";
    statusBar.text = `$(bell${muted ? "-slash" : ""}) Pingo Active${badge}${mutedSuffix}`;
    statusBar.tooltip = (notifications.unread > 0
      ? `Pingo is watching your terminals (${notifications.unread} unread notification${notifications.unread > 1 ? "s" : ""}). Click to view events.`
      : "Pingo is watching your terminals. Run claude / opencode / codex / gemini / aider normally. Click to view events.")
      + (muted ? "\n🔇 Muted — run \"Pingo: Toggle Mute\" to re-enable sound/voice." : "")
      + hookLine;
  } else if (connection === "connected") {
    const badge = notifications.unread > 0 ? ` ${notifications.unread}` : "";
    statusBar.text = `$(bell${muted ? "-slash" : ""}) Pingo Connected${badge}${mutedSuffix}`;
    statusBar.tooltip = (notifications.unread > 0
      ? `Pingo is connected to a running CLI session (${notifications.unread} unread). Click to view events.`
      : "Pingo is connected to a running CLI session. Click to view events.")
      + (muted ? "\n🔇 Muted — run \"Pingo: Toggle Mute\" to re-enable sound/voice." : "")
      + hookLine;
  } else {
    statusBar.text = "$(warning) Pingo Off";
    statusBar.tooltip =
      "Passive monitoring is disabled. Enable `pingo.monitorTerminals` in settings. Click to view events."
      + hookLine;
  }
}

// ── Show Events ──────────────────────────────────────────────────────────────

async function showEvents(): Promise<void> {
  const events = history.all();
  if (events.length === 0) {
    vscode.window.showInformationMessage("Pingo: no events recorded yet.");
    return;
  }
  const items: (vscode.QuickPickItem & { event: PingoEvent })[] = events.map((e) => ({
    label: `${EVENT_EMOJI[e.type]} ${capitalize(e.agent)} · ${EVENT_LABELS[e.type]}`,
    description: new Date(e.timestamp).toLocaleTimeString(),
    detail: e.message,
    event: e,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: "Pingo — Recent Events",
    placeHolder: "Select an event for details and actions",
    matchOnDetail: true,
  });
  if (!picked) return;
  await actOnEvent(picked.event);
}

// Actions for a selected history event: show its full details and offer to copy
// the message or clear history. Replaces the read-only QuickPick dead end.
async function actOnEvent(event: PingoEvent): Promise<void> {
  const when = new Date(event.timestamp).toLocaleString();
  const detail = [
    `${capitalize(event.agent)} — ${EVENT_LABELS[event.type]}`,
    `Time: ${when}`,
    `Priority: ${event.priority}`,
    ``,
    event.message,
  ].join("\n");
  const choice = await vscode.window.showInformationMessage(
    detail,
    { modal: true },
    "Copy message",
    "Clear history"
  );
  if (choice === "Copy message") {
    await vscode.env.clipboard.writeText(event.message);
  } else if (choice === "Clear history") {
    history.clear();
    notifications.clear();
    renderStatusBar();
  }
}

// ── Enable Claude Code integration ───────────────────────────────────────────

async function enableClaudeHooksCommand(): Promise<void> {
  const cfg = config();
  const port = cfg.hookPort;

  if (claudeHooksEnabled(port)) {
    vscode.window.showInformationMessage(
      `Pingo: Claude Code hooks already point at port ${port}. Restart any open Claude Code session to apply.`
    );
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    "Pingo will add Notification + Stop hooks to your Claude Code settings (~/.claude/settings.json) so it can alert you when the Claude Code extension needs approval or finishes. Your existing settings are preserved.",
    { modal: true },
    "Add hooks"
  );
  if (choice !== "Add hooks") return;

  // Make sure the listener those hooks POST to is actually running.
  if (!hookServer) {
    hookServer = new ClaudeHookServer(port, { onEvent: handleEvent, onStatus: handleStatus, onResolve: handleResolve }, config().debug);
    hookServer.start();
  }

  try {
    const result = enableClaudeHooks(port);
    renderStatusBar();
    const where = result.changed ? "Added" : "Already present";
    vscode.window.showInformationMessage(
      `Pingo: ${where} Claude Code hooks (${result.events.join(" + ")}) in ${result.filePath}. Restart any open Claude Code session to apply.`
    );
  } catch (err) {
    vscode.window.showErrorMessage(
      `Pingo: couldn't update Claude settings automatically (${(err as Error).message}). Add an http hook to http://127.0.0.1:${port}/hook under "Notification" and "Stop" manually.`
    );
  }
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// One-click mute: silence sound/voice without touching settings (the visual
// indicator + status bar still update). Idempotent so the toggle command can
// call it both ways. Persisted across reloads via workspaceState so a restart
// remembers your choice.
function setMuted(value: boolean, silent = false): void {
  if (muted === value) return;
  muted = value;
  try {
    extContext?.workspaceState?.update("pingo.muted", value);
  } catch {
    /* workspaceState not always available */
  }
  // Stopping the 5s repeat loop on mute means a mid-repeat permission alert
  // actually goes quiet (not just silent-while-still-ticking), and unmuting
  // doesn't suddenly resume a stale beep from a long-gone prompt.
  if (muted) {
    clearRepeat();
    notifier.flush(); // kill the sound currently playing + drain the queue
  }
  if (!silent) {
    vscode.window.showInformationMessage(
      value ? "Pingo: alerts muted — sound and voice silenced." : "Pingo: alerts unmuted."
    );
  }
  renderStatusBar();
}

function toggleMute(): void {
  setMuted(!muted);
}

// #10: if the bundled .wav files are missing (corrupted/failed package), sound
// alerts silently do nothing. Warn once per workspace so users can fix it
// instead of assuming "Pingo forgot to ping me."
async function checkSoundAssets(context: vscode.ExtensionContext): Promise<void> {
  const warnedKey = "pingo.soundAssetsWarned";
  if (context.workspaceState.get<boolean>(warnedKey, false)) return;
  const dir = path.join(context.extensionPath, "media", "sounds");
  const expected = ["permission.wav", "success.wav", "error.wav", "input.wav", "authentication.wav"];
  const missing = expected.filter((f) => !fs.existsSync(path.join(dir, f)));
  if (missing.length > 0) {
    await context.workspaceState.update(warnedKey, true);
    vscode.window.showWarningMessage(
      `Pingo: sound files are missing (${missing.join(", ")}). Notifications will be silent. Reinstalling Pingo usually fixes this.`
    );
  }
}

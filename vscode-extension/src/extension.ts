// Pingo VS Code extension — the presentation layer.
//
// It does NO terminal parsing and NO detection. It is a thin WebSocket client
// of the Pingo CLI's event server: it plays sound/voice, shows VS Code
// notifications, keeps event history, and renders a status bar item.

import * as vscode from "vscode";
import * as path from "path";
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
import { EventHistory } from "./history";

type NotifyMode = "both" | "sound" | "voice" | "disabled";

let statusBar: vscode.StatusBarItem;
let client: CliClient;
let notifier: Notifier;
let history: EventHistory;
let connection: ConnectionState = "disconnected";
let attentionTimer: NodeJS.Timeout | null = null;

function config() {
  const c = vscode.workspace.getConfiguration("pingo");
  return {
    notify: c.get<NotifyMode>("notify", "both"),
    port: c.get<number>("port", WS_PORT),
    showVscodeNotifications: c.get<boolean>("showVscodeNotifications", true),
  };
}

export function activate(context: vscode.ExtensionContext): void {
  history = new EventHistory(context);
  notifier = new Notifier(path.join(context.extensionPath, "media", "sounds"));

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = "pingo.showEvents";
  context.subscriptions.push(statusBar);
  renderStatusBar();
  statusBar.show();

  client = new CliClient(config().port, {
    onEvent: handleEvent,
    onStatus: handleStatus,
    onConnectionChange: handleConnectionChange,
  });
  client.start();
  context.subscriptions.push({ dispose: () => client.dispose() });

  // React to relevant setting changes.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("pingo.port")) client.setPort(config().port);
      if (e.affectsConfiguration("pingo")) renderStatusBar();
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
      handleEvent(sample);
    }),
    vscode.commands.registerCommand("pingo.testSound", () => notifier.playSound("permission")),
    vscode.commands.registerCommand("pingo.testVoice", () =>
      notifier.speak(voicePhrase("Claude", "permission"))
    ),
    vscode.commands.registerCommand("pingo.showEvents", showEvents),
    vscode.commands.registerCommand("pingo.openSettings", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "pingo")
    )
  );
}

export function deactivate(): void {
  if (attentionTimer) clearTimeout(attentionTimer);
  client?.dispose();
}

// ── Event handling ─────────────────────────────────────────────────────────

function handleEvent(event: PingoEvent): void {
  history.add(event);
  flashAttention(event.type);

  const cfg = config();
  const label = `${EVENT_EMOJI[event.type]} ${capitalize(event.agent)} ${EVENT_LABELS[event.type]}`;

  if (cfg.showVscodeNotifications) {
    const detail = event.message && event.message !== label ? `${label} — ${event.message}` : label;
    const severity = EVENT_SEVERITY[event.type];
    if (severity === "error") vscode.window.showErrorMessage(detail);
    else if (severity === "warning") vscode.window.showWarningMessage(detail);
    else vscode.window.showInformationMessage(detail);
  }

  if (cfg.notify === "sound" || cfg.notify === "both") notifier.playSound(event.type);
  if (cfg.notify === "voice" || cfg.notify === "both") notifier.speak(voicePhrase(event.agent, event.type));
}

function handleStatus(status: StatusUpdate): void {
  if (status.status === "waiting") flashAttention("permission");
  else if (status.status === "idle") renderStatusBar();
}

function handleConnectionChange(state: ConnectionState): void {
  connection = state;
  renderStatusBar();
}

// ── Status bar ───────────────────────────────────────────────────────────────

function flashAttention(type: EventType): void {
  if (type === "permission" || type === "authentication") {
    statusBar.text = "$(warning) Approval Needed";
    statusBar.tooltip = "Pingo — your agent needs attention. Click to view events.";
    statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    if (attentionTimer) clearTimeout(attentionTimer);
    attentionTimer = setTimeout(renderStatusBar, 8000);
  }
}

function renderStatusBar(): void {
  if (attentionTimer) {
    clearTimeout(attentionTimer);
    attentionTimer = null;
  }
  statusBar.backgroundColor = undefined;
  if (connection === "connected") {
    statusBar.text = "$(bell) Pingo Connected";
    statusBar.tooltip = "Pingo is connected to a running CLI session. Click to view events.";
  } else {
    statusBar.text = "$(warning) Pingo Not Running";
    statusBar.tooltip = "Pingo CLI is not running. Start one with `pingo claude`. Click to view events.";
  }
}

// ── Show Events ──────────────────────────────────────────────────────────────

async function showEvents(): Promise<void> {
  const events = history.all();
  if (events.length === 0) {
    vscode.window.showInformationMessage("Pingo: no events recorded yet.");
    return;
  }
  const items: vscode.QuickPickItem[] = events.map((e) => ({
    label: `${EVENT_EMOJI[e.type]} ${capitalize(e.agent)} · ${EVENT_LABELS[e.type]}`,
    description: new Date(e.timestamp).toLocaleTimeString(),
    detail: e.message,
  }));
  await vscode.window.showQuickPick(items, {
    title: "Pingo — Recent Events",
    placeHolder: "Time · Agent · Event · Message",
    matchOnDetail: true,
  });
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

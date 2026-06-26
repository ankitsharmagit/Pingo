// Notifications panel — a non-modal activity-bar view that lists
// recent Pingo events so users can triage them without modal toasts.

import * as vscode from "vscode";
import { EVENT_EMOJI, EVENT_LABELS, EVENT_SEVERITY } from "@pingo/shared";
import type { PingoEvent, EventType } from "@pingo/shared";

// ── Data provider for the TreeView ───────────────────────────────────────────

class PingoEventTreeProvider
  implements vscode.TreeDataProvider<PingoEventTreeItem>, vscode.Disposable
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    PingoEventTreeItem | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private items: PingoEventTreeItem[] = [];
  private _unread = 0;

  get unread(): number {
    return this._unread;
  }

  // Push a new event to the top of the tree.
  push(event: PingoEvent): void {
    this.items.unshift(new PingoEventTreeItem(event));
    this._unread++;
    // Cap the visible list so the tree doesn't grow unbounded.
    if (this.items.length > 100) this.items.length = 100;
    this._onDidChangeTreeData.fire(undefined);
  }

  // Mark all items as read (reset the badge).
  markRead(): void {
    this._unread = 0;
    this._onDidChangeTreeData.fire(undefined);
  }

  clear(): void {
    this.items = [];
    this._unread = 0;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: PingoEventTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(_element?: PingoEventTreeItem): PingoEventTreeItem[] {
    return this.items;
  }

  getParent(_element?: PingoEventTreeItem): PingoEventTreeItem | null {
    return null;
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}

// ── Individual tree item (one row per event) ─────────────────────────────────

class PingoEventTreeItem extends vscode.TreeItem {
  constructor(private event: PingoEvent) {
    super(
      `${EVENT_EMOJI[event.type]} ${capitalize(event.agent)} ${EVENT_LABELS[event.type]}`,
      vscode.TreeItemCollapsibleState.None
    );

    this.description = new Date(event.timestamp).toLocaleTimeString();
    this.tooltip = `${event.agent} ${EVENT_LABELS[event.type]}\n${event.message}\n${new Date(event.timestamp).toLocaleString()}`;
    this.contextValue = "pingoEvent";

    // Severity-based icon so the tree is scannable at a glance.
    const sev = EVENT_SEVERITY[event.type];
    if (sev === "error") this.iconPath = new vscode.ThemeIcon("error");
    else if (sev === "warning") this.iconPath = new vscode.ThemeIcon("warning");
    else this.iconPath = new vscode.ThemeIcon("info");
  }

  getEvent(): PingoEvent {
    return this.event;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export class NotificationsPanel implements vscode.Disposable {
  private provider: PingoEventTreeProvider;
  private treeView: vscode.TreeView<PingoEventTreeItem>;
  private disposables: vscode.Disposable[] = [];

  private _onDidBecomeVisible = new vscode.EventEmitter<void>();
  // Fires when the notifications view becomes visible — lets the host mark
  // alerts read (dismiss the status-bar badge) without a modal round-trip.
  readonly onDidBecomeVisible = this._onDidBecomeVisible.event;

  // `true` to push incoming events into the activity-bar tree (the visual,
  // non-modal indicator). When false, the panel stays empty — the sound/voice
  // channel still alerts. Mirrors the `pingo.showVscodeNotifications` setting.
  private enabled = true;

  constructor() {
    this.provider = new PingoEventTreeProvider();
    this.treeView = vscode.window.createTreeView<PingoEventTreeItem>("pingo.notifications", {
      treeDataProvider: this.provider,
      showCollapseAll: false,
      canSelectMany: false,
    });

    // Clicking an item copies its message to the clipboard — no extra toast,
    // the selection highlight is feedback enough and a toast would interrupt.
    this.disposables.push(
      this.treeView.onDidChangeVisibility((e) => {
        if (e.visible) {
          this.markRead();
          this._onDidBecomeVisible.fire();
        }
      }),
      this.treeView.onDidChangeSelection((e) => {
        if (e.selection.length > 0) {
          void vscode.env.clipboard.writeText(e.selection[0].getEvent().message);
        }
      }),
      vscode.commands.registerCommand("pingo.clearNotifications", () =>
        this.clear()
      )
    );
  }

  // Whether incoming events are added to the visual tree (the
  // `pingo.showVscodeNotifications` setting). Even when off, the panel can
  // still be opened to review cleared history; we just stop populating it.
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  // Add an event (pushes into the tree, increments unread badge) — when the
  // visual indicator is enabled. Otherwise the alert relies on sound/voice.
  add(event: PingoEvent): void {
    if (!this.enabled) return;
    this.provider.push(event);
  }

  // Current unread count (for the status bar badge).
  get unread(): number {
    return this.provider.unread;
  }

  // User clicked the tree view — dismiss the badge.
  markRead(): void {
    this.provider.markRead();
  }

  clear(): void {
    this.provider.clear();
  }

  // The TreeView id so the extension can react to visibility changes.
  // createTreeView returns no id accessor, so we expose the static id we
  // registered the view with (matches package.json contributes.views).
  readonly viewId = "pingo.notifications";

  dispose(): void {
    this.treeView.dispose();
    for (const d of this.disposables) d.dispose();
    this._onDidBecomeVisible.dispose();
    this.provider.dispose();
  }
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

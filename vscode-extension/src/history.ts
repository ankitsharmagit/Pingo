// Local event history, persisted in the extension's globalState so it survives
// reloads. Capped to the most recent MAX_EVENTS.

import * as vscode from "vscode";
import type { PingoEvent } from "@pingo/shared";

const STORAGE_KEY = "pingo.events";
const MAX_EVENTS = 200;

export class EventHistory {
  constructor(private context: vscode.ExtensionContext) {}

  add(event: PingoEvent): void {
    const events = this.all();
    events.unshift(event);
    if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
    this.context.globalState.update(STORAGE_KEY, events);
  }

  all(): PingoEvent[] {
    return this.context.globalState.get<PingoEvent[]>(STORAGE_KEY, []);
  }

  clear(): void {
    this.context.globalState.update(STORAGE_KEY, []);
  }
}

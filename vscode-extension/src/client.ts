// WebSocket client that subscribes to the Pingo CLI's event server.
//
// The CLI hosts the server on ws://127.0.0.1:<port> while an agent runs; this
// client auto-reconnects every 2s so it transparently attaches whenever a
// `pingo <agent>` session starts, and reports disconnect when it ends.

import { WebSocket } from "ws";
import {
  WS_HOST,
  parseServerMessage,
  type PingoEvent,
  type StatusUpdate,
} from "@pingo/shared";

export type ConnectionState = "connected" | "disconnected";

export interface ClientHandlers {
  onEvent: (event: PingoEvent) => void;
  onStatus: (status: StatusUpdate) => void;
  onConnectionChange: (state: ConnectionState) => void;
}

const RECONNECT_MS = 2000;

export class CliClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private closing = false;
  private connected = false;

  constructor(private port: number, private handlers: ClientHandlers) {}

  start(): void {
    this.closing = false;
    this.connect();
  }

  private connect(): void {
    if (this.closing) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://${WS_HOST}:${this.port}`);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.on("open", () => {
      this.setConnected(true);
    });

    ws.on("message", (raw: Buffer) => {
      const msg = parseServerMessage(raw.toString());
      if (!msg) return;
      if (msg.type === "event") this.handlers.onEvent(msg.data);
      else if (msg.type === "status") this.handlers.onStatus(msg.data);
      // "hello" simply confirms the server is alive; the open handler already
      // flipped us to connected.
    });

    ws.on("close", () => {
      this.setConnected(false);
      this.scheduleReconnect();
    });

    // Connection refused (no CLI running yet) is the normal idle case — retry
    // quietly without surfacing an error.
    ws.on("error", () => {
      this.setConnected(false);
    });
  }

  private setConnected(value: boolean): void {
    if (this.connected === value) return;
    this.connected = value;
    this.handlers.onConnectionChange(value ? "connected" : "disconnected");
  }

  private scheduleReconnect(): void {
    if (this.closing || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_MS);
  }

  // Re-point at a new port (e.g. after the user changes the setting). Close
  // the old socket and reconnect immediately — don't wait the 2s reconnect
  // delay, which would leave us detached from a running CLI in the meantime.
  setPort(port: number): void {
    if (port === this.port) return;
    this.port = port;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.setConnected(false);
    this.connect();
  }

  dispose(): void {
    this.closing = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }
}

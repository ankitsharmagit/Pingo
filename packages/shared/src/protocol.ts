// Pingo localhost WebSocket protocol.
//
// The CLI hosts a WebSocket server on WS_PORT and broadcasts these envelopes to
// every connected subscriber (the VS Code extension). Keeping the envelopes
// here ensures the CLI and the extension never drift.

import type { PingoEvent, StatusUpdate } from "./types";

export const WS_PORT = 4001;
export const WS_HOST = "127.0.0.1";
export const WS_URL = `ws://${WS_HOST}:${WS_PORT}`;

// Server -> client messages.
export interface EventMessage {
  type: "event";
  data: PingoEvent;
}

export interface StatusMessage {
  type: "status";
  data: StatusUpdate;
}

// Sent once when a client connects, so a freshly-attached UI knows the CLI is
// alive and which agent is running.
export interface HelloMessage {
  type: "hello";
  data: { agent: string; pid: number; version: string };
}

export type ServerMessage = EventMessage | StatusMessage | HelloMessage;

// Type guard for safely parsing inbound frames on the client side.
export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const msg = JSON.parse(raw);
    if (
      msg &&
      (msg.type === "event" || msg.type === "status" || msg.type === "hello") &&
      msg.data
    ) {
      return msg as ServerMessage;
    }
  } catch {
    /* malformed frame */
  }
  return null;
}

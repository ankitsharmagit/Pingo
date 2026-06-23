// Pingo shared event vocabulary.
//
// These categories are the canonical wire values emitted by the CLI detector
// and consumed by every presentation layer (VS Code extension, CLI local
// audio). Human-facing labels/emoji are applied at the presentation layer so
// the wire format stays stable.

export type EventType =
  | "permission"
  | "success"
  | "error"
  | "authentication"
  | "ratelimit"
  | "input";

export type Priority = "high" | "medium" | "low";

export type SessionStatus = "running" | "idle" | "error" | "waiting";

// A detected event, broadcast by the CLI to subscribers.
export interface PingoEvent {
  agent: string;
  type: EventType;
  message: string;
  priority: Priority;
  timestamp: string; // ISO-8601
}

// A coding-agent session lifecycle update.
export interface StatusUpdate {
  agent: string;
  pid: number;
  status: SessionStatus;
  startTime: string; // ISO-8601
  lastActivity: string; // ISO-8601
}

// Friendly, human-readable label per event type ("Claude needs approval").
export const EVENT_LABELS: Record<EventType, string> = {
  permission: "needs approval",
  success: "completed a task",
  error: "hit an error",
  authentication: "needs authentication",
  ratelimit: "hit a rate limit",
  input: "is waiting for input",
};

export const EVENT_EMOJI: Record<EventType, string> = {
  permission: "🔔",
  success: "🎉",
  error: "❌",
  authentication: "⚠",
  ratelimit: "⏳",
  input: "💬",
};

// Map an event to VS Code notification severity.
export type NotificationSeverity = "info" | "warning" | "error";

export const EVENT_SEVERITY: Record<EventType, NotificationSeverity> = {
  permission: "warning",
  success: "info",
  error: "error",
  authentication: "warning",
  ratelimit: "warning",
  input: "info",
};

// Build the spoken phrase for an event ("Claude needs approval").
export function voicePhrase(agent: string, type: EventType): string {
  return `${agent} ${EVENT_LABELS[type]}`;
}

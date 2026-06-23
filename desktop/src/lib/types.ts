export type Category =
  | "permission"
  | "success"
  | "error"
  | "authentication"
  | "ratelimit"
  | "input";

export interface Rule {
  id: string;
  name: string;
  category: string;
  priority: string; // "high" | "medium" | "low"
  enabled: boolean;
  patterns: string[];
  agents?: string[]; // if set, only applies to these agents (empty = all)
}

export const KNOWN_AGENTS = [
  "claude",
  "opencode",
  "codex",
  "gemini",
  "aider",
  "cursor",
];

export interface EventLog {
  id: string;
  timestamp: string;
  agent: string;
  event_type: string;
  message: string;
  priority: string;
}

export interface SessionStatus {
  agent: string;
  pid: number;
  status: string; // "running" | "waiting" | "error" | "idle"
  start_time: string;
  last_activity: string;
}

export const CATEGORY_LABELS: Record<string, string> = {
  permission: "Permission Required",
  success: "Task Completed",
  error: "Agent Error",
  authentication: "Authentication Required",
  ratelimit: "Rate Limit Reached",
  input: "Waiting for Input",
};

export const PREF_KEYS = {
  monitoringPaused: "monitoring_paused",
  muteSounds: "mute_sounds",
  soundSuccess: "sound_success",
  soundPermission: "sound_permission",
  soundError: "sound_error",
  soundAuthentication: "sound_authentication",
  soundInput: "sound_input",
} as const;

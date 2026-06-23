// Shared visual mappings for categories, priorities and session states.

export const CATEGORY_COLOR: Record<string, string> = {
  permission: "#7c6cff",
  success: "#5ad19a",
  error: "#ff5d73",
  authentication: "#ffb347",
  ratelimit: "#ff8fab",
  input: "#4fc3f7",
};

export const CATEGORY_TINT: Record<string, string> = {
  permission: "rgba(124,108,255,0.15)",
  success: "rgba(90,209,154,0.15)",
  error: "rgba(255,93,115,0.15)",
  authentication: "rgba(255,179,71,0.15)",
  ratelimit: "rgba(255,143,171,0.15)",
  input: "rgba(79,195,247,0.15)",
};

export const PRIORITY_COLOR: Record<string, string> = {
  high: "#ff5d73",
  medium: "#ffb347",
  low: "#5ad19a",
};

export const SESSION_COLOR: Record<string, string> = {
  running: "#5ad19a",
  waiting: "#ffb347",
  error: "#ff5d73",
  idle: "#8a8a9a",
};

export function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "—";
  const diff = Date.now() - t;
  const s = Math.floor(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

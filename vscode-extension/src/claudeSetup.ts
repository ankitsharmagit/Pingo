// Writes coding-agent hook configs so Pingo can hear agents whose VS Code
// extensions run shell-less (the Claude Code extension is the first of these).
//
// This is agent-agnostic: an AgentHookSetup describes a settings file path, the
// hook events to register, and the URL they POST to. Claude Code ships built-in
// (enableClaudeHooks); other agents (Codex, Gemini, …) can be registered so the
// same one-click setup works once they adopt hooks. The merge is idempotent —
// it won't add a hook that already targets the same URL, and a user's existing
// settings are preserved (opaque keys are left untouched).

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export function claudeSettingsPath(): string {
  return path.join(os.homedir(), ".claude", "settings.json");
}

export function hookUrl(port: number): string {
  return `http://127.0.0.1:${port}/hook`;
}

interface HookEntry {
  type?: string;
  url?: string;
  [k: string]: unknown;
}
interface HookMatcher {
  matcher?: string;
  hooks?: HookEntry[];
}

export interface SetupResult {
  changed: boolean;
  filePath: string;
  events: string[]; // which hook events were added/ensured
}

// Description of one agent's hook wiring.
export interface AgentHookSetup {
  // Pretty agent name shown to the user ("Claude").
  name: string;
  // Absolute path to the settings file the agent reads its hooks from.
  settingsPath: string;
  // Hook event names to register the http hook under (e.g. ["Notification","Stop"]).
  events: string[];
  // Destination URL the hooks POST to.
  url: string;
}

// The hook events Pingo registers for Claude Code:
// - `Notification` — the alert (permission prompts, idle/waiting-for-you, auth, rate-limit).
// - `Stop` — used *silently* to resolve a held alert when the turn ends; it never
//   makes a sound (it fires every turn, which would be far too noisy).
const CLAUDE_EVENTS = ["Notification", "Stop"] as const;

export function claudeSetup(port: number): AgentHookSetup {
  return {
    name: "Claude",
    settingsPath: claudeSettingsPath(),
    events: [...CLAUDE_EVENTS],
    url: hookUrl(port),
  };
}

function urlAlreadyPresent(matchers: HookMatcher[], url: string): boolean {
  return matchers.some((m) => (m.hooks ?? []).some((h) => h.type === "http" && h.url === url));
}

// Adds the agent's hooks into a parsed settings object. Returns true if changed.
// Hooks are stored under settings.hooks.<event>[].hooks[] — the Claude Code
// schema. Other agents that use a different shape can override via a custom
// merge function once they ship hooks; for now all known agents share it.
export function mergeAgentHooks(
  settings: Record<string, unknown>,
  setup: AgentHookSetup
): boolean {
  const hooks = (settings.hooks ??= {}) as Record<string, HookMatcher[]>;
  let changed = false;
  for (const event of setup.events) {
    const matchers = (hooks[event] ??= []);
    if (!urlAlreadyPresent(matchers, setup.url)) {
      matchers.push({ hooks: [{ type: "http", url: setup.url }] });
      changed = true;
    }
  }
  return changed;
}

// Reads the agent's settings file (tolerating absence), merges Pingo hooks, and
// writes it back. Throws on malformed JSON so the caller can tell the user to
// fix/add manually rather than silently clobbering their file.
export function enableAgentHooks(setup: AgentHookSetup): SetupResult {
  const filePath = setup.settingsPath;
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (raw) settings = JSON.parse(raw) as Record<string, unknown>;
  }
  const changed = mergeAgentHooks(settings, setup);
  if (changed) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2) + "\n", "utf8");
  }
  return { changed, filePath, events: setup.events };
}

// Back-compat wrappers for Claude (the original public API).
export function mergePingoHooks(settings: Record<string, unknown>, port: number): boolean {
  return mergeAgentHooks(settings, claudeSetup(port));
}
export function enableClaudeHooks(port: number): SetupResult {
  return enableAgentHooks(claudeSetup(port));
}
export function claudeHooksEnabled(port: number): boolean {
  const setup = claudeSetup(port);
  const filePath = setup.settingsPath;
  if (!fs.existsSync(filePath)) return false;
  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return false;
    const settings = JSON.parse(raw) as { hooks?: Record<string, HookMatcher[]> };
    return setup.events.some((e) =>
      urlAlreadyPresent(settings.hooks?.[e] ?? [], setup.url)
    );
  } catch {
    return false;
  }
}

// True when the settings file already contains the agent's Pingo hook URL.
export function agentHooksEnabled(setup: AgentHookSetup): boolean {
  const filePath = setup.settingsPath;
  if (!fs.existsSync(filePath)) return false;
  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return false;
    const settings = JSON.parse(raw) as { hooks?: Record<string, HookMatcher[]> };
    return setup.events.some((e) =>
      urlAlreadyPresent(settings.hooks?.[e] ?? [], setup.url)
    );
  } catch {
    return false;
  }
}
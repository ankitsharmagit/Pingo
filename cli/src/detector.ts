// Pingo — Rule-based detection engine for the CLI wrapper.
// Mirrors the rule shape stored in the desktop app's SQLite database.

export interface Rule {
  id: string;
  name: string;
  category: string;
  priority: string; // "high" | "medium" | "low"
  enabled: boolean;
  patterns: string[];
  negative_patterns?: string[]; // if any match, rule is skipped
  agents?: string[]; // if set, only applies to these agents
}

export interface DetectionResult {
  category: string;
  priority: string;
  ruleName: string;
  matchedPattern: string;
  line: string;
}

// Control bytes are built from char codes so there are no literal control
// characters in the source (which are fragile to edit/round-trip).
const ESC = String.fromCharCode(0x1b); // 
const BEL = String.fromCharCode(0x07); // 
const CSI = String.fromCharCode(0x9b); // 

// OSC sequences: ESC ] <arbitrary text> (BEL | ST). PTYs use these to set the
// window title etc.; the text can contain spaces/backslashes, so this is a
// dedicated matcher rather than relying on the CSI regex below.
const OSC_REGEX = new RegExp(
  ESC + "\\][\\s\\S]*?(?:" + BEL + "|" + ESC + "\\\\)",
  "g"
);

// CSI / SGR color / cursor escape sequences: ESC/CSI [ ... <final byte>.
const ANSI_REGEX = new RegExp(
  "[" +
    ESC +
    CSI +
    "][[\\]()#;?]*(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]",
  "g"
);

export function stripAnsi(input: string): string {
  // Strip OSC (window-title etc.) sequences first, then CSI/color/cursor codes.
  return input.replace(OSC_REGEX, "").replace(ANSI_REGEX, "");
}

// Fallback rules used when the desktop app is not reachable. These mirror the
// default rules the desktop app seeds into SQLite, so detection still works
// fully offline / standalone.
export const DEFAULT_RULES: Rule[] = [
  {
    id: "default-permission",
    name: "Permission Required",
    category: "permission",
    priority: "high",
    enabled: true,
    patterns: [
      "approve",
      "allow",
      "continue?",
      "permission required",
      "confirm action",
      "press enter to continue",
      "waiting for approval",
    ],
    negative_patterns: ["approved", "already approved", "automatically approved"],
  },
  {
    id: "default-success",
    name: "Task Completed",
    category: "success",
    priority: "medium",
    enabled: true,
    patterns: [
      "completed",
      "finished",
      "done",
      "successfully generated",
      "task complete",
      "all changes applied",
    ],
    negative_patterns: [
      "not completed",
      "not finished",
      "incomplete",
      "not done",
      "unfinished",
      "in progress",
    ],
  },
  {
    id: "default-authentication",
    name: "Authentication Issue",
    category: "authentication",
    priority: "high",
    enabled: true,
    patterns: [
      "login required",
      "authentication failed",
      "token expired",
      "invalid api key",
      "unauthorized",
    ],
    negative_patterns: ["login successful", "authenticated", "token refreshed"],
  },
  {
    id: "default-error",
    name: "Error",
    category: "error",
    priority: "high",
    enabled: true,
    patterns: ["error", "fatal", "crashed", "failed", "exception"],
    negative_patterns: [
      "no error",
      "no errors",
      "without error",
      "error free",
      "error handling",
      "error message",
      "error code",
      "0 errors",
      "1 error found",
      "no failures",
      "passed",
    ],
  },
  {
    id: "default-input",
    name: "Waiting for Input",
    category: "input",
    priority: "medium",
    enabled: true,
    patterns: [
      "how can i help",
      "what would you like",
      "what you need",
      "what task",
      "what's next",
      "what next",
      "ready to help",
      "caveman ready",
      "ask me anything",
      "type your",
      "submit your",
      "select an option",
      "choose an",
      "enter your",
      "proceed?",
      "could you clarify",
      "are you asking about",
      "permission for",
      "i need more information",
      "please clarify",
      "what do you want",
    ],
    negative_patterns: [],
  },
  {
    id: "default-ratelimit",
    name: "Rate Limit",
    category: "ratelimit",
    priority: "high",
    enabled: true,
    patterns: ["rate limit", "quota exceeded", "too many requests", "session limit", "429"],
    negative_patterns: ["rate limit remaining", "quota remaining"],
  },
];

const PRIORITY_WEIGHT: Record<string, number> = { high: 3, medium: 2, low: 1 };

function needsWordBoundary(pattern: string): boolean {
  // Single words (no spaces, no punctuation) benefit from \b boundary
  return /^[a-z]+$/.test(pattern) && pattern.length > 1;
}

function compilePattern(pattern: string): RegExp | null {
  const trimmed = pattern.toLowerCase().trim();
  if (!trimmed) return null;
  if (needsWordBoundary(trimmed)) {
    return new RegExp("\\b" + trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
  }
  return null;
}

function matches(text: string, pattern: string): boolean {
  const regex = compilePattern(pattern);
  if (regex) return regex.test(text);
  return text.toLowerCase().includes(pattern.toLowerCase().trim());
}

export class Detector {
  private rules: Rule[] = DEFAULT_RULES;
  private agentName: string = "";
  private ignorePatterns: string[] = [];

  setRules(rules: Rule[]): void {
    if (Array.isArray(rules) && rules.length > 0) {
      this.rules = rules;
    }
  }

  setAgentName(name: string): void {
    this.agentName = name;
  }

  setIgnorePatterns(patterns: string[]): void {
    this.ignorePatterns = patterns;
  }

  private activeRules(): Rule[] {
    return this.rules
      .filter((r) => r.enabled && (!r.agents || r.agents.length === 0 || r.agents.includes(this.agentName)))
      .sort(
        (a, b) =>
          (PRIORITY_WEIGHT[b.priority] ?? 0) - (PRIORITY_WEIGHT[a.priority] ?? 0)
      );
  }

  private isIgnored(line: string): boolean {
    if (this.ignorePatterns.length === 0) return false;
    const haystack = line.toLowerCase().trim();
    for (const pattern of this.ignorePatterns) {
      if (haystack.includes(pattern.toLowerCase().trim())) return true;
    }
    return false;
  }

  private isNegated(line: string, rule: Rule): boolean {
    if (!rule.negative_patterns || rule.negative_patterns.length === 0) return false;
    for (const np of rule.negative_patterns) {
      if (matches(line, np)) return true;
    }
    return false;
  }

  // Returns the highest-priority matching rule for a single line of output,
  // or null if nothing matches.
  detect(rawLine: string): DetectionResult | null {
    const clean = stripAnsi(rawLine);
    const haystack = clean.toLowerCase();
    if (!haystack.trim()) return null;
    if (this.isIgnored(clean)) return null;

    for (const rule of this.activeRules()) {
      if (this.isNegated(clean, rule)) continue;
      for (const pattern of rule.patterns) {
        if (matches(clean, pattern)) {
          return {
            category: rule.category,
            priority: rule.priority,
            ruleName: rule.name,
            matchedPattern: pattern,
            line: clean.trim(),
          };
        }
      }
    }
    return null;
  }
}

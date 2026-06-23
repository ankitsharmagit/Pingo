// Pingo — Rule-based detection engine for the CLI wrapper.
// Mirrors the rule shape stored in the desktop app's SQLite database.

export interface Rule {
  id: string;
  name: string;
  category: string;
  priority: string; // "high" | "medium" | "low"
  enabled: boolean;
  patterns: string[];
}

export interface DetectionResult {
  category: string;
  priority: string;
  ruleName: string;
  matchedPattern: string;
  line: string;
}

// Matches ANSI escape / color / cursor sequences so detection runs on the
// raw text an agent prints rather than its terminal control codes.
// (ESC = , CSI = .)
// eslint-disable-next-line no-control-regex
const ANSI_REGEX =
  /[][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?|(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~])/g;

export function stripAnsi(input: string): string {
  return input.replace(ANSI_REGEX, "");
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
  },
  {
    id: "default-error",
    name: "Error",
    category: "error",
    priority: "high",
    enabled: true,
    patterns: ["error", "fatal", "crashed", "failed", "exception"],
  },
  {
    id: "default-ratelimit",
    name: "Rate Limit",
    category: "ratelimit",
    priority: "high",
    enabled: true,
    patterns: ["rate limit", "quota exceeded", "too many requests", "429"],
  },
];

const PRIORITY_WEIGHT: Record<string, number> = { high: 3, medium: 2, low: 1 };

export class Detector {
  private rules: Rule[] = DEFAULT_RULES;

  setRules(rules: Rule[]): void {
    if (Array.isArray(rules) && rules.length > 0) {
      this.rules = rules;
    }
  }

  private activeRules(): Rule[] {
    return this.rules
      .filter((r) => r.enabled)
      .sort(
        (a, b) =>
          (PRIORITY_WEIGHT[b.priority] ?? 0) - (PRIORITY_WEIGHT[a.priority] ?? 0)
      );
  }

  // Returns the highest-priority matching rule for a single line of output,
  // or null if nothing matches.
  detect(rawLine: string): DetectionResult | null {
    const clean = stripAnsi(rawLine);
    const haystack = clean.toLowerCase();
    if (!haystack.trim()) return null;

    for (const rule of this.activeRules()) {
      for (const pattern of rule.patterns) {
        const needle = pattern.toLowerCase().trim();
        if (needle && haystack.includes(needle)) {
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

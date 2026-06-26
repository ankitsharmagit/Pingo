# Changelog

## 1.0.1

**Bug fix release** — fixed endless notification buzzing for Claude Code panel (hook) events.

- **Fixed: endless repeat buzzing for hook events** — the 5-second repeat timer for permission/auth events never stopped for Claude Code panel (hook) events, causing unlimited buzzing. Window refocus now clears the repeat immediately.
- **Fixed: away-gate ignored hook events** — hook events (Claude Code panel, no terminal) were always treated as "away," so permission prompts sounded regardless of whether you were at VS Code. Now treated as attended when the window is focused.
- **Fixed: broken build** — `Channel.run()` method in the notifier was missing its declaration header.

## 1.0.0

First release of Pingo for VS Code — the extension-first product.

- **Passive terminal monitoring** — detects `claude`, `opencode`, `codex`,
  `gemini`, and `aider` run normally in the integrated terminal, with no `pingo`
  prefix. Uses VS Code's Shell Integration API and a headless terminal emulator
  to reconstruct each agent's TUI, then runs rule-based detection.
- **Claude Code extension support** — host a localhost listener for Claude Code's
  `Notification` hook (run *Pingo: Enable Claude Code Integration* once).
- **Away-aware alerts** — alerts stay silent while you work in VS Code and sound
  only once you've stepped away (the window is unfocused) for `pingo.awaySeconds`.
- **Sound, voice, and native notifications** for approvals, completions, errors,
  authentication issues, and rate limits.
- **Status bar** indicator and **event history** (*Pingo: Show Events*).
- **Optional CLI fallback** (`pingo <agent>`) for shells without shell
  integration, surfaced via `pingo.useCliFallback`.

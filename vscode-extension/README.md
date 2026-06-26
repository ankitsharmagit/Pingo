# Pingo for VS Code

Give your coding agents a voice. Pingo hears, sees, and tracks when Claude Code, OpenCode, Codex, Gemini, or Aider need your attention — right inside VS Code.

[![License](https://img.shields.io/github/license/ankitsharmagit/Pingo)](LICENSE.md)

Install the extension and keep using your agents exactly as you do today. No wrapper command, no separate service, no workflow change.

```bash
opencode  claude  codex  gemini  aider
```

Pingo automatically detects approval requests, task completions, errors, authentication issues, and rate limits — then plays a sound, speaks an alert, and shows a non-modal indicator in the activity bar. It never interrupts you with toast popups while you're working.

---

## Setup

1. Install this extension.
2. Use your agents normally. The status bar shows **`$(bell) Pingo Active`** when Pingo is watching your terminals.
3. *(Claude Code extension users only)* Run **`Pingo: Enable Claude Code Integration`** from the Command Palette once, then restart your Claude Code session.

---

## How it works

Pingo watches for "your agent needs you" signals from three independent sources, all feeding the same handler (events are de-duplicated):

| Source | Method |
|--------|--------|
| Terminal agents (claude, opencode, codex, gemini, aider) | Shell Integration API — passive monitoring, no setup |
| Claude Code extension panel | Localhost hook bridge — run the setup command once |
| `pingo <agent>` CLI (optional) | WebSocket client — for shells without shell integration |

For the common case, no CLI, no localhost server, and no WebSocket are needed.

---

## Away-aware alerts

Pingo plays a sound **only when you've stepped away**. While you're attending an agent (terminal active + window focused), the alert is held silently and shown in the status bar with a live countdown. It sounds once you've been away for `pingo.awaySeconds` (default 30). Set to `0` to alert instantly.

All event types alert: approval, authentication, errors, rate limits, completions, and waiting-for-input. For approval and authentication, the sound repeats every 5 seconds until you attend. A held alert is dropped if the agent's turn ends, the terminal closes, or it's held longer than 5 minutes.

---

## Features

- **Passive detection** — no `pingo` prefix, no setup
- **Claude Code extension support** — via Notification/Stop hooks (agent-agnostic bridge)
- **Sound + voice notifications** — for approvals, completions, errors, auth, and rate limits
- **Away-aware alerts** — silent while you work, audible when you've stepped away
- **Non-modal indicator** — events in the activity-bar panel, never interrupting toast popups
- **Status bar** — live countdown while an agent waits, flashes **Approval Needed** when it sounds
- **One-click mute** — `Pingo: Toggle Mute` silences sound/voice instantly
- **Event history** — `Pingo: Show Events` (select for details, copy message, or clear)

---

## Commands

| Command | Description |
|---------|-------------|
| `Pingo: Enable Claude Code Integration` | Wire up Claude Code hooks |
| `Pingo: Toggle Mute` | Silence sound/voice |
| `Pingo: Re-scan Terminals` | Re-detect agents after reload |
| `Pingo: Test Notification` / `Pingo: Test Sound` / `Pingo: Test Voice` | Preview alerts |
| `Pingo: Show Events` / `Pingo: Clear Notifications` | View or clear event history |
| `Pingo: Open Settings` | Configure Pingo |

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `pingo.notify` | `both` | `both` / `sound` / `voice` / `disabled` |
| `pingo.monitorTerminals` | `true` | Passively monitor integrated terminals |
| `pingo.awaySeconds` | `30` | Seconds away before alert sounds (`0` = instant) |
| `pingo.ignorePatterns` | `[]` | Substrings to ignore in detection |
| `pingo.claudeHooks` | `true` | Host Claude Code hook listener |
| `pingo.hookPort` | `4100` | Port for hook listener |
| `pingo.showVscodeNotifications` | `true` | Show events in activity-bar panel |
| `pingo.debug` | `false` | Write diagnostic logs |
| `pingo.useCliFallback` | `false` | Listen to `pingo <agent>` CLI |
| `pingo.port` | `4001` | Port for CLI event server |

---

## Troubleshooting

- **No sound on a fresh install** — Pingo warns once if sound files are missing; reinstalling usually fixes it.
- **Claude Code integration silent** — run `Pingo: Enable Claude Code Integration` again. If port `4100` is busy, Pingo falls forward to the next free port.
- **Agent not detected after reload** — the Shell Integration API can't read past terminal output. Run `Pingo: Re-scan Terminals` to re-detect; scanning resumes once the agent prints new output.

---

## Optional: CLI fallback

For shells without shell integration, install the standalone CLI:

```bash
npm install -g pingo
pingo claude  # or opencode, codex, gemini, aider
```

Enable `pingo.useCliFallback` to surface its events in the extension. Events from both sources are de-duplicated.
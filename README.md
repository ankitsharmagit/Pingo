# Pingo

Monitor AI coding agents (Claude Code, OpenCode, Aider, Gemini CLI, Codex, …)
and get notified when they finish, need approval, hit errors, or need
authentication — with native OS notifications and sounds. Fully local, no OCR,
no cloud, agent-agnostic.

## Quick start

```bash
npm install -g pingo
```

Then run any agent through Pingo:

```bash
pingo claude        # monitor Claude Code
pingo opencode      # monitor OpenCode
pingo aider         # monitor Aider
pingo gemini        # monitor Gemini CLI
```

You'll hear notification sounds and see alerts in your terminal. For rich
dashboard, tray icon, and event history, also run the **desktop app**.

### Desktop app

Download the latest installer from the
[Releases](https://github.com/anomalyco/AgentBell/releases) page (Windows .exe
/ macOS .dmg / Linux .AppImage). Launch it and it auto-connects to your CLI
wrapper.

> No git clone, no npm link, no build step needed.

## Commands

| Command | Description |
| ------- | ----------- |
| `pingo <agent>` | Launch and monitor an AI agent |
| `pingo setup` | Configure notification mode (voice, sound, both, none) |
| `pingo doctor` | Diagnose your setup — CLI version, audio, desktop connectivity |
| `pingo test` | Send a test notification to verify your config |
| `pingo --version` | Show installed version |

## Notification modes

```
pingo setup
```

- **sound** — plays system notification sounds (default)
- **voice** — speaks alerts via text-to-speech
- **both** — sound + voice
- **none** — silent (terminal output only)

Without the desktop app, Pingo uses your system sounds and TTS. With the
desktop app running, notifications are richer (custom sounds, tray icon, event
history).

## Rules

Pingo monitors agent output for these events:

| Event | Example triggers |
| ----- | ---------------- |
| Permission Required | "waiting for approval", "press Enter to continue" |
| Task Completed | "completed", "all changes applied" |
| Authentication | "login required", "token expired" |
| Error | "error", "fatal", "exception" |
| Rate Limit | "rate limit", "quota exceeded", "429" |

Rules are fully customizable. With the desktop app, edit them in the Rules tab.

## Architecture

```
Agent → pingo CLI → terminal (passthrough)
                 → desktop app (WebSocket) → notification + sound + log
```

The CLI wrapper launches your agent, streams its output to the terminal
untouched, and analyzes every line against detection rules. If the desktop app
is running, events are sent over a local WebSocket; otherwise, Pingo handles
notifications itself using your system's sound and voice capabilities.

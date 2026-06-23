```
██████╗ ██╗███╗   ██╗ ██████╗  ██████╗ 
██╔══██╗██║████╗  ██║██╔════╝ ██╔═══██╗
██████╔╝██║██╔██╗ ██║██║  ███╗██║   ██║
██╔═══╝ ██║██║╚██╗██║██║   ██║██║   ██║
██║     ██║██║ ╚████║╚██████╔╝╚██████╔╝
╚═╝     ╚═╝╚═╝  ╚═══╝ ╚═════╝  ╚═════╝ 
```

# Give your coding agents a voice.

Pingo hears, sees, and tracks when **Claude Code, OpenCode, Codex, Gemini, or
Aider** need your attention — with sound, voice, and VS Code notifications.
Fully local, open source, works in seconds.

[![npm](https://img.shields.io/npm/v/pingo)](https://www.npmjs.com/package/pingo)
[![License](https://img.shields.io/github/license/ankitsharmagit/Pingo)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](https://github.com/ankitsharmagit/Pingo/pulls)

---

## The Problem

You start a coding agent. It works through a task. A few minutes later it needs
your approval — but you're no longer watching the terminal. The agent sits idle,
waiting. Time wasted.

Pingo watches your agent for you and calls you back when it needs you.

## How It Works

Pingo has two parts that work together:

- **The CLI** is the engine. It wraps your agent in a real terminal, watches its
  output, runs detection, and broadcasts structured events over a localhost
  WebSocket. Run standalone, it plays sound/voice itself.
- **The VS Code extension** is the presentation layer. It auto-discovers the
  running CLI and turns its events into sounds, voice alerts, native VS Code
  notifications, a status bar indicator, and an event history. No terminal
  parsing, no duplicated detection.

```
You start:        pingo claude
Your agent runs:  [working...]
Agent needs you:  "Do you want to make this edit?"
Pingo alerts you: 🔔 Claude Code needs approval   (sound · voice · VS Code)
```

## Install

**1. Install the CLI**

```bash
npm install -g pingo
```

**2. Install the VS Code extension**

Search **"Pingo"** in the VS Code Marketplace, or:

```bash
code --install-extension pingo
```

The extension auto-connects to the CLI — no setup. The status bar shows
**`$(bell) Pingo Connected`** when attached.

> The extension is optional. The CLI plays sound and voice on its own, so
> `pingo claude` is useful anywhere.

## Use it

Run any supported agent through Pingo:

```bash
pingo claude
pingo opencode
pingo codex
pingo gemini
pingo aider
```

Pingo passes all input/output through untouched — your agent behaves exactly as
before — while alerting you the moment it needs attention.

## What Pingo detects

| Event | Example |
|-------|---------|
| 🔔 Needs approval | "Do you want to make this edit?" |
| 🎉 Task completed | "All changes applied" |
| ❌ Error | exceptions, fatal errors, crashes |
| ⚠ Authentication | "login required", "token expired" |
| ⏳ Rate limit | "rate limit", "quota exceeded", "429" |

## CLI Commands

| Command | What it does |
|---------|-------------|
| `pingo <agent>` | Launch and monitor a coding agent |
| `pingo setup` | Choose notification mode (voice / sound / both / none) |
| `pingo doctor` | Diagnose your installation and audio |
| `pingo test` | Send a test notification |
| `pingo discover` | Scan PATH for installed coding agents |
| `pingo init` | First-time setup wizard |

## VS Code Commands

`Pingo: Test Notification` · `Pingo: Test Sound` · `Pingo: Test Voice` ·
`Pingo: Show Events` · `Pingo: Open Settings`

## Repository layout

```
packages/shared/    @pingo/shared — event types, WebSocket protocol, notifier
cli/                pingo — the monitoring engine (PTY + detection + event server)
vscode-extension/   Pingo for VS Code — the presentation layer
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full picture and
[docs/MIGRATION.md](docs/MIGRATION.md) for how this replaced the old desktop app.

## FAQ

**Does Pingo modify my coding agent?** No. It wraps your agent and passes all I/O
through untouched.

**Does Pingo send my code anywhere?** No. Everything runs locally — the CLI and
the extension talk over `127.0.0.1`. No cloud, no telemetry.

**Is Pingo open source?** Yes, MIT licensed.

## Contributing

Contributions welcome — open an issue or PR at
[github.com/ankitsharmagit/Pingo](https://github.com/ankitsharmagit/Pingo).

---

Licensed under the MIT License.

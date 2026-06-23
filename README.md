```
██████╗ ██╗███╗   ██╗ ██████╗  ██████╗ 
██╔══██╗██║████╗  ██║██╔════╝ ██╔═══██╗
██████╔╝██║██╔██╗ ██║██║  ███╗██║   ██║
██╔═══╝ ██║██║╚██╗██║██║   ██║██║   ██║
██║     ██║██║ ╚████║╚██████╔╝╚██████╔╝
╚═╝     ╚═╝╚═╝  ╚═══╝ ╚═════╝  ╚═════╝ 
```

## ⏳ Never babysit coding agents again.

Pingo alerts you when Claude Code, OpenCode, Codex, Gemini CLI, Cursor, or Aider need your attention — with voice, sound, or desktop notifications. Fully local, open source, works in seconds.

[![npm](https://img.shields.io/npm/v/pingo)](https://www.npmjs.com/package/pingo)
[![License](https://img.shields.io/github/license/ankitsharmagit/Pingo)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](https://github.com/ankitsharmagit/Pingo/pulls)

---

## The Problem

You start a coding agent. It's working through a task. A few minutes later it needs your approval — but you're no longer watching the terminal. The agent sits idle, waiting. Time wasted.

Pingo watches your terminal for you and calls you back when your agent needs you.

## How It Works

```
You start:        pingo claude
Your agent runs:  [working...]
Agent needs help: "Waiting for your response..."
Pingo alerts you: 🔔 Claude Code needs your approval
```

No more tab-checking. No more idle agents. Pingo monitors the output of any coding agent and notifies you the moment something needs your attention.

## Features

- **Voice alerts** — speaks events aloud so you hear them even when looking away
- **Sound notifications** — plays distinct sounds for approvals, errors, completions, and more
- **Desktop notifications** — rich OS-native alerts with event details
- **Approval detection** — knows when an agent is waiting for you
- **Completion detection** — alerts you when a task is done
- **Error detection** — catches errors, warnings, and exceptions
- **Rate limit detection** — lets you know when you've hit a quota
- **Works with any agent** — Claude Code, OpenCode, Codex, Gemini CLI, Cursor, Aider, and more

## Supported Agents

| Agent | Command |
|-------|---------|
| Claude Code | `pingo claude` |
| OpenCode | `pingo opencode` |
| Codex CLI | `pingo codex` |
| Gemini CLI | `pingo gemini` |
| Aider | `pingo aider` |
| Cursor | `pingo cursor` |

## Installation

**1. Install the CLI**

```bash
npm install -g pingo
```

**2. Configure notifications**

```bash
pingo setup
```

Choose voice, sound, both, or none.

**3. Start monitoring**

```bash
pingo claude
```

That's it. Your agent runs normally — Pingo watches the output and alerts you when needed.

### Desktop App (optional)

For richer notifications, tray icon controls, and event history, download the desktop app from the [Releases](https://github.com/ankitsharmagit/Pingo/releases) page.

| Platform | Download |
|----------|----------|
| Windows | `.msi` or `_Setup.exe` |
| macOS | `.dmg` |
| Linux | `.AppImage` |

![Pingo Dashboard](docs/screenshot.png)

> **Windows SmartScreen**: Pingo is not yet code-signed, so Windows may show a warning. Click **More info → Run anyway**. Source code is available for inspection.

## Verify It Works

```bash
pingo test
```

You should hear a sound or voice notification. Run `pingo doctor` at any time to diagnose your setup.

## Commands

| Command | What it does |
|---------|-------------|
| `pingo <agent>` | Launch and monitor an AI agent |
| `pingo setup` | Choose notification mode (voice, sound, both, none) |
| `pingo doctor` | Check your installation and audio |
| `pingo test` | Send a test notification |
| `pingo --version` | Show installed version |

## FAQ

**Does Pingo modify my coding agent?**

No. Pingo wraps your agent and passes all I/O through untouched. Your agent works exactly as before.

**Does Pingo send my code anywhere?**

No. Everything runs locally on your machine. No cloud, no telemetry, no data leaves your computer.

**Is Pingo open source?**

Yes. Licensed under the MIT License. Source code is at [github.com/ankitsharmagit/Pingo](https://github.com/ankitsharmagit/Pingo).

**Why does Windows show a SmartScreen warning?**

The desktop app is not yet code-signed. Click **More info → Run anyway** to proceed. The app is safe and open source.

## Roadmap

- Mobile notifications (iOS / Android)
- Team dashboards for shared agents
- Remote approval flows
- Analytics and usage insights

## Contributing

Contributions welcome. Open an issue or pull request at [github.com/ankitsharmagit/Pingo](https://github.com/ankitsharmagit/Pingo).

---

Licensed under the MIT License.

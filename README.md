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

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-blue)](https://marketplace.visualstudio.com/items?itemName=ankitai.pingo-vscode)
[![npm](https://img.shields.io/npm/v/pingo)](https://www.npmjs.com/package/pingo)
[![License](https://img.shields.io/github/license/ankitsharmagit/Pingo)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](https://github.com/ankitsharmagit/Pingo/pulls)

---

## The Problem

You start a coding agent. It works through a task. A few minutes later it needs
your approval — but you've switched to another window and aren't watching the
terminal. The agent sits idle, waiting. Time wasted.

Pingo watches your agent for you and calls you back when it needs you — and only
when you've actually stepped away.

## How It Works

**Install the VS Code extension and keep using your agents exactly as you do
today** — no wrapper command, no separate service, no workflow change.

```
You run normally:  opencode        (or claude, codex, gemini, aider)
Your agent runs:   [working...]
Agent needs you:   "Do you want to make this edit?"
You're on Chrome:  🔔 OpenCode needs approval   (sound · voice · VS Code)
You're working:    🔇 silent — shown as "armed" in the status bar
```

- **Terminal agents** are watched passively through VS Code's stable **Shell
  Integration API**. Pingo reconstructs the agent's full-screen TUI with a
  headless terminal emulator and runs detection over the rendered screen.
- **The Claude Code extension panel** runs in its own shell-less terminal, so
  Pingo listens to **Claude Code's own hooks** instead (one-time setup command).
- **Away-aware:** alerts stay silent while you're working in VS Code and sound
  only once you've switched to another window for a configurable interval.

No CLI, no localhost server, and no WebSocket are required for the default path.

## Install

Search **"Pingo"** in the VS Code Marketplace, or:

```bash
code --install-extension pingo
```

That's it. The status bar shows **`$(bell) Pingo Active`** when Pingo is watching
your terminals.

**Claude Code extension users:** run **`Pingo: Enable Claude Code Integration`**
from the Command Palette once, then restart your Claude Code session.

## Use it

Just run any supported agent in the integrated terminal as you always have — no
prefix, no change:

```bash
claude  opencode  codex  gemini  aider
```

Pingo detects when each one needs you and alerts you the moment it does, quietly
holding the alert until you've stepped away.

## What Pingo detects

| Event | Example |
|-------|---------|
| 🔔 Needs approval | "Do you want to make this edit?" |
| 🎉 Task completed | "All changes applied" |
| ❌ Error | exceptions, fatal errors, crashes |
| ⚠ Authentication | "login required", "token expired" |
| ⏳ Rate limit | "rate limit", "quota exceeded", "429" |

## VS Code Commands

`Pingo: Enable Claude Code Integration` · `Pingo: Test Notification` ·
`Pingo: Test Sound` · `Pingo: Test Voice` · `Pingo: Show Events` ·
`Pingo: Open Settings`

## Key settings

| Setting | Default | What it does |
|---------|---------|-------------|
| `pingo.notify` | `both` | `both` / `sound` / `voice` / `disabled` |
| `pingo.awaySeconds` | `30` | Seconds the window must be unfocused before alerts sound (`0` = instant) |
| `pingo.monitorTerminals` | `true` | Passively monitor integrated terminals |
| `pingo.claudeHooks` | `true` | Host the Claude Code hook listener |
| `pingo.useCliFallback` | `false` | Also listen to the optional `pingo <agent>` CLI |

## Optional: CLI fallback

For shells/terminals where shell integration isn't available, the standalone
`pingo <agent>` CLI still works and plays sound/voice on its own:

```bash
npm install -g pingo
pingo claude          # or opencode, codex, gemini, aider
```

Enable `pingo.useCliFallback` to also surface its events in the extension; events
from both sources are de-duplicated. CLI commands: `pingo <agent>`, `pingo setup`,
`pingo doctor`, `pingo test`, `pingo discover`, `pingo init`.

## Repository layout

```
packages/shared/    @pingo/shared — event types, WebSocket protocol, notifier
packages/detector/  @pingo/detector — shared rule-based detection engine
vscode-extension/   Pingo for VS Code — the primary product (passive monitor + hooks)
cli/                pingo — optional CLI fallback (PTY + detection + event server)
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full picture and
[docs/MIGRATION.md](docs/MIGRATION.md) for how this replaced the old desktop app.

## FAQ

**Do I need to change how I run my agents?** No — run `claude` / `opencode` /
`codex` / `gemini` / `aider` exactly as you do today. (Claude Code extension
panel needs a one-time hook setup via `Pingo: Enable Claude Code Integration`.)

**Does Pingo modify my agents or send my code anywhere?** No and no. Pingo
observes terminal output read-only and never alters input or output. Everything
runs locally — detection happens in-extension, hook traffic stays on
`127.0.0.1`. No cloud, no telemetry.

**Is Pingo open source?** Yes, MIT licensed.

## Contributing

Contributions welcome — open an issue or PR at
[github.com/ankitsharmagit/Pingo](https://github.com/ankitsharmagit/Pingo).

---

Licensed under the MIT License.

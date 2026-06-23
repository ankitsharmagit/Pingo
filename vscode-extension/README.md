# Pingo for VS Code

**Give your coding agents a voice.** Pingo hears, sees, and tracks when Claude
Code, OpenCode, Codex, Gemini, or Aider need your attention — right inside VS Code.

## How it works

Pingo is a lightweight presentation layer for the **Pingo CLI**. The CLI is the
detection engine: it wraps your coding agent, watches its output, and broadcasts
structured events over a localhost WebSocket. This extension subscribes to those
events and turns them into sounds, voice alerts, VS Code notifications, and a
running event history.

The extension does **no** terminal parsing and **no** detection — all of that
lives in the CLI, so behavior is identical whether you use the CLI alone or with
VS Code.

## Setup

1. Install the Pingo CLI:
   ```bash
   npm install -g pingo
   ```
2. Install this extension.
3. Run your agent through Pingo in the integrated terminal:
   ```bash
   pingo claude
   ```

The extension auto-discovers the running CLI — no manual connection setup. The
status bar shows **`$(bell) Pingo Connected`** when attached and
**`$(warning) Pingo Not Running`** otherwise.

## Features

- **Sound + voice notifications** for approvals, completions, errors, auth, and rate limits
- **Native VS Code notifications** (approval → warning, completed → info, error → error)
- **Status bar** indicator that flashes **Approval Needed** when your agent is waiting
- **Event history** — `Pingo: Show Events`

## Commands

- `Pingo: Test Notification`
- `Pingo: Test Sound`
- `Pingo: Test Voice`
- `Pingo: Show Events`
- `Pingo: Open Settings`

## Settings

- `pingo.notify` — `both` | `sound` | `voice` | `disabled`
- `pingo.port` — localhost port of the CLI event server (default `4001`)
- `pingo.showVscodeNotifications` — toggle native VS Code notifications

# Pingo for VS Code

**Give your coding agents a voice.** Pingo hears, sees, and tracks when Claude
Code, OpenCode, Codex, Gemini, or Aider need your attention — right inside VS Code.

Install the extension and **keep using your agents exactly as you do today**. No
wrapper command, no separate service, no workflow change.

```bash
opencode      # just run it normally
claude        # just run it normally
codex
```

Pingo automatically detects approval requests, task completion, errors,
authentication issues, and rate limits — then plays a sound, speaks an alert,
and shows a non-modal indicator in the activity bar. **It never interrupts you
with toast popups while you're working.**

## How it works

Pingo watches for "your agent needs you" signals from three independent sources.
All three feed the same handler, so events from overlapping sources are
de-duplicated.

```
                                            ┌──────────────────────────┐
  terminal agents (claude, opencode,   ──▶ │ passive terminal monitor │ ──▶
   codex, gemini, aider, in a terminal)     │  (Shell Integration API) │
  Claude Code extension panel         ──▶  ├──────────────────────────┤   ┌──────────────┐
   (shell-less pseudoterminal)              │ localhost hook bridge    │──▶│ one handler  │
                                           ├──────────────────────────┤   │  · alert     │
  ping <agent> CLI fallback (optional) ──▶ │ CLI WebSocket client     │   │  · history   │
                                           └──────────────────────────┘   │  · status bar│
                                                                          └──────────────┘
```

- **Terminal agents** (`opencode`, `claude`, `codex`, `gemini`, `aider` typed in
  the integrated terminal): Pingo passively watches the terminal through VS
  Code's stable **Shell Integration API**, reconstructs the agent's full-screen
  TUI with a headless terminal emulator, and runs its detection rules over the
  rendered screen. Nothing to launch — just use your agent.
- **Claude Code extension panel**: that runs `claude` in its own shell-less
  terminal, so Pingo listens to **Claude Code's own hooks** instead. Run
  **`Pingo: Enable Claude Code Integration`** once to wire it up. The hook
  bridge is agent-agnostic — other agents that ship hook systems can be wired
  the same way.
- **CLI fallback** (optional): for terminals where shell integration isn't
  available, the standalone `pingo <agent>` CLI hosts a localhost WebSocket that
  the extension can also listen to. Off by default — see below.

For the common case, no CLI, no localhost server, and no WebSocket are required.

## Setup

1. Install this extension.
2. Use your agents normally. The status bar shows **`$(bell) Pingo Active`** when
   Pingo is watching your terminals.
3. *(Claude Code extension users only)* Run **`Pingo: Enable Claude Code
   Integration`** from the Command Palette, then restart your Claude Code session.

## "Away" alerts — quiet while you work

By default Pingo only **plays a sound when you've stepped away** from an agent
that needs you. An alert is **held silently** while you're attending it (its
terminal is the active terminal *and* the VS Code window is focused) and shown
in the status bar with a live countdown. It sounds once you've been away
(switched to another tab, or the window unfocused) for `pingo.awaySeconds`
(default `30`). That way an agent in a background tab still pings you while you
work in another tab, but doesn't beep while you're literally reading its
terminal.

Set `pingo.awaySeconds` to `0` to always alert instantly, with no countdown.

**What gets alerted:** every detected event type alerts — approval (`permission`),
authentication, errors, rate limits, completions (`success`), and waiting-for-input.
For `permission` and `authentication` specifically, the sound **repeats every
5 seconds** until you attend — those are the "you're blocked, come back" cases.
A held alert is dropped (never fires) if the agent's turn ends, the terminal
closes, or it's been held longer than 5 minutes.

## Features

- **Passive detection** of terminal agents — no `pingo` prefix, no setup
- **Claude Code extension support** via its Notification/Stop hooks (agent-agnostic bridge)
- **Sound + voice notifications** for approvals, completions, errors, auth, and rate limits
- **Away-aware alerts** — silent while you work, audible when you've stepped away
- **Non-modal indicator** — events show in the Pingo activity-bar panel, never as interrupting toast popups
- **Status bar** with a live countdown while an agent waits and a flash of **Approval Needed** when it sounds
- **One-click mute** — `Pingo: Toggle Mute` silences sound/voice without digging into settings
- **Event history** — `Pingo: Show Events` (select an event for details, copy its message, or clear history)

## Commands

- `Pingo: Enable Claude Code Integration`
- `Pingo: Toggle Mute` / `Pingo: Mute Alerts` / `Pingo: Unmute Alerts`
- `Pingo: Re-scan Terminals for Agents`
- `Pingo: Test Notification` / `Pingo: Test Sound` / `Pingo: Test Voice`
- `Pingo: Show Events`
- `Pingo: Clear Notifications`
- `Pingo: Open Settings`

## Settings

- `pingo.notify` — `both` | `sound` | `voice` | `disabled`
- `pingo.monitorTerminals` — passively monitor integrated terminals (default `true`)
- `pingo.awaySeconds` — seconds away before a held alert sounds (default `30`; `0` = instant)
- `pingo.ignorePatterns` — substrings whose lines are ignored by detection
- `pingo.claudeHooks` — host the Claude Code hook listener (default `true`)
- `pingo.hookPort` — localhost port for the Claude Code hook listener (default `4100`)
- `pingo.showVscodeNotifications` — show events in the activity-bar panel (default `true`; Pingo never uses modal toasts)
- `pingo.debug` — write diagnostic logs to your temp dir for tuning detection
- `pingo.useCliFallback` — also listen to the optional `pingo <agent>` CLI (default `false`)
- `pingo.port` — localhost port of the optional CLI event server (default `4001`)

## Troubleshooting

- **No sound at all on a fresh install:** Pingo warns once if the bundled sound
  files are missing — reinstalling usually fixes it.
- **Claude Code integration silent:** run `Pingo: Enable Claude Code Integration`
  again so the hooks point at the right port. If multiple VS Code windows are
  open, the default port (`4100`) may be busy — Pingo falls forward to the next
  free port and warns you with the port it actually bound to.
- **Agent not detected after reloading the window / restarting VS Code:** the
  stable Shell Integration API can't read a terminal's *past* output, so an
  agent that was already mid-conversation before the reload isn't fully
  re-scanned. Run `Pingo: Re-scan Terminals for Agents` to re-detect it (for the
  status bar and away-gate), and full output scanning resumes once the agent
  prints something new or you start a command in that terminal.

## Optional: CLI fallback

For shells/terminals where shell integration isn't available, the standalone
`pingo <agent>` CLI still works. Enable `pingo.useCliFallback` to also surface its
events in the extension. Events from both sources are de-duplicated.

# Migration Report — Desktop App → VS Code Extension

This documents the architecture pivot from the Tauri desktop app to a VS Code
extension, and the accompanying monorepo restructure.

## Why

The desktop app was the biggest source of install friction: a code-signed
(or SmartScreen-warned) native installer per OS, a system tray, and a separate
process to keep running. The pivot distributes Pingo through the **VS Code
Marketplace** instead, while keeping the CLI fully useful on its own.

## Old vs New

| Concern | Old (desktop) | New (extension) |
|---------|---------------|-----------------|
| UI surface | Tauri window + system tray | VS Code notifications + status bar |
| WebSocket role | Desktop app = **server** `:4001` | CLI = **server** `:4001` |
| CLI role | WebSocket **client** → desktop | WebSocket **server** (source of truth) |
| Detection | CLI (`detector.ts`) | CLI (`detector.ts`) — unchanged |
| Rules storage | SQLite (`db.rs`) | CLI `DEFAULT_RULES` |
| Event history | SQLite | Extension `globalState` (last 200) |
| Sound playback | Rust `audio::play` | `@pingo/shared` notifier (cross-platform) |
| Install | `.msi` / `.dmg` / `.AppImage` | Marketplace + `npm i -g pingo` |
| Distribution | GitHub Releases (signed installers) | Marketplace `.vsix` + npm |

## Architecture flip

The key change is **who hosts the WebSocket server**.

```
OLD:  pingo (WS client)  ──connects to──▶  Desktop app (WS server :4001)
NEW:  VS Code ext (WS client)  ──connects to──▶  pingo (WS server :4001)
```

This matches the new connection-status UX: the extension shows
**"Pingo Not Running"** precisely when no CLI server is up.

## Repository restructure

```
BEFORE                          AFTER
------                          -----
cli/                            package.json          (npm workspaces root)
desktop/   ← Tauri app          tsconfig.base.json
                                packages/shared/      (@pingo/shared)
                                cli/                  (refactored: client → server)
                                vscode-extension/     (new presentation layer)
                                docs/ARCHITECTURE.md
                                docs/MIGRATION.md
```

## What was removed

- `desktop/` — the entire Tauri app: React UI, `src-tauri` (Rust), `ws_server.rs`,
  `db.rs` (SQLite rules + history), tray icons, native audio. Recoverable from git
  history.
- Desktop build jobs in `.github/workflows/release.yml` (Windows/macOS/Linux Tauri
  bundles) and the Windows SmartScreen release note.
- All installer / tray / desktop references in the README.

## What was reused

- `cli/src/detector.ts` — detection engine, unchanged (including the Claude
  permission patterns and TUI-repaint deferral fix from the prior session).
- The generated WAV alert sounds (`desktop/public/sounds` → `packages/shared/sounds`)
  and `generate-sounds.cjs`.
- The CLI's PTY pipeline and notification queue design (moved into the shared
  `Notifier`, which also fixed the async-`SystemSounds.Play()` clipping bug by
  using blocking `SoundPlayer.PlaySync()`).
- The desktop's 128×128 app icon → the extension's Marketplace icon.

## Known follow-ups

- **Publishing the CLI:** `cli` depends on `@pingo/shared` via a workspace `*`
  range. Before `npm publish`, either publish `@pingo/shared` to npm or bundle it
  into the CLI (e.g. esbuild) so a global install resolves it.
- **Multi-instance event aggregation:** today the first `pingo` owns `:4001` and
  additional concurrent sessions run in local-audio-only mode. A future version
  could have secondary instances forward their events to the primary server.
- **Non-Windows audio** is implemented in the shared notifier but has only been
  smoke-tested on Windows.

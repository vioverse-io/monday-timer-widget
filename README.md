# Compu-Mail Timer

A frameless, always-on-top Windows desktop widget that tracks time **locally** and logs
completed sessions as **comments** on a Monday.com board. It keeps the active job
visible at all times and makes switching jobs a one-click action.

## Why local-clock + comments

Monday's API **cannot** write to the time-tracking column (mutations blank it). The
widget owns the clock on the user's machine. When a session ends (stop, switch,
auto-stop, etc.) it posts a **comment (Update)** on the Monday item with the duration
and start/end times in a clean multi-line format (duration, start, end, date).

## Status

- **Demo mode and real Monday mode are both working.**
- Sessions are logged as comments via `create_update` mutation.
- Job picker shows group pills (Priority, Low Priority, Declined, etc.) pulled from
  the board API. No manual group configuration needed.

## Run it

```bash
npm install
npm run dev      # development, with detached devtools
npm start        # plain run
```

With no API token configured, the app boots straight into **demo mode** (yellow banner)
with the 12 mock jobs.

### Browser QA harness (no Electron)

The renderer is plain HTML/CSS/JS that talks to the main process only through
`window.timerAPI`. `src/renderer/harness.js` installs a mock of that bridge **only when
not running under Electron**, so you can open the UI in any browser to test it:

```bash
npx serve src/renderer      # or any static server
```

Deep-link any state for screenshots:

| URL | State |
| --- | --- |
| `index.html` | idle |
| `index.html?running=1` | running |
| `index.html?view=picker` | job picker |
| `index.html?welcome=1` | first-run welcome |
| `index.html?alert=idle` (or `long`, `eod`) | safety-net alert |
| `index.html?morning=1` | morning check-in modal |
| `index.html?sync=2` | unsynced-sessions indicator |

`harness.js` is excluded from production builds.

## Build the Windows installer

```bash
npm run dist     # → dist/CompuMailTimer-Setup-<version>.exe
```

Building a Windows `.exe` from WSL2 may require `wine`. If `npm run dist` fails on
packaging, install `wine` and retry, or build from PowerShell on the Windows side with
Node installed there. Code signing is not configured for v1 — Windows SmartScreen will
warn on first install ("More info → Run anyway").

Tray/app icons are generated (no design tools needed): `node build/gen-icons.js`.

## Architecture

| File | Responsibility |
| --- | --- |
| `src/main.js` | Window, tray, hotkeys, IPC, coordination of timer + API + safety nets |
| `src/preload.js` | `contextBridge` → `window.timerAPI` / `window.settingsAPI` |
| `src/timer.js` | Local-clock engine — single source of truth for the running session |
| `src/monday-api.js` | All Monday GraphQL (real) + demo dispatch; identical signatures |
| `src/mock-data.js` | The 12 demo jobs / groups / user |
| `src/settings.js` | electron-store + `safeStorage`-encrypted token |
| `src/safety-nets.js` | Idle auto-stop, EOD nudge, long-session warning, morning check-in |
| `src/renderer/*` | Widget UI (idle / running / picker / pill) |
| `src/settings-window/*` | Settings UI |

### Settings & data

Settings live in the standard Electron `userData` folder via `electron-store`. The API
token is encrypted with `safeStorage` (OS-backed) when available, else stored plaintext
with a flag. Logs rotate weekly in `userData/logs`.

The in-progress running session is persisted on every tick, so a crash or overnight
shutdown can't lose it — that record is what crash recovery and the morning check-in read.
Failed Monday writes go to a persisted retry queue and are retried on a backoff and on the
next user action; the local timer keeps running regardless of network state.

## Out of scope for v1

Session notes, multi-board, Mac/Linux builds, auto-update, reporting, subitem tracking,
reversing a written session via Undo (Undo restores which job is tracked, not the prior
write), custom themes.

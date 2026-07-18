# CM Timer

A frameless, always-on-top Windows desktop widget that tracks time **locally** and adds
each completed session's minutes to a **"Time Spent" Numbers column** on a Monday.com
board. Built for Compu-Mail. It keeps the active job visible at all times and makes
switching jobs a one-click action.

## Why local-clock + additive writes

Monday's API **cannot** write to the time-tracking column (mutations blank it). The
widget owns the clock on the user's machine. On every stop/switch it reads the item's
current Time Spent value and **adds** the session's minutes (never overwrites — multiple
machines share the board). Failed writes queue locally and retry every 2 minutes, with
visible toasts. Comments (`create_update`) are posted only when the user types a note.

## Status

- **v2.6.0.** Real Monday mode and demo mode both working.
- One window, four states: idle / running / picker at fixed per-view sizes, plus a
  48px minimized bar whose window wraps its measured content exactly (right edge
  pinned). Grabber ⠿ moves it; Esc / double-click / info-click expands it.
- Stopped bar: job number + Resume + Switch + expand (expands to the stopped-summary
  view with Play / Switch / Comment to Monday).
- Stop resets clock to 0:00 with "Saved to Monday"; Play restarts the same job.
- Sessions can't be lost: starting over a running timer switches (and logs) instead of
  discarding; same-day relaunch subtracts the time the machine was off; different-day
  relaunch asks (morning check-in).
- Settings: Monday token/board, Time Spent column picker with auto-detect status,
  hotkeys (modifier required), safety nets, theme (default = Monday-light),
  close-to-tray, launch-on-startup. Manual clock editing (increase-only).
- Picker: group pills to browse, search spans the whole board, 4 recents on idle.
  Job list follows board order (no due-date re-sort).
- Comments support multi-select mention chips (tap to toggle teammates).

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
not running under Electron**, so you can open the UI in any browser:

```bash
npx serve src/renderer      # or any static server
```

Deep-link any state: `?running=1` · `?view=picker` · `?welcome=1` · `?alert=idle|long|eod`
· `?morning=1` · `?sync=2` · `?theme=light`. Excluded from production builds.

## Build the Windows installer

```bash
npm run dist     # → dist/CompuMailTimer-Setup-<version>.exe
```

From WSL2, wine is required (NSIS/rcedit). Unsigned → SmartScreen warns on first install.
Tray/app icons are generated: `node build/gen-icons.js`.

## Architecture

| File | Responsibility |
| --- | --- |
| `src/main.js` | Window, tray, hotkeys, IPC, coordination of timer + API + safety nets |
| `src/preload.js` | `contextBridge` → `window.timerAPI` / `window.settingsAPI` |
| `src/timer.js` | Local-clock engine — single source of truth for the running session |
| `src/monday-api.js` | All Monday GraphQL (real) + demo dispatch; identical signatures |
| `src/mock-data.js` | The 12 demo jobs / groups / user |
| `src/settings.js` | electron-store + `safeStorage`-encrypted token |
| `src/safety-nets.js` | Idle auto-stop, EOD nudge, long-session warning, morning check-in (all local-day math) |
| `src/renderer/*` | Widget UI (idle / running / picker / pill) |
| `src/settings-window/*` | Settings UI |

### Settings & data

Settings live in the Electron `userData` folder via `electron-store`. The API token is
encrypted with `safeStorage`. Logs rotate weekly in `userData/logs`.

The running session is persisted on every tick (including `lastSeenAt`), so crash
recovery can resume it minus the dead time, and the morning check-in can ask about
overnight sessions. Minute-writes that fail (offline, API error) persist in
`pendingTimeWrites` and retry every 2 minutes with user-visible toasts.

Change history: `CHANGELOG.md`. Applied change specs: `production/HANDOFF-N-*.md`.
Project guide for Claude Code sessions: `CLAUDE.md`. Backlog: `v3-planning.md`.

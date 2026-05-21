# Compu-Mail Timer

A frameless, always-on-top Windows desktop widget that tracks time **locally** and logs
**completed** time-tracking sessions to a Monday.com board. It keeps the active job
visible at all times and makes switching jobs a one-click action.

## Why local-clock (read this)

Monday's API **cannot** start or stop a live timer remotely. There is no start/stop
mutation, and writing `start`/`stop` (or a `running: true` state) into the time-tracking
column can blank the column. What the API supports is **reading** sessions and **creating
a finished session** (start + end timestamps).

So this widget owns the clock on the user's machine. When a session ends (stop, switch,
auto-stop, etc.) it writes **one completed session** to Monday with the real start/end
times. Time can never silently keep running against the wrong job inside Monday.

## Status

- **Demo mode is complete and verified.** The full UI, the local-clock engine, and all
  four safety nets run with hardcoded mock data — no token or network required.
- **Real Monday mode is implemented but UNVERIFIED.** Before trusting it, run the
  **Step 0 live-board check** below to confirm the time-tracking column id and the exact
  create-session payload against board `7833051194`, then update `src/monday-api.js`.

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
npm run dist     # → dist/CompuMailTimer-Setup-1.0.0.exe
```

Building a Windows `.exe` from WSL2 may require `wine`. If `npm run dist` fails on
packaging, install `wine` and retry, or build from PowerShell on the Windows side with
Node installed there. Code signing is not configured for v1 — Windows SmartScreen will
warn on first install ("More info → Run anyway").

Tray/app icons are generated (no design tools needed): `node build/gen-icons.js`.

## Step 0 — live-board discovery (REQUIRED before real mode)

Do this once with a real token before relying on real mode. Use the Monday API
playground or a throwaway script:

1. `query { me { id name email } }` — confirm the token and capture the user id.
2. Query board `7833051194` columns; find the **time-tracking** column's real `id` and
   `type`. Do **not** assume the id.
3. Read an existing item's time-tracking column `value` to learn the exact session JSON
   shape (field names for start/end/duration).
4. On a **throwaway test item** (non-priority group), perform the create-completed-session
   write and confirm in the Monday web UI that the session shows with the right
   start/end/duration — and that the column is **not** blanked.
5. Lock in whichever payload actually worked. Update in `src/monday-api.js`:
   - the `timeTrackingColumnId` (also settable via the app, persisted in settings)
   - `logSession()`'s payload to the confirmed shape
   - `API_VERSION` to the current stable version from the changelog
   Then record the confirmed column id and payload here in the README.

> The current implementation uses `change_multiple_column_values` writing
> `{ <ttColumnId>: { started_at, ended_at } }`. This follows Monday's documented general
> form but **must be confirmed** in step 4 before use.

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

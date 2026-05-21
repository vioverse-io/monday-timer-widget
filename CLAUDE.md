# Compu-Mail Timer — project guide for Claude Code

## How to open this project in a terminal (WSL Ubuntu)
Always `cd` into this folder first so Claude can see the files.

- **Fresh session:**
  ```
  cd ~/dev/monday-timer-widget && claude
  ```
- **Resume the previous conversation** (works even after you closed the terminal):
  ```
  cd ~/dev/monday-timer-widget && claude --continue
  ```

This is separate from the `vio` shortcut (that one goes to ~/isolated-test-area for
Vioverse). This project is its own git repo with **no remote** — it is NOT part of Vioverse.

## What this is
A frameless, always-on-top Windows Electron widget that tracks time locally and logs
**completed** time-tracking sessions to a Monday.com board. Single-user, no central server.
Full spec: `monday_timer_widget_build_prompt_v2.md`. Architecture + Step 0: `README.md`.

## Non-negotiable design rule (local-clock model)
Monday's API cannot start/stop a live timer (writing start/stop can blank the time-tracking
column). The widget **owns the clock**; on stop/switch it writes **one finished session**
(real start/end timestamps) to Monday. Never implement remote start/stop.

## Status (keep this updated as work progresses)
- **Demo mode: complete and verified.** **Real Monday mode: implemented but UNVERIFIED.**
- Before trusting real mode, run the **Step 0 live-board check** (see README) and update
  `src/monday-api.js`: `timeTrackingColumnId`, the `logSession` payload, and `API_VERSION`.
- Current version is in `package.json`. The installer is delivered to the user via OneDrive.

## How to verify changes (no Monday token needed)
- **UI in a plain browser** (harness): serve `src/renderer`, then open
  `index.html` with deep-link params:
  `?running=1` · `?view=picker` · `?welcome=1` · `?alert=long` (or `idle`/`eod`) ·
  `?morning=1` · `?sync=2` · `?theme=light`.
  `src/renderer/harness.js` mocks the IPC bridge; it is inert under Electron and excluded
  from packaged builds.
- **Main-process self-test:**
  `SMOKE_TEST=1 ELECTRON_ENABLE_LOGGING=1 ./node_modules/.bin/electron . --no-sandbox`
- **Render real Electron to PNGs:** `CAPTURE=1 ... electron .` → writes `/tmp/cap-*.png`.

## Build the Windows installer
```
npm run dist     # → dist/CompuMailTimer-Setup-<version>.exe  (NSIS, x64)
```
Building from WSL needs **wine** (already installed). If the first wine call (rcedit/NSIS)
times out, run `wineboot --init` once first, then rebuild. Unsigned → SmartScreen warns
("More info → Run anyway"). Bump `package.json` version per build so installers are distinct.

## Conventions / gotchas
- Main process is **CommonJS**; `electron-store` is **v8** (CommonJS). Do not switch to ESM.
- Frameless window: interactive elements must be `-webkit-app-region: no-drag` (and SVGs
  inside buttons need `pointer-events:none`) or clicks get swallowed. The pill and resize
  grip use JS pointer-drag, not app-region.
- Window is `resizable:true` so `setContentSize` works both directions; per-view sizes plus
  a persisted user `userSize` delta.
- API token encrypted via `safeStorage`. Logs in `userData/logs` (weekly rotation).
- Job-number display: best-effort extraction (3–7 digits, `#`/`Job`-aware) — validate
  against real board names in Step 0.
- Time: **Today** = local-day-clipped session time; **Total** = all-time. Timezone EST.
- Commit only when the user asks.

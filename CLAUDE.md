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
Vioverse). This project lives at `vioverse-io/monday-timer-widget` on GitHub (private).

## What this is
A frameless, always-on-top Windows Electron widget that tracks time locally and logs
completed sessions as **comments** on a Monday.com board. Single-user, no central server.
Full spec: `monday_timer_widget_build_prompt_v2.md`. Architecture: `README.md`.

## Non-negotiable design rule (local-clock model)
Monday's API cannot write to the time-tracking column at all (mutations blank it).
The widget **owns the clock**; on stop/switch it posts a **comment (Update)** on the
Monday item with the session duration and start/end times. Never try to write to the
time-tracking column — use `create_update` only.

## Status (keep this updated as work progresses)
- **Demo mode: complete.** **Real Monday mode: working (verified 2026-05-25).**
- Sessions are logged as comments (Updates) on Monday items via `create_update` mutation.
- Job picker uses group pills (Priority, Low Priority, etc.) pulled from the board API.
- Current version is in `package.json`. Installer delivered via GitHub Releases at
  `vioverse-io/monday-timer-widget`.

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
  a persisted user `userSize` delta (only set by the grip, not the `resize` event).
- API token encrypted via `safeStorage` (tied to Windows user account, survives reinstalls
  on the same machine). Logs in `userData/logs` (weekly rotation).
- Job picker pulls all groups from the board API; filter pills are built dynamically with
  each group's Monday color. No manual group configuration in settings.
- Jobs sorted by due date (earliest first). Recents on idle screen use persisted history.
- Time: **Today** = local-day-clipped session time; **Total** = all-time. Timezone EST.
- Monday's API cannot write to the time-tracking column. Do not attempt it. Sessions are
  logged as comments via `create_update` mutation.
- Commit only when the user asks.

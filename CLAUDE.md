# CM Timer — project guide for Claude Code

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
Vioverse). This project lives at `vioverse-io/monday-timer-widget` on GitHub (public).

## What this is
A frameless, always-on-top Windows Electron widget that tracks time locally and exports
accumulated time to a Monday.com board via manual exports. Single-user, no central server.
Full spec: `monday_timer_widget_build_prompt_v2.md`. Architecture: `README.md`.
v3 planning: `v3-planning.md`.

## Non-negotiable design rule (local-clock model)
Monday's API cannot write to the time-tracking column at all (mutations blank it).
The widget **owns the clock**. Stop/switch accumulate time locally and auto-write the
all-time total to two "Time Spent" columns (Numbers + Text) via
`change_simple_column_value`. Comments are posted only when the user types a note
(via `create_update`). Never try to write to the time-tracking column.

## Status (keep this updated as work progresses)
- **v2.2.0** "Focus" UI redesign + Time Spent columns + UX fixes.
  - **Theme**: warm charcoal (dark) / cream paper (light). Coral accent (`#EA5468`).
    Abstract gauge mark replaces old clock-in-red-tile. 56px JetBrains Mono timer.
    Elevated inner cards (`.run-card`), pill buttons (21px radius), progress scrubber
    on running view. Design source: `production/` directory.
  - **Window sizes**: idle 360px, running 324px, picker 480px (width 340 unchanged).
    Window bg: dark `#1E1B17`, light `#F5F1EB`.
  - **Time Spent columns**: on every stop/switch, auto-writes all-time total to two
    Monday columns — Numbers (total minutes, e.g. `220`) and Text (`3h 40m 0s`).
    Auto-detected on startup by type + title "Time Spent".
  - **Comment to Monday**: renamed from "Log to Monday". Posts only the user's note
    (no timing metadata in comments — columns have that). Comment only posts when
    a note is entered.
  - **Stop → Play**: stopped view shows Play button (restarts same job) + Switch.
    No auto-dismiss; stays until user acts.
  - **Paused indicator**: picker shows gray pill with white play icon + "Paused"
    label on last-stopped job. Consistent on both stop and switch flows.
  - **Status dots**: green (running, pulsing), gray (idle), red square (stopped).
    Topbar label auto-colors from dot (`.dot-green + .topbar-label` etc.).
- X button quits the app. Minimize collapses to pill.
- Resize grip uses absolute-delta + `setBounds()` (no feedback loop).
- Installer delivered via GitHub Releases at `vioverse-io/monday-timer-widget`.

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
- Window is `resizable:true` so programmatic sizing works both directions. Each view
  auto-sizes to its content height via `VIEW_SIZES` in `main.js`. Resize grip uses
  `setBounds()` atomically (absolute deltas from drag start) to avoid the feedback loop
  from incremental `setContentSize` + `setPosition`. X button quits; minimize collapses
  to pill.
- API token encrypted via `safeStorage` (tied to Windows user account, survives reinstalls
  on the same machine). Logs in `userData/logs` (weekly rotation).
- Job picker pulls all groups from the board API; filter pills are built dynamically with
  each group's Monday color. No manual group configuration in settings.
- Jobs sorted by due date (earliest first). Recents on idle screen use persisted history.
- Time: **Today** = local-day-clipped unexported delta; **Total** = full unexported delta
  (time since last Comment to Monday). Timezone EST.
- Monday's API cannot write to the time-tracking column. Do not attempt it. Time is
  written to "Time Spent" Numbers + Text columns via `change_simple_column_value` on
  every stop. Comments posted via `create_update` only when user enters a note.
- Commit only when the user asks.

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
The widget **owns the clock**. Stop/switch accumulate time locally — no API call.
Posting to Monday only happens via **Log Time** (single button, posts session + total)
through the `create_update` mutation. Never try to write to the time-tracking column.

## Status (keep this updated as work progresses)
- **v2.0.1** shipped but has bugs — see HANDOFF.md for the full list.
- Renamed to CM Timer. Brand color red. Idle screen shows "CM Timer" title.
- Log Time: one button (no menu). Posts session delta, session count, lifetime total, note, date.
- Comment format: note (if any), `Session (N): Xh Ym`, `Total: Xh Ym`, `MM/DD/YYYY`.
- X button quits the app. Minimize collapses to pill. All full views share one size.
- Resize grip uses absolute-delta + `setBounds()` (no feedback loop).
- **Known bugs in v2.0.1:** job numbers all red (should be group-colored on active only),
  play/export icons visible when they should be hover-only, post-stop "Done" button state
  leaks into next session, system tray icon missing, note field too short. See HANDOFF.md.
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
- Window is `resizable:true` so programmatic sizing works both directions. All full views
  share one persisted size (`fullViewSize`). Resize grip uses `setBounds()` atomically
  (absolute deltas from drag start) to avoid the feedback loop from incremental
  `setContentSize` + `setPosition`. X button quits; minimize collapses to pill.
- API token encrypted via `safeStorage` (tied to Windows user account, survives reinstalls
  on the same machine). Logs in `userData/logs` (weekly rotation).
- Job picker pulls all groups from the board API; filter pills are built dynamically with
  each group's Monday color. No manual group configuration in settings.
- Jobs sorted by due date (earliest first). Recents on idle screen use persisted history.
- Time: **Today** = local-day-clipped unexported delta; **Total** = full unexported delta
  (time since last Log Time). Timezone EST.
- Monday's API cannot write to the time-tracking column. Do not attempt it. Exports are
  posted as comments via `create_update` mutation. Other column types (Numbers, Text) can
  be written via `change_column_value` — planned for v3 (see `v3-planning.md`).
- Commit only when the user asks.

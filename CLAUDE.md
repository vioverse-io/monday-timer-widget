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
A frameless, always-on-top Windows Electron widget that tracks time locally and writes
completed sessions to a Monday.com board. Single-user, no central server.
Original spec: `monday_timer_widget_build_prompt_v2.md` (historical). Architecture:
`README.md`. Backlog: `v3-planning.md`. Change specs live in `production/HANDOFF-N-*.md`
— the highest N is the latest applied spec.

## Non-negotiable rules (violating these caused real data loss / broken windows)
1. **Local-clock model.** Monday's API cannot write to the time-tracking column
   (mutations blank it). The widget owns the clock. Never write to that column.
2. **Time Spent writes are ADDITIVE, never overwrite.** On every stop/switch,
   `accumulateSession()` → `api.addTimeSpent(itemId, durationMs)` reads the current
   Numbers-column value and adds THIS session's minutes. Multiple machines write to the
   same board — an overwrite with a local total destroys the other user's time. The
   old `updateTimeSpent` (write all-time total) is the bug, not the feature.
3. **NEVER call `setResizable()` on the main window** — toggling it collapses the
   frameless window on Windows. The window stays `resizable: true` forever;
   pill-mode locking is done via `setMinimumSize == setMaximumSize`.
4. **The preload file is `src/preload.js`.** There is no `src/renderer/preload.js`;
   never create one.
5. **Day/date comparisons use the LOCAL calendar day** (`localDay()` in
   safety-nets.js). Never `toISOString()` for day math — it's UTC and breaks evening
   behavior for US timezones (EOD nudge re-fires, morning check-in skipped).
6. **No `userSize` / shared resize memory.** Tried in v2.4.0, reverted in v2.4.1: a
   shared delta leaks one view's resize into every view and the launch size. Full views
   use fixed `VIEW_SIZES`; grip-resize is per-session only (snaps back on view change —
   accepted). If ever revisited it must be per-view with content-based minimums.
7. Failed Monday minute-writes queue in `pendingTimeWrites` (retried every 2 min,
   user is toasted). Never make a write path silent.

## Status
- **v2.6.0** on `main`. HANDOFF-5 through HANDOFF-14 applied (see `production/`).
- Window/pill model: one frameless window. Full views auto-size via `VIEW_SIZES`
  (idle 340×392, running 340×324, picker 340×480). Minimize = pill (48px bar):
  the renderer measures the bar's true content width (`width: max-content` +
  ResizeObserver → `viewChanged('pill', w)`), main sizes the window to match, keeps
  the RIGHT edge pinned, and locks min==max so native edge-resize is inert; a
  self-heal `resize` handler snaps back any stray resize (suppressed during
  grab-drag to prevent oscillation). First show waits for `ready-to-show`
  (no launch flash).
- Pill (running): grabber ⠿ drag-to-move · dot · number chip · m:ss clock (ticks every
  second) · today chip · −5/−15 · comment · stop · expand. Pill (stopped): number chip +
  Resume + Switch + expand. Esc, double-click, or clicking the info area expands
  to the stopped-summary view (big number + Play + Switch + Comment), not the
  idle recents. Double-clicking the job number in the pill does NOT expand (guarded).
- Stop → clock resets to 0:00, sub reads "Saved to Monday", button becomes Play
  (restart same job). −5/−15 still available post-stop but clock stays 0:00.
- Sessions can't be silently lost: start-while-running switches (logs the old session);
  stale post-stop "Play" state clears when any timer starts; same-day relaunch subtracts
  the time the app wasn't running (`lastSeenAt` gap, >2 min, with a notification);
  different-day relaunch = morning check-in modal.
- Monday: additive `addTimeSpent` on stop/switch; failures queue + toast; catch-up toast
  when flushed. Column detection is forgiving (normalized title match), a manual
  override lives in Settings (with detected-column status line), failure is toasted.
  Comments (`create_update`) only when the user types a note; multi-select mention
  chips post an array of user ids. API version 2026-01, `items_page(limit: 500)`.
- Picker: group pills scope browsing; typing searches the WHOLE board (results colored
  by their own group). Recents capped at 4. Job list follows board order (no due-date
  re-sort).
- Settings: hotkey recorder requires a modifier (Ctrl/Alt/Win); Time Spent column
  picker with auto-detect status; theme dark/light/auto (default = Monday-light).
  Close-to-tray on by default. Manual clock editing (increase-only).
- Theme: default is light (Monday-neutral palette: airy white + cool grays). Dark
  theme is neutral graphite (no warm/gold cast). Shadows are soft gray, not pink.
  Demo mode label hidden (no longer offered in the UI).
- Electron pinned exactly (42.2.0) — "latest" caused user/coworker version drift.

## How to verify changes (no Monday token needed)
- **UI in a plain browser** (harness): serve `src/renderer`, then open
  `index.html` with deep-link params:
  `?running=1` · `?view=picker` · `?welcome=1` · `?alert=long` (or `idle`/`eod`) ·
  `?morning=1` · `?sync=2` · `?theme=light`.
  `src/renderer/harness.js` mocks the IPC bridge; inert under Electron, excluded from
  packaged builds.
- **Main-process self-test:**
  `SMOKE_TEST=1 ELECTRON_ENABLE_LOGGING=1 ./node_modules/.bin/electron . --no-sandbox`
  (expects the 12 mock jobs).
- **Render real Electron to PNGs:** `CAPTURE=1 ... electron .` → writes `/tmp/cap-*.png`.

## Build the Windows installer
```
npm run dist     # → dist/CompuMailTimer-Setup-<version>.exe  (NSIS, x64)
```
Building from WSL needs **wine** (already installed). If the first wine call
(rcedit/NSIS) times out, run `wineboot --init` once first, then rebuild. Unsigned →
SmartScreen warns ("More info → Run anyway"). Bump `package.json` version per build.
Never hand out an installer until the fixes it contains are user-tested and pushed.

## Conventions / gotchas
- Main process is **CommonJS**; `electron-store` is **v8** (CommonJS). Do not switch to ESM.
- Frameless window: interactive elements need `-webkit-app-region: no-drag`, SVGs inside
  buttons need `pointer-events: none`. The pill grabber and resize grip use JS
  pointer-drag (move-start/move-to/move-end, resize-start/to/end), not app-region.
- Resize grip uses absolute deltas + atomic `setBounds()` (no feedback loop).
- API token encrypted via `safeStorage`. Logs in `userData/logs` (weekly rotation).
- Jobs follow board order (no client-side re-sort); job numbers extracted by `jobNum()`
  (3–7 digits, several name shapes). "Today" clips to the local day (display-side
  handles past-midnight sessions).
- The user is a designer, not a coder: plain English, short answers, walk through test
  checklists one item at a time. Handoffs from Claude Design arrive as
  `production/HANDOFF-N-*.md` — apply them EXACTLY as written; if an anchor doesn't
  match the file, STOP and say so instead of improvising.
- Commit only when the user confirms tests pass; then push to `main` and verify the
  push landed (the design reviewer reads from GitHub).

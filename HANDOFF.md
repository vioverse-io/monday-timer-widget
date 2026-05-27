# v2.0.2 Handoff — Next Session

Current state: v2.0.2 committed and pushed. Installer on GitHub Releases.

## Fixed in v2.0.2

### 1. Job numbers all red in picker
Only the actively running row's job number is now group-colored. All other rows use
the default text color. Fix in `rowEl()`: added `isActive` check before applying color.

### 2. Play/export icons now hover-only
Play pill and export button are `opacity: 0` by default. They appear on hover and on
the active row via CSS rules (`.job-row:hover` and `.job-row.active`).

### 3. Post-stop "Done" button no longer leaks
`dismissStoppedSummary()` is called at the start of `pickJob()` to clear the
`stoppedSession` state and restore the Stop button before starting/switching jobs.

### 4. Post-stop adjustment race condition fixed
`stoppedSession` is now set BEFORE the `await api.stop()` call. This prevents the
`pushState` event from main (which races with the invoke response) from transitioning
to idle view before `showStoppedSummary` runs. The `-5/-15` buttons should now work
reliably during the 10-second post-stop window.

### 5. System tray icon — diagnostics added
Added logging when tray icon loads as empty (`tray icon empty: <path> (exists=...)`).
The icon files exist in `src/renderer/icons/` and paths are correct. **Needs testing
on a real Electron/Windows build** to confirm whether the icons load properly in the
packaged app. If the log shows `exists=true` but still empty, the PNG format may need
conversion to ICO or the dimensions may be wrong for Windows system tray.

### 6. Note field now unlimited textarea
Removed `maxlength="120"`. Converted from `<input>` to `<textarea rows="2">` for
longer descriptions. Enter confirms, Shift+Enter inserts newline.

## Still needs verification on real build
- Bug 4 (post-stop -5/-15 adjustment) — code logic is sound but was flagged as needing
  real Electron testing. The race fix should resolve the root cause.
- Bug 5 (tray icon) — diagnostic logging added. Check `userData/logs` after running the
  packaged build. If icons load empty, try converting PNGs to ICO format.

## What was fixed in v2.0.1 (keep for reference)
- Export double-counting → single Log Time button (session + total, resets delta)
- Resize grip feedback loop → absolute deltas + atomic setBounds()
- Comment format → note first, Session (N), Total, MM/DD/YYYY
- X quits the app, minimize = pill, all views share one size
- Renamed to CM Timer, brand color red, Lucide icons
- Startup crash fix (stale SIZES reference in restorePosition)

## To do next session

### 1. Create CHANGELOG.md
Write a project CHANGELOG covering v1.0 through v2.0.2. Summarize what shipped in
each version.

### 2. Stopped job stays highlighted in picker
When you stop a job and go back to the picker list, the last-stopped job should remain
visually highlighted (e.g. "Stopped" or "Paused" label on the row) so you can easily
find it. Clicking that row starts it right back up. Currently once you stop, there's no
indication in the picker of what you were just working on — you have to hunt for it.

## Not bugs — future work
- v3.0 features in `v3-planning.md` (Numbers column, session log, smart comments)

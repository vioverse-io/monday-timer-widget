# v2.0.1 Handoff — Next Session

Current state: v2.0.1 committed, pushed, installer on GitHub Releases. Has bugs below.

## Bugs to fix (v2.0.2 patch)

### 1. Job numbers all red in picker
All job numbers in the Pick a Job list are red. Only the actively running job's number
should be group-colored. The rest should be the default text color. The bug is in
`rowEl()` in app.js — it sets every job number's color to `groupColor()` unconditionally.
Fix: only apply group color to the active row's number, or don't color numbers at all.

### 2. Play/export icons should not be always visible
The play pill and export (clock) button are visible on every row at all times. They
should only appear on hover (and on the active/playing row). The active row should have
a gray background fill to distinguish it. Revert the opacity changes in styles.css:
play pill back to `opacity: 0` with hover/active showing, export button same.

### 3. Post-stop "Done" button state leaks
After stopping a job, the stop button changes to "Done" with a checkmark (the post-stop
adjustment window). But if you then start a new job or go back to the same job, the
button stays as "Done" instead of reverting to "Stop". The `stoppedSession` state and
the button innerHTML are not being cleared when a new job starts.
Fix: in `applyState()` or `startJob` flow, call `dismissStoppedSummary()` to reset.

### 4. Post-stop adjustment doesn't visually work
The -5/-15 buttons during the 10-second post-stop window don't appear to function
properly. Needs testing and debugging on a real Electron build. The `adjustLastSession`
IPC handler exists in main.js but the renderer flow may not be wiring up correctly.

### 5. System tray icon missing
The app no longer shows in the system tray (the arrow popup in the bottom-right).
The tray is created in `createTray()` which calls `new Tray(trayImage('idle'))`.
Investigate: is the icon file missing from the packaged build? Is `trayImage` returning
an empty image? Or is the tray being destroyed by the new `window-all-closed` →
`app.quit()` flow before it renders?

### 6. Note field character limit too short
The "What did you work on?" input has `maxlength="120"`. Remove the limit — users should
be able to write any length description. In index.html, remove the `maxlength` attribute.
Consider making it a textarea instead of a single-line input for longer notes.

## What was fixed in v2.0.1 (keep for reference)
- Export double-counting → single Log Time button (session + total, resets delta)
- Resize grip feedback loop → absolute deltas + atomic setBounds()
- Comment format → note first, Session (N), Total, MM/DD/YYYY
- X quits the app, minimize = pill, all views share one size
- Renamed to CM Timer, brand color red, Lucide icons
- Startup crash fix (stale SIZES reference in restorePosition)

## Not bugs — future work
- v3.0 features in `v3-planning.md` (Numbers column, session log, smart comments)

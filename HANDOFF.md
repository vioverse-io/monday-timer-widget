# v2.0.3 Handoff — Next Session

Current state: v2.0.3 committed and pushed. Installer on GitHub Releases.

## What's new in v2.0.3

### 1. Stopped job highlighted in picker
After stopping a job and returning to the picker, the last-stopped row is visually
distinct: amber left border, "Stopped" badge in the subtitle, and a stop-square icon
(amber) instead of the play triangle. The play pill and export button are also always
visible on that row (not hover-only). Clicking the row starts it back up. The highlight
clears when any job is picked.

Implementation: `lastStoppedItemId` variable in `app.js` — set on stop, cleared on
`pickJob()`. `rowEl()` checks it to add `.stopped` class and swap the icon. CSS in
`styles.css` for `.job-row.stopped` and `.job-row-stopped-badge`.

### 2. Idle title restyled
"CM Timer" heading on the idle screen is larger (20px), wider letter spacing, with a
thin red underline accent. Slight opacity pullback (0.9) for refinement.

### 3. CHANGELOG.md added
Project changelog covering v1.0.0 through v2.0.3.

## Bugs to fix next session

### 1. Switch button doesn't stop the running job
When a job is running and you click Switch, the timer keeps running while the picker
is open. Expected: clicking Switch should immediately stop the current job, then open
the picker with that job showing the stopped highlight. Currently the job only stops
when you pick a new one (via `switchJob` in `pickJob()`). The Switch button handler
in `bind()` just calls `openPicker('switch')` without stopping first.

### 2. Stopped highlight has a visible delay
When you stop a job and click Switch to open the picker, there's a 1–2 second delay
before the stopped icon/highlight appears on the row. Likely caused by `openPicker`
calling `await api.getJobs('all')` before rendering — the highlight can't show until
the job list comes back and `renderPicker()` runs.

### 3. Old stopped highlight lingers when stopping a second job
Stop job A → pick job B → stop job B → open picker. Job A briefly still shows the
stopped styling before it transfers to job B. `lastStoppedItemId` is cleared in
`pickJob()` and re-set on the next stop, but the picker re-render after `getJobs`
causes a visible transition where the old highlight is briefly present.

## Still needs verification on real build
- Tray icon — diagnostic logging added in v2.0.2. Check `userData/logs` after running
  the packaged build. If icons load empty, try converting PNGs to ICO format.
- Post-stop -5/-15 adjustment race fix (v2.0.2) — code logic is sound but flagged as
  needing real Electron testing.

## Not bugs — future work
- v3.0 features in `v3-planning.md` (Numbers column, session log, smart comments)

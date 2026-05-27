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

## Still needs verification on real build
- Tray icon — diagnostic logging added in v2.0.2. Check `userData/logs` after running
  the packaged build. If icons load empty, try converting PNGs to ICO format.
- Post-stop -5/-15 adjustment race fix (v2.0.2) — code logic is sound but flagged as
  needing real Electron testing.

## Not bugs — future work
- v3.0 features in `v3-planning.md` (Numbers column, session log, smart comments)

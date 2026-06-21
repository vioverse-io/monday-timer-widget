# v2.1.0 Handoff — Next Session

Current state: v2.1.0 committed and pushed. Installer on GitHub Releases.

## What's new in v2.1.0

### UI redesign (Claude Design handoff)
Full visual restyle of the renderer. Design reference and screenshots live in
`Monday timer widget design/design_handoff_ui_redesign/`.

Key changes:
- **Tracking view**: 48px JetBrains Mono hero timer, job-number chip (red/pink,
  11.5px) instead of large green number, bold totals values, 38px Stop/Switch
  buttons with 9px radius.
- **Idle view**: left-aligned with red brand tile (clock SVG) + "CM Timer"
  wordmark (15px/800). Recent rows use job-number chips instead of bullet dots.
  Full-width red "Start a job" CTA with play icon and shadow.
- **Titlebar**: transparent background, `border-bottom: 1px solid var(--hairline)`,
  pulsing green dot when tracking (`cmpulse` animation), muted gray dot when idle.
  Icon buttons use `--ctrl-icon` color.
- **Pill**: rounded capsule (22px radius) with border and shadow. Now shows job
  number between the status dot and elapsed time.
- **Window auto-sizing**: `VIEW_SIZES` in `main.js` — idle 300px, running 248px,
  picker 480px. `resizeForView()` sizes to content on every view change.
- **Color tokens**: new variables `--hairline`, `--text-body`, `--chip-bg/fg`,
  `--ctrl-icon`, `--idle-dot`, `--neutral-chip-bg/fg`, `--distract-bg`. Both
  dark and light themes fully specified.
- **Picker**: borderless filter pills (8px radius), lighter hairline row dividers,
  10.5px sub text, 7px play-pill radius.
- **Distraction buttons**: 30px height, 8px radius, hairline border, transparent bg
  (dark) / #FAFBFC (light).

### Files changed
- `src/renderer/styles.css` — full restyle (new tokens + all components)
- `src/renderer/index.html` — JetBrains Mono font, idle brand mark, job-line flex
  row, pill-number element, play icon in start button
- `src/renderer/app.js` — idle recents chips, pill number update, bold totals
- `src/main.js` — VIEW_SIZES, per-view resizeForView, themeBg color update

## Bugs carried forward from v2.0.3 (not yet fixed)

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
- v2.1.0 visual redesign — verify all views look correct in the real Electron window
  (browser harness doesn't capture window sizing or frameless behavior).

## Not bugs — future work
- v3.0 features in `v3-planning.md` (Numbers column, session log, smart comments)

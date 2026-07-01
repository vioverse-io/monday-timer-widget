# v2.2.0 Handoff — Next Session

Current state: v2.2.0 committed and pushed. Installer on GitHub Releases.

## What shipped in v2.2.0

### Focus UI redesign (from Claude Design)
- Warm charcoal/cream palette, coral accent, Figtree + JetBrains Mono
- Abstract gauge mark (SVG ring) replaces clock-in-red-tile logo
- 56px hero timer, elevated `.run-card`, progress scrubber (decorative, fills per hour)
- Pill buttons (21px radius), rounded search/filter, card shadows
- Status dots: green pulsing (running), gray (idle), red square (stopped)
- Topbar label auto-colors from adjacent dot via CSS sibling selectors
- VIEW_SIZES: idle 360, running 324, picker 480. Window bg: dark `#1E1B17`, light `#F5F1EB`
- Settings window restyled to match (warm tokens, coral accent, rounded cards)
- Design source files in `production/` directory

### Time Spent columns (v3 feature, shipped)
- Auto-detects two "Time Spent" columns on startup: Numbers (type `numbers`/`numeric`)
  and Text (type `text`), both matched by title regex `/time\s*spent/i`
- On every stop/switch, `accumulateSession()` calls `api.updateTimeSpent()` fire-and-forget
- Numbers column: total minutes (e.g. `220`)
- Text column: formatted (e.g. `3h 40m 0s`)
- Column IDs persisted in electron-store, passed through `refreshMode()` → `setCredentials()`

### Comment to Monday (renamed from Log to Monday)
- Button, dialog, toasts all renamed
- Comments post only the user's note text — no session/total/date metadata
- No comment posted when note is empty (unless columns weren't detected — fallback)
- Dialog: title "Comment to Monday", placeholder "Type your comment", button "Post Comment"

### Stop → Play flow
- Stop button becomes Play on stopped view (play triangle icon + "Play" label)
- Clicking Play restarts the same job (calls `api.startJob` with stored itemId/name)
- Stopped view stays indefinitely until user clicks Play or Switch (no 10s auto-dismiss)

### Paused indicator in picker
- Last-stopped job shows gray pill with white play icon (was ugly brown with black square)
- "Paused" label instead of "Stopped"
- Switch button now sets `lastStoppedItemId` so the previous job is consistently marked

## User-requested future work
- **Sort button in picker** — user wants to sort jobs (currently sorted by due date).
  Options: alphabetical, most recent, group, custom Monday order
- **"Return to timer" button in picker** — when a job is running and you're in the
  picker, a button near the search bar to jump back to the running timer view without
  picking a new job
- **Session log** — per-job start/stop history stored locally. See `v3-planning.md`

## Still needs verification
- Tray icon on Windows — diagnostic logging added in v2.0.2, not yet confirmed working
  in packaged builds

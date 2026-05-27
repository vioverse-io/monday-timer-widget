# v2.0.1 Handoff

Current state: v2.0.1 committed, ready for installer build.

## Bugs fixed in v2.0.1

### 1. Export duration double-counting — FIXED
Replaced Export All + Export and Clear with single **Log Time** button.
- Posts session delta (time since last log) + lifetime total in one comment
- Resets deltaMs after every log — no double-counting possible
- Comment format: note (optional), Session (N): duration, Total: duration, MM/DD/YYYY

### 2. Resize grip feedback loop — FIXED
Rewrote the grip from incremental deltas to absolute-delta + atomic `setBounds()`.
- `resizeStart` snapshots window bounds at drag start
- `resizeTo` sends total delta from start, main computes target and calls `setBounds()` once
- No more setContentSize + setPosition fighting → no runaway growth

### 3. Comment format — FIXED
- Removed "Time Logged" header and Export #ID from comments
- Note is first line (if present), no label prefix
- Session includes count: `Session (3): 12m 30s`
- Date is short MM/DD/YYYY format

### 4. Window behavior — FIXED
- X button quits the app (was: hide to tray)
- Minimize collapses to pill (unchanged)
- All full views (idle, running, picker) share one persisted size — no more size jumps

### 5. Post-stop adjustment window — NEW
After hitting Stop, the running view stays for 10 seconds with -5/-15 buttons still
active. Stop button becomes "Done". Auto-dismisses to idle. Adjustments subtract from
the just-saved session's deltaMs/totalMs.

## UX changes in v2.0.1

- Renamed to **CM Timer** (from Compu-Mail Timer)
- Brand color (red) on Start button, accents, and idle title
- Lucide-style icons for play, export/clock, and refresh buttons
- Play pill always visible (group color), export button always visible with outline
- Job numbers colored to match group pill
- Light mode: active row uses gray background with dark bold text

## Not bugs — future work
- v3.0 features in `v3-planning.md` (Numbers column, session log, smart comments)

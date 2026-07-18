# v3.0 Planning — Session Log (remaining)

## Shipped in v2.2.0

### Numbers Column ("Time Spent") ✓
Auto-detected on startup (type `numbers`/`numeric`, title "Time Spent"). On every
stop/switch, writes the job's all-time total as **total minutes** (e.g. `220`).

### Text Column ("Time Spent") ✓
Auto-detected alongside the Numbers column (type `text`, title "Time Spent"). On every
stop/switch, writes the formatted total as **"Xh Xm Xs"** (e.g. `3h 40m 0s`).

Both columns update automatically via `updateTimeSpent()` in `monday-api.js`, called
from `accumulateSession()` in `main.js`. Fire-and-forget (errors logged, don't block).

### Smart Comments ✓
v2 posted a comment on every export. v2.2.0 behavior:
- "Comment to Monday" button posts **only the user's note** (no timing metadata).
- No comment is posted if the note field is empty. Fallback: if neither Time Spent
  column was detected, a comment is always posted so nothing is silently dropped.

## Still planned

### Small user-requested items (carried from v2.2.0 handoff)
- **Sort button in picker** — alphabetical / most recent / group / Monday order
  (currently due-date).
- **Session log** — per-job start/stop history, locally stored (below).
- Tray icon on Windows packaged builds — diagnostic logging added in v2.0.2, still
  unconfirmed.

### Session Log
Every start/stop event recorded locally per job:

```
Job 111122 — Session Log:
  #1  May 26  9:15 AM → 11:30 AM  (2h 15m)
  #2  May 26  1:00 PM →  2:45 PM  (1h 45m)  "Fixed template mapping"
  #3  May 27  8:30 AM → 10:00 AM  (1h 30m)
```

Implementation: `accumulateSession` currently adds duration to totals but discards the
individual record. Push each session into `jobTimers[itemId].sessions[]` — small data,
persists locally via electron-store.

UI: A "Session Log" or "Details" button per job in the picker or running view. Opens a
scrollable list.

On Comment to Monday with a note, the comment could include the session breakdown since
last export:

```
Logged 4h (3 sessions)
- May 26 9:15–11:30 AM (2h 15m)
- May 26 1:00–2:45 PM (1h 45m) "Fixed template mapping"
- May 27 8:30–10:00 AM (1h 30m)
```

## Status

Numbers column + text column + smart comments: **shipped in v2.2.0**.
Session log: not started. Moderate complexity (new UI view).

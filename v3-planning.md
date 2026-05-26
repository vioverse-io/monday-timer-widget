# v3.0 Planning — Numbers Column + Session Log + Smart Comments

## 1. Numbers Column ("Logged Hours")

A board admin adds a Numbers column to the Monday board. The app auto-detects it
(same pattern as the existing time-tracking column detection).

On every export (Export All or Export and Clear), the app writes the job's cumulative
lifetime total to that column via `change_column_value` mutation. The column is always
current and visible on the board — managers see hours at a glance without opening
comments.

**Requires:** Someone with board admin rights to add the column on production boards.

**API:** `change_column_value` on a Numbers column is the simplest Monday mutation.
No rate limit concerns at this volume. No special formatting — just the number.

## 2. Smart Comments (notes drive comments)

Current v2 behavior: every export posts a Monday comment.

v3 behavior:
- Export **with a note** → posts a Monday comment containing the note and session
  duration. Column also updates.
- Export **without a note** → column update only. No comment posted.

This eliminates comment clutter. Comments become meaningful (they have context about
what was done). The column carries the total.

## 3. Session Log

Every start/stop event is recorded locally per job:

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

On export with a note, the comment could include the full session breakdown since last
export:

```
Logged 4h (3 sessions)
- May 26 9:15–11:30 AM (2h 15m)
- May 26 1:00–2:45 PM (1h 45m) "Fixed template mapping"
- May 27 8:30–10:00 AM (1h 30m)
```

## Status

Not started. Planned after v2.0 is stable. Numbers column + smart comments are low
complexity (~30 min). Session log needs a new UI view — moderate complexity.

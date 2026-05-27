# v2.0.0 Handoff — Next Session

Current state: v2.0.0 committed, pushed, installer published on GitHub Releases.

## Bugs to fix (v2.0.1 patch)

### 1. Export and Clear duration is wrong
After doing an Export All followed by an Export and Clear, the Export and Clear
posted the full lifetime total instead of just the delta since the last clear.
Expected: if you do Export All (shows 10m total), then run 6 more seconds and
Export and Clear, the comment should show ~6s, not 10m. Likely a bug in how
deltaMs is calculated or reset after Export All — investigate the interaction
between the two export paths in main.js.

### 2. Resize grip is worse
The position-pinning fix (setContentSize + setPosition restore) is causing new
problems:
- Holding the grip makes the window grow larger and larger uncontrollably
- Window sizes are inconsistent across views (idle → picker → running may each
  render at different sizes after the user resizes one of them)
- Making the idle view smaller, then starting a job, causes the picker to be a
  different size

Root cause is likely the position restore fighting with the incremental delta
tracking in the renderer. The grip sends screen-coordinate deltas, but if
setPosition shifts the window, the next pointermove delta is wrong (double-counted).
May need to rethink the approach — possibly use setBounds() atomically instead of
separate setContentSize + setPosition calls.

### 3. Comments display / ordering
The Monday comment content and ordering needs review. User wants to look at what's
being posted and may want to edit the format. Discuss with user before changing.

### 4. Opening dialog / job list UX
The initial view and job list layout feels unintuitive. User wants to plan this out
further before implementing. Wait for their direction.

## Not bugs — future work
- v3.0 features in `v3-planning.md` (Numbers column, session log, smart comments)
- These are not for the next session unless the user brings them up

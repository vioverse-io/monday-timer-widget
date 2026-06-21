# Changelog

## v2.1.0
- **UI redesign** per Claude Design handoff — compact, content-sized views with a cleaner, calmer design system.
- **Hero timer**: 48px monospace clock (JetBrains Mono) — the running time is now the focal point of the tracking view.
- **Integrated titlebar**: transparent background with hairline divider, pulsing green status dot when tracking, muted gray dot when idle.
- **Auto-sized views**: window snaps to content height per view (idle 300px, running 248px, picker 480px) — no more dead space.
- **Job-number chips**: red/pink chip on tracking view (replaces large green number), idle recents, and minimized pill.
- **Branded idle screen**: left-aligned with red tile + "CM Timer" wordmark, full-width "Start a job" CTA with play icon, job-number chips on recent rows (replaces bullet dots).
- **Redesigned pill**: rounded capsule (22px radius) with border/shadow, showing job number between the status dot and elapsed time.
- **New color token system**: `--hairline`, `--text-body`, `--chip-bg/fg`, `--ctrl-icon`, `--idle-dot`, `--neutral-chip-bg/fg`, `--distract-bg` with refined dark and light themes.
- **Restyled components**: Stop/Switch buttons (38px, 9px radius), distraction buttons (30px, 8px radius, hairline border), borderless filter pills (8px radius), search field (36px, 9px radius), lighter job-row dividers, bold totals values.
- Light theme: Switch button uses white background; pill uses lighter shadow.
- Design reference in `Monday timer widget design/design_handoff_ui_redesign/`.

## v2.0.3
- **Stopped job highlighted in picker**: after stopping, the last-stopped row shows an amber left border, "Stopped" badge, and stop-square icon (amber) instead of the play triangle. Easy to find and resume with one click. Highlight clears when any job is picked.
- Idle screen "CM Timer" title enlarged (20px) with red underline accent.
- Added `CHANGELOG.md` covering v1.0.0 through v2.0.2.

## v2.0.2
- Fixed job numbers all showing group color in picker — only the actively running row is colored now.
- Play pill and export button are hidden by default, appear on hover and on the active row.
- Post-stop "Done" button no longer leaks into subsequent picker/start flows.
- Post-stop adjustment race condition fixed — `stoppedSession` set before the async stop call so `-5`/`-15` buttons work reliably during the 10-second window.
- Note field converted from `<input>` to `<textarea>` with no character limit. Enter confirms, Shift+Enter inserts newline.
- Added tray icon diagnostic logging for Windows build verification.

## v2.0.1
- Renamed to **CM Timer**. Brand color red. Idle screen shows "CM Timer" title.
- **Log Time** button: single button posts session delta, session count, lifetime total, note, and date as a Monday comment via `create_update`.
- Comment format: note (if any), `Session (N): Xh Ym`, `Total: Xh Ym`, `MM/DD/YYYY`.
- Export double-counting eliminated — one Log Time action resets the delta.
- Resize grip rewritten: absolute-delta + `setBounds()` to eliminate the feedback loop from incremental `setContentSize`/`setPosition`.
- Post-stop adjustment window: 10-second window after stopping to subtract distraction time (`-5`/`-15` buttons).
- X button quits the app. Minimize collapses to pill. All full views share one persisted size.
- Lucide icons throughout.
- Fixed startup crash from stale `SIZES` reference in `restorePosition`.

## v2.0.0
- **Manual exports**: accumulated time is posted to Monday only when the user clicks the export button — no automatic API writes on stop/switch.
- **Distraction recovery**: `-5 min` and `-15 min` buttons subtract time from the running session with visual feedback.
- **Refresh button** in the picker to reload jobs from Monday without reopening.
- Resize grip fix: programmatic sizing works both directions (widget is `resizable: true`).
- Pill and full views share one window — minimize collapses to pill, click pill to expand.

## v1.1.0
- **Real Monday mode**: connected to the Monday.com API with `safeStorage`-encrypted token.
- Comment-based session logging via `create_update` mutation (Monday's time-tracking column cannot be written via API).
- **Group filter pills**: dynamically built from the board's groups with each group's Monday color.
- **Due-date sorting**: jobs sorted earliest-first; items with no date go to the end.
- Recents list on idle screen built from persisted history.
- New Lucide-style icons.

## v1.0.3
- Lighter UI look: thinner borders, regular-weight buttons, slim row heights.
- Job number / time display reworked — large green number, description below.
- Light theme support (`data-theme="light"` CSS overrides).

## v1.0.2
- Fixed dead buttons and trapped pill caused by `-webkit-app-region: drag` swallowing clicks.
- Added resize grip (bottom-right corner).
- SVGs inside buttons set to `pointer-events: none` so the button itself is the click target.

## v1.0.1
- Fixed widget window not shrinking back when switching from larger to smaller views.
- Windows-only build target configured in electron-builder.

## v1.0.0
- Initial release: frameless, always-on-top Electron widget.
- Local-clock timer engine — start, stop, switch jobs with accumulated time.
- Demo mode with mock data for UI testing without a Monday token.
- Collapsible pill view with drag-to-move and click-to-expand.
- System tray integration with context menu (show, stop, quick-start jobs, quit).
- Global hotkeys for stop and toggle visibility.
- Safety nets: long-session nudge, end-of-day reminder, morning check-in for overnight sessions.
- Installer via NSIS (electron-builder) delivered through GitHub Releases.

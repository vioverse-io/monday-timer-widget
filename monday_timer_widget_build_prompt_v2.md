# Monday.com Floating Timer Widget — Claude Code Build Prompt (v2)

Build a small floating desktop widget for Windows that tracks time locally and logs completed sessions to a Monday.com board. The widget sits always-on-top so the user never forgets which job they're tracking against, and can switch jobs in one click.

> **IMPORTANT — read this before writing any code.** The Monday.com API does **not** support remotely starting or stopping the native time-tracking timer. There is no "start timer" or "stop timer" mutation, and attempts to force one by writing directly to the time-tracking column can corrupt the column's data. What the API *does* support is **reading** time-tracking sessions and **creating a completed session** (a finished entry with a start time, end time, and duration). This widget is therefore designed around a **local-clock model**: the widget owns the running timer on the user's machine, and when a session ends it writes one finished session to Monday with the real start/end timestamps. Do not implement remote start/stop. See Section 7 for the exact integration approach and the required live-board verification step.

---

## 1. Project Overview

**What it does**

A frameless always-on-top desktop widget that tracks time locally and writes completed time-tracking sessions to a Monday.com board. It replaces the need to keep the Monday tab open and front-and-center while working, and it sidesteps the most common Monday time-tracking failure: forgetting to stop the native timer.

**Core problem it solves**

When switching between jobs unexpectedly, users forget to stop one timer and start another, so time gets logged against the wrong job. Because the widget owns its own clock and only writes finished, correct sessions to Monday, time can never silently keep running against the wrong job inside Monday. The widget keeps the active timer visible at all times and makes switching a one-click action.

**Who uses it**

Internal Compu-Mail team members tracking time against jobs on their STS Project Tracking board. Single-user app, no central server, each user runs their own copy with their own Monday API token.

---

## 2. Tech Stack

- **Electron** (latest stable) for the desktop shell
- **electron-builder** for packaging into a Windows installer
- **electron-store** for persistent settings storage
- **Node.js built-in `fetch`** (Node 18+) for HTTP calls to Monday's GraphQL API
- **Vanilla HTML/CSS/JS** for the renderer process (no React/Vue framework needed for a widget this small)
- **No external CSS framework** — write the styles by hand to keep the bundle tiny

Target: Windows 10/11. Mac support not required for v1.

> **Versions:** Use the current latest-stable Electron at build time rather than pinning to an old major version. Do not hardcode an Electron version number from this document.

---

## 3. Project Structure

```
monday-timer-widget/
├── package.json
├── electron-builder.yml          # Packaging config
├── src/
│   ├── main.js                   # Main process: window, tray, hotkey, safety nets
│   ├── preload.js                # Bridge between main and renderer
│   ├── monday-api.js             # All Monday.com GraphQL calls (real + demo dispatch)
│   ├── mock-data.js              # Hardcoded demo-mode data
│   ├── settings.js               # Read/write settings via electron-store
│   ├── timer.js                  # Local timer / session-state engine (source of truth)
│   ├── safety-nets.js            # The 4 safety-net checks
│   ├── renderer/
│   │   ├── index.html            # Widget UI shell
│   │   ├── styles.css            # Widget styling, dark theme
│   │   ├── app.js                # Renderer logic, UI state, IPC to main
│   │   └── icons/                # Tray icon assets (green, gray, red)
│   └── settings-window/
│       ├── settings.html         # Settings UI (separate window)
│       ├── settings.css
│       └── settings.js
├── build/                        # Build assets (app icon, installer art)
└── README.md                     # Setup instructions
```

---

## 4. UI Specification

### Visual identity

Monday-themed dark mode. Flat surfaces, no gradients, no shadows, no glow effects. Sentence case throughout. Sans-serif system font.

**Color palette (hex values, dark mode):**

```
--bg-primary:    #1F2A40   (main widget background)
--bg-secondary:  #2A3548   (raised surface, button bg)
--bg-tertiary:   #18223A   (top bar, recessed surface)
--border:        #2F3A52   (subtle borders)
--text-primary:  #E6E9F0   (main text)
--text-secondary:#8B92A8   (muted text)
--text-tertiary: #5A6378   (placeholder text)
--accent-green:  #00C875   (timer running, success)
--accent-red:    #E2445C   (stop button, danger)
--accent-blue:   #0073EA   (action, primary button)
--accent-yellow: #FDAB3D   (warnings)
```

### Window properties (main widget)

```js
{
  width: 340,
  height: 220,           // 320 when picker is open
  frame: false,
  transparent: false,
  resizable: false,
  alwaysOnTop: true,
  skipTaskbar: true,     // Lives in tray, not main taskbar
  show: false,           // Hidden on launch, shown via tray click
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false
  }
}
```

### Layout: Running state (340 × 220)

**Top bar (28px tall):**
- Left: small green dot (8px) + "TRACKING" label in 11px uppercase, secondary color
- Right (icons, 14px, secondary color, with hover state): settings gear, minimize, close
- Entire top bar is the drag handle (`-webkit-app-region: drag`)
- Icons need `-webkit-app-region: no-drag` so they're clickable

**Body (padding 12px 14px):**
- Line 1: Job name in 12px, primary color, weight 500, single line with ellipsis truncation
- Line 2: "Job 111122" in 11px secondary color
- Line 3 (margin-top 8px): Elapsed time in 26px monospace primary color + "Today: 2h 47m" in 11px secondary to the right
- Line 4 (margin-top 10px): Two buttons side by side
  - **Stop button**: flex 1, red background `#E2445C`, white text, 6px radius, 8px padding, stop icon + "Stop" label
  - **Switch button**: flex 1, secondary background `#2A3548`, primary text, 1px border `#3D4861`, 6px radius, switch-horizontal icon + "Switch" label

### Layout: Picker state (340 × 320)

Replaces the body of the widget when user clicks Switch. Top bar stays the same except the left side shows a back arrow + "PICK A JOB" instead of the tracking dot.

**Picker body:**
- Toggle row: "Mine only" / "All Priority jobs" segmented control (toggle button)
- Search input: 30px tall, dark recessed background, search icon left, placeholder "Search jobs or paste 6-digit number"
- "RECENT" label (10px uppercase, secondary)
- 5 job rows, each:
  - Padded 7px 8px, 5px radius
  - Job name truncated, 11px primary
  - Below name: "112300 · 1h 12m today" in 10px secondary
  - Right: small play icon in secondary color, turns green on hover
  - Hover state: background `#2A3548`
- "ALL ASSIGNED" label below (collapsible section)
- Remaining jobs in same row format

**Click behavior:**
- Click any row = stop & log current session, start a new local timer on that job, close picker, return to running state
- Click back arrow = return to running state without switching
- Esc key = same as back arrow

### Layout: Collapsed pill (120 × 40)

Toggled by minimize button. Shows just elapsed time and a tiny status dot. Single-click to expand back to full widget.

### Layout: Idle state (no timer running)

Same widget shell. Body shows:
- "No timer running" in 14px secondary color
- A "Start a job" button that opens the picker
- No clock, no stop button

### Settings window (separate Electron window, 480 × 600)

Opened from the gear icon. Standard chrome (frame: true, resizable). Sections:
- **Monday connection**: API token (password input with show/hide toggle), board ID, test connection button
- **Picker scope**: list of all groups on the board as checkboxes, with "Priority - Assigned Projects" checked by default
- **Hotkey**: input to record a key combination, default Ctrl+Alt+T. Also a secondary hotkey for show/hide (optional, blank by default)
- **Safety nets**: 4 toggle switches with descriptions
  - Auto-stop after computer idle for [15] minutes
  - End-of-day nudge at [5:00 PM] if timer still running
  - Long session warning at [4] hours continuous
  - Morning check-in if timer was left running overnight
- **Startup**: "Launch on Windows startup" toggle
- **Demo mode**: toggle to force demo mode even when a token is configured (UI testing)
- **Save** and **Cancel** buttons at bottom

---

## 5. Functional Requirements

### 5.1 Job picker logic

**The picker is populated from the Monday API in real time.** On open, the app:

1. Queries the board for all items in the user-selected groups (default: "Priority - Assigned Projects")
2. For each item, pulls assignees and existing time tracking session data
3. Filters to items where the current user is an assignee (when "Mine only" is on)
4. Sorts by most recent session timestamp (descending)
5. Top 5 = "Recent" list
6. Rest = "All assigned" list (alphabetical or by activity, user-configurable later)

**First-time experience (no widget history yet):** Falls back to Monday's existing time tracking data. The Recent list is built from any sessions the user has logged through Monday's own UI in the past, read from the time-tracking column. If literally zero history exists, Recent is empty and "All assigned" shows everything.

**Search behavior:** Type to filter the visible list. Matches on job name and job number (the trailing 6-digit number in the item name). Search works across both Recent and All assigned sections.

### 5.2 Timer behavior — LOCAL CLOCK MODEL

**The widget owns the clock. Monday receives finished sessions only.** There is no live timer running inside Monday and no remote start/stop. A local timer engine (`src/timer.js`) is the single source of truth for the currently running session.

- **Start**: Begin counting locally. Record the wall-clock start time (`startedAt`). **No API call is made on start** — Monday is not contacted. The widget shows the running state immediately.
- **Stop**: Stop the local timer. Capture the end time (`endedAt`) and compute duration. Then make **one** API call that writes a completed session to the Monday item, preserving the real `startedAt` and `endedAt` timestamps so Monday shows the session at the actual clock times it occurred. On success, clear local running state and go idle. On failure, keep the session locally and queue it for retry (see 5.8) — never silently lose it.
- **Switch (one click)**: Stop & log the current session (as above), then immediately start a new local timer on the selected item. Because starting is local-only, there is no "stop succeeded but start failed" race — the new timer always starts. If the *log-the-old-session* write fails, the old session goes into the retry queue and a toast tells the user, but the new timer is already running cleanly.
- **Today's total**: Sum of all logged session durations on the current item for today (user's local date), read from Monday, **plus** the currently-running local elapsed time. Displayed next to the elapsed time. Refreshed every 30 seconds while the widget is open.

> **Why local-clock:** Monday's API has no start/stop timer mutation; it can only read sessions and create completed ones. Owning the clock locally is both the only workable approach and the more reliable one for this app's purpose — time can never keep silently running against the wrong job inside Monday.

### 5.3 Switch undo

After any switch action, show a small toast at the bottom of the widget:
- Text: "Switched to [new job name] · Undo"
- Visible for 10 seconds
- Click "Undo" = stop the new local timer (discard it, since the new session was local-only and never written to Monday), and resume tracking the previous job by starting a fresh local timer on it. Note: the previously logged session that was written to Monday on switch is **not** automatically deleted by Undo in v1 — Undo restores which job is being tracked, it does not reverse the prior write. (If reversing the prior write is wanted, that's a future enhancement; flag it but don't build it.)

### 5.4 System tray

- Tray icon visible in the Windows system tray at all times the app is running
- Three icon states (use SVG or ICO files in `src/renderer/icons/`):
  - Green dot icon: timer is running
  - Gray icon: idle, no timer running
  - Red icon: safety net was triggered (auto-stop, warning, etc.) and needs user attention
- Hover tooltip: shows current job name and elapsed time (or "No timer running")
- Left-click: toggle widget visibility (show if hidden, hide if shown)
- Right-click menu:
  - Show widget
  - Stop timer (only enabled when running)
  - Recent jobs submenu (top 5)
  - Settings
  - Quit

### 5.5 Global hotkeys

- Default stop hotkey: **Ctrl+Alt+T**
- User-configurable in settings, with a "click to record" key capture input
- Optional second hotkey for "show/hide widget" (default unset)
- Use Electron's `globalShortcut.register()` API
- Validate the user's chosen key combo isn't a known Windows system reserved combination

### 5.6 Window position memory

Save the widget's x/y position to electron-store whenever it moves. Restore on next launch. If the saved position is off-screen (e.g., user disconnected a monitor), reset to a safe default (top-right corner of primary display, 20px margin).

### 5.7 Auto-launch on startup

When enabled in settings, register the app with Windows startup via Electron's `app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true })`. Open as hidden — the widget starts in the tray, no flash of window on boot.

### 5.8 Network resilience / retry queue

Because sessions are only written to Monday on stop/switch, a failed write must never lose data.

- On a failed session write, store the completed session (item id, startedAt, endedAt, duration) in a local persisted retry queue in electron-store.
- Retry queued sessions automatically on a backoff (e.g., 30s, then a few minutes) and whenever the user next performs an action.
- Surface a small non-blocking indicator when there are unsynced sessions ("1 session not yet saved to Monday — retrying").
- The local timer and local elapsed display keep working regardless of network state.

---

## 6. Safety Nets

All four are user-toggleable in settings, defaults shown. All operate on the **local timer**; "stopping" a timer always means "stop the local clock and write the completed session to Monday" per Section 5.2.

### 6.1 Auto-stop on computer idle

- **Default**: ON, threshold 15 minutes
- Use `powerMonitor.getSystemIdleTime()` polled every 60 seconds
- When idle time exceeds threshold AND a timer is running:
  - Stop the local timer automatically, setting the end time to the moment idle began (i.e., subtract the idle duration so the logged session reflects actual work time, not idle time)
  - Write the completed session to Monday
  - Set tray icon to red
  - Show a Windows notification: "Timer auto-stopped after 15 min idle. [Resume] [Dismiss]"
  - "Resume" starts a fresh local timer on the same job

### 6.2 End-of-day nudge

- **Default**: ON, trigger time 5:00 PM
- At the configured time, if a timer is still running:
  - Windows notification: "Your timer is still running on [job name]. Stop it?"
  - Notification has "Stop" and "Keep running" actions ("Stop" stops & logs per 5.2)
- Once dismissed for the day, doesn't re-trigger until next day

### 6.3 Long session warning

- **Default**: ON, threshold 4 hours continuous
- When a single running local session crosses the threshold:
  - Tray icon flashes briefly (3 pulses)
  - Notification: "You've been on [job] for 4 hours straight. Still working on this?"
  - Buttons: "Yes, keep going" / "Stop and switch"
- Only fires once per session, not repeatedly

### 6.4 Morning check-in

- **Default**: ON
- On app launch, if a local timer is found persisted as still running from a previous day (start date is not today):
  - Don't auto-write, but immediately show a modal: "A timer was left running on [job] since [date/time]. What should we do?"
  - Options:
    - "Stop it now (recommended)" — write the session ending at end of yesterday's business hours (configurable)
    - "It was working overnight" — write the session covering the full overnight span
    - "Discard the session" — delete the local running session without writing anything to Monday

> Note: the running session must be persisted locally (electron-store) on every tick or on app quit, so that a crash or overnight shutdown doesn't lose the in-progress session. This persisted running-session record is what the morning check-in reads.

---

## 7. Monday.com API Integration

**Endpoint**: `https://api.monday.com/v2`
**Authentication**: Header `Authorization: <user's personal API token>` (the raw token, no "Bearer " prefix)
**API version**: Send the current stable version as the `API-Version` header. **Do not hardcode an old date from this document** — check the current API version in the docs/changelog at build time and use that.
**Format**: GraphQL POST requests

**Key reference**: https://developer.monday.com/api-reference/docs
**Time tracking reference**: https://developer.monday.com/api-reference/reference/time-tracking

### CRITICAL constraint — no remote start/stop

Monday's API can **read** the time-tracking column and **create a completed session** on it. It **cannot** start or stop a live timer remotely. Do **not** attempt a `change_simple_column_value` with `value: "start"` / `"stop"`, and do **not** try to write a `running: true` state into the column — both are unsupported and can blank out the column. All logging happens as **completed sessions written on stop/switch** (Section 5.2).

### STEP 0 — Live-board discovery & verification (do this before building the API layer)

Before wiring the real API into the UI, Claude Code must run a small discovery/verification pass against the real board so the exact column ID and the exact create-session mutation format are confirmed rather than assumed. Do this with a throwaway script or the Monday API playground using the user's token:

1. Run `query { me { id name email } }` to confirm the token works and get the current user id.
2. Query board 7833051194 for its columns and **find the time-tracking column's real `id` and `type`** (do not assume a column id).
3. Read an existing item's time-tracking column value to learn the exact JSON shape Monday returns for sessions (start/end/duration fields).
4. On a **throwaway test item** (create one in a non-priority group, or use a designated test item), perform the **create-completed-session** write and confirm in the Monday web UI that the session appears correctly with the expected start/end/duration — and that the column is **not** blanked.
5. Lock in whichever mutation shape actually works as the implementation, and write a short note in the README documenting the confirmed column id and mutation format.

> The current accepted mechanism for adding a finished session is a column-value mutation that supplies the session's start time, end time, and/or duration to the time-tracking column (commonly via `change_multiple_column_values` with the time-tracking column's value as a JSON object). Because Monday's exact accepted payload shape for this has varied, **Step 0 is mandatory** — confirm the working format against the live board before building on it, then implement exactly that.

### Required queries

**Get current user (for "Mine only" filter):**
```graphql
query { me { id name email } }
```

**Get all groups in the board (for settings UI):**
```graphql
query {
  boards(ids: [7833051194]) {
    groups { id title color }
  }
}
```

**Discover columns (Step 0 — find the time-tracking column id):**
```graphql
query {
  boards(ids: [7833051194]) {
    columns { id title type }
  }
}
```

**Get items in selected groups with assignees and time tracking:**
```graphql
query {
  boards(ids: [7833051194]) {
    groups(ids: ["<group_ids>"]) {
      items_page(limit: 100) {
        items {
          id
          name
          column_values {
            id
            type
            value
            text
          }
        }
      }
    }
  }
}
```

Then filter `column_values` for the People column (type `people`) to get assignees and the Time-tracking column (the id confirmed in Step 0) to read existing session history.

**Write a completed session (mutation — CONFIRM EXACT SHAPE IN STEP 0):**

The implementation must use whatever payload Step 0 confirmed works against board 7833051194. The general form is a column-value mutation targeting the time-tracking column with a session that carries real start and end timestamps. Implement the confirmed-working version; do not ship the unsupported `value: "start"` / `"stop"` approach.

**Polling**: Refresh the picker data every 5 minutes while the widget is open, or immediately on user action. Don't hammer the API.

### Rate limits

Monday's API has a complexity-based rate limit. For this app's usage pattern it'll never come close, but wrap API calls in a generic error handler that surfaces friendly errors if anything fails: "Couldn't reach Monday. Retry in 30 seconds…"

---

## 7.5 Demo Mode (for offline UI testing)

The app supports a **demo mode** that runs the full UI with hardcoded mock data instead of calling the Monday API. This lets developers iterate on the UI without needing API access or network connectivity. **Demo mode is fully functional without any Monday connection and is the recommended way to build and verify the entire app before connecting the real board.**

### When demo mode activates

- **Automatic**: If no API token is configured on first launch, the app boots into demo mode and shows a "DEMO MODE" banner (yellow, 11px) at the top of the widget.
- **Manual**: A "Demo mode" toggle in settings can force-enable it even if a token is configured. Useful for UI testing.
- The banner is dismissible per session but always returns on next launch while in demo mode.

### Mock data

Hardcoded in `src/mock-data.js`. Include these 12 fake jobs (based on the real STS Project Tracking board) so the picker has realistic content to render:

```js
export const MOCK_JOBS = [
  { id: '1', name: 'Command HPP - Medicare Provider Termination - 111122', assignedToMe: true, todayMs: 5025000 },
  { id: '2', name: 'Command Resi - Resi Daily - NYC Lead Inspections - 112300', assignedToMe: true, todayMs: 4320000 },
  { id: '3', name: 'Command VNS - Weekly Provider Term - 109437', assignedToMe: true, todayMs: 1320000 },
  { id: '4', name: '114041 - New Command Anthem Project', assignedToMe: true, todayMs: 0 },
  { id: '5', name: 'CarX - FTP data upload tests - 106536', assignedToMe: false, todayMs: 0 },
  { id: '6', name: '114079 new VNS Command Recert letter', assignedToMe: true, todayMs: 0 },
  { id: '7', name: '112905 - HCHB, AgeIn, Docusign', assignedToMe: true, todayMs: 39562000 },
  { id: '8', name: '113035 Selective Inserting', assignedToMe: true, todayMs: 0 },
  { id: '9', name: 'AAA Reading Berks IMS Midnight Job Number 113471', assignedToMe: true, todayMs: 0 },
  { id: '10', name: 'Command HPP - New Medicaid and CHIP NDN/NOA - 113426', assignedToMe: true, todayMs: 0 },
  { id: '11', name: '113516 IMS Testing Northampton Schuylkill', assignedToMe: true, todayMs: 0 },
  { id: '12', name: 'CRM System Hoosier AAA Club Job Number 112616', assignedToMe: true, todayMs: 0 }
];

export const MOCK_GROUPS = [
  { id: 'g1', title: 'Priority - Assigned Projects', color: '#E2445C' },
  { id: 'g2', title: 'Low Priority Projects', color: '#0073EA' },
  { id: 'g3', title: 'Declined Requests', color: '#FDAB3D' }
];

export const MOCK_USER = { id: '999', name: 'Demo User', email: 'demo@example.com' };
```

### Behavior in demo mode

- Picker shows the mock jobs filtered by "Mine only" toggle (jobs with `assignedToMe: true` visible by default)
- Search works against the mock list
- Start/stop/switch actions update local state only, no API calls (this is the same local-clock engine used in real mode, just with the Monday write stubbed out)
- Today's total counts up correctly from the timer start (mock `todayMs` + live local elapsed)
- Safety nets all work (idle detection, EOD nudge, long session warning, morning check-in)
- Switching to demo mode clears any real session state to avoid confusion
- Switching from demo mode back to real mode requires a saved/valid API token

### Code organization

The `monday-api.js` module should expose the same function signatures whether real or mock. Use a flag at startup to decide which backend:

```js
// monday-api.js
import { MOCK_JOBS, MOCK_GROUPS, MOCK_USER } from './mock-data.js';

let isDemoMode = false;

export function setDemoMode(enabled) { isDemoMode = enabled; }

export async function getMe() {
  if (isDemoMode) return MOCK_USER;
  // real API call here
}

export async function getItems(boardId, groupIds) {
  if (isDemoMode) return MOCK_JOBS.filter(/* group filter */);
  // real API call here
}

export async function logSession(itemId, startedAt, endedAt) {
  if (isDemoMode) return { ok: true };       // no-op in demo
  // real create-completed-session mutation here (shape confirmed in Step 0)
}

// etc for all API functions
```

This keeps the renderer code identical between modes — it doesn't know or care which backend is active. The **local timer engine (`src/timer.js`) is identical in both modes**; only the `logSession` write differs (real mutation vs. no-op).

---

## 8. Settings & First-Run Experience

### First launch

If no API token is stored, the app shows a welcome screen with two options:
1. **Connect to Monday** — opens the settings window for API token + board setup
2. **Try demo mode** — boots into the widget with mock data and a yellow "DEMO MODE" banner

If the user picks "Connect to Monday", they must:
1. Paste their Monday personal API token
2. Confirm or edit the board ID (default `7833051194`)
3. Click "Test connection"
4. If test passes, the app fetches groups and shows the group checkbox list with "Priority - Assigned Projects" checked
5. Click "Save and start"

After save, the widget appears in idle state and the tray icon goes gray (ready).

### Settings persistence

- All settings stored via `electron-store`
- API token stored as securely as practical. Prefer Electron's `safeStorage` API (OS-backed encryption) to encrypt the token before persisting it; fall back to electron-store if `safeStorage` is unavailable. Do not store the token in plaintext if it can be avoided.
- Settings file lives in the standard Electron app data folder

### Settings validation

- Test Connection button performs a `me` query against the API to validate the token
- Board ID validation: query the board, confirm it exists and the user has access
- Show clear error messages: "Invalid token", "Board not found or no access", etc.

---

## 9. Build & Distribution

### Development

```bash
npm install
npm run dev          # Run in development mode with devtools
```

### Production build

```bash
npm run dist         # Builds Windows installer
```

Output: `dist/CompuMailTimer-Setup-1.0.0.exe` (or similar)

> **Building from WSL2:** Building a Windows `.exe` from WSL2 can require `wine`. If `npm run dist` errors on packaging, either install `wine` and retry, or build from PowerShell on the Windows side with Node installed there.

### electron-builder config

```yaml
appId: com.compumail.timerwidget
productName: Compu-Mail Timer
copyright: Compu-Mail LLC
directories:
  output: dist
win:
  target: nsis
  icon: build/icon.ico
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
```

### Code signing

Not required for v1. The installer will trigger Windows SmartScreen on first install but users can click "More info → Run anyway". Add real code signing later if rolling out to the wider team.

---

## 10. Acceptance Criteria

The build is done when all of the following work end to end.

**Demo-mode (verifiable tonight, no token needed):**

- [ ] Installer runs and creates a shortcut + tray icon on launch
- [ ] First launch with no token boots into demo mode with the yellow banner
- [ ] Widget shows in idle state; "Start a job" opens the picker
- [ ] Picker shows the 12 mock jobs, "Mine only" filter and search both work
- [ ] Start begins the local clock; elapsed time counts up in monospace
- [ ] Stop returns to idle; Today's total reflects the just-finished session
- [ ] Switch logs the old (local) session and starts the new one in one action
- [ ] Undo toast appears after switch and restores the previous job
- [ ] Collapsed pill: minimize collapses to pill, click pill expands back
- [ ] Tray icon changes color correctly based on state (green/gray/red)
- [ ] Tray right-click menu works (Show, Stop, Recent submenu, Settings, Quit)
- [ ] Global hotkey (Ctrl+Alt+T default) stops the timer from any app
- [ ] Widget position persists across restarts
- [ ] Computer idle for 15 minutes auto-stops the timer (subtracting idle time)
- [ ] EOD nudge fires at configured time
- [ ] Long session warning fires after configured threshold
- [ ] Morning check-in modal appears if a timer was left running overnight
- [ ] Launch on startup option works

**Real-board (verifiable at work, requires token + Step 0):**

- [ ] Step 0 discovery confirms the time-tracking column id and a working create-session mutation against board 7833051194
- [ ] First launch opens settings, accepts API token, validates against Monday
- [ ] Settings successfully fetches and displays all groups on board 7833051194
- [ ] Picker shows real jobs from Monday filtered to the user's assignments
- [ ] Stopping a session writes one completed session to Monday with correct start/end/duration (confirmed in the Monday web app)
- [ ] Switch logs the completed session to Monday and starts the new local timer
- [ ] A failed write goes to the retry queue and syncs on retry (no data lost)
- [ ] Today's total matches Monday's recorded time plus live local elapsed

---

## 11. Out of Scope for v1

These are deliberately not in v1 — note them for future versions but don't build them:

- Session note field ("what did you just work on?")
- Multi-board support (only one board for now, configurable)
- Mac/Linux builds
- Auto-update mechanism
- Team-wide deployment tooling
- Reporting/dashboard views
- Subitem time tracking (only parent items)
- Reversing a previously-written session via Undo (Undo restores tracking state only)
- Custom themes (Monday-themed dark only)

---

## 12. Notes for Implementation

- The widget should feel **fast**. UI updates should be instant; the local timer is the source of truth so the clock never waits on the network. The Monday write happens in the background on stop/switch.
- Keep the renderer process logic separate from the main process. All API calls and the timer engine live in/are coordinated by the main process and use IPC to send data to the renderer.
- Use `contextIsolation: true` and a preload script with `contextBridge` to expose a clean API to the renderer.
- Persist the in-progress running session to electron-store frequently (each tick or on quit) so a crash or shutdown can't lose it — this is what the morning check-in and crash recovery rely on.
- Log to a file in the app data folder for debugging. Rotate logs weekly.
- Handle network errors gracefully — if Monday is unreachable, the local timer keeps counting and the completed session is queued for retry (Section 5.8). Never lose user state due to a transient network issue.
- **Build and verify everything in demo mode first.** Only after the full UI and safety nets pass in demo mode, do Step 0 against the live board and wire in the real `logSession` write.

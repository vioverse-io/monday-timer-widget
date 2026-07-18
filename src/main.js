// Main process: window, tray, hotkeys, safety nets, IPC, and coordination of the
// local-clock timer engine with the Monday API (real or demo).

const {
  app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain,
  Notification, nativeImage, screen, nativeTheme
} = require('electron');
const path = require('path');
const fs = require('fs');

const settings = require('./settings');
const timer = require('./timer');
const api = require('./monday-api');
const safetyNets = require('./safety-nets');

const isDev = process.argv.includes('--dev');

const PILL_SIZE = { w: 392, h: 48 };       // running: grabber + info + controls
const PILL_SIZE_IDLE = { w: 172, h: 48 };  // idle/resume: grabber + one action
const DEFAULT_FULL_SIZE = { w: 340, h: 360 };
const VIEW_SIZES = {
  idle:    { w: 340, h: 392 },
  running: { w: 340, h: 324 },
  picker:  { w: 340, h: 480 },
};

let mainWindow = null;
let settingsWindow = null;
let tray = null;
let currentUser = null;
let demoMode = false;
let bannerVisible = false;
let trayState = 'idle';
let trayFlashTimer = null;
let jobsCache = { recent: [], all: [], byId: {} };
let pendingMorning = null;
let undoTimer = null;
let lastFullView = 'idle';
let currentView = 'idle';
let currentPillSize = null;  // {w,h} the pill window is currently locked to (measured)

// ---------------------------------------------------------------------------
// Logging (weekly-rotated file in userData/logs)
// ---------------------------------------------------------------------------
function log(msg) {
  if (isDev || process.env.ELECTRON_ENABLE_LOGGING) console.log('[timer]', msg);
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const now = new Date();
    const week = `${now.getFullYear()}-w${String(getWeek(now)).padStart(2, '0')}`;
    fs.appendFileSync(path.join(dir, `app-${week}.log`), `[${now.toISOString()}] ${msg}\n`);
    pruneLogs(dir);
  } catch {
    /* logging must never crash the app */
  }
}
function getWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((date - firstThursday) / 86400000 - 3) / 7);
}
function pruneLogs(dir) {
  const cutoff = Date.now() - 28 * 24 * 3600 * 1000;
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
    } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Mode / credentials
// ---------------------------------------------------------------------------
function refreshMode() {
  demoMode = settings.get('forceDemoMode') || !settings.hasToken();
  api.setDemoMode(demoMode);
  if (!demoMode) {
    api.setCredentials({
      token: settings.getToken(),
      boardId: settings.get('boardId'),
      timeTrackingColumnId: settings.get('timeTrackingColumnId') || null,
      timeSpentColumnId: settings.get('timeSpentColumnId') || null,
      timeSpentTextColumnId: settings.get('timeSpentTextColumnId') || null
    });
  }
  bannerVisible = demoMode; // banner returns every launch while in demo mode
}

// ---------------------------------------------------------------------------
// State broadcast
// ---------------------------------------------------------------------------
// Effective theme: 'dark' | 'light' (resolving 'auto' against the OS).
function effectiveTheme() {
  const t = settings.get('theme') || 'dark';
  if (t === 'auto') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  return t;
}
function themeBg(theme) {
  return theme === 'light' ? '#F5F1EB' : '#1E1B17';
}
function applyThemeToWindows() {
  const bg = themeBg(effectiveTheme());
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(bg);
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.setBackgroundColor(bg);
  pushState(); // renderer applies data-theme from state.theme
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('theme', effectiveTheme());
}

function appState() {
  const s = timer.getState();
  return {
    ...s,
    todayMsBase: timer.todayMsBase,
    totalMsBase: timer.totalMsBase,
    demoMode,
    bannerVisible,
    theme: effectiveTheme(),
    firstRun: !settings.get('setupComplete')
  };
}
function pushState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('state', appState());
  }
}
function pushSyncStatus() {
  const count = (settings.get('pendingTimeWrites') || []).length;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sync-status', { count });
  }
}
function sendToast(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('toast', payload);
}
function sendAlert(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('alert', payload);
  showWidget();
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function restorePosition() {
  const saved = settings.get('windowPosition');
  const wa = screen.getPrimaryDisplay().workArea;
  const fallback = { x: wa.x + wa.width - DEFAULT_FULL_SIZE.w - 20, y: wa.y + 20 };
  if (!saved) return fallback;
  const onScreen = screen.getAllDisplays().some((d) => {
    const b = d.bounds;
    return saved.x >= b.x && saved.x < b.x + b.width && saved.y >= b.y && saved.y < b.y + b.height;
  });
  return onScreen ? saved : fallback;
}

let savePosTimer = null;
function savePosition() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [x, y] = mainWindow.getPosition();
  clearTimeout(savePosTimer);
  savePosTimer = setTimeout(() => settings.set('windowPosition', { x, y }), 400);
}

function createMainWindow() {
  const pos = restorePosition();
  const start = VIEW_SIZES.idle;
  mainWindow = new BrowserWindow({
    width: start.w,
    height: start.h,
    x: pos.x,
    y: pos.y,
    useContentSize: true,
    frame: false,
    transparent: false,
    // Resizable so the user can grow the widget AND so programmatic setContentSize
    // works in BOTH directions (a non-resizable window won't shrink on Windows).
    resizable: true,
    minWidth: 120,
    minHeight: 40,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: themeBg(effectiveTheme()),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // First show happens only after the renderer painted (and DPI scaling applied) —
  // otherwise Windows flashes one oversized/white frame at launch.
  mainWindow.once('ready-to-show', () => {
    const wasHidden = app.getLoginItemSettings().wasOpenedAsHidden;
    if (!wasHidden && !process.env.SMOKE_TEST && !process.env.CAPTURE) showWidget();
  });
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.on('move', savePosition);
  // Self-heal: if ANYTHING resizes the window while it's a pill (native quirks,
  // stray setBounds), snap it back to the locked measured size.
  mainWindow.on('resize', () => {
    if (currentView !== 'pill' || !mainWindow || mainWindow.isDestroyed()) return;
    const p = currentPillSize || (timer.isRunning() ? PILL_SIZE : PILL_SIZE_IDLE);
    const [w, h] = mainWindow.getContentSize();
    if (w !== p.w || h !== p.h) mainWindow.setContentSize(p.w, p.h);
  });
  // Surface renderer warnings/errors to the log file for diagnosis.
  mainWindow.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) log('renderer: ' + message);
  });
  mainWindow.on('close', (e) => {
    // Close-to-tray (default on): unless we're really quitting (tray Quit / before-quit),
    // hide to the tray and keep running instead of exiting.
    if (settings.get('closeToTray') !== false && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.hide();
      return;
    }
    // Real quit path.
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
    app.isQuitting = true;
  });
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

function resizeForView(view, pillW) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  currentView = view;
  if (view !== 'pill') lastFullView = view;

  const b = mainWindow.getBounds();

  if (view === 'pill') {
    // Width comes measured from the renderer (bar's real content width). Fallback to
    // the old constants if it's ever missing. Clamped for sanity.
    const fallback = timer.isRunning() ? PILL_SIZE : PILL_SIZE_IDLE;
    const w = Math.round(Math.max(120, Math.min(640, pillW || fallback.w)));
    const p = { w, h: PILL_SIZE.h };
    currentPillSize = p;
    const x = Math.round(b.x + b.width - p.w);   // keep right edge fixed (grows leftward)
    mainWindow.setMaximumSize(0, 0);             // unlock first (pill→pill re-size)
    mainWindow.setMinimumSize(p.w, p.h);
    mainWindow.setContentSize(p.w, p.h);
    mainWindow.setPosition(x, b.y);
    // Lock min == max: native edge-resize can do nothing. NO setResizable toggling.
    mainWindow.setMaximumSize(p.w, p.h);
    return;
  }

  // Full views: FIXED size per view. HANDOFF-6's userSize delta is reverted — it leaked
  // one view's grip-resize into every view and the launch size. Grip-resize still works
  // within a view; switching views snaps back to the standard size (accepted quirk).
  currentPillSize = null;
  mainWindow.setMaximumSize(0, 0);               // 0,0 = no maximum
  mainWindow.setMinimumSize(280, 150);
  const size = VIEW_SIZES[view] || VIEW_SIZES.idle;
  const x = Math.round(b.x + b.width - size.w);  // keep right edge fixed here too
  mainWindow.setContentSize(size.w, size.h);
  mainWindow.setPosition(x, b.y);
}

function showWidget() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  mainWindow.focus();
}
function toggleWidget() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.isVisible() ? mainWindow.hide() : showWidget();
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------
function trayImage(state) {
  const file = { running: 'tray-green', idle: 'tray-gray', alert: 'tray-red' }[state] || 'tray-gray';
  const iconPath = path.join(__dirname, 'renderer', 'icons', `${file}.png`);
  const img = nativeImage.createFromPath(iconPath);
  if (img.isEmpty()) {
    log(`tray icon empty: ${iconPath} (exists=${fs.existsSync(iconPath)})`);
    return nativeImage.createEmpty();
  }
  return img;
}
function setTrayState(state) {
  trayState = state;
  if (tray) tray.setImage(trayImage(state));
  updateTrayTooltip();
}
function flashTray() {
  if (!tray) return;
  let n = 0;
  clearInterval(trayFlashTimer);
  trayFlashTimer = setInterval(() => {
    tray.setImage(trayImage(n % 2 === 0 ? 'alert' : trayState));
    if (++n >= 6) {
      clearInterval(trayFlashTimer);
      tray.setImage(trayImage(trayState));
    }
  }, 250);
}
function updateTrayTooltip() {
  if (!tray) return;
  const s = timer.getState();
  tray.setToolTip(s.running ? `${shortName(s.itemName)} — ${fmt(s.elapsedMs)}` : 'No timer running');
}
function buildTrayMenu() {
  const running = timer.isRunning();
  const topJobs = (jobsCache.all || []).slice(0, 5).map((j) => ({
    label: shortName(j.name),
    click: () => startOrSwitch(j)
  }));
  return Menu.buildFromTemplate([
    { label: 'Show widget', click: showWidget },
    { label: 'Stop timer', enabled: running, click: () => stopAndLog() },
    { type: 'separator' },
    { label: 'Jobs', submenu: topJobs.length ? topJobs : [{ label: '(none)', enabled: false }] },
    { type: 'separator' },
    { label: 'Settings', click: openSettingsWindow },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
}
function refreshTrayMenu() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}
function createTray() {
  tray = new Tray(trayImage('idle'));
  tray.setToolTip('No timer running');
  tray.on('click', toggleWidget);
  refreshTrayMenu();
}

// ---------------------------------------------------------------------------
// Job loading
// ---------------------------------------------------------------------------
async function loadJobs(scope = 'all') {
  try {
    if (!currentUser) currentUser = await api.getMe();
    // Fetch all groups from the board so the renderer can show group pills.
    const groups = await api.getGroups();
    const groupIds = groups.map((g) => g.id);
    const all = await api.getItems(groupIds, currentUser.id);

    // Sort by due date (earliest first), items with no date go to the end.
    const sorted = [...all].sort((a, b) => {
      const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      if (da !== db) return da - db;
      return a.name.localeCompare(b.name);
    });

    const byId = {};
    for (const j of all) byId[j.id] = j;

    // Build recents from the persisted recent-item history.
    const recentIds = settings.get('recentItemIds') || [];
    const recents = recentIds.slice(0, 5).map((id) => byId[id]).filter(Boolean);

    // Merge per-job local timer data into each job for the renderer.
    for (const j of sorted) {
      const jt = settings.getJobTimer(j.id);
      j.localDeltaMs = jt.deltaMs;
      j.localTotalMs = jt.totalMs;
      j.localExportCount = jt.exportCount;
    }

    jobsCache = { all: sorted, recents, byId, groups };
    return jobsCache;
  } catch (err) {
    log('loadJobs error: ' + err.message);
    return { all: [], byId: {}, groups: [], error: "Couldn't reach Monday. Retry in 30 seconds." };
  }
}

function pushJobs() {
  loadJobs('all').then((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('jobs', data);
    refreshTrayMenu();
  });
}

// ---------------------------------------------------------------------------
// Timer coordination
// ---------------------------------------------------------------------------
function persistRunning() {
  settings.set('runningSession', timer.serialize());
}

// A completed session's minutes could not be added to Monday (offline, API error).
// Keep it and retry every 2 minutes until it lands. The user is told both times.
function queueTimeWrite(itemId, itemName, addMs) {
  const q = settings.get('pendingTimeWrites') || [];
  q.push({ itemId, itemName, addMs, at: Date.now() });
  settings.set('pendingTimeWrites', q);
  sendToast({ text: `Couldn't reach Monday — ${Math.round(addMs / 60000)}m kept locally, retrying`, durationMs: 7000 });
  pushSyncStatus();
}

async function processTimeWrites() {
  if (demoMode) return;
  const q = settings.get('pendingTimeWrites') || [];
  if (!q.length) return;
  const remaining = [];
  let flushedMs = 0;
  for (const w of q) {
    try {
      const r = await api.addTimeSpent(w.itemId, w.addMs);
      if (r && r.ok === false) { remaining.push(w); continue; } // column still unknown
      flushedMs += w.addMs;
    } catch {
      remaining.push(w);
    }
  }
  settings.set('pendingTimeWrites', remaining);
  pushSyncStatus();
  if (flushedMs > 0) {
    sendToast({ text: `Caught up: ${Math.round(flushedMs / 60000)}m added to Monday`, durationMs: 5000 });
  }
}

function startOrSwitch(job) {
  const jobInput = { itemId: job.id || job.itemId, itemName: job.name || job.itemName };
  if (timer.isRunning()) {
    switchAndLog(jobInput);
  } else {
    startJob(jobInput);
  }
  showWidget();
}

function jobTimerBases(itemId) {
  const jt = settings.getJobTimer(itemId);
  const today = new Date().toDateString();
  return {
    todayMsBase: jt.todayDate === today ? jt.todayMs : 0,
    totalMsBase: jt.deltaMs
  };
}

function accumulateSession(session) {
  if (!session || !session.durationMs) return;
  const jt = settings.getJobTimer(session.itemId);
  jt.totalMs += session.durationMs;
  jt.deltaMs += session.durationMs;
  jt.sessionCount = (jt.sessionCount || 0) + 1;
  const today = new Date().toDateString();
  if (jt.todayDate === today) {
    jt.todayMs += session.durationMs;
  } else {
    jt.todayDate = today;
    jt.todayMs = session.durationMs;
  }
  settings.setJobTimer(session.itemId, jt);
  // Add THIS session to Monday's Time Spent (reads current value + adds; never
  // overwrites). Local totals above are the source of truth. Failures are queued
  // and retried — and the user is TOLD, never silent.
  if (!demoMode) {
    api.addTimeSpent(session.itemId, session.durationMs).then((r) => {
      if (r && r.ok === false) {
        log('addTimeSpent skipped: ' + (r.reason || 'no-column'));
        sendToast({
          text: 'No "Time Spent" column is set — minutes were NOT written to Monday. Open Settings.',
          durationMs: 9000
        });
      }
    }).catch((err) => {
      log('addTimeSpent failed (queued): ' + err.message);
      queueTimeWrite(session.itemId, session.itemName, session.durationMs);
    });
  }
}

function startJob(jobInput) {
  const bases = jobTimerBases(jobInput.itemId);
  timer.start({ itemId: jobInput.itemId, itemName: jobInput.itemName, todayMsBase: bases.todayMsBase, totalMsBase: bases.totalMsBase });
  settings.pushRecent(jobInput.itemId);
  persistRunning();
  setTrayState('running');
  pushState();
  refreshTrayMenu();
  return appState();
}

function stopAndLog(endedAt) {
  const session = timer.stop(endedAt);
  settings.set('runningSession', null);
  if (session) {
    settings.pushRecent(session.itemId);
    accumulateSession(session);
  }
  setTrayState('idle');
  pushState();
  refreshTrayMenu();
  return appState();
}

function switchAndLog(jobInput) {
  const bases = jobTimerBases(jobInput.itemId);
  const { completed } = timer.switchTo({
    itemId: jobInput.itemId,
    itemName: jobInput.itemName,
    todayMsBase: bases.todayMsBase,
    totalMsBase: bases.totalMsBase
  });
  if (completed) {
    settings.pushRecent(completed.itemId);
    accumulateSession(completed);
  }
  settings.pushRecent(jobInput.itemId);
  persistRunning();
  setTrayState('running');
  pushState();
  refreshTrayMenu();

  sendToast({ text: `Switched to ${shortName(jobInput.itemName)}`, undo: true, durationMs: 10000 });
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    timer.clearUndo();
    pushState();
  }, 10000);
  return appState();
}

function undoSwitch() {
  const prev = timer.previousJob;
  if (!prev) return appState();
  clearTimeout(undoTimer);
  timer.discard(); // discard the new (unwritten) local session
  const bases = jobTimerBases(prev.itemId);
  timer.start({ itemId: prev.itemId, itemName: prev.itemName, todayMsBase: bases.todayMsBase, totalMsBase: bases.totalMsBase });
  timer.previousJob = null;
  persistRunning();
  setTrayState('running');
  pushState();
  refreshTrayMenu();
  sendToast({ text: `Back on ${shortName(prev.itemName)}`, undo: false, durationMs: 4000 });
  return appState();
}

function resumeJob(job) {
  if (timer.isRunning()) {
    // Defensive: something is already running — switch (which logs it) instead of
    // overwriting the session.
    if (timer.itemId !== job.itemId) switchAndLog({ itemId: job.itemId, itemName: job.itemName });
    return;
  }
  const bases = jobTimerBases(job.itemId);
  timer.start({ itemId: job.itemId, itemName: job.itemName, todayMsBase: bases.todayMsBase, totalMsBase: bases.totalMsBase });
  settings.pushRecent(job.itemId);
  persistRunning();
  setTrayState('running');
  pushState();
  refreshTrayMenu();
}

// ---------------------------------------------------------------------------
// Morning check-in
// ---------------------------------------------------------------------------
function showMorningModal(saved) {
  pendingMorning = saved;
  setTrayState('alert');
  showWidget();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('morning', saved);
}

function endOfBusinessFor(startedAt) {
  const d = new Date(startedAt);
  const [h, m] = (settings.get('safety').eodNudge.time || '17:00').split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return Math.max(startedAt + 60000, d.getTime());
}

function handleMorningChoice(choice) {
  const saved = pendingMorning;
  pendingMorning = null;
  settings.set('runningSession', null);
  if (saved) {
    if (choice === 'stop-yesterday') {
      const end = endOfBusinessFor(saved.startedAt);
      accumulateSession({ itemId: saved.itemId, itemName: saved.itemName, startedAt: saved.startedAt, endedAt: end, durationMs: end - saved.startedAt });
    } else if (choice === 'overnight') {
      const end = Date.now();
      accumulateSession({ itemId: saved.itemId, itemName: saved.itemName, startedAt: saved.startedAt, endedAt: end, durationMs: end - saved.startedAt });
    }
    // 'discard' → write nothing
  }
  setTrayState('idle');
  pushState();
  return appState();
}

function handleStartupSession() {
  const saved = settings.get('runningSession');
  if (!saved) return;
  const shown = safetyNets.morningCheckIn(saved);
  if (shown) return;
  // Same-day: continue the session, but subtract the time the app wasn't running
  // (PC off / crashed / asleep with the app dead). lastSeenAt is written every tick.
  const gap = Date.now() - (saved.lastSeenAt || Date.now());
  if (gap > 2 * 60 * 1000) {
    saved.subtractedMs = (saved.subtractedMs || 0) + gap;
    const mins = Math.round(gap / 60000);
    notify({
      title: 'Timer adjusted',
      body: `Removed ${mins} min while the app wasn't running (${shortName(saved.itemName)}).`
    });
    log(`startup gap subtracted: ${gap}ms on ${saved.itemId}`);
  }
  timer.resume(saved);
  setTrayState('running');
  pushState();
}

// ---------------------------------------------------------------------------
// Hotkeys
// ---------------------------------------------------------------------------
const RESERVED = ['CommandOrControl+Alt+Delete', 'Alt+Tab', 'CommandOrControl+Escape'];
function isReserved(accel) {
  return RESERVED.includes(accel);
}
function registerHotkeys() {
  globalShortcut.unregisterAll();
  const stop = settings.get('hotkeyStop');
  if (stop && !isReserved(stop)) {
    try {
      globalShortcut.register(stop, () => { if (timer.isRunning()) stopAndLog(); });
    } catch (e) { log('hotkey register failed: ' + e.message); }
  }
  const toggle = settings.get('hotkeyToggle');
  if (toggle && !isReserved(toggle)) {
    try { globalShortcut.register(toggle, toggleWidget); } catch (e) { log('toggle hotkey failed: ' + e.message); }
  }
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
function notify({ title, body }) {
  try {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  } catch (e) { log('notify failed: ' + e.message); }
}

// ---------------------------------------------------------------------------
// Settings window
// ---------------------------------------------------------------------------
function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 480,
    height: 600,
    resizable: true,
    frame: true,
    title: 'CM Timer — Settings',
    backgroundColor: themeBg(effectiveTheme()),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  settingsWindow.removeMenu();
  settingsWindow.loadFile(path.join(__dirname, 'settings-window', 'settings.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

function applyLoginItem() {
  const enabled = !!settings.get('launchOnStartup');
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: enabled });
  } catch (e) { log('login item failed: ' + e.message); }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function shortName(name) {
  if (!name) return 'this job';
  return name.length > 44 ? name.slice(0, 41) + '…' : name;
}
function fmt(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

// Detect the board's columns. Title matching is forgiving (case, spaces, punctuation),
// a manual override from Settings always wins, and FAILURE IS VISIBLE (toast), not
// just a log line — this is the coworker's "Time Spent never populates" fix.
function detectColumns() {
  api.getColumns().then((cols) => {
    const norm = (t) => (t || '').toLowerCase().replace(/[^a-z]/g, '');

    const ttCol = cols.find((c) => c.type === 'time_tracking');
    if (ttCol) {
      settings.set('timeTrackingColumnId', ttCol.id);
      api.setCredentials({ timeTrackingColumnId: ttCol.id });
      log(`time-tracking column: ${ttCol.id} ("${ttCol.title}")`);
    }

    const isNumbers = (c) => c.type === 'numbers' || c.type === 'numeric';
    const manual = settings.get('timeSpentColumnManual');
    let tsCol = manual ? cols.find((c) => c.id === manual) || null : null;
    if (!tsCol) tsCol = cols.find((c) => isNumbers(c) && norm(c.title) === 'timespent');
    if (!tsCol) tsCol = cols.find((c) => isNumbers(c) && norm(c.title).includes('timespent'));

    if (tsCol) {
      settings.set('timeSpentColumnId', tsCol.id);
      settings.set('detectedTimeSpent', tsCol.title);
      api.setCredentials({ timeSpentColumnId: tsCol.id });
      log(`Time Spent numbers column: ${tsCol.id} ("${tsCol.title}")${manual ? ' [manual]' : ''}`);
    } else {
      settings.set('timeSpentColumnId', null);
      settings.set('detectedTimeSpent', '');
      api.setCredentials({ timeSpentColumnId: null });
      log('Time Spent numbers column NOT found');
      setTimeout(() => sendToast({
        text: 'No "Time Spent" numbers column found on your board — minutes will NOT be written. Open Settings to pick one.',
        durationMs: 10000
      }), 3000);
    }

    const tstCol = cols.find((c) => c.type === 'text' && norm(c.title).includes('timespent'));
    settings.set('timeSpentTextColumnId', tstCol ? tstCol.id : null);
    api.setCredentials({ timeSpentTextColumnId: tstCol ? tstCol.id : null });
    if (tstCol) log(`Time Spent text column: ${tstCol.id} ("${tstCol.title}")`);
  }).catch((err) => log('column detection failed: ' + err.message));
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------
function registerIpc() {
  ipcMain.handle('get-state', () => appState());
  ipcMain.handle('get-config', () => ({ demoMode, bannerVisible, firstRun: !settings.get('setupComplete') }));
  ipcMain.handle('get-jobs', async (_e, scope) => loadJobs(scope));

  ipcMain.handle('start-job', (_e, job) => {
    const j = { itemId: job.itemId || job.id, itemName: job.itemName || job.name };
    if (timer.isRunning()) {
      if (timer.itemId === j.itemId) return appState(); // already on it — no-op
      return switchAndLog(j); // never silently discard a running session
    }
    return startJob(j);
  });
  ipcMain.handle('stop', () => stopAndLog());
  ipcMain.handle('switch-job', (_e, job) => switchAndLog({ itemId: job.itemId || job.id, itemName: job.itemName || job.name }));
  ipcMain.handle('undo-switch', () => undoSwitch());
  ipcMain.handle('morning-choice', (_e, choice) => handleMorningChoice(choice));

  ipcMain.handle('adjust-last-session', (_e, { itemId, ms }) => {
    const jt = settings.getJobTimer(itemId);
    const subtract = Math.min(ms, Math.max(0, jt.deltaMs));
    jt.deltaMs -= subtract;
    jt.totalMs = Math.max(0, jt.totalMs - subtract);
    jt.todayMs = Math.max(0, jt.todayMs - subtract);
    settings.setJobTimer(itemId, jt);
    log(`adjust-last-session item=${itemId} subtracted=${subtract}ms`);
    return { adjustedMs: subtract };
  });

  ipcMain.handle('subtract-time', (_e, { ms }) => {
    const s = timer.subtractTime(ms);
    persistRunning();
    pushState();
    return s;
  });

  // Manually set the running clock (edit-the-clock). INCREASE-ONLY: a value at or below
  // the current elapsed is ignored, so tracked time can never be erased. The bumped time
  // rides to Monday additively on the next Stop (no separate write here).
  ipcMain.handle('set-elapsed', (_e, { ms }) => {
    if (!timer.isRunning()) return { changed: false };
    const target = Math.max(0, Math.round(ms || 0));
    const current = timer.getElapsed();
    if (target <= current) return { changed: false, elapsedMs: current };
    timer.setElapsed(target);
    persistRunning();
    pushState();
    log(`set-elapsed item=${timer.itemId} ${current}ms -> ${target}ms`);
    return { changed: true, elapsedMs: target };
  });

  ipcMain.handle('get-export-info', (_e, itemId) => {
    const jt = settings.getJobTimer(itemId);
    let runningMs = 0;
    if (timer.isRunning() && timer.itemId === itemId) runningMs = timer.getElapsed();
    // If timer is running on this job, count the current session too
    const sessions = (jt.sessionCount || 0) + (timer.isRunning() && timer.itemId === itemId ? 1 : 0);
    return {
      deltaMs: jt.deltaMs + runningMs,
      totalMs: jt.totalMs + runningMs,
      exportCount: jt.exportCount,
      sessionCount: sessions
    };
  });

  // "Comment to Monday" — posts a note only. Does NOT write the Time Spent number
  // (that happens additively on Stop) and does NOT reset the timer or local totals.
  ipcMain.handle('log-time', async (_e, { itemId, note, mentionId }) => {
    const trimmed = (note || '').trim();
    const mentions = mentionId ? [mentionId] : [];
    if (!trimmed && !mentions.length) return { ok: true }; // nothing to post
    try {
      const r = await api.logExport(itemId, 0, 0, 0, trimmed, mentions);
      log(`comment item=${itemId}${mentions.length ? ' mention=' + mentions.join(',') : ''}${r && r.mentionSkipped ? ' (mention skipped)' : ''}`);
      return { ok: true, mentionSkipped: !!(r && r.mentionSkipped) };
    } catch (err) {
      log(`comment failed: ${err.message}`);
      return { ok: false, error: err.message || 'Comment failed.' };
    }
  });

  ipcMain.on('view-changed', (_e, view, pillW) => resizeForView(view, pillW));
  ipcMain.on('collapse', () => resizeForView('pill'));
  ipcMain.on('expand', () => resizeForView(lastFullView));
  ipcMain.on('quit-app', () => { app.isQuitting = true; app.quit(); });
  // The widget's own X button: hide to tray when close-to-tray is on, else quit.
  ipcMain.on('close-request', () => {
    if (settings.get('closeToTray') !== false) {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
      if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.hide();
    } else {
      app.isQuitting = true;
      app.quit();
    }
  });
  // Pill move: capture origin on start, apply absolute delta each move. No feedback loop.
  let moveDrag = null;
  ipcMain.on('move-start', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const b = mainWindow.getBounds();
    moveDrag = { x: b.x, y: b.y };
  });
  ipcMain.on('move-to', (_e, { dx, dy }) => {
    if (!mainWindow || mainWindow.isDestroyed() || !moveDrag) return;
    if (typeof dx !== 'number' || typeof dy !== 'number' || !isFinite(dx) || !isFinite(dy)) return;
    mainWindow.setPosition(Math.round(moveDrag.x + dx), Math.round(moveDrag.y + dy));
  });
  ipcMain.on('move-end', () => { moveDrag = null; });
  // Resize grip: absolute-delta approach with atomic setBounds to avoid the
  // feedback loop from incremental setContentSize + setPosition.
  let resizeDrag = null;
  ipcMain.on('resize-start', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    resizeDrag = mainWindow.getBounds();
  });
  ipcMain.on('resize-to', (_e, { dw, dh }) => {
    if (!mainWindow || mainWindow.isDestroyed() || !resizeDrag) return;
    const nw = Math.max(280, Math.min(900, resizeDrag.width + dw));
    const nh = Math.max(150, Math.min(1000, resizeDrag.height + dh));
    mainWindow.setBounds({ x: resizeDrag.x, y: resizeDrag.y, width: nw, height: nh });
  });
  ipcMain.on('resize-end', () => { resizeDrag = null; });
  ipcMain.on('open-settings', openSettingsWindow);
  ipcMain.on('dismiss-banner', () => { bannerVisible = false; pushState(); });
  ipcMain.on('refresh-jobs', () => pushJobs());
  ipcMain.on('choose-demo', () => { settings.set('setupComplete', true); pushState(); });
  ipcMain.on('alert-action', (_e, { kind, actionId, data }) => {
    safetyNets.handleAlertAction(kind, actionId, data);
    pushState();
  });

  // Settings window IPC
  ipcMain.handle('settings:get', () => {
    const all = settings.getAll();
    return {
      apiToken: settings.getToken() || '',
      boardId: all.boardId,
      selectedGroupIds: all.selectedGroupIds,
      forceDemoMode: all.forceDemoMode,
      hotkeyStop: all.hotkeyStop,
      hotkeyToggle: all.hotkeyToggle,
      safety: all.safety,
      launchOnStartup: all.launchOnStartup,
      closeToTray: all.closeToTray !== false,
      theme: all.theme || 'dark',
      demoMode
    };
  });
  ipcMain.handle('settings:test', (_e, payload) => api.testConnection(payload));
  ipcMain.handle('settings:get-groups', async (_e, payload) => {
    if (payload && payload.token) {
      const res = await api.testConnection(payload);
      return res.ok ? res.groups : [];
    }
    try { return await api.getGroups(); } catch { return []; }
  });
  ipcMain.handle('settings:get-columns', async () => {
    const manual = settings.get('timeSpentColumnManual') || '';
    const detected = settings.get('detectedTimeSpent') || '';
    if (demoMode) return { ok: false, columns: [], detected, manual };
    try {
      const cols = await api.getColumns();
      return {
        ok: true,
        columns: cols.filter((c) => c.type === 'numbers' || c.type === 'numeric'),
        detected,
        manual
      };
    } catch (err) {
      return { ok: false, columns: [], error: err.message, detected, manual };
    }
  });
  ipcMain.handle('settings:save', (_e, payload) => {
    const wasDemo = demoMode;
    if (payload.apiToken !== undefined) settings.setToken(payload.apiToken);
    if (payload.boardId !== undefined) settings.set('boardId', payload.boardId);
    if (payload.selectedGroupIds !== undefined) settings.set('selectedGroupIds', payload.selectedGroupIds);
    if (payload.forceDemoMode !== undefined) settings.set('forceDemoMode', payload.forceDemoMode);
    if (payload.hotkeyStop !== undefined) settings.set('hotkeyStop', payload.hotkeyStop);
    if (payload.hotkeyToggle !== undefined) settings.set('hotkeyToggle', payload.hotkeyToggle);
    if (payload.safety !== undefined) settings.set('safety', payload.safety);
    if (payload.launchOnStartup !== undefined) settings.set('launchOnStartup', payload.launchOnStartup);
    if (payload.closeToTray !== undefined) settings.set('closeToTray', payload.closeToTray);
    if (payload.theme !== undefined) settings.set('theme', payload.theme);
    if (payload.timeSpentColumnManual !== undefined) settings.set('timeSpentColumnManual', payload.timeSpentColumnManual);
    settings.set('setupComplete', true);

    refreshMode();
    if (!demoMode) detectColumns();
    applyThemeToWindows();
    // Switching into demo clears any real running session to avoid confusion.
    if (!wasDemo && demoMode && timer.isRunning()) {
      timer.discard();
      settings.set('runningSession', null);
    }
    currentUser = null; // re-fetch under new creds
    registerHotkeys();
    applyLoginItem();
    setTrayState(timer.isRunning() ? 'running' : 'idle');
    pushState();
    pushJobs();
    return { ok: true, demoMode };
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showWidget);

  app.whenReady().then(() => {
    refreshMode();
    settings.set('userSize', { dw: 0, dh: 0 }); // wipe HANDOFF-6's leaked resize delta

    createMainWindow();
    createTray();
    registerIpc();
    registerHotkeys();
    applyLoginItem();

    // Wire safety nets with an injected context.
    safetyNets.init({
      timer,
      getSettings: () => settings.get('safety'),
      getEodDismissedDate: () => settings.get('eodDismissedDate'),
      setEodDismissedDate: (d) => settings.set('eodDismissedDate', d),
      stopAndLog,
      resumeJob,
      openPicker: () => { showWidget(); if (mainWindow) mainWindow.webContents.send('set-view', 'picker'); },
      notify,
      alert: sendAlert,
      setTrayState,
      flashTray,
      showMorningModal,
      log
    });

    // Wire timer engine to tray + persistence.
    timer.on('change', () => { updateTrayTooltip(); persistRunning(); });
    timer.on('tick', () => { updateTrayTooltip(); persistRunning(); });

    // Follow the OS light/dark setting when theme is 'auto'.
    nativeTheme.on('updated', () => {
      if ((settings.get('theme') || 'dark') === 'auto') applyThemeToWindows();
    });

    if (!demoMode) detectColumns();

    // Clear any retry-queue entries that were created before the column ID was known.
    const q = settings.get('retryQueue') || [];
    if (q.length) {
      log(`clearing ${q.length} stuck retry-queue entry(s) from before column detection`);
      settings.set('retryQueue', []);
      pushSyncStatus();
    }

    handleStartupSession();
    safetyNets.start();

    // Preload jobs cache (for tray submenu + today-base lookups).
    pushJobs();

    // Periodic: retry queue + jobs/today refresh.
    setInterval(processTimeWrites, 2 * 60 * 1000);
    setTimeout(processTimeWrites, 30 * 1000); // early catch-up pass after launch
    setInterval(() => { if (mainWindow && mainWindow.isVisible()) pushJobs(); }, 5 * 60 * 1000);


    log(`started (demoMode=${demoMode})`);

    if (process.env.SMOKE_TEST) runSmokeTest();
    if (process.env.CAPTURE) runCapture();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
    persistRunning();
    globalShortcut.unregisterAll();
  });
}

// Visual capture (CAPTURE=1): renders real states to /tmp PNGs and logs the
// content/window size after each resizeForView, to diagnose the size/view mismatch.
function runCapture() {
  mainWindow.webContents.once('did-finish-load', async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const grab = async (name) => {
      await wait(600);
      const img = await mainWindow.webContents.capturePage();
      fs.writeFileSync(`/tmp/${name}`, img.toPNG());
      console.log(`CAP ${name} content=${JSON.stringify(mainWindow.getContentSize())} win=${JSON.stringify(mainWindow.getSize())}`);
    };
    showWidget();
    settings.set('setupComplete', true); // skip welcome overlay for capture
    bannerVisible = false;
    pushState();
    await grab('cap-1-idle.png');

    console.log('CAP resize probe — initial content=' + JSON.stringify(mainWindow.getContentSize()));
    resizeForView('picker'); await wait(150);
    console.log('CAP after setSize(picker 340x320) content=' + JSON.stringify(mainWindow.getContentSize()));
    resizeForView('pill'); await wait(150);
    console.log('CAP after setSize(pill 120x40) content=' + JSON.stringify(mainWindow.getContentSize()));
    resizeForView('idle'); await wait(150);
    console.log('CAP after setSize(idle 340x220) content=' + JSON.stringify(mainWindow.getContentSize()));

    startJob({ itemId: '1', itemName: 'Command HPP - Medicare Provider Termination - 111122' });
    await grab('cap-2-running.png');

    // Simulate the user opening the picker (grow) then minimizing to the pill (shrink).
    mainWindow.webContents.send('set-view', 'picker'); // openPicker in renderer
    await grab('cap-3-picker.png');
    await mainWindow.webContents.executeJavaScript("document.getElementById('min-btn').click()");
    await grab('cap-4-pill.png');
    console.log('CAP pill content=' + JSON.stringify(mainWindow.getContentSize()));

    // Test: click the pill (pointerdown+up, no move) → must expand back to a full view.
    const expanded = await mainWindow.webContents.executeJavaScript(`(() => {
      const p = document.getElementById('view-pill');
      p.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, screenX: 50, screenY: 20, bubbles: true }));
      p.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, screenX: 50, screenY: 20, bubbles: true }));
      return !document.getElementById('view-running').classList.contains('hidden');
    })()`);
    await wait(150);
    console.log(`CAP pill-click-expands=${expanded} content=${JSON.stringify(mainWindow.getContentSize())}`);

    // Test: grip resize via the bridge → window grows.
    const before = mainWindow.getContentSize();
    await mainWindow.webContents.executeJavaScript('window.timerAPI.resizeStart(); window.timerAPI.resizeTo(60, 40); window.timerAPI.resizeEnd();');
    await wait(150);
    const after = mainWindow.getContentSize();
    console.log(`CAP resize before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
    await grab('cap-5-resized.png');

    // Hit-test: clicking the visual center of each topbar icon must resolve to the
    // button itself (proves pointer-events:none on the SVG + no-drag are working).
    const hit = await mainWindow.webContents.executeJavaScript(`(() => {
      const out = {};
      for (const id of ['settings-btn','min-btn','close-btn','stop-btn','switch-btn']) {
        const el = document.getElementById(id);
        const r = el.getBoundingClientRect();
        const at = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
        out[id] = at && at.closest('button') ? at.closest('button').id : (at ? at.tagName : 'none');
      }
      return out;
    })()`);
    console.log('CAP topbar hit-test=' + JSON.stringify(hit));

    app.isQuitting = true;
    setTimeout(() => app.quit(), 200);
  });
}

// Deterministic main-process smoke test (SMOKE_TEST=1). Exercises the REAL code paths:
// preload bridge + ipc round-trip, demo API, timer coordination, safeStorage token.
function runSmokeTest() {
  mainWindow.webContents.once('did-finish-load', async () => {
    const checks = [];
    const add = (name, ok) => checks.push([name, !!ok]);
    try {
      add('appState demoMode', appState().demoMode === true);
      const jobs = await loadJobs('mine');
      add('loadJobs returns all 12', jobs.all.length === 12);

      // Round-trip through the preload bridge + ipcMain handlers from the renderer.
      const rtState = await mainWindow.webContents.executeJavaScript('window.timerAPI.getState()');
      add('renderer getState round-trip', rtState && rtState.demoMode === true);
      const rtJobs = await mainWindow.webContents.executeJavaScript("window.timerAPI.getJobs('mine')");
      add('renderer getJobs round-trip', rtJobs.all.length === 12);

      // Real start → switch → stop coordination.
      startJob({ itemId: '1', itemName: 'Smoke - 111122' });
      add('startJob running', timer.isRunning());
      switchAndLog({ itemId: '2', itemName: 'Smoke - 112300' });
      add('switch keeps running new job', timer.isRunning() && timer.itemId === '2');
      add('switch sets undo', !!timer.previousJob);
      stopAndLog();
      add('stopAndLog idle', !timer.isRunning());

      // safeStorage-encrypted token round-trip.
      settings.setToken('tok-abc-123');
      const tok = settings.getToken();
      settings.setToken(null);
      add('token encrypt/decrypt', tok === 'tok-abc-123');

      // Tray image loads (not empty).
      add('tray image non-empty', !trayImage('running').isEmpty());

      const pass = checks.every((c) => c[1]);
      checks.forEach((c) => console.log(`SMOKE ${c[1] ? 'PASS' : 'FAIL'}: ${c[0]}`));
      console.log(pass ? 'SMOKE_ALL_PASS' : 'SMOKE_HAS_FAILURES');
    } catch (e) {
      console.log('SMOKE_ERROR ' + e.message);
    } finally {
      app.isQuitting = true;
      setTimeout(() => app.quit(), 200);
    }
  });
}

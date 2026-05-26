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

const SIZES = {
  idle: { w: 340, h: 220 },
  running: { w: 340, h: 260 },
  picker: { w: 340, h: 320 },
  pill: { w: 120, h: 40 }
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
      timeTrackingColumnId: settings.get('timeTrackingColumnId') || null
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
  return theme === 'light' ? '#FFFFFF' : '#1F2A40';
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
  const count = (settings.get('retryQueue') || []).length;
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
  const fallback = { x: wa.x + wa.width - SIZES.idle.w - 20, y: wa.y + 20 };
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

// Size for a view = its base size, plus the user's grip-resize delta for full views.
function userDelta() {
  const d = settings.get('userSize') || { dw: 0, dh: 0 };
  return { dw: d.dw || 0, dh: d.dh || 0 };
}
function sizeForView(view) {
  const base = SIZES[view] || SIZES.idle;
  if (view === 'pill') return { w: base.w, h: base.h };
  const d = userDelta();
  return {
    w: Math.max(280, Math.min(900, base.w + d.dw)),
    h: Math.max(150, Math.min(1000, base.h + d.dh))
  };
}

function createMainWindow() {
  const pos = restorePosition();
  const start = sizeForView('idle');
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
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.on('move', savePosition);
  // Surface renderer warnings/errors to the log file for diagnosis.
  mainWindow.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) log('renderer: ' + message);
  });
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      // Close settings window when main widget is hidden.
      if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
    }
  });
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

function resizeForView(view) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  currentView = view;
  if (view !== 'pill') lastFullView = view;
  const size = sizeForView(view);
  const [x, y] = mainWindow.getPosition();
  mainWindow.setContentSize(size.w, size.h);
  const [x2, y2] = mainWindow.getPosition();
  if (x2 !== x || y2 !== y) mainWindow.setPosition(x, y);
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
  const img = nativeImage.createFromPath(path.join(__dirname, 'renderer', 'icons', `${file}.png`));
  return img.isEmpty() ? nativeImage.createEmpty() : img;
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

async function writeSession(session) {
  if (!session) return;
  try {
    await api.logSession(session.itemId, session.startedAt, session.endedAt);
    log(`logged session item=${session.itemId} dur=${session.durationMs}ms`);
  } catch (err) {
    log(`logSession failed (queued): ${err.message}`);
    const q = settings.get('retryQueue') || [];
    q.push(session);
    settings.set('retryQueue', q);
    pushSyncStatus();
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
  const today = new Date().toDateString();
  if (jt.todayDate === today) {
    jt.todayMs += session.durationMs;
  } else {
    jt.todayDate = today;
    jt.todayMs = session.durationMs;
  }
  settings.setJobTimer(session.itemId, jt);
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
  const bases = jobTimerBases(job.itemId);
  timer.start({ itemId: job.itemId, itemName: job.itemName, todayMsBase: bases.todayMsBase, totalMsBase: bases.totalMsBase });
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
  if (!shown) {
    // Same-day: silently continue the session.
    timer.resume(saved);
    setTrayState('running');
    pushState();
  }
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
// Retry queue + periodic refresh
// ---------------------------------------------------------------------------
async function processRetryQueue() {
  let q = settings.get('retryQueue') || [];
  if (!q.length || demoMode) return;
  const remaining = [];
  for (const s of q) {
    try { await api.logSession(s.itemId, s.startedAt, s.endedAt); }
    catch { remaining.push(s); }
  }
  settings.set('retryQueue', remaining);
  pushSyncStatus();
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
    title: 'Compu-Mail Timer — settings',
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

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------
function registerIpc() {
  ipcMain.handle('get-state', () => appState());
  ipcMain.handle('get-config', () => ({ demoMode, bannerVisible, firstRun: !settings.get('setupComplete') }));
  ipcMain.handle('get-jobs', async (_e, scope) => loadJobs(scope));

  ipcMain.handle('start-job', (_e, job) => startJob({ itemId: job.itemId || job.id, itemName: job.itemName || job.name }));
  ipcMain.handle('stop', () => stopAndLog());
  ipcMain.handle('switch-job', (_e, job) => switchAndLog({ itemId: job.itemId || job.id, itemName: job.itemName || job.name }));
  ipcMain.handle('undo-switch', () => undoSwitch());
  ipcMain.handle('morning-choice', (_e, choice) => handleMorningChoice(choice));

  ipcMain.handle('subtract-time', (_e, { ms }) => {
    const s = timer.subtractTime(ms);
    persistRunning();
    pushState();
    return s;
  });

  ipcMain.handle('get-export-info', (_e, itemId) => {
    const jt = settings.getJobTimer(itemId);
    let runningMs = 0;
    if (timer.isRunning() && timer.itemId === itemId) runningMs = timer.getElapsed();
    return {
      deltaMs: jt.deltaMs + runningMs,
      totalMs: jt.totalMs + runningMs,
      exportCount: jt.exportCount
    };
  });

  ipcMain.handle('export-all', async (_e, itemId) => {
    const jt = settings.getJobTimer(itemId);
    let runningMs = 0;
    if (timer.isRunning() && timer.itemId === itemId) runningMs = timer.getElapsed();
    const totalMs = jt.totalMs + runningMs;
    if (totalMs <= 0) return { ok: false, error: 'No time to export.' };
    const exportId = jt.exportCount + 1;
    try {
      await api.logExport(itemId, totalMs, exportId);
      jt.exportCount = exportId;
      settings.setJobTimer(itemId, jt);
      log(`export-all item=${itemId} dur=${totalMs}ms export=#${exportId}`);
      return { ok: true, exportId, durationMs: totalMs };
    } catch (err) {
      log(`export-all failed: ${err.message}`);
      return { ok: false, error: err.message || 'Export failed.' };
    }
  });

  ipcMain.handle('export-and-clear', async (_e, { itemId, note }) => {
    const jt = settings.getJobTimer(itemId);
    let runningMs = 0;
    if (timer.isRunning() && timer.itemId === itemId) runningMs = timer.getElapsed();
    const deltaMs = jt.deltaMs + runningMs;
    if (deltaMs <= 0) return { ok: false, error: 'No time to export.' };
    const exportId = jt.exportCount + 1;
    try {
      await api.logExport(itemId, deltaMs, exportId, note);
      // Success — now clear local state
      jt.exportCount = exportId;
      jt.deltaMs = 0;
      jt.todayMs = 0;
      jt.todayDate = new Date().toDateString();
      settings.setJobTimer(itemId, jt);
      // If timer is running on this job, reset it to start fresh
      if (timer.isRunning() && timer.itemId === itemId) {
        timer.startedAt = Date.now();
        timer.subtractedMs = 0;
        timer.todayMsBase = 0;
        timer.totalMsBase = 0;
        persistRunning();
        pushState();
      }
      log(`export-and-clear item=${itemId} dur=${deltaMs}ms export=#${exportId}`);
      return { ok: true, exportId, durationMs: deltaMs };
    } catch (err) {
      log(`export-and-clear failed: ${err.message}`);
      return { ok: false, error: err.message || 'Export failed.' };
    }
  });

  ipcMain.on('view-changed', (_e, view) => resizeForView(view));
  ipcMain.on('collapse', () => resizeForView('pill'));
  ipcMain.on('expand', () => resizeForView(lastFullView));
  ipcMain.on('hide-widget', () => mainWindow && mainWindow.hide());
  // Custom drag/resize for frameless areas that can't use -webkit-app-region.
  ipcMain.on('move-window', (_e, { dx, dy }) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const [x, y] = mainWindow.getPosition();
    mainWindow.setPosition(Math.round(x + dx), Math.round(y + dy));
  });
  ipcMain.on('resize-by', (_e, { dw, dh }) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const [w, h] = mainWindow.getContentSize();
    const nw = Math.max(280, Math.min(900, Math.round(w + dw)));
    const nh = Math.max(150, Math.min(1000, Math.round(h + dh)));
    // Pin the top-left corner: setContentSize on a frameless window can shift the
    // window origin on Windows. Capture position before, restore after.
    const [x, y] = mainWindow.getPosition();
    mainWindow.setContentSize(nw, nh);
    const [x2, y2] = mainWindow.getPosition();
    if (x2 !== x || y2 !== y) mainWindow.setPosition(x, y);
    const base = SIZES[lastFullView] || SIZES.idle;
    settings.set('userSize', { dw: nw - base.w, dh: nh - base.h });
  });
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
    if (payload.theme !== undefined) settings.set('theme', payload.theme);
    settings.set('setupComplete', true);

    refreshMode();
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

    // Auto-detect time-tracking column ID on real-mode startup.
    if (!demoMode) {
      api.getColumns().then((cols) => {
        const ttCol = cols.find((c) => c.type === 'time_tracking');
        if (ttCol) {
          settings.set('timeTrackingColumnId', ttCol.id);
          api.setCredentials({ timeTrackingColumnId: ttCol.id });
          log(`auto-detected time-tracking column: ${ttCol.id} ("${ttCol.title}")`);
        }
      }).catch((err) => log('column detection failed: ' + err.message));

      // Clear any retry-queue entries that were created before the column ID was known.
      const q = settings.get('retryQueue') || [];
      if (q.length) {
        log(`clearing ${q.length} stuck retry-queue entry(s) from before column detection`);
        settings.set('retryQueue', []);
        pushSyncStatus();
      }
    }

    handleStartupSession();
    safetyNets.start();

    // Preload jobs cache (for tray submenu + today-base lookups).
    pushJobs();

    // Periodic: retry queue + jobs/today refresh.
    setInterval(processRetryQueue, 2 * 60 * 1000);
    setInterval(() => { if (mainWindow && mainWindow.isVisible()) pushJobs(); }, 5 * 60 * 1000);

    // Show on launch unless started hidden at OS login (or running the smoke test).
    const wasHidden = app.getLoginItemSettings().wasOpenedAsHidden;
    if (!wasHidden && !process.env.SMOKE_TEST) showWidget();

    log(`started (demoMode=${demoMode})`);

    if (process.env.SMOKE_TEST) runSmokeTest();
    if (process.env.CAPTURE) runCapture();
  });

  app.on('window-all-closed', (e) => {
    // Keep running in the tray; do not quit when the widget is hidden/closed.
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
    await mainWindow.webContents.executeJavaScript('window.timerAPI.resizeBy(60, 40)');
    await wait(150);
    const after = mainWindow.getContentSize();
    console.log(`CAP resizeBy before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
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
      add('loadJobs returns 11 mine', jobs.recent.length + jobs.all.length === 11);

      // Round-trip through the preload bridge + ipcMain handlers from the renderer.
      const rtState = await mainWindow.webContents.executeJavaScript('window.timerAPI.getState()');
      add('renderer getState round-trip', rtState && rtState.demoMode === true);
      const rtJobs = await mainWindow.webContents.executeJavaScript("window.timerAPI.getJobs('mine')");
      add('renderer getJobs round-trip', rtJobs.recent.length + rtJobs.all.length === 11);

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

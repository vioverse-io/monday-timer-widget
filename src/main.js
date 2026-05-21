// Main process: window, tray, hotkeys, safety nets, IPC, and coordination of the
// local-clock timer engine with the Monday API (real or demo).

const {
  app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain,
  Notification, nativeImage, screen
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
  running: { w: 340, h: 220 },
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
function appState() {
  const s = timer.getState();
  return {
    ...s,
    todayMsBase: timer.todayMsBase,
    demoMode,
    bannerVisible,
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
    backgroundColor: '#1F2A40',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.on('move', savePosition);
  // Persist the user's size whenever they resize a full view (skip the pill).
  mainWindow.on('resize', () => {
    if (!mainWindow || mainWindow.isDestroyed() || currentView === 'pill') return;
    const [w, h] = mainWindow.getContentSize();
    const base = SIZES[lastFullView] || SIZES.idle;
    settings.set('userSize', { dw: w - base.w, dh: h - base.h });
  });
  // Surface renderer warnings/errors to the log file for diagnosis.
  mainWindow.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) log('renderer: ' + message);
  });
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

function resizeForView(view) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  currentView = view;
  if (view !== 'pill') lastFullView = view;
  const size = sizeForView(view);
  mainWindow.setContentSize(size.w, size.h);
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
  const recent = jobsCache.recent.slice(0, 5).map((j) => ({
    label: shortName(j.name),
    click: () => startOrSwitch(j)
  }));
  return Menu.buildFromTemplate([
    { label: 'Show widget', click: showWidget },
    { label: 'Stop timer', enabled: running, click: () => stopAndLog() },
    { type: 'separator' },
    { label: 'Recent jobs', submenu: recent.length ? recent : [{ label: '(none yet)', enabled: false }] },
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
async function loadJobs(scope = 'mine') {
  try {
    if (!currentUser) currentUser = await api.getMe();
    const groupIds = settings.get('selectedGroupIds');
    const all = await api.getItems(groupIds, currentUser.id);
    const recentIds = settings.get('recentItemIds') || [];

    let visible = all;
    if (scope === 'mine') visible = all.filter((j) => j.assignedToMe);

    const rank = (j) => {
      const idx = recentIds.indexOf(j.id);
      return idx === -1 ? Infinity : idx;
    };
    const sorted = [...visible].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      return (b.lastSessionAt || 0) - (a.lastSessionAt || 0);
    });

    const recentPool = sorted.filter((j) => rank(j) !== Infinity || (j.lastSessionAt || 0) > 0);
    const recent = recentPool.slice(0, 5);
    const recentSet = new Set(recent.map((j) => j.id));
    const rest = sorted
      .filter((j) => !recentSet.has(j.id))
      .sort((a, b) => a.name.localeCompare(b.name));

    const byId = {};
    for (const j of all) byId[j.id] = j;
    jobsCache = { recent, all: rest, byId, scope };
    return jobsCache;
  } catch (err) {
    log('loadJobs error: ' + err.message);
    return { recent: [], all: [], byId: {}, error: 'Couldn’t reach Monday. Retry in 30 seconds…' };
  }
}

function pushJobs(scope) {
  loadJobs(scope).then((data) => {
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

function startJob(jobInput) {
  const todayMsBase = jobsCache.byId[jobInput.itemId]?.todayMs || 0;
  timer.start({ itemId: jobInput.itemId, itemName: jobInput.itemName, todayMsBase });
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
    writeSession(session);
  }
  setTrayState('idle');
  pushState();
  refreshTrayMenu();
  return appState();
}

function switchAndLog(jobInput) {
  const todayMsBase = jobsCache.byId[jobInput.itemId]?.todayMs || 0;
  const { completed } = timer.switchTo({
    itemId: jobInput.itemId,
    itemName: jobInput.itemName,
    todayMsBase
  });
  if (completed) {
    settings.pushRecent(completed.itemId);
    writeSession(completed); // failure → retry queue, new timer already running
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
  timer.start({ itemId: prev.itemId, itemName: prev.itemName, todayMsBase: prev.todayMsBase });
  timer.previousJob = null;
  persistRunning();
  setTrayState('running');
  pushState();
  refreshTrayMenu();
  sendToast({ text: `Back on ${shortName(prev.itemName)}`, undo: false, durationMs: 4000 });
  return appState();
}

function resumeJob(job) {
  timer.start({ itemId: job.itemId, itemName: job.itemName, todayMsBase: job.todayMsBase || 0 });
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
      writeSession({ itemId: saved.itemId, itemName: saved.itemName, startedAt: saved.startedAt, endedAt: end, durationMs: end - saved.startedAt });
    } else if (choice === 'overnight') {
      const end = Date.now();
      writeSession({ itemId: saved.itemId, itemName: saved.itemName, startedAt: saved.startedAt, endedAt: end, durationMs: end - saved.startedAt });
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
    backgroundColor: '#1F2A40',
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
    mainWindow.setContentSize(nw, nh);
    const base = SIZES[lastFullView] || SIZES.idle;
    settings.set('userSize', { dw: nw - base.w, dh: nh - base.h });
  });
  ipcMain.on('open-settings', openSettingsWindow);
  ipcMain.on('dismiss-banner', () => { bannerVisible = false; pushState(); });
  ipcMain.on('refresh-jobs', (_e, scope) => pushJobs(scope || 'mine'));
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
    settings.set('setupComplete', true);

    refreshMode();
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
    pushJobs('mine');
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

    handleStartupSession();
    safetyNets.start();

    // Preload jobs cache (for tray submenu + today-base lookups).
    pushJobs('mine');

    // Periodic: retry queue + jobs/today refresh.
    setInterval(processRetryQueue, 2 * 60 * 1000);
    setInterval(() => { if (mainWindow && mainWindow.isVisible()) pushJobs(jobsCache.scope || 'mine'); }, 5 * 60 * 1000);

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

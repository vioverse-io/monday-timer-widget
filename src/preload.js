// Bridge between main and renderer. Exposes a single clean `window.timerAPI` object.
// contextIsolation is on and nodeIntegration is off, so the renderer can only touch
// what is whitelisted here.

const { contextBridge, ipcRenderer } = require('electron');

function on(channel, cb) {
  const listener = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('timerAPI', {
  // ---- queries (request/response) ----
  getState: () => ipcRenderer.invoke('get-state'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  getJobs: (scope) => ipcRenderer.invoke('get-jobs', scope),

  // ---- actions ----
  startJob: (job) => ipcRenderer.invoke('start-job', job),
  stop: () => ipcRenderer.invoke('stop'),
  switchJob: (job) => ipcRenderer.invoke('switch-job', job),
  undoSwitch: () => ipcRenderer.invoke('undo-switch'),
  morningChoice: (choice) => ipcRenderer.invoke('morning-choice', choice),
  subtractTime: (ms) => ipcRenderer.invoke('subtract-time', { ms }),
  setElapsed: (ms) => ipcRenderer.invoke('set-elapsed', { ms }),
  adjustLastSession: (itemId, ms) => ipcRenderer.invoke('adjust-last-session', { itemId, ms }),
  getExportInfo: (itemId) => ipcRenderer.invoke('get-export-info', itemId),
  logTime: (itemId, note, mentionIds) => ipcRenderer.invoke('log-time', { itemId, note, mentionIds }),

  // ---- fire-and-forget ----
  viewChanged: (view, pillW) => ipcRenderer.send('view-changed', view, pillW),
  collapse: () => ipcRenderer.send('collapse'),
  expand: () => ipcRenderer.send('expand'),
  moveStart: () => ipcRenderer.send('move-start'),
  moveTo: (dx, dy) => ipcRenderer.send('move-to', { dx, dy }),
  moveEnd: () => ipcRenderer.send('move-end'),
  resizeStart: () => ipcRenderer.send('resize-start'),
  resizeTo: (dw, dh) => ipcRenderer.send('resize-to', { dw, dh }),
  resizeEnd: () => ipcRenderer.send('resize-end'),
  quitApp: () => ipcRenderer.send('quit-app'),
  closeRequest: () => ipcRenderer.send('close-request'),
  openSettings: () => ipcRenderer.send('open-settings'),
  dismissBanner: () => ipcRenderer.send('dismiss-banner'),
  refreshJobs: () => ipcRenderer.send('refresh-jobs'),
  alertAction: (kind, actionId, data) => ipcRenderer.send('alert-action', { kind, actionId, data }),

  chooseDemo: () => ipcRenderer.send('choose-demo'),

  // ---- events (main -> renderer) ----
  onState: (cb) => on('state', cb),
  onJobs: (cb) => on('jobs', cb),
  onToast: (cb) => on('toast', cb),
  onAlert: (cb) => on('alert', cb),
  onMorning: (cb) => on('morning', cb),
  onSync: (cb) => on('sync-status', cb),
  onView: (cb) => on('set-view', cb)
});

// Separate surface used only by the settings window.
contextBridge.exposeInMainWorld('settingsAPI', {
  get: () => ipcRenderer.invoke('settings:get'),
  save: (payload) => ipcRenderer.invoke('settings:save', payload),
  test: (payload) => ipcRenderer.invoke('settings:test', payload),
  getGroups: (payload) => ipcRenderer.invoke('settings:get-groups', payload),
  getColumns: () => ipcRenderer.invoke('settings:get-columns')
});

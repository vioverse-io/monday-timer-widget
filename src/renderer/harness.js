// DEV/QA HARNESS — inert under Electron.
//
// Under Electron the preload script defines window.timerAPI before page scripts run,
// so this whole file no-ops. In a plain browser (used for automated UI QA) it installs
// a mock bridge that reimplements the local-clock model with the demo jobs, so the real
// renderer (index.html + styles.css + app.js) can be exercised without Electron.
//
// It also reads URL query params so each UI state can be deep-linked for screenshots:
//   ?running=1        start a timer on a job immediately
//   ?view=picker      open the job picker
//   ?welcome=1        show the first-run welcome overlay
//   ?banner=0         hide the demo banner
//   ?alert=idle|long|eod   fire a safety-net alert
//   ?morning=1        show the morning check-in modal
//   ?sync=2           show the "N sessions not yet saved" indicator
// And window.__harness.trigger(kind, arg) exposes the same for manual driving.

(function () {
  if (window.timerAPI) return; // running under Electron — do nothing

  const params = new URLSearchParams(location.search);

  const MOCK_JOBS = [
    { id: '1', name: 'Command HPP - Medicare Provider Termination - 111122', assignedToMe: true, todayMs: 5025000, lastSessionAt: Date.now() - 720000 },
    { id: '2', name: 'Command Resi - Resi Daily - NYC Lead Inspections - 112300', assignedToMe: true, todayMs: 4320000, lastSessionAt: Date.now() - 2400000 },
    { id: '3', name: 'Command VNS - Weekly Provider Term - 109437', assignedToMe: true, todayMs: 1320000, lastSessionAt: Date.now() - 5400000 },
    { id: '4', name: '114041 - New Command Anthem Project', assignedToMe: true, todayMs: 0, lastSessionAt: Date.now() - 93600000 },
    { id: '5', name: 'CarX - FTP data upload tests - 106536', assignedToMe: false, todayMs: 0, lastSessionAt: 0 },
    { id: '6', name: '114079 new VNS Command Recert letter', assignedToMe: true, todayMs: 0, lastSessionAt: Date.now() - 108000000 },
    { id: '7', name: '112905 - HCHB, AgeIn, Docusign', assignedToMe: true, todayMs: 39562000, lastSessionAt: Date.now() - 300000 },
    { id: '8', name: '113035 Selective Inserting', assignedToMe: true, todayMs: 0, lastSessionAt: 0 },
    { id: '9', name: 'AAA Reading Berks IMS Midnight Job Number 113471', assignedToMe: true, todayMs: 0, lastSessionAt: 0 },
    { id: '10', name: 'Command HPP - New Medicaid and CHIP NDN/NOA - 113426', assignedToMe: true, todayMs: 0, lastSessionAt: 0 },
    { id: '11', name: '113516 IMS Testing Northampton Schuylkill', assignedToMe: true, todayMs: 0, lastSessionAt: 0 },
    { id: '12', name: 'CRM System Hoosier AAA Club Job Number 112616', assignedToMe: true, todayMs: 0, lastSessionAt: 0 }
  ];

  const byId = {};
  MOCK_JOBS.forEach((j) => (byId[j.id] = j));

  const T = {
    running: false,
    itemId: null,
    itemName: null,
    startedAt: null,
    todayMsBase: 0,
    previousJob: null,
    bannerVisible: params.get('banner') !== '0',
    firstRun: params.get('welcome') === '1',
    recentIds: ['7', '1', '2', '3'],
    retryCount: Number(params.get('sync') || 0)
  };

  const listeners = { state: [], jobs: [], toast: [], alert: [], morning: [], sync: [], view: [] };
  const emit = (ch, p) => listeners[ch].forEach((cb) => cb(p));

  function appState() {
    const elapsed = T.running ? Date.now() - T.startedAt : 0;
    return {
      running: T.running,
      itemId: T.itemId,
      itemName: T.itemName,
      startedAt: T.startedAt,
      elapsedMs: elapsed,
      todayMs: T.todayMsBase + elapsed,
      todayMsBase: T.todayMsBase,
      hasUndo: !!T.previousJob,
      demoMode: true,
      bannerVisible: T.bannerVisible,
      firstRun: T.firstRun
    };
  }

  function startJob(job) {
    T.running = true;
    T.itemId = job.itemId;
    T.itemName = job.itemName;
    T.todayMsBase = byId[job.itemId]?.todayMs || 0;
    T.startedAt = Date.now();
    pushRecent(job.itemId);
    emit('state', appState());
    return appState();
  }
  function stop() {
    T.running = false;
    T.itemId = T.itemName = T.startedAt = null;
    T.todayMsBase = 0;
    emit('state', appState());
    return appState();
  }
  function switchJob(job) {
    T.previousJob = T.running ? { itemId: T.itemId, itemName: T.itemName } : null;
    startJob(job);
    emit('toast', { text: `Switched to ${short(job.itemName)}`, undo: true, durationMs: 10000 });
    setTimeout(() => {
      T.previousJob = null;
      emit('state', appState());
    }, 10000);
    return appState();
  }
  function undoSwitch() {
    const prev = T.previousJob;
    if (!prev) return appState();
    T.previousJob = null;
    startJob({ itemId: prev.itemId, itemName: prev.itemName });
    emit('toast', { text: `Back on ${short(prev.itemName)}`, undo: false, durationMs: 4000 });
    return appState();
  }
  function pushRecent(id) {
    T.recentIds = [id, ...T.recentIds.filter((x) => x !== id)].slice(0, 20);
  }
  function short(n) {
    return n && n.length > 40 ? n.slice(0, 37) + '…' : n || 'this job';
  }

  function loadJobs(scope) {
    let visible = MOCK_JOBS.slice();
    if (scope === 'mine') visible = visible.filter((j) => j.assignedToMe);
    const rank = (j) => {
      const i = T.recentIds.indexOf(j.id);
      return i === -1 ? Infinity : i;
    };
    const sorted = visible.sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      return (b.lastSessionAt || 0) - (a.lastSessionAt || 0);
    });
    const recentPool = sorted.filter((j) => rank(j) !== Infinity || (j.lastSessionAt || 0) > 0);
    const recent = recentPool.slice(0, 5);
    const set = new Set(recent.map((j) => j.id));
    const rest = sorted.filter((j) => !set.has(j.id)).sort((a, b) => a.name.localeCompare(b.name));
    return { recent, all: rest };
  }

  function fireAlert(kind) {
    const map = {
      idle: { message: 'Timer auto-stopped after 15 min idle.', actions: [{ id: 'resume', label: 'Resume', style: 'primary' }, { id: 'dismiss', label: 'Dismiss', style: 'ghost' }] },
      long: { message: "You've been on this job for 4 hours straight. Still working on this?", actions: [{ id: 'keep', label: 'Yes, keep going', style: 'primary' }, { id: 'stopswitch', label: 'Stop and switch', style: 'ghost' }] },
      eod: { message: 'Your timer is still running. Stop it?', actions: [{ id: 'stop', label: 'Stop', style: 'danger' }, { id: 'keep', label: 'Keep running', style: 'ghost' }] }
    };
    emit('alert', { kind, ...(map[kind] || map.idle) });
  }

  window.timerAPI = {
    getState: () => Promise.resolve(appState()),
    getConfig: () => Promise.resolve({ demoMode: true, bannerVisible: T.bannerVisible, firstRun: T.firstRun }),
    getJobs: (scope) => Promise.resolve(loadJobs(scope)),
    startJob: (j) => Promise.resolve(startJob(j)),
    stop: () => Promise.resolve(stop()),
    switchJob: (j) => Promise.resolve(switchJob(j)),
    undoSwitch: () => Promise.resolve(undoSwitch()),
    morningChoice: () => { return Promise.resolve(stop()); },
    viewChanged: () => {},
    collapse: () => {},
    expand: () => {},
    moveWindow: () => {},
    resizeBy: () => {},
    hideWidget: () => {},
    openSettings: () => alert('Settings window (Electron only)'),
    dismissBanner: () => { T.bannerVisible = false; },
    refreshJobs: () => {},
    chooseDemo: () => { T.firstRun = false; },
    alertAction: (kind, actionId) => {
      if (kind === 'idle' && actionId === 'resume') startJob({ itemId: '7', itemName: byId['7'].name });
      if (kind === 'eod' && actionId === 'stop') stop();
      if (kind === 'long' && actionId === 'stopswitch') { stop(); emit('view', 'picker'); }
    },
    onState: (cb) => listeners.state.push(cb),
    onJobs: (cb) => listeners.jobs.push(cb),
    onToast: (cb) => listeners.toast.push(cb),
    onAlert: (cb) => listeners.alert.push(cb),
    onMorning: (cb) => listeners.morning.push(cb),
    onSync: (cb) => listeners.sync.push(cb),
    onView: (cb) => listeners.view.push(cb)
  };

  window.__harness = {
    trigger(kind, arg) {
      if (kind === 'alert') fireAlert(arg || 'idle');
      else if (kind === 'morning') emit('morning', { itemId: '7', itemName: byId['7'].name, startedAt: Date.now() - 16 * 3600 * 1000 });
      else if (kind === 'sync') emit('sync', { count: Number(arg || 1) });
      else if (kind === 'view') emit('view', arg);
    }
  };

  // Apply deep-link params after the app has wired up its listeners.
  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      if (params.get('running') === '1') startJob({ itemId: '1', itemName: byId['1'].name });
      if (params.get('view') === 'picker') emit('view', 'picker');
      const a = params.get('alert');
      if (a) fireAlert(a);
      if (params.get('morning') === '1') emit('morning', { itemId: '7', itemName: byId['7'].name, startedAt: Date.now() - 16 * 3600 * 1000 });
      if (T.retryCount > 0) emit('sync', { count: T.retryCount });
    }, 80);
  });
})();

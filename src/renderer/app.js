// Renderer logic. Talks to the main process only through window.timerAPI (the preload
// bridge). The local clock is the source of truth in main; here we just render and tick
// the display from the startedAt timestamp we were given.

(function () {
  const api = window.timerAPI;
  const $ = (id) => document.getElementById(id);

  let state = { running: false };
  let view = 'idle';
  let prevFullView = 'idle';
  let pickerMode = 'start'; // 'start' | 'switch'
  let scope = 'mine'; // 'mine' | 'all'
  let jobs = { recent: [], all: [] };
  let tickInterval = null;
  let toastTimer = null;

  // ---- formatters ----
  const pad = (n) => String(n).padStart(2, '0');
  function fmtClock(ms) {
    const t = Math.floor(ms / 1000);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }
  function fmtToday(ms) {
    const t = Math.floor(ms / 1000);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
  function fmtPill(ms) {
    const t = Math.floor(ms / 1000);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    return h > 0 ? `${h}h${m}m` : `${m}m`;
  }
  function jobNum(name) {
    const matches = String(name || '').match(/\d{6}/g);
    return matches ? matches[matches.length - 1] : '';
  }
  function jobNumberLabel(name) {
    const n = jobNum(name);
    return n ? `Job ${n}` : 'No job number';
  }
  function shortName(name) {
    if (!name) return 'this job';
    return name.length > 40 ? name.slice(0, 37) + '…' : name;
  }

  // ---- view management ----
  function setView(name) {
    view = name;
    ['idle', 'running', 'picker'].forEach((v) =>
      $('view-' + v).classList.toggle('hidden', v !== name)
    );
    const isPill = name === 'pill';
    $('view-pill').classList.toggle('hidden', !isPill);
    $('topbar').classList.toggle('hidden', isPill);
    $('body').classList.toggle('hidden', isPill);
    $('app').classList.toggle('is-pill', isPill);
    $('resize-grip').classList.toggle('hidden', isPill);
    // The demo banner is hidden in the collapsed pill (it would eat the 40px height).
    $('banner').classList.toggle('hidden', isPill || !state.bannerVisible);

    const isPicker = name === 'picker';
    $('back-btn').classList.toggle('hidden', !isPicker);
    $('status-dot').classList.toggle('hidden', isPicker);
    $('topbar-label').textContent = isPicker
      ? 'PICK A JOB'
      : state.running
      ? 'TRACKING'
      : 'NO TIMER';

    if (name !== 'pill') prevFullView = name;
    api.viewChanged(name);
  }

  function setDot(running) {
    $('status-dot').className = 'dot ' + (running ? 'dot-green' : 'dot-gray');
    $('pill-dot').className = 'dot ' + (running ? 'dot-green' : 'dot-gray');
  }

  // ---- ticking ----
  function startTick() {
    stopTick();
    tickInterval = setInterval(renderTime, 1000);
    renderTime();
  }
  function stopTick() {
    if (tickInterval) clearInterval(tickInterval);
    tickInterval = null;
  }
  function renderTime() {
    if (!state.running || !state.startedAt) return;
    const elapsed = Date.now() - state.startedAt;
    $('elapsed').textContent = fmtClock(elapsed);
    $('today').textContent = 'Today: ' + fmtToday((state.todayMsBase || 0) + elapsed);
    $('pill-time').textContent = fmtPill(elapsed);
  }

  // ---- state ----
  function applyState(s) {
    state = s;
    $('banner').classList.toggle('hidden', !s.bannerVisible);
    $('welcome').classList.toggle('hidden', !s.firstRun);
    setDot(s.running);

    if (s.running) {
      $('job-name').textContent = s.itemName || '—';
      $('job-name').title = s.itemName || '';
      $('job-number').textContent = jobNumberLabel(s.itemName);
    }

    // Auto view transition only when on a base view (don't yank user out of picker/pill).
    if (view === 'idle' || view === 'running') {
      setView(s.running ? 'running' : 'idle');
    } else {
      $('topbar-label').textContent =
        view === 'picker' ? 'PICK A JOB' : s.running ? 'TRACKING' : 'NO TIMER';
    }

    if (s.running) startTick();
    else stopTick();
  }

  // ---- picker ----
  async function openPicker(mode) {
    pickerMode = mode;
    setView('picker');
    $('search').value = '';
    jobs = await api.getJobs(scope);
    renderPicker();
    setTimeout(() => $('search').focus(), 30);
  }
  function closePicker() {
    setView(state.running ? 'running' : 'idle');
  }

  function rowEl(job) {
    const row = document.createElement('div');
    row.className = 'job-row';
    const main = document.createElement('div');
    main.className = 'job-row-main';
    const name = document.createElement('div');
    name.className = 'job-row-name';
    name.textContent = job.name;
    name.title = job.name;
    const sub = document.createElement('div');
    sub.className = 'job-row-sub';
    const n = jobNum(job.name);
    sub.textContent = `${n || '—'} · ${fmtToday(job.todayMs || 0)} today`;
    main.appendChild(name);
    main.appendChild(sub);
    const play = document.createElement('span');
    play.className = 'job-row-play';
    play.innerHTML =
      '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M5 3 L12 8 L5 13 Z" fill="currentColor"/></svg>';
    row.appendChild(main);
    row.appendChild(play);
    row.addEventListener('click', () => pickJob(job));
    return row;
  }

  function renderPicker() {
    const q = $('search').value.trim().toLowerCase();
    const match = (j) =>
      !q || j.name.toLowerCase().includes(q) || jobNum(j.name).includes(q);
    const recent = (jobs.recent || []).filter(match);
    const all = (jobs.all || []).filter(match);

    const recentList = $('recent-list');
    const allList = $('all-list');
    recentList.innerHTML = '';
    allList.innerHTML = '';
    recent.forEach((j) => recentList.appendChild(rowEl(j)));
    all.forEach((j) => allList.appendChild(rowEl(j)));

    $('recent-label').classList.toggle('hidden', recent.length === 0);
    $('all-label').classList.toggle('hidden', all.length === 0);
    $('picker-empty').classList.toggle('hidden', recent.length + all.length > 0);
  }

  async function pickJob(job) {
    if (pickerMode === 'switch' && state.running) {
      const s = await api.switchJob({ itemId: job.id, itemName: job.name });
      applyAfterAction(s);
    } else {
      const s = await api.startJob({ itemId: job.id, itemName: job.name });
      applyAfterAction(s);
    }
    setView('running');
  }

  function applyAfterAction(s) {
    if (s) {
      state = s;
      setDot(s.running);
      if (s.running) {
        $('job-name').textContent = s.itemName || '—';
        $('job-number').textContent = jobNumberLabel(s.itemName);
        startTick();
      } else {
        stopTick();
      }
    }
  }

  async function setScope(next) {
    scope = next;
    $('seg-mine').classList.toggle('active', scope === 'mine');
    $('seg-all').classList.toggle('active', scope === 'all');
    jobs = await api.getJobs(scope);
    renderPicker();
  }

  // ---- toast / alert / modal / sync ----
  function showToast(t) {
    $('toast-text').textContent = t.text;
    $('toast-undo').classList.toggle('hidden', !t.undo);
    $('toast').classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.add('hidden'), t.durationMs || 6000);
  }
  function showAlert(a) {
    $('alert-msg').textContent = a.message;
    const wrap = $('alert-actions');
    wrap.innerHTML = '';
    (a.actions || []).forEach((act) => {
      const b = document.createElement('button');
      const cls =
        act.style === 'danger' ? 'btn-stop' : act.style === 'primary' ? 'btn-primary' : 'btn-ghost';
      b.className = 'btn ' + cls;
      b.textContent = act.label;
      b.addEventListener('click', () => {
        api.alertAction(a.kind, act.id, a.data);
        $('alert').classList.add('hidden');
      });
      wrap.appendChild(b);
    });
    $('alert').classList.remove('hidden');
  }
  function showMorning(saved) {
    $('morning-msg').textContent = `A timer was left running on ${shortName(
      saved.itemName
    )} since ${new Date(saved.startedAt).toLocaleString()}. What should we do?`;
    $('morning').classList.remove('hidden');
  }
  function showSync({ count }) {
    if (count > 0) {
      $('sync').textContent = `${count} session${count > 1 ? 's' : ''} not yet saved to Monday — retrying`;
      $('sync').classList.remove('hidden');
    } else {
      $('sync').classList.add('hidden');
    }
  }

  // ---- pill: click to expand, drag to move ----
  // The pill can't be a -webkit-app-region drag target (that swallows clicks), so we
  // implement move + click here with pointer capture (so it keeps tracking off-window).
  function bindPill() {
    const pill = $('view-pill');
    let drag = null;
    pill.addEventListener('pointerdown', (e) => {
      try { pill.setPointerCapture(e.pointerId); } catch (_) { /* synthetic/edge */ }
      drag = { x: e.screenX, y: e.screenY, moved: false };
    });
    pill.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.screenX - drag.x;
      const dy = e.screenY - drag.y;
      if (drag.moved || Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        drag.moved = true;
        api.moveWindow(dx, dy);
        drag.x = e.screenX;
        drag.y = e.screenY;
      }
    });
    pill.addEventListener('pointerup', () => {
      if (drag && !drag.moved) setView(state.running ? 'running' : 'idle');
      drag = null;
    });
  }

  // ---- resize grip (bottom-right) ----
  function bindResizeGrip() {
    const grip = $('resize-grip');
    let drag = null;
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { grip.setPointerCapture(e.pointerId); } catch (_) { /* synthetic/edge */ }
      drag = { x: e.screenX, y: e.screenY };
    });
    grip.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dw = e.screenX - drag.x;
      const dh = e.screenY - drag.y;
      drag.x = e.screenX;
      drag.y = e.screenY;
      api.resizeBy(dw, dh);
    });
    grip.addEventListener('pointerup', () => { drag = null; });
  }

  // ---- events binding ----
  function bind() {
    $('settings-btn').addEventListener('click', () => api.openSettings());
    $('min-btn').addEventListener('click', () => setView('pill'));
    $('close-btn').addEventListener('click', () => api.hideWidget());
    $('back-btn').addEventListener('click', closePicker);
    $('banner-x').addEventListener('click', () => {
      api.dismissBanner();
      $('banner').classList.add('hidden');
    });

    $('start-job-btn').addEventListener('click', () => openPicker('start'));
    $('switch-btn').addEventListener('click', () => openPicker('switch'));
    $('stop-btn').addEventListener('click', async () => {
      const s = await api.stop();
      applyAfterAction(s);
      setView('idle');
    });

    bindPill();
    bindResizeGrip();

    $('seg-mine').addEventListener('click', () => setScope('mine'));
    $('seg-all').addEventListener('click', () => setScope('all'));
    $('search').addEventListener('input', renderPicker);

    $('toast-undo').addEventListener('click', async () => {
      $('toast').classList.add('hidden');
      const s = await api.undoSwitch();
      applyAfterAction(s);
      setView('running');
    });

    document.querySelectorAll('#morning [data-choice]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        $('morning').classList.add('hidden');
        const s = await api.morningChoice(btn.dataset.choice);
        applyState(s);
      });
    });

    $('welcome-connect').addEventListener('click', () => api.openSettings());
    $('welcome-demo').addEventListener('click', () => {
      api.chooseDemo();
      $('welcome').classList.add('hidden');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && view === 'picker') closePicker();
    });

    api.onState(applyState);
    api.onJobs((j) => {
      jobs = j;
      if (view === 'picker') renderPicker();
    });
    api.onToast(showToast);
    api.onAlert(showAlert);
    api.onMorning(showMorning);
    api.onSync(showSync);
    api.onView((v) => {
      if (v === 'picker') openPicker(state.running ? 'switch' : 'start');
    });
  }

  async function init() {
    bind();
    const cfg = await api.getConfig();
    scope = 'mine';
    const s = await api.getState();
    applyState(s);
  }

  document.addEventListener('DOMContentLoaded', init);
})();

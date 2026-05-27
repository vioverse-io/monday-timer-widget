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
  let activeGroupId = null;     // null = first group (Priority), or a group id
  let jobs = { all: [], groups: [] };
  let tickInterval = null;
  let toastTimer = null;
  let stoppedSession = null;  // { itemId, itemName, elapsedMs } — post-stop adjustment window
  let stoppedTimer = null;
  let lastStoppedItemId = null; // highlights the last-stopped job in the picker

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
  // Best-effort job-number detection. Board names vary (6/5/3-digit, #-prefixed,
  // "Job Number ###", leading/trailing/embedded). Priority: after #/Job/Job Number,
  // then a trailing number, then the longest 3–7 digit run. To be validated in Step 0.
  function jobNum(name) {
    const s = String(name || '');
    let m = s.match(/(?:job\s*(?:number)?\s*#?\s*|#)\s*(\d{3,7})\b/i);
    if (m) return m[1];
    m = s.match(/(\d{3,7})\s*$/);
    if (m) return m[1];
    const runs = s.match(/\d{3,7}/g);
    if (runs) return runs.slice().sort((a, b) => b.length - a.length)[0];
    return '';
  }
  // Description with the job number (and trailing "job number"/# words) stripped out,
  // since the number is shown separately above the name.
  function cleanName(name) {
    if (!name) return '—';
    const n = jobNum(name);
    let s = name;
    if (n) s = s.split(n).join(' ');
    s = s
      .replace(/\s+/g, ' ')
      .replace(/[\s\-–·#]+$/, '')
      .replace(/^[\s\-–·#]+/, '')
      .replace(/\b(job\s*number|job|number|#)\b\s*$/i, '')
      .replace(/[\s\-–·#]+$/, '')
      .trim();
    return s || name;
  }

  // Renders the running view's number (big, green) + description. When a number is
  // found it's shown big/green and stripped from the description; when none is found,
  // the number line is hidden and the full name is shown as the title.
  function renderJob(name) {
    const n = jobNum(name);
    const numEl = $('job-number');
    if (n) {
      numEl.textContent = n;
      numEl.classList.remove('hidden');
      $('job-name').textContent = cleanName(name);
    } else {
      numEl.textContent = '';
      numEl.classList.add('hidden');
      $('job-name').textContent = name || '—';
    }
    $('job-name').title = name || '';
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
    // Demo footer shows in any full view while in demo mode; hidden in the pill.
    $('demo-footer').classList.toggle('hidden', isPill || !state.demoMode);

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
  function startOfLocalDay() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  function renderTime() {
    if (!state.running || !state.startedAt) return;
    const now = Date.now();
    const sub = state.subtractedMs || 0;
    const elapsed = Math.max(0, now - state.startedAt - sub);
    // Today = already-logged today (local delta) + the running session's portion
    // since midnight, minus subtracted time.
    const rawSinceMidnight = now - Math.max(state.startedAt, startOfLocalDay());
    const sinceMidnight = Math.max(0, rawSinceMidnight - sub);
    const today = (state.todayMsBase || 0) + sinceMidnight;
    // Total = unexported delta (not lifetime)
    const total = (state.totalMsBase || 0) + elapsed;
    $('elapsed').textContent = fmtClock(elapsed);
    $('today').textContent = 'Today ' + fmtToday(today);
    $('total').textContent = 'Total ' + fmtToday(total);
    $('pill-time').textContent = fmtPill(elapsed);
  }

  // ---- state ----
  function applyState(s) {
    state = s;
    if (s.theme) document.documentElement.dataset.theme = s.theme;
    $('demo-footer').classList.toggle('hidden', !s.demoMode);
    $('welcome').classList.toggle('hidden', !s.firstRun);
    setDot(s.running);

    if (s.running) {
      renderJob(s.itemName);
    }

    // Auto view transition only when on a base view (don't yank user out of picker/pill).
    // Don't switch away from running view during the post-stop adjustment window.
    if ((view === 'idle' || view === 'running') && !stoppedSession) {
      setView(s.running ? 'running' : 'idle');
    } else {
      $('topbar-label').textContent =
        view === 'picker' ? 'PICK A JOB' : s.running ? 'TRACKING'
        : stoppedSession ? 'STOPPED' : 'NO TIMER';
    }

    if (s.running) startTick();
    else { stopTick(); if (!stoppedSession) renderIdleRecents(); }
  }

  function renderIdleRecents() {
    const wrap = $('idle-recents');
    const label = $('idle-recents-label');
    if (!wrap) return;
    wrap.innerHTML = '';
    const recents = (jobs.recents || []).slice(0, 5);
    if (label) label.classList.toggle('hidden', !recents.length);
    if (!recents.length) return;
    for (const j of recents) {
      const row = document.createElement('div');
      row.className = 'idle-recent-row';
      const dot = document.createElement('span');
      dot.className = 'idle-recent-dot';
      const lbl = document.createElement('span');
      lbl.textContent = j.name;
      lbl.style.overflow = 'hidden';
      lbl.style.textOverflow = 'ellipsis';
      row.appendChild(dot);
      row.appendChild(lbl);
      row.addEventListener('click', () => pickJob(j));
      wrap.appendChild(row);
    }
  }

  // ---- picker ----
  async function openPicker(mode) {
    pickerMode = mode;
    setView('picker');
    $('search').value = '';
    // Always fetch all jobs; filtering happens client-side via pills.
    jobs = await api.getJobs('all');
    if (jobs.error) {
      $('picker-empty').textContent = jobs.error;
      $('picker-empty').classList.remove('hidden');
    }
    renderFilterPills();
    renderPicker();
    setTimeout(() => $('search').focus(), 30);
  }
  function closePicker() {
    setView(state.running ? 'running' : 'idle');
  }

  function groupColor() {
    const gid = effectiveGroupId();
    const g = (jobs.groups || []).find((gr) => gr.id === gid);
    return g ? g.color : '#0073EA';
  }

  function isLightColor(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 160;
  }

  function rowEl(job) {
    const row = document.createElement('div');
    row.className = 'job-row';
    if (state.running && job.id === state.itemId) row.classList.add('active');

    const main = document.createElement('div');
    main.className = 'job-row-main';

    const name = document.createElement('div');
    name.className = 'job-row-name';
    const n = jobNum(job.name);
    const desc = cleanName(job.name);
    if (n) {
      const num = document.createElement('span');
      num.className = 'job-row-num';
      num.textContent = n;
      name.appendChild(num);
      name.appendChild(document.createTextNode(' — ' + desc));
    } else {
      name.appendChild(document.createTextNode(desc));
    }
    name.title = job.name;

    const sub = document.createElement('div');
    sub.className = 'job-row-sub';
    const parts = [];
    if (job.dueDate) parts.push(job.dueDate);
    parts.push(fmtToday(job.todayMs || 0) + ' today');
    sub.textContent = parts.join(' · ');

    main.appendChild(name);
    main.appendChild(sub);

    const isActive = state.running && job.id === state.itemId;
    const isStopped = !isActive && job.id === lastStoppedItemId;
    const color = groupColor();

    if (isStopped) row.classList.add('stopped');

    // Only color the job number on the actively running row
    const numSpan = name.querySelector('.job-row-num');
    if (numSpan && isActive) numSpan.style.color = color;

    // "Stopped" label on the last-stopped row
    if (isStopped) {
      const badge = document.createElement('span');
      badge.className = 'job-row-stopped-badge';
      badge.textContent = 'Stopped';
      sub.prepend(badge);
    }

    const play = document.createElement('span');
    play.className = 'job-row-play-pill';
    play.style.background = isStopped ? '#B8860B' : color;
    play.style.color = isStopped ? '#333' : isLightColor(color) ? '#333' : '#fff';
    play.innerHTML = isStopped
      ? '<svg viewBox="0 0 16 16" width="11" height="11"><rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 24 24" width="12" height="12"><polygon points="6 3 20 12 6 21 6 3" fill="currentColor"/></svg>';

    // Log Time button (clock icon)
    const exp = document.createElement('button');
    exp.className = 'job-row-export';
    exp.title = 'Log time';
    exp.innerHTML =
      '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
    exp.addEventListener('click', (e) => {
      e.stopPropagation();
      doLogTime(job.id);
    });

    row.appendChild(main);
    row.appendChild(play);
    row.appendChild(exp);
    row.addEventListener('click', () => pickJob(job));
    return row;
  }

  function effectiveGroupId() {
    if (activeGroupId) return activeGroupId;
    // Default to the first group (usually Priority).
    const groups = jobs.groups || [];
    return groups.length ? groups[0].id : null;
  }

  function filterJob(j) {
    const gid = effectiveGroupId();
    if (gid && j.groupId !== gid) return false;
    return true;
  }

  function renderPicker() {
    const q = $('search').value.trim().toLowerCase();
    const match = (j) =>
      !q || j.name.toLowerCase().includes(q) || jobNum(j.name).includes(q);
    const filtered = (jobs.all || []).filter((j) => filterJob(j) && match(j));

    const list = $('all-list');
    list.innerHTML = '';
    filtered.forEach((j) => list.appendChild(rowEl(j)));

    $('recent-label').classList.add('hidden');
    $('all-label').classList.add('hidden');
    $('picker-empty').classList.toggle('hidden', filtered.length > 0);
  }

  function renderFilterPills() {
    const row = $('filter-row');
    row.innerHTML = '';
    const gid = effectiveGroupId();
    for (const g of (jobs.groups || [])) {
      const isActive = gid === g.id;
      const pill = document.createElement('button');
      pill.className = 'filter-pill' + (isActive ? ' active' : '');
      pill.textContent = g.title
        .replace(/\s*-\s*Assigned\s*Projects?/i, '')
        .replace(/\s*Projects?$/i, '')
        .replace(/\s*Requests?$/i, '');
      // Use the group's Monday color for the active pill.
      if (isActive && g.color) {
        pill.style.background = g.color;
        pill.style.borderColor = g.color;
        pill.style.color = isLightColor(g.color) ? '#333' : '#fff';
      }
      pill.addEventListener('click', () => {
        activeGroupId = g.id;
        renderFilterPills();
        renderPicker();
      });
      row.appendChild(pill);
    }
  }

  async function pickJob(job) {
    // Clear post-stop adjustment state if still active
    if (stoppedSession) dismissStoppedSummary();

    // Clicking the already-active job just returns to the timer (no redundant switch).
    if (state.running && job.id === state.itemId) {
      setView('running');
      return;
    }
    if (pickerMode === 'switch' && state.running) {
      const s = await api.switchJob({ itemId: job.id, itemName: job.name });
      applyAfterAction(s);
    } else {
      const s = await api.startJob({ itemId: job.id, itemName: job.name });
      applyAfterAction(s);
    }
    lastStoppedItemId = null;
    setView('running');
  }

  function applyAfterAction(s) {
    if (s) {
      state = s;
      setDot(s.running);
      if (s.running) {
        renderJob(s.itemName);
        startTick();
      } else {
        stopTick();
      }
    }
  }

  // (group pill filtering replaces the old mine/all scope toggle)

  // ---- log time ----
  async function doLogTime(itemId) {
    const info = await api.getExportInfo(itemId);
    if (info.deltaMs <= 0) {
      showToast({ text: 'No time to log on this job.', durationMs: 4000 });
      return;
    }
    const sessionStr = fmtToday(info.deltaMs);
    const totalStr = fmtToday(info.totalMs);
    const sc = info.sessionCount || 1;
    $('confirm-export-msg').textContent =
      `Log ${sessionStr} (${sc} session${sc !== 1 ? 's' : ''}) to Monday? Total: ${totalStr}`;
    const noteInput = $('confirm-export-note');
    noteInput.value = '';
    $('confirm-export').classList.remove('hidden');
    setTimeout(() => noteInput.focus(), 30);
    // Wire up confirm/cancel (one-shot)
    const yes = $('confirm-export-yes');
    const no = $('confirm-export-no');
    const cleanup = () => {
      $('confirm-export').classList.add('hidden');
      yes.replaceWith(yes.cloneNode(true));
      no.replaceWith(no.cloneNode(true));
      noteInput.removeEventListener('keydown', onKey);
    };
    const doConfirm = async () => {
      const note = noteInput.value.trim();
      cleanup();
      const result = await api.logTime(itemId, note);
      if (result.ok) {
        showToast({ text: 'Time logged to Monday', durationMs: 4000 });
      } else {
        showToast({ text: 'Log failed: ' + (result.error || 'Unknown error'), durationMs: 6000 });
      }
    };
    const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doConfirm(); } };
    noteInput.addEventListener('keydown', onKey);
    yes.addEventListener('click', doConfirm, { once: true });
    no.addEventListener('click', cleanup, { once: true });
  }

  // ---- distraction recovery ----
  function subtractTime(ms, label) {
    if (!state.running) return;
    api.subtractTime(ms).then((s) => {
      if (s) {
        state = { ...state, ...s };
        renderTime();
      }
    });
    // Visual feedback: flash elapsed red and show indicator
    const el = $('elapsed');
    el.classList.add('elapsed-flash');
    setTimeout(() => el.classList.remove('elapsed-flash'), 400);
    const flash = $('distract-flash');
    flash.textContent = label;
    flash.classList.remove('hidden');
    // Force re-trigger animation
    flash.style.animation = 'none';
    flash.offsetHeight; // reflow
    flash.style.animation = '';
    setTimeout(() => flash.classList.add('hidden'), 1000);
  }

  // ---- post-stop adjustment window ----
  function showStoppedSummary(itemId, itemName, elapsedMs) {
    stoppedSession = { itemId, itemName, elapsedMs };
    renderJob(itemName);
    $('elapsed').textContent = fmtClock(elapsedMs);
    $('today').textContent = '';
    $('total').textContent = 'Session logged';
    $('topbar-label').textContent = 'STOPPED';
    setDot(false);
    // Change Stop to Done
    $('stop-btn').innerHTML =
      '<svg viewBox="0 0 16 16" width="11" height="11"><path d="M3 8 L7 12 L13 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Done';
    clearTimeout(stoppedTimer);
    stoppedTimer = setTimeout(dismissStoppedSummary, 10000);
  }

  function dismissStoppedSummary() {
    if (!stoppedSession) return;
    stoppedSession = null;
    clearTimeout(stoppedTimer);
    // Restore Stop button
    $('stop-btn').innerHTML =
      '<svg viewBox="0 0 16 16" width="11" height="11"><rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor"/></svg> Stop';
    setView('idle');
  }

  function adjustStoppedSession(ms, label) {
    if (!stoppedSession) return;
    api.adjustLastSession(stoppedSession.itemId, ms);
    stoppedSession.elapsedMs = Math.max(0, stoppedSession.elapsedMs - ms);
    $('elapsed').textContent = fmtClock(stoppedSession.elapsedMs);
    // Visual feedback (same as live subtract)
    const el = $('elapsed');
    el.classList.add('elapsed-flash');
    setTimeout(() => el.classList.remove('elapsed-flash'), 400);
    const flash = $('distract-flash');
    flash.textContent = label;
    flash.classList.remove('hidden');
    flash.style.animation = 'none';
    flash.offsetHeight;
    flash.style.animation = '';
    setTimeout(() => flash.classList.add('hidden'), 1000);
    // Reset auto-dismiss timer
    clearTimeout(stoppedTimer);
    stoppedTimer = setTimeout(dismissStoppedSummary, 10000);
  }

  // ---- refresh jobs ----
  async function refreshJobs() {
    const btn = $('refresh-btn');
    btn.classList.add('spinning');
    jobs = await api.getJobs('all');
    btn.classList.remove('spinning');
    if (jobs.error) {
      $('picker-empty').textContent = jobs.error;
      $('picker-empty').classList.remove('hidden');
    }
    renderFilterPills();
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
  // Uses absolute deltas from drag start + setBounds on main to avoid the
  // feedback loop that incremental setContentSize + setPosition caused.
  function bindResizeGrip() {
    const grip = $('resize-grip');
    let drag = null;
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { grip.setPointerCapture(e.pointerId); } catch (_) { /* synthetic/edge */ }
      drag = { startX: e.screenX, startY: e.screenY, started: false };
      api.resizeStart();
    });
    grip.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dw = e.screenX - drag.startX;
      const dh = e.screenY - drag.startY;
      if (!drag.started && Math.abs(dw) < 3 && Math.abs(dh) < 3) return;
      drag.started = true;
      api.resizeTo(dw, dh);
    });
    grip.addEventListener('pointerup', () => {
      if (drag && drag.started) api.resizeEnd();
      drag = null;
    });
  }

  // ---- events binding ----
  function bind() {
    $('settings-btn').addEventListener('click', () => api.openSettings());
    $('min-btn').addEventListener('click', () => setView('pill'));
    $('close-btn').addEventListener('click', () => api.quitApp());
    $('back-btn').addEventListener('click', closePicker);

    $('start-job-btn').addEventListener('click', () => openPicker('start'));
    $('switch-btn').addEventListener('click', () => {
      if (stoppedSession) dismissStoppedSummary();
      openPicker('switch');
    });
    $('stop-btn').addEventListener('click', async () => {
      if (stoppedSession) {
        // "Done" button during post-stop summary
        dismissStoppedSummary();
        return;
      }
      // Capture session info before stopping
      const elapsed = Math.max(0, Date.now() - state.startedAt - (state.subtractedMs || 0));
      const itemId = state.itemId;
      const itemName = state.itemName;
      // Pre-set stoppedSession before the async call so the pushState from main
      // (which races with the invoke response) won't transition to idle view.
      stoppedSession = { itemId, itemName, elapsedMs: elapsed };
      lastStoppedItemId = itemId;
      const s = await api.stop();
      applyAfterAction(s);
      showStoppedSummary(itemId, itemName, elapsed);
    });

    // Distraction recovery — works both while running and during post-stop adjustment
    $('sub5-btn').addEventListener('click', () => {
      if (stoppedSession) adjustStoppedSession(5 * 60 * 1000, '-5:00');
      else subtractTime(5 * 60 * 1000, '-5:00');
    });
    $('sub15-btn').addEventListener('click', () => {
      if (stoppedSession) adjustStoppedSession(15 * 60 * 1000, '-15:00');
      else subtractTime(15 * 60 * 1000, '-15:00');
    });

    // Refresh jobs
    $('refresh-btn').addEventListener('click', () => refreshJobs());

    bindPill();
    bindResizeGrip();

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
      if (view === 'picker') { renderFilterPills(); renderPicker(); }
      if (view === 'idle') renderIdleRecents();
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
    activeGroupId = null;
    const s = await api.getState();
    applyState(s);
  }

  document.addEventListener('DOMContentLoaded', init);
})();

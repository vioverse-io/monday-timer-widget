// Settings window logic. Uses window.settingsAPI (preload). Falls back to a small mock
// when opened outside Electron (so the form still renders for QA screenshots).

(function () {
  const $ = (id) => document.getElementById(id);

  const api = window.settingsAPI || {
    get: () => Promise.resolve({
      apiToken: '', boardId: '7833051194', selectedGroupIds: [], forceDemoMode: true,
      hotkeyStop: 'CommandOrControl+Alt+T', hotkeyToggle: '',
      safety: {
        idleAutoStop: { enabled: true, minutes: 15 },
        eodNudge: { enabled: true, time: '17:00' },
        longSession: { enabled: true, hours: 4 },
        morningCheckin: { enabled: true }
      },
      launchOnStartup: false, closeToTray: true, theme: 'light', demoMode: true
    }),
    save: (p) => { console.log('save', p); return Promise.resolve({ ok: true }); },
    test: () => Promise.resolve({ ok: false, error: 'Electron only' }),
    getGroups: () => Promise.resolve([
      { id: 'g1', title: 'Priority - Assigned Projects', color: '#E2445C' },
      { id: 'g2', title: 'Low Priority Projects', color: '#0073EA' },
      { id: 'g3', title: 'Declined Requests', color: '#FDAB3D' }
    ]),
    getColumns: () => Promise.resolve({ ok: false, columns: [], detected: '', manual: '' })
  };

  function friendly(accel) {
    return (accel || '').replace('CommandOrControl', 'Ctrl').replace('Super', 'Win');
  }

  // Apply a theme to this window. 'auto' resolves against the OS preference.
  function applyTheme(theme) {
    let eff = theme;
    if (theme === 'auto') {
      eff = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.dataset.theme = eff;
  }

  function recordHotkey(input) {
    input.classList.add('recording');
    input.value = 'Press keys…';
    function onKey(e) {
      e.preventDefault();
      const k = e.key;
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(k)) return;
      if (!e.ctrlKey && !e.altKey && !e.metaKey) {
        input.value = 'Add Ctrl, Alt or Win…';
        return;
      }
      const parts = [];
      if (e.ctrlKey) parts.push('CommandOrControl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push('Super');
      parts.push(k.length === 1 ? k.toUpperCase() : k);
      const accel = parts.join('+');
      input.dataset.accel = accel;
      input.value = friendly(accel);
      cleanup();
    }
    function onEsc(e) {
      if (e.key === 'Escape') { cleanup(); input.value = friendly(input.dataset.accel || ''); }
    }
    function cleanup() {
      input.classList.remove('recording');
      document.removeEventListener('keydown', onKey, true);
    }
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keydown', onEsc, { once: true, capture: true });
  }

  async function load() {
    const s = await api.get();
    $('token').value = s.apiToken || '';
    $('boardId').value = s.boardId || '';

    $('hotkeyStop').dataset.accel = s.hotkeyStop || '';
    $('hotkeyStop').value = friendly(s.hotkeyStop || '');
    $('hotkeyToggle').dataset.accel = s.hotkeyToggle || '';
    $('hotkeyToggle').value = friendly(s.hotkeyToggle || '');

    const sf = s.safety || {};
    $('idle-on').checked = sf.idleAutoStop?.enabled ?? true;
    $('idle-min').value = sf.idleAutoStop?.minutes ?? 15;
    $('eod-on').checked = sf.eodNudge?.enabled ?? true;
    $('eod-time').value = sf.eodNudge?.time ?? '17:00';
    $('long-on').checked = sf.longSession?.enabled ?? true;
    $('long-hr').value = sf.longSession?.hours ?? 4;
    $('morning-on').checked = sf.morningCheckin?.enabled ?? true;

    $('startup-on').checked = !!s.launchOnStartup;
    $('tray-on').checked = s.closeToTray !== false; // default on

    $('theme').value = s.theme || 'light';
    applyTheme(s.theme || 'light');

    // Time Spent column picker (real mode only; demo returns none).
    if (api.getColumns) {
      const info = await api.getColumns();
      const sel = $('ts-col');
      (info.columns || []).forEach((c) => {
        const o = document.createElement('option');
        o.value = c.id;
        o.textContent = c.title;
        sel.appendChild(o);
      });
      sel.value = info.manual || '';
      const st = $('ts-col-status');
      if (info.manual) st.textContent = 'Manual override in use.';
      else if (info.detected) st.textContent = `Auto-detected: "${info.detected}"`;
      else if (info.ok) st.textContent = 'No Time Spent numbers column found — pick one above.';
      else st.textContent = 'Connect to Monday, save, then reopen Settings to load columns.';
    }

    // Auto-test connection if a token is present.
    if (s.apiToken) {
      const res = $('test-result');
      res.textContent = 'Checking…';
      res.className = 'result';
      const out = await api.test({ token: s.apiToken, boardId: s.boardId });
      if (out.ok) {
        res.textContent = `Connected as ${out.user.name}`;
        res.className = 'result ok';
      } else {
        res.textContent = out.error || 'Not connected';
        res.className = 'result err';
      }
    }
  }

  function gather() {
    return {
      apiToken: $('token').value.trim(),
      boardId: $('boardId').value.trim(),
      forceDemoMode: false,
      hotkeyStop: $('hotkeyStop').dataset.accel || '',
      hotkeyToggle: $('hotkeyToggle').dataset.accel || '',
      safety: {
        idleAutoStop: { enabled: $('idle-on').checked, minutes: Number($('idle-min').value) || 15 },
        eodNudge: { enabled: $('eod-on').checked, time: $('eod-time').value || '17:00' },
        longSession: { enabled: $('long-on').checked, hours: Number($('long-hr').value) || 4 },
        morningCheckin: { enabled: $('morning-on').checked }
      },
      launchOnStartup: $('startup-on').checked,
      closeToTray: $('tray-on').checked,
      theme: $('theme').value,
      timeSpentColumnManual: $('ts-col') ? $('ts-col').value : ''
    };
  }

  function bind() {
    $('token-toggle').addEventListener('click', () => {
      const t = $('token');
      const show = t.type === 'password';
      t.type = show ? 'text' : 'password';
      $('token-toggle').textContent = show ? 'Hide' : 'Show';
    });

    $('test-btn').addEventListener('click', async () => {
      const res = $('test-result');
      res.textContent = 'Testing…';
      res.className = 'result';
      const out = await api.test({ token: $('token').value.trim(), boardId: $('boardId').value.trim() });
      if (out.ok) {
        res.textContent = `Connected as ${out.user.name}`;
        res.className = 'result ok';
      } else {
        res.textContent = out.error || 'Failed';
        res.className = 'result err';
      }
    });

    $('hotkeyStop').addEventListener('click', () => recordHotkey($('hotkeyStop')));
    $('hotkeyToggle').addEventListener('click', () => recordHotkey($('hotkeyToggle')));

    // Live-preview the theme as the user changes it.
    $('theme').addEventListener('change', () => applyTheme($('theme').value));

    $('save-btn').addEventListener('click', async () => {
      await api.save(gather());
      window.close();
    });
    $('cancel-btn').addEventListener('click', () => window.close());
  }

  document.addEventListener('DOMContentLoaded', () => {
    bind();
    load();
  });
})();

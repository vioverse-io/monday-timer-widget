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
      launchOnStartup: false, theme: 'dark', demoMode: true
    }),
    save: (p) => { console.log('save', p); return Promise.resolve({ ok: true }); },
    test: () => Promise.resolve({ ok: false, error: 'Electron only' }),
    getGroups: () => Promise.resolve([
      { id: 'g1', title: 'Priority - Assigned Projects', color: '#E2445C' },
      { id: 'g2', title: 'Low Priority Projects', color: '#0073EA' },
      { id: 'g3', title: 'Declined Requests', color: '#FDAB3D' }
    ])
  };

  let selectedGroupIds = [];

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

  function renderGroups(groups) {
    const wrap = $('groups');
    wrap.innerHTML = '';
    if (!groups.length) {
      wrap.innerHTML = '<div class="hint">No groups (test the connection first).</div>';
      return;
    }
    // Default selection: the Priority group, if nothing is chosen yet.
    if (!selectedGroupIds.length) {
      const pri = groups.find((g) => /priority - assigned/i.test(g.title));
      if (pri) selectedGroupIds = [pri.id];
    }
    groups.forEach((g) => {
      const row = document.createElement('label');
      row.className = 'group-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = g.id;
      cb.checked = selectedGroupIds.includes(g.id);
      cb.addEventListener('change', () => {
        selectedGroupIds = cb.checked
          ? [...selectedGroupIds, g.id]
          : selectedGroupIds.filter((id) => id !== g.id);
      });
      const span = document.createElement('span');
      span.textContent = g.title;
      row.appendChild(cb);
      row.appendChild(span);
      wrap.appendChild(row);
    });
  }

  function recordHotkey(input) {
    input.classList.add('recording');
    input.value = 'Press keys…';
    function onKey(e) {
      e.preventDefault();
      const parts = [];
      if (e.ctrlKey) parts.push('CommandOrControl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push('Super');
      const k = e.key;
      if (!['Control', 'Alt', 'Shift', 'Meta'].includes(k)) {
        parts.push(k.length === 1 ? k.toUpperCase() : k);
        const accel = parts.join('+');
        input.dataset.accel = accel;
        input.value = friendly(accel);
        cleanup();
      }
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
    selectedGroupIds = s.selectedGroupIds || [];

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
    $('demo-on').checked = !!s.forceDemoMode;

    $('theme').value = s.theme || 'dark';
    applyTheme(s.theme || 'dark');

    const groups = await api.getGroups({ token: s.apiToken, boardId: s.boardId });
    renderGroups(groups);
  }

  function gather() {
    return {
      apiToken: $('token').value.trim(),
      boardId: $('boardId').value.trim(),
      selectedGroupIds,
      forceDemoMode: $('demo-on').checked,
      hotkeyStop: $('hotkeyStop').dataset.accel || '',
      hotkeyToggle: $('hotkeyToggle').dataset.accel || '',
      safety: {
        idleAutoStop: { enabled: $('idle-on').checked, minutes: Number($('idle-min').value) || 15 },
        eodNudge: { enabled: $('eod-on').checked, time: $('eod-time').value || '17:00' },
        longSession: { enabled: $('long-on').checked, hours: Number($('long-hr').value) || 4 },
        morningCheckin: { enabled: $('morning-on').checked }
      },
      launchOnStartup: $('startup-on').checked,
      theme: $('theme').value
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
        if (out.groups) renderGroups(out.groups);
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

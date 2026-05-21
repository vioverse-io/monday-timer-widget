// Persistent settings via electron-store. The API token is encrypted at rest with
// Electron's safeStorage (OS-backed) when available; otherwise it falls back to
// plaintext electron-store (with a flag recorded so we know which we did).

const Store = require('electron-store');
const { safeStorage } = require('electron');

const DEFAULT_BOARD_ID = '7833051194';

const defaults = {
  // Connection
  apiToken: null, // stored encrypted (base64) when tokenEncrypted=true
  tokenEncrypted: false,
  boardId: DEFAULT_BOARD_ID,

  // Picker scope: which group ids to pull items from. Empty = "not yet chosen".
  selectedGroupIds: [],

  // Demo
  forceDemoMode: false,
  bannerDismissed: false, // per-session only; reset on launch (see main.js)

  // Hotkeys (Electron accelerator strings)
  hotkeyStop: 'CommandOrControl+Alt+T',
  hotkeyToggle: '',

  // Safety nets
  safety: {
    idleAutoStop: { enabled: true, minutes: 15 },
    eodNudge: { enabled: true, time: '17:00' },
    longSession: { enabled: true, hours: 4 },
    morningCheckin: { enabled: true }
  },

  // Startup
  launchOnStartup: false,

  // Window position memory ({x, y} or null for default)
  windowPosition: null,

  // User resize preference: pixels added to each full view's base size (grip drag)
  userSize: { dw: 0, dh: 0 },

  // Network resilience: completed sessions awaiting a successful Monday write
  retryQueue: [],

  // Crash recovery: the in-progress running session, persisted on every tick
  runningSession: null,

  // Local recent history (item ids, most recent first) used to seed the Recent list
  recentItemIds: [],

  // EOD nudge bookkeeping (ISO date string of the day it was last dismissed)
  eodDismissedDate: null
};

const store = new Store({ name: 'compumail-timer', defaults });

function get(key) {
  return store.get(key);
}

function set(key, value) {
  store.set(key, value);
}

function getAll() {
  return store.store;
}

// ---- API token (encrypted) ----

function setToken(rawToken) {
  if (!rawToken) {
    store.set('apiToken', null);
    store.set('tokenEncrypted', false);
    return;
  }
  if (safeStorage && safeStorage.isEncryptionAvailable()) {
    const buf = safeStorage.encryptString(rawToken);
    store.set('apiToken', buf.toString('base64'));
    store.set('tokenEncrypted', true);
  } else {
    store.set('apiToken', rawToken);
    store.set('tokenEncrypted', false);
  }
}

function getToken() {
  const stored = store.get('apiToken');
  if (!stored) return null;
  if (store.get('tokenEncrypted')) {
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'));
    } catch (err) {
      // Encryption key changed / unavailable — treat as no token rather than crash.
      return null;
    }
  }
  return stored;
}

function hasToken() {
  return !!store.get('apiToken');
}

// ---- Recent history helpers ----

function pushRecent(itemId) {
  if (!itemId) return;
  const list = store.get('recentItemIds').filter((id) => id !== itemId);
  list.unshift(itemId);
  store.set('recentItemIds', list.slice(0, 20));
}

module.exports = {
  store,
  get,
  set,
  getAll,
  setToken,
  getToken,
  hasToken,
  pushRecent,
  DEFAULT_BOARD_ID
};

// All Monday.com access lives here. Same function signatures in demo and real mode,
// so the renderer and timer engine never know which backend is active.
//
// LOCAL-CLOCK MODEL: Monday's API cannot start/stop a live timer. We only READ
// sessions and CREATE finished ones. Never write value:"start"/"stop" — it blanks
// the column. See logSession() below.
//
// REAL MODE IS UNVERIFIED until the Step 0 live-board check is run with a real token.
// The exact create-session payload and the time-tracking column id must be confirmed
// against board 7833051194 before relying on real mode. Demo mode is fully working now.

const { MOCK_JOBS, MOCK_GROUPS, MOCK_USER } = require('./mock-data');

const ENDPOINT = 'https://api.monday.com/v2';

// API-Version header. Monday wants the current stable version string. This MUST be
// re-checked against the docs/changelog during Step 0 and updated if newer — do not
// assume this remains current.
const API_VERSION = '2025-01';

let isDemoMode = false;
let token = null;
let boardId = '7833051194';
let timeTrackingColumnId = null; // confirmed in Step 0; null until then
let timeSpentColumnId = null;    // Numbers "Time Spent" column; null until detected
let timeSpentTextColumnId = null; // Text "Time Spent" column; null until detected

function setDemoMode(enabled) {
  isDemoMode = !!enabled;
}
function getDemoMode() {
  return isDemoMode;
}
function setCredentials({ token: t, boardId: b, timeTrackingColumnId: tc, timeSpentColumnId: ts, timeSpentTextColumnId: tst } = {}) {
  if (t !== undefined) token = t;
  if (b !== undefined) boardId = b;
  if (tc !== undefined) timeTrackingColumnId = tc;
  if (ts !== undefined) timeSpentColumnId = ts;
  if (tst !== undefined) timeSpentTextColumnId = tst;
}

// ---- Low-level GraphQL helper (real mode only) ----

async function gql(query, variables = {}) {
  if (!token) throw new Error('No API token configured.');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token, // raw token, no "Bearer " prefix
      'API-Version': API_VERSION
    },
    body: JSON.stringify({ query, variables })
  });
  if (!res.ok) {
    throw new Error(`Monday HTTP ${res.status}`);
  }
  const json = await res.json();
  if (json.errors && json.errors.length) {
    throw new Error(json.errors.map((e) => e.message).join('; '));
  }
  return json.data;
}

// ---- Parsing helpers for real items ----

function startOfLocalDay() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Tolerant parser for the time-tracking column value. Returns:
//   todayMs  — sum of each session's portion that falls within the LOCAL day (sessions
//              that span midnight are clipped, so a 11:30pm→12:30am session adds only the
//              part after midnight). Day boundary = the user's machine timezone (EST).
//   totalMs  — all-time logged on the item (sum of all session durations).
//   lastSessionAt — most recent session end (for Recent ordering).
// Monday's exact session JSON shape varies; Step 0 confirms it. We read the common field
// names defensively and fall back to zeros if the shape is unexpected.
function parseTimeTracking(timeTrackingValue) {
  const empty = { todayMs: 0, totalMs: 0, lastSessionAt: 0 };
  if (!timeTrackingValue) return empty;
  let parsed;
  try {
    parsed = typeof timeTrackingValue === 'string' ? JSON.parse(timeTrackingValue) : timeTrackingValue;
  } catch {
    return empty;
  }
  const records = parsed.additional_value || parsed.history || parsed.sessions || [];
  const dayStart = startOfLocalDay();
  const dayEnd = dayStart + 86400000;
  let today = 0;
  let total = 0;
  let last = 0;
  for (const r of records) {
    const start = Date.parse(r.started_at || r.start || 0);
    const end = Date.parse(r.ended_at || r.end || 0);
    if (isNaN(start) || isNaN(end) || end <= start) continue; // skip running/invalid
    total += end - start;
    last = Math.max(last, end);
    const cs = Math.max(start, dayStart);
    const ce = Math.min(end, dayEnd);
    if (ce > cs) today += ce - cs;
  }
  return { todayMs: today, totalMs: total, lastSessionAt: last };
}

function parseAssignees(peopleValue) {
  if (!peopleValue) return [];
  try {
    const parsed = typeof peopleValue === 'string' ? JSON.parse(peopleValue) : peopleValue;
    return (parsed.personsAndTeams || []).map((p) => String(p.id));
  } catch {
    return [];
  }
}

// ---- Public API ----

async function getMe() {
  if (isDemoMode) return MOCK_USER;
  const data = await gql('query { me { id name email } }');
  return data.me;
}

async function getGroups() {
  if (isDemoMode) return MOCK_GROUPS;
  const data = await gql(
    `query ($b: [ID!]) { boards(ids: $b) { groups { id title color } } }`,
    { b: [boardId] }
  );
  return (data.boards?.[0]?.groups) || [];
}

async function getColumns() {
  if (isDemoMode) {
    return [{ id: 'tt', title: 'Time Tracking', type: 'time_tracking' }];
  }
  const data = await gql(
    `query ($b: [ID!]) { boards(ids: $b) { columns { id title type } } }`,
    { b: [boardId] }
  );
  return (data.boards?.[0]?.columns) || [];
}

/**
 * Returns jobs for the picker: { id, name, assignedToMe, todayMs, lastSessionAt }.
 * @param {string[]} groupIds groups to read
 * @param {string} currentUserId for the assignedToMe flag
 */
async function getItems(groupIds, currentUserId) {
  if (isDemoMode) {
    return MOCK_JOBS.map((j) => ({ ...j }));
  }
  const data = await gql(
    `query ($b: [ID!], $g: [String!]) {
       boards(ids: $b) {
         groups(ids: $g) {
           id
           items_page(limit: 100) {
             items {
               id
               name
               column_values { id type value text }
             }
           }
         }
       }
     }`,
    { b: [boardId], g: groupIds }
  );
  const groups = data.boards?.[0]?.groups || [];
  const items = [];
  for (const group of groups) {
    for (const it of group.items_page?.items || []) {
      const peopleCol = it.column_values.find((c) => c.type === 'people');
      const ttCol = timeTrackingColumnId
        ? it.column_values.find((c) => c.id === timeTrackingColumnId)
        : it.column_values.find((c) => c.type === 'time_tracking');
      const assignees = parseAssignees(peopleCol?.value);
      const { todayMs, totalMs, lastSessionAt } = parseTimeTracking(ttCol?.value);
      const dateCol = it.column_values.find((c) => c.type === 'date');
      const dueDate = dateCol?.text || null;
      items.push({
        id: it.id,
        name: it.name,
        groupId: group.id,
        assignedToMe: currentUserId ? assignees.includes(String(currentUserId)) : false,
        todayMs,
        totalMs,
        lastSessionAt,
        dueDate
      });
    }
  }
  return items;
}

/**
 * Log a completed session by posting an Update (comment) on the Monday item.
 * Monday's API does not support writing to the time-tracking column, so we record
 * sessions as human-readable comments instead.
 *
 * LEGACY: kept for the retry queue to drain old entries. New exports use logExport().
 */
async function logSession(itemId, startedAt, endedAt) {
  if (isDemoMode) {
    return { ok: true }; // no-op in demo
  }
  const dur = endedAt - startedAt;
  const h = Math.floor(dur / 3600000);
  const m = Math.floor((dur % 3600000) / 60000);
  const s = Math.floor((dur % 60000) / 1000);
  let durStr;
  if (h > 0) durStr = `${h}h ${m}m ${s}s`;
  else if (m > 0) durStr = `${m}m ${s}s`;
  else durStr = `${s}s`;
  const fmtTime = (ms) => new Date(ms).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', second: '2-digit'
  });
  const fmtDate = (ms) => new Date(ms).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
  const body = [
    'Time Logged',
    `Duration: ${durStr}`,
    `Start: ${fmtTime(startedAt)}`,
    `End: ${fmtTime(endedAt)}`,
    `Date: ${fmtDate(startedAt)}`
  ].join('\n');
  await gql(
    `mutation ($i: ID!, $body: String!) {
       create_update(item_id: $i, body: $body) { id }
     }`,
    { i: itemId, body }
  );
  return { ok: true };
}

/**
 * Read the job's current "Time Spent" value from Monday. The NUMBERS column is the
 * canonical store and holds WHOLE MINUTES (e.g. "23"). Returns milliseconds.
 *   - Empty cell            → 0   (safe to add onto)
 *   - Column not detected   → null (caller must NOT write, to avoid clobbering)
 *   - Read/network failure  → null (caller must NOT write; log-time will retry)
 * Never throws.
 */
async function readTimeSpentMs(itemId) {
  if (isDemoMode || !timeSpentColumnId) return null;
  try {
    const data = await gql(
      `query ($i: [ID!], $c: [String!]) {
         items(ids: $i) { column_values(ids: $c) { id text value } }
       }`,
      { i: [String(itemId)], c: [timeSpentColumnId] }
    );
    const cv = data.items?.[0]?.column_values?.[0];
    const raw = (cv?.text ?? '').toString().trim();
    if (!raw) return 0; // empty cell — start from zero
    const minutes = parseFloat(raw.replace(/,/g, ''));
    if (!isFinite(minutes) || minutes < 0) return 0;
    return Math.round(minutes * 60000);
  } catch {
    return null; // couldn't read — signal "unknown" so we never overwrite
  }
}

/**
 * ADD time to Monday's "Time Spent" — the ONLY place the number is written.
 * Called on every Stop/Switch (accumulateSession) with that session's duration.
 * Reads the current value, ADDS this session, writes the SUM — so time already on
 * the board (hand-entered, a coworker's, or another device) is preserved, never
 * overwritten. Root-cause fix for: a local total of 3m clobbering Monday's 20m.
 *
 * @param addMs  the completed session's duration to add (ms).
 * Never overwrites: if the current value can't be read, it throws instead of guessing.
 */
async function addTimeSpent(itemId, addMs) {
  if (isDemoMode || !timeSpentColumnId) return { ok: false, reason: 'no-column' };
  const add = Math.max(0, addMs || 0);
  if (add === 0) return { ok: true, newTotalMs: null };
  const existingMs = await readTimeSpentMs(itemId);
  if (existingMs === null) {
    throw new Error("Couldn't read current Time Spent from Monday — not overwriting.");
  }
  const newTotalMs = existingMs + add;
  await updateTimeSpent(itemId, newTotalMs); // writes text then numbers (canonical last)
  return { ok: true, newTotalMs };
}

/**
 * "Comment to Monday" — posts a note as an update on the item. NOTE ONLY.
 * It does NOT touch the Time Spent number (that's handled additively on Stop), and
 * the caller does NOT reset the timer or local totals. An empty note is a no-op.
 * (sessionMs/totalMs/sessionCount are unused now; kept for signature compatibility.)
 */
async function logExport(itemId, sessionMs, totalMs, sessionCount, note) {
  if (isDemoMode) return { ok: true };
  const trimmed = (note || '').trim();
  if (!trimmed) return { ok: true }; // nothing to post
  await gql(
    `mutation ($i: ID!, $body: String!) {
       create_update(item_id: $i, body: $body) { id }
     }`,
    { i: itemId, body: trimmed }
  );
  return { ok: true };
}

/**
 * Write an ABSOLUTE all-time total to both Time Spent columns.
 *   Numbers column: whole minutes (e.g. "23")   ← canonical, read back on next log
 *   Text column:    formatted (e.g. "7h 10m 0s")
 * The NUMBERS column is written LAST because logExport() reads it back to compute the
 * next additive total — committing it last keeps a retry safe if an earlier write fails.
 * Only called from logExport (on Log-to-Monday). We no longer auto-write on every stop.
 */
async function updateTimeSpent(itemId, totalMs) {
  if (isDemoMode) return;
  const ms = Math.max(0, totalMs);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);

  // Text column first (display only — "7h 10m 0s").
  if (timeSpentTextColumnId) {
    const formatted = `${h}h ${m}m ${s}s`;
    await gql(
      `mutation ($b: ID!, $i: ID!, $c: String!, $val: String!) {
         change_simple_column_value(board_id: $b, item_id: $i, column_id: $c, value: $val) { id }
       }`,
      { b: boardId, i: itemId, c: timeSpentTextColumnId, val: formatted }
    );
  }

  // Numbers column LAST — canonical value (whole minutes).
  if (timeSpentColumnId) {
    const minutes = Math.round(ms / 60000);
    await gql(
      `mutation ($b: ID!, $i: ID!, $c: String!, $val: String!) {
         change_simple_column_value(board_id: $b, item_id: $i, column_id: $c, value: $val) { id }
       }`,
      { b: boardId, i: itemId, c: timeSpentColumnId, val: String(minutes) }
    );
  }
}

/** Validate a token + board. Returns { ok, user?, groups?, error? }. */
async function testConnection({ token: t, boardId: b }) {
  const prevToken = token;
  const prevBoard = boardId;
  try {
    if (t !== undefined) token = t;
    if (b !== undefined) boardId = b;
    const me = await gql('query { me { id name email } }');
    if (!me?.me?.id) return { ok: false, error: 'Invalid token' };
    const boardData = await gql(
      `query ($b: [ID!]) { boards(ids: $b) { id name groups { id title color } } }`,
      { b: [boardId] }
    );
    const board = boardData.boards?.[0];
    if (!board) return { ok: false, error: 'Board not found or no access' };
    return { ok: true, user: me.me, groups: board.groups || [] };
  } catch (err) {
    return { ok: false, error: err.message || 'Connection failed' };
  } finally {
    token = prevToken;
    boardId = prevBoard;
  }
}

module.exports = {
  setDemoMode,
  getDemoMode,
  setCredentials,
  getMe,
  getGroups,
  getColumns,
  getItems,
  logSession,
  logExport,
  addTimeSpent,
  updateTimeSpent,
  readTimeSpentMs,
  testConnection,
  API_VERSION
};

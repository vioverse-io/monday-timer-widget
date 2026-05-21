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

function setDemoMode(enabled) {
  isDemoMode = !!enabled;
}
function getDemoMode() {
  return isDemoMode;
}
function setCredentials({ token: t, boardId: b, timeTrackingColumnId: tc } = {}) {
  if (t !== undefined) token = t;
  if (b !== undefined) boardId = b;
  if (tc !== undefined) timeTrackingColumnId = tc;
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
      items.push({
        id: it.id,
        name: it.name,
        assignedToMe: currentUserId ? assignees.includes(String(currentUserId)) : false,
        todayMs,
        totalMs,
        lastSessionAt
      });
    }
  }
  return items;
}

/**
 * Write ONE completed session to Monday with the real start/end timestamps.
 * Returns { ok: true } on success.
 *
 * STEP 0 MUST CONFIRM THIS PAYLOAD. The general accepted form is a column-value
 * mutation that supplies the session's start and end to the time-tracking column.
 * The shape below follows Monday's documented general form but is UNVERIFIED — do
 * not trust real mode until Step 0 confirms a session appears correctly in the
 * Monday web UI and the column is not blanked.
 */
async function logSession(itemId, startedAt, endedAt) {
  if (isDemoMode) {
    return { ok: true }; // no-op in demo
  }
  if (!timeTrackingColumnId) {
    throw new Error('Time-tracking column id not confirmed (run Step 0).');
  }
  const toIso = (ms) => new Date(ms).toISOString().replace('.000Z', ' UTC');
  // Documented general form: a finished session carries started_at + ended_at.
  const value = JSON.stringify({
    started_at: toIso(startedAt),
    ended_at: toIso(endedAt)
  });
  await gql(
    `mutation ($b: ID!, $i: ID!, $vals: JSON!) {
       change_multiple_column_values(board_id: $b, item_id: $i, column_values: $vals) {
         id
       }
     }`,
    {
      b: boardId,
      i: itemId,
      vals: JSON.stringify({ [timeTrackingColumnId]: JSON.parse(value) })
    }
  );
  return { ok: true };
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
  testConnection,
  API_VERSION
};

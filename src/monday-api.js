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
const API_VERSION = '2026-01';

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
           items_page(limit: 500) {
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

// Parse a Time Spent TEXT value ("Xh Ym Zs", "Ym Zs", "45s", "2h") to ms, second
// precision. Empty → 0. Unrecognised shape → null (so the caller can fall back to the
// Numbers column instead of trusting a bad parse).
function parseTimeSpentText(raw) {
  const str = (raw ?? '').toString().trim();
  if (!str) return 0;
  const h = /(\d+)\s*h/i.exec(str);
  const m = /(\d+)\s*m/i.exec(str);
  const s = /(\d+)\s*s/i.exec(str);
  if (!h && !m && !s) return null; // not the "Xh Ym Zs" format
  return (h ? +h[1] * 3600000 : 0) + (m ? +m[1] * 60000 : 0) + (s ? +s[1] * 1000 : 0);
}

/**
 * Read the job's current "Time Spent" from Monday, in ms. Reads the TEXT column
 * ("Xh Ym Zs") FIRST so sub-minute SECONDS are preserved across stops; falls back to
 * the whole-minute Numbers column only when the Text cell is blank or absent.
 * (This reverses the old "Numbers is the canonical read-back" rule — Text is now the
 * second-precision base for additive writes.)
 *   - Empty cell(s)          → 0    (safe to add onto)
 *   - No column detected      → null (caller must NOT write, to avoid clobbering)
 *   - Read/network failure    → null (caller must NOT write)
 * Never throws.
 */
async function readTimeSpentMs(itemId) {
  if (isDemoMode) return null;
  const ids = [timeSpentTextColumnId, timeSpentColumnId].filter(Boolean);
  if (!ids.length) return null; // no Time Spent column detected
  try {
    const data = await gql(
      `query ($i: [ID!], $c: [String!]) {
         items(ids: $i) { column_values(ids: $c) { id text value } }
       }`,
      { i: [String(itemId)], c: ids }
    );
    const cols = data.items?.[0]?.column_values || [];
    // TEXT column first (second precision).
    const textRaw = timeSpentTextColumnId
      ? (cols.find((c) => c.id === timeSpentTextColumnId)?.text ?? '').toString().trim()
      : '';
    if (textRaw) {
      const parsed = parseTimeSpentText(textRaw);
      if (parsed !== null) return parsed; // fall through only on unrecognised format
    }
    // Numbers column (whole minutes) — fallback.
    if (timeSpentColumnId) {
      const numRaw = (cols.find((c) => c.id === timeSpentColumnId)?.text ?? '').toString().trim();
      if (!numRaw) return 0;
      const minutes = parseFloat(numRaw.replace(/,/g, ''));
      if (!isFinite(minutes) || minutes < 0) return 0;
      return Math.round(minutes * 60000);
    }
    return 0;
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
  if (isDemoMode || (!timeSpentColumnId && !timeSpentTextColumnId)) return { ok: false, reason: 'no-column' };
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
 * "Comment to Monday" — posts a note as an update on the item, optionally @mentioning
 * Monday users so they get notified. NOTE + MENTION ONLY: does NOT touch the Time Spent
 * number (handled additively on Stop) and does NOT reset the timer.
 * @param note        the comment text (may be empty if a mention is given).
 * @param mentionIds  array of Monday user ids to @mention (optional).
 * Mentions go through create_update's `mentions_list` — NOT a typed "@" in the body,
 * which does not notify. If Monday rejects the mention, the note is still posted alone so
 * a comment is never lost. (sessionMs/totalMs/sessionCount are vestigial.)
 */
async function logExport(itemId, sessionMs, totalMs, sessionCount, note, mentionIds) {
  if (isDemoMode) return { ok: true };
  const trimmed = (note || '').trim();
  const mentions = (mentionIds || []).filter(Boolean).map((id) => String(id));
  if (!trimmed && !mentions.length) return { ok: true }; // nothing to post
  const body = trimmed || ' '; // Monday requires a non-empty body
  const mentionsLiteral = mentions.length
    ? `, mentions_list: [${mentions.map((id) => `{ id: ${JSON.stringify(id)}, type: User }`).join(', ')}]`
    : '';
  try {
    await gql(
      `mutation ($i: ID!, $body: String!) {
         create_update(item_id: $i, body: $body${mentionsLiteral}) { id }
       }`,
      { i: itemId, body }
    );
    return { ok: true };
  } catch (err) {
    if (mentions.length) {
      // Mention rejected (schema/permissions/version) — post the note without it so the
      // comment is never lost. Flagged so the renderer can note it once.
      await gql(
        `mutation ($i: ID!, $body: String!) {
           create_update(item_id: $i, body: $body) { id }
         }`,
        { i: itemId, body }
      );
      return { ok: true, mentionSkipped: true };
    }
    throw err;
  }
}

/**
 * Write an ABSOLUTE all-time total to both Time Spent columns.
 *   Text column:    formatted "Xh Ym Zs"  ← canonical read-back (second precision)
 *   Numbers column: whole minutes "23"    ← display / rollups only
 * The TEXT column is written LAST because readTimeSpentMs() reads it back to compute the
 * next additive total — committing it last keeps a retry safe if an earlier write fails.
 * Called from addTimeSpent (on every Stop/Switch).
 */
async function updateTimeSpent(itemId, totalMs) {
  if (isDemoMode) return;
  const ms = Math.max(0, totalMs);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);

  // Numbers column first (whole minutes — display / rollups only; no longer the
  // read-back base, so it's safe to write before the canonical Text value).
  if (timeSpentColumnId) {
    const minutes = Math.round(ms / 60000);
    await gql(
      `mutation ($b: ID!, $i: ID!, $c: String!, $val: String!) {
         change_simple_column_value(board_id: $b, item_id: $i, column_id: $c, value: $val) { id }
       }`,
      { b: boardId, i: itemId, c: timeSpentColumnId, val: String(minutes) }
    );
  }

  // Text column LAST — canonical second-precision value ("7h 10m 30s"), read back by
  // readTimeSpentMs on the next add. Committing it last keeps a retry safe.
  if (timeSpentTextColumnId) {
    const formatted = `${h}h ${m}m ${s}s`;
    await gql(
      `mutation ($b: ID!, $i: ID!, $c: String!, $val: String!) {
         change_simple_column_value(board_id: $b, item_id: $i, column_id: $c, value: $val) { id }
       }`,
      { b: boardId, i: itemId, c: timeSpentTextColumnId, val: formatted }
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

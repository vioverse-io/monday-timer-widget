// The four safety nets. All operate on the local timer; "stopping" always means
// stop the local clock and write the completed session to Monday (via ctx.stopAndLog).
//
// main.js injects a context object so this module stays decoupled from Electron specifics
// and is unit-testable. OS notifications are best-effort (Windows toast action buttons are
// unreliable across versions), so every actionable nudge is ALSO surfaced as an in-widget
// alert banner with buttons, which the renderer renders and routes back here.

const { powerMonitor } = require('electron');

let ctx = null;
let pollTimer = null;

// Per-session bookkeeping reset whenever a new timer starts.
let longSessionWarned = false;

function init(context) {
  ctx = context;
  // Reset the long-session warning each time a new session starts.
  ctx.timer.on('started', () => {
    longSessionWarned = false;
  });
}

function start() {
  stop();
  // One coarse poll drives idle / EOD / long-session checks.
  pollTimer = setInterval(tick, 15 * 1000);
}

function stop() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function settings() {
  return ctx.getSettings();
}

function tick() {
  if (!ctx) return;
  try {
    checkIdle();
    checkLongSession();
    checkEod();
  } catch (err) {
    ctx.log && ctx.log('safety-net tick error: ' + err.message);
  }
}

// 6.1 Auto-stop on computer idle
function checkIdle() {
  const cfg = settings().idleAutoStop;
  if (!cfg.enabled || !ctx.timer.isRunning()) return;
  const idleSeconds = powerMonitor.getSystemIdleTime();
  if (idleSeconds >= cfg.minutes * 60) {
    // End the session at the moment idle began, so logged time excludes idle time.
    const endedAt = Date.now() - idleSeconds * 1000;
    const job = { itemId: ctx.timer.itemId, itemName: ctx.timer.itemName, todayMsBase: ctx.timer.todayMsBase };
    ctx.stopAndLog(endedAt);
    ctx.setTrayState('alert');
    ctx.notify({
      title: 'Timer auto-stopped',
      body: `Auto-stopped after ${cfg.minutes} min idle on ${shortName(job.itemName)}.`
    });
    ctx.alert({
      kind: 'idle',
      message: `Timer auto-stopped after ${cfg.minutes} min idle.`,
      actions: [
        { id: 'resume', label: 'Resume', style: 'primary' },
        { id: 'dismiss', label: 'Dismiss', style: 'ghost' }
      ],
      data: job
    });
  }
}

// 6.3 Long session warning
function checkLongSession() {
  const cfg = settings().longSession;
  if (!cfg.enabled || !ctx.timer.isRunning() || longSessionWarned) return;
  if (ctx.timer.getElapsed() >= cfg.hours * 3600 * 1000) {
    longSessionWarned = true;
    ctx.flashTray();
    const name = shortName(ctx.timer.itemName);
    ctx.notify({
      title: 'Long session',
      body: `You've been on ${name} for ${cfg.hours} hours straight. Still working on this?`
    });
    ctx.alert({
      kind: 'long',
      message: `You've been on ${name} for ${cfg.hours} hours straight. Still working on this?`,
      actions: [
        { id: 'keep', label: 'Yes, keep going', style: 'primary' },
        { id: 'stopswitch', label: 'Stop and switch', style: 'ghost' }
      ]
    });
  }
}

// 6.2 End-of-day nudge
function checkEod() {
  const cfg = settings().eodNudge;
  if (!cfg.enabled || !ctx.timer.isRunning()) return;
  const today = new Date().toISOString().slice(0, 10);
  if (ctx.getEodDismissedDate() === today) return;
  const [h, m] = (cfg.time || '17:00').split(':').map(Number);
  const now = new Date();
  if (now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m)) {
    // Mark handled for today so it doesn't re-trigger until tomorrow.
    ctx.setEodDismissedDate(today);
    const name = shortName(ctx.timer.itemName);
    ctx.notify({ title: 'Timer still running', body: `Your timer is still running on ${name}. Stop it?` });
    ctx.alert({
      kind: 'eod',
      message: `Your timer is still running on ${name}. Stop it?`,
      actions: [
        { id: 'stop', label: 'Stop', style: 'danger' },
        { id: 'keep', label: 'Keep running', style: 'ghost' }
      ]
    });
  }
}

// 6.4 Morning check-in — called by main at launch with the persisted running session.
// Returns true if a modal was shown (so main knows not to auto-resume).
function morningCheckIn(savedSession) {
  if (!settings().morningCheckin || !savedSession) return false;
  const startDay = new Date(savedSession.startedAt).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (startDay === today) return false; // same day → normal resume, no modal
  ctx.showMorningModal(savedSession);
  return true;
}

// Routes an in-widget alert button click back to the right behavior.
function handleAlertAction(kind, actionId, data) {
  if (kind === 'idle') {
    if (actionId === 'resume' && data) {
      ctx.resumeJob(data);
      ctx.setTrayState('running');
    } else {
      ctx.setTrayState(ctx.timer.isRunning() ? 'running' : 'idle');
    }
  } else if (kind === 'long') {
    if (actionId === 'stopswitch') {
      ctx.stopAndLog();
      ctx.openPicker();
    }
    // 'keep' → nothing, warning already suppressed for this session
  } else if (kind === 'eod') {
    if (actionId === 'stop') {
      ctx.stopAndLog();
    }
    // 'keep' → already marked dismissed for today
  }
}

function shortName(name) {
  if (!name) return 'this job';
  return name.length > 40 ? name.slice(0, 37) + '…' : name;
}

module.exports = { init, start, stop, morningCheckIn, handleAlertAction };

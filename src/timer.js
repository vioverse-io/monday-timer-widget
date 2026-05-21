// Local-clock timer engine — the single source of truth for the running session.
//
// The widget owns the clock. Monday only ever receives FINISHED sessions (written
// on stop/switch by main.js). There is no remote start/stop. This engine knows
// nothing about Monday or about persistence; it just tracks the running session and
// emits events. main.js wires it to the tray, renderer, persistence and the API.

const { EventEmitter } = require('events');

class TimerEngine extends EventEmitter {
  constructor() {
    super();
    this._reset();
    this._interval = null;
    // Holds the previous job after a switch, so a switch can be undone.
    this.previousJob = null;
  }

  _reset() {
    this.running = false;
    this.itemId = null;
    this.itemName = null;
    this.startedAt = null;
    this.todayMsBase = 0; // ms already logged on this item today (from Monday/mock)
  }

  isRunning() {
    return this.running;
  }

  /** Elapsed ms of the currently running local session (0 if idle). */
  getElapsed() {
    if (!this.running || !this.startedAt) return 0;
    return Date.now() - this.startedAt;
  }

  /** Snapshot for the renderer / persistence. */
  getState() {
    return {
      running: this.running,
      itemId: this.itemId,
      itemName: this.itemName,
      startedAt: this.startedAt,
      elapsedMs: this.getElapsed(),
      // Today = already-logged today + live local elapsed.
      todayMs: this.todayMsBase + this.getElapsed(),
      hasUndo: !!this.previousJob
    };
  }

  /** Serializable record of the in-progress session (for crash recovery). */
  serialize() {
    if (!this.running) return null;
    return {
      itemId: this.itemId,
      itemName: this.itemName,
      startedAt: this.startedAt,
      todayMsBase: this.todayMsBase
    };
  }

  _startTicking() {
    this._stopTicking();
    this._interval = setInterval(() => this.emit('tick', this.getState()), 1000);
  }

  _stopTicking() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  /**
   * Start a new local timer on an item. No API call here — starting is local-only.
   * @param {{itemId, itemName, todayMsBase?, startedAt?}} job
   */
  start(job) {
    this.running = true;
    this.itemId = job.itemId;
    this.itemName = job.itemName;
    this.todayMsBase = job.todayMsBase || 0;
    this.startedAt = job.startedAt || Date.now();
    this._startTicking();
    this.emit('change', this.getState());
    this.emit('started', this.getState());
    return this.getState();
  }

  /**
   * Stop the local timer and return the completed session record.
   * @param {number} [endedAt] override end time (used by idle auto-stop to subtract idle).
   * @returns {{itemId, itemName, startedAt, endedAt, durationMs}|null}
   */
  stop(endedAt) {
    if (!this.running) return null;
    const end = endedAt || Date.now();
    const session = {
      itemId: this.itemId,
      itemName: this.itemName,
      startedAt: this.startedAt,
      endedAt: end,
      durationMs: Math.max(0, end - this.startedAt)
    };
    this._stopTicking();
    this._reset();
    this.emit('change', this.getState());
    this.emit('stopped', session, this.getState());
    return session;
  }

  /**
   * Switch: stop+return the old session, then start a new local timer.
   * Records the previous job so the switch can be undone.
   * @returns {{completed, state}}
   */
  switchTo(job) {
    const previous = this.running
      ? { itemId: this.itemId, itemName: this.itemName, todayMsBase: this.todayMsBase }
      : null;
    const completed = this.stop();
    this.start(job);
    this.previousJob = previous;
    this.emit('change', this.getState());
    return { completed, state: this.getState() };
  }

  /** Clear the undo affordance (e.g. once the toast expires or undo is used). */
  clearUndo() {
    this.previousJob = null;
    this.emit('change', this.getState());
  }

  /** Restore a persisted running session (same-day resume after restart). */
  resume(session) {
    if (!session) return null;
    return this.start({
      itemId: session.itemId,
      itemName: session.itemName,
      todayMsBase: session.todayMsBase || 0,
      startedAt: session.startedAt
    });
  }

  /** Hard discard of any running session without emitting a completed record. */
  discard() {
    this._stopTicking();
    this._reset();
    this.previousJob = null;
    this.emit('change', this.getState());
  }
}

module.exports = new TimerEngine();

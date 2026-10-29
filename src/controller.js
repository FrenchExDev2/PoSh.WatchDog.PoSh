'use strict';

const { PolicyEngine, defaults, validatePolicy, identityKey } = require('./policy');
const { withDeadline } = require('./collector');

class WatchdogController {
  constructor(dependencies, policy = defaults, persisted = {}) {
    this.dependencies = dependencies;
    this.engine = new PolicyEngine(policy, persisted);
    this.now = dependencies.now || Date.now;
    this.state = 'waiting';
    this.detail = 'Waiting for a session.';
    this.sample = null;
    this.lastValid = null;
    this.restartOutcome = null;
    this.busy = false;
    this.disposed = false;
    this.revision = 0;
    this.pendingCommand = false;
    this.timer = null;
    this.abort = new AbortController();
  }

  snapshot() {
    return {
      state: this.state, detail: this.detail, mode: this.engine.policy.mode,
      sample: this.sample, lastValid: this.lastValid,
      sampleAgeSeconds: this.lastValid ? Math.max(0, (this.now() - Date.parse(this.lastValid.measuredAt)) / 1000) : null,
      consecutiveSamples: this.engine.count, policy: { ...this.engine.policy },
      restartOutcome: this.restartOutcome, automaticRestarts: this.engine.restarts.length,
      cooldownUntil: this.engine.cooldownUntil, suspendUntil: this.engine.suspendUntil,
      pendingCommand: this.pendingCommand, journalError: this.dependencies.journal.error,
      history: [...this.dependencies.journal.history],
    };
  }

  publish(state, detail) {
    if (this.disposed) return;
    this.state = state;
    this.detail = detail;
    this.dependencies.onChange?.(this.snapshot());
  }

  async persist() { await this.dependencies.store?.(this.engine.persist()); }

  async record(decision) {
    // Only allowlisted product data enters history or disk logs.
    await this.dependencies.journal.append({
      at: new Date(this.now()).toISOString(), state: this.state, decision,
      sample: this.sample, warningPrivateGiB: this.engine.policy.warningPrivateGiB,
      restartPrivateGiB: this.engine.policy.restartPrivateGiB,
      mode: this.engine.policy.mode, consecutiveSamples: this.engine.count,
    });
  }

  configure(policy) {
    this.revision++;
    this.engine.configure(policy);
    this.sample = null;
    const errors = validatePolicy(policy);
    this.publish(errors.length ? 'error' : policy.enabled ? 'waiting' : 'disabled',
      errors.length ? errors.join(' ') : policy.enabled ? 'Policy changed; fresh measurement required.' : 'Monitoring disabled.');
  }

  async suspend(minutes) {
    this.revision++;
    this.engine.suspend(this.now() + minutes * 60_000);
    await this.persist();
    this.publish('suspended', `Monitoring suspended for ${minutes} minutes.`);
  }

  async resume() {
    this.revision++;
    this.engine.resume();
    await this.persist();
    this.publish('waiting', 'Resumed; fresh measurements required.');
  }

  async measure() {
    const milliseconds = this.engine.policy.collectTimeoutSeconds * 1000;
    const started = this.now();
    const target = await withDeadline(() => this.dependencies.resolve(), milliseconds, this.abort.signal);
    if (!target?.pid) return { target, sample: null };
    const remaining = milliseconds - (this.now() - started);
    if (remaining <= 0) throw new Error('Collection deadline exceeded.');
    const sample = await this.dependencies.collect(target, remaining, this.abort.signal);
    return { target, sample };
  }

  async tick() {
    if (this.busy || this.disposed) return this.snapshot();
    this.busy = true;
    const revision = this.revision;
    try {
      const invalid = validatePolicy(this.engine.policy);
      if (invalid.length || !this.engine.policy.enabled || this.engine.suspendUntil > this.now()) {
        const decision = this.engine.evaluate(null, this.now());
        this.sample = null;
        this.publish(decision.state, decision.detail);
        return this.snapshot();
      }
      const measured = await this.measure();
      if (this.disposed || revision !== this.revision) return this.snapshot();
      this.sample = measured.sample;
      if (!measured.sample) {
        this.engine.resetSeries();
        this.publish(measured.target?.state || 'waiting', measured.target?.detail || 'Waiting for a session.');
        await this.record('No associated session.');
        return this.snapshot();
      }
      this.lastValid = measured.sample;
      const decision = this.engine.evaluate(measured.sample, this.now(), { debugging: this.dependencies.debugging() });
      const priorState = this.state;
      this.publish(decision.state, decision.detail);
      await this.persist();
      await this.record(decision.detail);
      if (decision.notifyWarning) this.dependencies.notice?.('warning', 'PowerShell private memory exceeds the warning threshold.');
      if (decision.state === 'suspended' && priorState !== 'suspended') this.dependencies.notice?.('warning', decision.detail);
      if (decision.restart && revision === this.revision) await this.restart(measured, true);
    } catch (error) {
      if (this.disposed || revision !== this.revision) return this.snapshot();
      this.sample = null;
      this.engine.resetSeries();
      const state = ['ambiguous', 'unsupported'].includes(error.code) ? error.code : 'error';
      const safeMessage = { ambiguous: 'Session association is ambiguous; no action allowed.',
        unsupported: 'Environment or PowerShell version is unsupported; no action allowed.',
        timeout: 'Collection timed out; memory unknown.' }[error.code] || 'Collection failed; memory unknown. Check process access and session identity.';
      this.publish(state, safeMessage);
      await this.record(safeMessage);
    } finally {
      this.busy = false;
    }
    return this.snapshot();
  }

  async manualRestart() {
    if (this.busy || this.disposed || this.pendingCommand) return false;
    if (validatePolicy(this.engine.policy).length) return false;
    this.busy = true;
    try {
      const measured = await this.measure();
      if (!measured.sample) return false;
      return await this.restart(measured, false);
    } catch {
      this.publish('error', 'Cannot safely identify a session to restart.');
      return false;
    } finally { this.busy = false; }
  }

  async restart(previous, automatic) {
    if (this.pendingCommand || this.disposed) return false;
    const revision = this.revision;
    // Re-resolve immediately before dispatch; a stale PID must never authorize a new session's restart.
    const fresh = await this.measure();
    if (!fresh.sample || identityKey(fresh.sample) !== identityKey(previous.sample) || fresh.target.terminal !== previous.target.terminal) {
      this.engine.resetSeries();
      this.publish('waiting', 'Session changed before restart; collecting fresh evidence.');
      return false;
    }
    if (revision !== this.revision || (automatic && (!this.engine.policy.enabled || this.engine.policy.mode !== 'automatic' ||
      fresh.sample.privateBytes < this.engine.policy.restartPrivateGiB * (1024 ** 3) ||
      this.engine.suspendUntil > this.now() || this.engine.suspendedReason ||
      (this.engine.policy.deferWhileDebugging && this.dependencies.debugging())))) {
      this.engine.resetSeries();
      this.publish('deferred', 'Restart deferred after the final activity check.');
      return false;
    }
    const commands = await this.dependencies.commands();
    if (revision !== this.revision || this.disposed || (automatic && this.engine.policy.deferWhileDebugging && this.dependencies.debugging())) {
      this.engine.resetSeries();
      return false;
    }
    if (!commands.includes('PowerShell.RestartSession')) {
      this.restartOutcome = 'failed';
      this.engine.restartFinished(this.now(), 'failed');
      await this.persist();
      this.publish('suspended', 'PowerShell.RestartSession is unavailable.');
      await this.record('Restart command unavailable.');
      return false;
    }
    this.publish('restarting', 'Requesting a replacement PowerShell session.');
    this.engine.restartRequested(this.now(), automatic);
    // Persist the attempt before dispatch. A reload during restart must not bypass quota or unlock another request.
    this.engine.suspendedReason = 'Restart interrupted or pending; inspect the session and resume.';
    await this.persist();
    this.pendingCommand = true;
    const deadline = this.now() + this.engine.policy.restartTimeoutSeconds * 1000;
    let outcome = 'expired';
    try {
      const request = Promise.resolve().then(() => this.dependencies.restart());
      request.then(() => { this.pendingCommand = false; }, () => { this.pendingCommand = false; });
      await withDeadline(() => request, Math.max(1, deadline - this.now()), this.abort.signal);
      while (!this.disposed && this.now() < deadline) {
        try {
          const next = await withDeadline(() => this.measure(), Math.max(1, deadline - this.now()), this.abort.signal);
          if (next.sample && identityKey(next.sample) !== identityKey(previous.sample)) {
            this.sample = next.sample;
            this.lastValid = next.sample;
            outcome = 'succeeded';
            break;
          }
        } catch { /* A restarting process is temporarily absent; retain the overall deadline. */ }
        await withDeadline(() => new Promise((resolve) => setTimeout(resolve, Math.min(500, Math.max(1, deadline - this.now())))),
          Math.max(1, deadline - this.now()), this.abort.signal);
      }
    } catch (error) {
      outcome = error.code === 'timeout' ? 'expired' : this.disposed ? 'indeterminate' : 'failed';
    }
    this.restartOutcome = outcome;
    if (outcome === 'succeeded') this.engine.suspendedReason = null;
    else this.sample = null;
    this.engine.restartFinished(this.now(), outcome);
    await this.persist();
    this.publish(outcome === 'succeeded' ? 'cooldown' : 'suspended',
      outcome === 'succeeded' ? 'Replacement session measured; stabilizing.' : `Restart ${outcome}; automatic restarts suspended.`);
    await this.record(`Restart ${outcome}.`);
    if (outcome !== 'succeeded') this.dependencies.notice?.('warning', `PowerShell restart ${outcome}. Check the session and resume explicitly.`);
    return outcome === 'succeeded';
  }

  start() {
    const cycle = async () => {
      try { await this.tick(); } catch { this.publish('error', 'Watchdog storage or orchestration error.'); }
      if (!this.disposed) {
        const seconds = this.engine.policy.sampleIntervalSeconds;
        this.timer = setTimeout(cycle, Number.isFinite(seconds) && seconds > 0 && seconds * 1000 <= 2 ** 31 - 1 ? seconds * 1000 : 15_000);
      }
    };
    void cycle();
  }

  dispose() { this.disposed = true; clearTimeout(this.timer); this.abort.abort(); }
}

module.exports = { WatchdogController };

'use strict';

const GiB = 1024 ** 3;
const defaults = Object.freeze({
  enabled: true, mode: 'automatic', sampleIntervalSeconds: 15,
  warningPrivateGiB: 4, restartPrivateGiB: 8, consecutiveSamples: 3,
  collectTimeoutSeconds: 3, restartTimeoutSeconds: 45, cooldownSeconds: 120,
  maxAutomaticRestartsPerHour: 3, deferWhileDebugging: true,
});

function validatePolicy(policy) {
  const errors = [];
  for (const name of ['sampleIntervalSeconds', 'warningPrivateGiB', 'restartPrivateGiB',
    'collectTimeoutSeconds', 'restartTimeoutSeconds', 'cooldownSeconds',
    'consecutiveSamples', 'maxAutomaticRestartsPerHour']) {
    if (!Number.isFinite(policy[name]) || policy[name] <= 0) errors.push(`${name} must be positive.`);
  }
  for (const name of ['consecutiveSamples', 'maxAutomaticRestartsPerHour']) {
    if (!Number.isSafeInteger(policy[name])) errors.push(`${name} must be an integer.`);
  }
  // Node timers clamp values above the signed 32-bit limit to 1 ms.
  for (const name of ['sampleIntervalSeconds', 'collectTimeoutSeconds', 'restartTimeoutSeconds', 'cooldownSeconds']) {
    if (policy[name] * 1000 > 2 ** 31 - 1) errors.push(`${name} exceeds the timer limit.`);
  }
  if (!(policy.warningPrivateGiB < policy.restartPrivateGiB)) errors.push('Warning must be below restart threshold.');
  if (!['automatic', 'notifyOnly'].includes(policy.mode)) errors.push('Unknown mode.');
  for (const name of ['enabled', 'deferWhileDebugging']) {
    if (typeof policy[name] !== 'boolean') errors.push(`${name} must be boolean.`);
  }
  return errors;
}

const identityKey = (sample) => `${sample.pid}:${sample.createdAt}`;

class PolicyEngine {
  constructor(policy = defaults, persisted = {}) {
    this.policy = { ...policy };
    this.target = null;
    this.count = 0;
    this.lastAt = null;
    this.lastCountedAt = null;
    this.warning = false;
    this.restarts = Array.isArray(persisted.restarts) ? persisted.restarts.filter(Number.isFinite) : [];
    this.cooldownUntil = Number.isFinite(persisted.cooldownUntil) ? persisted.cooldownUntil : 0;
    this.suspendedReason = typeof persisted.suspendedReason === 'string' ? persisted.suspendedReason : null;
    this.awaitingImprovement = !!persisted.awaitingImprovement;
    this.suspendUntil = Number.isFinite(persisted.suspendUntil) ? persisted.suspendUntil : 0;
    this.lastDebugging = false;
  }

  resetSeries() { this.count = 0; this.lastAt = null; this.lastCountedAt = null; }

  configure(policy) {
    this.policy = { ...policy };
    this.resetSeries();
    this.warning = false;
  }

  persist() {
    return { restarts: this.restarts, cooldownUntil: this.cooldownUntil,
      suspendedReason: this.suspendedReason, awaitingImprovement: this.awaitingImprovement,
      suspendUntil: this.suspendUntil };
  }

  suspend(until) { this.suspendUntil = until; this.resetSeries(); }
  resume() { this.suspendUntil = 0; this.suspendedReason = null; this.resetSeries(); }

  restartRequested(now, automatic) {
    if (automatic) this.restarts.push(now);
    this.resetSeries();
  }

  restartFinished(now, outcome) {
    this.resetSeries();
    if (outcome === 'succeeded') {
      this.cooldownUntil = now + this.policy.cooldownSeconds * 1000;
      this.awaitingImprovement = true;
    } else {
      this.suspendedReason = `Restart ${outcome}; resume explicitly after checking the session.`;
    }
  }

  evaluate(sample, now, { debugging = false } = {}) {
    const policy = this.policy;
    this.restarts = this.restarts.filter((at) => at > now - 3600_000);
    const result = (state, detail, extra = {}) => ({ state, detail, restart: false, notifyWarning: false, ...extra });
    const invalid = validatePolicy(policy);
    if (invalid.length) { this.resetSeries(); return result('error', invalid.join(' ')); }
    if (!policy.enabled) { this.resetSeries(); return result('disabled', 'Monitoring disabled.'); }
    if (this.suspendUntil > now) { this.resetSeries(); return result('suspended', 'Monitoring temporarily suspended.'); }
    if (!sample) { this.resetSeries(); return result('error', 'Memory unknown.'); }
    if (this.target !== identityKey(sample)) {
      this.target = identityKey(sample);
      this.warning = false;
      this.resetSeries();
    }
    if (this.lastAt !== null && (now - this.lastAt > policy.sampleIntervalSeconds * 2500 || now <= this.lastAt)) this.resetSeries();
    if (this.lastDebugging !== debugging) this.resetSeries();
    this.lastDebugging = debugging;
    this.lastAt = now;
    const high = sample.privateBytes >= policy.restartPrivateGiB * GiB;
    const warning = sample.privateBytes >= policy.warningPrivateGiB * GiB;
    const notifyWarning = warning && !this.warning;
    this.warning = warning;
    if (now < this.cooldownUntil) {
      this.resetSeries();
      return result('cooldown', 'Waiting for session stabilization.', { notifyWarning });
    }
    if (!high && this.awaitingImprovement) this.awaitingImprovement = false;
    if (!high) { this.count = 0; this.lastCountedAt = null; }
    else if (this.lastCountedAt === null || now - this.lastCountedAt >= policy.sampleIntervalSeconds * 1000) {
      this.count = Math.min(this.count + 1, policy.consecutiveSamples);
      this.lastCountedAt = now;
    }
    const base = result(high && this.count >= policy.consecutiveSamples ? 'confirmed' : warning ? 'warning' : 'normal',
      high ? `Restart threshold: ${this.count}/${policy.consecutiveSamples} samples.` : warning ? 'Private memory warning.' : 'Monitoring.', { notifyWarning });
    if (this.suspendedReason) return { ...base, state: 'suspended', detail: this.suspendedReason };
    if (policy.mode !== 'automatic' || !high) return base;
    if (policy.deferWhileDebugging && debugging) {
      this.resetSeries();
      return { ...base, state: 'deferred', detail: 'PowerShell debugging is active.' };
    }
    if (this.count < policy.consecutiveSamples) return base;
    if (this.awaitingImprovement) {
      this.suspendedReason = 'No sustained improvement after restart; automatic restarts suspended.';
      return { ...base, state: 'suspended', detail: this.suspendedReason };
    }
    if (this.restarts.length >= policy.maxAutomaticRestartsPerHour) {
      this.suspendedReason = 'Rolling-hour automatic restart quota reached.';
      return { ...base, state: 'suspended', detail: this.suspendedReason };
    }
    return { ...base, restart: true };
  }
}

module.exports = { GiB, defaults, validatePolicy, identityKey, PolicyEngine };

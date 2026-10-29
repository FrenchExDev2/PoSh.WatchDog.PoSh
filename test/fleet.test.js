'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WatchdogController } = require('../src/controller');
const { defaults, GiB } = require('../src/policy');

function setup() {
  let now = 0;
  let processes = [];
  const notices = [];
  const journal = { history: [], append: async (entry) => { journal.history.push(entry); } };
  const controller = new WatchdogController({ now: () => now, journal,
    observe: async () => ({ sample: null, target: { state: 'waiting' }, inventory: { processes: processes.map((entry) => ({ ...entry })), errors: [], complete: true } }),
    commands: () => { throw new Error('Ordinary processes must not request commands.'); },
    restart: () => { throw new Error('Ordinary processes must not be restarted.'); },
    debugging: () => false, notice: (_level, message) => notices.push(message),
  }, defaults);
  return { controller, notices, set: (entries, time) => { processes = entries; now = time; } };
}
const sample = (pid, privateGiB, createdAt = '2026-10-29T00:00:00Z') => ({ pid, createdAt, measuredAt: '2026-10-29T00:01:00Z',
  privateBytes: privateGiB * GiB, workingSetBytes: GiB, automaticRestart: false, kind: 'terminal' });

test('all ordinary pwsh instances are monitored with independent thresholds and alerts, without restart commands', async () => {
  const fixture = setup();
  for (const now of [0, 15000, 30000]) { fixture.set([sample(1, 8), sample(2, 1)], now); await fixture.controller.tick(); }
  assert.equal(fixture.controller.state, 'confirmed');
  assert.equal(fixture.controller.snapshot().processes.length, 2);
  assert.equal(fixture.controller.snapshot().processes[0].consecutiveSamples, 3);
  assert.equal(fixture.controller.snapshot().processes[1].consecutiveSamples, 0);
  assert.equal(fixture.notices.length, 1);
  assert.equal(fixture.controller.restartOutcome, null);
});
test('a total above the restart threshold does not merge separate process streaks', async () => {
  const fixture = setup();
  for (const now of [0, 15000, 30000]) { fixture.set([sample(1, 5), sample(2, 5)], now); await fixture.controller.tick(); }
  assert.equal(fixture.controller.state, 'warning');
  assert.equal(fixture.controller.snapshot().processes.every((entry) => entry.consecutiveSamples === 0), true);
});
test('exited instances are removed and a reused PID starts a fresh streak', async () => {
  const fixture = setup();
  fixture.set([sample(1, 8)], 0); await fixture.controller.tick();
  fixture.set([sample(1, 8)], 15000); await fixture.controller.tick();
  fixture.set([sample(1, 8, '2026-10-29T01:00:00Z')], 30000); await fixture.controller.tick();
  assert.equal(fixture.controller.snapshot().processes[0].consecutiveSamples, 1);
  fixture.set([], 45000); await fixture.controller.tick();
  assert.equal(fixture.controller.processEngines.size, 0);
  assert.equal(fixture.controller.state, 'waiting');
});
test('policy edits, suspension and disable clear ordinary process evidence', async () => {
  const fixture = setup();
  fixture.set([sample(1, 8)], 0); await fixture.controller.tick();
  fixture.controller.configure({ ...defaults, enabled: false });
  await fixture.controller.tick();
  assert.equal(fixture.controller.snapshot().processes.length, 0);
  assert.equal(fixture.controller.processEngines.size, 0);
  assert.equal(fixture.controller.state, 'disabled');
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { describeStatus } = require('../src/presentation');
const { GiB } = require('../src/policy');

const snapshot = (changes = {}) => ({ state: 'waiting', detail: 'No owned processes.', mode: 'automatic', processes: [], inventory: { complete: true }, ...changes });
test('no processes has a clear waiting label without an unknown memory number', () => {
  const view = describeStatus(snapshot());
  assert.match(view.text, /No pwsh in this window/);
  assert.ok(!view.text.includes('unknown'));
  assert.ok(!view.text.includes('automatic'));
});
test('multiple processes show count and committed total with per-process details', () => {
  const view = describeStatus(snapshot({ state: 'normal', processes: [
    { pid: 1, privateBytes: GiB, workingSetBytes: GiB / 2, kind: 'terminal', createdAt: '2026-10-29' },
    { pid: 2, privateBytes: GiB / 2, workingSetBytes: GiB / 4, kind: 'child', createdAt: '2026-10-29' },
  ] }));
  assert.match(view.text, /pwsh 2.*1\.50 GiB total.*Monitoring/);
  assert.match(view.tooltip, /Thresholds apply to each process/);
  assert.match(view.tooltip, /other pwsh: alerts only/);
  assert.match(view.tooltip, /PID 2 \(child\)/);
});
test('partial inventory never presents an exact total', () => {
  const view = describeStatus(snapshot({ state: 'normal', inventory: { complete: false }, processes: [
    { pid: 1, privateBytes: GiB, workingSetBytes: GiB, createdAt: '2026-10-29' },
  ] }));
  assert.match(view.text, /≥ 1\.00 GiB/);
  assert.match(view.tooltip, /total is incomplete/);
  assert.match(describeStatus(snapshot({ inventory: { complete: false } })).text, /Discovering pwsh/);
});
test('disable and collection errors are human-readable states', () => {
  assert.match(describeStatus(snapshot({ state: 'disabled' })).text, /Monitoring disabled/);
  assert.match(describeStatus(snapshot({ state: 'error' })).text, /Measurement unavailable/);
});

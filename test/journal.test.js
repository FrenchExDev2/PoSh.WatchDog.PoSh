'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Journal } = require('../src/journal');

test('AC-15: history and all rotated files stay within their budgets', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'watchdog-journal-'));
  try {
    const journal = new Journal(directory, { maxBytes: 256, files: 3 });
    for (let index = 0; index < 350; index++) await journal.append({ index, state: 'normal' });
    assert.equal(journal.history.length, 200);
    assert.equal(journal.history[0].index, 150);
    const files = await fs.readdir(directory);
    assert.equal(files.length, 3);
    for (const filename of files) assert.ok((await fs.stat(path.join(directory, filename))).size <= 256);
    assert.equal(journal.error, null);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

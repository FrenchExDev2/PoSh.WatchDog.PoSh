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

test('retained reads are ordered and serialized with writes and rotation', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'watchdog-journal-'));
  try {
    const journal = new Journal(directory, { maxBytes: 100, files: 3 });
    for (let index = 0; index < 4; index++) await journal.append({ index, padding: 'x'.repeat(30) });
    const reading = journal.readRetainedHistory();
    const writing = journal.append({ index: 4, padding: 'x'.repeat(30) });
    const before = await reading;
    await writing;
    const after = await journal.readRetainedHistory();
    assert.deepEqual(before.entries.map((item) => item.index), [1, 2, 3]);
    assert.deepEqual(after.entries.map((item) => item.index), [2, 3, 4]);
    assert.equal(before.invalidLines, 0); assert.ok(before.bytesRead <= 300);
    assert.equal(journal.error, null);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('missing journals, malformed lines and unreadable files are explicit and do not poison later appends', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'watchdog-journal-'));
  try {
    const journal = new Journal(directory);
    const empty = await journal.readRetainedHistory();
    assert.equal(empty.filesRead, 0); assert.equal(empty.missingFiles, 3);
    await fs.mkdir(path.join(directory, 'watchdog.2.jsonl'));
    await fs.writeFile(path.join(directory, 'watchdog.0.jsonl'), '{"index":1}\nBROKEN\nnull\n{"unfinished":');
    const result = await journal.readRetainedHistory();
    assert.equal(result.invalidLines, 3);
    assert.deepEqual(result.entries, [{ index: 1 }]);
    assert.ok(result.issues.some((item) => item.file === 'watchdog.2.jsonl' && item.code === 'unreadable'));
    await journal.append({ index: 2 });
    assert.equal(journal.error, null);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('a file exceeding the journal budget is never read without a byte cap', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'watchdog-journal-'));
  try {
    const journal = new Journal(directory, { maxBytes: 32 });
    await fs.writeFile(path.join(directory, 'watchdog.0.jsonl'), '{"index":1}\n' + 'x'.repeat(1000));
    const result = await journal.readRetainedHistory();
    assert.equal(result.bytesRead, 32);
    assert.deepEqual(result.entries, [{ index: 1 }]);
    assert.equal(result.invalidLines, 1);
    assert.ok(result.issues.some((item) => item.code === 'byteLimit'));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

class Journal {
  constructor(directory, { maxBytes = 5 * 1024 ** 2, files = 3 } = {}) {
    this.directory = directory;
    this.maxBytes = maxBytes;
    this.files = files;
    this.history = [];
    this.pending = Promise.resolve();
    this.error = null;
  }

  append(entry) {
    this.history.push(entry);
    if (this.history.length > 200) this.history.shift();
    const line = JSON.stringify(entry) + '\n';
    // Serialize writes and rotation; each controller iteration awaits its append.
    this.pending = this.pending.then(async () => {
      await fs.mkdir(this.directory, { recursive: true });
      const filename = path.join(this.directory, 'watchdog.0.jsonl');
      const size = await fs.stat(filename).then((stat) => stat.size, (error) => {
        if (error.code === 'ENOENT') return 0;
        throw error;
      });
      if (size + Buffer.byteLength(line) > this.maxBytes) {
        await fs.rm(path.join(this.directory, `watchdog.${this.files - 1}.jsonl`), { force: true });
        for (let index = this.files - 2; index >= 0; index--) {
          await fs.rename(path.join(this.directory, `watchdog.${index}.jsonl`),
            path.join(this.directory, `watchdog.${index + 1}.jsonl`)).catch((error) => {
            if (error.code !== 'ENOENT') throw error;
          });
        }
      }
      if (Buffer.byteLength(line) > this.maxBytes) throw new Error('Journal entry exceeds budget.');
      await fs.appendFile(filename, line, 'utf8');
      this.error = null;
    }).catch(() => { this.error = 'Journal unavailable; in-memory history remains bounded to 200 entries.'; });
    return this.pending;
  }
}

module.exports = { Journal };

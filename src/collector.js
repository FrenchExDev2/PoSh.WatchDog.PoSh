'use strict';

const { execFile } = require('node:child_process');
const path = require('node:path');
const { WatchdogError } = require('./session');

function withDeadline(action, milliseconds, signal) {
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (callback, value) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      callback(value);
    };
    const abort = () => finish(reject, new WatchdogError('cancelled', 'Operation cancelled.'));
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(reject, new WatchdogError('timeout', 'Operation deadline exceeded.')), milliseconds);
    Promise.resolve().then(action).then((value) => finish(resolve, value), (error) => finish(reject, error));
  });
}

function collect(target, milliseconds, signal) {
  return new Promise((resolve, reject) => {
    execFile(target.shellPath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
      path.join(__dirname, '../scripts/Measure-Session.ps1'),
      '-ProcessId', String(target.pid), '-ExpectedExecutable', target.shellPath,
      '-ExpectedLogPath', target.logPath, '-ExpectedSessionPath', target.sessionPath],
    { timeout: milliseconds, maxBuffer: 8192, windowsHide: true, encoding: 'utf8', signal }, (error, stdout) => {
      if (error) return reject(new WatchdogError(error.killed ? 'timeout' : 'collection',
        error.killed ? 'Collection timed out; memory unknown.' : 'Process unavailable, access denied, or identity changed; memory unknown.'));
      try {
        const sample = JSON.parse(stdout.replace(/^\uFEFF/, ''));
        if (sample.pid !== target.pid || typeof sample.createdAt !== 'string' || !Number.isFinite(Date.parse(sample.createdAt)) ||
          !Number.isFinite(Date.parse(sample.measuredAt)) ||
          !Number.isSafeInteger(sample.privateBytes) || sample.privateBytes < 0 ||
          !Number.isSafeInteger(sample.workingSetBytes) || sample.workingSetBytes < 0 || !/^7\./.test(sample.powerShellVersion)) {
          throw new Error('Invalid measurement');
        }
        resolve(sample);
      } catch { reject(new WatchdogError('collection', 'Invalid collector response; memory unknown.')); }
    });
  });
}

module.exports = { collect, withDeadline };

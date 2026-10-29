'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { Journal } = require('../src/journal');
const { buildReportModel, renderReportHtml } = require('../src/diagnostics-report');
const root = path.resolve(__dirname, '..');
const GiB = 1024 ** 3;
const base = Date.parse('2026-10-25T09:00:00Z');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(action, label) {
  const end = Date.now() + 30000;
  while (Date.now() < end) { const result = await action(); if (result) return result; await sleep(100); }
  throw new Error(`Timed out: ${label}`);
}

async function main() {
  const browser = process.env.WATCHDOG_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  await fs.access(browser);
  await fs.mkdir(path.join(root, '.sandbox'), { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, '.sandbox/report-'));
  const journalPath = path.join(directory, 'journal'); await fs.mkdir(journalPath);
  const journal = new Journal(journalPath);
  let index = 0; let sourceBytes = 0; let latest;
  for (let file = 2; file >= 0; file--) {
    const lines = []; let bytes = 0;
    while (true) {
      const sample = { pid: 442, createdAt: new Date(base + (index >= 4000 ? 1800 : 0) * 1000).toISOString(),
        measuredAt: new Date(base + index * 15000).toISOString(), kind: 'terminal',
        privateBytes: index === 2000 ? 12 * GiB : GiB * (0.3 + index % 40 / 100),
        workingSetBytes: GiB * (0.2 + index % 30 / 100), automaticRestart: false };
      const missing = index % 200 >= 20 && index % 200 < 30;
      const value = { at: sample.measuredAt, state: index % 300 === 0 ? 'warning' : 'normal',
        decision: index % 300 === 0 ? 'Warning: </script><img src=x onerror="globalThis.attacked=true">' : 'Window processes measured.',
        mode: 'notifyOnly', warningPrivateGiB: index < 5000 ? 4 : 5, restartPrivateGiB: 8, sampleIntervalSeconds: 15,
        complete: !missing, processCount: missing ? 21 : 1, omittedProcesses: missing ? 21 : 0,
        processes: missing ? [] : [sample], padding: 'x'.repeat(700) };
      const line = JSON.stringify(value) + '\n'; const size = Buffer.byteLength(line);
      if (bytes + size > journal.maxBytes) break;
      lines.push(line); bytes += size; index++; latest = sample;
    }
    sourceBytes += bytes; await fs.writeFile(path.join(journalPath, `watchdog.${file}.jsonl`), lines.join(''));
  }
  const retained = await journal.readRetainedHistory();
  assert.ok(sourceBytes > 15 * 1024 ** 2 - 10000); assert.equal(retained.entries.length, index);
  const snapshot = { state: 'normal', detail: 'Synthetic browser qualification fixture.', mode: 'notifyOnly',
    inventory: { complete: false }, processes: [latest], processSampleAgeSeconds: 2, automaticRestarts: 0,
    history: [], policy: { sampleIntervalSeconds: 15 } };
  const model = buildReportModel({ snapshot, retained, environment: { extension: require('../package.json').version, app: 'Browser QA fixture', platform: 'win32' } });
  assert.equal(model.series[0].peakPrivateBytes, 12 * GiB);
  const reportPath = path.join(directory, 'diagnostic.html'); await fs.writeFile(reportPath, renderReportHtml(model));
  const emptyPath = path.join(directory, 'empty.html');
  await fs.writeFile(emptyPath, renderReportHtml(buildReportModel({ snapshot: { state: 'disabled', processes: [], history: [], inventory: null } })));
  const profile = path.join(directory, 'browser-profile');
  const child = spawn(browser, ['--headless=new', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let launchError; child.on('error', (error) => { launchError = error; });
  let ws; let send;
  const errors = []; const requests = []; const checks = [];
  try {
    const port = await until(async () => { if (launchError) throw launchError;
      try { return Number((await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch { return null; }
    }, 'owned headless browser startup');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    ws = new WebSocket(targets.find((item) => item.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
    const pending = new Map(); let sequence = 0;
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) { const item = pending.get(message.id); pending.delete(message.id); clearTimeout(item.timer); if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result); }
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') errors.push(message.params.entry.text);
      if (message.method === 'Network.requestWillBeSent' && /^https?:/.test(message.params.request.url)) requests.push(message.params.request.url);
    });
    send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP deadline: ${method}`)); }, 30000);
      pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const ready = async () => { if (errors.length) throw new Error(errors.join('\n')); return evaluate('document.documentElement.dataset.reportReady === "true"'); };
    await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    const started = Date.now(); await send('Page.navigate', { url: pathToFileURL(reportPath).href });
    await until(ready, 'offline report rendering'); const renderMs = Date.now() - started;
    assert.equal(await evaluate('JSON.parse(document.getElementById("report-data").textContent).entries.length'), index);
    assert.equal(await evaluate('document.getElementById("process-select").options.length'), 2);
    assert.equal(await evaluate('typeof globalThis.attacked'), 'undefined');
    assert.equal(await evaluate('document.querySelectorAll("img[src=x]").length'), 0);
    assert.ok(await evaluate('Number(document.getElementById("memory-chart").dataset.privateSegments) > 1'));
    assert.ok(await evaluate('document.getElementById("quality").textContent.includes("partial")'));
    checks.push('Near-15-MiB journal history renders offline with PID reuse, gaps, partial coverage and escaped text.');
    await fs.writeFile(path.join(directory, 'desktop.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await evaluate('document.getElementById("process-select").selectedIndex = 1; document.getElementById("process-select").dispatchEvent(new Event("change"));');
    assert.ok(await evaluate('document.getElementById("memory-chart").getAttribute("aria-label").includes("2026-10-25T09:30:00.000Z")'));
    await evaluate('document.getElementById("thresholds").checked = false; document.getElementById("thresholds").dispatchEvent(new Event("change"));');
    assert.equal(await evaluate('document.querySelectorAll(".warning-line,.restart-line").length'), 0);
    const box = await evaluate('(() => { const b = document.getElementById("memory-chart").getBoundingClientRect(); return {x:b.left+b.width*0.7,y:b.top+b.height*0.5}; })()');
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    assert.ok(await evaluate('document.getElementById("chart-readout").textContent.includes("Nearest retained collection")'));
    await evaluate('document.getElementById("events-next").click()');
    assert.ok(await evaluate('document.getElementById("events-page").textContent.startsWith("2 / ")'));
    checks.push('Process selection, threshold visibility, pointer readout and event pagination work.');
    await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 1100, deviceScaleFactor: 1, mobile: false });
    await evaluate('scrollTo(0,0)'); assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
    await fs.writeFile(path.join(directory, 'narrow.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    checks.push('Desktop and narrow layouts are captured without horizontal overflow.');
    await send('Page.navigate', { url: pathToFileURL(emptyPath).href }); await until(ready, 'empty diagnostic report');
    assert.equal(await evaluate('document.getElementById("process-select").disabled'), true);
    assert.ok(await evaluate('!document.getElementById("chart-empty").hidden'));
    assert.equal(requests.length, 0); assert.deepEqual(errors, []);
    checks.push('Empty history stays readable; no remote request, script error or CSP error was observed.');
    const result = { success: true, sourceBytes, retainedEntries: index, renderMs, reportBytes: (await fs.stat(reportPath)).size,
      directory, html: reportPath, screenshots: ['desktop.png', 'narrow.png'], checks, browser: await send('Browser.getVersion') };
    await fs.mkdir(path.join(root, 'verification'), { recursive: true });
    await fs.writeFile(path.join(root, 'verification/report-browser.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally {
    if (send) { try { await send('Browser.close'); } catch { /* The owned browser may already be closed. */ } }
    ws?.close(); if (child.exitCode === null) child.kill();
  }
}

main().catch((error) => { console.log(JSON.stringify({ success: false, error: error.message, stack: error.stack })); process.exitCode = 1; });

'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { Writable } = require('node:stream');
const { createHash } = require('node:crypto');
const { downloadAndUnzipVSCode } = require('@vscode/test-electron');

const execute = promisify(execFile);
const root = path.resolve(__dirname, '..');

function runEditor(options) {
  // VS Code intentionally uses in-memory mementos with --extensionTestsPath.
  // An ordinary development driver is required to qualify real storage across process restarts.
  return new Promise((resolve, reject) => {
    const child = spawn(options.vscodeExecutablePath, [...options.launchArgs,
      `--extensionDevelopmentPath=${options.extensionDevelopmentPath}`], {
      env: { ...process.env, ...options.extensionTestsEnv, WATCHDOG_TEST_NORMAL_STORAGE: '1' }, windowsHide: true,
    });
    child.stdout.on('data', (chunk) => options.stdout.write(chunk));
    child.stderr.on('data', (chunk) => options.stderr.write(chunk));
    const timer = setTimeout(() => {
      // Teardown is limited to this runner-owned Desktop process; product code never kills the target session.
      child.kill();
      reject(new Error('Sandbox Desktop driver exceeded its 210-second deadline.'));
    }, 210000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => {
      clearTimeout(timer);
      child.stdout.destroy();
      child.stderr.destroy();
      if (code === 0) resolve(0);
      else reject(new Error(`Sandbox Desktop exited with code ${code}.`));
    });
  });
}

async function main() {
  if (process.platform !== 'win32') throw new Error('Windows sandbox qualification only.');
  // The Codex host may run Electron as Node; editor test children must use the Desktop runtime.
  delete process.env.ELECTRON_RUN_AS_NODE;
  const executable = process.env.WATCHDOG_TEST_VSCODE || await downloadAndUnzipVSCode({
    version: process.env.WATCHDOG_TEST_CHANNEL || 'insiders', cachePath: path.join(root, '.vscode-test'),
  });
  const sourcePowerShell = process.env.WATCHDOG_TEST_EXTENSION;
  const pwsh = process.env.WATCHDOG_TEST_PWSH;
  if (!sourcePowerShell || !pwsh) throw new Error('Set WATCHDOG_TEST_EXTENSION and WATCHDOG_TEST_PWSH. Optionally select WATCHDOG_TEST_VSCODE or WATCHDOG_TEST_CHANNEL.');
  const base = path.join(root, '.sandbox');
  await fs.mkdir(base, { recursive: true });
  const sandbox = await fs.mkdtemp(path.join(base, 'run-'));
  const extensions = path.join(sandbox, 'extensions');
  const shared = path.join(sandbox, 'reports');
  await fs.mkdir(extensions);
  await fs.mkdir(shared);
  await fs.cp(sourcePowerShell, path.join(extensions, 'ms-vscode.powershell-2026.1.2'), { recursive: true });
  const binDirectory = path.dirname(executable);
  const cmd = await fs.readFile(path.join(binDirectory, 'bin', path.basename(executable).includes('Insiders') ? 'code-insiders.cmd' : 'code.cmd'), 'utf8');
  const versionDirectory = /\.\.\\([^"\r\n]+)\\resources\\app\\out\\cli\.js/.exec(cmd)?.[1];
  const cli = path.join(binDirectory, ...(versionDirectory ? [versionDirectory] : []), 'resources/app/out/cli.js');
  const vsix = path.join(root, 'dist', 'powershell-watchdog-0.1.0.vsix');
  const install = await execute(executable, [cli, '--install-extension', vsix, '--extensions-dir', extensions,
    '--user-data-dir', path.join(sandbox, 'installer-data'), '--force'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, timeout: 60000, maxBuffer: 1024 ** 2,
  });
  if (!install.stdout.includes('successfully installed')) throw new Error('VSIX installation did not report success.');
  const testedVSIXSha256 = createHash('sha256').update(await fs.readFile(vsix)).digest('hex');
  const installedName = (await fs.readdir(extensions)).find((name) => /^frenchexdev\.powershell-watchdog-/i.test(name));
  if (!installedName) throw new Error('Installed product directory unavailable.');
  const runtimeHashes = {};
  for (const directory of ['src', 'scripts']) {
    for (const filename of await fs.readdir(path.join(extensions, installedName, directory))) {
      const relative = `${directory}/${filename}`;
      runtimeHashes[relative] = createHash('sha256').update(await fs.readFile(path.join(extensions, installedName, relative))).digest('hex');
    }
  }
  const launchDiagnostics = {};
  const outcomes = await Promise.allSettled(['A', 'B'].map(async (id) => {
    const userData = path.join(sandbox, `user-${id}`);
    const workspace = path.join(sandbox, `workspace-${id}`);
    await fs.mkdir(path.join(userData, 'User'), { recursive: true });
    await fs.mkdir(workspace);
    await fs.writeFile(path.join(workspace, 'sample.ps1'), '# Isolated Watchdog test workspace.\nGet-Date\n');
    await fs.writeFile(path.join(userData, 'User', 'settings.json'), JSON.stringify({
      'security.workspace.trust.enabled': false,
      'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'extensions.autoUpdate': false,
      'extensions.autoCheckUpdates': false, 'workbench.startupEditor': 'none',
      'powershell.enableProfileLoading': false, 'powershell.integratedConsole.showOnStartup': false,
      'powershell.powerShellAdditionalExePaths': { 'Watchdog Test PowerShell': pwsh },
      'powershell.powerShellDefaultVersion': 'Watchdog Test PowerShell',
      'frenchexdev.powershellWatchdog.mode': 'notifyOnly',
      'frenchexdev.powershellWatchdog.warningPrivateGiB': 16,
      'frenchexdev.powershellWatchdog.restartPrivateGiB': 32,
      'frenchexdev.powershellWatchdog.sampleIntervalSeconds': 1,
      'frenchexdev.powershellWatchdog.maxAutomaticRestartsPerHour': 1,
    }, null, 2));
    // Retain only a small error window for a Desktop process that fails before the test driver starts.
    launchDiagnostics[id] = [];
    const sink = new Writable({ write(chunk, _encoding, callback) {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (/error|failed|exception|denied|invalid|cannot|unable/i.test(line)) {
          launchDiagnostics[id].push(line.slice(0, 300));
          if (launchDiagnostics[id].length > 8) launchDiagnostics[id].shift();
        }
      }
      callback();
    } });
    const options = { vscodeExecutablePath: executable, reuseMachineInstall: true,
      extensionDevelopmentPath: path.join(__dirname, 'integration-driver'),
      extensionTestsPath: path.join(__dirname, 'integration/index.js'),
      extensionTestsEnv: { WATCHDOG_TEST_ID: id, WATCHDOG_TEST_SHARED: shared, WATCHDOG_TEST_PWSH: pwsh },
      launchArgs: [workspace, '--new-window', '--user-data-dir', userData, '--extensions-dir', extensions,
        '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-updates'],
      stdout: sink, stderr: sink,
    };
    await runEditor(options);
    return runEditor({ ...options, extensionTestsEnv: { ...options.extensionTestsEnv, WATCHDOG_TEST_REOPEN: '1' } });
  }));
  const reports = await Promise.all(['A', 'B'].map(async (id) => {
    try { return JSON.parse(await fs.readFile(path.join(shared, `${id}.json`), 'utf8')); }
    catch { return { id, success: false, error: 'Editor test report unavailable.' }; }
  }));
  await fs.mkdir(path.join(root, 'verification'), { recursive: true });
  const report = { at: new Date().toISOString(), sandbox, installedVSIX: vsix, testedVSIXSha256, runtimeHashes,
    boundedAllocationMiB: { editorServicesPerWindow: 192, ordinaryPerWindow: 32, windows: 2 },
    launchDiagnostics,
    outcomes: outcomes.map((outcome) => ({ status: outcome.status, exitCode: outcome.value,
      error: outcome.reason?.message })), reports };
  const reportName = reports.some((item) => item.app?.includes('Insiders')) ? 'integration-insiders.json' : 'integration-stable.json';
  await fs.writeFile(path.join(root, 'verification', reportName), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ success: reports.every((item) => item.success) && outcomes.every((item) => item.status === 'fulfilled'),
    report: `verification/${reportName}`, launchDiagnostics,
    windows: reports.map(({ id, success, checks, error }) => ({ id, success, checks, error })) }));
  if (!reports.every((item) => item.success) || outcomes.some((item) => item.status === 'rejected')) process.exitCode = 1;
}

main().catch((error) => { console.log(JSON.stringify({ success: false, error: error.message })); process.exitCode = 1; });

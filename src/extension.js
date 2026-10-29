'use strict';

const vscode = require('vscode');
const { readMachinePolicy } = require('./configuration');
const { WatchdogError } = require('./session');
const { WindowProcessObserver } = require('./observer');
const { describeStatus } = require('./presentation');
const { Journal } = require('./journal');
const { WatchdogController } = require('./controller');

const section = 'frenchexdev.powershellWatchdog';

function readPolicy() {
  const configuration = vscode.workspace.getConfiguration(section);
  // Read only user-machine settings, even if workspace settings are manually injected.
  return readMachinePolicy(configuration);
}

function environmentProblem() {
  if (process.platform !== 'win32' || vscode.env.uiKind !== vscode.UIKind.Desktop || vscode.env.remoteName ||
    vscode.workspace.workspaceFolders?.some((folder) => folder.uri.scheme !== 'file')) {
    return 'Only local Windows Desktop windows are supported.';
  }
  return null;
}

function activate(context) {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
  status.name = 'PowerShell Memory Watchdog';
  status.command = 'powershellWatchdog.menu';
  status.show();
  const debugSessions = new Set();
  if (vscode.debug.activeDebugSession?.type.toLowerCase() === 'powershell') debugSessions.add(vscode.debug.activeDebugSession.id);
  let controller;
  const observer = new WindowProcessObserver(vscode);
  const update = (snapshot) => {
    const display = describeStatus(snapshot);
    status.text = display.text;
    status.tooltip = display.tooltip;
    status.backgroundColor = ['error', 'suspended', 'ambiguous', 'unsupported'].includes(snapshot.state) ?
      new vscode.ThemeColor('statusBarItem.errorBackground') :
      ['warning', 'confirmed'].includes(snapshot.state) ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
  };
  const notice = (_level, message) => {
    void vscode.window.showWarningMessage(message, 'Diagnostics', 'Suspend 15 minutes').then(async (action) => {
      if (action === 'Diagnostics') await vscode.commands.executeCommand('powershellWatchdog.diagnostics');
      if (action === 'Suspend 15 minutes') await controller.suspend(15);
    }).catch(() => {});
  };
  controller = new WatchdogController({
    observe: (milliseconds, signal) => {
      const problem = environmentProblem();
      if (problem) throw new WatchdogError('unsupported', problem);
      return observer.observe(milliseconds, signal);
    },
    commands: () => vscode.commands.getCommands(true),
    restart: () => vscode.commands.executeCommand('PowerShell.RestartSession'),
    debugging: () => debugSessions.size > 0,
    journal: new Journal(context.logUri.fsPath),
    store: (value) => context.workspaceState.update('watchdog.policyState', value),
    onChange: update, notice,
  }, readPolicy(), context.workspaceState.get('watchdog.policyState', {}));

  const register = (name, callback) => context.subscriptions.push(vscode.commands.registerCommand(`powershellWatchdog.${name}`, async () => {
    try { return await callback(); }
    catch { void vscode.window.showErrorMessage('PowerShell Watchdog action failed. Open diagnostics and check settings or storage access.'); }
  }));
  const setEnabled = (value) => vscode.workspace.getConfiguration(section).update('enabled', value, vscode.ConfigurationTarget.Global);
  register('enable', () => setEnabled(true));
  register('disable', () => setEnabled(false));
  register('suspend', async () => {
    const value = await vscode.window.showInputBox({ prompt: 'Suspend monitoring for how many minutes?', value: '15',
      validateInput: (text) => Number.isFinite(Number(text)) && Number(text) > 0 && Number(text) <= 10080 ? null : 'Enter a duration between 0 and 10080 minutes.' });
    if (value !== undefined) await controller.suspend(Number(value));
  });
  register('resume', () => controller.resume());
  register('changeMode', async () => {
    const value = await vscode.window.showQuickPick(['automatic', 'notifyOnly'], {
      title: 'Automatic restarts discard session state and can interrupt interactive commands.',
    });
    if (value) await vscode.workspace.getConfiguration(section).update('mode', value, vscode.ConfigurationTarget.Global);
  });
  register('restart', async () => {
    if (environmentProblem()) return void vscode.window.showWarningMessage(environmentProblem());
    const answer = await vscode.window.showWarningMessage(
      'Restart this window’s Editor Services session? Ordinary pwsh terminals keep running. Variables, modules and editor session state will be lost; a running editor command may be interrupted.',
      { modal: true }, 'Restart');
    if (answer === 'Restart' && !await controller.manualRestart()) void vscode.window.showWarningMessage('Restart did not complete. Consult Watchdog diagnostics.');
  });
  register('diagnostics', async () => {
    const snapshot = controller.snapshot();
    const document = await vscode.workspace.openTextDocument({ language: 'json', content: JSON.stringify({
      ...snapshot, environment: { vscode: vscode.version, app: vscode.env.appName, platform: process.platform,
        remote: vscode.env.remoteName || null, powershellExtension: vscode.extensions.getExtension('ms-vscode.powershell')?.packageJSON.version || null },
      limitations: ['Interactive command activity is unknown.', 'Ordinary terminal and child pwsh processes generate alerts; automatic restart is limited to verified Editor Services.',
        'Editor Services automatic restart association supports ms-vscode.powershell 2026.1.2; other pwsh measurement does not require it.',
        'Stable and Insiders qualification results are recorded separately in QUALIFICATION.md.'],
    }, null, 2) });
    await vscode.window.showTextDocument(document, { preview: true });
  });
  register('menu', async () => {
    const items = [ ['Diagnostics', 'diagnostics'], ['Enable', 'enable'], ['Disable', 'disable'],
      ['Suspend…', 'suspend'], ['Resume', 'resume'], ['Change mode…', 'changeMode'], ['Restart session…', 'restart'] ];
    const selection = await vscode.window.showQuickPick(items.map(([label, action]) => ({ label, action })), { title: 'PowerShell Memory Watchdog' });
    if (selection) await vscode.commands.executeCommand(`powershellWatchdog.${selection.action}`);
  });
  context.subscriptions.push(status, controller,
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(section)) controller.configure(readPolicy());
    }),
    vscode.debug.onDidStartDebugSession((session) => { if (session.type.toLowerCase() === 'powershell') { debugSessions.add(session.id); controller.engine.resetSeries(); } }),
    vscode.debug.onDidTerminateDebugSession((session) => { if (debugSessions.delete(session.id)) controller.engine.resetSeries(); }),
  );
  const ageTimer = setInterval(() => update(controller.snapshot()), 1000);
  context.subscriptions.push({ dispose: () => clearInterval(ageTimer) });
  controller.start();
  // Read-only diagnostics and an explicit sample request are useful to integration clients.
  return { getSnapshot: () => controller.snapshot(), sampleNow: () => controller.tick() };
}

module.exports = { activate, readPolicy, environmentProblem };

'use strict';
exports.activate = async () => {
  if (process.env.WATCHDOG_TEST_NORMAL_STORAGE !== '1') return;
  try { await require('../integration').run(); }
  catch { /* The driver writes its structured failure report before returning. */ }
  finally {
    // This window uses a unique user-data directory; close only this owned sandbox window.
    setTimeout(() => { void require('vscode').commands.executeCommand('workbench.action.closeWindow'); }, 200);
  }
};

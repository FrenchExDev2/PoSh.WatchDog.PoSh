# PowerShell Memory Watchdog

A Windows Desktop VS Code extension that measures **private committed memory** and resident memory of this window's PowerShell Editor Services session. Runs in the local Node extension host; collection runs in a separate profile-free PowerShell 7 process. No runtime npm dependencies.

## Install

Install `dist/powershell-watchdog-0.1.0.vsix` using **Extensions: Install from VSIX…** in VS Code Stable or Insiders. Requires VS Code 1.114 or later, Windows, PowerShell 7 Core and **ms-vscode.powershell 2026.1.2**. Open a PowerShell file and start your session normally. The watchdog never starts Editor Services just to monitor it.

Unknown PowerShell extension versions, ambiguous sessions, remote windows, the browser, Linux and macOS do not authorize a restart. Actual editor qualification is documented in `QUALIFICATION.md` in this package.

## Use

The status bar shows private memory, state and mode. Hover for resident memory, PID, creation time and age of the last valid sample. Click for actions: enable, disable, timed suspension, resume, mode, manual restart and diagnostics. These actions are also available in the command palette under **PowerShell Watchdog**.

Defaults: 15-second collection interval, 4 GiB warning, 8 GiB restart threshold, three consecutive high samples, 3-second collection deadline, 45-second restart deadline, 120-second stabilization and at most three automatic requests in a rolling hour. One GiB is 1,073,741,824 bytes. Private and resident memory are never added together.

**The default mode is `automatic`. A restart discards variables, modules and session state and may interrupt an interactive command.** PowerShell debugging defers automatic requests, but the absence of a debugger does not mean the interactive console is idle. Use `notifyOnly` when preserving a command takes priority.

Configure `frenchexdev.powershellWatchdog.*` in **user settings**. All settings are machine scoped; workspace and folder overrides are ignored explicitly. The settings and their defaults match `BESOIN.md`. Invalid policies disable automatic decisions and show an explanation. Disable survives a window reload. Quota, suspension, cooldown and unsuccessful/pending attempts are retained in workspace state; **Resume** is required after an automatic failure or quota suspension. Resume retains the rolling quota and does not authorize a second request while a timed-out command remains pending.

## Association and recovery

The adapter was derived from the shipped PowerShell 2026.1.2 code, not an assumed PID API. It reads the active extension's public `getLogUri()` and `getStorageUri()`, matches exactly one current-window terminal's `Import-Module`, `Start-EditorServices`, `-LogPath` and `-SessionDetailsPath`, then uses that terminal's process ID. Debug-only sessions and ordinary terminals are excluded. The external collector checks executable, launch artifacts and process creation time with Windows APIs before reading `PrivateMemorySize64` and `WorkingSet64`. Full command lines are neither returned nor logged. A changed creation time invalidates the old series, including PID reuse.

A restart is requested only through the current window's registered `PowerShell.RestartSession`. A normal command return is insufficient: a different PID/creation-time identity must be associated and measured before the overall deadline. Failed, expired or interrupted requests suspend automatic actions. Persistently high memory after stabilization also suspends them. There is no automatic forced termination, global process selection, elevation, profile change or telemetry.

## Diagnostics and budgets

Diagnostics opens a JSON document containing the current policy, identity, current/last valid measurement, decisions, bounded history and environment versions. Unknown memory is `null`; the previous valid sample is labeled separately. The journal uses VS Code's per-window extension log directory: `watchdog.0.jsonl` through `watchdog.2.jsonl`, each at most 5 MiB. In-memory history contains at most 200 entries. Storage failures are visible in diagnostics. The shared extension host must itself remain responsive.

## Develop and qualify

Node 22+ is required for the development tooling. Install locked tools with `npm ci --ignore-scripts`, run `node --test test/*.test.js`, and package with `node node_modules/@vscode/vsce/vsce package --no-dependencies --allow-missing-repository --out dist/`. Follow the repository's QuietCli instructions when running commands as an agent.

`test/run-integration.js` installs the built VSIX into a new `.sandbox/run-*` extension directory, copies the explicitly selected Microsoft extension, and runs two independent editor instances with separate user data and workspaces. Set `WATCHDOG_TEST_EXTENSION` to the installed Microsoft extension directory and `WATCHDOG_TEST_PWSH` to `pwsh.exe`, then run `node test/run-integration.js`. Select an existing Desktop executable with `WATCHDOG_TEST_VSCODE`, or download a separate test copy using `WATCHDOG_TEST_CHANNEL=insiders` (default) or `stable`. It never uses your normal VS Code profile. Allocation is bounded to 192 MiB per Editor Services session plus 32 MiB per ordinary console; thresholds are scaled to test real memory pressure without exhausting host RAM. Both editors are then reopened to verify persistent disable and quota. Reports go to `verification/integration-insiders.json` or `verification/integration-stable.json` and the sandbox reports directory, with hashes of the installed runtime. Sandbox files are retained for inspection. These tests do not establish the proposed stabilized <50 MiB overhead objective.

Sources: [Microsoft extension API](https://github.com/PowerShell/vscode-powershell/blob/main/src/features/ExternalApi.ts), [session launch implementation](https://github.com/PowerShell/vscode-powershell/blob/main/src/process.ts), [VS Code terminal API](https://code.visualstudio.com/api/references/vscode-api#Terminal), [extension host placement](https://code.visualstudio.com/api/advanced-topics/extension-host), [Windows private memory](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.privatememorysize64), [resident memory](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.workingset64). Compatibility is gated to the locally inspected release rather than inferred from the moving `main` branch.

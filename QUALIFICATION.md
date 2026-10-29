# Qualification

Date: **29 October 2026**. Results distinguish simulated policy tests, installed-VSIX integration and measurements still outstanding.

## Environment

| Component | Observed version |
| --- | --- |
| Windows | Windows 11 Pro, 10.0.26300, build 26300, x64 |
| PowerShell Core | 7.6.9 |
| Microsoft PowerShell extension | ms-vscode.powershell 2026.1.2 |
| VS Code Stable | 1.144.0, separate downloaded archive |
| VS Code Insiders | 1.145.0-insider, separate downloaded archive |
| Development Node | 26.8.1 |
| VSIX packager | @vscode/vsce 4.1.0 |

The user's installed Insiders was updating and refused Desktop startup. Qualification uses dedicated archive copies and separate user-data/extension directories. The normal user profile and Microsoft extension files are not modified.

## Independent automated tests

**31 tests passed, zero failures.** Run `node --test --test-reporter=tap test/*.test.js` from the project directory. These tests exercise warning episodes, inclusive thresholds, sample spacing, spike rejection, unknowns, long gaps, PID reuse, debugging, cooldown, rolling quota, persisted state, unsuccessful/hung restart commands, policy races, session ambiguity, window-specific launch artifacts, unsupported versions, collector overlap, configuration authority and history/log rotation.

The journal test writes 350 entries, retains exactly the latest 200 in memory, and verifies at most three files within a smaller equivalent 256-byte rotation budget. Production defaults are three files of 5 MiB each.

## Installed-VSIX integration

The sandbox installs the actual `dist/powershell-watchdog-0.1.0.vsix`; only a separate test driver is loaded from source. Every channel uses two independent local Desktop processes, with distinct profiles and workspaces. Each has an Editor Services process and an unrelated ordinary PowerShell console. This checks two isolated editor windows; a pair of windows sharing one user-data directory is not a separately measured scenario.

Both Stable and Insiders passed real association, memory collection, notify-only behavior, PowerShell debugger deferral, automatic replacement of A's session, preservation of B's session, machine-only settings, disable/enable and diagnostic display. **Both also passed disable and quota persistence in fresh Desktop processes.** Final cross-process storage qualification is recorded in `verification/integration-stable.json` and `verification/integration-insiders.json`.

Pressure is bounded to **192 MiB per Editor Services session and 32 MiB per ordinary console**. Warning and restart thresholds are set 64 MiB and 96 MiB above the initial private-memory sample. Sampling is one second, with three consecutive high samples and a maximum of one automatic restart. This exercises actual threshold crossings without exhausting host RAM. An automatic command return is accepted only after a distinct process identity is independently associated and measured. The successful request enters stabilization.

The driver then disables monitoring and closes each owned window normally. It reopens the same user-data directory and workspace and checks disabled monitoring and the retained automatic request count (A: one, B: zero).

Persistence uses an ordinary development driver **without `--extensionTestsPath`**. VS Code's extension-test mode deliberately uses in-memory mementos, which cannot establish disk persistence across editor processes. This was verified against the [VS Code storage implementation](https://github.com/microsoft/vscode/blob/main/src/vs/platform/storage/electron-main/storageMainService.ts). The product continues to use the documented `ExtensionContext.workspaceState` API.

Reports include the tested VSIX SHA-256 and hashes of all installed runtime files. Repackaging documentation may change the archive hash; final runtime hashes must still match the independently tested installed copies. `verification/results.json` records final parity and aggregate results.

## Acceptance evidence

| Requirement | Evidence and limits |
| --- | --- |
| AC-01 | Real current-window PID, process creation time, private and resident bytes on both channels. |
| AC-02 | Two isolated editor windows and unrelated consoles; A's restart leaves B unchanged. Shared-profile multiple windows are not separately qualified. |
| AC-03 | Independent duplicate-terminal and substituted-artifact tests refuse association. |
| AC-04 | Warning episode unit tests; real threshold state and diagnostic history. |
| AC-05 | Independent spike and counter reset test. |
| AC-06 | Real three-sample automatic request on both channels; persistence interval cannot be accelerated by explicit samples. |
| AC-07 | Injected collection failure clears the current value and series, retains a separately labeled last valid sample. Actual Windows access-denied ACL behavior is not separately qualified. |
| AC-08 | Real PowerShell debugging defers automatic action, followed by fresh samples after debugger termination. |
| AC-09 | Real process replacement plus independent same-PID/new-creation-time test. |
| AC-10 | Independent rejected, missing, unchanged-identity and never-returning command tests. No success without a measured replacement. |
| AC-11 | Rolling quota/expiry/persisted-state unit tests and cross-process workspace quota checks. |
| AC-12 | Separate external collection remains active during real PowerShell debugging. A never-returning restart command is simulated and bounded, retaining the pending-command lock. A genuinely unresponsive Editor Services process is not separately reproduced. |
| AC-13 | Real notify-only and disable/enable; persisted disable checked in a fresh Desktop process. |
| AC-14 | Explicit environment guard and unsupported-resolver tests. No real SSH, WSL, container or browser session is qualified. |
| AC-15 | Non-overlap unit test, bounded history and rotated-file tests, real short integration sessions. Long-duration stability and attributable memory overhead remain unqualified. |
| AC-16 | Installed VSIX on Stable 1.144.0 and Insiders 1.145.0-insider, activation, user settings, status, diagnostics and verified restart. |

## Remaining limits

- Only the inspected Microsoft extension release **2026.1.2** is enabled by the association adapter. Other versions fail explicitly pending qualification.
- The proposed stabilized **<50 MiB attributable memory overhead** has not been established. A recorded 10,000-snapshot heap probe is short, noisy and runs in a shared host; it is not an overhead benchmark.
- Interactive command activity is unknown. A restart may interrupt a command even when no debugger is active.
- Real access-denied behavior, long-duration idle runs, a truly unresponsive Editor Services target and shared-profile multi-window behavior require additional scenarios.
- No global process kill, automatic forced target termination, profile edit, administrative elevation, external publication or real machine-RAM saturation is performed by the product.

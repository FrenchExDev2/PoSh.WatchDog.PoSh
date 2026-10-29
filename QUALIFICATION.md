# Qualification — 0.2.0

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

**47 tests passed, zero failures.** Run `node --test --test-reporter=tap test/*.test.js` from the project directory. Tests cover the earlier editor restart protections plus independent per-process policies, aggregate-vs-individual thresholds, process exit/PID reuse, ordinary-terminal discovery without Microsoft activation, nested ownership, a non-PowerShell parent shell, peer-window exclusion, another editor boundary, cyclic/reused ancestry, explicit partial ownership, unresolved terminal IDs and human-readable status labels. A prepared PowerShell process graph tests the same selector used by the real Windows collector.

The journal test writes 350 entries, retains exactly the latest 200 in memory, and verifies at most three files within a smaller equivalent 256-byte rotation budget. Production defaults are three files of 5 MiB each.

## Installed-VSIX integration

The sandbox installs the actual `dist/powershell-watchdog-0.2.0.vsix`; only a separate test driver is loaded from source. Every channel uses two independent local Desktop processes, with distinct profiles and workspaces. Each has an ordinary pwsh terminal, a temporary nested pwsh and an Editor Services process. This checks two isolated editor windows; a pair of windows sharing one user-data directory is covered by a shared-parent process-graph fixture rather than a separate real editor run.

Both channels passed ordinary pwsh discovery before explicitly activating Microsoft PowerShell, nested-process ownership, removal after child exit, per-window process inventories, real memory collection and high-memory ordinary-process alerts without editor restart or terminal closure. Existing notify-only behavior, real PowerShell debugger deferral, automatic replacement of A's editor session, preservation of B's session, machine-only settings, disable/enable and diagnostics also passed. **Both passed disable and quota persistence in fresh Desktop processes.** Results are recorded in `verification/integration-stable.json` and `verification/integration-insiders.json`.

Pressure is bounded to **192 MiB per Editor Services session and 192 MiB per ordinary console**. Warning and restart thresholds are set 64 MiB and 96 MiB above the initial editor private-memory sample. Sampling is one second, with three consecutive high samples and a maximum of one automatic editor restart. This exercises actual threshold crossings without exhausting host RAM. An automatic command return is accepted only after a distinct process identity is independently associated and measured. The successful request enters stabilization. Each ordinary process has independent counters and remains alert-only, including when the editor mode is automatic.

The driver then disables monitoring and closes each owned window normally. It reopens the same user-data directory and workspace and checks disabled monitoring and the retained automatic request count (A: one, B: zero).

Persistence uses an ordinary development driver **without `--extensionTestsPath`**. VS Code's extension-test mode deliberately uses in-memory mementos, which cannot establish disk persistence across editor processes. This was verified against the [VS Code storage implementation](https://github.com/microsoft/vscode/blob/main/src/vs/platform/storage/electron-main/storageMainService.ts). The product continues to use the documented `ExtensionContext.workspaceState` API.

Reports include the tested VSIX SHA-256 and hashes of all installed runtime files. Repackaging documentation may change the archive hash; final runtime hashes must still match the independently tested installed copies. `verification/results.json` records final parity and aggregate results.

## Acceptance evidence

| Requirement | Evidence and limits |
| --- | --- |
| AC-01 | Real current-window PID, process creation time, private and resident bytes on both channels. |
| AC-02 | Each window measures its own editor, ordinary console and nested pwsh; peer editor and ordinary-console PIDs are absent from the other inventory. A's restart leaves B unchanged. A shared-parent selector fixture tests window separation; shared-profile real windows are not separately qualified. |
| AC-03 | Independent duplicate-terminal and substituted-artifact tests refuse association. |
| AC-04 | Warning episode unit tests; real threshold state and diagnostic history. |
| AC-05 | Independent spike and counter reset test. |
| AC-06 | Real three-sample automatic editor request on both channels; ordinary high-memory processes only produce alerts. Persistence cannot be accelerated by explicit samples or by summing different process memories. |
| AC-07 | Injected collection failure clears the current value and series, retains a separately labeled last valid sample. Actual Windows access-denied ACL behavior is not separately qualified. |
| AC-08 | Real PowerShell debugging defers automatic action, followed by fresh samples after debugger termination. |
| AC-09 | Real process replacement plus independent same-PID/new-creation-time test. |
| AC-10 | Independent rejected, missing, unchanged-identity and never-returning command tests. No success without a measured replacement. |
| AC-11 | Rolling quota/expiry/persisted-state unit tests and cross-process workspace quota checks. |
| AC-12 | Separate external collection remains active during real PowerShell debugging. A never-returning restart command is simulated and bounded, retaining the pending-command lock. A genuinely unresponsive Editor Services process is not separately reproduced. |
| AC-13 | Real notify-only and disable/enable; persisted disable checked in a fresh Desktop process. |
| AC-14 | Explicit environment guard and unsupported-resolver tests. No real SSH, WSL, container or browser session is qualified. |
| AC-15 | One batch collector per controller iteration, non-overlap unit test, 256-process/255-terminal-root caps with explicit partial results, 200 historical collections and the 20 largest processes per record, rotated-file tests, real short integration sessions. Long-duration stability and attributable memory overhead remain unqualified. |
| AC-16 | Installed VSIX on Stable 1.144.0 and Insiders 1.145.0-insider, activation, user settings, status, diagnostics and verified restart. |

## Remaining limits

- **Ordinary pwsh monitoring works without Microsoft PowerShell activation.** Only automatic Editor Services restart association is restricted to Microsoft release **2026.1.2**; other versions remain measurable with alerts.
- The proposed stabilized **<50 MiB attributable memory overhead** has not been established. A recorded 10,000-snapshot heap probe is short, noisy and runs in a shared host; it is not an overhead benchmark.
- Interactive command activity is unknown. An Editor Services restart may interrupt an editor command even when no debugger is active. Ordinary terminals and nested pwsh are never automatically restarted or terminated.
- Ownership must remain verifiable from current-window terminal or extension-host roots. Detached/orphaned processes with a missing parent chain cannot be safely associated. Unverified owned roots are reported as partial collection, not zero memory.
- Real access-denied behavior, long-duration idle runs, a truly unresponsive Editor Services target and shared-profile multi-window behavior require additional scenarios.
- No global process kill, automatic forced target termination, profile edit, administrative elevation, external publication or real machine-RAM saturation is performed by the product.

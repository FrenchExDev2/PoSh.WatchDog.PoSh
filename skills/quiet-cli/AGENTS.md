# QuietCli usage instructions

Read these rules at the start of each new task. Then consult only the relevant workflow in [SKILL.md](SKILL.md). These instructions apply to the installed runtime; the root AGENTS.md governs repository development.

## Announce each command

Every executed block starts with an English PowerShell comment before any statement:

```powershell
# Objective: Describe the concrete result expected.
```

Add one comment per distinct action, including reads, searches, tests and container transport.

## Working rules

1. **Define the answer.** Establish the question, scope, units, unknowns and success evidence before execution. An unknown remains `null`.
2. **Document the executable.** Read its installed help or official documentation and check the relevant version. Arguments and parsers belong in contracts, without a central catalogue in the engine.
3. **Load the runtime.** Require PowerShell **7.6+ Core**; current qualification covers Linux. Import explicitly in a profile-free session and reuse loaded modules. The skill alone installs nothing.
4. **Choose an explicit analysis.** Run native commands through `quiet`, `pump` or the QuietCli APIs inside a contract. Supply a factory, applicable module or callback. `Unsupported` does not authorize discovery by execution, even with `-Record`.
5. **Set the inputs.** Specify the working directory for file or repository observations. Place QuietCli options before the executable and native arguments after it, without a shell command string. For a native separator: `quiet [options] -- executable arguments -- paths`.
6. **Bound callbacks.** Emit business values, inspect both streams and truncated records, and create fresh state for each call. A native timeout cannot interrupt arbitrary synchronous callback code.
7. **Check before consuming.** Inspect `Outcome`, `Completeness.Source` and `Completeness.Analysis` before Data. Also require `Completeness.Capture` for Parse/replay and any evidence required by the contract. Declare expected exit codes in `SuccessExitCodes` rather than discarding an error.
8. **Keep data local.** Assign `-AsObject` to a variable. Deliver through `Out-QuietResult` or `ConvertTo-QuietJson`; never print or serialize the full result, Capture, Internal or callbacks. Check delivery truncation.
9. **Preserve failures.** Tasks automatically account for calls assigned to variables. Success does not prove business completeness. Never retry automatically; read bounded diagnostics first.
10. **Check evidence.** Require a nonempty `RecordId` before any targeted read or replay. A RECORD can expire; an incomplete or lossy capture cannot certify replay. Replayed contracts remain executable PowerShell code, without a sandbox.
11. **Reuse and measure honestly.** Generate from explicit sources and independent assertions, validate, then install on request. Keep profiles/versions, estimates and unknowns separate; output reduction measures neither billing nor total agent cost.
12. **Respect scope.** The wrapper authorizes no additional installation, hook, publication, elevation or network operation. Masking cannot guarantee detection of every secret. GitHub workflows produce distribution artifacts.

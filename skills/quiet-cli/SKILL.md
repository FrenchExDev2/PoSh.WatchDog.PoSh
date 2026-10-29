---
name: quiet-cli
description: Analyze documented commands with QuietCli, deliver a bounded business answer, and reuse evidence through contracts, RECORD and replay.
---

# Use QuietCli

Read [AGENTS.md](AGENTS.md), then the relevant section below. This skill does not require a full read on every call. The runtime chooses neither executable arguments nor the business answer: the agent establishes both from documentation and the relevant version.

## Choose a workflow

| Situation | Action | Section |
| --- | --- | --- |
| First use | Load an available module; install nothing implicitly. | [Get started](#get-started) |
| One-off stream analysis | Direct OnOutput callback with bounded state. | [One-off analysis](#one-off-analysis) |
| JSON document or another complete format | Parse with a complete capture. | [Reusable analysis](#reusable-analysis) |
| Compose several observations | Task or Execute contract; preserve failures from consumed calls. | [Composition](#composition) |
| Recurring analysis | Explicit factory, independent assertions, validated module. | [Module](#generate-a-module) |
| Evidence already retained | Read a window or replay rather than rerun the executable. | [Replay](#replay-a-record) |
| Unsupported | Read the documentation and define/extend the contract before another execution. | [Failures](#handle-failures) |

Current qualification covers **Linux, PowerShell 7.6+ Core**. The manifest defines the module version, not the historical "V2" label. The skill alone installs nothing. Import compiles the C# types using PowerShell; the runtime requires no separate .NET SDK.

## Get started

Prerequisite: the module is already available through PSModulePath. For a checkout or extracted ZIP, first import its manifest using an explicit path; do not infer that path from a separately copied skill folder.

<!-- quiet-example: bootstrap -->
```powershell
# Objective: Load the available runtime and locate its distributed instructions.
Import-Module FrenchExDev.QuietCli.PoSh -DisableNameChecking -ErrorAction Stop
$moduleRoot = (Get-Module FrenchExDev.QuietCli.PoSh).ModuleBase
$instructions = Get-QuietAgentInstruction
```

Get-QuietAgentInstruction rereads exactly `skills/quiet-cli/AGENTS.md` as UTF-8, without caching or summarizing it. Missing or unreadable files fail explicitly. Repository instructions remain at its root; they are not distributed as usage instructions.

Define the question, scope, units and invariants before calling. Read installed help or official sources for relevant arguments, formats and versions. QuietCli has no executable catalogue, argument grammar or version matrix. Keep `Get-Help ... -Full` in a variable instead of printing lengthy raw help.

## One-off analysis

Prerequisite: `bootstrap`. This example is self-contained after import; it uses no file input or network. The callback receives `($output, $state)` for stdout and stderr. Text, Stream, Sequence and Truncated describe the observed record.

<!-- quiet-example: stream -->
```powershell
# Objective: Count both streams and refuse to certify incomplete counts.
$state = @{ Stdout = 0; Stderr = 0 }
$result = quiet -AsObject -WorkingDirectory $moduleRoot -State $state -OnOutput {
    param($output, $state)
    if ($output.Truncated) { throw 'Truncated record.' }
    if ($output.Stream -eq 'stdout') { $state.Stdout++ }
    elseif ($output.Stream -eq 'stderr') { $state.Stderr++ }
} -Complete {
    param($state, $capture)
    @{ StdoutRecords = $state.Stdout; StderrRecords = $state.Stderr }
} pwsh -NoProfile -Command '[Console]::WriteLine("ok"); [Console]::Error.WriteLine("diagnostic")'
if ($result.Outcome -ne 'Success' -or !$result.Completeness.Source -or !$result.Completeness.Analysis) {
    $result | Out-QuietResult
    return
}
$result | ConvertTo-QuietJson -MaxOutputBytes 2048
```

Stderr alone does not imply failure. Complete receives `($state, $capture)` and replaces intermediate emissions as Data; without Complete, those emissions become Data. Callbacks emit business values only. OnBatch currently receives an array containing one record; no larger batch size is guaranteed.

### Observe a specific repository

Prerequisites: `bootstrap`, available Git, and `$repository` supplied as an explicit repository path. The example fails when that input is missing; it does not implicitly observe the repository in the current directory.

<!-- quiet-example: git-path -->
```powershell
# Objective: Observe the requested path in the explicitly supplied repository.
if ([string]::IsNullOrWhiteSpace($repository)) { throw 'Set $repository explicitly.' }
$repository = (Resolve-Path -LiteralPath $repository -ErrorAction Stop).ProviderPath
$gitContract = Join-Path $moduleRoot 'examples/contracts/Git.Status.ps1'
$gitResult = quiet -AsObject -WorkingDirectory $repository -ContractPath $gitContract -- git status -- 'src/a file.cs'
if ($gitResult.Outcome -ne 'Success' -or !$gitResult.Completeness.Source -or !$gitResult.Completeness.Analysis) {
    $gitResult | Out-QuietResult
    return
}
$gitResult | Out-QuietResult
```

Place QuietCli options before the executable and native arguments after it. PowerShell consumes the first `--`: to send one to the executable, also place one before the executable. This applies to quiet, pump and their module-qualified names. Splat native arrays after the executable; for named parameters, use hashtable splatting with the advanced Invoke-QuietCli API.

## API option scope

quiet and pump share their engine. A native API option is not automatically a wrapper option. Yes cells indicate declared parameters; consult Get-Help for types, parameter sets and values.

| Parameters | quiet / pump | Invoke-QuietCli | New-QuietContract |
| --- | --- | --- | --- |
| `Parse`, `OnOutput`, `OnBatch`, `State`, `Complete`, `Projection` | Yes | Yes | Yes |
| `WorkingDirectory`, `TimeoutSeconds`, `MaxCaptureBytes`, `CancellationToken`, `CancellationFile`, `InputText` | Yes | Yes | No |
| `SuccessExitCodes`, `Environment`, `Encoding`, `RecordDelimiter`, `StdErrDelimiter` | No | Yes | Yes |
| `Record` | Yes | Yes | No |
| `SourcePath`, `Documentation`, `SupportedForms`, `Execute` | No | No | Yes |
| `Summary`, `ObservedVersion` | No | Yes | Yes |

WorkingDirectory comes from the contract invocation. Limits and stdin apply to execution, not contract construction. Inside an Execute contract, pass appropriate limits to internal calls; the engine cannot interrupt arbitrary synchronous callback code.

Only exit code zero is accepted by default. Declare additional codes from the command documentation; do not routinely turn every nonzero code into success. This educational example explicitly requests code 7:

<!-- quiet-example: expected-exit -->
```powershell
# Objective: Explicitly declare the expected code for this educational command.
$expectedExit = Invoke-QuietCli -FilePath pwsh -ArgumentList @('-NoProfile','-Command','exit 7') -WorkingDirectory $moduleRoot -SuccessExitCodes @(0,7) -Parse {
    param($capture)
    @{ ObservedExitCode = $capture.ExitCode }
}
if ($expectedExit.Outcome -ne 'Success' -or !$expectedExit.Completeness.Source -or !$expectedExit.Completeness.Analysis) {
    $expectedExit | Out-QuietResult
    return
}
$expectedExit | Out-QuietResult
```

## Reusable analysis

Prerequisite: `bootstrap`. A factory receives FilePath, ArgumentList and WorkingDirectory. It constructs a fresh contract without launching a command; additional native observations, including version probes, belong in Execute.

Copy the following block into `Sample.Json.ps1`, then supply its path as `$factoryPath`. It covers **one exact pwsh command form**, not all of PowerShell: the known producer emits Count=3, Name=sample and its actual version as JSON. [about_pwsh](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_pwsh) documents NoProfile and Command.

<!-- quiet-example: factory-json -->
```powershell
# Objective: Construct a contract for a documented, narrowly scoped educational JSON command.
param([hashtable]$Invocation)
$producer = '@{ Count = 3; Name = "sample"; Version = $PSVersionTable.PSVersion.ToString() } | ConvertTo-Json -Compress'
$words = @($Invocation.ArgumentList)
if ([IO.Path]::GetFileNameWithoutExtension($Invocation.FilePath) -ne 'pwsh' -or $words.Count -ne 3 -or $words[0] -cne '-NoProfile' -or $words[1] -cne '-Command' -or $words[2] -cne $producer) {
    return New-QuietResult -Outcome Unsupported -Summary 'Command form outside the educational contract.' -Execution @{ ExitCode = $null }
}
New-QuietContract -Id 'pwsh.sample.json' -FilePath $Invocation.FilePath -ArgumentList $words -Parse {
    param($capture)
    $document = $capture.Stdout | ConvertFrom-Json -ErrorAction Stop
    if ($null -eq $document.Count -or $document.Count -lt 0 -or !$document.Name -or !$document.Version) {
        throw 'Incomplete JSON document.'
    }
    @{ Count = [int]$document.Count; Name = [string]$document.Name; PowerShellVersion = [string]$document.Version }
} -SourcePath @($PSCommandPath) -Documentation @('https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_pwsh') -SupportedForms @('pwsh -NoProfile -Command <fixed JSON producer>')
```

Parse requires a complete capture. A streaming factory would use OnOutput or OnBatch, fresh state and optionally Complete. Declare sources, documentation and supported forms; captures do not establish semantics. For closure helpers, declare dependencies and capture their CommandInfo or use a module scope.

### Execute and retain evidence

Prerequisites: `bootstrap` and `$factoryPath` pointing to the file above. Business success is checked before Data; the code also requires a complete capture and an identifier before claiming replayable evidence.

<!-- quiet-example: record -->
```powershell
# Objective: Execute the explicit contract and verify that usable evidence was retained.
if ([string]::IsNullOrWhiteSpace($factoryPath) -or !(Test-Path -LiteralPath $factoryPath -PathType Leaf)) {
    throw 'Set $factoryPath to Sample.Json.ps1.'
}
$factoryPath = (Resolve-Path -LiteralPath $factoryPath).ProviderPath
$nativeArguments = @('-NoProfile','-Command','@{ Count = 3; Name = "sample"; Version = $PSVersionTable.PSVersion.ToString() } | ConvertTo-Json -Compress')
$recordedResult = quiet -AsObject -WorkingDirectory (Split-Path -Parent $factoryPath) -Record -ContractPath $factoryPath pwsh @nativeArguments
if ($recordedResult.Outcome -ne 'Success' -or !$recordedResult.Completeness.Source -or !$recordedResult.Completeness.Analysis) {
    $recordedResult | Out-QuietResult
    return
}
if (!$recordedResult.Completeness.Capture) { throw 'Insufficient capture for replay.' }
if ([string]::IsNullOrWhiteSpace([string]$recordedResult.RecordId)) {
    throw 'RECORD unavailable: the observation succeeded, but no read or replay may follow.'
}
$recordedResult | Out-QuietResult
```

A storage failure can leave the observation successful with no RecordId. Do not substitute a list of other records. All RECORDs, including explicit ones, remain subject to retention: they are not permanent backups.

## Replay a record

Prerequisites: a successful `record` workflow and the same factory. The following guard precedes **every read**, because Get-QuietRecord without Id lists recent evidence.

<!-- quiet-example: replay -->
```powershell
# Objective: Read the targeted evidence and recompute its data without rerunning the native producer.
if ($null -eq $recordedResult -or $recordedResult.Outcome -ne 'Success' -or !$recordedResult.Completeness.Source -or !$recordedResult.Completeness.Analysis -or !$recordedResult.Completeness.Capture) {
    throw 'Replay requires a successful and complete observation.'
}
$id = [string]$recordedResult.RecordId
if ([string]::IsNullOrWhiteSpace($id)) { throw 'RECORD unavailable: do not read or replay.' }
if ([string]::IsNullOrWhiteSpace($factoryPath) -or !(Test-Path -LiteralPath $factoryPath -PathType Leaf)) { throw 'Replay factory is missing.' }
Get-QuietRecord -Id $id -Stream stdout -SourceIndex 0 -From 1 -Lines 5
$replayed = Invoke-QuietRecord -Id $id -ContractPath $factoryPath -AsObject
if ($replayed.Outcome -ne 'Success' -or !$replayed.Completeness.Source -or !$replayed.Completeness.Analysis) {
    $replayed | Out-QuietResult
    return
}
$replayed | Out-QuietResult
```

From starts at 1, SourceIndex at 0; Grep is a regular expression. Unknown or expired identifiers fail. Native calls through QuietCli consume matching recorded calls; they are not relaunched. Execute must consume the expected sequence. Streaming requires a complete journal of observed order; that order does not guarantee the original write order across stdout and stderr.

The replayed contract remains executable PowerShell code, without a sandbox. Lossy captures, missing dependencies or sources altered by masking prevent the relevant certifications or promotions.

## Generate a module

Prerequisites: the previous evidence, explicit sources and independent assertions. Copy this block into `Sample.Assertions.ps1` and supply its path as `$assertionPath`. Expectations come from the prepared producer, not from copying the candidate output.

<!-- quiet-example: assertions -->
```powershell
# Objective: Check independent invariants of the educational producer.
param($Cases)
if ($Cases.Count -ne 1) { throw 'One observation expected.' }
$actual = $Cases[0].Actual
if ($actual.Outcome -ne 'Success' -or $actual.Data.Count -ne 3 -or $actual.Data.Name -cne 'sample' -or [version]$actual.Data.PowerShellVersion -lt [version]'7.6') {
    throw 'The contract does not match the known producer.'
}
```

Also set `$moduleOutput` to a new destination. This block generates and validates; it does not install a module.

<!-- quiet-example: module -->
```powershell
# Objective: Generate a consumer from its sources and evidence, then validate its assertions.
if ($null -eq $recordedResult -or $recordedResult.Outcome -ne 'Success' -or [string]::IsNullOrWhiteSpace([string]$recordedResult.RecordId)) { throw 'Explicit evidence required.' }
if ([string]::IsNullOrWhiteSpace($assertionPath) -or !(Test-Path -LiteralPath $assertionPath -PathType Leaf)) { throw 'Independent assertions required.' }
if ([string]::IsNullOrWhiteSpace($moduleOutput)) { throw 'Set a new $moduleOutput destination.' }
$generated = New-QuietModule -Command pwsh -ContractPath $factoryPath -RecordId $recordedResult.RecordId -AssertionPath $assertionPath -OutputPath $moduleOutput
$validation = Test-QuietModule -Path $generated.Path -AsObject
$validation | Out-QuietResult
if ($validation.Outcome -ne 'Success') { throw 'Module not validated: do not install.' }
```

Install-QuietModule is a separate operation, performed on request: it checks the hash, rejects conflicts/existing destinations and changes only QuietCli files and configuration. No profile is modified. Test-QuietModule requires IncludeLiveTests for native tests. The Git consumer remains a separate module, without a copy bundled in the runtime.

## Composition

Invoke-QuietTask composes several observations; Invoke-QuietStep adds a name. Results assigned to variables remain accounted for, and their failures do not disappear when the task consumes Data. An Execute contract receives the original invocation; each factory creates fresh state.

If a child emits another JSON envelope, check its inner outcome and completeness before Data: exit code zero and valid JSON do not certify its operation.

## Present a bounded view

Keep complete results in variables. Never print or serialize Capture, Internal or callbacks. A projection must remain pure and preserve local data.

<!-- quiet-example: projection -->
```powershell
# Objective: Keep 1500 values locally and present a window with its total.
$complete = New-QuietResult -Data @{ Total = 1500; Entries = @(1..1500) } -Projection {
    param($data, $limits)
    Limit-QuietProjection -Data $data -Property Entries -MaxItems $limits.MaxItems
}
$complete | Out-QuietResult -AsJson -MaxItems 3 -MaxOutputBytes 2048
```

Projection receives Data and the limits. Out-QuietResult protects and bounds delivery; ConvertTo-QuietJson forces JSON, and AsYaml selects YAML. The compact format omits defaults; Envelope full retains them. Outcome, the three Completeness fields and Truncation carry distinct information. Business completeness always requires the contract's own scope, units and evidence.

## Handle failures

| Signal | Interpretation and action |
| --- | --- |
| Unsupported / ContractNotFound | No applicable contract; document/extend the form before another execution. |
| NativeFailed | The contract rejects the native exit code; read bounded diagnostics without discarding the error. |
| ParserFailed / FinalizerFailed | Incorrect analysis or finalization; do not certify partial Data. |
| CaptureLimit | Parse requires a complete capture; narrow the source or choose documented streaming. |
| RecordLimit / lossy decoding | Records or characters were lost; analysis or replay cannot be certified. |
| RecordUnavailable or empty RecordId | The observation may succeed without retained evidence; stop targeted reads/replay. |
| Timeout / Cancelled | Report the interruption and unknowns; never retry automatically. |
| OutputBudget / MetadataLimit | Delivery is limited; local Data may remain complete. Narrow the projection/window. |

## Settings and advanced operations

Current defaults: 20 presented items, 4096 delivered UTF-8 bytes, 600 seconds per native call, 10485760 bytes retained separately per stream and journal, 65536 characters per record, and 20 excerpt lines per stream. Consult Get-QuietConfiguration for effective values. Streaming can continue after retention fills, with limits reported; Parse and replay retain their requirements.

Configuration: `~/.quietcli/config.json` or QUIETCLI_CONFIG_PATH. Database: `~/.quietcli/gain.sqlite3` or QUIETCLI_DB_PATH. Retention: 200 RECORDs and 30 days by default. QUIETCLI_TRACKING=0 disables measurement; QUIETCLI_RECALL=0 disables automatic recall, not explicit Record; QUIETCLI_TOKENIZER=off disables token counting. No setting discovers contracts.

Captures own their temporary files; release them after use through Capture.Dispose when needed. Masking removes known secrets from delivery and evidence, without an exhaustive guarantee.

QuietCliGain offers Object, Json, Text, Chart and Html; Browse explicitly opens HTML. Get-QuietAudit describes known and unknown durations; Measure-QuietContract compares compatible deliveries through replay. Bundled tokenizers are o200k_base and cl100k_base. Do not mix profiles/versions with historical estimates or confuse delivered volume, local duration and provider billing.

Hooks are optional: Install-QuietHook and Uninstall-QuietHook target an explicit file and support WhatIf. Invoke-QuietHook inspects without evaluating; modes are off, warn, deny and restricted rewrite with approval. Get-QuietSession measures lexical adoption in JSONL files, not business validity.

The wrapper authorizes no additional installation, network operation, profile change, hook, elevation or publication. GitHub workflows produce published ZIPs and packages.

## Project instruction references

`Add-QuietAgentInstruction` copies the distributed instructions into the project's `.skills/` directory by default and references them from explicitly selected Markdown files:

Prerequisites: import QuietCli and supply an existing project directory (./project in this example).

<!-- quiet-example: project-instructions -->
```powershell
# Objective: Copy QuietCli instructions and reference them from the three project files.
$result = Add-QuietAgentInstruction -Path ./project -Claude -Agents -Skills
$result | Out-QuietResult

# Objective: Preview storing the workflow in a custom directory and referencing it from both agent files.
$result = Add-QuietAgentInstruction -Path ./project -Claude -Agents -Document Skill -DocumentDirectory instructions/quietcli -WhatIf
$result | Out-QuietResult

# Objective: Refresh the copies at the paths already referenced by the project instruction files.
$result = Update-QuietAgentInstruction -Path ./project
$result | Out-QuietResult
```

`-Path` must be an existing filesystem directory and defaults to the current directory. At least one of `-Claude`, `-Agents` or `-Skills` must be enabled; these switches can be combined.

`-DocumentDirectory` selects where both document copies are stored and defaults to `.skills`. Relative destinations resolve against `-Path`, independently of the current directory. An absolute destination is accepted when it shares a filesystem root with the project; generated references remain relative. For example, `-DocumentDirectory skills/quiet-cli` uses `./skills/quiet-cli/SKILL.md`, and `-DocumentDirectory instructions/quietcli` uses `./instructions/quietcli/SKILL.md`.

| Switch | Project file | Local document with default directory and `-Document Auto` |
| --- | --- | --- |
| `-Claude` | `CLAUDE.md` | `./.skills/AGENTS.md` |
| `-Agents` | `AGENTS.md` | `./.skills/AGENTS.md` |
| `-Skills` | `SKILLS.md` | `./.skills/SKILL.md` |

`-Document Auto` is the default. `-Document Agents` or `-Document Skill` overrides the source for every selected file. `SKILLS.md` is a project Markdown file; this command does not install a native agent skill.

Both documents are copied byte for byte because they reference each other. The managed files `AGENTS.md` and `SKILL.md` in the configured directory are refreshed from the loaded module on subsequent calls. Unchanged copies are not rewritten. Keep these copies with the project so the references work after moving it to another directory or host. If you explicitly choose a sibling directory, preserve that relative layout when moving the project. Changing the destination updates the managed reference blocks and leaves previous copies in place.

`CLAUDE.md` and `AGENTS.md` receive an explicit instruction to read and apply the local document, followed by `@./.skills/AGENTS.md` or `@./.skills/SKILL.md` by default, outside code blocks. Spaces in configured paths are escaped for Claude imports. `SKILLS.md` receives a Markdown link to the relative document with its destination enclosed in angle brackets. The generated blocks contain relative paths, with no absolute module or host path. Claude expands supported imports; other agents follow the explicit reading instruction. Existing QuietCli blocks are updated to reference the configured destination on the next call.

The command creates missing selected files and manages only the block between `<!-- quietcli:instructions:begin -->` and `<!-- quietcli:instructions:end -->`. Existing UTF-8 text outside that block, its BOM and line endings are preserved. New reference files use UTF-8 without a BOM and platform line endings. All source documents, copy destinations and target delimiters are checked before writing. A destination that would copy a document over a selected target is rejected; preflight failures leave existing files untouched.

The command supports `-WhatIf` and `-Confirm`. Simulation creates neither the configured directory nor any files. If copying a document is declined, new references are skipped. Keep the QuietCli result locally, then deliver it with `Out-QuietResult` or `ConvertTo-QuietJson`. `Data.Files` reports `Path`, `Document`, `SourcePath` (the local copy), `ReferencePath` (the relative reference) and `Status`. `Data.Documents` reports `Path`, `Document` and `Status` for both managed copies. Status is `Created`, `Updated`, `Unchanged`, `Simulated` under `-WhatIf`, or `Skipped` when confirmation is declined.

Update-QuietAgentInstruction discovers existing references instead of requiring DocumentDirectory again. It reads the managed QuietCli blocks in AGENTS.md, CLAUDE.md and SKILLS.md, recognizes local Markdown links, angle paths and Claude imports, and refreshes both AGENTS.md and SKILL.md beside each referenced document. For example, a reference to ./skills/quiet-cli/SKILL.md updates the pair in skills/quiet-cli, including a missing copy. Duplicate destinations are processed once; different configured directories are supported.

With no target switches, the update command inspects the existing supported files and skips files without a QuietCli block. Claude, Agents and Skills switches restrict the selected project files; an explicitly selected missing file or unmanaged file fails. The project instruction files and their reference paths are preserved byte for byte. WhatIf simulates document changes. Data.Files reports the inspected files and references; Data.Documents reports the copied-document statuses.

All references, sources and destinations are checked before writing. Malformed blocks, absent references or distributed sources, remote or absolute references, and destinations conflicting with a managed project instruction file fail explicitly. References outside the QuietCli block and code examples are ignored. Updates use relative paths resolved beside their containing file; no imported text is executed. Use Add-QuietAgentInstruction to install or change the reference blocks themselves.

## References

[README](../../README.md), [function help](../../src/README.md), [complete Git contract](../../examples/contracts/Git.Status.ps1) and [maintenance scripts](../../scripts/README.md). Read the relevant API help for details instead of loading every reference.

The identified examples above are checked by `test/Documentation.Tests.ps1`, included in the runner called by the workflows. Prerequisites are prepared in temporary directories; tests also cover expected failures, without building ZIPs or publishing.

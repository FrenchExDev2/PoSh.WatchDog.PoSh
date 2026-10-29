# Objective: Verify independent ownership invariants on a prepared process graph, including PID reuse and editor boundaries.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../scripts/Select-WindowProcesses.ps1')
function New-ProcessFixture([int]$Id, [int]$Parent, [string]$Name, [int]$Age = 10, [string]$Executable = '') {
    [pscustomobject]@{ ProcessId = $Id; ParentProcessId = $Parent; Name = $Name
        CreationDate = ([DateTime]'2026-10-29T00:00:00Z').AddSeconds($Age); ExecutablePath = $Executable }
}
$editorPath = 'C:\Code\Code.exe'
$graph = @(
    (New-ProcessFixture 10 0 'Code.exe' 0 $editorPath),
    (New-ProcessFixture 11 10 'Code.exe' 1 $editorPath),
    (New-ProcessFixture 12 11 'pwsh.exe'),
    (New-ProcessFixture 20 10 'Code.exe' 1 $editorPath),
    (New-ProcessFixture 30 20 'pwsh.exe'),
    (New-ProcessFixture 31 20 'cmd.exe'),
    (New-ProcessFixture 32 31 'pwsh.exe' 11),
    (New-ProcessFixture 33 32 'pwsh.exe' 12),
    (New-ProcessFixture 40 30 'pwsh.exe' 12),
    (New-ProcessFixture 50 20 'pwsh.exe'),
    (New-ProcessFixture 60 30 'Code.exe' 11 $editorPath),
    (New-ProcessFixture 61 60 'pwsh.exe' 12),
    (New-ProcessFixture 70 80 'pwsh.exe' 11),
    (New-ProcessFixture 80 30 'cmd.exe' 20),
    (New-ProcessFixture 90 91 'pwsh.exe'),
    (New-ProcessFixture 91 90 'cmd.exe'),
    (New-ProcessFixture 99 11 'pwsh.exe')
)
$actual = @(Select-WindowPowerShellProcess -Processes $graph -RootProcessIds @(11, 30, 31) -EditorExecutable $editorPath -ExcludedProcessId 99)
$ids = @($actual | ForEach-Object { $_.Process.ProcessId } | Sort-Object)
if (($ids -join ',') -cne '12,30,32,33,40') { throw "Wrong selection: $($ids -join ',')" }
if (@(Select-WindowPowerShellProcess -Processes $graph -RootProcessIds @(11, 30, 31) -EditorExecutable 'C:\Other\Code.exe' -ExcludedProcessId 99).Count -ne 0) { throw 'Executable mismatch accepted.' }
if (@(Select-WindowPowerShellProcess -Processes $graph -RootProcessIds @() -EditorExecutable $editorPath -ExcludedProcessId 99).Count -ne 0) { throw 'Unowned process accepted.' }
$ownershipErrors = [Collections.Generic.List[object]]::new()
$null = Select-WindowPowerShellProcess -Processes $graph -RootProcessIds @(11, 30, 31) -EditorExecutable 'C:\Other\Code.exe' -ExcludedProcessId 99 -OwnershipErrors $ownershipErrors
if (!$ownershipErrors.Count -or $ownershipErrors[0].code -ne 'ownershipUnverified') { throw 'Unverified ownership was silently reported as an empty complete inventory.' }
$rootedChild = $actual | Where-Object { $_.Process.ProcessId -eq 33 }
if ($rootedChild.RootProcessId -ne 31) { throw 'Wrong terminal ownership root.' }
@{ passed = 9; selected = $ids; cases = @('terminal', 'nested pwsh', 'non-pwsh terminal', 'extension host child', 'other window', 'new editor boundary', 'reused parent PID', 'cycle and collector exclusion', 'unverified ownership is explicit') } | ConvertTo-Json -Compress

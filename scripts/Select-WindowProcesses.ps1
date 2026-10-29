# Objective: Select pwsh processes owned by this window without crossing another VS Code host boundary.
function Select-WindowPowerShellProcess {
    param([object[]]$Processes, [int[]]$RootProcessIds, [string]$EditorExecutable, [int]$ExcludedProcessId,
        [Collections.Generic.List[object]]$OwnershipErrors)
    $byId = @{}
    foreach ($entry in $Processes) { $byId[[int]$entry.ProcessId] = $entry }
    $roots = [Collections.Generic.HashSet[int]]::new()
    foreach ($rootId in $RootProcessIds) { [void]$roots.Add($rootId) }
    foreach ($entry in $Processes) {
        if ($entry.Name -ine 'pwsh.exe' -or [int]$entry.ProcessId -eq $ExcludedProcessId) { continue }
        $cursor = $entry
        $seen = [Collections.Generic.HashSet[int]]::new()
        $owned = $false
        $wasSelected = $false
        $rootId = 0
        for ($depth = 0; $cursor -and $depth -lt 128; $depth++) {
            if (!$seen.Add([int]$cursor.ProcessId)) { break }
            if ($roots.Contains([int]$cursor.ProcessId)) { $owned = $true; $rootId = [int]$cursor.ProcessId }
            # The first Code process is the ownership boundary. Never walk through a different editor host.
            if ($cursor.Name -iin @('Code.exe', 'Code - Insiders.exe')) {
                if ($owned -and $cursor.ExecutablePath -ieq $EditorExecutable) {
                    $wasSelected = $true
                    [pscustomobject]@{ Process = $entry; RootProcessId = $rootId }
                }
                break
            }
            $parent = $byId[[int]$cursor.ParentProcessId]
            if (!$parent -or !$cursor.CreationDate -or !$parent.CreationDate -or $parent.CreationDate -gt $cursor.CreationDate) { break }
            $cursor = $parent
        }
        if ($owned -and !$wasSelected -and $null -ne $OwnershipErrors -and $OwnershipErrors.Count -lt 256) {
            $OwnershipErrors.Add([pscustomobject]@{ pid = [int]$entry.ProcessId; code = 'ownershipUnverified' })
        }
    }
}

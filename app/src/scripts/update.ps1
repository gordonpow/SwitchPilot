param(
    [Parameter(Mandatory = $true)][string]$WaitPids,
    [Parameter(Mandatory = $true)][string]$Target,
    [Parameter(Mandatory = $true)][string]$NewFile,
    [Parameter(Mandatory = $true)][string]$LogFile,
    [switch]$NoLaunch,
    [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'

function Write-Log([string]$message) {
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss.fff")
    $logLine = "[$timestamp] $message"
    try {
        $logDir = Split-Path -Parent $LogFile
        if ($logDir -and -not (Test-Path -LiteralPath $logDir)) {
            [System.IO.Directory]::CreateDirectory($logDir) | Out-Null
        }
        Add-Content -LiteralPath $LogFile -Value $logLine -Encoding UTF8
    } catch {
        Write-Host $logLine
    }
}

function Test-FileUnlocked([string]$filePath) {
    if (-not (Test-Path -LiteralPath $filePath)) {
        return $true
    }
    try {
        $file = [System.IO.File]::Open($filePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)
        if ($file) {
            $file.Close()
            $file.Dispose()
            return $true
        }
    } catch {
        return $false
    }
    return $false
}

function Remove-FileQuiet([string]$filePath) {
    # Delete a file if it exists; clear the read-only attribute first. Never throws.
    try {
        if (Test-Path -LiteralPath $filePath -PathType Leaf) {
            [System.IO.File]::SetAttributes($filePath, [System.IO.FileAttributes]::Normal)
            [System.IO.File]::Delete($filePath)
        }
    } catch {
        Write-Log "Warning: could not delete $filePath : $_"
    }
}

function Get-FileSize([string]$filePath) {
    return (New-Object System.IO.FileInfo($filePath)).Length
}

function Start-TargetProcess([string]$exePath) {
    if ($NoLaunch) {
        Write-Log "NoLaunch specified. Skipping process launch for $exePath"
        return
    }
    if (-not (Test-Path -LiteralPath $exePath)) {
        Write-Log "Cannot start executable, file does not exist: $exePath"
        return
    }
    $workDir = Split-Path -Parent $exePath
    Write-Log "Launching executable: $exePath in directory: $workDir"
    try {
        Start-Process -FilePath $exePath -WorkingDirectory $workDir
    } catch {
        Write-Log "Failed to start executable $exePath : $_"
    }
}

Write-Log "Update process started. Target: $Target, NewFile: $NewFile, WaitPids: $WaitPids, Timeout: ${TimeoutSeconds}s"

# Parse WaitPids
$pidList = @()
if ($WaitPids) {
    foreach ($p in ($WaitPids -split ',')) {
        $trimmed = $p.Trim()
        if ($trimmed -match '^\d+$') {
            $pidList += [int]$trimmed
        }
    }
}

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$timedOut = $false

# Step 0: Wait for WaitPids to exit
foreach ($procId in $pidList) {
    Write-Log "Waiting for process PID $procId to exit..."
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if (-not $proc) {
            Write-Log "Process PID $procId exited."
            break
        }
        Start-Sleep -Milliseconds 500
    }
    if ($sw.Elapsed.TotalSeconds -ge $TimeoutSeconds) {
        $timedOut = $true
        Write-Log "Timed out while waiting for PID $procId."
        break
    }
}

# Wait for Target file to unlock
if (-not $timedOut) {
    Write-Log "Checking if Target file is unlocked..."
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        if (Test-FileUnlocked $Target) {
            Write-Log "Target file is unlocked."
            break
        }
        Start-Sleep -Milliseconds 1000
    }
    if ($sw.Elapsed.TotalSeconds -ge $TimeoutSeconds) {
        $timedOut = $true
        Write-Log "Timed out waiting for Target file to unlock."
    }
}

if ($timedOut) {
    Write-Log "Timeout exceeded ($TimeoutSeconds s). Aborting update without modifying files."
    if (-not $NoLaunch) {
        if (Test-FileUnlocked $Target) {
            Write-Log "Target is unlocked. Launching existing executable."
            Start-TargetProcess $Target
        } else {
            Write-Log "Target file is still locked. Cannot launch."
        }
    }
    exit 1
}

# Check existence of Target and NewFile
if (-not (Test-Path -LiteralPath $Target)) {
    Write-Log "Target file does not exist: $Target. Aborting."
    exit 2
}
if (-not (Test-Path -LiteralPath $NewFile)) {
    Write-Log "NewFile does not exist: $NewFile. Aborting."
    exit 3
}

$targetDir = Split-Path -Parent $Target
$targetName = [System.IO.Path]::GetFileName($Target)
$targetOld = "$Target.old"
$targetNew = Join-Path $targetDir ($targetName + ".new")

# Step 1: Backup Target to Target.old and verify size
Write-Log "Step 1: Backing up $Target to $targetOld"
try {
    Remove-FileQuiet $targetOld
    [System.IO.File]::Copy($Target, $targetOld, $true)
    $targetSize = Get-FileSize $Target
    $oldSize = Get-FileSize $targetOld
    if ($targetSize -ne $oldSize) {
        throw "Size mismatch after backup ($targetSize vs $oldSize)"
    }
    Write-Log "Backup verified (size: $oldSize bytes)."
} catch {
    Write-Log "Step 1 failed: $_. Aborting without modifying Target."
    Remove-FileQuiet $targetNew
    Start-TargetProcess $Target
    exit 2
}

# Step 2: Copy NewFile to Target.new and verify size
Write-Log "Step 2: Staging NewFile to $targetNew"
try {
    Remove-FileQuiet $targetNew
    [System.IO.File]::Copy($NewFile, $targetNew, $true)
    $newFileSize = Get-FileSize $NewFile
    $stagedSize = Get-FileSize $targetNew
    if ($newFileSize -ne $stagedSize) {
        throw "Size mismatch after staging ($newFileSize vs $stagedSize)"
    }
    Write-Log "Staging verified (size: $stagedSize bytes)."
} catch {
    Write-Log "Step 2 failed: $_. Target remains unmodified."
    Remove-FileQuiet $targetNew
    Start-TargetProcess $Target
    exit 4
}

# Step 3: Move Target.new to Target with up to 10 retries
Write-Log "Step 3: Moving $targetNew to $Target (up to 10 retries)"
$moveSuccess = $false
for ($i = 1; $i -le 10; $i++) {
    try {
        # File.Replace swaps atomically and has no wildcard parsing
        [System.IO.File]::Replace($targetNew, $Target, [NullString]::Value)
        $moveSuccess = $true
        Write-Log "Move succeeded on attempt $i."
        break
    } catch {
        Write-Log "Move attempt $i failed: $_. Retrying in 1s..."
        Start-Sleep -Seconds 1
    }
}

# Step 4: Finalize or restore
if ($moveSuccess) {
    Write-Log "Step 4: Update succeeded. Deleting temporary NewFile: $NewFile"
    try {
        Remove-FileQuiet $NewFile
    } catch {
        Write-Log "Warning: Failed to delete NewFile $NewFile : $_"
    }
    Write-Log "Update applied successfully."
    Start-TargetProcess $Target
    exit 0
} else {
    Write-Log "Step 4: Move failed after 10 retries. Restoring Target from $targetOld"
    Remove-FileQuiet $targetNew
    $restoreSuccess = $false
    try {
        try {
            [System.IO.File]::Copy($targetOld, $Target, $true)
        } catch {
            Write-Log "Restore copy failed: $_. Clearing read-only attribute and retrying."
            [System.IO.File]::SetAttributes($Target, [System.IO.FileAttributes]::Normal)
            [System.IO.File]::Copy($targetOld, $Target, $true)
        }
        $restoredSize = Get-FileSize $Target
        $backupSize = Get-FileSize $targetOld
        if ($restoredSize -ne $backupSize) {
            throw "Size mismatch after restore ($restoredSize vs $backupSize)"
        }
        $restoreSuccess = $true
        Write-Log "Restored Target from $targetOld successfully (size: $restoredSize bytes)."
    } catch {
        Write-Log "CRITICAL: Restore failed: $_. Backup is located at: $targetOld"
    }

    if ($restoreSuccess) {
        Start-TargetProcess $Target
        exit 5
    } else {
        Write-Log "FATAL: Update failed and restoration failed. Backup preserved at $targetOld"
        exit 6
    }
}

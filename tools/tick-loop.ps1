Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'  # Continue on errors to keep loop running

$repoRoot = Split-Path -Parent $PSScriptRoot
$schedulerDir = Join-Path $repoRoot 'scheduler'

while ($true) {
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    try {
        Push-Location $schedulerDir
        $status = npm run --silent tick 2>&1
        Write-Host "[$timestamp] $status"
    } catch {
        Write-Host "[$timestamp] ERROR: $_"
    } finally {
        Pop-Location
    }
    Start-Sleep -Seconds 30
}

<#
  obs_pull_configs.ps1

  PURPOSE: **One-way pull** of safe OBS Studio configs **from the local machine** into this git repo.
           This script NEVER writes to the OBS source directory—only reads from it—
           and copies into ./obs/<sheet>/configs in the repo.

  Usage:
    # pull for sheet-c
    powershell -ExecutionPolicy Bypass -File tools\obs_pull_configs.ps1 -Sheet sheet-c

    # list known sheets
    powershell -ExecutionPolicy Bypass -File tools\obs_pull_configs.ps1 -List

  Notes:
    - The target (repo) folder is cleared before copy so deletions in OBS propagate to git.
    - Stream keys are protected: known secret-carrying files (e.g., service.json) are removed.
    - Add more sheets to $SheetMap as they come online.
#>

[CmdletBinding()]
param(
  [string]$Sheet = "",
  [switch]$List
)

$ErrorActionPreference = "Stop"

# --- Map each sheet to its OBS config folder on that machine ---
#    Find this path via: $env:APPDATA\obs-studio
$SheetMap = @{
  "sheet-c" = "C:\\Users\\Matt Weiss\\AppData\\Roaming\\obs-studio"
  # "sheet-a" = "C:\\Users\\YOURUSER\\AppData\\Roaming\\obs-studio"
  # "sheet-b" = "C:\\Users\\YOURUSER\\AppData\\Roaming\\obs-studio"
}

if ($List) {
  Write-Host "Known sheets and OBS source paths:`n"
  $SheetMap.GetEnumerator() | Sort-Object Key | ForEach-Object {
    "{0}`t{1}" -f $_.Key, $_.Value
  }
  exit 0
}

if (-not $Sheet) { throw "Please pass -Sheet <name>. Try -List to see options." }
if (-not $SheetMap.ContainsKey($Sheet)) {
  throw "Unknown sheet '$Sheet'. Add it to `$SheetMap in tools\obs_pull_configs.ps1 or run with -List."
}

# --- Resolve paths ---
# Repo root is one level up from this script's folder
$RepoRoot  = (Resolve-Path "$PSScriptRoot\..").Path
$ObsSrc    = $SheetMap[$Sheet]
$TargetDir = Join-Path $RepoRoot ("obs\" + $Sheet + "\configs")

# Safety: ensure target lives inside the repo
if (-not ($TargetDir -like ($RepoRoot + '*'))) {
  throw "Refusing to operate: target '$TargetDir' is not within repo root '$RepoRoot'."
}

# Validate source exists and *never* write to it
if (!(Test-Path $ObsSrc)) { throw "OBS config not found: $ObsSrc" }

# Create target path
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

# --- What we copy (safe only) ---
$ToCopy = @(
  "basic\scenes",      # scene collections (JSON)
  "basic\profiles",    # profiles (encoders/audio/output)
  "basic\basic.ini",   # basic ini
  "global.ini"          # global settings
)

# --- Clear current repo configs so removals propagate ---
#     This *only* touches the repo target directory, not the OBS source.
Get-ChildItem $TargetDir -Force | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

# --- Copy safe files from OBS -> repo ---
foreach ($rel in $ToCopy) {
  $src = Join-Path $ObsSrc $rel
  if (Test-Path $src) {
    $dst = Join-Path $TargetDir $rel
    New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
    Copy-Item -Path $src -Destination $dst -Recurse -Force
  }
}

# --- Belt & suspenders: ensure stream keys didn't slip in ---
Get-ChildItem -Path $TargetDir -Recurse -Filter "service.json" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

# Optional: strip any file containing a likely stream service block
# (commented out; enable if needed)
# Get-ChildItem -Path $TargetDir -Recurse -Include *.json,*.ini |
#   Where-Object { Select-String -Path $_.FullName -Quiet -Pattern 'stream|rtmp|key\s*=' } |
#   Remove-Item -Force -ErrorAction SilentlyContinue

Write-Host "✅ Pulled OBS config for '$Sheet'"
Write-Host "   Source : $ObsSrc"
Write-Host "   Target : $TargetDir"
Write-Host ""
Write-Host "Next: review with 'git status' and commit/push manually."

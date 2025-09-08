<# obs_pull_configs.ps1  (simple, no basic.ini)

   Usage examples:
     # list known sheets
     powershell -ExecutionPolicy Bypass -File tools\obs_pull_configs.ps1 -List

     # pull configs from sheet-c
     powershell -ExecutionPolicy Bypass -File tools\obs_pull_configs.ps1 -Sheet sheet-c
#>

param(
  [string]$Sheet = "",
  [switch]$List
)

$ErrorActionPreference = "Stop"

# Map each sheet to its OBS config folder
$SheetMap = @{
  "sheet-c" = "C:\Users\Matt Weiss\AppData\Roaming\obs-studio"
  # Add other sheets here:
  # "sheet-a" = "C:\Users\<User>\AppData\Roaming\obs-studio"
}

if ($List) {
  Write-Host "Known sheets and source paths:`n"
  $SheetMap.GetEnumerator() | Sort-Object Key | ForEach-Object {
    "{0}`t{1}" -f $_.Key, $_.Value
  }
  exit 0
}

if (-not $Sheet) { throw "Please pass -Sheet <name>. Try -List to see options." }
if (-not $SheetMap.ContainsKey($Sheet)) { throw "Unknown sheet '$Sheet'. Add it to `$SheetMap." }

# Resolve repo root and target
$RepoRoot  = (Resolve-Path "$PSScriptRoot\..").Path
$ObsSrc    = $SheetMap[$Sheet]
$TargetDir = Join-Path $RepoRoot ("obs\" + $Sheet + "\configs")

if (!(Test-Path $ObsSrc)) { throw "OBS config not found: $ObsSrc" }
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

# Only copy the safe parts (scenes and profiles)
$ToCopy = @(
  "basic\scenes",
  "basic\profiles"
)

# Remove current configs so deletions propagate
Get-ChildItem $TargetDir -Force | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

# Copy scenes and profiles
foreach ($rel in $ToCopy) {
  $src = Join-Path $ObsSrc $rel
  if (Test-Path $src) {
    $dst = Join-Path $TargetDir $rel
    New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
    Copy-Item -Path $src -Destination $dst -Recurse -Force
  }
}

# Remove basic.ini if it somehow slipped in
$basicIni = Join-Path $TargetDir "basic\basic.ini"
if (Test-Path $basicIni) {
  Remove-Item $basicIni -Force
}

Write-Host "✅ Pulled OBS config for '$Sheet' (basic.ini removed)"
Write-Host "   Source : $ObsSrc"
Write-Host "   Target : $TargetDir"
Write-Host ""
Write-Host "Check with 'git status' and commit manually."

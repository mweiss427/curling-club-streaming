<# obs_pull_configs.ps1  (safe version)

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

# -- Map each sheet to its OBS config folder --
$SheetMap = @{
  "sheet-c" = "C:\Users\Matt Weiss\AppData\Roaming\obs-studio"
  # Add other sheets here as they come online:
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

# -- Resolve repository path and target --
$RepoRoot  = (Resolve-Path "$PSScriptRoot\..").Path
$ObsSrc    = $SheetMap[$Sheet]
$TargetDir = Join-Path $RepoRoot ("obs\" + $Sheet + "\configs")

if (!(Test-Path $ObsSrc)) { throw "OBS config not found: $ObsSrc" }
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

# -- What we copy (safe only, excluding basic/basic.ini) --
$ToCopy = @(
  "basic\scenes",    # scene collections (JSON)
  "basic\profiles"   # profiles (encoders/audio/output)
)

# Copy `global.ini` if present; on Windows Explorer it appears as "global"
if (Test-Path (Join-Path $ObsSrc "global.ini")) {
  $ToCopy += "global.ini"
} elseif (Test-Path (Join-Path $ObsSrc "global")) {
  $ToCopy += "global"
}

# -- Clear current configs so removals propagate --
Get-ChildItem $TargetDir -Force | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

# -- Copy safe files/folders --
foreach ($rel in $ToCopy) {
  $src = Join-Path $ObsSrc $rel
  if (Test-Path $src) {
    $dst = Join-Path $TargetDir $rel
    New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
    Copy-Item -Path $src -Destination $dst -Recurse -Force
  }
}

# -- Remove any stray service.json (stream keys) that might sneak in --
Get-ChildItem -Path $TargetDir -Recurse -Filter "service.json" -ErrorAction SilentlyContinue |
  Remove-Item -Force -ErrorAction SilentlyContinue

# -- Sanitize any .ini files (e.g., global.ini or profile INIs) --
function Sanitize-IniFile {
  param([string]$Path)
  if (!(Test-Path $Path)) { return }
  $lines  = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 -ErrorAction Stop
  $lines  = $lines -split "`r?`n"
  $output = New-Object System.Collections.Generic.List[string]
  $skipSection = $false
  foreach ($line in $lines) {
    $trim = $line.Trim()

    # Section boundaries
    if ($trim -match '^\s*\[(.+?)\]\s*$') {
      $sectionName = $Matches[1]
      # Drop any [YouTube*] sections entirely (contain OAuth tokens and base64 dock state)
      if ($sectionName -match '^YouTube') {
      $skipSection = $true
      continue
      } else {
      $skipSection = $false
      }
    }

    if ($skipSection) { continue }

    # Redact token-ish keys generically anywhere (case-insensitive)
    $redacted = $line `
      -replace '(?i)(\b(RefreshToken|AccessToken|Token|ClientSecret|Secret|ApiKey|Cookie(ID)?|Auth(Token)?|Oauth(Token)?)\s*=\s*).+$', '$1REDACTED' `
      -replace '(?i)(\b(ExpireTime|Expiry|Expires|IssuedAt)\s*=\s*).+$', '$1REDACTED'

    $output.Add($redacted)
  }
  [System.IO.File]::WriteAllLines($Path, $output, [System.Text.Encoding]::UTF8)
}

Get-ChildItem -Path $TargetDir -Recurse -Include *.ini -File |
  ForEach-Object { Sanitize-IniFile -Path $_.FullName }

Write-Host "✅ Pulled OBS config for '$Sheet' (secrets stripped)"
Write-Host "   Source : $ObsSrc"
Write-Host "   Target : $TargetDir"
Write-Host ""
Write-Host "Review with 'git status' and commit manually."

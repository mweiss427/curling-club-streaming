<# pull-obs-configs.ps1  (simple, keeps basic.ini, scrubs secrets)

  Usage examples:
    # default: scrub repo obs folder
    powershell -ExecutionPolicy Bypass -File tools\pull-obs-configs.ps1

    # list known sheets
    powershell -ExecutionPolicy Bypass -File tools\pull-obs-configs.ps1 -List

    # pull configs from sheet-c
    powershell -ExecutionPolicy Bypass -File tools\pull-obs-configs.ps1 -Sheet sheet-c

    # scrub all secrets under repo obs folder (no copy)
    powershell -ExecutionPolicy Bypass -File tools\pull-obs-configs.ps1 -ScrubRepo

    # scrub a specific path
    powershell -ExecutionPolicy Bypass -File tools\pull-obs-configs.ps1 -ScrubPath .\obs\sheet-c\configs
#>

param(
  [string]$Sheet = "",
  [switch]$List,
  [switch]$ScrubRepo,
  [string]$ScrubPath = ""
)

$ErrorActionPreference = "Stop"

# Scrub helpers
function Scrub-FileSecrets {
  param([Parameter(Mandatory=$true)][string]$Path)

  $text = Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue
  if ($null -eq $text) { return }

  $orig = $text

  # JSON-like fields
  $text = [regex]::Replace($text, '(?i)\"(access_?token|refresh_?token|id_?token|token|api_?key|client_?secret|client_?id|stream_?key|key|authorization|password|bearer|cookie|cookieid)\"\s*:\s*\".*?\"', '"$1": "REDACTED"')

  # INI-like key=value
  $text = [regex]::Replace($text, '(?im)^(\s*)(key|stream_?key|token|access_?token|refresh_?token|api_?key|client_?secret|client_?id|authorization|password|cookie|cookieid)\s*=\s*.*$', '${1}$2=REDACTED')

  if ($text -ne $orig) {
    $text | Set-Content -LiteralPath $Path -Encoding UTF8
  }
}

function Scrub-DirectorySecrets {
  param([Parameter(Mandatory=$true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) { return }
  Get-ChildItem -LiteralPath $Path -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in '.json', '.ini', '.txt', '.yml', '.yaml' } |
    ForEach-Object { Scrub-FileSecrets -Path $_.FullName }
}

# Map each sheet to its OBS config folder
$SheetMap = @{
  "sheet-c" = "C:\Users\Matt Weiss\AppData\Roaming\obs-studio"
  "sheet-a" = "C:\Users\Matt Weiss\AppData\Roaming\obs-studio"
}

if ($List) {
  Write-Host "Known sheets and source paths:`n"
  $SheetMap.GetEnumerator() | Sort-Object Key | ForEach-Object {
    "{0}`t{1}" -f $_.Key, $_.Value
  }
  exit 0
}

# Default to scrub repo obs folder when no args are provided
if (($Sheet -eq "") -and (-not $List) -and (-not $ScrubRepo) -and ($ScrubPath -eq "")) {
  $ScrubRepo = $true
}
# Scrub-only mode (keeps basic.ini, scrubs secrets under obs or provided path)
if ($ScrubRepo -or ($ScrubPath -and $ScrubPath -ne "")) {
  $RepoRoot  = (Resolve-Path "$PSScriptRoot\..\").Path
  $PathToScrub = if ($ScrubPath -and $ScrubPath -ne "") { (Resolve-Path -LiteralPath $ScrubPath).Path } else { Join-Path $RepoRoot "obs" }
  Write-Host "🧹 Scrubbing secrets under: $PathToScrub"
  Scrub-DirectorySecrets -Path $PathToScrub
  Write-Host "✅ Scrub complete"
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
  "basic\profiles",
  "basic\basic.ini"
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

# Ensure secrets are scrubbed from copied configs (including basic.ini)
Scrub-DirectorySecrets -Path $TargetDir

Write-Host "✅ Pulled OBS config for '$Sheet' (secrets scrubbed)"
Write-Host "   Source : $ObsSrc"
Write-Host "   Target : $TargetDir"
Write-Host ""
Write-Host "Check with 'git status' and commit manually."

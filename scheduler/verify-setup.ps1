Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

Write-Host "=== Verification Checklist ===" -ForegroundColor Cyan
Write-Host ""

# 1. Check YouTube OAuth authentication
Write-Host "1. Checking YouTube OAuth authentication..." -ForegroundColor Yellow
npm run dev yt-auth-status
if ($LASTEXITCODE -ne 0) {
    Write-Host "   ❌ YouTube OAuth authentication failed!" -ForegroundColor Red
} else {
    Write-Host "   ✅ YouTube OAuth OK" -ForegroundColor Green
}
Write-Host ""

# 2. Check stream key/ID configuration
Write-Host "2. Checking YouTube stream configuration..." -ForegroundColor Yellow
npm run dev yt-streams -- --all
if ($LASTEXITCODE -ne 0) {
    Write-Host "   ❌ Failed to list streams!" -ForegroundColor Red
} else {
    Write-Host "   ✅ Stream listing OK" -ForegroundColor Green
}
Write-Host ""

# 3. Check calendar access
Write-Host "3. Checking calendar access..." -ForegroundColor Yellow
npm run dev status-one
if ($LASTEXITCODE -ne 0) {
    Write-Host "   ❌ Calendar access failed!" -ForegroundColor Red
} else {
    Write-Host "   ✅ Calendar access OK" -ForegroundColor Green
}
Write-Host ""

# 4. Check upcoming events
Write-Host "4. Checking upcoming events (next 24 hours)..." -ForegroundColor Yellow
npm run dev list-one -- --days 1 --max 5
if ($LASTEXITCODE -ne 0) {
    Write-Host "   ❌ Failed to list events!" -ForegroundColor Red
} else {
    Write-Host "   ✅ Event listing OK" -ForegroundColor Green
}
Write-Host ""

# 5. Check environment variables
Write-Host "5. Checking critical environment variables..." -ForegroundColor Yellow
$requiredVars = @('SHEET_KEY', 'YOUTUBE_STREAM_KEY', 'YOUTUBE_OAUTH_CREDENTIALS', 'YOUTUBE_TOKEN_PATH', 'GOOGLE_APPLICATION_CREDENTIALS')
$missing = @()
foreach ($var in $requiredVars) {
    if (-not $env:$var) {
        $missing += $var
        Write-Host "   ❌ $var not set" -ForegroundColor Red
    } else {
        Write-Host "   ✅ $var is set" -ForegroundColor Green
    }
}
if ($missing.Count -eq 0) {
    Write-Host "   ✅ All required environment variables are set" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Missing: $($missing -join ', ')" -ForegroundColor Yellow
}
Write-Host ""

# 6. Verify stream key matches
Write-Host "6. Verifying stream key matches available streams..." -ForegroundColor Yellow
if ($env:YOUTUBE_STREAM_KEY) {
    $streamsOutput = npm run dev yt-streams 2>&1
    if ($streamsOutput -match "No live streams found matching stream key") {
        Write-Host "   ❌ Stream key '$env:YOUTUBE_STREAM_KEY' not found!" -ForegroundColor Red
        Write-Host "   Run: npm run dev yt-streams -- --all" -ForegroundColor Yellow
    } else {
        Write-Host "   ✅ Stream key found in available streams" -ForegroundColor Green
    }
} else {
    Write-Host "   ⚠️  YOUTUBE_STREAM_KEY not set, skipping check" -ForegroundColor Yellow
}
Write-Host ""

# 7. Test tick command (dry run - won't start OBS)
Write-Host "7. Testing tick command (should not start OBS if no event)..." -ForegroundColor Yellow
Write-Host "   (This will show if tick can run successfully)" -ForegroundColor Gray
npm run dev tick 2>&1 | Select-Object -First 20
Write-Host ""

Write-Host "=== Verification Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  - If all checks pass, you're ready for the test event" -ForegroundColor Green
Write-Host "  - Fix any ❌ errors before the event starts" -ForegroundColor Red
Write-Host "  - Monitor with: npm run dev status-one" -ForegroundColor Cyan


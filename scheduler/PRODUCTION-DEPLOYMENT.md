# Production Deployment Guide - All 4 Sheets

This guide covers deploying the scheduler to production on all 4 sheets (A, B, C, D), each running independently on separate machines.

## Prerequisites

Each machine must have:
- Windows 10 or later
- Node.js 20+ installed
- OBS Studio installed
- Network access to Google Calendar API and YouTube Data API

## Configuration Requirements

Each sheet machine needs its own `.env` file in the `scheduler` directory with the following variables:

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `SHEET_KEY` | Sheet identifier (A, B, C, or D) | `A` |
| `CALENDAR_ID` | Google Calendar ID for this sheet | `c_...@group.calendar.google.com` |
| `YOUTUBE_STREAM_ID` | YouTube Live Stream ID (or use `YOUTUBE_STREAM_KEY`) | `abcdef1234567890` |
| `YOUTUBE_OAUTH_CREDENTIALS` | Path to YouTube OAuth client JSON | `C:\\path\\to\\youtube.credentials.json` |
| `YOUTUBE_TOKEN_PATH` | Path to stored OAuth token JSON | `C:\\path\\to\\youtube.token.json` |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to Google service account JSON | `C:\\path\\to\\streaming.key.json` |
| `OBS_EXE` | Path to OBS executable | `C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe` |
| `OBS_PROFILE` | OBS profile name | `Untitled` |
| `OBS_COLLECTION` | OBS scene collection name | `Static Game Stream` |
| `OBS_WEBSOCKET_PASSWORD` | OBS websocket password | `your_password_here` |

### Optional Environment Variables

- `YOUTUBE_STREAM_KEY` - Alternative to `YOUTUBE_STREAM_ID`, uses stream key lookup
- `YOUTUBE_TOKEN_PATH` - Can be omitted if using default path

## Deployment Steps

### 1. Initial Setup on Each Machine

```powershell
# Clone or pull the repository
cd C:\path\to\curling-club-streaming

# Install dependencies
cd scheduler
npm ci
```

### 2. Configure Environment Variables

Create a `.env` file in the `scheduler` directory for each machine:

```ini
# Sheet identifier (REQUIRED - must be A, B, C, or D)
SHEET_KEY=A

# Calendar ID for this sheet (REQUIRED)
CALENDAR_ID=c_6e56005f7ad893b3961b9b71763ba4cea7a654153519252501edd5d2ad3e8bef@group.calendar.google.com

# YouTube configuration (REQUIRED)
YOUTUBE_STREAM_ID=your_stream_id_here
# OR use stream key instead:
# YOUTUBE_STREAM_KEY=your_stream_key_here

YOUTUBE_OAUTH_CREDENTIALS=C:\path\to\youtube.credentials.json
YOUTUBE_TOKEN_PATH=C:\path\to\youtube.token.json

# OBS configuration (REQUIRED)
OBS_EXE=C:\Program Files\obs-studio\bin\64bit\obs64.exe
OBS_PROFILE=Untitled
OBS_COLLECTION=Static Game Stream
OBS_WEBSOCKET_PASSWORD=your_obs_password

# Google Calendar service account (REQUIRED)
GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\streaming.key.json
```

**Important**: Each machine must have a different `SHEET_KEY` (A, B, C, or D) and corresponding `CALENDAR_ID`.

### 3. Authenticate with YouTube

On each machine, run the one-time OAuth setup:

```powershell
npm run yt-auth-init -- --credentials "%YOUTUBE_OAUTH_CREDENTIALS%" --token "%YOUTUBE_TOKEN_PATH%"
```

Verify the token:

```powershell
npm run yt-auth-status -- --credentials "%YOUTUBE_OAUTH_CREDENTIALS%" --token "%YOUTUBE_TOKEN_PATH%"
```

### 4. Verify Google Calendar Access

Ensure the service account has Viewer access to the calendar for each sheet:

1. Open Google Calendar
2. Go to calendar settings
3. Share the calendar with the service account email (from `streaming.key.json`)
4. Grant "See all event details" permission

### 5. Test Manual Execution

Test the tick command manually on each machine:

```powershell
npm run tick
```

Expected output: `STARTED`, `ALREADY_LIVE`, `STOPPED`, or `IDLE`

### 6. Start Continuous Loop

For testing, run the loop manually:

```powershell
npm run tick-loop
```

This runs `tick` every 30 seconds.

### 7. Production Deployment (Windows Task Scheduler)

For production, set up Windows Task Scheduler on each machine:

1. Open Task Scheduler
2. Create Basic Task
3. Name: "Curling Club Streaming - Sheet A" (adjust for each sheet)
4. Trigger: "At startup" or "On a schedule" (every minute)
5. Action: "Start a program"
   - Program: `npm.cmd`
   - Arguments: `run tick-loop`
   - Start in: `C:\path\to\curling-club-streaming\scheduler`
6. Check "Run whether user is logged on or not"
7. Configure for: Windows 10 or later

**Alternative**: Create a wrapper `.cmd` file to ensure environment variables are loaded:

```cmd
@echo off
cd /d C:\path\to\curling-club-streaming\scheduler
call npm run tick-loop
```

Then point Task Scheduler to this `.cmd` file.

## Verification Checklist

For each sheet machine, verify:

- [ ] `.env` file exists with all required variables
- [ ] `SHEET_KEY` matches the machine's sheet (A, B, C, or D)
- [ ] `CALENDAR_ID` points to the correct calendar for that sheet
- [ ] YouTube OAuth token is initialized and valid (`npm run yt-auth-status`)
- [ ] Google service account has access to the calendar
- [ ] OBS is installed and configured with the correct profile/collection
- [ ] OBS websocket password is set correctly
- [ ] Manual `npm run tick` works correctly
- [ ] `npm run tick-loop` runs without errors
- [ ] Windows Task Scheduler is configured (if using for production)

## Troubleshooting

### Lock File Issues

If you see "Lock file exists" errors:

1. Check if another `tick-loop` process is running
2. Delete `.tick-lock` file in the `scheduler` directory if the process is not running
3. The lock mechanism now automatically cleans up stale locks (processes that have died)

### YouTube API Errors

- **"Scheduled start time is required"**: Fixed - the system now always sets `scheduledStartTime`
- **"Scheduled start time must be in the future"**: Fixed - past events use current time + 2 minutes
- **OAuth token expired**: Re-run `npm run yt-auth-init` to refresh

### OBS Not Starting

- Verify `OBS_EXE` path is correct
- Check OBS profile and collection names match exactly
- Ensure OBS websocket is enabled and password is correct
- Check Windows Event Viewer for OBS startup errors

### Calendar Not Found

- Verify `CALENDAR_ID` is correct
- Ensure service account has Viewer access to the calendar
- Check `GOOGLE_APPLICATION_CREDENTIALS` path is correct

## Multi-Sheet Considerations

- Each sheet runs independently on its own machine
- Each sheet monitors its own Google Calendar
- Each sheet creates its own YouTube broadcasts (with sheet identifier in title)
- Broadcasts are automatically cleaned up if duplicates are detected
- No coordination between sheets is required - they operate independently

## Monitoring

Check logs for:
- `[INFO] Running tick for Sheet X` - confirms correct sheet is running
- `STARTED` / `ALREADY_LIVE` / `STOPPED` / `IDLE` - status output
- `[ERROR]` - any errors that need attention

Logs are output to stdout/stderr, so they'll appear in:
- Console if running manually
- Task Scheduler history if running as a service
- Log files if redirected (e.g., `npm run tick-loop > tick.log 2>&1`)


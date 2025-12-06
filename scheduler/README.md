## Scheduler (Windows, headless)

Headless scheduler that reads 4 Google Calendars (Sheets A-D) and exposes a CLI to list upcoming events. Future tasks will translate events into OBS actions.

### Setup
1. Install Node 20+. You can use the repo bootstrap:
   ```
   powershell -ExecutionPolicy Bypass -File ..\tools\bootstrap-windows.ps1
   ```
   Or manual:
   ```
   cd scheduler
   npm ci
   ```
2. Copy `env.example` (or `.env.example` if present) to `.env` and edit values.
3. Copy `config.json.example` to `config.json` and fill in the 4 calendar IDs (for multi-sheet mode).
4. Authenticate with Google (Calendar read-only):
   - Recommended: Service account with access to all 4 calendars. Set `GOOGLE_APPLICATION_CREDENTIALS` to the JSON key file path.
   - Or use any ADC-supported method on your environment.

Security tip: keep `config.json` and any credential JSON out of source control.

### Commands
- `npm run list` — list upcoming events (defaults: 7 days, max 10 per sheet)
  - Flags: `--days N`, `--max N`
- `npm run status` — print whether any sheet is LIVE now, or OFF

Single-calendar mode (useful for local testing or per-OBS PC):

- Env variables (choose one source):
  - `CALENDAR_ID=your-calendar@group.calendar.google.com`
  - `SHEET_KEY=A` (uses `scheduler/config.json` to resolve calendarId)

- Commands:
  - `npm run status-one`
  - `npm run list-one -- --days 7 --max 10`

Loop runner (Windows):

- `npm run tick-loop` — runs `tick` every 30s using environment variables (no flags needed)

### Notes
- All-day events are ignored.
- This project intentionally has no UI; Google Calendar is the UI.

### Auth and .env
- Place your service account key at `scheduler/streaming.key.json` (ignored by git).
- Create a `scheduler/.env` with either `CALENDAR_ID=...@group.calendar.google.com` or `SHEET_KEY=A`.

Additional environment variables (optional but recommended for hands-free operation):

- `YOUTUBE_STREAM_ID` or `YOUTUBE_STREAM_KEY` — target YouTube live stream
- `YOUTUBE_OAUTH_CREDENTIALS` — path to YouTube OAuth client JSON
- `YOUTUBE_TOKEN_PATH` — path to the saved OAuth token JSON (contains refresh token)
- `OBS_EXE` — Windows path to OBS executable (e.g., `C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe`)
- `OBS_PROFILE` — OBS profile name (default `Untitled`)
- `OBS_COLLECTION` — OBS scene collection (default `Static Game Stream`)

#### Example .env (Windows)

```ini
# Calendar selection (choose ONE; do not set both)
CALENDAR_ID=your-calendar@group.calendar.google.com
# or, if using config.json sheets mapping (leave CALENDAR_ID unset)
# SHEET_KEY=A

# OBS connection (Windows)
OBS_EXE=C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe
OBS_PROFILE=Untitled
OBS_COLLECTION=Static Game Stream

# YouTube binding (choose ONE)
# YOUTUBE_STREAM_ID=abcdef1234567890
YOUTUBE_STREAM_KEY=stream-name-from-ingestion-settings

# YouTube OAuth client credentials (for creating broadcasts)
YOUTUBE_OAUTH_CREDENTIALS=C:\\path\\to\\youtube.credentials.json

# Saved OAuth token (created by yt-auth-init). Required for automation. Keep this private.
YOUTUBE_TOKEN_PATH=C:\\path\\to\\youtube.token.json

# Google Calendar service account credentials (read-only)
GOOGLE_APPLICATION_CREDENTIALS=C:\\path\\to\\streaming.key.json
```

### Headless YouTube Auth (Windows)

One-time setup to enable fully hands-free daily streams:

1. Ensure you have an OAuth client JSON for the YouTube channel and set `YOUTUBE_OAUTH_CREDENTIALS`.
2. Run interactive init once on the Windows machine to save a reusable refresh token:

```
npm run yt-auth-init -- --credentials "%YOUTUBE_OAUTH_CREDENTIALS%" --token "%YOUTUBE_TOKEN_PATH%"
```

3. Verify token and channel:

```
npm run yt-auth-status -- --credentials "%YOUTUBE_OAUTH_CREDENTIALS%" --token "%YOUTUBE_TOKEN_PATH%"
```

Notes:
- 2FA is required only during this initial consent. Afterward, the stored refresh token allows headless operation.
- The token is tied to the Google account and OAuth client, not the machine. Protect both files with NTFS permissions.
- Use `npm run yt-streams` to list your Live Streams; if you copy the RTMP key, use `YOUTUBE_STREAM_KEY`. If you copy the stream id, use `YOUTUBE_STREAM_ID`.

### Running the scheduler continuously (Windows)

- Use the built-in loop (PowerShell) during testing:

```
npm run tick-loop
```

- For production, set up Windows Task Scheduler to run every minute or at login:
  - Action: `npm.cmd run tick` in the `scheduler` directory
  - Start in: `<repo>\scheduler`
  - Configure for: Windows 10 or later
  - Ensure environment variables (from `.env`) are available (use a wrapper `.cmd` file if needed)

### Troubleshooting
- If you see an auth error, confirm the key path and that the calendar is shared with the service account email (Viewer).

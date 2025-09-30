## Scheduler (headless)

Headless scheduler that reads 4 Google Calendars (Sheets A-D) and exposes a CLI to list upcoming events. Future tasks will translate events into OBS actions.

### Setup
1. Node 20+.
2. `cd scheduler && npm install`.
3. Copy `config.json.example` to `config.json` and fill in the 4 calendar IDs.
4. Authenticate with Google:
   - Recommended: Service account with access to all 4 calendars. Set `GOOGLE_APPLICATION_CREDENTIALS` to the JSON key file path.
   - Or use any ADC-supported method on your environment.

Security tip: keep `config.json` and any credential JSON out of source control.

### Commands
- `npm run list` — list upcoming events (defaults: 7 days, max 10 per sheet)
  - Flags: `--days N`, `--max N`

### Notes
- All-day events are ignored.
- This project intentionally has no UI; Google Calendar is the UI.



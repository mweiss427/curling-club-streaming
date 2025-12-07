## Calendar-driven streaming conventions

This repository manages stream schedules using Google Calendar as the single source of truth. There are four sheets; each sheet maps to a dedicated Google Calendar that defines when that sheet should be streaming.

### Calendars
- Sheet A → Calendar ID: to be configured
- Sheet B → Calendar ID: to be configured
- Sheet C → Calendar ID: to be configured
- Sheet D → Calendar ID: to be configured

You can use any human-readable calendar names in Google; the scheduler only requires the Calendar IDs.

### Event semantics
- The event start time marks when streaming for that sheet should turn ON.
- The event end time marks when streaming for that sheet should turn OFF.
- Overlapping events on the same sheet are resolved by the latest start time taking precedence, and stream remains ON until the maximum end time across overlapping events.
- All-day events are ignored.

### Optional event metadata (via extended properties)
If needed later, we can add private extended properties to events. None are required for MVP.
- `scene`: optional scene/profile name to activate in OBS for this window.
- `note`: optional free-form notes.

### Timezone
- The scheduler respects the timezone defined on each event; if absent, it falls back to the calendar's timezone.

### Minimum viable flow
1. Create four calendars (A/B/C/D) and share them with the service account (recommended) or a bot account.
2. Add events for streaming windows. Title and description are informational only.
3. The scheduler polls calendars and emits stream ON/OFF intents per sheet.
4. A downstream controller (later task) will translate intents to OBS actions.

### Configuration
Add a `scheduler/config.json` file with the following shape:

```json
{
  "timezone": "America/Chicago",
  "sheets": {
    "A": { "calendarId": "...", "obs": { "url": "ws://127.0.0.1:4455", "password": "..." } },
    "B": { "calendarId": "...", "obs": { "url": "ws://127.0.0.1:4456", "password": "..." } },
    "C": { "calendarId": "...", "obs": { "url": "ws://127.0.0.1:4457", "password": "..." } },
    "D": { "calendarId": "...", "obs": { "url": "ws://127.0.0.1:4458", "password": "..." } }
  }
}
```

Only `calendarId` is required for the initial list-events CLI; `obs` fields will be used in a later task.



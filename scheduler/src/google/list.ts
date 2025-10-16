import { google } from 'googleapis';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

const SheetKeySchema = z.enum(['A', 'B', 'C', 'D']);

const ConfigSchema = z.object({
    timezone: z.string().default('America/Chicago'),
    sheets: z.record(SheetKeySchema, z.object({
        calendarId: z.string().min(3)
    }))
});

export type SheetKey = z.infer<typeof SheetKeySchema>;

export type UpcomingEvent = {
    sheet: SheetKey;
    start: string;
    end: string;
    summary?: string;
    description?: string;
};

export type SingleEvent = {
    start: string;
    end: string;
    summary?: string;
    description?: string;
    sheet?: SheetKey;
};

function loadConfig() {
    const configPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../config.json');
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return ConfigSchema.parse(parsed);
}

function getAuth() {
    // Prefer explicit key file from env; else fall back to scheduler/streaming.key.json; else ADC
    const scopes = ['https://www.googleapis.com/auth/calendar.readonly'];
    const envKey = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (envKey && fs.existsSync(envKey)) {
        return new google.auth.GoogleAuth({ keyFile: envKey, scopes });
    }
    const fallbackKey = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../streaming.key.json');
    if (fs.existsSync(fallbackKey)) {
        return new google.auth.GoogleAuth({ keyFile: fallbackKey, scopes });
    }
    return new google.auth.GoogleAuth({ scopes });
}

export type CalendarClient = ReturnType<typeof google.calendar>;
export type ListDeps = {
    now?: () => Date;
    configLoader?: () => z.infer<typeof ConfigSchema>;
    calendarClient?: CalendarClient;
};

export async function listUpcoming(opts: { days: number; max: number }, deps: ListDeps = {}): Promise<UpcomingEvent[]> {
    const config = (deps.configLoader ?? loadConfig)();
    const nowFn = deps.now ?? (() => new Date());
    const now = nowFn();
    const calendar = deps.calendarClient ?? google.calendar({ version: 'v3', auth: getAuth() });

    const maxTime = new Date(now.getTime() + opts.days * 24 * 60 * 60 * 1000);

    const results: UpcomingEvent[] = [];

    for (const sheetKey of Object.keys(config.sheets) as SheetKey[]) {
        const calendarId = config.sheets[sheetKey]?.calendarId;
        if (!calendarId) continue;
        const resp = await calendar.events.list({
            calendarId,
            timeMin: now.toISOString(),
            timeMax: maxTime.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: opts.max
        });

        const items = resp.data.items ?? [];
        for (const ev of items) {
            if (ev.start?.date || ev.end?.date) {
                continue; // ignore all-day events
            }
            const start = ev.start?.dateTime ?? '';
            const end = ev.end?.dateTime ?? '';
            results.push({ sheet: sheetKey, start, end, summary: ev.summary ?? undefined, description: ev.description ?? undefined });
        }
    }

    return results;
}


export async function listCurrent(deps: ListDeps = {}): Promise<UpcomingEvent[]> {
    const config = (deps.configLoader ?? loadConfig)();
    const nowFn = deps.now ?? (() => new Date());
    const now = nowFn();
    const calendar = deps.calendarClient ?? google.calendar({ version: 'v3', auth: getAuth() });

    // Bound the query window to reduce payload; we'll filter to strictly "now"
    const timeMax = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const results: UpcomingEvent[] = [];

    for (const sheetKey of Object.keys(config.sheets) as SheetKey[]) {
        const calendarId = config.sheets[sheetKey]?.calendarId;
        if (!calendarId) continue;
        const resp = await calendar.events.list({
            calendarId,
            timeMin: now.toISOString(),
            timeMax: timeMax.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 10
        });

        const items = resp.data.items ?? [];
        for (const ev of items) {
            if (ev.start?.date || ev.end?.date) {
                continue; // ignore all-day events
            }
            const startStr = ev.start?.dateTime ?? '';
            const endStr = ev.end?.dateTime ?? '';
            if (!startStr || !endStr) continue;

            const startDt = new Date(startStr);
            const endDt = new Date(endStr);
            if (startDt <= now && now <= endDt) {
                results.push({ sheet: sheetKey, start: startStr, end: endStr, summary: ev.summary ?? undefined });
            }
        }
    }

    return results;
}

function resolveCalendarIdFromSheet(sheetKey: SheetKey, cfg: z.infer<typeof ConfigSchema>): string {
    const sheetCfg = cfg.sheets[sheetKey];
    if (!sheetCfg?.calendarId) {
        throw new Error(`calendarId not found for sheet ${sheetKey}`);
    }
    return sheetCfg.calendarId;
}

function resolveSingleSourceFromEnv(): { calendarId?: string; sheetKey?: SheetKey } | undefined {
    const envCalendarId = process.env.CALENDAR_ID?.trim();
    const envSheet = process.env.SHEET_KEY?.trim() as SheetKey | undefined;
    if (envCalendarId) return { calendarId: envCalendarId };
    if (envSheet && ['A', 'B', 'C', 'D'].includes(envSheet)) return { sheetKey: envSheet };
    return undefined;
}

export async function listUpcomingSingle(
    opts: { days: number; max: number },
    source?: { calendarId?: string; sheetKey?: SheetKey },
    deps: ListDeps = {}
): Promise<SingleEvent[]> {
    const nowFn = deps.now ?? (() => new Date());
    const now = nowFn();
    const calendar = deps.calendarClient ?? google.calendar({ version: 'v3', auth: getAuth() });

    const resolvedSource = source ?? resolveSingleSourceFromEnv();
    if (!resolvedSource || (!resolvedSource.calendarId && !resolvedSource.sheetKey)) {
        throw new Error('Provide a calendarId or sheetKey (or set CALENDAR_ID / SHEET_KEY env vars).');
    }

    let calendarId: string;
    if (resolvedSource.calendarId) {
        calendarId = resolvedSource.calendarId;
    } else {
        const config = (deps.configLoader ?? loadConfig)();
        calendarId = resolveCalendarIdFromSheet(resolvedSource.sheetKey as SheetKey, config);
    }
    const maxTime = new Date(now.getTime() + opts.days * 24 * 60 * 60 * 1000);

    const resp = await calendar.events.list({
        calendarId,
        timeMin: now.toISOString(),
        timeMax: maxTime.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: opts.max
    });

    const events: SingleEvent[] = [];
    for (const ev of resp.data.items ?? []) {
        if (ev.start?.date || ev.end?.date) continue;
        const start = ev.start?.dateTime ?? '';
        const end = ev.end?.dateTime ?? '';
        events.push({ start, end, summary: ev.summary ?? undefined, description: ev.description ?? undefined, sheet: resolvedSource.sheetKey });
    }
    return events;
}

export async function listCurrentSingle(
    source?: { calendarId?: string; sheetKey?: SheetKey },
    deps: ListDeps = {}
): Promise<SingleEvent[]> {
    const nowFn = deps.now ?? (() => new Date());
    const now = nowFn();
    const calendar = deps.calendarClient ?? google.calendar({ version: 'v3', auth: getAuth() });

    const resolvedSource = source ?? resolveSingleSourceFromEnv();
    if (!resolvedSource || (!resolvedSource.calendarId && !resolvedSource.sheetKey)) {
        throw new Error('Provide a calendarId or sheetKey (or set CALENDAR_ID / SHEET_KEY env vars).');
    }

    let calendarId: string;
    if (resolvedSource.calendarId) {
        calendarId = resolvedSource.calendarId;
    } else {
        const config = (deps.configLoader ?? loadConfig)();
        calendarId = resolveCalendarIdFromSheet(resolvedSource.sheetKey as SheetKey, config);
    }

    const timeMax = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const resp = await calendar.events.list({
        calendarId,
        timeMin: now.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 10
    });

    const events: SingleEvent[] = [];
    for (const ev of resp.data.items ?? []) {
        if (ev.start?.date || ev.end?.date) continue;
        const startStr = ev.start?.dateTime ?? '';
        const endStr = ev.end?.dateTime ?? '';
        if (!startStr || !endStr) continue;
        const startDt = new Date(startStr);
        const endDt = new Date(endStr);
        if (startDt <= now && now <= endDt) {
            events.push({ start: startStr, end: endStr, summary: ev.summary ?? undefined, description: ev.description ?? undefined, sheet: resolvedSource.sheetKey });
        }
    }
    return events;
}



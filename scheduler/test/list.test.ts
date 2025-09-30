import { describe, it, expect } from 'vitest';
import { listUpcoming, type ListDeps, type UpcomingEvent } from '../src/google/list.js';

function makeCalendarMock(eventsByCalendarId: Record<string, any[]>): ListDeps['calendarClient'] {
    return {
        events: {
            list: async ({ calendarId }: { calendarId: string }) => {
                return { data: { items: eventsByCalendarId[calendarId] ?? [] } } as any;
            }
        }
    } as any;
}

describe('listUpcoming', () => {
    const fixedNow = new Date('2025-01-01T12:00:00Z');

    it('maps events to sheets and filters all-day events', async () => {
        const deps: ListDeps = {
            now: () => fixedNow,
            configLoader: () => ({
                timezone: 'America/Chicago',
                sheets: {
                    A: { calendarId: 'cal-a' },
                    B: { calendarId: 'cal-b' },
                    C: { calendarId: 'cal-c' },
                    D: { calendarId: 'cal-d' }
                }
            }) as any,
            calendarClient: makeCalendarMock({
                'cal-a': [
                    { start: { dateTime: '2025-01-01T13:00:00Z' }, end: { dateTime: '2025-01-01T14:00:00Z' }, summary: 'Match A' },
                    { start: { date: '2025-01-02' }, end: { date: '2025-01-03' }, summary: 'All day - ignore' }
                ],
                'cal-b': [
                    { start: { dateTime: '2025-01-01T15:00:00Z' }, end: { dateTime: '2025-01-01T16:00:00Z' }, summary: 'Match B' }
                ],
                'cal-c': [],
                'cal-d': []
            })
        };

        const events = await listUpcoming({ days: 7, max: 10 }, deps);
        const simple: Array<Pick<UpcomingEvent, 'sheet' | 'summary'>> = events.map(e => ({ sheet: e.sheet, summary: e.summary }));
        expect(simple).toEqual([
            { sheet: 'A', summary: 'Match A' },
            { sheet: 'B', summary: 'Match B' }
        ]);
    });
});



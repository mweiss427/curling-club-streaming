import { listCurrentSingle, SheetKey } from '../google/list.js';
import { createBroadcastAndBind, Privacy } from '../youtube/createBroadcast.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

export async function tick(opts: {
    sheet?: SheetKey;
    calendarId?: string;
    streamId?: string;
    streamKey?: string;
    privacy?: Privacy;
    obsExe?: string;
    obsProfile?: string;
    obsCollection?: string;
    credentialsPath?: string;
}): Promise<'STARTED' | 'ALREADY_LIVE' | 'STOPPED' | 'IDLE'> {
    const privacy = opts.privacy ?? 'public';
    const obsExe =
        opts.obsExe ??
        (fs.existsSync('C:/Program Files/obs-studio/bin/64bit/obs64.exe')
            ? 'C:/Program Files/obs-studio/bin/64bit/obs64.exe'
            : 'C:/Program Files (x86)/obs-studio/bin/64bit/obs64.exe');
    const profile = opts.obsProfile ?? 'Untitled';
    const collection = opts.obsCollection ?? 'Static Game Stream';

    const [current] = await listCurrentSingle({ sheetKey: opts.sheet, calendarId: opts.calendarId });

    // Helper: is OBS running?
    async function isObsRunning(): Promise<boolean> {
        try {
            const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', "Get-Process obs64 -ErrorAction SilentlyContinue | Select-Object -First 1 | ForEach-Object { $_.Id }"]);
            return stdout.trim().length > 0;
        } catch {
            return false;
        }
    }

    // Helper: stop OBS gracefully
    async function stopObs(): Promise<void> {
        await execFileAsync('powershell', ['-NoProfile', '-Command', "$p=Get-Process obs64 -ErrorAction SilentlyContinue; if($p){ if($p.MainWindowHandle -ne 0){$null=$p.CloseMainWindow(); Start-Sleep -Seconds 5}; if(!$p.HasExited){ Stop-Process -Id $p.Id -Force } }"]);
    }

    // Simple state persistence to ensure one broadcast per event
    type TickState = { eventKey: string; broadcastId: string };
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const stateDir = path.resolve(moduleDir, '../../.state');
    const statePath = path.join(stateDir, 'current.json');
    const readState = (): TickState | undefined => {
        try { return JSON.parse(fs.readFileSync(statePath, 'utf8')) as TickState; } catch { return undefined; }
    };
    const writeState = (s: TickState): void => {
        fs.mkdirSync(stateDir, { recursive: true });
        fs.writeFileSync(statePath, JSON.stringify(s), 'utf8');
    };
    const clearState = (): void => { try { fs.unlinkSync(statePath); } catch { } };

    if (!current) {
        // No event — ensure OBS is stopped
        if (await isObsRunning()) {
            await stopObs();
            clearState();
            return 'STOPPED';
        }
        clearState();
        return 'IDLE';
    }

    // Build stable key for the current calendar event window
    const eventKey = `${current.start}|${current.end}`;
    const st = readState();

    // Construct a friendly title using event time and sheet
    const start = new Date(current.start);
    const date = start.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });
    const time = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const sheetTag = current.sheet ? ` - Sheet ${current.sheet}` : '';
    const title = `${current.summary ?? 'Untitled Event'}${sheetTag} - ${date} - ${time}`;
    const description = current.description ?? current.summary ?? undefined;

    // Ensure a broadcast is ready and bound, but only once per event
    if (!st || st.eventKey !== eventKey) {
        const broadcastId = await createBroadcastAndBind({
            title,
            description,
            privacy,
            streamId: opts.streamId,
            streamKey: opts.streamKey,
            credentialsPath: opts.credentialsPath,
            scheduledStart: current.start
        });
        writeState({ eventKey, broadcastId });
    }

    // Start OBS if not already running; the single-instance will reuse
    const running = await isObsRunning();
    const args = ['--profile', profile, '--collection', collection, '--startstreaming'];
    const obsCwd = path.dirname(obsExe);
    if (!running) {
        await execFileAsync(obsExe, args, { cwd: obsCwd });
        return 'STARTED';
    } else {
        // Nudge startstreaming; OBS will ignore if already streaming
        await execFileAsync(obsExe, ['--startstreaming'], { cwd: obsCwd });
        return 'ALREADY_LIVE';
    }
}



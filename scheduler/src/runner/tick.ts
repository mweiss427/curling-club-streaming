import { listCurrentSingle, SheetKey } from '../google/list.js';
import { createBroadcastAndBind, Privacy } from '../youtube/createBroadcast.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';

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

    if (!current) {
        // No event — ensure OBS is stopped
        if (await isObsRunning()) {
            await stopObs();
            return 'STOPPED';
        }
        return 'IDLE';
    }

    const title = current.summary ?? 'Untitled Event';
    const description = current.description ?? current.summary ?? undefined;

    // Ensure a broadcast is ready and bound
    await createBroadcastAndBind({
        title,
        description,
        privacy,
        streamId: opts.streamId,
        streamKey: opts.streamKey,
        credentialsPath: opts.credentialsPath
    });

    // Start OBS if not already running; the single-instance will reuse
    const running = await isObsRunning();
    const args = ['--profile', profile, '--collection', collection, '--startstreaming'];
    if (!running) {
        await execFileAsync(obsExe, args);
        return 'STARTED';
    } else {
        // Nudge startstreaming; OBS will ignore if already streaming
        await execFileAsync(obsExe, ['--startstreaming']);
        return 'ALREADY_LIVE';
    }
}



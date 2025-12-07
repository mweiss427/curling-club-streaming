import 'dotenv/config';
import { listCurrentSingle, SheetKey } from './google/list.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function checkObsRunning(): Promise<boolean> {
    try {
        const { stdout } = await execFileAsync('powershell', [
            '-NoProfile',
            '-Command',
            "Get-Process obs64 -ErrorAction SilentlyContinue | Select-Object -First 1 | ForEach-Object { $_.Id }"
        ]);
        return stdout.trim().length > 0;
    } catch {
        return false;
    }
}

async function diagnoseSheet(sheet: SheetKey): Promise<void> {
    console.log(`\n=== Diagnosing Sheet ${sheet} ===\n`);

    // 1. Check SHEET_KEY env var
    const envSheetKey = process.env.SHEET_KEY;
    console.log(`1. SHEET_KEY environment variable: ${envSheetKey || 'NOT SET'}`);
    if (envSheetKey !== sheet) {
        console.error(`   ❌ MISMATCH: Should be "${sheet}" but is "${envSheetKey}"`);
    } else {
        console.log(`   ✅ Correct`);
    }

    // 2. Check for current calendar events
    console.log(`\n2. Checking for current calendar events...`);
    try {
        const events = await listCurrentSingle({ sheetKey: sheet });
        if (events.length === 0) {
            console.error(`   ❌ No current events found`);
            console.error(`   This means no events are in the "current" time window (start <= now <= end)`);
        } else {
            console.log(`   ✅ Found ${events.length} current event(s):`);
            events.forEach((ev, i) => {
                console.log(`      Event ${i + 1}: "${ev.summary}"`);
                console.log(`         Start: ${ev.start}`);
                console.log(`         End: ${ev.end}`);
                const startDt = new Date(ev.start);
                const endDt = new Date(ev.end);
                const now = new Date();
                console.log(`         Status: ${now < startDt ? 'Upcoming' : now > endDt ? 'Ended' : 'Current'}`);
            });
        }
    } catch (e: any) {
        console.error(`   ❌ Error checking calendar: ${e.message}`);
    }

    // 3. Check if OBS is running
    console.log(`\n3. Checking if OBS is running...`);
    const obsRunning = await checkObsRunning();
    console.log(`   ${obsRunning ? '✅' : '❌'} OBS is ${obsRunning ? 'running' : 'NOT running'}`);

    // 4. Check OBS websocket (if password is set)
    const wsPass = process.env.OBS_WEBSOCKET_PASSWORD;
    if (wsPass) {
        console.log(`\n4. Checking OBS websocket connection...`);
        try {
            // Try to get stream status
            const { exec } = await import('node:child_process');
            const { promisify } = await import('node:util');
            const execAsync = promisify(exec);
            const schedulerDir = process.cwd();
            const nodeDir = process.execPath.replace(/\\[^\\]+$/, '');
            const npxCmdPath = `${nodeDir}\\npx.cmd`;
            const command = `"${npxCmdPath}" --yes --prefix "${schedulerDir}" obs-cli -- --host 127.0.0.1 --port 4455 --password "${wsPass}" GetStreamStatus --json`;
            const { stdout } = await execAsync(command, { timeout: 3000 });
            const status = JSON.parse(stdout.trim());
            console.log(`   ✅ Websocket connected`);
            console.log(`   Stream status: ${status.outputActive ? 'ACTIVE' : 'INACTIVE'}`);
        } catch (e: any) {
            console.error(`   ❌ Websocket connection failed: ${e.message}`);
            if (obsRunning) {
                console.error(`   Note: OBS is running but websocket is not responding. OBS may still be starting up.`);
            }
        }
    } else {
        console.log(`\n4. OBS_WEBSOCKET_PASSWORD not set - skipping websocket check`);
    }

    // 5. Check state file
    console.log(`\n5. Checking state file...`);
    const fs = await import('node:fs');
    const path = await import('node:path');
    const statePath = path.resolve(process.cwd(), '.state', `current-${sheet}.json`);
    if (fs.existsSync(statePath)) {
        try {
            const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
            console.log(`   ✅ State file exists`);
            console.log(`   Broadcast ID: ${state.broadcastId || 'N/A'}`);
            console.log(`   Event Key: ${state.eventKey || 'N/A'}`);
            if (state.expectedStreamKey) {
                console.log(`   Expected Stream Key: ${state.expectedStreamKey.substring(0, 20)}...`);
            }
        } catch (e: any) {
            console.error(`   ❌ Error reading state file: ${e.message}`);
        }
    } else {
        console.log(`   ⚠️  No state file found (this is normal if no events have been processed yet)`);
    }

    console.log(`\n=== End of Sheet ${sheet} diagnosis ===\n`);
}

async function main(): Promise<void> {
    const sheet = (process.env.SHEET_KEY as SheetKey | undefined) || process.argv[2] as SheetKey | undefined;
    if (!sheet || !['A', 'B', 'C', 'D'].includes(sheet)) {
        console.error('Usage: tsx src/diagnose-sheet.ts [A|B|C|D]');
        console.error('Or set SHEET_KEY environment variable');
        process.exit(1);
    }

    await diagnoseSheet(sheet);
}

main().catch((err) => {
    console.error('Diagnosis failed:', err);
    process.exit(1);
});

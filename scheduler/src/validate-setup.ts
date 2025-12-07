import 'dotenv/config';
import { getSheetConfig, SheetKey } from './google/list.js';
import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

async function checkObsStreamKey(wsPass: string): Promise<string | null> {
    try {
        const schedulerDir = process.cwd();
        const wsHost = '127.0.0.1';
        const wsPort = '4455';

        // Use npx to run obs-cli
        const nodeDir = path.dirname(process.execPath);
        const npxCmdPath = path.join(nodeDir, 'npx.cmd');
        const npxCommand = fs.existsSync(npxCmdPath) ? npxCmdPath : 'npx.cmd';

        const npxOptions = ['--yes', '--prefix', schedulerDir];
        const settingsArgs = [
            '--host', wsHost,
            '--port', wsPort,
            '--password', wsPass,
            'GetStreamServiceSettings',
            '--json'
        ];

        const escapeArg = (arg: string): string => `"${arg.replace(/"/g, '""')}"`;
        const npxOptionsStr = npxOptions.map(escapeArg).join(' ');
        const settingsArgsStr = settingsArgs.map(escapeArg).join(' ');
        const command = `"${npxCommand}" ${npxOptionsStr} obs-cli -- ${settingsArgsStr}`;

        const { stdout } = await execAsync(command, { timeout: 5000 });
        const settings = JSON.parse(stdout.trim());
        const streamKey = settings.streamServiceSettings?.key ?? settings.settings?.key ?? settings.key;

        if (streamKey && typeof streamKey === 'string' && streamKey.length > 0) {
            return streamKey;
        }
        return null;
    } catch (e) {
        return null;
    }
}

async function validateSheet(sheet: SheetKey): Promise<boolean> {
    console.log(`\n=== Validating Sheet ${sheet} ===`);
    let allGood = true;

    // 1. Check SHEET_KEY env var
    const envSheetKey = process.env.SHEET_KEY;
    if (envSheetKey !== sheet) {
        console.error(`❌ SHEET_KEY env var is "${envSheetKey}" but should be "${sheet}"`);
        allGood = false;
    } else {
        console.log(`✅ SHEET_KEY env var is correct: ${sheet}`);
    }

    // 2. Check config.json has this sheet
    try {
        const sheetConfig = getSheetConfig(sheet);
        if (!sheetConfig) {
            console.error(`❌ Sheet ${sheet} not found in config.json`);
            allGood = false;
        } else {
            console.log(`✅ Sheet ${sheet} found in config.json`);
            if (sheetConfig.streamId) {
                console.log(`   Stream ID: ${sheetConfig.streamId}`);
            }
            if (sheetConfig.streamKey) {
                console.log(`   Stream Key: ${sheetConfig.streamKey.substring(0, 20)}...`);
            }
        }
    } catch (e) {
        console.error(`❌ Error reading config.json:`, e);
        allGood = false;
    }

    // 3. Check OBS is configured with correct stream key (if OBS is running and websocket available)
    const wsPass = process.env.OBS_WEBSOCKET_PASSWORD;
    if (wsPass) {
        // Check if OBS is running
        try {
            const { stdout } = await execFileAsync('powershell', [
                '-NoProfile', '-Command',
                "Get-Process obs64 -ErrorAction SilentlyContinue | Select-Object -First 1 | ForEach-Object { $_.Id }"
            ]);
            const obsRunning = stdout.trim().length > 0;

            if (obsRunning) {
                console.log(`✅ OBS is running`);
                const obsStreamKey = await checkObsStreamKey(wsPass);
                if (obsStreamKey) {
                    const sheetConfig = getSheetConfig(sheet);
                    const expectedKey = sheetConfig?.streamKey;
                    if (expectedKey) {
                        if (obsStreamKey === expectedKey) {
                            console.log(`✅ OBS stream key matches config.json for Sheet ${sheet}`);
                        } else {
                            console.error(`❌ OBS stream key "${obsStreamKey.substring(0, 20)}..." does not match config.json "${expectedKey.substring(0, 20)}..."`);
                            console.error(`   OBS is configured for a different sheet!`);
                            allGood = false;
                        }
                    } else {
                        console.log(`⚠️  OBS stream key found: ${obsStreamKey.substring(0, 20)}... (no config.json streamKey to compare)`);
                    }
                } else {
                    console.error(`⚠️  Could not retrieve OBS stream key via websocket`);
                }
            } else {
                console.log(`⚠️  OBS is not running - cannot verify stream key`);
            }
        } catch (e) {
            console.error(`⚠️  Could not check OBS status:`, e);
        }
    } else {
        console.log(`⚠️  OBS_WEBSOCKET_PASSWORD not set - cannot verify OBS stream key`);
    }

    // 4. Check YouTube credentials
    const credentialsPath = process.env.YOUTUBE_OAUTH_CREDENTIALS;
    const tokenPath = process.env.YOUTUBE_TOKEN_PATH;
    if (credentialsPath && fs.existsSync(credentialsPath)) {
        console.log(`✅ YouTube OAuth credentials found: ${credentialsPath}`);
    } else {
        console.error(`❌ YouTube OAuth credentials not found or not set`);
        allGood = false;
    }

    if (tokenPath && fs.existsSync(tokenPath)) {
        console.log(`✅ YouTube OAuth token found: ${tokenPath}`);
    } else {
        console.error(`❌ YouTube OAuth token not found or not set`);
        allGood = false;
    }

    return allGood;
}

async function main(): Promise<void> {
    console.log('=== Curling Club Streaming Setup Validation ===\n');

    const sheets: SheetKey[] = ['A', 'B', 'C', 'D'];
    const currentSheet = process.env.SHEET_KEY as SheetKey | undefined;

    if (currentSheet && sheets.includes(currentSheet)) {
        // Validate current sheet only
        const isValid = await validateSheet(currentSheet);
        if (isValid) {
            console.log(`\n✅ Sheet ${currentSheet} configuration is valid!`);
            process.exit(0);
        } else {
            console.log(`\n❌ Sheet ${currentSheet} configuration has issues. Please fix the errors above.`);
            process.exit(1);
        }
    } else {
        // Validate all sheets
        console.log('No SHEET_KEY set - validating all sheets in config.json\n');
        let allValid = true;

        for (const sheet of sheets) {
            const isValid = await validateSheet(sheet);
            if (!isValid) {
                allValid = false;
            }
        }

        if (allValid) {
            console.log(`\n✅ All sheets are configured correctly!`);
            process.exit(0);
        } else {
            console.log(`\n❌ Some sheets have configuration issues. Please fix the errors above.`);
            process.exit(1);
        }
    }
}

main().catch((err) => {
    console.error('Validation failed:', err);
    process.exit(1);
});

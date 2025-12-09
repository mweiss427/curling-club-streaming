import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const execAsync = promisify(exec);

function formatTimestamp(): string {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

// Simple file-based lock to prevent concurrent ticks
const lockFile = path.join(process.cwd(), '.tick-lock');
let isRunning = false;

async function runTick(): Promise<void> {
    // Prevent concurrent execution
    if (isRunning) {
        console.error(`[${formatTimestamp()}] SKIP: Previous tick still running, skipping this tick`);
        return;
    }

    // Check for stale lock file (older than 2 minutes)
    try {
        if (fs.existsSync(lockFile)) {
            const stats = fs.statSync(lockFile);
            const age = Date.now() - stats.mtimeMs;
            if (age > 120000) { // 2 minutes
                console.error(`[${formatTimestamp()}] WARN: Removing stale lock file (${Math.round(age / 1000)}s old)`);
                fs.unlinkSync(lockFile);
            } else {
                console.error(`[${formatTimestamp()}] SKIP: Lock file exists, previous tick may still be running`);
                return;
            }
        }
    } catch (e) {
        // Ignore lock file errors
    }

    isRunning = true;
    try {
        // Create lock file
        fs.writeFileSync(lockFile, process.pid.toString(), 'utf8');

        const timestamp = formatTimestamp();
        try {
            const { stdout, stderr } = await execAsync('npm run --silent tick', {
                cwd: process.cwd(),
                timeout: 60000 // 60 second timeout
            });
            const output = (stdout + stderr).trim();

            // Check if output is a valid status (not an error)
            const validStatuses = ['STARTED', 'ALREADY_LIVE', 'STOPPED', 'IDLE'];
            const isStatus = validStatuses.some(status => output.includes(status));

            if (isStatus) {
                // Valid status - log as info, not error
                console.log(`[${timestamp}] ${output}`);
            } else if (output) {
                // Has output but not a known status - log normally
                console.log(`[${timestamp}] ${output}`);
            }
            // If no output, don't log anything
        } catch (error: any) {
            const errorMsg = error.stdout || error.stderr || error.message || String(error);

            // Check if the error message contains a valid status (command may have succeeded but exited with code)
            const validStatuses = ['STARTED', 'ALREADY_LIVE', 'STOPPED', 'IDLE'];
            const isStatus = validStatuses.some(status => errorMsg.includes(status));

            if (isStatus) {
                // Valid status in error output - log as info (command may have succeeded)
                console.log(`[${timestamp}] ${errorMsg}`);
            } else {
                // Actual error - log as error
                console.error(`[${timestamp}] ERROR: ${errorMsg}`);
            }
        }
    } finally {
        // Remove lock file
        try {
            if (fs.existsSync(lockFile)) {
                fs.unlinkSync(lockFile);
            }
        } catch (e) {
            // Ignore cleanup errors
        }
        isRunning = false;
    }
}

// Run immediately, then every 30 seconds
runTick();
setInterval(runTick, 30000);

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[INFO] Shutting down tick-loop...');
    process.exit(0);
});



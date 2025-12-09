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

    // Check for stale lock file - verify PID is still running
    try {
        if (fs.existsSync(lockFile)) {
            const lockContent = fs.readFileSync(lockFile, 'utf8').trim();
            const lockPid = parseInt(lockContent, 10);
            
            if (isNaN(lockPid)) {
                // Lock file doesn't contain a valid PID - remove it
                console.error(`[${formatTimestamp()}] WARN: Lock file contains invalid PID, removing`);
                fs.unlinkSync(lockFile);
            } else {
                // Check if the process is still running
                try {
                    process.kill(lockPid, 0); // Signal 0 doesn't kill, just checks if process exists
                    // Process is running - check age
                    const stats = fs.statSync(lockFile);
                    const age = Date.now() - stats.mtimeMs;
                    if (age > 120000) { // 2 minutes
                        console.error(`[${formatTimestamp()}] WARN: Removing stale lock file (process ${lockPid} running but lock is ${Math.round(age / 1000)}s old)`);
                        fs.unlinkSync(lockFile);
                    } else {
                        console.error(`[${formatTimestamp()}] SKIP: Lock file exists, process ${lockPid} is still running`);
                        return;
                    }
                } catch (killError: any) {
                    // Process doesn't exist (ESRCH error) or permission denied
                    // Remove stale lock file
                    console.error(`[${formatTimestamp()}] WARN: Lock file exists but process ${lockPid} is not running, removing stale lock`);
                    fs.unlinkSync(lockFile);
                }
            }
        }
    } catch (e) {
        // Ignore lock file errors (file might have been deleted by another process)
        console.error(`[${formatTimestamp()}] WARN: Error checking lock file:`, e);
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



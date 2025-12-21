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
// Lock file to prevent multiple tick-loop instances
const loopLockFile = path.join(process.cwd(), '.tick-loop-lock');
let isRunning = false;

// Check if another tick-loop instance is already running
function checkExistingLoop(): void {
    if (fs.existsSync(loopLockFile)) {
        try {
            const stats = fs.statSync(loopLockFile);
            const age = Date.now() - stats.mtimeMs;
            // If lock file is older than 2 minutes, assume previous process died
            if (age > 120000) {
                console.error(`[WARN] Removing stale tick-loop lock file (${Math.round(age / 1000)}s old)`);
                fs.unlinkSync(loopLockFile);
            } else {
                console.error(`[ERROR] Another tick-loop instance appears to be running (lock file exists)`);
                console.error(`[ERROR] If you're sure no other instance is running, delete: ${loopLockFile}`);
                process.exit(1);
            }
        } catch (e) {
            // Ignore errors, continue
        }
    }
    
    // Create lock file
    try {
        fs.writeFileSync(loopLockFile, process.pid.toString(), 'utf8');
    } catch (e) {
        console.error(`[WARN] Failed to create tick-loop lock file:`, e);
    }
}

// Clean up lock file on exit
function cleanupLoopLock(): void {
    try {
        if (fs.existsSync(loopLockFile)) {
            fs.unlinkSync(loopLockFile);
        }
    } catch (e) {
        // Ignore cleanup errors
    }
}

// Check for existing instance before starting
checkExistingLoop();

// Register cleanup handlers
process.on('SIGINT', () => {
    cleanupLoopLock();
    console.log('\n[INFO] Shutting down tick-loop...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    cleanupLoopLock();
    console.log('\n[INFO] Shutting down tick-loop...');
    process.exit(0);
});

process.on('exit', () => {
    cleanupLoopLock();
});

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
            // Use node directly with compiled JS if available, otherwise use tsx
            // This reduces overhead compared to npm run which spawns extra processes
            const distCli = path.join(process.cwd(), 'dist', 'cli.js');
            const tickScript = fs.existsSync(distCli)
                ? `node ${distCli} tick`
                : 'npm run --silent tick';
            
            const { stdout, stderr } = await execAsync(tickScript, {
                cwd: process.cwd(),
                timeout: 60000, // 60 second timeout
                maxBuffer: 1024 * 1024 // 1MB buffer
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


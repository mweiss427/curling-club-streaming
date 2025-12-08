import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

function formatTimestamp(): string {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

async function runTick(): Promise<void> {
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
}

// Run immediately, then every 30 seconds
runTick();
setInterval(runTick, 30000);

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[INFO] Shutting down tick-loop...');
    process.exit(0);
});



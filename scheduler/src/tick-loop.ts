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
        console.log(`[${timestamp}] ${output}`);
    } catch (error: any) {
        const errorMsg = error.stdout || error.stderr || error.message || String(error);
        console.error(`[${timestamp}] ERROR: ${errorMsg}`);
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

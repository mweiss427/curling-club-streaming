import 'dotenv/config';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const execAsync = promisify(exec);

async function testObsCli(): Promise<void> {
    console.log('=== Testing obs-cli Connection ===\n');

    const wsHost = process.env.OBS_WEBSOCKET_HOST || '127.0.0.1';
    const wsPort = process.env.OBS_WEBSOCKET_PORT || '4455';
    const wsPass = process.env.OBS_WEBSOCKET_PASSWORD;

    if (!wsPass) {
        console.error('❌ OBS_WEBSOCKET_PASSWORD not set in .env file');
        console.error('   Make sure you have a .env file in the scheduler directory with:');
        console.error('   OBS_WEBSOCKET_PASSWORD=your_password_here');
        process.exit(1);
    }

    console.log(`Host: ${wsHost}`);
    console.log(`Port: ${wsPort}`);
    console.log(`Password: ${wsPass.substring(0, 5)}...`);
    console.log('');

    // Test 1: Check if OBS process is running
    console.log('1. Checking if OBS is running...');
    try {
        const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq obs64.exe" /FO CSV /NH', { timeout: 2000 });
        if (stdout.toLowerCase().includes('obs64.exe')) {
            console.log('   ✅ OBS is running');
        } else {
            console.log('   ❌ OBS is NOT running');
            console.log('   Start OBS first, then run this test again');
            process.exit(1);
        }
    } catch (e) {
        console.log('   ⚠️  Could not check OBS process status');
    }

    // Test 2: Test obs-cli connection
    console.log('\n2. Testing obs-cli connection...');
    const schedulerDir = process.cwd();
    const nodeDir = process.execPath.replace(/\\[^\\]+$/, '');
    const npxCmdPath = path.join(nodeDir, 'npx.cmd');
    const npxCommand = fs.existsSync(npxCmdPath) ? npxCmdPath : 'npx.cmd';

    const escapeArg = (arg: string): string => `"${arg.replace(/"/g, '""')}"`;
    const npxOptions = ['--yes', '--prefix', schedulerDir];
    const npxOptionsStr = npxOptions.map(escapeArg).join(' ');

    // Try both localhost and the configured host
    const hostsToTry = [wsHost];
    if (wsHost === '127.0.0.1') {
        // Also try localhost explicitly
        hostsToTry.push('localhost');
    }

    let connectionSuccess = false;
    let lastError: any = null;

    for (const testHost of hostsToTry) {
        const command = `"${npxCommand}" ${npxOptionsStr} obs-cli -- --host "${testHost}" --port "${wsPort}" --password "${wsPass}" GetStreamStatus --json`;

        console.log(`   Trying host: ${testHost}`);
        console.log(`   Command: ${command.replace(wsPass, '***REDACTED***')}`);

        try {
            const { stdout, stderr } = await execAsync(command, { timeout: 5000 });
            const result = JSON.parse(stdout.trim());
            
            if (result.status === 'error' && result.code === 'CONNECTION_ERROR') {
                console.log(`   ❌ Connection failed to ${testHost}`);
                lastError = result;
                continue; // Try next host
            } else if (result.outputActive !== undefined) {
                console.log(`   ✅ Connection successful to ${testHost}!`);
                console.log(`   Stream status: ${result.outputActive ? 'ACTIVE' : 'INACTIVE'}`);
                connectionSuccess = true;
                break;
            } else {
                console.log('   ⚠️  Got response but unexpected format:');
                console.log(`   ${JSON.stringify(result, null, 2)}`);
                lastError = result;
            }
        } catch (e: any) {
            if (e.stdout) {
                try {
                    const result = JSON.parse(e.stdout.trim());
                    if (result.status === 'error' && result.code === 'CONNECTION_ERROR') {
                        console.log(`   ❌ Connection failed to ${testHost}`);
                        lastError = result;
                        continue; // Try next host
                    }
                } catch {
                    // Not JSON, continue
                }
            }
            lastError = e;
            console.log(`   ❌ Connection attempt to ${testHost} failed: ${e.message || String(e)}`);
        }
    }

    if (!connectionSuccess) {
        console.log('\n   ❌ All connection attempts failed');
        console.log('   Possible issues:');
        console.log('     - OBS websocket plugin not enabled (check OBS Tools -> WebSocket Server Settings)');
        console.log('     - Wrong port (check OBS Tools -> WebSocket Server Settings, should be 4455)');
        console.log('     - Wrong password (check OBS Tools -> WebSocket Server Settings)');
        console.log('     - OBS websocket server not started');
        console.log('     - Firewall blocking connection');
        console.log(`   Current config: Host=${wsHost}, Port=${wsPort}`);
        console.log('   Tip: Check OBS Tools -> WebSocket Server Settings and verify:');
        console.log('     - "Enable WebSocket server" is checked');
        console.log('     - Port matches (4455)');
        console.log('     - Password matches');
        process.exit(1);
    }

    console.log('\n✅ All tests passed! obs-cli is working correctly.');
}

testObsCli().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});

import 'dotenv/config';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { getStreamStatusFromWs as getStreamStatus } from './obs/index.js';

const execAsync = promisify(exec);

async function testObsCli(): Promise<void> {
    console.log('=== Testing OBS Websocket Connection ===\n');

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

    // Test 2: Test websocket connection
    console.log('\n2. Testing OBS websocket connection...');

    // Try multiple hosts: configured host, localhost variants, and common network IPs
    const hostsToTry = [wsHost];
    if (wsHost === '127.0.0.1') {
        // Also try localhost explicitly
        hostsToTry.push('localhost');
    }

    // Try to detect local network IP (OBS might be bound to network interface)
    // Common Windows local network IP ranges
    console.log('   Detecting local network IPs...');
    try {
        const { stdout } = await execAsync('ipconfig', { timeout: 3000 });
        // Look for IPv4 addresses in common private ranges
        const ipv4Regex = /\b(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+)\b/g;
        const matches = stdout.match(ipv4Regex);
        if (matches) {
            // Add unique IPs that aren't already in the list
            const uniqueIPs = [...new Set(matches)];
            console.log(`   Found network IPs: ${uniqueIPs.join(', ')}`);
            for (const ip of uniqueIPs) {
                if (!hostsToTry.includes(ip)) {
                    hostsToTry.push(ip);
                }
            }
        }
    } catch (e) {
        // Ignore - we'll just try the default hosts
        console.log('   Could not detect network IPs, will try localhost only');
    }

    let connectionSuccess = false;
    let lastError: any = null;

    for (const testHost of hostsToTry) {
        console.log(`   Trying host: ${testHost}...`);

        try {
            const isActive = await getStreamStatus(testHost, wsPort, wsPass);

            if (isActive !== null) {
                // Connection successful - got a response
                console.log(`   ✅ Connection successful to ${testHost}!`);
                console.log(`   Stream status: ${isActive ? 'ACTIVE' : 'INACTIVE'}`);
                connectionSuccess = true;
                break;
            } else {
                // Connection failed (returned null)
                console.log(`   ❌ Connection failed to ${testHost} (websocket not responding)`);
                lastError = new Error('Connection returned null');
            }
        } catch (e: any) {
            lastError = e;
            const errorMsg = e.message || String(e);
            if (errorMsg.includes('CONNECTION_ERROR') || errorMsg.includes('Connection') || errorMsg.includes('ECONNREFUSED')) {
                console.log(`   ❌ Connection failed to ${testHost}: ${errorMsg}`);
            } else {
                console.log(`   ❌ Error connecting to ${testHost}: ${errorMsg}`);
            }
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
        if (lastError) {
            console.log(`   Last error: ${lastError.message || String(lastError)}`);
        }
        process.exit(1);
    }

    console.log('\n✅ All tests passed! OBS websocket connection is working correctly.');
}

testObsCli().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});





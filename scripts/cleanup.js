#!/usr/bin/env node

/**
 * Cleanup script to kill existing Node processes before dev
 * Runs on all platforms (Windows, macOS, Linux)
 */

const { spawnSync } = require('child_process');
const os = require('os');

console.log('🧹 Cleaning up existing Node processes...');

try {
  if (os.platform() === 'win32') {
    // Windows - silently attempt to kill node processes
    spawnSync('cmd', ['/c', 'taskkill /F /IM node.exe /T >nul 2>&1'], {
      stdio: 'ignore'
    });
  } else {
    // macOS / Linux - silently attempt to kill node processes
    spawnSync('sh', ['-c', 'pkill -9 node 2>/dev/null || true'], {
      stdio: 'ignore'
    });
  }

  console.log('✓ Cleaned up Node processes');

  // Wait for ports to be released
  console.log('⏳ Waiting for ports to be released...');
  const delayMs = 1500;
  const start = Date.now();
  while (Date.now() - start < delayMs) {
    // Busy wait
  }
  console.log('✓ Ready to start services\n');

} catch (err) {
  // Ignore any errors and continue
  console.log('✓ Cleanup completed\n');
}

// Always exit successfully so pnpm continues
process.exit(0);

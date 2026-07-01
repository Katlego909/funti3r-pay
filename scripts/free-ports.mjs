// Frees the project's dev ports before `pnpm dev` starts.
// Runs automatically as the root `predev` script (pnpm runs pre* hooks).
// Cross-platform: uses netstat/taskkill on Windows, lsof/kill elsewhere.
import { execSync } from 'node:child_process';
import os from 'node:os';

const PORTS = [3000, 3001, 3002, 3003, 3004, 3100];
const isWin = os.platform() === 'win32';

function pidsOnPort(port) {
  const pids = new Set();
  try {
    if (isWin) {
      // No `-p tcp`: that filters to IPv4 only and misses IPv6 listeners
      // (e.g. Vite binds [::1]:3100). Plain `netstat -ano` covers both stacks.
      const out = execSync('netstat -ano', { encoding: 'utf8' });
      const portRe = new RegExp(':' + port + '(?!\\d)');
      for (const line of out.split('\n')) {
        if (portRe.test(line) && /LISTENING/i.test(line)) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && pid !== '0') pids.add(pid);
        }
      }
    } else {
      const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf8' });
      out.split('\n').map((p) => p.trim()).filter(Boolean).forEach((p) => pids.add(p));
    }
  } catch {
    // no listener on this port (or command not found) -> nothing to free
  }
  return pids;
}

let freed = 0;
for (const port of PORTS) {
  for (const pid of pidsOnPort(port)) {
    try {
      execSync(isWin ? `taskkill /PID ${pid} /F` : `kill -9 ${pid}`, { stdio: 'ignore' });
      console.log(`free-ports: freed :${port} (killed PID ${pid})`);
      freed++;
    } catch {
      // process may have already exited; ignore
    }
  }
}
if (freed === 0) console.log('free-ports: all dev ports already free');

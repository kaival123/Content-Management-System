// Starts the project server and the Angular dev server together (npm start).
// Extra arguments are passed to `ng serve`, e.g. `npm start -- --host 0.0.0.0 --port 4200`.
// The /api proxy to the project server is configured in angular.json (proxy.conf.json).
import { spawn, spawnSync } from 'node:child_process';

const win = process.platform === 'win32';
const API_PORT = Number(process.env.CMS_PORT ?? 4310);
const children = [];

/** True if a CMS project server is already answering on the API port. */
async function serverAlreadyRunning() {
  try {
    // /api/auth/me needs no session, so it's a safe health check.
    const res = await fetch(`http://127.0.0.1:${API_PORT}/api/auth/me`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Stops a child and everything it started (on Windows, `kill` would leave `ng serve` running). */
function killTree(child) {
  if (child.exitCode !== null || !child.pid) return;
  if (win) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill();
}

function stop(code = 0) {
  for (const c of children) killTree(c);
  process.exit(code);
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

if (await serverAlreadyRunning()) {
  console.log(`Using the project server already running on port ${API_PORT}.`);
} else {
  // --watch restarts the server automatically when any server/*.mjs file changes, so
  // you never run stale server code after an edit. (Data files aren't imported, so
  // editing websites doesn't trigger a restart.)
  const server = spawn(process.execPath, ['--watch', '--experimental-sqlite', 'server/index.mjs'], { stdio: 'inherit' });
  server.on('exit', (code) => {
    if (code) {
      console.error(`Project server exited (code ${code}). Is port ${API_PORT} in use by another program?`);
      stop(code);
    }
  });
  children.push(server);
}

const app = spawn(win ? 'npx.cmd' : 'npx', ['ng', 'serve', ...process.argv.slice(2)], { stdio: 'inherit', shell: win });
app.on('exit', (code) => stop(code ?? 0));
children.push(app);

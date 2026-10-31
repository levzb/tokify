import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const data = process.env.TOKIFY_DATA || path.join(root, 'data');
const port = process.env.PORT || '8788';
try {
  const r = await fetch(`http://127.0.0.1:${port}/api/me`, { signal: AbortSignal.timeout(1500) });
  if (r.ok) { console.log(`Tokify is already running: http://localhost:${port}`); process.exit(0); }
} catch {}
if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('Run npm run build first');
fs.mkdirSync(data, { recursive: true, mode: 0o700 });
const log = fs.openSync(path.join(data, 'server.log'), 'a', 0o600);
const child = spawn(process.execPath, ['server/index.js'], { cwd: root, env: process.env, detached: true, stdio: ['ignore', log, log] });
child.unref();
fs.closeSync(log);
for (let i = 0; i < 50; i++) {
  await new Promise((r) => setTimeout(r, 100));
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/me`);
    if (response.ok) {
      fs.writeFileSync(path.join(data, 'server.pid'), String(child.pid), { mode: 0o600 });
      console.log(`Tokify: http://localhost:${port}\nLog: ${path.join(data, 'server.log')}`);
      process.exit(0);
    }
  } catch {}
}
throw new Error(`Server did not start. Check ${path.join(data, 'server.log')}`);

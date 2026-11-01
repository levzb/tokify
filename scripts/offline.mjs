// Open the installed local app. No package installation or internet is needed.
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.PORT || 8788);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const started = spawnSync(process.execPath, ['scripts/start.mjs'], { cwd: root, stdio: 'inherit', env: process.env });
if (started.error) throw started.error;
if (started.status !== 0) process.exit(started.status || 1);

const url = `http://localhost:${port}/`;
console.log(`\nLocal library: ${url}\nPlaylists and edits are saved on this Mac, even without internet.\nOnly fetching new music from TikTok needs internet.\n`);
if (process.env.TOKIFY_NO_OPEN !== '1') {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
  const browser = spawn(command, [url], { detached: true, stdio: 'ignore' });
  browser.on('error', () => console.log(`Open ${url} in your browser.`));
  browser.unref();
}

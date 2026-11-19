// Everything that touches the computer itself: the external programs Tokify uses (ffmpeg, ffprobe,
// yt-dlp, Chromium) and the setup / start / stop / dev commands. Importing this file has no side effects.
//
//   node server/system.js setup   install everything, build, start   (npm run setup)
//   node server/system.js start   start in the background, open the browser   (npm start)
//   node server/system.js stop    stop the background server   (npm stop)
//   node server/system.js dev     server + Vite with live reload   (npm run dev)
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

export const ROOT = path.resolve(import.meta.dirname, '..');
/** Private library folder: data/ unless TOKIFY_DATA points elsewhere. */
export const dataDir = () => process.env.TOKIFY_DATA || path.join(ROOT, 'data');
const PORT = Number(process.env.PORT || 8788);
const WIN = process.platform === 'win32';
const require = createRequire(import.meta.url);
const ytdlpDir = () => path.join(dataDir(), 'tools', 'yt-dlp');

function bundled(name) {
  try {
    const file = name === 'ffmpeg' ? require('ffmpeg-static') : require('@ffprobe-installer/ffprobe').path;
    return file && fs.existsSync(file) ? file : null;
  } catch { return null; }
}

/**
 * Path of an external program: an override (TOKIFY_FFMPEG, TOKIFY_FFPROBE, TOKIFY_YTDLP),
 * else the copy installed by setup, else whatever is on PATH.
 */
export function tool(name) {
  const override = process.env['TOKIFY_' + name.replace('-', '').toUpperCase()];
  if (override) return override;
  if (name === 'yt-dlp') {
    // Standalone binary from setup; older installs used a Python virtualenv in the same folder.
    const found = [WIN ? 'yt-dlp.exe' : 'yt-dlp', WIN ? 'Scripts/yt-dlp.exe' : 'bin/yt-dlp']
      .map((f) => path.join(ytdlpDir(), f)).find((f) => fs.existsSync(f));
    return found || name;
  }
  return bundled(name) || name;
}

// ---------- commands ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (text) => console.log(`\n▸ ${text}`);
const fail = (text) => { console.error(`\n✗ ${text}`); process.exit(1); };
const node = (args, options = {}) => spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', ...options }).status === 0;
const works = (cmd, args) => { try { return spawnSync(cmd, args, { stdio: 'ignore', windowsHide: true }).status === 0; } catch { return false; } };
const VITE = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

async function running() {
  try { return (await fetch(`http://127.0.0.1:${PORT}/api/ping`, { signal: AbortSignal.timeout(1500) })).ok; }
  catch { return false; }
}

const YTDLP_ASSETS = {
  'win32-x64': 'yt-dlp.exe', 'win32-arm64': 'yt-dlp.exe', 'win32-ia32': 'yt-dlp_x86.exe',
  'darwin-x64': 'yt-dlp_macos', 'darwin-arm64': 'yt-dlp_macos',
  'linux-x64': 'yt-dlp_linux', 'linux-arm64': 'yt-dlp_linux_aarch64', 'linux-arm': 'yt-dlp_linux_armv7l',
};
async function installYtDlp() {
  const asset = YTDLP_ASSETS[`${process.platform}-${process.arch}`];
  if (!asset) throw new Error(`no yt-dlp build for ${process.platform}-${process.arch}; install yt-dlp yourself`);
  const r = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`, { signal: AbortSignal.timeout(180_000) });
  if (!r.ok) throw new Error(`download failed (${r.status})`);
  const dir = ytdlpDir(), file = path.join(dir, WIN ? 'yt-dlp.exe' : 'yt-dlp');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file + '.part', Buffer.from(await r.arrayBuffer()), { mode: 0o755 });
  fs.renameSync(file + '.part', file);
}

async function setup() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) fail(`Node.js 22.13 or newer is required (this is ${process.version}). Get it at https://nodejs.org`);
  const warnings = [];

  say('ffmpeg');
  for (const name of ['ffmpeg', 'ffprobe']) {
    if (!works(tool(name), ['-version'])) fail(`${name} is unavailable. Install ffmpeg (https://ffmpeg.org/download.html) and run setup again.`);
  }
  console.log(`  ${tool('ffmpeg')}`);

  say('Chromium (opens TikTok sound pages)');
  if (!node([path.join(ROOT, 'node_modules', 'playwright', 'cli.js'), 'install', 'chromium']))
    warnings.push('Chromium was not installed, so TikTok imports will not work. Retry with: npm run setup'
      + (process.platform === 'linux' ? '\n  On Linux it may also need: npx playwright install-deps chromium' : ''));

  say('yt-dlp (YouTube and SoundCloud)');
  try { await installYtDlp(); console.log(`  ${tool('yt-dlp')}`); }
  catch (e) { warnings.push(`yt-dlp: ${e.message}. YouTube and SoundCloud links will not work until setup succeeds.`); }

  say('Building the app');
  if (!node([VITE, 'build', '--logLevel', 'warn'])) fail('The build failed (see above).');

  for (const w of warnings) console.warn(`\n! ${w}`);
  say('Tokify is installed.');
  if (await running()) { say('Restarting the running server'); await stop(); }
  await start();
}

async function start() {
  const url = `http://localhost:${PORT}/`, DATA = dataDir();
  if (!(await running())) {
    if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) fail('Tokify is not installed yet. Run: npm run setup');
    fs.mkdirSync(DATA, { recursive: true });
    const logFile = path.join(DATA, 'server.log'), log = fs.openSync(logFile, 'a');
    const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')],
      { cwd: ROOT, env: process.env, detached: true, windowsHide: true, stdio: ['ignore', log, log] });
    child.unref();
    fs.closeSync(log);
    let up = false;
    for (let i = 0; i < 100 && !up; i++) { await sleep(100); up = await running(); }
    if (!up) fail(`Tokify did not start. See ${logFile}`);
    fs.writeFileSync(path.join(DATA, 'server.pid'), String(child.pid));
  }
  console.log(`\nTokify: ${url}\nStop it with: npm stop\n`);
  if (process.env.TOKIFY_NO_OPEN === '1') return;
  const opener = WIN ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const browser = spawn(opener, [url], { detached: true, stdio: 'ignore' });
  browser.on('error', () => console.log(`Open ${url} in your browser.`));
  browser.unref();
}

async function stop() {
  const pidFile = path.join(dataDir(), 'server.pid');
  if (await running()) {
    // Ask politely first so the server can close its Chromium; then make sure.
    await fetch(`http://127.0.0.1:${PORT}/api/quit`, { method: 'POST' }).catch(() => {});
    for (let i = 0; i < 50 && await running(); i++) await sleep(100);
    if (await running()) { try { process.kill(Number(fs.readFileSync(pidFile, 'utf8')), 'SIGTERM'); } catch {} }
    console.log('Tokify stopped.');
  } else console.log('Tokify is not running.');
  fs.rmSync(pidFile, { force: true });
}

function dev() {
  const kids = [
    spawn(process.execPath, ['--watch-path=server', 'server/index.js'], { cwd: ROOT, stdio: 'inherit' }),
    spawn(process.execPath, [VITE], { cwd: ROOT, stdio: 'inherit' }),
  ];
  const quit = () => { for (const k of kids) k.kill(); process.exit(); };
  process.on('SIGINT', quit);
  process.on('SIGTERM', quit);
  for (const k of kids) k.on('exit', quit);
}

const isMain = (process.argv[1] && path.resolve(process.argv[1]).toLowerCase()) === import.meta.filename.toLowerCase();
if (isMain) {
  const commands = { setup, start, stop, dev };
  const command = commands[process.argv[2]];
  if (!command) fail('Usage: node server/system.js setup | start | stop | dev');
  await command();
}

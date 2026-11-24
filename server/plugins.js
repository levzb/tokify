// Plugins: optional pieces that plug into Tokify without being part of it (see plugins/README.md).
//
// Each one is a folder in plugins/ (or TOKIFY_PLUGINS) with a plugin.json and a server.js whose default export
// `activate(t)` receives a small API: lyrics providers, song events, actions, routes, a status line, its own
// store and data folder, and a way to run Python or the bundled tools. Whether it is on and its settings live in
// the library database; whatever it downloads (models, a Python environment) lives in data/plugins/<id>/.
//
// A plugin can never take Tokify down: loading, every hook and every action are guarded, a failure becomes the
// plugin's error line in Settings → Plugins, and playback never waits on a plugin.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { db, DATA, ROOT } from './db.js';
import { tool } from './system.js';

/** The plugin API version this Tokify speaks. A plugin declares the one it was written for (`"api"`). */
export const API = 1;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SETTING_TYPES = new Set(['toggle', 'choice', 'number', 'text']);
const HOOK_TIMEOUT = 5 * 60_000;

export const pluginsDir = () => process.env.TOKIFY_PLUGINS || path.join(ROOT, 'plugins');
const dataFor = (id) => path.join(DATA, 'plugins', id);

db.exec(`CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  settings TEXT NOT NULL DEFAULT '{}',
  store TEXT NOT NULL DEFAULT '{}'
)`);
const row = (id) => db.prepare('SELECT * FROM plugins WHERE id=?').get(id);
const json = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };
function save(id, patch) {
  // A plugin seen for the first time starts as its plugin.json says, whatever is saved first.
  const r = row(id) || { enabled: plugins.get(id)?.manifest.enabledByDefault ? 1 : 0, settings: '{}', store: '{}' };
  const next = { ...r, ...patch };
  db.prepare(`INSERT INTO plugins (id, enabled, settings, store) VALUES (?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled, settings=excluded.settings, store=excluded.store`)
    .run(id, next.enabled ? 1 : 0, next.settings, next.store);
}

const bad = (msg, code = 400) => Object.assign(new Error(msg), { code });
const plugins = new Map(); // id → { manifest, dir, mod, active, status, error, hooks }

// ---------- manifests ----------
function readManifest(dir) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
  if (!ID_RE.test(m.id || '')) throw new Error('plugin.json needs an "id" of lowercase letters, digits and dashes');
  if (m.id !== path.basename(dir)) throw new Error(`The folder must be named after its id (${m.id})`);
  if (!m.name) throw new Error('plugin.json needs a "name"');
  const settings = (Array.isArray(m.settings) ? m.settings : []).filter((s) => s && /^\w+$/.test(s.key || '') && SETTING_TYPES.has(s.type));
  const actions = (Array.isArray(m.actions) ? m.actions : []).filter((a) => a && /^[\w-]+$/.test(a.id || '') && a.label)
    .map((a) => ({ id: a.id, label: String(a.label), scope: a.scope === 'song' ? 'song' : 'plugin', icon: a.icon || null }));
  return {
    id: m.id, name: String(m.name), description: String(m.description || ''), version: String(m.version || '0.0.0'),
    api: Number(m.api) || 0, server: m.server || 'server.js', enabledByDefault: !!m.enabled, settings, actions,
  };
}
const defaults = (m) => Object.fromEntries(m.settings.map((s) => [s.key, s.default ?? (s.type === 'toggle' ? false : s.type === 'choice' ? s.options?.[0] : s.type === 'number' ? s.min ?? 0 : '')]));
function settingsOf(p) {
  const saved = json(row(p.manifest.id)?.settings, {});
  return { ...defaults(p.manifest), ...Object.fromEntries(Object.entries(saved).filter(([k]) => p.manifest.settings.some((s) => s.key === k))) };
}
function checkSetting(s, v) {
  if (s.type === 'toggle') return !!v;
  if (s.type === 'choice') { if (!(s.options || []).includes(v)) throw bad(`${s.label || s.key}: not one of the choices`); return v; }
  if (s.type === 'number') {
    const n = Number(v);
    if (!Number.isFinite(n)) throw bad(`${s.label || s.key}: not a number`);
    return Math.min(s.max ?? Infinity, Math.max(s.min ?? -Infinity, n));
  }
  return String(v ?? '').slice(0, 2000);
}

// ---------- the API a plugin gets ----------
function apiFor(p) {
  const id = p.manifest.id, own = p.hooks;
  const t = {
    id, api: API, dir: p.dir,
    /** Its own folder for downloads, models, caches: data/plugins/<id>/ (created on first use). */
    get data() { fs.mkdirSync(dataFor(id), { recursive: true }); return dataFor(id); },
    settings: () => settingsOf(p),
    log: (...a) => console.log(`[plugin ${id}]`, ...a),
    /** A line under the plugin in Settings, with an optional 0..1 progress. `null` clears it. */
    status(text, progress = null) { p.status = text ? { text: String(text), progress: Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : null } : null; },
    store: {
      get: (key) => json(row(id)?.store, {})[key],
      set(key, value) { const s = json(row(id)?.store, {}); if (value === undefined) delete s[key]; else s[key] = value; save(id, { store: JSON.stringify(s) }); },
    },
    lyrics: {
      /** find(track, ctx) → { synced?: LRC text, text?: plain words, source? } or null to pass. Higher priority asks first. */
      addProvider({ name, priority = 0, find }) {
        if (typeof find !== 'function') throw new Error('addProvider needs a find function');
        own.providers.push({ name: String(name || id), priority: Number(priority) || 0, find });
      },
    },
    /** Song events: 'track.ready' (a song finished downloading or was re-cut). */
    on(event, fn) { if (typeof fn === 'function') (own.events[event] ||= []).push(fn); },
    /** An action declared in plugin.json ("actions"): fn({ trackId }) → { message? } */
    action(actionId, fn) { if (typeof fn === 'function') own.actions[actionId] = fn; },
    /** A request at /api/plugins/<id>/<path>: fn({ method, query, body }) → JSON. */
    route(method, sub, fn) {
      const clean = String(sub).replace(/^\/+/, '');
      if (!clean || clean === 'actions' || clean.startsWith('actions/')) throw new Error(`Route path "${sub}" is reserved`);
      own.routes.push({ method: method.toUpperCase(), path: clean, fn });
    },
    tools: { ffmpeg: () => tool('ffmpeg'), ffprobe: () => tool('ffprobe') },
    /** Runs a Python script from the plugin folder: `input` goes in as JSON on stdin, JSON comes back from stdout.
     *  Uses data/plugins/<id>/venv when there is one, else python3 (python on Windows). */
    python(script, input = {}, { timeout = HOOK_TIMEOUT } = {}) {
      const file = path.resolve(p.dir, script);
      if (!file.startsWith(p.dir + path.sep)) return Promise.reject(new Error('The script must be inside the plugin folder'));
      const venv = path.join(dataFor(id), 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      const py = fs.existsSync(venv) ? venv : process.platform === 'win32' ? 'python' : 'python3';
      return runJson(py, [file], input, timeout);
    },
  };
  return Object.freeze(t);
}

function runJson(cmd, args, input, timeout) {
  return new Promise((resolve, reject) => {
    let out = '', err = '';
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { child.kill(); reject(new Error('The plugin’s script took too long')); }, timeout);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(e.code === 'ENOENT' ? `${cmd} is not installed` : e.message)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(err.trim().split('\n').at(-1) || `The script stopped (${code})`));
      try { resolve(JSON.parse(out || 'null')); } catch { reject(new Error('The script did not answer with JSON')); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

function within(promise, ms, what) {
  let timer;
  const late = new Promise((_, no) => { timer = setTimeout(() => no(new Error(`${what} took too long`)), ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

// ---------- loading, turning on and off ----------
async function activate(p) {
  p.hooks = { providers: [], events: {}, actions: {}, routes: [] };
  p.error = null; p.status = null;
  try {
    if (p.manifest.api !== API) throw new Error(`Written for plugin API ${p.manifest.api || '?'}, this Tokify speaks ${API}`);
    if (!p.mod) p.mod = await import(pathToFileURL(path.join(p.dir, p.manifest.server)).href);
    if (typeof p.mod.default !== 'function') throw new Error(`${p.manifest.server} must export a default activate(t) function`);
    await within(Promise.resolve(p.mod.default(apiFor(p))), 30_000, 'Starting it');
    p.active = true;
  } catch (e) {
    p.active = false; p.error = e.message;
    p.hooks = { providers: [], events: {}, actions: {}, routes: [] };
    console.warn(`[plugin ${p.manifest.id}] ${e.message}`);
  }
}
async function deactivate(p) {
  if (p.active) { try { await within(Promise.resolve(p.mod?.deactivate?.()), 10_000, 'Stopping it'); } catch (e) { console.warn(`[plugin ${p.manifest.id}] ${e.message}`); } }
  p.active = false; p.status = null;
  p.hooks = { providers: [], events: {}, actions: {}, routes: [] };
}
const isOn = (p) => { const r = row(p.manifest.id); return r ? !!r.enabled : p.manifest.enabledByDefault; };

/** Finds every plugin and starts the ones that are on. Called once at startup; a broken folder is listed, not fatal. */
export async function loadPlugins() {
  const dir = pluginsDir();
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name); } catch {}
  for (const name of names.sort()) {
    const pdir = path.join(dir, name);
    if (!fs.existsSync(path.join(pdir, 'plugin.json'))) continue;
    let manifest;
    try { manifest = readManifest(pdir); }
    catch (e) { plugins.set(name, { manifest: { id: name, name, description: '', version: '', settings: [], actions: [] }, dir: pdir, broken: e.message, hooks: { providers: [], events: {}, actions: {}, routes: [] } }); continue; }
    const p = { manifest, dir: pdir, active: false, status: null, error: null, hooks: { providers: [], events: {}, actions: {}, routes: [] } };
    plugins.set(manifest.id, p);
    if (isOn(p)) await activate(p);
  }
  return [...plugins.keys()];
}

function folderBytes(dir) {
  let n = 0;
  try {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, d.name);
      n += d.isDirectory() ? folderBytes(f) : d.isFile() ? fs.statSync(f).size : 0;
    }
  } catch {}
  return n;
}
const describe = (p) => p.broken
  ? { id: p.manifest.id, name: p.manifest.name, broken: p.broken, enabled: false, settings: [], values: {}, actions: [] }
  : {
    id: p.manifest.id, name: p.manifest.name, description: p.manifest.description, version: p.manifest.version,
    enabled: isOn(p), active: !!p.active, error: p.error || null, status: p.status || null,
    settings: p.manifest.settings, values: settingsOf(p), actions: p.manifest.actions, bytes: folderBytes(dataFor(p.manifest.id)),
  };

export const listPlugins = () => [...plugins.values()].map(describe);

export async function updatePlugin(id, { enabled, settings } = {}) {
  const p = plugins.get(id);
  if (!p) throw bad('No such plugin', 404);
  if (p.broken) throw bad(p.broken);
  if (settings && typeof settings === 'object') {
    const cur = settingsOf(p);
    for (const [k, v] of Object.entries(settings)) {
      const s = p.manifest.settings.find((x) => x.key === k);
      if (!s) throw bad(`Unknown setting “${k}”`);
      cur[k] = checkSetting(s, v);
    }
    save(id, { settings: JSON.stringify(cur) });
  }
  if (typeof enabled === 'boolean' && (enabled !== isOn(p) || enabled !== !!p.active)) {
    save(id, { enabled });
    if (enabled) await activate(p); else await deactivate(p);
  }
  return describe(p);
}

export async function runAction(id, actionId, input = {}) {
  const p = plugins.get(id);
  if (!p?.active) throw bad('This plugin is off', 409);
  const fn = p.hooks.actions[actionId];
  if (!fn) throw bad('This plugin has no such action', 404);
  try { return (await within(Promise.resolve(fn({ trackId: typeof input.trackId === 'string' ? input.trackId : null })), HOOK_TIMEOUT, 'The action')) || {}; }
  catch (e) { throw bad(e.message, 502); }
}

/** A plugin's own request (/api/plugins/<id>/<path>), or null when it is not one. */
export async function pluginRequest(method, pathname, query, readBody) {
  const m = /^\/api\/plugins\/([a-z0-9-]+)\/(.+)$/.exec(pathname);
  if (!m || m[2].startsWith('actions/')) return null;
  const p = plugins.get(m[1]);
  const r = p?.active && p.hooks.routes.find((x) => x.method === method && x.path === m[2]);
  if (!r) return null;
  const body = method === 'GET' || method === 'HEAD' ? null : await readBody();
  try { return { value: (await within(Promise.resolve(r.fn({ method, query, body })), HOOK_TIMEOUT, 'The request')) ?? {} }; }
  catch (e) { throw bad(e.message, 502); }
}

// ---------- hooks Tokify calls ----------
/** Tells every plugin that is on; never waits, never throws. */
export function emit(event, ...args) {
  for (const p of plugins.values()) {
    if (!p.active) continue;
    for (const fn of p.hooks.events[event] || []) {
      Promise.resolve().then(() => fn(...args)).catch((e) => { p.error = `${event}: ${e.message}`; });
    }
  }
}

/** Asks the plugins' lyrics providers in turn, highest priority first; the first answer with words wins. */
export async function pluginLyrics(track, ctx) {
  const list = [...plugins.values()].filter((p) => p.active)
    .flatMap((p) => p.hooks.providers.map((v) => ({ ...v, p })))
    .sort((a, b) => b.priority - a.priority);
  for (const v of list) {
    try {
      const r = await within(Promise.resolve(v.find(track, ctx)), HOOK_TIMEOUT, v.name);
      if (r && (r.synced || r.text)) return { synced: r.synced ? String(r.synced) : null, text: r.text ? String(r.text) : '', source: String(r.source || v.name) };
    } catch (e) { v.p.error = `${v.name}: ${e.message}`; }
  }
  return null;
}
export const hasLyricsProviders = () => [...plugins.values()].some((p) => p.active && p.hooks.providers.length);

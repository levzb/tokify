import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { db, uid, tx, ROOT, DIRS, MEDIA_KEY } from './db.js';
import { login, logout, isAuthed, hasPassword } from './auth.js';
import { createImport, retryTrack, jobStatus, listJobs, startFileJob } from './importer.js';
import { receiveFile, scanFile, commitFile, stagedFile, discardStagedFile } from './external.js';
import { createSession, serveStream } from './stream.js';
import { normalizeImage, coverColor, customPath } from './audio.js';
import { shutdown as closeBrowser } from './tiktok.js';

const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.HOST || '0.0.0.0';
const DIST = path.join(ROOT, 'dist');

// ---------- helpers ----------
const send = (res, code, body, headers = {}) => {
  const data = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
};
const fail = (res, code, message) => send(res, code, { error: message });

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (d) => { size += d.length; if (size > limit) { reject(Object.assign(new Error('too large'), { code: 413 })); req.destroy(); } else chunks.push(d); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const readJSON = async (req, limit = 5 << 20) => {
  const b = await readBody(req, limit);
  try {
    const value = b.length ? JSON.parse(b.toString('utf8')) : {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw Object.assign(new Error('Expected a JSON object'), { code: 400 }); }
};
const trackIdsInput = (ids = []) => {
  if (!Array.isArray(ids) || ids.length > 20000 || ids.some((id) => typeof id !== 'string' || !/^(?:\d{1,22}|file-[a-f0-9]{64})$/.test(id)))
    throw Object.assign(new Error('Invalid song list'), { code: 400 });
  return [...new Set(ids)];
};

const mediaUrl = (kind, file, ver) => `/media/${kind}/${encodeURIComponent(file)}?v=${ver || 1}&k=${MEDIA_KEY}`;

function trackOut(t) {
  return {
    id: t.id, title: t.title, author: t.author, status: t.status, error: t.error,
    samples: t.samples, color: t.color || '#ffffff', source: t.source_name || '', savedAt: t.saved_at || '', link: t.link,
    cover: t.custom_cover ? mediaUrl('c', t.custom_cover, t.ver) : t.cover_file ? mediaUrl('t', t.cover_file, t.ver) : null,
    customCover: !!t.custom_cover,
    origin: t.origin, filename: t.original_name || '',
  };
}

function library() {
  const tracks = db.prepare('SELECT * FROM tracks WHERE id IN (SELECT track_id FROM playlist_tracks) ORDER BY added DESC').all().map(trackOut);
  const pls = db.prepare("SELECT * FROM playlists ORDER BY CASE WHEN kind='external' THEN 0 ELSE 1 END, created ASC").all();
  const pt = db.prepare('SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY pos ASC');
  const playlists = pls.map((p) => ({
    id: p.id, name: p.name, kind: p.kind, shuffle: !!p.shuffle, transition: p.transition, created: p.created,
    cover: p.custom_cover ? mediaUrl('c', p.custom_cover, p.ver) : null,
    trackIds: pt.all(p.id).map((r) => r.track_id),
  }));
  return { tracks, playlists };
}

function removeOrphans() {
  // Keep private download cache: reimports do not fetch the same sound again,
  // and deleting a playlist cannot break the stream currently playing.
}

async function saveCustomCover(req, prefix) {
  const buf = await readBody(req, 25 << 20);
  if (buf.length < 100) throw Object.assign(new Error('empty'), { code: 400 });
  const tmp = path.join(DIRS.tmp, `${prefix}-${Date.now()}`);
  fs.writeFileSync(tmp, buf);
  const name = `${prefix}-${Date.now().toString(36)}.jpg`;
  try { await normalizeImage(tmp, customPath(name)); }
  catch { fs.rmSync(customPath(name), { force: true }); throw Object.assign(new Error('Couldn’t read that image. Choose JPEG, PNG, WebP or HEIC.'), { code: 400 }); }
  finally { fs.rmSync(tmp, { force: true }); }
  if (!fs.existsSync(customPath(name))) throw Object.assign(new Error('Couldn’t read that image'), { code: 400 });
  return name;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.ico': 'image/x-icon' };

function serveFile(req, res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cache });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// ---------- routes ----------
const routes = [];
const route = (method, pattern, handler, { open = false } = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, open });
};

route('GET', '/api/me', (req, res) => send(res, 200, { authed: isAuthed(req), hasPassword: hasPassword() }), { open: true });
route('POST', '/api/login', async (req, res) => {
  const { password } = await readJSON(req, 10_000);
  if (!hasPassword()) return fail(res, 503, 'No password set yet. On the Mac run: npm run password');
  const r = login(req, res, password);
  if (r.ok) return send(res, 200, { ok: true });
  return send(res, 401, { error: r.wait ? `Too many attempts. Wait ${r.wait} s.` : 'Wrong password' });
}, { open: true });
route('POST', '/api/logout', (req, res) => { logout(req, res); send(res, 200, { ok: true }); }, { open: true });

route('GET', '/api/library', (req, res) => send(res, 200, library()));
route('POST', '/api/files/scan', async (req, res) => send(res, 200, await scanFile(req)));
route('GET', '/api/files/staged/:token/cover', (req, res, { token }) => {
  const stage = stagedFile(token);
  if (!stage.hasCover) return fail(res, 404, 'No cover');
  serveFile(req, res, path.join(DIRS.uploads, `stage-${token}.jpg`), 'private, no-store');
});
route('DELETE', '/api/files/staged/:token', (req, res, { token }) => {
  discardStagedFile(token); send(res, 200, { ok: true });
});
route('POST', '/api/files/commit', async (req, res) => {
  const file = commitFile(await readJSON(req));
  const job = startFileJob(file.trackId, file.playlistId);
  const t = db.prepare('SELECT * FROM tracks WHERE id=?').get(file.trackId);
  send(res, 200, { ...file, jobId: job.id, cover: trackOut(t).cover });
});
route('POST', '/api/files', async (req, res) => {
  const file = await receiveFile(req);
  const job = startFileJob(file.trackId, file.playlistId);
  send(res, 200, { ...file, jobId: job.id });
});
route('PATCH', '/api/tracks/:id', async (req, res, { id }) => {
  const t = db.prepare('SELECT origin,title,author FROM tracks WHERE id=?').get(id);
  if (!t) return fail(res, 404, 'Song not found');
  if (t.origin !== 'external') return fail(res, 400, 'Only file titles and authors can be edited');
  const b = await readJSON(req);
  const title = typeof b.title === 'string' ? b.title.trim().slice(0, 300) : t.title;
  const author = typeof b.author === 'string' ? b.author.trim().slice(0, 200) : t.author;
  if (!title) return fail(res, 400, 'Enter a title');
  db.prepare('UPDATE tracks SET title=?,author=?,ver=ver+1 WHERE id=?').run(title, author, id);
  send(res, 200, { ok: true });
});

// Which of these sounds are already in the library?
route('POST', '/api/import/check', async (req, res) => {
  const { ids } = await readJSON(req);
  const q = db.prepare('SELECT * FROM tracks WHERE id = ?');
  const known = {};
  for (const id of trackIdsInput(ids)) { const t = q.get(id); if (t) known[id] = trackOut(t); }
  send(res, 200, { known });
});
route('POST', '/api/imports', async (req, res) => {
  const { name, items } = await readJSON(req);
  if (!Array.isArray(items) || !items.length) return fail(res, 400, 'No sounds to upload');
  const clean = String(name || '').trim().slice(0, 80) || `Upload ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
  send(res, 200, createImport({ name: clean, items }));
});
route('GET', '/api/jobs/:id', (req, res, { id }) => { const j = jobStatus(id); j ? send(res, 200, j) : fail(res, 404, 'Job not found'); });
route('GET', '/api/jobs', (req, res) => send(res, 200, { jobs: listJobs() }));
route('POST', '/api/tracks/:id/retry', (req, res, { id }) => { const j = retryTrack(id); j ? send(res, 200, { jobId: j.id }) : fail(res, 404, 'No such sound'); });

route('POST', '/api/playlists', async (req, res) => {
  const { name, trackIds } = await readJSON(req);
  const ids = trackIdsInput(trackIds);
  const id = uid();
  tx(() => {
    db.prepare('INSERT INTO playlists (id, name, kind, created) VALUES (?, ?, ?, ?)').run(id, String(name || 'My playlist').trim().slice(0, 80) || 'My playlist', 'custom', Date.now());
    const ins = db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, pos) SELECT ?, id, ? FROM tracks WHERE id = ?');
    ids.forEach((t, i) => ins.run(id, i, t));
  });
  send(res, 200, { id });
});
route('PATCH', '/api/playlists/:id', async (req, res, { id }) => {
  const b = await readJSON(req);
  const p = db.prepare('SELECT id FROM playlists WHERE id = ?').get(id);
  if (!p) return fail(res, 404, 'Playlist not found');
  if (b.trackIds !== undefined) {
    b.trackIds = trackIdsInput(b.trackIds);
    const current = db.prepare('SELECT track_id FROM playlist_tracks WHERE playlist_id = ?').all(id).map((r) => r.track_id);
    const wanted = new Set(b.trackIds);
    if (wanted.size !== current.length || current.some((t) => !wanted.has(t))) return fail(res, 400, 'Reorder must contain every song exactly once');
  }
  tx(() => {
    if (typeof b.name === 'string' && b.name.trim()) db.prepare('UPDATE playlists SET name = ? WHERE id = ?').run(b.name.trim().slice(0, 80), id);
    if (typeof b.shuffle === 'boolean') db.prepare('UPDATE playlists SET shuffle = ? WHERE id = ?').run(b.shuffle ? 1 : 0, id);
    if (['none', 'fade', 'crossfade'].includes(b.transition)) db.prepare('UPDATE playlists SET transition = ? WHERE id = ?').run(b.transition, id);
    if (Array.isArray(b.trackIds)) {
      const up = db.prepare('UPDATE playlist_tracks SET pos = ? WHERE playlist_id = ? AND track_id = ?');
      b.trackIds.forEach((t, i) => up.run(i, id, String(t)));
    }
  });
  send(res, 200, { ok: true });
});
route('DELETE', '/api/playlists/:id', (req, res, { id }) => {
  const p = db.prepare('SELECT custom_cover FROM playlists WHERE id = ?').get(id);
  if (!p) return fail(res, 404, 'Playlist not found');
  db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
  if (p.custom_cover) fs.rmSync(customPath(p.custom_cover), { force: true });
  removeOrphans();
  send(res, 200, { ok: true });
});
route('POST', '/api/playlists/:id/tracks', async (req, res, { id }) => {
  const { trackIds } = await readJSON(req);
  if (!db.prepare('SELECT id FROM playlists WHERE id = ?').get(id)) return fail(res, 404, 'Playlist not found');
  const ids = trackIdsInput(trackIds);
  const max = db.prepare('SELECT COALESCE(MAX(pos), -1) AS m FROM playlist_tracks WHERE playlist_id = ?').get(id).m;
  let added = 0;
  tx(() => {
    const ins = db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, pos) SELECT ?, id, ? FROM tracks WHERE id = ?');
    ids.forEach((t, i) => { added += Number(ins.run(id, max + 1 + i, t).changes); });
  });
  send(res, 200, { added });
});
route('DELETE', '/api/playlists/:id/tracks/:trackId', (req, res, { id, trackId }) => {
  db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').run(id, trackId);
  removeOrphans();
  send(res, 200, { ok: true });
});
route('PUT', '/api/playlists/:id/cover', async (req, res, { id }) => {
  const p = db.prepare('SELECT custom_cover FROM playlists WHERE id = ?').get(id);
  if (!p) return fail(res, 404, 'Playlist not found');
  const name = await saveCustomCover(req, `p-${id}`);
  if (p.custom_cover) fs.rmSync(customPath(p.custom_cover), { force: true });
  db.prepare('UPDATE playlists SET custom_cover = ?, ver = ver + 1 WHERE id = ?').run(name, id);
  send(res, 200, { ok: true });
});
route('DELETE', '/api/playlists/:id/cover', (req, res, { id }) => {
  const p = db.prepare('SELECT custom_cover FROM playlists WHERE id = ?').get(id);
  if (p?.custom_cover) fs.rmSync(customPath(p.custom_cover), { force: true });
  db.prepare('UPDATE playlists SET custom_cover = NULL, ver = ver + 1 WHERE id = ?').run(id);
  send(res, 200, { ok: true });
});
route('PUT', '/api/tracks/:id/cover', async (req, res, { id }) => {
  const t = db.prepare('SELECT custom_cover FROM tracks WHERE id = ?').get(id);
  if (!t) return fail(res, 404, 'No such sound');
  const name = await saveCustomCover(req, `t-${id}`);
  if (t.custom_cover) fs.rmSync(customPath(t.custom_cover), { force: true });
  const color = await coverColor(customPath(name));
  db.prepare('UPDATE tracks SET custom_cover = ?, color = ?, ver = ver + 1 WHERE id = ?').run(name, color, id);
  send(res, 200, { ok: true });
});
route('DELETE', '/api/tracks/:id/cover', async (req, res, { id }) => {
  const t = db.prepare('SELECT custom_cover, cover_file FROM tracks WHERE id = ?').get(id);
  if (!t) return fail(res, 404, 'No such sound');
  if (t.custom_cover) fs.rmSync(customPath(t.custom_cover), { force: true });
  const color = t.cover_file ? await coverColor(path.join(DIRS.covers, t.cover_file)) : '#ffffff';
  db.prepare('UPDATE tracks SET custom_cover = NULL, color = ?, ver = ver + 1 WHERE id = ?').run(color, id);
  send(res, 200, { ok: true });
});

route('POST', '/api/sessions', async (req, res) => {
  const { id, items, mode } = await readJSON(req);
  send(res, 200, createSession(String(id), { items: Array.isArray(items) ? items : [], mode }));
});

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let p;
    try { p = decodeURI(url.pathname); } catch { return fail(res, 400, 'Invalid URL'); }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && new URL(origin).host !== req.headers.host)) return fail(res, 403, 'Open Tokify directly to make changes');
    }
    if (p.startsWith('/stream/')) {
      if (!isAuthed(req)) { res.writeHead(401); return res.end(); }
      const id = p.slice(8).replace(/\.mp3$/, '');
      return await serveStream(req, res, id);
    }
    if (p.startsWith('/media/')) {
      if (url.searchParams.get('k') !== MEDIA_KEY && !isAuthed(req)) { res.writeHead(403); return res.end(); }
      const [, , kind, file] = p.split('/');
      const dir = kind === 't' ? DIRS.covers : kind === 'c' ? DIRS.custom : null;
      if (!dir || !file || file.includes('..')) { res.writeHead(404); return res.end(); }
      return serveFile(req, res, path.join(dir, path.basename(file)), 'private, max-age=31536000, immutable');
    }
    if (p.startsWith('/api/')) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(p);
        if (!m) continue;
        if (!r.open && !isAuthed(req)) return fail(res, 401, 'Sign in required');
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        return await r.handler(req, res, params);
      }
      return fail(res, 404, 'Not found');
    }
    // static app
    let file = path.join(DIST, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    const immutable = p.startsWith('/assets/');
    return serveFile(req, res, file, immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
  } catch (e) {
    if (!res.headersSent) fail(res, [400, 413].includes(e.code) ? e.code : 500, e.code ? e.message : 'Server error');
    if (!e.code) console.error(e);
  }
});
server.requestTimeout = 0;
server.listen(PORT, HOST, () => {
  console.log(`Tokify: http://localhost:${PORT}`);
  if (!hasPassword()) console.log('No password set — run: npm run password');
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await closeBrowser(); process.exit(0); });

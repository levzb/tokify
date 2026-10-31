// One continuous MP3 per play session, with transitions baked in.
// The stream is virtual: any byte range is rendered on demand from 6-second chunks.
// Chunks are encoded independently (CBR 160k @ 48 kHz, no bit reservoir, with pre/post roll),
// so they join seamlessly and Safari can seek anywhere instantly.
import { db } from './db.js';
import { run, decode, audioPath } from './audio.js';
import { buildTimeline, envelope, SR, FRAME, FRAME_BYTES, entryAt } from '../shared/timeline.js';

const K = 250; // frames per chunk (6 s)
const PRE = 4, POST = 4; // encoder pre/post roll in frames
const CHUNK_BYTES = K * FRAME_BYTES;

const ENC_ARGS = ['-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', String(SR), '-ac', '2', '-i', 'pipe:0',
  '-c:a', 'libmp3lame', '-b:a', '160k', '-reservoir', '0', '-write_xing', '0', '-id3v2_version', '0', '-f', 'mp3', 'pipe:1'];

async function encode(int16) {
  const { stdout } = await run('ffmpeg', ENC_ARGS, { input: Buffer.from(int16.buffer, int16.byteOffset, int16.byteLength) });
  return stdout;
}

// A canonical silent frame, used for the stream's tail so probes of the file end answer instantly.
let silentFrame = null;
async function getSilentFrame() {
  if (!silentFrame) {
    const out = await encode(new Int16Array(SR * 2));
    silentFrame = Buffer.from(out.subarray(10 * FRAME_BYTES, 11 * FRAME_BYTES));
  }
  return silentFrame;
}

// ---- decoded track cache (LRU by bytes) ----
const pcmCache = new Map();
let pcmBytes = 0;
const PCM_LIMIT = 600 * 1024 * 1024;
const pcmLoading = new Map();

async function trackPCM(t) {
  const key = `${t.id}:${t.ver}`;
  if (pcmCache.has(key)) { const v = pcmCache.get(key); pcmCache.delete(key); pcmCache.set(key, v); return v; }
  if (pcmLoading.has(key)) return pcmLoading.get(key);
  const p = decode(audioPath(t.audio_file)).then((pcm) => {
    pcmLoading.delete(key);
    pcmCache.set(key, pcm);
    pcmBytes += pcm.byteLength;
    for (const [k, v] of pcmCache) {
      if (pcmBytes <= PCM_LIMIT) break;
      pcmCache.delete(k); pcmBytes -= v.byteLength;
    }
    return pcm;
  }, (e) => { pcmLoading.delete(key); throw e; });
  pcmLoading.set(key, p);
  return p;
}

// ---- sessions ----
const sessions = new Map();
const waiters = new Map();
const MAX_SESSIONS = 24;

export function createSession(id, { items, mode }) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw Object.assign(new Error('Invalid session ID'), { code: 400 });
  const rows = new Map();
  const q = db.prepare("SELECT id, samples, trim_start, gain, audio_file, ver FROM tracks WHERE id = ? AND status = 'ok'");
  const plan = [];
  for (const it of items.slice(0, 5000)) {
    if (!it || typeof it.id !== 'string' || !Number.isFinite(it.offset ?? 0)) throw Object.assign(new Error('Invalid playback item'), { code: 400 });
    let r = rows.get(it.id);
    if (r === undefined) { r = q.get(it.id) || null; rows.set(it.id, r); }
    if (r && r.samples > 0) plan.push({ id: r.id, samples: r.samples, offset: Math.max(0, Math.round(it.offset || 0)) });
  }
  if (!plan.length) throw Object.assign(new Error('No playable songs'), { code: 400 });
  const tl = buildTimeline(plan, ['none', 'fade', 'crossfade'].includes(mode) ? mode : 'none');
  const s = { id, tl, tracks: rows, chunks: new Map(), pending: new Map(), created: Date.now() };
  sessions.set(id, s);
  while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  for (const w of [...(waiters.get(id) || [])]) w(s);
  waiters.delete(id);
  chunk(s, 0).catch(() => {}); // warm the start
  return { frames: tl.frames, bytes: tl.bytes, entries: tl.entries.length };
}

function getSession(id) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return Promise.resolve(null);
  const s = sessions.get(id);
  if (s) return Promise.resolve(s);
  return new Promise((resolve) => {
    const list = waiters.get(id) || [];
    const done = (value) => { clearTimeout(timer); const pending = waiters.get(id); if (pending) { const i = pending.indexOf(done); if (i >= 0) pending.splice(i, 1); if (!pending.length) waiters.delete(id); } resolve(value); };
    list.push(done);
    waiters.set(id, list);
    const timer = setTimeout(() => done(sessions.get(id) || null), 8000);
  });
}

async function renderChunk(s, c) {
  const { tl } = s;
  const f0 = c * K;
  const f1 = Math.min(tl.frames, f0 + K);
  const nFrames = f1 - f0;
  const silence = await getSilentFrame();
  const tailFrames = 8; // last frames are always canonical silence
  const s0 = (f0 - PRE) * FRAME, s1 = (f1 + POST) * FRAME;

  // Whole chunk inside the silent tail: no encoding needed.
  if (s0 >= tl.audioEnd + FRAME) return Buffer.concat(Array(nFrames).fill(silence));

  const len = s1 - s0;
  const mix = new Float32Array(len * 2);
  const first = Math.max(0, entryAt(tl.entries, s0) - 1);
  for (let i = first; i < tl.entries.length; i++) {
    const e = tl.entries[i];
    if (e.start >= s1) break;
    if (e.start + e.len <= s0) continue;
    const t = s.tracks.get(e.id);
    const pcm = await trackPCM(t);
    const g = Math.pow(10, (t.gain || 0) / 20);
    const a = Math.max(s0, e.start), b = Math.min(s1, e.start + e.len);
    const srcBase = t.trim_start + e.srcOffset - e.start;
    for (let p = a; p < b; p++) {
      const src = srcBase + p;
      if (src < 0 || src * 2 + 1 >= pcm.length) continue;
      const k = g * envelope(e, p - e.start);
      const o = (p - s0) * 2;
      mix[o] += pcm[src * 2] * k;
      mix[o + 1] += pcm[src * 2 + 1] * k;
    }
  }
  const out16 = new Int16Array(len * 2);
  for (let i = 0; i < mix.length; i++) {
    let v = mix[i];
    if (v > 0.95 || v < -0.95) v = Math.sign(v) * (0.95 + 0.05 * Math.tanh((Math.abs(v) - 0.95) / 0.05)); // soft limit
    out16[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  }
  const enc = await encode(out16);
  const body = Buffer.from(enc.subarray(PRE * FRAME_BYTES, (PRE + nFrames) * FRAME_BYTES));
  // Guard: pad with silence if the encoder returned fewer frames than expected.
  const parts = [body];
  for (let f = body.length / FRAME_BYTES; f < nFrames; f++) parts.push(silence);
  const buf = parts.length > 1 ? Buffer.concat(parts) : body;
  for (let f = Math.max(f0, tl.frames - tailFrames); f < f1; f++) silence.copy(buf, (f - f0) * FRAME_BYTES);
  return buf;
}

function chunk(s, c) {
  if (s.chunks.has(c)) return Promise.resolve(s.chunks.get(c));
  if (s.pending.has(c)) return s.pending.get(c);
  const p = renderChunk(s, c).then((buf) => {
    s.pending.delete(c);
    s.chunks.set(c, buf);
    if (s.chunks.size > 80) s.chunks.delete(s.chunks.keys().next().value);
    return buf;
  }, (e) => { s.pending.delete(c); throw e; });
  s.pending.set(c, p);
  return p;
}

export async function serveStream(req, res, id) {
  const s = await getSession(id);
  if (!s) { res.writeHead(404); return res.end(); }
  const size = s.tl.bytes;
  let start = 0, end = size - 1, partial = false;
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m) {
    partial = true;
    if (m[1] === '' && m[2] !== '') { start = Math.max(0, size - Number(m[2])); }
    else { start = Number(m[1] || 0); if (m[2] !== '') end = Math.min(size - 1, Number(m[2])); }
    if (start >= size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
  }
  res.writeHead(partial ? 206 : 200, {
    'Content-Type': 'audio/mpeg',
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    'Cache-Control': 'private, max-age=86400, immutable',
    ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
  });
  if (req.method === 'HEAD') return res.end();
  let closed = false;
  res.on('close', () => { closed = true; });
  let pos = start;
  try {
    while (pos <= end && !closed) {
      const c = Math.floor(pos / CHUNK_BYTES);
      const buf = await chunk(s, c);
      if (c + 1 < Math.ceil(size / CHUNK_BYTES)) chunk(s, c + 1).catch(() => {}); // read-ahead
      const from = pos - c * CHUNK_BYTES;
      const to = Math.min(buf.length, end - c * CHUNK_BYTES + 1);
      const ok = res.write(buf.subarray(from, to));
      pos = c * CHUNK_BYTES + to;
      if (!ok && !closed) await new Promise((r) => {
        const done = () => { res.off('drain', done); res.off('close', done); r(); };
        res.once('drain', done); res.once('close', done);
      });
    }
  } catch (e) {
    console.error('[stream]', e);
    res.destroy();
    return;
  }
  res.end();
}

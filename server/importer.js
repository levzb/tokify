import fs from 'node:fs';
import path from 'node:path';
import { db, uid, tx, DIRS } from './db.js';
import { soundInfo, download, SoundError } from './tiktok.js';
import { analyze, normalizeImage, coverColor, coverPath, audioPath } from './audio.js';
import { processExternalTrack } from './external.js';

const jobs = new Map();
const inFlight = new Map();
const waiting = [];
let active = 0;
const CONCURRENCY = 3;
db.exec('CREATE TABLE IF NOT EXISTS import_jobs (id TEXT PRIMARY KEY, state TEXT NOT NULL)');
const persist = (job) => db.prepare('INSERT OR REPLACE INTO import_jobs VALUES (?, ?)').run(job.id, JSON.stringify(job));
const invalid = (message) => Object.assign(new Error(message), { code: 400 });

export function createImport({ name, items }) {
  if (!Array.isArray(items) || !items.length || items.length > 20000) throw invalid('Choose between 1 and 20000 sounds');
  const clean = [], seen = new Set();
  for (const it of items) {
    if (!it || typeof it.musicId !== 'string' || !/^\d{1,22}$/.test(it.musicId)) throw invalid('Invalid TikTok sound ID');
    if (seen.has(it.musicId)) continue;
    seen.add(it.musicId);
    clean.push({ musicId: it.musicId, title: typeof it.title === 'string' ? it.title.slice(0, 500) : 'TikTok sound', date: typeof it.date === 'string' ? it.date.slice(0, 80) : '' });
  }
  const playlistId = uid(), now = Date.now();
  tx(() => {
    db.prepare('INSERT INTO playlists (id, name, kind, created, transition) VALUES (?, ?, ?, ?, ?)').run(playlistId, name, 'import', now, 'crossfade');
    const ins = db.prepare(`INSERT INTO tracks (id, link, title, status, source_name, saved_at, added) VALUES (?, ?, ?, 'pending', ?, ?, ?) ON CONFLICT(id) DO NOTHING`);
    const link = db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, pos) VALUES (?, ?, ?)');
    clean.forEach((it, i) => {
      ins.run(it.musicId, `https://www.tiktok.com/music/sound-${it.musicId}`, it.title, name, it.date, now + i);
      link.run(playlistId, it.musicId, i);
    });
  });
  const job = startJob(playlistId, clean.map((i) => i.musicId), name);
  return { playlistId, jobId: job.id };
}

export function retryTrack(trackId) {
  const t = db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId);
  if (!t) return null;
  const existing = [...jobs.values()].find((j) => !j.finished && j.items[trackId]);
  if (existing) return existing;
  return startJob(null, [trackId], t.title, t.origin === 'external' ? 'external' : 'tiktok');
}

export function startFileJob(trackId, playlistId) {
  const existing = [...jobs.values()].find((j) => !j.finished && j.items[trackId]);
  if (existing) return existing;
  return startJob(playlistId, [trackId], 'Мои файлы', 'external');
}

function startJob(playlistId, ids, name, kind = 'tiktok') {
  const job = { id: uid(), playlistId, name, kind, total: ids.length, done: 0, ok: 0, failed: 0, reused: 0, finished: false, items: {}, started: Date.now() };
  for (const id of ids) job.items[id] = { status: 'queued' };
  jobs.set(job.id, job);
  persist(job);
  runJob(job);
  return job;
}

async function runJob(job) {
  const queue = Object.keys(job.items).filter((id) => !['ok', 'failed'].includes(job.items[id].status));
  tx(() => {
    const pending = db.prepare("UPDATE tracks SET status = 'pending', error = NULL WHERE id = ? AND status != 'ok'");
    for (const id of queue) pending.run(id);
  });
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift();
      job.items[id] = { status: 'working' };
      db.prepare("UPDATE tracks SET status = 'pending', error = NULL WHERE id = ? AND status != 'ok'").run(id);
      persist(job);
      try {
        const reused = await processOnce(id);
        job.items[id] = { status: 'ok', reused };
        job.ok++;
        if (reused) job.reused++;
      } catch (e) {
        const msg = e instanceof SoundError ? e.message : 'Couldn’t process this sound. Check ffmpeg and try again.';
        if (!(e instanceof SoundError)) console.error('[import]', id, e.message);
        db.prepare("UPDATE tracks SET status = 'failed', error = ? WHERE id = ?").run(msg, id);
        job.items[id] = { status: 'failed', error: msg };
        job.failed++;
      }
      job.done++;
      persist(job);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  job.finished = true;
  persist(job);
}

// Bound downloads across all simultaneous imports, and never fetch the same sound twice.
function processOnce(id) {
  if (inFlight.has(id)) return inFlight.get(id).then(() => true);
  const p = (async () => {
    if (active >= CONCURRENCY) await new Promise((r) => waiting.push(r));
    else active++;
    try { return await processTrack(id); }
    finally { if (waiting.length) waiting.shift()(); else active--; }
  })();
  inFlight.set(id, p);
  p.finally(() => inFlight.delete(id)).catch(() => {});
  return p;
}

async function processTrack(id) {
  const existing = db.prepare('SELECT status, audio_file, origin FROM tracks WHERE id = ?').get(id);
  if (existing?.status === 'ok' && existing.audio_file && fs.existsSync(audioPath(existing.audio_file))) return true;
  if (existing?.origin === 'external') return processExternalTrack(id);
  let info;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { info = await soundInfo(id); break; }
    catch (e) { if (!e.retryable || attempt === 1) throw e; }
  }
  // Save useful metadata even if the CDN download fails.
  db.prepare('UPDATE tracks SET title = ?, author = ? WHERE id = ?').run(info.title, info.author, id);
  const tmp = path.join(DIRS.tmp, `${id}-${uid()}`);
  let a, audioFile;
  try {
    const { type } = await download(info.playUrl, tmp, { minBytes: 2000 });
    const ext = /mp4|m4a|aac/.test(type) ? 'm4a' : 'mp3';
    audioFile = `${id}.${ext}`;
    try { a = await analyze(tmp); }
    catch (e) { if (/ENOENT/.test(e.message)) throw e; throw new SoundError('The audio file is damaged'); }
    fs.renameSync(tmp, audioPath(audioFile));
  } finally { fs.rmSync(tmp, { force: true }); }
  let coverFile = null, color = '#ffffff';
  if (info.coverUrl) {
    const ctmp = path.join(DIRS.tmp, `${id}-cover-${uid()}`);
    try {
      await download(info.coverUrl, ctmp, { minBytes: 200, maxBytes: 10 << 20 });
      coverFile = `${id}.jpg`;
      await normalizeImage(ctmp, coverPath(coverFile));
      color = await coverColor(coverPath(coverFile));
    } catch { coverFile = null; } finally { fs.rmSync(ctmp, { force: true }); }
  }
  db.prepare(`UPDATE tracks SET status = 'ok', error = NULL, title = ?, author = ?, samples = ?, trim_start = ?, gain = ?,
    audio_file = ?, cover_file = COALESCE(?, cover_file), color = ?, ver = ver + 1 WHERE id = ?`)
    .run(info.title, info.author, a.samples, a.trimStart, a.gain, audioFile, coverFile, color, id);
  return false;
}

export const jobStatus = (id) => jobs.get(id) || null;
export const listJobs = () => [...jobs.values()].sort((a, b) => b.started - a.started).slice(0, 30);

// Resume unfinished imports after a restart. Completed failures remain visible and retryable.
for (const { state } of db.prepare('SELECT state FROM import_jobs').all()) {
  const job = JSON.parse(state);
  if (job.finished && Date.now() - job.started > 7 * 86400_000) { db.prepare('DELETE FROM import_jobs WHERE id = ?').run(job.id); continue; }
  jobs.set(job.id, job);
  if (!job.finished) setImmediate(() => runJob(job));
}
const resuming = new Set([...jobs.values()].filter((j) => !j.finished).flatMap((j) => Object.keys(j.items)));
for (const { id } of db.prepare("SELECT id FROM tracks WHERE status = 'pending'").all()) {
  if (!resuming.has(id)) db.prepare("UPDATE tracks SET status = 'failed', error = 'Download was interrupted — try again' WHERE id = ?").run(id);
}

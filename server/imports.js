// Getting songs into the library: TikTok export imports, the owner's own audio/video files and
// single links. Every song is processed by one job queue that survives server restarts.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { db, uid, tx, DIRS } from './db.js';
import { run, analyze, normalizeImage, coverColor, coverPath, audioPath, analysisWithClip } from './audio.js';
import { soundInfo, download, SoundError, resolveTikTokLink, rememberSound, runDownloader, resolveMediaSite, fetchMediaCover, MAX_MEDIA_SECONDS, resolveSpotify, spotifyYouTubeMatches } from './sources.js';
import { parseMediaLink, mediaFileError } from './shared.js';

// ---------- job queue ----------
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

export const startLinkJob = (trackId, playlistId, name) => startJob(playlistId, [trackId], name, 'link');

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
  if (['youtube','soundcloud'].includes(existing?.origin)) return processMediaTrack(id);
  let info;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { info = await soundInfo(id); break; }
    catch (e) { if (!e.retryable || attempt === 1) throw e; }
  }
  // Save useful metadata even if the CDN download fails.
  db.prepare('UPDATE tracks SET title = COALESCE(title_override, ?), author = COALESCE(author_override, ?) WHERE id = ?').run(info.title, info.author, id);
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
  a = analysisWithClip(id, a);
  db.prepare(`UPDATE tracks SET status = 'ok', error = NULL, title = COALESCE(title_override, ?), author = COALESCE(author_override, ?), samples = ?, trim_start = ?, gain = ?,
    audio_file = ?, cover_file = COALESCE(?, cover_file), color = ?, base_trim_start=?,base_samples=?,clip_start=?,clip_end=?, ver = ver + 1 WHERE id = ?`)
    .run(info.title, info.author, a.samples, a.trimStart, a.gain, audioFile, coverFile, color, a.baseStart,a.baseSamples,a.clipStart,a.clipEnd, id);
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

// ---------- YouTube and SoundCloud songs ----------
export async function processMediaTrack(id){
  const t=db.prepare('SELECT * FROM tracks WHERE id=?').get(id);
  if(!t || !['youtube','soundcloud'].includes(t.origin))throw new SoundError('Unknown audio source');
  const link=parseMediaLink(t.link),work=path.join(DIRS.tmp,`${id}-${uid()}`);fs.mkdirSync(work,{recursive:true});
  try{
    const info=await resolveMediaSite(link);
    if(info.musicId!==id)throw new SoundError('The link now points to a different track');
    db.prepare('UPDATE tracks SET title=COALESCE(title_override,?),author=COALESCE(author_override,?) WHERE id=?').run(info.title,info.author,id);
    await runDownloader(['-f','bestaudio/best[height<=480]','--max-filesize','512M','--match-filter','!is_live & duration <= 2700',
      '--extract-audio','--audio-format','m4a','--audio-quality','192K','--output',path.join(work,'audio.%(ext)s'),info.sourceUrl],{timeout:12*60_000,maxBytes:1<<20});
    const downloaded=path.join(work,'audio.m4a');if(!fs.existsSync(downloaded))throw new SoundError('No playable audio was downloaded');
    const probe=await run('ffprobe',['-v','error','-show_entries','format=duration','-of','json',downloaded],{maxBytes:10000});
    const seconds=Number(JSON.parse(probe.stdout.toString()).format?.duration || 0);
    if(seconds<info.duration-Math.max(5,info.duration*.15))throw new SoundError('The source returned only part of this recording. The full track is unavailable.');
    if(seconds>MAX_MEDIA_SECONDS+5)throw new SoundError('Maximum length is 45 minutes per track');
    const a=analysisWithClip(id,await analyze(downloaded));const audioFile=id+'.m4a';fs.renameSync(downloaded,audioPath(audioFile));
    let coverFile=null,color=t.color || '#ffffff';
    if(info.coverUrl){const tmp=path.join(work,'cover');try{await fetchMediaCover(info.coverUrl,tmp);coverFile=id+'.jpg';await normalizeImage(tmp,coverPath(coverFile));color=await coverColor(coverPath(coverFile));}catch{coverFile=null;}}
    db.prepare(`UPDATE tracks SET status='ok',error=NULL,title=COALESCE(title_override,?),author=COALESCE(author_override,?),samples=?,trim_start=?,gain=?,audio_file=?,cover_file=COALESCE(?,cover_file),color=?,base_trim_start=?,base_samples=?,clip_start=?,clip_end=?,ver=ver+1 WHERE id=?`)
      .run(info.title,info.author,a.samples,a.trimStart,a.gain,audioFile,coverFile,color,a.baseStart,a.baseSamples,a.clipStart,a.clipEnd,id);
    return false;
  }finally{fs.rmSync(work,{recursive:true,force:true});}
}

// ---------- the owner's audio and video files ----------
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;
const STAGE_LIFETIME = 24 * 3600_000;
const bad = (message, code = 400) => Object.assign(new Error(message), { code });
const stagePath = (token, ext) => path.join(DIRS.uploads, `stage-${token}.${ext}`);
const validToken = (token) => typeof token === 'string' && /^[A-Za-z0-9_-]{12}$/.test(token);

export function stagedFile(token) {
  if (!validToken(token)) throw bad('Invalid file preview');
  let stage;
  try { stage = JSON.parse(fs.readFileSync(stagePath(token, 'json'), 'utf8')); }
  catch { throw bad('File preview expired — choose the file again'); }
  if (stage.expires < Date.now()) { discardStagedFile(token); throw bad('File preview expired — choose the file again'); }
  return stage;
}
export function discardStagedFile(token) {
  if (!validToken(token)) return;
  for (const ext of ['json', 'source', 'jpg']) fs.rmSync(stagePath(token, ext), { force: true });
}
function cleanStages() {
  for (const filename of fs.readdirSync(DIRS.uploads)) {
    const m = /^stage-([A-Za-z0-9_-]{12})\.(json|source|jpg)$/.exec(filename);
    if (!m) continue;
    if (m[2] === 'json') {
      try { stagedFile(m[1]); } catch { discardStagedFile(m[1]); }
    } else if (!fs.existsSync(stagePath(m[1], 'json'))) {
      const stat = fs.statSync(path.join(DIRS.uploads, filename), { throwIfNoEntry: false });
      if (stat && stat.mtimeMs < Date.now() - STAGE_LIFETIME) discardStagedFile(m[1]);
    }
  }
}
cleanStages();
setInterval(cleanStages, 3600_000).unref();
async function inspectMedia(file) {
  let probe;
  try {
    const result = await run('ffprobe', ['-v','error','-protocol_whitelist','file,pipe,crypto,data','-show_streams','-show_format','-of','json',file], { maxBytes: 2 << 20 });
    probe = JSON.parse(result.stdout.toString());
  } catch { throw bad('Unsupported or damaged audio/video file'); }
  if (!probe.streams?.some((s) => s.codec_type === 'audio')) throw bad('This file has no audio track');
  return probe;
}
async function extractCover(src, dest, probe) {
  if (!probe.streams.some((s) => s.codec_type === 'video')) return false;
  try {
    await run('ffmpeg', ['-hide_banner','-loglevel','error','-y','-protocol_whitelist','file,pipe,crypto,data','-i',src,
      '-map','0:v:0','-frames:v','1','-vf',"scale='min(600,iw)':-2",'-q:v','3',dest]);
    return fs.existsSync(dest);
  } catch { fs.rmSync(dest, { force: true }); return false; }
}

// Stage and inspect immediately, before the owner sees the import preview or a library entry exists.
export async function scanFile(req) {
  let meta;
  try { meta = JSON.parse(decodeURIComponent(req.headers['x-file-metadata'] || '')); }
  catch { throw bad('File details are missing'); }
  if (!meta || typeof meta.filename !== 'string') throw bad('File name is missing');
  const filename = path.posix.basename(meta.filename.replaceAll('\\', '/')).slice(0, 500);
  const policyError = mediaFileError(filename, req.headers['content-type'] || '');
  if (policyError) throw bad(policyError);
  if (Number(req.headers['content-length']) > MAX_UPLOAD_BYTES) throw bad('Maximum file size is 512 MB', 413);
  cleanStages();
  const token = uid(), tmp = stagePath(token, 'source');
  const hash = crypto.createHash('sha256'); let size = 0;
  try {
    await pipeline(req, new Transform({ transform(chunk, encoding, next) {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) return next(bad('Maximum file size is 512 MB', 413));
      hash.update(chunk); next(null, chunk);
    } }), fs.createWriteStream(tmp, { flags: 'wx' }));
    if (!size) throw bad('The file is empty');
    const probe = await inspectMedia(tmp);
    const hasCover = await extractCover(tmp, stagePath(token, 'jpg'), probe);
    const id = `file-${hash.digest('hex')}`;
    const stage = { token, id, filename, title: String(meta.title || filename.replace(/\.[^.]+$/, '') || filename).trim().slice(0,300),
      author: String(meta.author || '').trim().slice(0,200), duration: Number(probe.format?.duration || probe.streams.find((s) => s.codec_type === 'audio')?.duration) || 0,
      hasCover, color: hasCover ? await coverColor(stagePath(token, 'jpg')) : '#ffffff', expires: Date.now() + STAGE_LIFETIME };
    fs.writeFileSync(stagePath(token, 'json'), JSON.stringify(stage), { flag: 'wx' });
    return { token, filename, title: stage.title, author: stage.author, duration: stage.duration, color: stage.color,
      cover: hasCover ? `/api/files/staged/${token}/cover` : null };
  } catch (e) { discardStagedFile(token); throw e; }
}

// Both file uploads and TikTok links share the same pinned destination.
export function ensureExternalPlaylist() {
  let playlist = db.prepare("SELECT id,name FROM playlists WHERE kind='external'").get();
  if (!playlist) {
    playlist = { id: uid(), name: 'Мои файлы' };
    db.prepare("INSERT INTO playlists (id,name,kind,created) VALUES (?,?,'external',?)").run(playlist.id, playlist.name, Date.now());
  }
  return playlist;
}

export function commitFile({ token, title, author }) {
  const stage = stagedFile(token);
  title = typeof title === 'string' ? title.trim().slice(0,300) : stage.title;
  author = typeof author === 'string' ? author.trim().slice(0,200) : stage.author;
  if (!title) throw bad('Enter a title');
  const existing = db.prepare('SELECT status,audio_file,original_file FROM tracks WHERE id=?').get(stage.id);
  const reused = existing?.status === 'ok' && existing.audio_file && fs.existsSync(audioPath(existing.audio_file));
  let originalFile = existing?.original_file || null;
  const source = stagePath(token, 'source');
  if (!reused && (!originalFile || !fs.existsSync(path.join(DIRS.uploads, originalFile)))) {
    if (!fs.existsSync(source)) throw bad('Original file is missing — choose the file again');
    originalFile = stage.id;
    fs.renameSync(source, path.join(DIRS.uploads, originalFile));
  }
  let coverFile = null;
  if (stage.hasCover && fs.existsSync(stagePath(token, 'jpg'))) {
    coverFile = `${stage.id}.jpg`;
    fs.copyFileSync(stagePath(token, 'jpg'), coverPath(coverFile));
  }
  let playlistId;
  tx(() => {
    const playlist = ensureExternalPlaylist();
    playlistId = playlist.id;
    db.prepare(`INSERT INTO tracks (id,link,title,author,status,source_name,added,origin,original_name,original_file,cover_file,color)
      VALUES (?, '', ?, ?, 'pending', ?, ?, 'external', ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,author=excluded.author,original_name=excluded.original_name,
      original_file=COALESCE(excluded.original_file,tracks.original_file),cover_file=COALESCE(excluded.cover_file,tracks.cover_file),ver=tracks.ver+1`)
      .run(stage.id,title,author,playlist.name,Date.now(),stage.filename,originalFile,coverFile,stage.color);
    const pos = db.prepare('SELECT COALESCE(MAX(pos),-1)+1 AS n FROM playlist_tracks WHERE playlist_id=?').get(playlistId).n;
    db.prepare('INSERT OR IGNORE INTO playlist_tracks VALUES (?,?,?)').run(playlistId,stage.id,pos);
  });
  discardStagedFile(token);
  return { trackId: stage.id, playlistId, reused: !!reused };
}

// Retain the raw upload API with the same validation for non-browser callers.
export async function receiveFile(req) {
  let meta;
  try { meta=JSON.parse(decodeURIComponent(req.headers['x-file-metadata']||'')); } catch {}
  const stage = await scanFile(req);
  return commitFile({token:stage.token,title:meta?.title,author:meta?.author});
}

export async function processExternalTrack(id) {
  const t = db.prepare('SELECT * FROM tracks WHERE id=?').get(id);
  if (!t?.original_file) throw new SoundError('Choose the original file and upload it again');
  const src=path.join(DIRS.uploads,path.basename(t.original_file));
  if (!fs.existsSync(src)) throw new SoundError('Original file is missing — upload it again');
  let probe;
  try { probe=await inspectMedia(src); } catch(e) { throw new SoundError(e.message); }
  const audioFile=`${id}.m4a`, tmpAudio=path.join(DIRS.tmp,`${id}-${uid()}.m4a`); let a;
  try {
    await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-protocol_whitelist','file,pipe,crypto,data','-i',src,
      '-map','0:a:0','-vn','-c:a','aac','-b:a','192k','-ac','2','-ar','48000','-movflags','+faststart',tmpAudio]);
    a=await analyze(tmpAudio); fs.renameSync(tmpAudio,audioPath(audioFile));
  } catch { throw new SoundError('Couldn’t extract playable audio from this file'); }
  finally { fs.rmSync(tmpAudio,{force:true}); }
  let coverFile=t.cover_file || null, color=t.color || '#ffffff';
  if (!coverFile) {
    const tempCover=path.join(DIRS.tmp,`${id}-${uid()}.jpg`);
    try {
      if (await extractCover(src,tempCover,probe)) {
        coverFile=`${id}.jpg`;await normalizeImage(tempCover,coverPath(coverFile));color=await coverColor(coverPath(coverFile));
      }
    } catch { coverFile=null; }
    finally { fs.rmSync(tempCover,{force:true}); }
  }
  a=analysisWithClip(id,a);
  db.prepare(`UPDATE tracks SET status='ok',error=NULL,samples=?,trim_start=?,gain=?,audio_file=?,cover_file=COALESCE(?,cover_file),color=?,original_file=NULL,base_trim_start=?,base_samples=?,clip_start=?,clip_end=?,ver=ver+1 WHERE id=?`)
    .run(a.samples,a.trimStart,a.gain,audioFile,coverFile,color,a.baseStart,a.baseSamples,a.clipStart,a.clipEnd,id);
  fs.rmSync(src,{force:true});return false;
}

// ---------- single links (search first, then import) ----------
const previews = new Map();
const readyTrack = (id) => {
  const t = db.prepare("SELECT * FROM tracks WHERE id=? AND status='ok'").get(id);
  return t?.audio_file && fs.existsSync(audioPath(t.audio_file)) ? t : null;
};

export async function previewLink(input, { resolve } = {}) {
  let link;
  try { link = parseMediaLink(input); } catch (e) { throw bad(e.message); }
  const known = !link.musicId && db.prepare('SELECT id FROM tracks WHERE link=? AND origin=?').get(link.url,link.provider);
  let t = (link.musicId || known?.id) && readyTrack(link.musicId || known.id), info;
  if (t) info = { musicId: t.id, title: t.title, author: t.author, duration: t.samples / 48000 };
  else {
    try { info = resolve ? await resolve(link.url) : link.provider === 'tiktok' ? await resolveTikTokLink(link.url) : link.provider === 'spotify' ? await resolveSpotify(link) : await resolveMediaSite(link); } catch (e) { throw bad(e.message); }
    t = info.musicId && readyTrack(info.musicId);
  }
  if (t) info = { ...info, title: t.title, author: t.author, duration: t.samples / 48000 };
  info.provider ||= link.provider;
  info.sourceUrl ||= t?.link || link.url;
  // No library entries or audio files are created by a search.
  const token = uid();
  const entry = { info, track: t, expires: Date.now() + 10 * 60_000 };
  for (const [key, p] of previews) if (p.expires < Date.now()) previews.delete(key);
  if (previews.size >= 100) previews.delete(previews.keys().next().value);
  previews.set(token, entry);
  const membership = t && db.prepare("SELECT pt.playlist_id FROM playlist_tracks pt JOIN playlists p ON p.id=pt.playlist_id WHERE pt.track_id=? AND p.kind='external' LIMIT 1").get(t.id);
  return { token, provider:info.provider, sourceUrl:info.sourceUrl, canDownload:info.provider!=='spotify' && !info.metadataOnly, musicId: info.musicId, title: info.title, author: info.author, duration: info.duration,
    cover: (t?.custom_cover || t?.cover_file || info.coverUrl) ? `/api/links/previews/${token}/cover` : null,
    saved: !!membership, playlistId: membership?.playlist_id || null };
}
function preview(token) {
  const p = typeof token === 'string' && previews.get(token);
  if (!p || p.expires < Date.now()) {
    if (p) previews.delete(token);
    throw bad('Search preview expired — find the sound again');
  }
  return p;
}

export async function linkPreviewCover(token) {
  const p = preview(token);
  if (p.track?.custom_cover) return fs.readFileSync(path.join(DIRS.custom, p.track.custom_cover));
  if (p.track?.cover_file) return fs.readFileSync(coverPath(p.track.cover_file));
  if (!p.info.coverUrl) return null;
  if (!p.cover) p.cover = (async () => {
    const tmp = path.join(DIRS.tmp, `link-cover-${token}`), jpg = tmp + '.jpg';
    try {
      if (p.info.provider === 'tiktok') await download(p.info.coverUrl, tmp, { minBytes: 200, maxBytes: 10 << 20 });
      else await fetchMediaCover(p.info.coverUrl, tmp);
      await normalizeImage(tmp, jpg);
      return fs.readFileSync(jpg);
    } catch { return null; }
    finally { fs.rmSync(tmp, { force: true }); fs.rmSync(jpg, { force: true }); }
  })();
  return p.cover;
}

export function downloadLink(token) {
  const p = preview(token);
  if (p.info.metadataOnly || p.info.provider === 'spotify') throw bad('Spotify does not provide a full audio download. Choose a YouTube source first.');
  if (p.result) return p.result;
  let playlist;
  tx(() => {
    playlist = ensureExternalPlaylist();
    db.prepare(`INSERT INTO tracks (id,link,title,author,status,source_name,added,origin)
      VALUES (?,?,?,?,'pending',?,?,?) ON CONFLICT(id) DO NOTHING`)
      .run(p.info.musicId, p.info.sourceUrl || `https://www.tiktok.com/music/sound-${p.info.musicId}`, p.info.title, p.info.author || '', playlist.name, Date.now(), p.info.provider || 'tiktok');
    const pos = db.prepare('SELECT COALESCE(MAX(pos),-1)+1 AS n FROM playlist_tracks WHERE playlist_id=?').get(playlist.id).n;
    db.prepare('INSERT OR IGNORE INTO playlist_tracks VALUES (?,?,?)').run(playlist.id, p.info.musicId, pos);
  });
  if (p.info.provider === 'tiktok') rememberSound(p.info);
  const job = startLinkJob(p.info.musicId, playlist.id, playlist.name);
  return p.result = { trackId: p.info.musicId, playlistId: playlist.id, jobId: job.id };
}


export async function searchSpotifyLink(token) {
  const p=preview(token);
  try { return { candidates: await spotifyYouTubeMatches(p.info) }; }
  catch(e) { throw bad(e.message); }
}

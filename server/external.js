import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { db, tx, DIRS, uid } from './db.js';
import { run, analyze, normalizeImage, coverColor, coverPath, audioPath } from './audio.js';
import { SoundError } from './tiktok.js';
import { analysisWithClip } from './clips.js';
import { mediaFileError } from '../shared/media.js';

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

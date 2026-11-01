import fs from 'node:fs';
import path from 'node:path';
import { db, tx, uid, DIRS } from './db.js';
import { resolveTikTokLink, rememberSound, download } from './tiktok.js';
import { parseMediaLink } from '../shared/media-link.js';
import { resolveMediaSite, fetchMediaCover } from './media-sites.js';
import { resolveSpotify, spotifyYouTubeMatches } from './spotify.js';
import { ensureExternalPlaylist } from './external.js';
import { startLinkJob } from './importer.js';
import { audioPath, coverPath, normalizeImage } from './audio.js';

const previews = new Map();
const bad = (message) => Object.assign(new Error(message), { code: 400 });
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

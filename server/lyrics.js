// Lyrics for a song in the library. A song with a real name is looked up by it. Most sounds come from TikTok as
// "original sound" with no real name, so those are recognised by Shazam first (server/shazam.py: three short clips, at least two must agree, and a slowed
// copy when the sound was sped up), then its text is looked up on Genius, with LRCLIB as a fallback.
// Results are kept in the `lyrics` table, so asking again is instant; "Try again" asks afresh.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { db, DIRS } from './db.js';
import { tool, dataDir } from './system.js';
import { audioPath } from './audio.js';
import { pluginLyrics, hasLyricsProviders } from './plugins.js';
import { cleanSongQuery, createGeniusProvider, createGeniusPageFetcher } from './genius.js';

db.exec(`CREATE TABLE IF NOT EXISTS lyrics (
  track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  status TEXT NOT NULL,           -- found | nolyrics | instrumental | unknown
  title TEXT, artist TEXT,        -- what the song turned out to be
  text TEXT, source TEXT,         -- plain lyrics and where they came from
  checked INTEGER
)`);
// Lyrics with timings (LRC), kept when they fit this very recording, so the words can follow the song.
if (!db.prepare('PRAGMA table_info(lyrics)').all().some((c) => c.name === 'synced')) db.exec('ALTER TABLE lyrics ADD COLUMN synced TEXT');
// Whether Shazam has listened to this sound. It only listens when asked (the button in the lyrics panel), and what it
// heard is kept: looking again searches by that name instead of asking Shazam once more.
if (!db.prepare('PRAGMA table_info(lyrics)').all().some((c) => c.name === 'heard')) {
  db.exec('ALTER TABLE lyrics ADD COLUMN heard INTEGER NOT NULL DEFAULT 0');
  db.exec("UPDATE lyrics SET heard = 1 WHERE source = 'Shazam' OR status = 'unknown'"); // looked up before: Shazam listened then
}

const WIN = process.platform === 'win32';
const UA = 'Tokify (self-hosted music player)';
const LRCLIB = process.env.TOKIFY_LRCLIB || 'https://lrclib.net'; // tests point it at a stand-in
const tokenFile = path.join(dataDir(), 'genius-token.txt');
const genius = createGeniusProvider({
  token: process.env.TOKIFY_GENIUS_TOKEN || process.env.GENIUS_ACCESS_TOKEN || (fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : ''),
  baseUrl: process.env.TOKIFY_GENIUS_URL || 'https://genius.com',
  apiUrl: process.env.TOKIFY_GENIUS_API || 'https://api.genius.com',
  // Tests/custom endpoints use ordinary HTTP. Real song pages use the Chrome transport installed by setup.
  pageFetcher: process.env.TOKIFY_GENIUS_URL ? undefined : (url, options) => {
    const python = process.env.TOKIFY_GENIUS_PYTHON || shazamPython();
    return fs.existsSync(python) ? createGeniusPageFetcher(python)(url) : fetch(url, options);
  },
});
const CLIP = 12;          // seconds per clip sent to Shazam
const SLOWER = 0.84;      // TikTok's sped-up sounds are usually ~1.2× faster with the pitch raised
const bad = (message, code = 400) => Object.assign(new Error(message), { code });

export const shazamPython = () => path.join(dataDir(), 'tools', 'shazam', WIN ? 'Scripts/python.exe' : 'bin/python');
const GENERIC = /^(original sound|оригинальный звук|оригінальний аудіозапис|son original|sonido original|som original|suono originale|originalton|orijinal ses|dźwięk oryginalny|nguyên bản|sound|звук)\b/i;

const out = (r) => r ? { status: r.status, title: r.title || '', artist: r.artist || '', text: r.text || '', source: r.source || '', lines: parseLrc(r.synced), heard: !!r.heard } : { status: 'new' };

/** "[01:02.50] words" lines → [{ t: seconds, text }], in time order. A line may carry several times. */
export function parseLrc(lrc) {
  if (!lrc) return [];
  const lines = [];
  for (const raw of String(lrc).split(/\r?\n/)) {
    const times = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (!times.length) continue;
    const text = raw.slice(times.at(-1).index + times.at(-1)[0].length).trim();
    for (const m of times) lines.push({ t: Math.round((Number(m[1]) * 60 + Number(m[2].replace(':', '.'))) * 100) / 100, text });
  }
  lines.sort((a, b) => a.t - b.t);
  // An empty line is a pause; two in a row say nothing more.
  return lines.filter((l, i) => l.text || (i > 0 && lines[i - 1].text));
}
// Timings fit only the same cut of a song: within a few seconds of the recording's length.
const FITS = 3.5;
const fits = (r, seconds) => !!(r?.syncedLyrics && seconds && Math.abs(Number(r.duration) - seconds) <= FITS);
const recordingSeconds = (t) => ((t.base_samples ?? t.samples) + (t.base_trim_start ?? t.trim_start ?? 0)) / 48000;
function store(id, row) {
  db.prepare(`INSERT INTO lyrics (track_id,status,title,artist,text,source,checked,synced,heard) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(track_id) DO UPDATE SET status=excluded.status,title=excluded.title,artist=excluded.artist,text=excluded.text,source=excluded.source,checked=excluded.checked,synced=excluded.synced,heard=excluded.heard`)
    .run(id, row.status, row.title, row.artist, row.text, row.source, Date.now(), row.synced || null, row.heard ? 1 : 0);
}

/**
 * After a Spotify song is downloaded: try LRCLIB's exact title, artist and length for timed words,
 * then the usual Genius/LRCLIB lookup for plain text.
 * Timings are kept only when they fit the downloaded recording. Nothing is stored when nothing is found,
 * so opening the lyrics later still looks the usual way.
 */
export async function saveSyncedLyrics(id, want, seconds) {
  const artist = firstArtist(want.author);
  let hit = null;
  try {
    const q = new URLSearchParams({ track_name: want.title, artist_name: artist, duration: String(Math.round(want.duration || seconds)) });
    hit = await get(`${LRCLIB}/api/get?${q}`);
  } catch {}
  if (!hit?.syncedLyrics && !hit?.plainLyrics && !hit?.instrumental) {
    const found = await lookupLyrics(want.title, want.author, seconds).catch(() => null);
    if (!found) return null;
    if (found.source === 'Genius') {
      store(id, { status: 'found', ...pick(found), text: found.text, source: 'Genius' });
      return lyricsOf(id);
    }
    hit = { trackName: found.title, artistName: found.artist, plainLyrics: found.text, syncedLyrics: found.synced, duration: found.duration, instrumental: found.instrumental };
  }
  if (hit.instrumental) store(id, { status: 'instrumental', title: hit.trackName, artist: hit.artistName, text: '', source: 'LRCLIB' });
  else {
    const synced = fits(hit, seconds) ? hit.syncedLyrics : null;
    const text = (hit.plainLyrics || '').trim() || parseLrc(hit.syncedLyrics).map((l) => l.text).join('\n');
    if (!text) return null;
    store(id, { status: 'found', title: hit.trackName, artist: hit.artistName, text, source: 'LRCLIB', synced });
  }
  return lyricsOf(id);
}
export const lyricsOf = (id) => out(db.prepare('SELECT * FROM lyrics WHERE track_id=?').get(id));

/**
 * Looks a song's words up and keeps them. By its name only, unless `listen`: then Shazam recognises the sound
 * first (once; what it heard is remembered, see `heard` below). A sound with no real name is not looked up at all
 * until asked to listen: it answers { status: 'unheard' } and nothing is kept.
 */
const running = new Map();
export function findLyrics(id, { listen = false } = {}) {
  const key = `${id}:${listen ? 1 : 0}`;
  if (!running.has(key)) running.set(key, look(id, listen).finally(() => running.delete(key)));
  return running.get(key);
}
// Songs Shazam recognised whose words could not be fetched (a provider was down): asking again skips Shazam.
const heardNow = new Map();

async function look(id, listen) {
  const t = db.prepare('SELECT * FROM tracks WHERE id=?').get(id);
  if (!t) throw bad('Song not found', 404);
  // A song that already carries a real name (a YouTube import, a renamed sound) is looked up by it first: fast,
  // and it spares Shazam, which only answers so many questions a minute. "original sound"s go straight to Shazam.
  const named = !!t.title.trim() && !GENERIC.test(t.title.trim());
  const hasAudio = !!t.audio_file && fs.existsSync(audioPath(t.audio_file));
  if (!named && !hasAudio) throw bad('This song has no audio yet. Download it first.');
  // What Shazam heard before (kept with the words, or remembered since a failed lookup) stands in for listening again.
  const before = db.prepare('SELECT title, artist, heard, text, source FROM lyrics WHERE track_id=?').get(id);
  const heard = heardNow.get(`${id}:${t.ver}`) || (before?.heard && before.title
    ? { title: before.title, artist: before.artist || '', lyrics: before.source === 'Shazam' ? before.text : '' } : null);
  const shazamDid = !!before?.heard || !!heard;
  if (!named && !listen && !heard) return { status: 'unheard', title: '', artist: '', text: '', source: '', lines: [], heard: false };
  let found = null, song = null, lookupError = null;
  const lookup = async (title, artist) => {
    try { return await lookupLyrics(title, artist, seconds); }
    catch (e) { lookupError = e; return null; }
  };
  // Timings only for whole songs: a TikTok sound is usually a sped-up stretch of one.
  const seconds = t.origin === 'tiktok' ? 0 : recordingSeconds(t);
  if (named) { const guess = cleanSongQuery(t.title, t.author); found = await lookup(guess.title, guess.artist); }
  if (!found && heard) { song = heard; found = await lookup(song.title, song.artist); }
  else if (!found && hasAudio && listen) {
    song = await recognise(t);
    if (song) heardNow.set(`${id}:${t.ver}`, song);
    found = song && await lookup(song.title, song.artist);
  }
  // A blocked provider is a temporary failure, not evidence that the song has no lyrics. Do not cache it.
  if (!found && !song?.lyrics && lookupError) throw lookupError;
  let row;
  if (found?.instrumental) row = { status: 'instrumental', ...pick(found), text: '', source: found.source };
  else if (found?.text) row = { status: 'found', ...pick(found), text: found.text, source: found.source, synced: found.synced || null };
  else if (song?.lyrics) row = { status: 'found', ...pick(song), text: song.lyrics, source: 'Shazam' };
  else if (song) row = { status: 'nolyrics', ...pick(song), text: '', source: '' };
  else if (named) row = { status: 'nolyrics', title: '', artist: '', text: '', source: '' };
  else row = { status: 'unknown', title: '', artist: '', text: '', source: '' };
  row.heard = shazamDid || listen;
  // Plugins (Settings → Plugins) get a say when Tokify found no timed words: an aligner can time plain ones,
  // another source can find what LRCLIB and Genius could not. Their answer wins only when it brings more.
  if (row.status !== 'instrumental' && !row.synced && hasLyricsProviders()) {
    const extra = await pluginLyrics({ id, title: t.title, author: t.author, origin: t.origin, seconds: recordingSeconds(t) },
      { audioFile: hasAudio ? audioPath(t.audio_file) : null, text: row.text || '', title: row.title || song?.title || '', artist: row.artist || song?.artist || '' });
    const words = extra && (extra.text || parseLrc(extra.synced || '').map((l) => l.text).join('\n')).trim();
    if (extra && (extra.synced || (words && !row.text))) row = { status: 'found', title: row.title, artist: row.artist, text: words || row.text, source: extra.source, synced: extra.synced, heard: row.heard };
  }
  store(id, row);
  heardNow.delete(`${id}:${t.ver}`);
  return lyricsOf(id);
}
const pick = (x) => ({ title: x.title || '', artist: x.artist || '' });

// ---------- recognition ----------
function run(cmd, args, timeout) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => p.kill('SIGKILL'), timeout);
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(new Error(stderr.trim().split('\n').at(-1) || `exit ${code}`)); });
  });
}

// Where to listen: three spots spread over the sound (TikTok sounds are often a few seconds long).
function spots(seconds) {
  if (seconds <= CLIP + 2) return [0];
  if (seconds <= CLIP * 2.5) return [0, Math.max(0, seconds - CLIP)];
  return [0.12, 0.42, 0.7].map((f) => Math.round(Math.min(seconds - CLIP, seconds * f)));
}

// Shazam answers only so many questions from one computer; past that it says "too many requests" and keeps
// saying it for a while. One recognition at a time, and after such an answer it is left alone for 10 minutes.
let queue = Promise.resolve(), restUntil = 0, lastAsked = 0;
const REST = 10 * 60_000;
// And never two questions closer than this, even when asked by hand: Shazam's flood limits are per computer.
const GAP = Number(process.env.TOKIFY_SHAZAM_GAP ?? 10_000);
async function spaced() {
  const wait = lastAsked + GAP - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAsked = Date.now();
}
function recognise(t) {
  const turn = queue.then(() => recogniseNow(t));
  queue = turn.catch(() => {});
  return turn;
}

async function recogniseNow(t) {
  const py = shazamPython();
  if (!fs.existsSync(py)) throw bad('Song recognition is not installed yet. Run: npm run setup', 503);
  if (Date.now() < restUntil) throw bad(`Shazam asked for a break after many songs in a row. Try again in ${Math.ceil((restUntil - Date.now()) / 60_000)} min.`, 503);
  const seconds = ((t.base_samples ?? t.samples) + (t.trim_start || 0)) / 48000;
  for (const speed of [1, SLOWER]) {
    const files = [];
    try {
      for (const at of spots(seconds)) {
        const file = path.join(DIRS.tmp, `shazam-${crypto.randomUUID()}.wav`);
        // Slowed like a record turned down: tempo and pitch together, the way sped-up sounds were made.
        const af = speed === 1 ? [] : ['-af', `aresample=44100,asetrate=${Math.round(44100 * speed)},aresample=16000`];
        await run(tool('ffmpeg'), ['-v', 'error', '-y', '-ss', String(at), '-i', audioPath(t.audio_file), '-ac', '1', ...af, '-ar', '16000', '-t', String(CLIP), file], 30_000);
        files.push(file);
      }
      await spaced();
      const answers = JSON.parse(await run(py, [path.join(import.meta.dirname, 'shazam.py'), ...files], 90_000) || '[]');
      // Every clip failed to get an answer (offline, or Shazam asking to slow down): say so, remember nothing.
      if (answers.some((a) => /rate limit/i.test(a?.error || ''))) {
        restUntil = Date.now() + REST;
        throw bad('Shazam asked for a break after many songs in a row. Try again in 10 min.', 503);
      }
      if (answers.length && answers.every((a) => a?.error)) throw bad('Shazam isn’t answering right now. Try again in a minute.', 503);
      const song = agree(answers);
      if (song) return song;
    } finally {
      for (const f of files) fs.rm(f, { force: true }, () => {});
    }
  }
  return null;
}

// Shazam sometimes names a different song for one stretch of a sound; take only what two clips agree on
// (or the only clip of a very short sound).
function agree(answers) {
  const hits = answers.filter((a) => a?.title);
  if (answers.length === 1) return hits[0] || null;
  const votes = new Map();
  for (const h of hits) {
    const k = h.key || `${norm(h.title)}|${norm(h.artist)}`;
    votes.set(k, [...(votes.get(k) || []), h]);
  }
  const best = [...votes.values()].sort((a, b) => b.length - a.length)[0];
  return best && best.length >= 2 ? { ...best[0], lyrics: best.find((h) => h.lyrics)?.lyrics || '' } : null;
}

// ---------- lyrics ----------
const norm = (s) => String(s || '').toLowerCase()
  .replace(/\s*[([].*?[)\]]\s*/g, ' ').replace(/\s+(feat\.?|ft\.?|featuring)\s.*$/i, '')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const firstArtist = (s) => String(s || '').split(/\s*(?:,|&| x | и | feat\.?|ft\.?)\s*/i)[0];

async function lookupLyrics(title, artist, seconds) {
  const errors = [];
  try { const found = await genius(title, artist); if (found) return found; }
  catch (e) {
    errors.push(e);
    // A title-only Genius search can identify the artist even when the lyrics page is blocked.
    if (!artist && e.song?.artist) artist = e.song.artist.replace(/\s*\([^)]*\)\s*$/, '');
  }
  try { const found = await lrclib(title, artist, seconds); if (found) return { ...found, source: 'LRCLIB' }; }
  catch (e) { errors.push(e); }
  if (errors.length) throw bad(errors.map((e) => e.message).join(' '), 502);
  return null;
}

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12_000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`LRCLIB answered ${r.status}`);
  return r.json();
}

async function lrclib(title, artist, seconds = 0) {
  if (!title) return null;
  const q = new URLSearchParams({ track_name: title });
  if (artist) q.set('artist_name', firstArtist(artist));
  let list = [];
  try {
    list = (await get(`${LRCLIB}/api/search?${q}`)) || [];
    if (!list.length) list = (await get(`${LRCLIB}/api/search?${new URLSearchParams({ q: `${title} ${firstArtist(artist)}`.trim() })}`)) || [];
  } catch (e) { throw bad(`Couldn’t reach the lyrics service. ${e.message}`, 502); }
  const T = norm(title), A = norm(firstArtist(artist));
  const same = list.filter((r) => {
    const rt = norm(r.trackName), ra = norm(r.artistName);
    return rt === T && (!A || ra === A || norm(firstArtist(r.artistName)) === A);
  });
  if (!same.length) return null;
  // Without an artist, several different songs can have exactly the same title.
  if (!A && new Set(same.map((r) => norm(r.artistName))).size > 1) return null;
  const withText = same.filter((r) => r.plainLyrics?.trim());
  // Several uploads of one song: the fullest text wins (short ones are usually cut).
  const best = withText.sort((a, b) => b.plainLyrics.length - a.plainLyrics.length)[0];
  // Timings from the upload whose length matches this recording, closest first.
  const timed = same.filter((r) => fits(r, seconds)).sort((a, b) => Math.abs(a.duration - seconds) - Math.abs(b.duration - seconds))[0];
  if (best) return { title: best.trackName, artist: best.artistName, text: best.plainLyrics.trim(), synced: timed?.syncedLyrics || null, duration: timed?.duration };
  if (same.some((r) => r.instrumental)) return { title: same[0].trackName, artist: same[0].artistName, instrumental: true };
  return null;
}

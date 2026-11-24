// Search: one field for words and links on Home (Search.svelte). Lives outside the page so results
// and downloads survive going to a playlist and coming back.
// Words search YouTube as you type; a link is looked up as it is. The hit in the big slot is the "hero";
// any hit can be previewed (30 s), downloaded, or downloaded and trimmed. Downloads run per hit, side by side.
import { api } from './util.js';
import { load, go, toast, ui, followImport } from './state.svelte.js';
import { pausePlayback } from './player.svelte.js';
import { parseMediaLink, parsePlaylistLink, providerName } from '../server/shared.js';

const RECENT_KEY = 'tokify.recent-searches';
function readRecent() {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 6) : []; }
  catch { return []; }
}

export const search = $state({
  q: '',
  phase: 'idle',        // idle | searching | ready
  kind: '',             // words | link
  lookup: '',           // what is being asked ("YouTube", "TikTok"…)
  hits: [],             // [{ title, author, duration, url, cover }]
  hitsFor: '',
  hero: '',             // url of the hit in the big slot ('' = the link card)
  card: null,           // a looked-up link
  list: null,           // a looked-up playlist: { token, name, owner, songs, total, playlistId, fresh… }
  listing: false,       // its import is being started
  cards: {},            // url -> looked-up details (token, saved, playlistId…)
  dl: {},               // url -> { state: downloading | done | failed }
  matching: false,      // Spotify → YouTube
  error: '',
  open: false,          // the field has the room (Home steps aside)
  recent: readRecent(),
  prev: { url: '', state: 'idle', t: 0, cover: '' },
});

let version = 0;
export const isLink = (s) => /https?:\/\/|\b(tiktok|youtube|youtu|soundcloud|spotify)\.(com|be|link|app)\b/i.test(s || '');
export const previewable = (x) => ['youtube', 'soundcloud'].includes(x?.provider);
export const PREVIEW = 30;

// ---------- what sits in the big slot ----------
export function heroOf() {
  if (search.hero) {
    const hit = search.hits.find((h) => h.url === search.hero);
    if (!hit) return null;
    const c = search.cards[hit.url];
    return { ...(c || {}), ...hit, provider: c?.provider || hit.provider, sourceUrl: hit.url, art: hit.cover ? `${hit.cover}?s=hq` : c?.cover, wide: true, ready: !!c };
  }
  const c = search.card && (search.cards[search.card.sourceUrl] || search.card);
  return c ? { ...c, url: c.sourceUrl, art: c.cover, wide: c.provider === 'youtube', ready: true } : null;
}

// ---------- recent searches (this browser only) ----------
export function remember(q) {
  q = (q || '').trim();
  if (q.length < 2 || isLink(q)) return;
  search.recent = [q, ...search.recent.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, 6);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(search.recent)); } catch {}
}
export function forgetAll() {
  search.recent = [];
  try { localStorage.setItem(RECENT_KEY, '[]'); } catch {}
}
export function forget(q) {
  search.recent = search.recent.filter((r) => r !== q);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(search.recent)); } catch {}
}

// ---------- typing ----------
let timer = 0;
export function typed(value) {
  search.q = value;
  clearTimeout(timer);
  const q = value.trim();
  if (!q) { reset(); return; }
  version++; // whatever was on its way is for older words
  if (search.phase === 'searching') search.phase = search.hits.length || search.card ? 'ready' : 'idle';
  if (!isLink(q) && q.length >= 3) timer = setTimeout(() => submit(q, { quiet: true }), 450);
}
export function reset() {
  clearTimeout(timer); version++; quiet();
  Object.assign(search, { phase: 'idle', kind: '', hits: [], hitsFor: '', hero: '', card: null, list: null, error: '', matching: false });
}
export function submit(text = search.q, { quiet: auto = false } = {}) {
  clearTimeout(timer);
  const q = (text || '').trim();
  if (!q) return;
  if (isLink(q)) return openLink(q);
  if (!auto) remember(q);
  if (q === search.hitsFor && search.hits.length && search.phase === 'ready') return;
  return words(q);
}

async function words(q) {
  const v = ++version; quiet();
  Object.assign(search, { phase: 'searching', kind: 'words', lookup: 'YouTube', hero: '', card: null, list: null, error: '' });
  try {
    const r = await api('/api/search', { method: 'POST', body: { q } });
    if (v !== version) return;
    Object.assign(search, { hits: r.results, hitsFor: q, phase: 'ready' });
    if (!r.results.length) { search.error = `Nothing found for “${q}”. Try other words or paste a link.`; return; }
    search.hero = r.results[0].url;
    look(search.hero).catch(() => {});
    for (const h of r.results.slice(0, 3)) warm(h.url, h.duration);
  } catch (e) { if (v === version) { search.error = e.message; search.phase = search.hits.length ? 'ready' : 'idle'; } }
}

export async function openLink(text) {
  let parsed;
  try { parsed = parsePlaylistLink(text) || parseMediaLink(text); } catch (e) { reset(); search.error = e.message; return; }
  const v = ++version; quiet();
  search.q = parsed.url;
  Object.assign(search, { phase: 'searching', kind: parsed.kind === 'playlist' || parsed.kind === 'album' ? 'list' : 'link', lookup: providerName(parsed.provider),
    hits: [], hitsFor: '', hero: '', card: null, list: null, error: '' });
  try {
    const c = await api('/api/links/resolve', { method: 'POST', body: { link: parsed.url } });
    if (v !== version) return;
    // A share link can turn out to be a whole playlist.
    if (c.kind === 'playlist') { Object.assign(search, { list: c, kind: 'list', phase: 'ready' }); return; }
    search.cards[c.sourceUrl] = c;
    Object.assign(search, { card: c, phase: 'ready' });
    if (previewable(c) && !c.saved) warm(c.sourceUrl, c.duration);
  } catch (e) { if (v === version) { search.error = e.message; search.phase = 'idle'; } }
}

// Details (and a download token) for a hit; kept per url.
async function look(url) {
  if (search.cards[url]) return search.cards[url];
  const c = await api('/api/links/resolve', { method: 'POST', body: { link: url } });
  search.cards[url] = c;
  return c;
}

export function choose(hit) {
  remember(search.hitsFor);
  search.hero = hit.url;
  look(hit.url).catch((e) => { search.error = e.message; });
}

export async function findOnYouTube() {
  const c = search.card;
  if (!c || search.matching) return;
  const v = version; search.matching = true; search.error = '';
  try {
    const r = await api('/api/links/spotify/search', { method: 'POST', body: { token: c.token } });
    if (v !== version) return;
    Object.assign(search, { hits: r.candidates, hitsFor: '' });
    if (!r.candidates.length) search.error = 'No YouTube matches found. Paste a YouTube or SoundCloud link directly.';
    for (const h of r.candidates.slice(0, 3)) warm(h.url, h.duration);
  } catch (e) { if (v === version) search.error = e.message; }
  finally { if (v === version) search.matching = false; }
}

// ---------- downloading ----------
async function follow(jobId, c) {
  for (let i = 0; i < 300; i++) {
    const job = await api(`/api/jobs/${jobId}`);
    if (job.finished) {
      await load();
      if (job.failed) throw new Error(job.items[c.musicId]?.error || 'Couldn’t download this sound. Try again.');
      return job;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Still downloading. Check your playlist in a moment.');
}
export async function download(url, trim = false) {
  if (!url || search.dl[url]?.state === 'downloading') return;
  search.error = '';
  if (search.hitsFor) remember(search.hitsFor);
  try {
    let c = await look(url);
    if (c.saved) { if (trim) ui.clipTrackId = c.musicId; else go('playlist', c.playlistId); return; }
    if (c.canDownload === false) return;
    search.dl[url] = { state: 'downloading' };
    let job;
    try { job = await api('/api/links/download', { method: 'POST', body: { token: c.token } }); }
    catch (e) {
      if (!/expired/i.test(e.message)) throw e;
      delete search.cards[url]; c = await look(url);
      job = await api('/api/links/download', { method: 'POST', body: { token: c.token } });
    }
    await load();
    const done = await follow(job.jobId, c);
    search.cards[url] = { ...c, saved: true, playlistId: done.playlistId || job.playlistId };
    search.dl[url] = { state: 'done' };
    if (trim) ui.clipTrackId = c.musicId;
    else if (!search.open) toast(`“${c.title}” saved to ${done.name}`);
  } catch (e) {
    search.dl[url] = { state: 'failed' };
    search.error = e.message;
    await load().catch(() => {});
  }
}
/** Imports the looked-up playlist: every song not in the library yet downloads, and the playlist follows along. */
export async function importList() {
  const l = search.list;
  if (!l || search.listing) return;
  search.listing = true; search.error = '';
  try {
    let r;
    try { r = await api('/api/links/playlist/import', { method: 'POST', body: { token: l.token } }); }
    catch (e) {
      if (!/expired/i.test(e.message)) throw e;
      const again = await api('/api/links/resolve', { method: 'POST', body: { link: l.sourceUrl } });
      Object.assign(l, again);
      r = await api('/api/links/playlist/import', { method: 'POST', body: { token: again.token } });
    }
    l.playlistId = r.playlistId; l.fresh = 0;
    if (r.jobId) followImport(r);
    else { await load(); toast(`“${r.name}” is up to date`); }
  } catch (e) { search.error = e.message; }
  finally { search.listing = false; }
}
export function dlState(url) {
  const d = search.dl[url]?.state;
  if (d) return d;
  return search.cards[url]?.saved ? 'done' : '';
}

// ---------- 30-second previews ----------
// The server cuts them from a quarter of the way in. YouTube makes the downloader wait a few seconds, so
// the first hits are prepared as soon as they arrive and the rest on hover. The main player pauses meanwhile.
let audio = null;
const warmed = new Set();
function player30() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'none';
  audio.addEventListener('playing', () => { if (search.prev.url) search.prev.state = 'playing'; });
  audio.addEventListener('timeupdate', () => { if (search.prev.url) search.prev.t = Math.min(PREVIEW, audio.currentTime); });
  audio.addEventListener('ended', quiet);
  audio.addEventListener('error', () => { if (search.prev.url) { toast('Couldn’t play a preview of this track'); quiet(); } });
  return audio;
}
export function warm(url, duration = 0) {
  if (!url || warmed.has(url)) return;
  warmed.add(url);
  api('/api/preview/warm', { method: 'POST', body: { url, duration } }).catch(() => warmed.delete(url));
}
export function listen(item) {
  const url = item?.sourceUrl || item?.url;
  if (!url) return;
  if (search.prev.url === url) { quiet(); return; }
  if (search.hitsFor) remember(search.hitsFor);
  pausePlayback();
  search.prev = { url, state: 'loading', t: 0, cover: item.art || item.cover || '' };
  const a = player30();
  a.src = `/api/preview?url=${encodeURIComponent(url)}&d=${Math.round(item.duration || 0)}`;
  a.play().catch(() => {});
}
export function quiet() {
  audio?.pause();
  if (search.prev.url) search.prev = { url: '', state: 'idle', t: 0, cover: '' };
}

// ---------- ways in ----------
// "/" or ⌘K / Ctrl+K from anywhere: to Home, into the field.
if (typeof window !== 'undefined') {
  addEventListener('keydown', (e) => {
    const t = e.target, typing = t?.matches?.('input, textarea, [contenteditable="true"]');
    if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey)) {
      e.preventDefault();
      if (ui.route.name !== 'home') go('home');
      setTimeout(() => document.querySelector('.room-field input')?.focus(), ui.route.name === 'home' ? 0 : 80);
    }
  });
  // A link download that was running when the page was closed still reports when it is done.
  queueMicrotask(() => api('/api/jobs').then(({ jobs }) => {
    const job = jobs.find((j) => j.kind === 'link' && !j.finished);
    if (!job) return;
    follow(job.id, { musicId: Object.keys(job.items)[0] }).then((j) => toast(`Saved to ${j.name}`)).catch((e) => toast(e.message));
  }).catch(() => {}));
}

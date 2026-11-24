// App-wide state: screen and popups (ui), the music library (lib), and background
// TikTok imports and offline downloads that keep running while the owner browses.
import { api, trackSec } from './util.js';

// ---------- screen, popups, toasts ----------
export const ui = $state({
  route: { name: 'home', id: null },
  toast: null,
  menu: null,          // { x, y, items, sheet }
  dialog: null,        // { kind, title, text, value, confirm, danger, resolve }
  queueOpen: false,
  nowPlayingOpen: false,
  importJob: null,     // { jobId, playlistId, name }
  importOpen: false,
  importSource: null,
  fileImportSource: null,
  fileImportOpen: false,
  filesBusy: false,
  downloadOpen: false,
  downloadSource: null,
  clipTrackId: null,
  lyricsOpen: false,
  soundOpen: false,
  soundTrackId: null,
  lyricsTrackId: null, // null: the lyrics follow the song that is playing
  libraryView: 'imports',
  search: '',
});

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, id] = h.split('/');
  if (name === 'p' && id) return { name: 'playlist', id: decodeURIComponent(id) };
  if (name === 'settings') return { name: 'settings', id: null };
  return { name: 'home', id: null };
}
ui.route = parseHash();
addEventListener('hashchange', () => {
  const left = ui.route;
  ui.route = parseHash();
  if (left.name === 'playlist' && left.id !== ui.route.id) discardDraft(left.id);
  ui.menu = null;
  document.querySelector('.main-scroll')?.scrollTo({ top: 0 });
});

export const go = (name, id) => { location.hash = name === 'playlist' ? `#/p/${encodeURIComponent(id)}` : name === 'settings' ? '#/settings' : '#/'; };

let toastTimer;
export function toast(text, { action, onAction, ms = 2600 } = {}) {
  clearTimeout(toastTimer);
  ui.toast = { text, action, onAction, key: Math.random() };
  toastTimer = setTimeout(() => { ui.toast = null; }, action ? 5000 : ms);
}

export function openMenu(e, items, { anchor } = {}) {
  const coarse = matchMedia('(max-width: 760px), (pointer: coarse)').matches;
  let x = 0, y = 0;
  if (anchor) { const r = anchor.getBoundingClientRect(); x = r.right; y = r.bottom + 6; }
  else if (e) { x = e.clientX; y = e.clientY; }
  ui.menu = { x, y, items, sheet: coarse, key: Math.random() };
}

export function ask(opts) {
  return new Promise((resolve) => { ui.dialog = { ...opts, resolve }; });
}

export function pickImage() {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = () => resolve(inp.files?.[0] || null);
    inp.click();
  });
}

// ---------- library ----------
export const lib = $state({ loaded: false, tracks: {}, order: [], playlists: [] });

export async function load() {
  const data = await api('/api/library');
  const tracks = {};
  for (const t of data.tracks) tracks[t.id] = t;
  lib.tracks = tracks;
  lib.order = data.tracks.map((t) => t.id);
  lib.playlists = data.playlists;
  lib.loaded = true;
}

export const playlistById = (id) => lib.playlists.find((p) => p.id === id);
export const tracksOf = (pl) => (pl?.trackIds || []).map((id) => lib.tracks[id]).filter(Boolean);
export const playable = (t) => t && t.status === 'ok' && t.samples > 0;
export const totalSec = (tracks) => tracks.reduce((a, t) => a + (playable(t) ? trackSec(t) : 0), 0);
export const imports = () => [
  ...lib.playlists.filter((p) => p.kind === 'external'),
  ...lib.playlists.filter((p) => p.kind === 'import').slice().reverse(),
];

/** Songs from all imports, newest first, each once. */
export function allSongs() {
  const seen = new Set();
  const out = [];
  for (const pl of imports()) for (const id of pl.trackIds) if (!seen.has(id) && lib.tracks[id]) { seen.add(id); out.push(lib.tracks[id]); }
  for (const id of lib.order) if (!seen.has(id) && lib.tracks[id]) { seen.add(id); out.push(lib.tracks[id]); }
  return out;
}

const guard = async (fn, msg) => {
  try { return await fn(); } catch (e) { toast(e.message || msg); await load().catch(() => {}); throw e; }
};

// A playlist made with "New playlist" stays a draft until it gets a name, a cover or a song.
// Leaving it untouched removes it, so stray clicks don't pile up "My playlist #7".
const drafts = new Map(); // id -> the name it was given

export async function createPlaylist(name, trackIds = []) {
  const n = lib.playlists.filter((p) => p.kind === 'custom').length + 1;
  const given = name || `My playlist #${n}`;
  const { id } = await guard(() => api('/api/playlists', { method: 'POST', body: { name: given, trackIds } }));
  if (!name && !trackIds.length) drafts.set(id, given);
  await load();
  return id;
}

async function discardDraft(id) {
  if (!drafts.has(id)) return;
  const given = drafts.get(id), pl = playlistById(id);
  drafts.delete(id);
  if (pl && pl.name === given && !pl.cover && !pl.trackIds.length) await deletePlaylist(id).catch(() => {});
}

export async function patchPlaylist(id, patch) {
  const pl = playlistById(id);
  if (pl) Object.assign(pl, patch);
  await guard(() => api(`/api/playlists/${id}`, { method: 'PATCH', body: patch }));
}

export async function deletePlaylist(id) {
  lib.playlists = lib.playlists.filter((p) => p.id !== id);
  await guard(() => api(`/api/playlists/${id}`, { method: 'DELETE' }));
  await load();
}

export async function addToPlaylist(id, trackIds) {
  const pl = playlistById(id);
  const { added } = await guard(() => api(`/api/playlists/${id}/tracks`, { method: 'POST', body: { trackIds } }));
  await load();
  if (trackIds.length === 1) toast(added ? `Added to “${pl?.name}”` : `Already in “${pl?.name}”`);
  else toast(`Added ${added} to “${pl?.name}”`);
}

export async function removeFromPlaylist(id, trackId) {
  const pl = playlistById(id);
  if (pl) pl.trackIds = pl.trackIds.filter((t) => t !== trackId);
  await guard(() => api(`/api/playlists/${id}/tracks/${trackId}`, { method: 'DELETE' }));
  await load();
}

export async function setPlaylistCover(id, file) {
  await guard(() => api(`/api/playlists/${id}/cover`, { method: 'PUT', raw: file }), 'Couldn’t set the cover');
  await load();
}
export async function clearPlaylistCover(id) {
  await guard(() => api(`/api/playlists/${id}/cover`, { method: 'DELETE' }));
  await load();
}
export async function setTrackCover(id, file) {
  await guard(() => api(`/api/tracks/${id}/cover`, { method: 'PUT', raw: file }), 'Couldn’t set the cover');
  await load();
  toast('Cover updated');
}
export async function clearTrackCover(id) {
  await guard(() => api(`/api/tracks/${id}/cover`, { method: 'DELETE' }));
  await load();
}

export async function patchTrack(id, details) {
  await guard(() => api(`/api/tracks/${id}`, { method: 'PATCH', body: details }));
  await load();
}

export async function retryTrack(id) {
  const t = lib.tracks[id];
  if (t) { t.status = 'pending'; t.error = null; }
  const { jobId } = await guard(() => api(`/api/tracks/${id}/retry`, { method: 'POST' }));
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const j = await api(`/api/jobs/${jobId}`).catch(() => null);
    if (!j || j.finished) break;
  }
  await load();
  const after = lib.tracks[id];
  toast(after?.status === 'ok' ? 'Sound downloaded' : `Still unavailable: ${after?.error || 'error'}`);
}

// ---------- TikTok import in progress ----------
export async function startImport(name, items) {
  const { playlistId, jobId } = await api('/api/imports', { method: 'POST', body: { name, items } });
  ui.importJob = { jobId, playlistId, name, total: items.length, done: 0, ok: 0, failed: 0, reused: 0, finished: false, items: {}, order: items.map((i) => i.musicId) };
  await load();
  poll();
}

/** Shows the progress of an import the server has started (a whole playlist from a link). */
export function followImport({ jobId, playlistId, name, total, order }) {
  ui.importJob = { jobId, playlistId, name, total, done: 0, ok: 0, failed: 0, reused: 0, finished: false, items: {}, order };
  load().catch(() => {}).finally(poll);
}

export async function restoreImport() {
  const { jobs } = await api('/api/jobs');
  const job = jobs.find((j) => !j.finished && j.kind !== 'external' && j.kind !== 'link');
  if (!job) return;
  ui.importJob = { ...job, jobId: job.id, order: Object.keys(job.items) };
  poll();
}

let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  let lastLoad = 0;
  while (ui.importJob && !ui.importJob.finished) {
    await new Promise((r) => setTimeout(r, 700));
    const job = ui.importJob;
    if (!job) break;
    try {
      const s = await api(`/api/jobs/${job.jobId}`);
      const before = job.done;
      Object.assign(job, s);
      if (s.done !== before && Date.now() - lastLoad > 1200) { lastLoad = Date.now(); await load(); }
    } catch (e) {
      if (e.status === 404) { ui.importJob = null; toast('Import status is unavailable. Check your uploads.'); break; }
    }
  }
  await load().catch(() => {});
  polling = false;
  const j = ui.importJob;
  if (j && !ui.importOpen) toast(`“${j.name}” is ready: ${j.ok} of ${j.total}`);
}

// ---------- offline download in progress ----------
export const download = $state({ job: null, busy: false, error: '' });
let following = null;
export function openDownload(source) {
  if (!download.busy) { download.job = null; download.error = ''; }
  ui.downloadSource = source;
  ui.downloadOpen = true;
}
export async function prepareDownload(options) {
  download.error = ''; download.busy = true;
  try {
    download.job = await api('/api/exports', { method: 'POST', body: options });
    follow(download.job.id);
  } catch (e) { download.error = e.message; download.busy = false; }
}
async function follow(id) {
  if (following === id) return;
  following = id;
  try {
    while (following === id) {
      const job = await api(`/api/exports/${id}`);
      download.job = job;
      if (job.status === 'ready' || job.status === 'error') {
        download.busy = false;
        if (job.status === 'error') download.error = job.error;
        else if (!ui.downloadOpen) toast('Your offline download is ready', { action:'Open', onAction:()=>{ui.downloadOpen=true;}, ms:6000 });
        break;
      }
      await new Promise((r) => setTimeout(r, 900));
    }
  } catch (e) { download.error = e.message + ' Preparing continues on the computer; reopen Downloads after reconnecting.'; download.busy = false; }
  finally { if (following === id) following = null; }
}
export async function restoreDownload() {
  try {
    const { jobs } = await api('/api/exports');
    const job = jobs.find((j)=>['queued','building'].includes(j.status));
    if (job) { download.job=job;download.busy=true;follow(job.id); }
  } catch { /* Other parts of the library remain available. */ }
}

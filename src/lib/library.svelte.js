import { api } from './api.js';
import { toast } from './ui.svelte.js';
import { trackSec } from './format.js';

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

export async function createPlaylist(name, trackIds = []) {
  const n = lib.playlists.filter((p) => p.kind === 'custom').length + 1;
  const { id } = await guard(() => api('/api/playlists', { method: 'POST', body: { name: name || `My playlist #${n}`, trackIds } }));
  await load();
  return id;
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

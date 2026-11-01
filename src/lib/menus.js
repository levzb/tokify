import { lib, playable, addToPlaylist, createPlaylist, removeFromPlaylist, setTrackCover, clearTrackCover, retryTrack, playlistById, patchTrack } from './library.svelte.js';
import { playNext, addToQueue, contextChanged, trackDetailsChanged } from './player.svelte.js';
import { pickImage, go, toast, ask, ui } from './ui.svelte.js';
import { openDownload } from './download.svelte.js';

export function addToPlaylistItems(trackIds, exceptId) {
  const items = [{
    label: 'New playlist', icon: 'plus',
    action: async () => { const id = await createPlaylist(null, trackIds); toast('Playlist created'); go('playlist', id); },
  }];
  const others = lib.playlists.filter((p) => p.id !== exceptId);
  if (others.length) items.push({ sep: true });
  for (const p of others.slice().reverse()) items.push({ label: p.name, action: () => addToPlaylist(p.id, trackIds).then(() => contextChanged(p.id)) });
  return items;
}

export function trackMenu(t, { playlistId = null } = {}) {
  const ok = playable(t);
  const items = [];
  if (ok) {
    items.push({ label: 'Play next', icon: 'playNext', action: () => playNext(t.id) });
    items.push({ label: 'Add to queue', icon: 'addQueue', action: () => addToQueue(t.id) });
    items.push({ sep: true });
  }
  items.push({ label: 'Add to playlist', icon: 'listAdd', sub: addToPlaylistItems([t.id], playlistId) });
  items.push({ label: 'Rename song', icon: 'edit', action: async () => {
    const title = await ask({ kind: 'prompt', title: 'Song title', value: t.title, confirm: 'Save', maxlength: 300 });
    if (title) { await patchTrack(t.id, { title }); trackDetailsChanged(t.id); }
  } });
  items.push({ label: 'Edit author', icon: 'edit', action: async () => {
    const author = await ask({ kind: 'prompt', title: 'Author', value: t.author || '', confirm: 'Save', allowEmpty: true, maxlength: 200 });
    if (author !== null) { await patchTrack(t.id, { author }); trackDetailsChanged(t.id); }
  } });
  if (ok) items.push({ label: 'Trim audio', icon: 'cut', action: () => { ui.clipTrackId=t.id; } });
  if (ok) items.push({ label: 'Download audio', icon: 'download', action: () => openDownload({trackIds:[t.id],name:t.title}) });
  items.push({ label: 'Set custom cover', icon: 'image', action: async () => { const f = await pickImage(); if (f) await setTrackCover(t.id, f); } });
  if (t.customCover) items.push({ label: 'Restore original cover', icon: 'retry', action: () => clearTrackCover(t.id) });
  if (t.status === 'failed') items.push({ label: 'Try downloading again', icon: 'retry', action: () => retryTrack(t.id) });
  if (playlistId) {
    const pl = playlistById(playlistId);
    items.push({ sep: true });
    items.push({ label: 'Remove from playlist', icon: 'remove', danger: true, action: async () => { await removeFromPlaylist(playlistId, t.id); contextChanged(playlistId); toast(`Removed from “${pl?.name}”`); } });
  }
  return items;
}

// The stage: the window becomes the song that is playing, its cover's light and its words, with only the
// player left at the bottom (Stage.svelte draws it, App.svelte clears the room). It fills the browser window,
// not the screen. F, Esc or the icon go in and out.
import { ui } from './state.svelte.js';
import { player } from './player.svelte.js';

export const stage = $state({ open: false });

export function openStage() {
  if (!player.trackId) return;
  stage.open = true;
  ui.nowPlayingOpen = false;
}
export function closeStage() { stage.open = false; }
export const toggleStage = () => (stage.open ? closeStage() : openStage());

if (typeof window !== 'undefined') {
  const typing = (el) => !!el?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
    if (e.key === 'Escape' && stage.open) { e.preventDefault(); e.stopPropagation(); closeStage(); }
    else if ((e.key === 'f' || e.key === 'F') && !e.repeat && !ui.clipTrackId) { e.preventDefault(); toggleStage(); }
  }, true);
}

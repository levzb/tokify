<script>
  import Icon from './Icon.svelte';
  import { lib } from '../lib/library.svelte.js';
  import { addToPlaylistItems } from '../lib/menus.js';
  import { openMenu } from '../lib/ui.svelte.js';

  let { selecting = $bindable(false), selected = $bindable(new Set()), exceptId = null, mode = 'all' } = $props();
  function cancel() { selecting = false; selected = new Set(); }
  function addSelection(e) {
    const ids = [...selected].filter((id) => lib.tracks[id]);
    if (!ids.length) return;
    const items = addToPlaylistItems(ids, exceptId).map((item) => !item.action ? item : {
      ...item,
      action: async () => {
        try { await item.action(); cancel(); }
        catch { /* The library action shows the error; keep the selection for retry. */ }
      },
    });
    openMenu(e, items, { anchor: e.currentTarget });
  }
</script>

<div class="selection-actions">
  {#if mode !== 'actions' && (!selecting || mode === 'toggle')}
    <button class="icon-btn select" class:on={selecting} onclick={() => selecting ? cancel() : (selecting = true)}
      aria-label="Select" aria-pressed={selecting} title={selecting ? 'Cancel selection' : 'Select songs'}>
      <Icon name="check" size={20} />
    </button>
  {/if}
  {#if selecting && mode !== 'toggle'}
    <button class="btn quiet" onclick={cancel}>Cancel</button>
    <button class="btn primary" disabled={!selected.size} onclick={addSelection} aria-haspopup="menu">
      <Icon name="listAdd" size={16} /> Add to playlist
    </button>
  {/if}
</div>

<style>
  .selection-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
  .select { width: 44px; height: 44px; }
  @media (max-width: 760px) {
    .btn { padding-inline: 12px; }
  }
</style>

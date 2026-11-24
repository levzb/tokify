<script>
  // The one panel (desktop). It stays put while what is inside it changes (Modal.svelte moves its content
  // in here), so going from the queue to a download is a change of content, not a new window.
  // Content is the colour: the top of the panel catches the light of what it shows, or of the room.
  import { fade } from 'svelte/transition';
  import { blurred, SIZE } from './blur.js';
  import { roomLight } from './Ambient.svelte';
  import { sheets, SHEET_W } from './dock.svelte.js';

  const open = $derived(sheets.list.length > 0);
  const lit = $derived(sheets.list.findLast((s) => s.art)?.art || roomLight()?.cover || '');
  // Hold the last light while it slides away.
  let light = $state('');
  $effect(() => { if (open && lit) light = lit; });
</script>

<div class="sheet-frame" class:open style:--sheet-w="{SHEET_W}px" aria-hidden={!open || null}>
  {#key light}
    {#if light}
      <div class="glow" aria-hidden="true" in:fade={{ duration: 700 }} out:fade={{ duration: 700 }}>
        <canvas width={SIZE} height={SIZE} use:blurred={light}></canvas>
      </div>
    {/if}
  {/key}
</div>

<script>
  // What goes inside the one panel. On desktop there is a single sheet (SheetFrame.svelte), docked opposite
  // the rail; opening something else while it is open swaps only what is inside it, the panel stays put.
  // A dialog (`stack`) sits over the current content instead of replacing it, which returns once it closes.
  // On a phone each one is a bottom sheet over a dim. Escape closes whatever is on top.
  // Content is the colour: the panel catches the light of `art` (or of the room); `thumb` shows it by the title.
  // Keys pressed inside never reach the player shortcuts (space, arrows).
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Icon from './Icon.svelte';
  import Cover from './Cover.svelte';
  import { blurred, SIZE } from './blur.js';
  import { roomLight } from './Ambient.svelte';
  import { openSheet, closeSheet, reopenSheet, topSheet, sheets } from './dock.svelte.js';

  let { label = '', title = '', lead = '', size = '', z = null, art = '', thumb = false, stack = false,
    closeButton = true, closeLabel = 'Close', closeDisabled = false, headless = false, onclose, children } = $props();
  let panel, root;
  const docked = !matchMedia('(max-width: 760px)').matches;
  let entry = $state(null);
  const under = $derived(!!entry && sheets.list.at(-1)?.id !== entry.id);
  const phoneArt = $derived(docked ? '' : art || roomLight()?.cover || '');

  onMount(() => {
    // Into the panel itself, so a swap is only new content inside the same frame.
    if (docked) document.querySelector('.sheet-frame')?.append(root);
    entry = openSheet({ art, stack, close: () => onclose?.() });
    panel.focus({ preventScroll: true });
    return () => closeSheet(entry.id);
  });
  $effect(() => { if (entry) entry.art = art; });
  function esc(e) {
    if (e.key === 'Escape' && entry?.id === topSheet() && !closeDisabled && !e.defaultPrevented) { e.preventDefault(); onclose(); }
  }
  // Swapped for something else: fades out in place. Closed: rides out with the panel. Phone: drops away.
  function away(node) {
    // Gone for assistive tech at once; Svelte marks a leaving element inert and clears it if the same
    // one is brought back before it is gone, which hands the panel back to it.
    node.setAttribute('aria-hidden', 'true');
    const back = new MutationObserver(() => {
      if (node.inert || !node.isConnected) return;
      back.disconnect(); node.removeAttribute('aria-hidden'); if (entry) reopenSheet(entry);
    });
    back.observe(node, { attributes: true, attributeFilter: ['inert'] });
    setTimeout(() => back.disconnect(), 500);
    return () => {
      const swap = sheets.list.some((s) => s.id !== entry?.id);
      if (entry) closeSheet(entry.id);
      if (!docked) return fly(node, { y: 48, duration: 240, easing: cubicOut, opacity: 0 });
      if (swap) return { duration: 140, easing: cubicOut, css: (t) => `opacity:${t}` };
      return { duration: 240 };
    };
  }
</script>

<svelte:window onkeydown={esc} />

<div class="overlay" style:z-index={docked ? null : z} role="presentation" bind:this={root} onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="modal {size}" class:under style:z-index={docked ? null : z} role="dialog" aria-label={label || title} aria-hidden={under || null} tabindex="-1" bind:this={panel}
    out:away|global onkeydown={(e) => { if (e.key !== 'Escape') e.stopPropagation(); }}>
    {#if phoneArt}
      <div class="glow" aria-hidden="true">
        {#key phoneArt}<canvas width={SIZE} height={SIZE} use:blurred={phoneArt}></canvas>{/key}
      </div>
    {/if}
    <header class="modal-head">
      {#if thumb && art}<span class="head-art"><Cover src={art} size={52} radius={6} /></span>{/if}
      <div class="head-txt">
        {#if title && !headless}<h3>{title}</h3>{/if}
        {#if lead && !headless}<p class="lead">{lead}</p>{/if}
      </div>
      {#if closeButton}<button class="icon-btn sm close" aria-label={closeLabel} disabled={closeDisabled} onclick={onclose}><Icon name="x" size={18} /></button>{/if}
    </header>
    {@render children()}
  </div>
</div>

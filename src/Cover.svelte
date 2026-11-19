<script>
  // A song cover, or a playlist cover: custom image, else a 2x2 mosaic of its first covers.
  import Icon from './Icon.svelte';
  let { src = null, srcs = null, size = 48, radius = 10, alt = '', dim = false } = $props();
  const list = $derived((srcs || []).filter(Boolean));
</script>

<div class="cover" class:dim style="--s:{typeof size === 'number' ? size + 'px' : size}; --r:{radius}px">
  {#if src}
    <img {src} {alt} loading="lazy" draggable="false" />
  {:else if list.length >= 4}
    <div class="mosaic">{#each list.slice(0, 4) as s}<img src={s} alt="" loading="lazy" draggable="false" />{/each}</div>
  {:else if list.length}
    <img src={list[0]} {alt} loading="lazy" draggable="false" />
  {:else}
    <div class="empty"><Icon name="note" size={24} stroke={1.6} /></div>
  {/if}
</div>

<style>
  .cover {
    width: var(--s); height: var(--s); flex: none; border-radius: var(--r); overflow: hidden;
    background: #111; position: relative;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,.06);
  }
  .cover img { width: 100%; height: 100%; object-fit: cover; user-select: none; -webkit-user-drag: none; }
  .mosaic { display: grid; grid-template-columns: 1fr 1fr; width: 100%; height: 100%; }
  .empty :global(svg) { width: 36%; height: 36%; }
  .empty { width: 100%; height: 100%; display: grid; place-items: center; color: var(--muted-2); background: linear-gradient(160deg, #1a1a1a, #0b0b0b); }
  .dim img { filter: grayscale(1); opacity: .45; }
</style>

<script>
  // The rail: a narrow island with Home, a new-playlist button and every playlist as its cover.
  // Names show as a tooltip on hover; phones turn it into the bottom bar.
  import { lib, tracksOf, ui, go, createPlaylist } from './state.svelte.js';
  import { player } from './player.svelte.js';
  import { search, quiet } from './search.svelte.js';
  import { songs } from './util.js';
  import Cover from './Cover.svelte';
  import Icon from './Icon.svelte';
  import { layout, movable, flip, nextSide } from './dock.svelte.js';

  const covers = (pl) => tracksOf(pl).filter((t) => t.cover && t.status === 'ok').slice(0, 4).map((t) => t.cover);
  const kind = (pl) => (pl.kind === 'custom' ? 'Playlist' : 'Upload');
  let tip = $state(null);
  function showTip(e, text, sub = '') {
    if (matchMedia('(hover: none), (max-width: 760px)').matches) return;
    const r = e.currentTarget.getBoundingClientRect();
    tip = layout.rail === 'right' ? { text, sub, y: r.top + r.height / 2, x: r.left - 10, flip: true } : { text, sub, y: r.top + r.height / 2, x: r.right + 10 };
  }
  async function create() { go('playlist', await createPlaylist()); }
</script>

<nav class="rail island" aria-label="Sections" use:movable={'rail'}>
  <button class="item home" class:active={ui.route.name === 'home'} onclick={() => { quiet(); search.open = false; go('home'); }}
    onmouseenter={(e) => showTip(e, 'Home')} onmouseleave={() => (tip = null)} aria-label="Home">
    <Icon name="home" size={22} />
  </button>
  <button class="item gear" class:active={ui.route.name === 'settings'} onclick={() => go('settings')}
    onmouseenter={(e) => showTip(e, 'Settings')} onmouseleave={() => (tip = null)} aria-label="Settings">
    <Icon name="settings" size={22} />
  </button>
  <button class="item add" onclick={create} onmouseenter={(e) => showTip(e, 'Create playlist')} onmouseleave={() => (tip = null)}
    aria-label="Create playlist"><Icon name="plus" size={22} /></button>

  <span class="rule" aria-hidden="true"></span>

  <div class="list">
    {#each lib.playlists as pl (pl.id)}
      {@const tr = tracksOf(pl)}
      <button class="item" class:active={ui.route.name === 'playlist' && ui.route.id === pl.id}
        class:playing={player.contextId === pl.id && player.playing}
        onclick={() => go('playlist', pl.id)}
        onmouseenter={(e) => showTip(e, pl.name, `${kind(pl)} · ${songs(tr.length)}`)} onmouseleave={() => (tip = null)} aria-label={pl.name}>
        <span class="art"><Cover src={pl.cover} srcs={covers(pl)} size="100%" radius={6} /></span>
      </button>
    {/each}
  </div>

  <button class="grip" onclick={() => flip('rail')} aria-label="Move the sidebar to the {nextSide('rail')}"
    onmouseenter={(e) => showTip(e, 'Drag to move', `Or click to move it ${nextSide('rail')}`)} onmouseleave={() => (tip = null)}>
    <Icon name="grip" size={18} />
  </button>
</nav>
{#if tip}
  <div class="tip frost" class:flip={tip.flip} style="top:{tip.y}px; left:{tip.x}px">
    <span class="tip-t">{tip.text}</span>{#if tip.sub}<span class="tip-s">{tip.sub}</span>{/if}
  </div>
{/if}

<style>
  .rail {
    grid-area: rail; position: relative; z-index: 20; min-height: 0;
    -webkit-backdrop-filter: none; backdrop-filter: none; /* the same dark island as the player; nothing scrolls under it */
    display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 0;
  }
  .item {
    position: relative; display: grid; place-items: center; width: 48px; height: 48px; flex: none; padding: 0;
    color: var(--faint); background: none; border: none; border-radius: var(--r-item); cursor: pointer;
    transition: background .15s, color .15s, transform .15s var(--ease);
  }
  .item:hover, .item.active { color: var(--text); }
  .item:active { transform: scale(.92); }
  /* The gear turns a little as you reach for it, and stays turned while Settings is open. */
  .gear :global(svg) { transition: transform .5s var(--ease); }
  .gear:hover :global(svg) { transform: rotate(45deg); }
  .gear.active :global(svg) { transform: rotate(90deg); }
  .rule { width: 24px; height: 1px; margin: 6px 0; background: var(--edge); flex: none; }
  .list { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; min-height: 0; width: 100%; padding: 6px 0; overflow-y: auto; overflow-x: hidden; }
  .art { width: 40px; height: 40px; border-radius: var(--r-xs); transition: box-shadow .15s; }
  .list .item.active .art { box-shadow: 0 0 0 2px rgba(255, 255, 255, .85); }
  .item.playing::after { content: ''; position: absolute; right: 1px; top: 50%; width: 3px; height: 14px; margin-top: -7px; border-radius: 2px; background: var(--accent); }

  .tip {
    position: fixed; z-index: 300; transform: translateY(-50%); display: flex; flex-direction: column;
    padding: 7px 11px; max-width: 280px; border-radius: var(--r-control); pointer-events: none; animation: fadeIn .12s ease both;
  }
  .tip.flip { transform: translate(-100%, -50%); }
  .rail { cursor: grab; }
  .rail :global(.item) { cursor: pointer; }
  .grip {
    flex: none; width: 48px; height: 32px; margin-top: 4px; display: grid; place-items: center; padding: 0;
    color: var(--faint); background: none; border: none; cursor: grab; opacity: .5;
    transition: color .15s, opacity .15s;
  }
  .rail:hover .grip, .grip:focus-visible { opacity: 1; }
  .grip:hover { color: var(--text); }
  :global(.rail.lifted) { z-index: 60; box-shadow: 0 24px 60px rgba(0, 0, 0, .55); transition: none; }
  .tip-t { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tip-s { font-size: 12px; color: var(--faint); white-space: nowrap; }

  /* phone: the bottom bar */
  @media (max-width: 760px) {
    .rail {
      flex-direction: row; gap: 8px; padding: 8px 12px calc(8px + var(--safe-b)); border-radius: 0;
      background: rgba(10, 10, 12, .72); border-top: 1px solid var(--edge);
    }
    .item { width: 48px; height: 48px; }
    .grip { display: none; }
    .rail { cursor: auto; }
    .rule { width: 1px; height: 24px; margin: 0 2px; }
    .list { flex-direction: row; overflow-x: auto; overflow-y: hidden; gap: 6px; flex: 1; width: auto; padding: 6px; }
    .art { width: 42px; height: 42px; }
    .list .item.active { background: none; }
    .item.playing::after { left: 50%; right: auto; top: auto; bottom: -3px; width: 14px; height: 3px; margin: 0 0 0 -7px; }
  }
</style>

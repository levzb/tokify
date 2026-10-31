<script>
  import { lib, tracksOf } from '../lib/library.svelte.js';
  import { ui, go } from '../lib/ui.svelte.js';
  import { player } from '../lib/player.svelte.js';
  import Cover from './Cover.svelte';

  const covers = (pl) => tracksOf(pl).filter((t) => t.cover && t.status === 'ok').slice(0, 4).map((t) => t.cover);
  let tip = $state(null);
  function showTip(e, text) {
    if (matchMedia('(hover: none)').matches) return;
    const r = e.currentTarget.getBoundingClientRect();
    tip = { text, y: r.top + r.height / 2 };
  }
</script>

<nav class="rail" aria-label="Sections">
  <button class="item home" class:active={ui.route.name === 'home'} onclick={() => go('home')}
    onmouseenter={(e) => showTip(e, 'Home')} onmouseleave={() => (tip = null)} aria-label="Home">
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" stroke-width="4"/>
      <path d="M50 11Q55 45 89 50Q55 55 50 89Q45 55 11 50Q45 45 50 11Z" fill="currentColor"/>
    </svg>
  </button>
  <div class="sep"></div>
  <div class="list">
    {#each lib.playlists as pl (pl.id)}
      <button class="item" class:active={ui.route.name === 'playlist' && ui.route.id === pl.id}
        class:playing={player.contextId === pl.id && player.playing}
        onclick={() => go('playlist', pl.id)}
        onmouseenter={(e) => showTip(e, pl.name)} onmouseleave={() => (tip = null)} aria-label={pl.name}>
        <Cover src={pl.cover} srcs={covers(pl)} size="100%" radius={10} />
      </button>
    {/each}
  </div>
</nav>
{#if tip}<div class="tip" style="top:{tip.y}px">{tip.text}</div>{/if}

<style>
  .rail {
    grid-area: rail; position: relative; z-index: 20;
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    padding: 18px 0;
    background: #000; border-right: 1px solid var(--border);
    animation: fadeIn .8s ease both;
  }
  .list { display: flex; flex-direction: column; align-items: center; gap: 10px; overflow-y: auto; overflow-x: hidden; padding: 8px 0; width: 100%; scrollbar-width: none; }
  .list::-webkit-scrollbar { display: none; }
  .sep { width: 28px; height: 1px; background: var(--border); flex: none; }
  .item {
    width: 48px; height: 48px; flex: none; padding: 0; position: relative;
    border: none; border-radius: 12px; background: transparent; cursor: pointer;
    transition: transform .25s var(--ease), box-shadow .25s;
  }
  .item::after { /* active ring, dyke border-strong turned white */
    content: ''; position: absolute; inset: -4px; border-radius: 15px; pointer-events: none;
    box-shadow: 0 0 0 1.5px #fff; opacity: 0; transform: scale(.94); transition: opacity .25s, transform .25s var(--ease);
  }
  .item.active::after { opacity: 1; transform: none; }
  .item.playing::before {
    content: ''; position: absolute; right: -6px; top: 50%; width: 4px; height: 4px; margin-top: -2px; border-radius: 50%; background: #fff;
  }
  @media (hover: hover) { .item:hover { transform: translateY(-2px); box-shadow: 0 12px 26px rgba(0,0,0,.6); } }
  .home { display: grid; place-items: center; color: var(--muted); background: var(--card-fill); box-shadow: inset 0 0 0 1px var(--border); transition: color .2s, transform .25s var(--ease), box-shadow .25s; }
  .home svg { width: 26px; height: 26px; }
  .home:hover, .home.active { color: #fff; }

  .tip {
    position: fixed; left: calc(var(--rail) + 8px); z-index: 300; transform: translateY(-50%);
    padding: 7px 12px; max-width: 240px; font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    background: var(--panel); border: 1px solid var(--border-strong); border-radius: 10px; box-shadow: var(--shadow-menu);
    pointer-events: none; animation: fadeIn .15s ease both;
  }

  @media (max-width: 760px) {
    .rail {
      flex-direction: row; justify-content: flex-start; gap: 12px;
      padding: 10px 16px calc(10px + var(--safe-b));
      border-right: none; border-top: 1px solid var(--border);
      background: rgba(0,0,0,.92); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
    }
    .sep { width: 1px; height: 28px; }
    .list { flex-direction: row; overflow-x: auto; overflow-y: hidden; padding: 8px; width: auto; flex: 1; }
    .item { width: 44px; height: 44px; }
    .item.playing::before { right: 50%; top: auto; bottom: -8px; margin: 0 -2px 0 0; }
  }
</style>

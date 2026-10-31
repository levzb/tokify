<script>
  // Right drawer (dyke's cart panel): now playing, the user's queue, then what follows from the playlist.
  import Icon from './Icon.svelte';
  import Cover from './Cover.svelte';
  import { lib } from '../lib/library.svelte.js';
  import { ui, openMenu } from '../lib/ui.svelte.js';
  import { player, removeFromQueue, playFromQueue, playUpNext, contextName } from '../lib/player.svelte.js';
  import { trackMenu } from '../lib/menus.js';
  import { clock, trackSec, artistName } from '../lib/format.js';

  const cur = $derived(lib.tracks[player.trackId]);
  const close = () => (ui.queueOpen = false);
</script>

<svelte:window onkeydown={(e) => ui.queueOpen && e.key === 'Escape' && close()} />

<div class="overlay" class:open={ui.queueOpen} onclick={close} role="presentation"></div>
<aside class="panel" class:open={ui.queueOpen} aria-label="Queue" aria-hidden={!ui.queueOpen}>
  <header>
    <h2>Queue</h2>
    <button class="close" onclick={close} aria-label="Close"><Icon name="x" size={16} /></button>
  </header>
  <div class="body">
    {#if cur}
      <h3>Now playing</h3>
      <div class="row now">
        <Cover src={cur.cover} size={44} radius={8} />
        <div class="txt"><span class="t">{cur.title}</span><span class="a">{artistName(cur)}</span></div>
        <span class="d mono">{clock(trackSec(cur))}</span>
      </div>
    {/if}

    {#if player.queue.length}
      <h3>Next in queue</h3>
      {#each player.queue as q (q.key)}
        {@const t = lib.tracks[q.id]}
        {#if t}
          <div class="row" role="button" tabindex="0" onclick={() => playFromQueue(q.key)} onkeydown={(e) => e.key === 'Enter' && playFromQueue(q.key)}
            oncontextmenu={(e) => { e.preventDefault(); openMenu(e, trackMenu(t)); }}>
            <Cover src={t.cover} size={44} radius={8} />
            <div class="txt"><span class="t">{t.title}</span><span class="a">{artistName(t)}</span></div>
            <button class="icon-btn" aria-label="Remove from queue" onclick={(e) => { e.stopPropagation(); removeFromQueue(q.key); }}><Icon name="x" size={16} /></button>
          </div>
        {/if}
      {/each}
    {/if}

    {#if player.upNext.length}
      <h3>Next from {contextName(player.contextId) || 'the list'}</h3>
      {#each player.upNext as id, i (id + ':' + i)}
        {@const t = lib.tracks[id]}
        {#if t}
          <div class="row" role="button" tabindex="0" onclick={() => playUpNext(i)} onkeydown={(e) => e.key === 'Enter' && playUpNext(i)}
            oncontextmenu={(e) => { e.preventDefault(); openMenu(e, trackMenu(t)); }}>
            <Cover src={t.cover} size={44} radius={8} />
            <div class="txt"><span class="t">{t.title}</span><span class="a">{artistName(t)}</span></div>
            <span class="d mono">{clock(trackSec(t))}</span>
          </div>
        {/if}
      {/each}
    {/if}

    {#if !cur}
      <p class="empty">Nothing is playing. Pick a song anywhere and it starts here.</p>
    {:else if !player.queue.length && !player.upNext.length}
      <p class="empty">Nothing after this song. “Play next” and “Add to queue” live in every song’s menu.</p>
    {/if}
  </div>
</aside>

<style>
  .overlay { position: fixed; inset: 0; z-index: 240; background: rgba(0,0,0,.5); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); opacity: 0; visibility: hidden; transition: opacity .3s, visibility .3s; }
  .overlay.open { opacity: 1; visibility: visible; }
  .panel {
    position: fixed; top: 0; right: 0; bottom: 0; z-index: 250; width: 100%; max-width: 420px;
    display: flex; flex-direction: column; background: var(--panel); border-left: 1px solid var(--border-strong);
    box-shadow: -30px 0 80px rgba(0,0,0,.85);
    transform: translateX(100%); transition: transform .35s var(--ease), visibility .35s; visibility: hidden;
  }
  .panel.open { transform: none; visibility: visible; }
  header { display: flex; align-items: center; justify-content: space-between; padding: calc(22px + var(--safe-t)) 22px 16px; border-bottom: 1px solid var(--border); }
  h2 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.03em; }
  .close { width: 32px; height: 32px; display: grid; place-items: center; color: var(--muted); background: rgba(255,255,255,.05); border: 1px solid var(--border); border-radius: 50%; cursor: pointer; transition: background .2s, color .2s, transform .2s; }
  .close:hover { background: rgba(255,255,255,.14); color: #fff; transform: rotate(90deg); }
  .body { flex: 1; overflow-y: auto; padding: 8px 12px calc(24px + var(--safe-b)); }
  h3 { margin: 18px 10px 8px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.14em; color: var(--muted-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row { display: flex; align-items: center; gap: 12px; padding: 8px 10px; border-radius: 10px; cursor: pointer; transition: background .15s; }
  .row:hover { background: var(--raise); }
  .row.now { cursor: default; background: var(--raise); }
  .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .t { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .a { font-size: 12.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .d { font-size: 12px; color: var(--muted); }
  .empty { margin: 28px 10px; font-size: 13.5px; color: var(--muted); }
</style>

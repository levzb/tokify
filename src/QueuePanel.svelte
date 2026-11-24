<script>
  // The queue sheet: now playing, the user's queue, then what follows from the playlist.
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import Cover from './Cover.svelte';
  import { lib, ui, openMenu } from './state.svelte.js';
  import { player, removeFromQueue, playFromQueue, playUpNext, contextName } from './player.svelte.js';
  import { trackMenu } from './menus.js';
  import { clock, trackSec, artistName } from './util.js';

  const cur = $derived(lib.tracks[player.trackId]);
  const close = () => (ui.queueOpen = false);
  const upcoming = $derived(player.queue.length + player.upNext.length);
</script>

{#if ui.queueOpen}
  <Modal title="Queue" lead={upcoming ? `${upcoming} up next` : ''} art={cur?.cover || ''} onclose={close}>
    {#if cur}
      <div class="now">
        <span class="now-art"><Cover src={cur.cover} size="100%" radius={8} /></span>
        <div class="txt">
          <span class="t">{cur.title}</span>
          <span class="a">{artistName(cur)}</span>
          <span class="bar-time dur"><i class="meter"><b style="transform:scaleX({player.dur ? player.pos / player.dur : 0})"></b></i>{clock(player.pos)} / {clock(player.dur || trackSec(cur))}</span>
        </div>
        {#if player.playing}<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>{/if}
      </div>
    {/if}
    <div class="body scroll">

      {#if player.queue.length}
        <h4>Next in queue</h4>
        {#each player.queue as q (q.key)}
          {@const t = lib.tracks[q.id]}
          {#if t}
            <div class="row" role="button" tabindex="0" onclick={() => playFromQueue(q.key)} onkeydown={(e) => e.key === 'Enter' && playFromQueue(q.key)}
              oncontextmenu={(e) => { e.preventDefault(); openMenu(e, trackMenu(t)); }}>
              <Cover src={t.cover} size={44} radius={6} />
              <div class="txt"><span class="t">{t.title}</span><span class="a">{artistName(t)}</span></div>
              <button class="icon-btn sm" aria-label="Remove from queue" onclick={(e) => { e.stopPropagation(); removeFromQueue(q.key); }}><Icon name="x" size={16} /></button>
            </div>
          {/if}
        {/each}
      {/if}

      {#if player.upNext.length}
        <h4>{player.queue.length ? 'Then from' : 'From'} {contextName(player.contextId) || 'the list'}</h4>
        {#each player.upNext as id, i (id + ':' + i)}
          {@const t = lib.tracks[id]}
          {#if t}
            <div class="row" role="button" tabindex="0" onclick={() => playUpNext(i)} onkeydown={(e) => e.key === 'Enter' && playUpNext(i)}
              oncontextmenu={(e) => { e.preventDefault(); openMenu(e, trackMenu(t)); }}>
              <Cover src={t.cover} size={44} radius={6} />
              <div class="txt"><span class="t">{t.title}</span><span class="a">{artistName(t)}</span></div>
              <span class="d dur">{clock(trackSec(t))}</span>
            </div>
          {/if}
        {/each}
      {/if}

      {#if !cur}
        <p class="empty">Nothing playing</p>
      {:else if !upcoming}
        <p class="empty">Nothing up next</p>
      {/if}
    </div>
  </Modal>
{/if}

<style>
  /* Now playing: the one card in the sheet, with its own progress. */
  .now { display: flex; align-items: center; gap: 14px; }
  .now-art { width: 72px; height: 72px; flex: none; border-radius: 8px; box-shadow: 0 12px 32px rgba(0, 0, 0, .45); }
  .now .t { font-size: 16px; font-weight: 600; letter-spacing: -.01em; }
  .now .a { font-size: 13px; color: var(--muted); }
  .bar-time { display: flex; align-items: center; gap: 10px; margin-top: 8px; font-size: 13px; color: var(--faint); font-variant-numeric: tabular-nums; }
  .bar-time .meter { flex: 1; height: 3px; background: rgba(255, 255, 255, .14); }
  .bar-time .meter b { display: block; height: 100%; background: var(--accent); border-radius: 99px; transform-origin: left; transition: transform .25s linear; }
  .eq { display: flex; align-items: flex-end; gap: 2px; height: 14px; align-self: flex-start; margin-top: 4px; }
  .eq i { width: 3px; border-radius: 1px; background: var(--accent); animation: eq 1s ease-in-out infinite; }
  .eq i:nth-child(2) { animation-delay: -.35s; } .eq i:nth-child(3) { animation-delay: -.7s; }
  @keyframes eq { 0%, 100% { height: 4px; } 50% { height: 14px; } }

  .body { flex: 1 1 auto; margin: -4px -12px 0; padding: 0 4px; }
  h4 { margin: 14px 8px 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  h4:first-child { margin-top: 0; }
  .row { display: flex; align-items: center; gap: 12px; padding: 8px; border-radius: var(--r-item); cursor: pointer; transition: background .15s; }
  .row:hover { background: var(--fill-1); }
  .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .t { font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .a, .d { font-size: 13px; color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .empty { margin: 16px 8px; font-size: 14px; color: var(--faint); }
</style>

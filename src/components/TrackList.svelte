<script>
  import Icon from './Icon.svelte';
  import Cover from './Cover.svelte';
  import { clock, trackSec } from '../lib/format.js';
  import { playable } from '../lib/library.svelte.js';
  import { player, playContext, toggle, toggleTrackRepeat } from '../lib/player.svelte.js';
  import { openMenu, toast } from '../lib/ui.svelte.js';
  import { trackMenu } from '../lib/menus.js';
  import { longpress } from '../lib/press.js';

  let {
    tracks = [],
    contextId = null,
    playlistId = null,
    sortable = false,
    selecting = false,
    selected = $bindable(new Set()),
    onReorder = null,
    emptyText = '',
  } = $props();

  let listEl = $state();
  let drag = $state(null); // { from, to, dy, h }
  let justDragged = false;

  function rowClick(t) {
    if (justDragged) return;
    if (selecting) {
      const s = new Set(selected);
      s.has(t.id) ? s.delete(t.id) : s.add(t.id);
      selected = s;
      return;
    }
    if (!playable(t)) { toast(t.status === 'pending' ? 'Still downloading' : `Unavailable: ${t.error || 'sound unavailable'}`); return; }
    if (player.trackId === t.id && player.contextId === contextId) toggle();
    else playContext(contextId, t.id);
  }

  function menu(e, t, anchor) {
    e.preventDefault?.();
    openMenu(e, trackMenu(t, { playlistId }), { anchor });
  }

  // ---- drag to reorder: whole row with a mouse, the grip with a finger ----
  let pending = null;
  function pointerDown(e, i, viaGrip) {
    if (!sortable || selecting) return;
    if (e.pointerType !== 'mouse' && !viaGrip) return;
    if (e.button !== 0 || e.target.closest('button:not(.grip)')) return;
    const row = e.currentTarget.closest('.row');
    lastY = e.clientY;
    pending = { i, y: e.clientY, h: row.getBoundingClientRect().height + 2, id: e.pointerId, row };
    if (viaGrip) { e.preventDefault(); begin(); }
    window.addEventListener('pointermove', pointerMove, { passive: false });
    window.addEventListener('pointerup', pointerUp);
    window.addEventListener('pointercancel', pointerUp);
  }
  function begin() {
    drag = { from: pending.i, to: pending.i, dy: 0, h: pending.h, startY: pending.y, scroll0: scroller()?.scrollTop || 0 };
    document.body.classList.add('dragging');
    autoScroll();
  }
  const scroller = () => listEl?.closest('.main-scroll');
  let lastY = 0, scrollRaf = 0;
  function pointerMove(e) {
    if (!pending) return;
    lastY = e.clientY;
    if (!drag) { if (Math.abs(e.clientY - pending.y) < 6) return; begin(); }
    e.preventDefault();
    update();
  }
  function update() {
    const sc = scroller();
    const dy = lastY - drag.startY + ((sc?.scrollTop || 0) - drag.scroll0);
    drag.dy = dy;
    drag.to = Math.max(0, Math.min(tracks.length - 1, drag.from + Math.round(dy / drag.h)));
  }
  function autoScroll() {
    cancelAnimationFrame(scrollRaf);
    const step = () => {
      if (!drag) return;
      const sc = scroller();
      if (sc) {
        const r = sc.getBoundingClientRect();
        const edge = 70;
        const v = lastY < r.top + edge ? -(r.top + edge - lastY) / 4 : lastY > r.bottom - edge - 170 ? (lastY - (r.bottom - edge - 170)) / 4 : 0;
        if (v) { sc.scrollTop += Math.max(-18, Math.min(18, v)); update(); }
      }
      scrollRaf = requestAnimationFrame(step);
    };
    scrollRaf = requestAnimationFrame(step);
  }
  function pointerUp() {
    window.removeEventListener('pointermove', pointerMove);
    window.removeEventListener('pointerup', pointerUp);
    window.removeEventListener('pointercancel', pointerUp);
    cancelAnimationFrame(scrollRaf);
    document.body.classList.remove('dragging');
    if (drag) {
      justDragged = true;
      setTimeout(() => { justDragged = false; }, 50);
      const { from, to } = drag;
      drag = null;
      if (from !== to) {
        const ids = tracks.map((t) => t.id);
        const [m] = ids.splice(from, 1);
        ids.splice(to, 0, m);
        onReorder?.(ids);
      }
    }
    pending = null;
  }

  function shift(i) {
    if (!drag) return 0;
    if (i === drag.from) return drag.dy;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -drag.h;
    if (drag.from > drag.to && i < drag.from && i >= drag.to) return drag.h;
    return 0;
  }
</script>

{#if tracks.length}
  <div class="head" class:sel={selecting} aria-hidden="true">
    <span></span><span class="c-idx">#</span><span>Title</span><span class="c-src">Upload</span><span class="c-dur"><Icon name="clock" size={15} /></span><span></span>
  </div>
{/if}

<div class="list" bind:this={listEl} role="list">
  {#each tracks as t, i (t.id)}
    {@const ok = playable(t)}
    {@const cur = player.trackId === t.id && (player.contextId === contextId || !contextId)}
    <div role="listitem">
    <div class="row" role="button" tabindex="0"
      class:cur class:failed={t.status === 'failed'} class:pending={t.status === 'pending'}
      class:dragged={drag?.from === i} class:moving={drag && drag.from !== i}
      class:selected={selecting && selected.has(t.id)} class:sel={selecting} class:sortable={sortable && !selecting}
      style="transform: translateY({shift(i)}px)"
      onclick={() => rowClick(t)}
      onkeydown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); rowClick(t); } }}
      oncontextmenu={(e) => menu(e, t)}
      onpointerdown={(e) => pointerDown(e, i, false)}
      use:longpress={{ current: (e) => !selecting && menu(e, t) }}>
      <span class="c-repeat">
        {#if !selecting}
          <button class="icon-btn repeat" class:on={cur && player.repeat === 'one'} disabled={!ok}
            aria-label="Repeat song" aria-pressed={cur && player.repeat === 'one'}
            title={cur && player.repeat === 'one' ? 'Stop repeating this song' : 'Repeat this song'}
            onpointerdown={(e) => e.stopPropagation()}
            onkeydown={(e) => e.stopPropagation()}
            onclick={(e) => { e.stopPropagation(); toggleTrackRepeat(contextId, t.id); }}>
            <Icon name="repeat" size={17} />
          </button>
        {/if}
      </span>
      <span class="c-idx">
        {#if selecting}
          <span class="tick" class:on={selected.has(t.id)}>{#if selected.has(t.id)}<Icon name="check" size={13} stroke={3} />{/if}</span>
        {:else if cur && player.playing}
          <span class="bars" aria-label="Playing"><i></i><i></i><i></i></span>
        {:else}
          <span class="num">{i + 1}</span>
          {#if ok}<span class="hover-play"><Icon name={cur && player.playing ? 'pause' : 'play'} size={15} /></span>{/if}
        {/if}
      </span>
      <span class="c-main">
        <Cover src={t.cover} size={44} radius={8} dim={!ok} />
        <span class="txt">
          <span class="title">{t.title}</span>
          {#if t.status === 'failed'}
            <span class="note"><Icon name="alert" size={13} /> Unavailable · {t.error || 'sound unavailable'}</span>
          {:else if t.status === 'pending'}
            <span class="note"><span class="spinner tiny"></span> Downloading</span>
          {:else}
            <span class="author">{t.author || '—'}</span>
          {/if}
        </span>
      </span>
      <span class="c-src">{t.source || '—'}</span>
      <span class="c-dur mono">{ok ? clock(trackSec(t)) : ''}</span>
      <span class="c-act">
        <button class="icon-btn more" aria-label="Song menu" onclick={(e) => { e.stopPropagation(); menu(e, t, e.currentTarget); }}><Icon name="more" size={18} /></button>
        {#if sortable && !selecting}
          <button class="icon-btn grip" aria-label="Drag to reorder" onclick={(e) => e.stopPropagation()} onpointerdown={(e) => { e.stopPropagation(); pointerDown(e, i, true); }}><Icon name="grip" size={18} /></button>
        {/if}
      </span>
    </div>
    </div>
  {/each}
</div>

{#if !tracks.length && emptyText}
  <p class="empty">{emptyText}</p>
{/if}

<style>
  .head, .row {
    display: grid; align-items: center; gap: 16px;
    grid-template-columns: 36px 32px minmax(0, 1.6fr) minmax(0, 1fr) 56px 44px;
    padding: 0 12px;
  }
  .head {
    height: 36px; margin-bottom: 8px; border-bottom: 1px solid var(--border);
    font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.13em; color: var(--muted-2);
  }
  .head .c-dur { display: flex; justify-content: flex-end; }
  .list { position: relative; }
  .row {
    position: relative; min-height: 62px; border-radius: var(--radius-xs); cursor: pointer;
    user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
    transition: background .15s, box-shadow .2s, opacity .2s;
    margin-bottom: 2px;
  }
  .row.moving { transition: transform .22s var(--ease), background .15s; }
  .row.dragged {
    z-index: 5; background: #141414; cursor: grabbing;
    box-shadow: 0 18px 40px rgba(0,0,0,.7), inset 0 0 0 1px var(--border-strong);
  }
  @media (hover: hover) { .row:hover { background: var(--raise); } }
  .row.selected { background: var(--raise-2); }

  .c-idx { position: relative; display: grid; place-items: center; height: 100%; color: var(--muted); font-size: 14px; font-variant-numeric: tabular-nums; }
  .hover-play { position: absolute; inset: 0; display: none; place-items: center; color: #fff; }
  @media (hover: hover) {
    .row:hover .hover-play { display: grid; }
    .row:hover .c-idx .num { visibility: hidden; }
  }
  .cur .num { color: #fff; font-weight: 700; }
  .c-repeat { display: grid; place-items: center; }
  .repeat { width: 36px; height: 44px; }
  .repeat, .repeat:hover, .repeat:active {
    color: var(--muted);
    background: transparent; border-color: transparent; border-radius: 0; box-shadow: none;
    transition: opacity .45s ease-in-out, color .2s var(--ease);
  }
  .repeat.on { color: #fff; }
  @media (hover: hover) {
    .row .repeat { opacity: 0; pointer-events: none; }
    .row:hover .repeat, .row:focus-visible .repeat, .row .repeat:focus-visible, .row .repeat.on { opacity: 1; pointer-events: auto; }
  }

  .c-main { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .txt { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
  .title { font-size: 15px; font-weight: 600; letter-spacing: -0.01em; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .author, .c-src { font-size: 13px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .note :global(svg) { flex: none; }
  .note { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .c-dur { font-size: 13px; color: var(--muted); text-align: right; }
  .c-act { display: flex; justify-content: flex-end; }
  .more { opacity: 0; }
  @media (hover: hover) { .row:hover .more { opacity: 1; } }
  .more:focus-visible { opacity: 1; }
  .grip { display: none; cursor: grab; touch-action: none; }

  .failed .title { color: var(--muted); }
  .failed .c-main, .failed .c-src, .pending .c-main { opacity: .7; }
  .failed { cursor: default; }

  .tick { width: 20px; height: 20px; border-radius: 50%; border: 1.5px solid var(--border-strong); display: grid; place-items: center; transition: background .2s, border-color .2s; }
  .tick.on { background: #fff; border-color: #fff; color: #000; animation: popCheck .35s var(--ease) both; }

  .bars { display: inline-flex; align-items: flex-end; gap: 2px; height: 14px; }
  .bars i { width: 3px; height: 60%; background: #fff; border-radius: 1px; animation: eq 1s ease-in-out infinite; }
  .bars i:nth-child(2) { animation-delay: -.4s; }
  .bars i:nth-child(3) { animation-delay: -.7s; }
  @keyframes eq { 0%, 100% { height: 30%; } 50% { height: 100%; } }

  .spinner.tiny { width: 11px; height: 11px; border-width: 1.5px; }
  .empty { margin: 8px 0; padding: 36px 12px; text-align: center; color: var(--muted); font-size: 14px; border: 1px solid var(--border); border-radius: var(--radius); }

  @media (max-width: 860px) {
    .head, .row { grid-template-columns: 36px 28px minmax(0, 1fr) 52px 44px; }
    .c-src { display: none; }
  }
  @media (max-width: 760px), (hover: none) {
    .head { display: none; }
    .row { grid-template-columns: 44px 20px minmax(0, 1fr) auto; gap: 4px; padding: 0; min-height: 64px; }
    .row .c-dur { display: none; }
    .repeat { width: 44px; }
    .row.sel { grid-template-columns: 28px minmax(0, 1fr) auto; }
    .row.sel .c-repeat { display: none; }
    .row .c-main { gap: 8px; }
    .more { opacity: 1; width: 40px; }
    .grip { display: inline-flex; width: 40px; }
    .cur .title { text-decoration: underline; text-decoration-color: rgba(255,255,255,.35); text-underline-offset: 4px; }
  }
  :global(body.dragging), :global(body.dragging *) { cursor: grabbing !important; user-select: none !important; }
</style>

<script>
  import Icon from './Icon.svelte';
  import Cover from './Cover.svelte';
  import { clock, trackSec } from './util.js';
  import { playable, openMenu, toast, patchTrack, pickImage, setTrackCover, ui } from './state.svelte.js';
  import { player, playContext, toggle, toggleTrackRepeat, trackDetailsChanged } from './player.svelte.js';
  import { trackMenu } from './menus.js';
  import { ownSound, soundName } from './sound.svelte.js';
  import { longpress } from '../iphone/touch.js';

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

  // With a mouse, the song's own parts edit themselves: click the title or the author and it becomes a field
  // right there (Enter or clicking away saves, Escape cancels); click the cover to pick a new one.
  // The rest of the row still plays. Touch keeps tap-to-play, so there these live in the song menu.
  const direct = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;
  let edit = $state(null); // { id, field, value }
  function startEdit(e, t, field) {
    e.stopPropagation();
    if (selecting) return;
    edit = { id: t.id, field, value: field === 'title' ? t.title : t.author || '' };
  }
  async function commit() {
    const d = edit, t = d && tracks.find((x) => x.id === d.id);
    edit = null;
    if (!t) return;
    const v = d.value.trim();
    if (d.field === 'title' ? !v || v === t.title : v === (t.author || '')) return;
    await patchTrack(t.id, { [d.field]: v });
    trackDetailsChanged(t.id);
  }
  function editKey(e) {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); edit = null; }
  }
  function focusField(node) { node.focus(); node.select(); }
  async function newCover(e, t) {
    e.stopPropagation();
    if (selecting) return;
    const f = await pickImage();
    if (f) await setTrackCover(t.id, f);
  }

  function menu(e, t, anchor) {
    e.preventDefault?.();
    openMenu(e, trackMenu(t, { playlistId, inline: direct }), { anchor });
  }

  // ---- drag to reorder: whole row with a mouse, the grip with a finger ----
  let pending = null;
  function pointerDown(e, i, viaGrip) {
    if (!sortable || selecting) return;
    if (e.pointerType !== 'mouse' && !viaGrip) return;
    if (e.button !== 0 || e.target.closest('button:not(.grip), input')) return;
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
        {#if direct && !selecting}
          <button class="art-edit" aria-label="Change cover" onclick={(e) => newCover(e, t)}>
            <Cover src={t.cover} size={44} radius={6} dim={!ok} /><span class="art-ico"><Icon name="image" size={18} /></span>
          </button>
        {:else}
          <Cover src={t.cover} size={44} radius={6} dim={!ok} />
        {/if}
        <span class="txt">
          {#if edit?.id === t.id && edit.field === 'title'}
            <input class="inline-edit t" aria-label="Song title" maxlength="300" bind:value={edit.value} use:focusField
              onblur={commit} onkeydown={editKey} onclick={(e) => e.stopPropagation()} />
          {:else if direct && !selecting}
            <button class="title edit-t" aria-label="Rename “{t.title}”" onclick={(e) => startEdit(e, t, 'title')}>{t.title}</button>
          {:else}
            <span class="title">{t.title}</span>
          {/if}
          {#if t.status === 'failed'}
            <span class="state"><Icon name="alert" size={13} /> Unavailable · {t.error || 'sound unavailable'}</span>
          {:else if t.status === 'pending'}
            <span class="state"><span class="spinner xs"></span> Downloading</span>
          {:else}
            <span class="byline">
            {#if edit?.id === t.id && edit.field === 'author'}
              <input class="inline-edit a" aria-label="Author" maxlength="200" placeholder="Author" bind:value={edit.value} use:focusField
                onblur={commit} onkeydown={editKey} onclick={(e) => e.stopPropagation()} />
            {:else if direct && !selecting}
              <button class="author edit-t" aria-label="Edit author of “{t.title}”" onclick={(e) => startEdit(e, t, 'author')}>{t.author || 'Add author'}</button>
            {:else}
              <span class="author">{t.author || '—'}</span>
            {/if}
            {#if ownSound(t.id)}
              <button class="own" aria-label="Sound of “{t.title}”: {soundName(ownSound(t.id))}" data-tip="Its own sound: {soundName(ownSound(t.id))}"
                onclick={(e) => { e.stopPropagation(); ui.soundTrackId = t.id; ui.soundOpen = true; }}><Icon name="sound" size={11} /><span>{soundName(ownSound(t.id))}</span></button>
            {/if}
            </span>
          {/if}
        </span>
      </span>
      <span class="c-src">{t.source || '—'}</span>
      <span class="c-dur dur">{ok ? clock(trackSec(t)) : ''}</span>
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
  <p class="empty-state">{emptyText}</p>
{/if}

<style>
  .head, .row {
    display: grid; align-items: center; gap: 16px;
    grid-template-columns: 36px 32px minmax(0, 1.6fr) minmax(0, 1fr) 56px 44px;
    padding: 0 12px;
  }
  .head { display: none; }
  .head .c-dur { display: flex; justify-content: flex-end; }
  .list { position: relative; }
  .row {
    position: relative; min-height: 60px; border-radius: var(--r-item); cursor: pointer;
    user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
    transition: background .15s, box-shadow .2s, opacity .2s;
  }
  .row.moving { transition: transform .22s var(--ease), background .15s; }
  .row.dragged {
    z-index: 5; cursor: grabbing; background: var(--surface);
    box-shadow: var(--shadow-float), inset 0 0 0 1px var(--edge);
  }
  @media (hover: hover) { .row:hover { background: var(--fill-1); } }
  .row.selected { background: var(--fill-2); }

  .c-idx { position: relative; display: grid; place-items: center; height: 100%; color: var(--faint); font-size: 14px; font-variant-numeric: tabular-nums; }
  .hover-play { position: absolute; inset: 0; display: none; place-items: center; color: var(--text); }
  @media (hover: hover) {
    .row:hover .hover-play { display: grid; }
    .row:hover .c-idx .num { visibility: hidden; }
  }
  .cur .num { color: var(--text); font-weight: 600; }
  .c-repeat { display: grid; place-items: center; }
  .repeat { width: 36px; height: 40px; border-radius: var(--r-control); }
  .repeat, .repeat:hover:not(:disabled), .repeat:active:not(:disabled) { color: var(--muted); background: transparent; transform: none; transition: color .15s var(--ease); }
  .repeat:hover:not(:disabled) { color: var(--text); }
  .repeat.on, .repeat.on:hover { color: var(--accent); }
  @media (hover: hover) {
    .row .repeat { opacity: 0; pointer-events: none; }
    .row:hover .repeat, .row:focus-visible .repeat, .row .repeat:focus-visible, .row .repeat.on { opacity: 1; pointer-events: auto; }
  }

  .c-main { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .txt { gap: 1px; }
  .c-main .title { font-size: 14px; font-weight: 500; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* A song with a sound of its own wears its name next to the author; a tap opens it. */
  .byline { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .byline > :first-child { min-width: 0; }
  .own {
    display: inline-flex; align-items: center; gap: 4px; flex: none; max-width: 120px; height: 18px; padding: 0 7px 0 6px;
    border: none; border-radius: 99px; background: var(--fill-2); color: var(--muted); font: inherit; font-size: 11px; font-weight: 600;
    cursor: pointer; transition: background .15s, color .15s;
  }
  .own span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .own:hover { background: var(--fill-3); color: var(--text); }
  .author, .c-src { font-size: 13px; color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .state :global(svg) { flex: none; }

  /* Editable parts: the text itself is the target, so it is only as wide as the words. */
  .edit-t {
    display: block; width: fit-content; max-width: 100%; margin: 0 -4px; padding: 0 4px; border: none; border-radius: 4px;
    background: transparent; font-family: inherit; text-align: left; cursor: text;
    transition: background .15s, color .15s;
  }
  .edit-t:hover { background: var(--fill-2); }
  .edit-t:hover.author { color: var(--muted); }
  .edit-t:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(255, 255, 255, .5); }
  .inline-edit {
    width: 100%; margin: 0 -4px; padding: 0 4px; border: none; border-radius: 4px; outline: none;
    font: inherit; color: var(--text); background: var(--fill-2); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .35);
    animation: fadeIn .12s ease both;
  }
  .inline-edit.t { font-size: 14px; font-weight: 500; line-height: 20px; }
  .inline-edit.a { font-size: 13px; line-height: 18px; }
  .inline-edit.a::placeholder { color: var(--faint); }
  .art-edit { position: relative; flex: none; padding: 0; border: none; background: none; border-radius: 6px; cursor: pointer; }
  .art-ico {
    position: absolute; inset: 0; display: grid; place-items: center; border-radius: 6px;
    color: #fff; background: rgba(0, 0, 0, .5); opacity: 0; transition: opacity .15s;
  }
  .art-edit:hover .art-ico, .art-edit:focus-visible .art-ico { opacity: 1; }
  .art-edit:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(255, 255, 255, .5); }
  .state { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .c-dur { text-align: right; }
  .c-act { display: flex; justify-content: flex-end; }
  .more { opacity: 0; }
  @media (hover: hover) { .row:hover .more { opacity: 1; } }
  .more:focus-visible { opacity: 1; }
  .grip { display: none; cursor: grab; touch-action: none; }

  .cur .c-main .title { color: var(--text); font-weight: 600; }
  .cur .author { color: var(--muted); }
  .failed .c-main .title { color: var(--faint); }
  .failed .c-main, .failed .c-src, .pending .c-main { opacity: .7; }
  .failed { cursor: default; }

  .bars { display: inline-flex; align-items: flex-end; gap: 2px; height: 14px; }
  .bars i { width: 3px; height: 60%; background: var(--accent); border-radius: 1px; animation: eq 1s ease-in-out infinite; }
  .bars i:nth-child(2) { animation-delay: -.4s; }
  .bars i:nth-child(3) { animation-delay: -.7s; }
  @keyframes eq { 0%, 100% { height: 30%; } 50% { height: 100%; } }

  .empty-state { margin: 8px 0; }

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
    .row .c-main { gap: 10px; }
    .more { opacity: 1; width: 40px; }
    .grip { display: inline-flex; width: 40px; }
  }
  :global(body.dragging), :global(body.dragging *) { cursor: grabbing !important; user-select: none !important; }
</style>

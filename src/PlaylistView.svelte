<script>
  import { providerName } from '../server/shared.js';
  import Icon from './Icon.svelte';
  import { openDownload, lib, playlistById, tracksOf, totalSec, playable, patchPlaylist, deletePlaylist, setPlaylistCover, clearPlaylistCover, ui, go, toast, ask, openMenu, pickImage } from './state.svelte.js';
  import Cover from './Cover.svelte';
  import TrackList from './TrackList.svelte';
  import SelectionActions from './SelectionActions.svelte';
  import { player, playContext, toggle, setShuffle, setTransition, contextChanged, shuffleOf, transitionOf } from './player.svelte.js';
  import { songs, longDuration } from './util.js';

  let { id } = $props();
  let selecting = $state(false);
  let selected = $state(new Set());
  const pl = $derived(playlistById(id));
  const tracks = $derived(pl ? tracksOf(pl) : []);
  const okCount = $derived(tracks.filter(playable).length);
  const failed = $derived(tracks.filter((t) => t.status === 'failed').length);
  const covers = $derived(tracks.filter((t) => t.cover && t.status === 'ok').slice(0, 4).map((t) => t.cover));
  const isCtx = $derived(player.contextId === id);
  const shuffle = $derived(pl ? shuffleOf(id) : false);
  const transition = $derived(pl ? transitionOf(id) : 'crossfade');

  const TRANSITIONS = [
    { id: 'none', label: 'Direct', hint: 'Direct: no pause between songs', icon: 'endDirect' },
    { id: 'fade', label: 'Fade', hint: 'Fade: out, then the next one in', icon: 'endFade' },
    { id: 'crossfade', label: 'Crossfade', hint: 'Crossfade: songs overlap', icon: 'endCrossfade' },
  ];
  const playing = $derived(isCtx && player.playing);

  function playAll() {
    if (isCtx && player.trackId) return toggle();
    playContext(id);
  }
  // Rename in place: the title turns into a field. Enter or leaving it saves, Escape cancels.
  let editing = $state(false);
  let draft = $state('');
  function rename() { draft = pl.name; editing = true; }
  function focusSelect(el) { el.focus(); el.select(); }
  async function commit() {
    if (!editing) return;
    editing = false;
    const name = draft.trim().slice(0, 120);
    if (name && name !== pl.name) await patchPlaylist(id, { name });
  }
  function editKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); editing = false; }
  }
  async function changeCover() {
    const f = await pickImage();
    if (f) { await setPlaylistCover(id, f); toast('Cover updated'); }
  }
  async function remove() {
    const ok = await ask({ kind: 'confirm', title: `Delete “${pl.name}”?`, text: 'Songs that aren’t in any other playlist will be removed from the library.', confirm: 'Delete', danger: true });
    if (!ok) return;
    go('home');
    await deletePlaylist(id);
    toast('Playlist deleted');
  }
  function more(e) {
    openMenu(e, [
      { label: 'Rename', icon: 'edit', action: rename },
      { label: 'Change cover', icon: 'image', action: changeCover },
      ...(pl.cover ? [{ label: 'Remove custom cover', icon: 'retry', action: () => clearPlaylistCover(id) }] : []),
      { sep: true },
      { label: 'Delete playlist', icon: 'trash', danger: true, action: remove },
    ], { anchor: e.currentTarget });
  }
  async function reorder(ids) {
    await patchPlaylist(id, { trackIds: ids });
    contextChanged(id);
  }
</script>

{#if pl}
  <header class="hero">
    <button class="art" onclick={changeCover} aria-label="Change cover">
      <Cover src={pl.cover} srcs={covers} size="100%" radius={8} />
      <span class="art-edit"><Icon name="image" size={22} /><span>Change cover</span></span>
    </button>
    <div class="info">
      <h1>
        {#if editing}
          <input class="title title-edit" bind:value={draft} use:focusSelect onblur={commit} onkeydown={editKey}
            aria-label="Playlist name" maxlength="120" spellcheck="false" />
        {:else}
          <button class="title" onclick={rename} title="Rename">{pl.name}</button>
        {/if}
      </h1>
      <p class="meta-line">
        {#if pl.origin && pl.link}<span class="kind"><a href={pl.link} target="_blank" rel="noreferrer">From {providerName(pl.origin)}</a></span>
        {:else}<span class="kind">{pl.kind === 'custom' ? 'Playlist' : 'Upload'}</span>{/if}
        <span>{songs(tracks.length)}</span>
        {#if okCount}<span>{longDuration(totalSec(tracks))}</span>{/if}
        {#if failed}<span class="warn">{failed} unavailable</span>{/if}
      </p>

      <div class="actions">
        <button class="pp play" onclick={playAll} disabled={!okCount} aria-label={playing ? 'Pause' : 'Play all'} aria-keyshortcuts="Space">
          <Icon name={playing ? 'pause' : 'play'} size={24} />
        </button>
        <button class="icon-btn shuffle" class:on={shuffle} onclick={() => setShuffle(id, !shuffle)}
          aria-label={shuffle ? 'Shuffle is on' : 'Shuffle'} aria-pressed={shuffle}><Icon name="shuffle" size={20} /></button>
        <div class="endings" role="radiogroup" aria-label="Transition between songs">
          {#each TRANSITIONS as t (t.id)}
            <button role="radio" class="ending" aria-checked={transition === t.id} class:active={transition === t.id} aria-label={t.label}
              data-tip={t.hint} onclick={() => setTransition(id, t.id)}>
              <Icon name={t.icon} size={22} />
            </button>
          {/each}
        </div>
        <div class="list-tools">
          <button class="icon-btn fill" aria-label="Download playlist" onclick={()=>openDownload({contextId:id,name:pl.name})}><Icon name="download" size={18}/></button>
          {#if tracks.length}<SelectionActions bind:selecting bind:selected exceptId={id} mode="toggle" />{/if}
          <button class="icon-btn fill more" aria-label="Playlist menu" onclick={more}><Icon name="more" size={18} /></button>
        </div>
      </div>
    </div>
  </header>

  <section class="list-panel">
    {#if tracks.length}
      {#if selecting}
        <div class="selection-bar">
          <span class="sub">{selected.size} selected</span>
          <SelectionActions bind:selecting bind:selected exceptId={id} mode="actions" />
        </div>
      {/if}
      <TrackList {tracks} contextId={id} playlistId={id} sortable onReorder={reorder} {selecting} bind:selected />
    {:else}
      <div class="empty-state">
        <p>This playlist is empty. Add songs from any list through their <strong>⋯</strong> menu, a right-click or a long press.</p>
        <button class="btn ghost icon" aria-label="Browse all songs" onclick={() => { ui.libraryView = 'songs'; go('home'); }}><Icon name="note" size={19} /></button>
      </div>
    {/if}
  </section>
{:else if lib.loaded}
  <div class="empty-state"><p>This playlist no longer exists.</p><button class="btn ghost icon" aria-label="Home" onclick={() => go('home')}><Icon name="home" size={19} /></button></div>
{/if}

<style>
  .hero { display: flex; align-items: flex-end; gap: 32px; padding: 4px 0 0; }

  .art {
    position: relative; display: block; width: 208px; flex: none; align-self: flex-start; aspect-ratio: 1; padding: 0; border: none; background: none; cursor: pointer;
    border-radius: 8px; box-shadow: 0 2px 4px rgba(0, 0, 0, .3), 0 18px 40px rgba(0, 0, 0, .45);
  }
  .art-edit {
    position: absolute; inset: 0; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
    background: rgba(0,0,0,.55); color: var(--text); font-size: 13px; font-weight: 500; opacity: 0; transition: opacity .15s;
  }
  .art:hover .art-edit, .art:focus-visible .art-edit { opacity: 1; }

  .info { display: flex; flex-direction: column; flex: 1; min-width: 0; padding-bottom: 2px; }
  h1 { margin: -4px 0 0; }
  .title {
    display: block; max-width: 100%; padding: 0; border: none; background: none; cursor: text; text-align: left; color: var(--text);
    font: inherit; font-size: clamp(30px, 3.4vw, 46px); line-height: 1.1; font-weight: 800; letter-spacing: -.03em;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .title-edit {
    width: 100%; margin: 0; padding: 0; cursor: text; outline: none; border: none; border-radius: 0;
    background: none; box-shadow: 0 2px 0 rgba(255, 255, 255, .55); caret-color: var(--accent);
  }
  .meta-line { margin-top: 8px; }
  .kind { color: var(--text); font-weight: 500; }
  .kind a { color: inherit; text-decoration: none; }
  .kind a:hover { text-decoration: underline; text-underline-offset: 3px; }
  .warn { color: var(--faint); }

  .actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 22px; }
  .play { --s: 56px; box-shadow: 0 8px 24px rgba(0, 0, 0, .35); }
  .play :global(svg) { translate: 1px 0; }
  .shuffle { position: relative; width: 44px; height: 44px; color: var(--muted); }
  .shuffle.on { color: var(--text); }
  .shuffle.on::after {
    content: ''; position: absolute; left: 50%; bottom: 3px; width: 4px; height: 4px; margin-left: -2px; border-radius: 50%; background: var(--accent);
  }

  /* ---- how songs end: three drawn envelopes ---- */
  .endings { display: flex; align-items: center; gap: 2px; margin-left: 6px; padding-left: 14px; box-shadow: inset 1px 0 0 var(--edge); }
  .ending {
    display: grid; place-items: center; width: 44px; height: 40px; padding: 0; border: none; border-radius: var(--r-control);
    background: none; color: var(--faint); cursor: pointer; transition: background .15s, color .15s;
  }
  .ending:hover { color: var(--muted); background: var(--fill-1); }
  .ending.active { color: var(--text); background: var(--fill-2); }
  .ending:focus-visible { outline: none; box-shadow: inset 0 0 0 2px rgba(255, 255, 255, .5); }
  .ending.active :global(svg) { animation: pop .35s var(--ease); }
  @keyframes pop { 40% { transform: scale(1.12); } }
  .list-tools { display: flex; align-items: center; gap: 8px; margin-left: auto; }
  .list-tools { gap: 2px; }
  .list-tools :global(.icon-btn) { color: var(--muted); }
  .list-tools :global(.icon-btn:hover:not(:disabled)), .list-tools :global(.icon-btn.on) { color: var(--text); }

  /* Rows sit straight on the page; only hover and the playing song light them. */
  .list-panel { flex: 1; margin: 36px -12px 0; }
  .selection-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; padding: 0 8px 8px; }

  .empty-state { background: none; }
  .empty-state p { margin-bottom: 4px; }

  @media (max-width: 760px) {
    .hero { flex-direction: column; align-items: stretch; gap: 20px; padding: 4px 0 0; }
    .art { width: min(56vw, 220px); align-self: center; }
    .title { font-size: 26px; white-space: normal; overflow-wrap: anywhere; }
    .kind { font-size: 15px; }
    .actions { display: grid; grid-template-columns: auto auto 1fr; gap: 14px 8px; margin-top: 16px; }
    .actions .play { grid-column: 1; grid-row: 1; --s: 52px; }
    .actions .shuffle { grid-column: 2; grid-row: 1; }
    .actions .list-tools { grid-column: 3; grid-row: 1; justify-self: end; margin: 0; }
    .list-tools :global(.icon-btn) { width: 44px; height: 40px; }
    .endings { grid-column: 1 / -1; grid-row: 2; margin: 0; padding: 0; box-shadow: none; gap: 6px; }
    .ending { flex: 1; width: auto; height: 44px; background: var(--fill-1); }
    .ending.active { background: var(--fill-3); }
    .list-panel { margin: 20px -8px 0; }
  }
</style>

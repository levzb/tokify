<script>
  import Icon from './Icon.svelte';
  import Cover from './Cover.svelte';
  import TrackList from './TrackList.svelte';
  import SelectionActions from './SelectionActions.svelte';
  import { lib, playlistById, tracksOf, totalSec, playable, patchPlaylist, deletePlaylist, setPlaylistCover, clearPlaylistCover } from '../lib/library.svelte.js';
  import { ui, go, toast, ask, openMenu, pickImage } from '../lib/ui.svelte.js';
  import { player, playContext, toggle, setShuffle, setTransition, contextChanged, shuffleOf, transitionOf } from '../lib/player.svelte.js';
  import { songs, longDuration } from '../lib/format.js';

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
    { id: 'none', label: 'Direct', hint: 'Next song starts the moment one ends' },
    { id: 'fade', label: 'Fade', hint: 'Fades out, then the next fades in' },
    { id: 'crossfade', label: 'Crossfade', hint: 'Fades out while the next fades in over it' },
  ];

  function playAll() {
    if (isCtx && player.trackId) return toggle();
    playContext(id);
  }
  async function rename() {
    const name = await ask({ kind: 'prompt', title: 'Rename', value: pl.name, confirm: 'Save' });
    if (name && name !== pl.name) await patchPlaylist(id, { name });
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
      <Cover src={pl.cover} srcs={covers} size="100%" radius={14} />
      <span class="art-edit"><Icon name="image" size={22} /><span>Change cover</span></span>
    </button>
    <div class="info">
      <h1><button class="title" onclick={rename} title="Rename">{pl.name}</button></h1>
      <p class="meta">
        <span>{pl.kind === 'custom' ? 'Playlist' : 'Upload'}</span>
        <span>{songs(tracks.length)}</span>
        {#if okCount}<span>{longDuration(totalSec(tracks))}</span>{/if}
        {#if failed}<span class="warn">{failed} unavailable</span>{/if}
      </p>
    </div>
  </header>

  <div class="actions">
    <button class="play" onclick={playAll} disabled={!okCount} aria-label={isCtx && player.playing ? 'Pause' : 'Play'}>
      <Icon name={isCtx && player.playing ? 'pause' : 'play'} size={24} />
    </button>
    <div class="seg" role="radiogroup" aria-label="Order">
      <button role="radio" aria-checked={!shuffle} class:active={!shuffle} onclick={() => setShuffle(id, false)}>In order</button>
      <button role="radio" aria-checked={shuffle} class:active={shuffle} onclick={() => setShuffle(id, true)}>Shuffle</button>
    </div>
    <div class="seg trans" role="radiogroup" aria-label="Transition between songs">
      {#each TRANSITIONS as t}
        <button role="radio" aria-checked={transition === t.id} class:active={transition === t.id} title={t.hint} onclick={() => setTransition(id, t.id)}>{t.label}</button>
      {/each}
    </div>
    <div class="list-tools">
      {#if tracks.length}<SelectionActions bind:selecting bind:selected exceptId={id} mode="toggle" />{/if}
      <button class="icon-btn more" aria-label="Playlist menu" onclick={more}><Icon name="more" size={22} /></button>
    </div>
  </div>

  {#if tracks.length}
    {#if selecting}
      <div class="selection-bar">
        <span class="sub">{selected.size} selected</span>
        <SelectionActions bind:selecting bind:selected exceptId={id} mode="actions" />
      </div>
    {/if}
    <TrackList {tracks} contextId={id} playlistId={id} sortable onReorder={reorder} {selecting} bind:selected />
  {:else}
    <div class="empty">
      <p>This playlist is empty. Add songs from any list through their <strong>⋯</strong> menu, a right-click or a long press.</p>
      <button class="btn ghost" onclick={() => { ui.libraryView = 'songs'; go('home'); }}>Browse all songs</button>
    </div>
  {/if}
{:else if lib.loaded}
  <div class="empty"><p>This playlist no longer exists.</p><button class="btn ghost" onclick={() => go('home')}>Home</button></div>
{/if}

<style>
  .hero { display: flex; align-items: flex-end; gap: 32px; padding: 12px 0 30px; }
  .art {
    position: relative; width: 232px; flex: none; aspect-ratio: 1; padding: 0; border: none; background: none; cursor: pointer; border-radius: 14px;
    box-shadow: 0 24px 60px rgba(0,0,0,.6); transition: transform .35s var(--ease);
  }
  .art:hover { transform: translateY(-2px); }
  .art-edit {
    position: absolute; inset: 0; border-radius: 14px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
    background: rgba(0,0,0,.6); color: #fff; font-size: 13px; font-weight: 600; opacity: 0; transition: opacity .2s;
  }
  .art:hover .art-edit, .art:focus-visible .art-edit { opacity: 1; }
  .info { min-width: 0; padding-bottom: 6px; }
  h1 { margin: 0 0 14px; }
  .title {
    display: block; max-width: 100%; padding: 0; border: none; background: none; cursor: text; text-align: left;
    font: inherit; font-size: clamp(34px, 6vw, 72px); line-height: 1.02; font-weight: 800; letter-spacing: -0.04em;
    /* dyke hero headline */
    background: linear-gradient(180deg, #ffffff 25%, #8a8a8a 135%); -webkit-background-clip: text; background-clip: text; color: transparent;
    overflow-wrap: anywhere; text-wrap: balance;
  }
  .meta { display: flex; flex-wrap: wrap; gap: 0; margin: 0; font-size: 14px; color: var(--muted); }
  .meta span + span::before { content: '·'; margin: 0 8px; color: var(--muted-2); }
  .meta span:first-child { color: #fff; font-weight: 600; }
  .meta .warn { color: var(--muted); }

  .actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 26px; }
  .play {
    width: 56px; height: 56px; flex: none; border-radius: 50%; border: none; cursor: pointer;
    display: grid; place-items: center; background: #fff; color: #000; padding-left: 2px;
    box-shadow: 0 10px 30px rgba(0,0,0,.6); transition: background .2s, transform .25s var(--ease);
  }
  .play:hover { background: #d8d8d8; transform: scale(1.04); }
  .play:active { transform: scale(.97); }
  .play:disabled { background: #2a2a2a; color: #666; cursor: not-allowed; transform: none; }
  .list-tools { display: flex; align-items: center; gap: 4px; margin-left: auto; }
  .selection-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; margin: -10px 0 12px; }

  .empty { padding: 44px 20px; text-align: center; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card-fill); }
  .empty p { margin: 0 auto 18px; max-width: 46ch; color: var(--muted); font-size: 14px; }
  .empty strong { color: #fff; }

  @media (max-width: 760px) {
    .hero { flex-direction: column; align-items: stretch; gap: 22px; padding: 4px 0 20px; }
    .art { width: min(62vw, 240px); align-self: center; }
    .title { font-size: clamp(30px, 9vw, 44px); }
    .actions { display: grid; grid-template-columns: auto 1fr auto; gap: 12px; }
    .actions .play { grid-column: 3; grid-row: 1; }
    .actions .seg:not(.trans) { grid-column: 1; grid-row: 1; }
    .actions .list-tools { grid-column: 2; grid-row: 1; justify-self: end; margin: 0; }
    .trans { grid-column: 1 / -1; grid-row: 2; justify-self: stretch; }
    .trans button { flex: 1; padding-inline: 8px; }
  }
  @media (max-width: 380px) {
    .actions { gap: 8px; }
    .actions .seg:not(.trans) button { padding-inline: 8px; font-size: 12px; }
  }
</style>

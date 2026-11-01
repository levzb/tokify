<script>
  import Icon from './Icon.svelte';
  import LinkSearch from './LinkSearch.svelte';
  import { openDownload } from '../lib/download.svelte.js';
  import Cover from './Cover.svelte';
  import TrackList from './TrackList.svelte';
  import SelectionActions from './SelectionActions.svelte';
  import { lib, imports, allSongs, tracksOf, totalSec, playable, createPlaylist } from '../lib/library.svelte.js';
  import { ui, go } from '../lib/ui.svelte.js';
  import { readSource, filesFromDrop } from '../lib/source.js';
  import { songs, longDuration, plural } from '../lib/format.js';
  import { playContext } from '../lib/player.svelte.js';
  import { MEDIA_ACCEPT } from '../../shared/media.js';
  import { discardPreviews } from '../lib/fileScan.js';

  // ---- upload zone ----
  let over = $state(false);
  let reading = $state(false);
  let picked = $state(null); // { sounds, label }
  let error = $state('');
  let scanProgress = $state(null);
  let fileInput, folderInput;

  async function take(files) {
    if (reading) return;
    const chosen = [...files];
    if (picked?.kind === 'files') discardPreviews(picked.files);
    error = ''; picked = null; reading = true;
    scanProgress = null;
    try { picked = await readSource(chosen, (p) => { scanProgress = p; }); error = (picked.errors || []).join('\n'); }
    catch (e) { error = e.message; }
    finally { reading = false; }
  }
  function clearPicked() {
    if (picked?.kind === 'files') discardPreviews(picked.files);
    picked = null;
  }
  async function onDrop(e) {
    e.preventDefault(); over = false;
    take(await filesFromDrop(e.dataTransfer));
  }
  function startImport(e) {
    e.stopPropagation();
    if (picked.kind === 'files') {
      if (!ui.filesBusy) { ui.fileImportSource = picked; picked = null; }
      ui.fileImportOpen = true;
      return;
    }
    ui.importSource = picked;
    ui.importOpen = true;
    picked = null;
  }

  async function newPlaylist() {
    const id = await createPlaylist();
    go('playlist', id);
  }

  // ---- library section ----
  const importList = $derived(imports());
  const songsAll = $derived(allSongs());
  const q = $derived(ui.search.trim().toLowerCase());
  const filtered = $derived(q ? songsAll.filter((t) => `${t.title} ${t.author} ${t.source}`.toLowerCase().includes(q)) : songsAll);
  const showSongs = $derived(ui.libraryView === 'songs' || !!q);

  let selecting = $state(false);
  let selected = $state(new Set());

  const cardCovers = (pl) => tracksOf(pl).filter((t) => t.cover && t.status === 'ok').slice(0, 4).map((t) => t.cover);
  const cardGlow = (pl) => tracksOf(pl).find((t) => t.status === 'ok')?.color || '#ffffff';
  const failedCount = (pl) => tracksOf(pl).filter((t) => t.status === 'failed').length;
  const jobFor = (pl) => (ui.importJob?.playlistId === pl.id && !ui.importJob.finished ? ui.importJob : null);
</script>

<LinkSearch />

<section class="top">
  <div class="card tile drop" class:over class:has={!!picked} role="button" tabindex="0"
    onclick={() => !picked && !reading && fileInput.click()}
    onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && !picked && !reading && fileInput.click()}
    ondragover={(e) => { e.preventDefault(); over = true; }}
    ondragleave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) over = false; }}
    ondrop={onDrop}>
    <span class="ico">{#if reading}<span class="spinner"></span>{:else}<Icon name={picked ? 'check' : 'upload'} size={22} />{/if}</span>
    {#if picked}
      <h3>{picked.kind === 'files' ? plural(picked.files.length, 'file') : `Found ${plural(picked.sounds.length, 'sound')}`}</h3>
      <p class="file">{picked.label}</p>
      {#if error}<p class="err" role="alert">{error}</p>{/if}
      <div class="acts">
        <button class="btn primary" onclick={startImport}>Upload</button>
        <button class="btn quiet" onclick={(e) => { e.stopPropagation(); clearPicked(); }}>Another file</button>
      </div>
    {:else}
      <h3>Archive or media files</h3>
      <p aria-live="polite">{reading ? (scanProgress ? `Checking audio · ${scanProgress.done + 1} of ${scanProgress.total} · ${Math.round(scanProgress.progress * 100)}% uploaded` : 'Checking files…') : over ? 'Drop it' : 'Drop a TikTok archive, audio, video or a folder here, or click to choose'}</p>
      {#if error}<p class="err" role="alert">{error}</p>{/if}
      <button class="link" disabled={reading} onclick={(e) => { e.stopPropagation(); folderInput.click(); }}><Icon name="folder" size={14} /> Choose a folder</button>
      {#if ui.filesBusy}<button class="link" onclick={(e) => { e.stopPropagation(); ui.fileImportOpen = true; }}>View file import</button>{/if}
    {/if}
    <input bind:this={fileInput} type="file" accept={MEDIA_ACCEPT} multiple hidden disabled={reading} onchange={(e) => { if (e.target.files.length) take([...e.target.files]); e.target.value = ''; }} />
    <input bind:this={folderInput} type="file" webkitdirectory hidden disabled={reading} onchange={(e) => { if (e.target.files.length) take([...e.target.files]); e.target.value = ''; }} />
  </div>

  <button class="card tile lift create" onclick={newPlaylist}>
    <span class="ico"><Icon name="plus" size={22} /></span>
    <h3>New playlist</h3>
    <p>Start empty and fill it with your songs</p>
    <span class="arrow" aria-hidden="true"><Icon name="right" size={20} /></span>
  </button>
</section>

<section class="library">
  <div class="section-head">
    <h2>{showSongs ? (q ? 'Search' : 'All songs') : 'Uploads'}</h2>
    <div class="tools">
      <label class="search" class:filled={!!ui.search}>
        <Icon name="search" size={16} />
        <input type="search" placeholder="Search songs" bind:value={ui.search} aria-label="Search songs" />
        {#if ui.search}<button class="clear" aria-label="Clear" onclick={() => (ui.search = '')}><Icon name="x" size={14} /></button>{/if}
      </label>
      <div class="view-tools">
      <button class="icon-btn" aria-label="Download library" title="Download for offline listening" onclick={()=>openDownload({contextId:'all',name:'All songs'})}><Icon name="download" size={20}/></button>
      <div class="seg" role="tablist">
        <button role="tab" class:active={!showSongs} aria-selected={!showSongs} onclick={() => { ui.libraryView = 'imports'; ui.search = ''; selecting = false; }}>Uploads</button>
        <button role="tab" class:active={showSongs} aria-selected={showSongs} onclick={() => (ui.libraryView = 'songs')}>All songs</button>
      </div>
      </div>
    </div>
  </div>

  {#if !showSongs}
    {#if importList.length}
      <div class="grid">
        {#each importList as pl, i (pl.id)}
          {@const tr = tracksOf(pl)}
          {@const job = jobFor(pl)}
          <button class="card lift import" style="--glow:{cardGlow(pl)}; animation-delay:{Math.min(i, 8) * 40}ms" onclick={() => { if (job) { ui.importSource = null; ui.importOpen = true; } else go('playlist', pl.id); }}>
            <span class="art">
              <span class="halo"></span>
              <Cover src={pl.cover} srcs={cardCovers(pl)} size="100%" radius={12} />
              {#if tr.some(playable)}
                <span class="play" role="presentation" onclick={(e) => { e.stopPropagation(); playContext(pl.id); }}><Icon name="play" size={20} /></span>
              {/if}
            </span>
            <span class="name">{pl.name}</span>
            <span class="meta">
              {#if job}
                <span class="spinner tiny"></span> {job.done} of {job.total}
              {:else}
                {songs(tr.length)}{#if totalSec(tr)}{' · '}{longDuration(totalSec(tr))}{/if}
              {/if}
            </span>
            {#if !job && failedCount(pl)}<span class="meta warn">{failedCount(pl)} unavailable</span>{/if}
          </button>
        {/each}
      </div>
    {:else}
      <p class="empty">Your uploads will appear here. Start with your TikTok archive above.</p>
    {/if}
  {:else}
    {#if filtered.length}
      <div class="songs-bar">
        <span class="sub">{songs(filtered.length)}{selecting ? ` · ${selected.size} selected` : ''}</span>
        <SelectionActions bind:selecting bind:selected />
      </div>
    {/if}
    <TrackList tracks={filtered} contextId="all" {selecting} bind:selected
      emptyText={q ? `Nothing matches “${ui.search}”` : 'No songs yet. Upload your TikTok archive.'} />
  {/if}
</section>

<style>
  .top { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 56px; }
  .tile {
    display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
    min-height: 220px; padding: 32px 30px 28px; text-align: left; cursor: pointer; color: var(--text);
  }
  .tile h3 { margin: 18px 0 0; font-size: 22px; font-weight: 700; letter-spacing: -0.035em; line-height: 1.2; }
  .tile p { margin: 0; max-width: 34ch; font-size: 13.5px; color: var(--muted); line-height: 1.55; }
  .ico {
    width: 48px; height: 48px; display: grid; place-items: center; border-radius: 50%;
    background: rgba(255,255,255,.05); border: 1px solid var(--border); color: #fff;
    transition: background .25s, color .25s, transform .35s var(--ease), box-shadow .25s;
  }
  .drop { transition: transform .25s var(--ease), border-color .25s, box-shadow .25s, background .25s; }
  .drop:hover, .drop.over { border-color: var(--border-strong); }
  .drop:hover::after, .drop.over::after { opacity: 1; }
  .drop.over { transform: translateY(-4px); box-shadow: var(--shadow-lift); }
  .drop.over .ico { background: #fff; color: #000; transform: translateY(-3px); box-shadow: 0 0 0 8px rgba(255,255,255,.06); }
  .drop.has { cursor: default; border-color: var(--border-strong); }
  .drop.has .ico { background: #fff; color: #000; animation: popCheck .5s var(--ease) both; box-shadow: 0 0 0 8px rgba(255,255,255,.06); }
  .file { font-family: var(--mono); font-size: 12.5px !important; word-break: break-all; }
  .acts { display: flex; gap: 8px; margin-top: auto; padding-top: 14px; flex-wrap: wrap; }
  .err { color: var(--danger) !important; white-space: pre-line; overflow-wrap: anywhere; }
  .link {
    margin-top: auto; padding: 14px 0 0; display: inline-flex; align-items: center; gap: 6px;
    background: none; border: none; color: var(--muted); font-size: 12.5px; font-weight: 600; cursor: pointer; transition: color .2s;
  }
  .link:hover { color: #fff; }
  .create { border: 1px solid var(--border); font: inherit; }
  .create:hover .ico { background: #fff; color: #000; }
  .arrow { position: absolute; top: 30px; right: 30px; color: var(--muted); transition: transform .2s, color .2s; }
  .create:hover .arrow { transform: translateX(4px); color: #fff; }

  .view-tools { display: flex; align-items: center; gap: 10px; }
  .tools { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .search {
    display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 12px 0 14px; width: 240px;
    color: var(--muted); background: rgba(255,255,255,.03); border: 1px solid var(--border); border-radius: 999px;
    transition: border-color .2s, background .2s;
  }
  .search:focus-within, .search.filled { border-color: var(--border-strong); background: var(--raise-2); color: #fff; }
  .search input { flex: 1; min-width: 0; background: none; border: none; outline: none; color: #fff; font: inherit; font-size: 14px; }
  .search input::placeholder { color: var(--muted-2); }
  .search input::-webkit-search-cancel-button { display: none; }
  .clear { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; border: none; background: rgba(255,255,255,.08); color: #fff; cursor: pointer; }

  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 18px; }
  .import {
    display: flex; flex-direction: column; gap: 4px; padding: 14px 14px 18px; text-align: left; cursor: pointer;
    color: var(--text); font: inherit; aspect-ratio: 3 / 4.1;
    animation: fadeUp .6s var(--ease) both;
  }
  .art { position: relative; display: block; width: 100%; aspect-ratio: 1; margin-bottom: 12px; }
  .halo { position: absolute; left: 50%; top: 50%; width: 70%; height: 70%; transform: translate(-50%, -50%); border-radius: 50%; background: var(--glow); opacity: .18; filter: blur(38px); transition: opacity .35s; }
  .import:hover .halo { opacity: .34; }
  .art :global(.cover) { position: relative; box-shadow: 0 10px 26px rgba(0,0,0,.55); transition: transform .35s var(--ease); }
  .import:hover .art :global(.cover) { transform: translateY(-2px) scale(1.02); }
  .play {
    position: absolute; right: 10px; bottom: 10px; width: 46px; height: 46px; border-radius: 50%;
    display: grid; place-items: center; background: #fff; color: #000; padding-left: 3px;
    box-shadow: 0 10px 24px rgba(0,0,0,.6);
    opacity: 0; transform: translateY(8px); transition: opacity .25s, transform .3s var(--ease), background .2s;
  }
  .import:hover .play, .import:focus-visible .play { opacity: 1; transform: none; }
  .play:hover { background: #d8d8d8; }
  .name { font-size: 15px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.3; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .meta { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted-2); }
  .meta.warn { color: var(--muted); }
  .spinner.tiny { width: 11px; height: 11px; border-width: 1.5px; }

  .songs-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: -6px 0 14px; min-height: 44px; }
  .empty { padding: 48px 12px; text-align: center; color: var(--muted); font-size: 14px; border: 1px solid var(--border); border-radius: var(--radius); margin: 0; }

  @media (max-width: 760px) {
    .top { gap: 12px; margin-bottom: 40px; }
    .tile { min-height: 190px; padding: 20px 16px 18px; }
    .tile h3 { font-size: 17px; margin-top: 12px; }
    .tile p { font-size: 12.5px; }
    .ico { width: 40px; height: 40px; }
    .arrow { top: 20px; right: 16px; }
    .acts .btn { padding: 9px 12px; }
    .section-head { flex-direction: column; align-items: stretch; gap: 14px; }
    .tools { flex-direction: column-reverse; align-items: stretch; }
    .search, .search:focus-within, .search.filled { width: 100%; }
    .seg { align-self: flex-start; }
    .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .import { padding: 10px 10px 14px; aspect-ratio: auto; }
    .play { opacity: 1; transform: none; width: 40px; height: 40px; }
  }
</style>

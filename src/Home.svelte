<script>
  import Icon from './Icon.svelte';
  import Search from './Search.svelte';
  import { search, isLink, openLink } from './search.svelte.js';
  import { openDownload, lib, imports, allSongs, tracksOf, totalSec, playable, createPlaylist, ui, go } from './state.svelte.js';
  import Cover from './Cover.svelte';
  import TrackList from './TrackList.svelte';
  import SelectionActions from './SelectionActions.svelte';
  import { readSource, filesFromDrop, discardPreviews } from './files.js';
  import { songs, longDuration, plural } from './util.js';
  import { playContext } from './player.svelte.js';
  import { MEDIA_ACCEPT } from '../server/shared.js';

  // A link pasted anywhere on Home goes straight into search.
  function pasteLink(e) {
    if (e.target?.matches?.('input, textarea, [contenteditable="true"]')) return;
    const text = e.clipboardData?.getData('text')?.trim();
    if (!text || !isLink(text)) return;
    e.preventDefault(); search.q = text; search.open = true; openLink(text);
  }

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
  // The whole window is the drop target: it frosts over, its edge breathes, the cards float in the middle.
  let depth = 0;
  let count = $state(1);
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  function dragEnter(e) {
    if (!hasFiles(e) || reading || picked) return;
    e.preventDefault(); depth++; over = true;
    count = Math.max(1, e.dataTransfer.items?.length || 1);
  }
  function dragOver(e) { if (over) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }
  function dragLeave(e) { if (over && --depth <= 0) { depth = 0; over = false; } }
  async function onDrop(e) {
    if (!over) return;
    e.preventDefault(); depth = 0; over = false;
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
  // The upload stage shows your own music: three covers fanned out, tinted by the first one.
  const fan = $derived(songsAll.filter((t) => t.cover && t.status === 'ok').slice(0, 3));
  const stageColor = $derived(fan[0]?.color || '#6b6f86');
  const nextName = $derived(`My playlist #${lib.playlists.filter((p) => p.kind === 'custom').length + 1}`);
  // Matching ignores case, accents and alphabet: "bumaga" finds "БУМАГА", "кити" finds "Kitty".
  const CYR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'i', є: 'e', ґ: 'g' };
  const fold = (x) => x.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[а-яёіїєґ]/g, (c) => CYR[c] ?? c)
    .replace(/kh/g, 'h').replace(/y/g, 'i').replace(/[^a-z0-9]+/g, ' ').replace(/(.)\1+/g, '$1').trim();
  const q = $derived(ui.search.trim().toLowerCase());
  const qf = $derived(fold(q));
  const filtered = $derived(q ? songsAll.filter((t) => { const s = `${t.title} ${t.author}`; return s.toLowerCase().includes(q) || (!!qf && fold(s).includes(qf)); }) : songsAll);

  // Finding a sound you already have: the magnifier by "Download library" opens into a small field.
  let finding = $state(!!ui.search);
  let findInput = $state();
  function openFind() { finding = true; queueMicrotask(() => findInput?.focus()); }
  function closeFind() { finding = false; ui.search = ''; }
  function findKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); } }
  const showSongs = $derived(ui.libraryView === 'songs' || !!q);

  let selecting = $state(false);
  let selected = $state(new Set());

  const cardCovers = (pl) => tracksOf(pl).filter((t) => t.cover && t.status === 'ok').slice(0, 4).map((t) => t.cover);
  const cardGlow = (pl) => tracksOf(pl).find((t) => t.status === 'ok')?.color || '#ffffff';
  const failedCount = (pl) => tracksOf(pl).filter((t) => t.status === 'failed').length;
  const jobFor = (pl) => (ui.importJob?.playlistId === pl.id && !ui.importJob.finished ? ui.importJob : null);
</script>

<svelte:window ondragenter={dragEnter} ondragover={dragOver} ondragleave={dragLeave} ondrop={onDrop} onpaste={pasteLink} />

{#if over}
  <div class="dropping" aria-hidden="true">
    <div class="ring"></div>
    <div class="stack" style="--n:{Math.min(count, 3)}">
      {#each Array(Math.min(count, 3)) as _, i}
        <span class="card" style="--i:{i}"><Icon name={i === 0 ? 'upload' : 'note'} size={i === 0 ? 40 : 28} /></span>
      {/each}
    </div>
    <p class="drop-title">Drop to upload</p>
    <p class="drop-sub">TikTok archive, audio, video or a folder</p>
    <span class="drop-count">{plural(count, 'item')}</span>
  </div>
{/if}

<Search>
<section class="top" aria-label="Add music">
  <div class="stage" class:has={!!picked} class:busy={reading} style="--c:{stageColor}">
    <div class="fan" aria-hidden="true">
      {#each [0, 1, 2] as i}
        <span class="sleeve" style="--i:{i}"><Cover src={fan[2 - i]?.cover} size="100%" radius={8} /></span>
      {/each}
      <span class="badge" class:done={!!picked}>
        {#if reading}<span class="spinner dark"></span>{:else}<Icon name={picked ? 'check' : 'upload'} size={22} stroke={2.2} />{/if}
      </span>
    </div>
    <div class="stage-body">
      {#if picked}
        <h2 class="stage-title">{picked.kind === 'files' ? plural(picked.files.length, 'file') : `Found ${plural(picked.sounds.length, 'sound')}`}</h2>
        <p class="stage-sub file">{picked.label}</p>
      {:else}
        <h2 class="stage-title">Upload music</h2>
        {#if reading}<p class="stage-sub" aria-live="polite">{scanProgress ? `Checking audio · ${scanProgress.done + 1} of ${scanProgress.total} · ${Math.round(scanProgress.progress * 100)}% uploaded` : 'Checking files…'}</p>{/if}
      {/if}
      <div class="stage-acts">
        {#if picked}
          <button class="btn primary icon" aria-label="Upload" onclick={startImport}><Icon name="check" size={19} stroke={2.5} /></button>
          <button class="btn ghost icon" aria-label="Another file" onclick={clearPicked}><Icon name="x" size={19} /></button>
        {:else}
          <button class="btn primary icon" aria-label="Upload files" disabled={reading} onclick={() => fileInput.click()}><Icon name="upload" size={19} /></button>
          <button class="btn ghost icon" aria-label="Choose a folder" disabled={reading} onclick={() => folderInput.click()}><Icon name="folder" size={19} /></button>
          {#if ui.filesBusy}<button class="btn ghost icon" aria-label="View file import" onclick={() => (ui.fileImportOpen = true)}><Icon name="arrow" size={19} /></button>{/if}
        {/if}
      </div>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    </div>
  </div>

  <button class="blank" onclick={newPlaylist}>
    <span class="blank-art" aria-hidden="true"><Icon name="plus" size={36} stroke={1.6} /></span>
    <span class="blank-txt"><span class="blank-name">New playlist</span><span class="blank-sub">{nextName}</span></span>
  </button>

  <input bind:this={fileInput} type="file" accept={MEDIA_ACCEPT} multiple hidden disabled={reading} onchange={(e) => { if (e.target.files.length) take([...e.target.files]); e.target.value = ''; }} />
  <input bind:this={folderInput} type="file" webkitdirectory hidden disabled={reading} onchange={(e) => { if (e.target.files.length) take([...e.target.files]); e.target.value = ''; }} />
</section>

<section class="library">
  <div class="section-head">
    <h2>{showSongs ? (q ? 'Search' : 'All songs') : 'Uploads'}</h2>
  </div>
  <div class="toolbar">
    <div class="seg filters" role="tablist">
      <button role="tab" class:active={!showSongs} aria-selected={!showSongs} onclick={() => { ui.libraryView = 'imports'; ui.search = ''; selecting = false; }}>Uploads</button>
      <button role="tab" class:active={showSongs} aria-selected={showSongs} onclick={() => (ui.libraryView = 'songs')}>All songs</button>
    </div>
    <div class="tools">
      {#if finding}
        <label class="find pill" class:filled={!!ui.search}>
          <Icon name="search" size={16} />
          <input bind:this={findInput} bind:value={ui.search} type="text" inputmode="search" autocomplete="off" spellcheck="false"
            placeholder="Title or artist" aria-label="Find in your songs" onkeydown={findKey}
            onblur={() => { if (!ui.search.trim()) finding = false; }} />
          <button class="icon-btn sm" aria-label="Close song search" onmousedown={(e) => e.preventDefault()} onclick={closeFind}><Icon name="x" size={15} /></button>
        </label>
      {:else}
        <button class="icon-btn fill" aria-label="Find in your songs" onclick={openFind}><Icon name="search" size={18} /></button>
      {/if}
      <button class="icon-btn fill" aria-label="Download library" onclick={()=>openDownload({contextId:'all',name:'All songs'})}><Icon name="download" size={18}/></button>
    </div>
  </div>

  {#if !showSongs}
    {#if importList.length}
      <div class="grid">
        {#each importList as pl, i (pl.id)}
          {@const tr = tracksOf(pl)}
          {@const job = jobFor(pl)}
          <button class="import" style="animation-delay:{Math.min(i, 8) * 30}ms" onclick={() => { if (job) { ui.importSource = null; ui.importOpen = true; } else go('playlist', pl.id); }}>
            <span class="art">
              <Cover src={pl.cover} srcs={cardCovers(pl)} size="100%" radius={6} />
              {#if tr.some(playable)}
                <span class="play pp" style="--s:44px" role="presentation" onclick={(e) => { e.stopPropagation(); playContext(pl.id); }}><Icon name="play" size={20} /></span>
              {/if}
            </span>
            <span class="name">{pl.name}</span>
            <span class="meta">
              {#if job}
                <span class="spinner xs"></span> {job.done} of {job.total}
              {:else}
                {songs(tr.length)}{#if totalSec(tr)}{' · '}{longDuration(totalSec(tr))}{/if}
              {/if}
            </span>
            {#if !job && failedCount(pl)}<span class="meta warn">{failedCount(pl)} unavailable</span>{/if}
          </button>
        {/each}
      </div>
    {:else}
      <p class="empty-state">Your uploads will appear here. Start with your TikTok archive above.</p>
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
</Search>

<style>
  /* ---- add music: the peak of Home ---- */
  .top { display: grid; grid-template-columns: minmax(0, 1fr) 232px; gap: 12px; margin: 0 0 44px; }

  /* Upload stage: your own covers fanned out, the room tinted by the first one. */
  .stage {
    position: relative; display: flex; align-items: center; gap: 40px; min-height: 232px; padding: 28px 36px; overflow: hidden;
    border-radius: var(--r-item);
    background:
      radial-gradient(90% 140% at 0% 50%, color-mix(in srgb, var(--c) 42%, transparent), transparent 70%),
      var(--fill-1);
  }
  .fan { position: relative; width: 196px; height: 164px; flex: none; }
  .sleeve {
    position: absolute; left: 12px; top: 6px; width: 148px; height: 148px; border-radius: 8px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, .45);
    transform: rotate(calc((var(--i) - 2) * -9deg)) translateX(calc((2 - var(--i)) * 18px));
    transition: transform .45s var(--ease);
  }
  .stage:hover .sleeve { transform: rotate(calc((var(--i) - 2) * -12deg)) translateX(calc((2 - var(--i)) * 22px)) translateY(calc((2 - var(--i)) * -4px)); }
  .badge {
    position: absolute; right: 0; bottom: -4px; z-index: 2; width: 52px; height: 52px; display: grid; place-items: center;
    border-radius: 50%; background: var(--accent); color: var(--on-accent); box-shadow: 0 8px 24px rgba(0, 0, 0, .45);
    transition: transform .3s var(--ease);
  }
  .stage:hover .badge { transform: scale(1.06); }
  .badge.done { animation: popCheck .45s var(--ease) both; }
  .stage-body { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .stage-title { margin: 0; font-size: 30px; line-height: 1.2; font-weight: 700; letter-spacing: -.02em; overflow-wrap: anywhere; }
  .stage-sub { margin: 6px 0 0; font-size: 14px; color: var(--muted); }
  .stage-sub.file { overflow-wrap: anywhere; }
  .stage-acts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
  .stage-acts .btn { min-height: 48px; padding-inline: 18px; border-radius: var(--r-item); }
  .stage-acts .btn.icon { width: 48px; min-width: 48px; padding: 0; }
  .stage-acts .btn.icon.primary { width: auto; min-width: 80px; padding-inline: 24px; }
  .stage .error { margin-top: 12px; }

  /* New playlist: a plain card, an empty cover with a plus. Flat, so it reads as a button, not a drop target. */
  .blank {
    display: flex; flex-direction: column; min-width: 0; padding: 12px 12px 14px; text-align: left; cursor: pointer;
    color: var(--text); font: inherit; background: var(--fill-1); border: none; border-radius: var(--r-item);
    transition: background .2s;
  }
  .blank:hover { background: var(--fill-2); }
  .blank-art {
    flex: 1; min-height: 120px; display: grid; place-items: center; margin-bottom: 12px;
    border-radius: 8px; color: var(--muted); background: var(--fill-1);
    transition: color .2s, background .2s;
  }
  .blank:hover .blank-art { color: var(--text); background: var(--fill-2); }
  .blank-txt { display: flex; flex-direction: column; min-width: 0; }
  .blank-name { font-size: 14px; font-weight: 600; }
  .blank-sub { font-size: 13px; color: var(--faint); }

  /* full-window drop state */
  .dropping {
    position: fixed; inset: 0; z-index: 280; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
    background: rgba(0, 0, 0, .45); -webkit-backdrop-filter: blur(40px) saturate(1.5); backdrop-filter: blur(40px) saturate(1.5);
    pointer-events: none; animation: fadeIn .15s ease both;
  }
  .ring { position: absolute; inset: 10px; border: 2px solid rgba(255, 255, 255, .9); border-radius: 18px; animation: breathe 2.2s ease-in-out infinite; }
  @keyframes breathe { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
  .stack { position: relative; width: 132px; height: 132px; margin-bottom: 18px; animation: land .5s cubic-bezier(.3, 1.4, .5, 1) both, float 2.4s ease-in-out .5s infinite; }
  .card {
    position: absolute; inset: 0; display: grid; place-items: center; border-radius: 16px; color: #fff;
    background: linear-gradient(160deg, #3a3d4a, #17181d); box-shadow: 0 18px 48px rgba(0, 0, 0, .5), inset 0 0 0 1px rgba(255, 255, 255, .1);
    transform: rotate(calc(var(--i) * 9deg - (var(--n) - 1) * 4.5deg)) translateX(calc(var(--i) * 14px));
    z-index: calc(3 - var(--i));
  }
  .card:not(:first-child) { color: rgba(255, 255, 255, .5); }
  @keyframes land { from { opacity: 0; transform: rotate(-8deg) scale(.85); } }
  @keyframes float { 0%, 100% { translate: 0 0; } 50% { translate: 0 -6px; } }
  .drop-title { margin: 0; font-size: 22px; font-weight: 600; }
  .drop-sub { margin: 0; font-size: 13.5px; color: rgba(255, 255, 255, .6); }
  .drop-count { margin-top: 10px; font-size: 12px; font-weight: 600; color: rgba(255, 255, 255, .8); font-variant-numeric: tabular-nums; }

  .section-head { margin-bottom: 12px; }
  .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px 12px; flex-wrap: wrap; margin-bottom: 16px; }
  .tools { display: flex; align-items: center; gap: 8px; }
  .tools .icon-btn { width: 36px; height: 36px; }
  .find {
    width: 260px; height: 36px; gap: 8px; padding: 0 2px 0 12px; cursor: text;
    background: var(--fill-1); color: var(--text); box-shadow: inset 0 0 0 1px var(--edge-strong);
    transform-origin: right center; animation: findOpen .38s var(--ease) both;
  }
  .find :global(svg) { flex: none; color: var(--muted); }
  .find input { flex: 1; min-width: 0; height: 100%; padding: 0; border: none; outline: none; background: none; font: inherit; font-size: 14px; color: var(--text); }
  .find input::placeholder { color: var(--faint); }
  .find .icon-btn { width: 32px; height: 32px; flex: none; color: var(--muted); }
  @keyframes findOpen { from { width: 36px; opacity: .4; } }

  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; }
  .import {
    display: flex; flex-direction: column; gap: 1px; min-width: 0; padding: 12px 12px 14px; text-align: left; cursor: pointer;
    color: var(--text); font: inherit; background: var(--fill-1); border: none; border-radius: var(--r-item);
    transition: background .2s;
    animation: fadeUp .3s var(--ease) both;
  }
  .import:hover { background: var(--fill-2); }
  .art { position: relative; display: block; width: 100%; aspect-ratio: 1; margin-bottom: 10px; }
  .art::after { content: ''; position: absolute; inset: 0; border-radius: var(--r-xs); background: #000; opacity: 0; transition: opacity .2s; pointer-events: none; }
  .import:hover .art::after { opacity: .18; }
  .play {
    position: absolute; right: 8px; bottom: 8px; padding-left: 2px; box-shadow: 0 6px 18px rgba(0,0,0,.4);
    opacity: 0; transform: translateY(6px); transition: opacity .2s, transform .25s var(--ease);
  }
  .import:hover .play, .import:focus-visible .play { opacity: 1; transform: none; }
  .play:hover { transform: scale(1.05) !important; }
  .name { font-size: 14px; font-weight: 500; line-height: 1.35; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .meta { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--faint); }

  .songs-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: -6px 0 8px; min-height: 40px; }

  @media (max-width: 1000px) { .top { grid-template-columns: minmax(0, 1fr) 200px; } .stage { gap: 28px; padding: 24px; } }
  @media (max-width: 760px) {
    .top { grid-template-columns: 1fr; gap: 8px; margin-bottom: 32px; }
    .stage { flex-wrap: wrap; gap: 20px; min-height: 0; padding: 20px 16px 16px; background: radial-gradient(140% 90% at 50% 0%, color-mix(in srgb, var(--c) 40%, transparent), transparent 70%), var(--fill-1); }
    .fan { width: 124px; height: 112px; }
    .sleeve { width: 100px; height: 100px; left: 8px; top: 4px; }
    .badge { width: 44px; height: 44px; }
    .stage-body { flex: 1 1 140px; }
    .stage-title { font-size: 24px; }
    .stage-acts { flex-basis: 100%; width: 100%; }
    .stage-acts .btn { flex: 1 1 auto; min-height: 48px; }
    .stage-acts .btn.ghost { background: var(--fill-1); }
    .blank { flex-direction: row; align-items: center; gap: 14px; padding: 8px 12px 8px 8px; }
    .blank-art { flex: none; width: 56px; height: 56px; min-height: 0; margin: 0; }
    .blank-txt { flex: 1; }
    .section-head h2 { font-size: 22px; }
    .tools .icon-btn { width: 44px; height: 40px; }
    .find { width: min(220px, 52vw); height: 40px; }
    .find .icon-btn { width: 36px; height: 36px; }
    .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .import { padding: 8px 8px 12px; }
    .play { opacity: 1; transform: none; --s: 38px !important; }
  }
</style>

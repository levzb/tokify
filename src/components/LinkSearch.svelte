<script>
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import Cover from './Cover.svelte';
  import { api } from '../lib/api.js';
  import { lib, load } from '../lib/library.svelte.js';
  import { go, toast, ui } from '../lib/ui.svelte.js';
  import { clock } from '../lib/format.js';
  import { parseMediaLink, providerName } from '../../shared/media-link.js';

  let link = $state('');
  let result = $state(null);
  let phase = $state('idle');
  let error = $state('');
  let coverFailed = $state(false);
  let version = 0;
  let linkInput;
  let candidates = $state([]);
  let matching = $state(false);
  let lookupProvider = $state('');
  const searching = $derived(phase === 'searching');
  const downloading = $derived(phase === 'downloading');
  const destination = $derived(lib.playlists.find((p) => p.kind === 'external')?.name || 'Мои файлы');

  function reset() {
    version++;
    result = null; error = ''; phase = 'idle'; coverFailed = false; candidates = []; matching = false;
  }
  async function find(candidateUrl) {
    if (typeof candidateUrl === 'string') { link = candidateUrl; reset(); }
    if (!link.trim() || searching) return;
    const v = ++version;
    result = null; error = ''; coverFailed = false; phase = 'searching';
    try {
      const parsed = parseMediaLink(link);
      link = parsed.url; lookupProvider = providerName(parsed.provider);
      linkInput?.blur();
      if (linkInput) linkInput.scrollLeft = 0;
      const found = await api('/api/links/resolve', { method: 'POST', body: { link } });
      if (v !== version) return;
      result = found; phase = found.saved ? 'done' : 'found';
      if (linkInput) linkInput.scrollLeft = 0;
    } catch (e) {
      if (v === version) { error = e.message; phase = 'idle'; }
    }
  }
  async function searchMatches() {
    if (!result || matching) return;
    const v = version; matching = true; error = ''; candidates = [];
    try {
      const found = await api('/api/links/spotify/search', { method:'POST', body:{token:result.token} });
      if (v !== version) return;
      candidates = found.candidates;
      if (!candidates.length) error = 'No YouTube matches found. Paste a YouTube or SoundCloud link directly.';
    } catch (e) { if (v === version) error = e.message; }
    finally { if (v === version) matching = false; }
  }
  function paste(e) {
    const text = e.clipboardData?.getData('text');
    if (!text) return;
    e.preventDefault(); link = text; reset(); find();
  }
  async function follow(jobId, v, song, trim = false) {
    for (let i = 0; i < 240; i++) {
      const job = await api(`/api/jobs/${jobId}`);
      if (job.finished) {
        await load();
        if (job.failed) throw new Error(job.items[song.musicId]?.error || 'Couldn’t download this sound. Try again.');
        if (v === version) { result = { ...song, saved: true, playlistId: job.playlistId }; phase = 'done'; if(trim)ui.clipTrackId=song.musicId; }
        else toast(`${song.title} added to ${job.name}`);
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('Still downloading on the Mac. Check your playlist in a moment.');
  }
  async function save(trim = false) {
    if (!result || downloading) return;
    if (result.saved) { if(trim)ui.clipTrackId=result.musicId;else go('playlist', result.playlistId); return; }
    if (!result.token || phase === 'failed') { find(); return; }
    const v = version, song = { ...result };
    phase = 'downloading'; error = '';
    try {
      const job = await api('/api/links/download', { method: 'POST', body: { token: song.token } });
      await load();
      await follow(job.jobId, v, song, trim);
    } catch (e) {
      if (v === version) { error = e.message; phase = 'failed'; }
      else toast(e.message);
      await load().catch(() => {});
    }
  }
  onMount(() => {
    // A restart or navigation does not interrupt downloads on the Mac.
    const v = version;
    api('/api/jobs').then(async ({ jobs }) => {
      const job = jobs.find((j) => j.kind === 'link' && !j.finished);
      if (!job || v !== version || link || result) return;
      const id = Object.keys(job.items)[0], t = lib.tracks[id];
      link = t?.link || `https://www.tiktok.com/music/sound-${id}`;
      result = { musicId: id, provider:t?.origin || 'tiktok', sourceUrl:link, canDownload:true, title: t?.title || 'TikTok sound', author: t?.author || '', duration: (t?.samples || 0) / 48000, cover: t?.cover, saved: false };
      phase = 'downloading';
      try { await follow(job.id, v, { ...result }); }
      catch (e) { if (v === version) { error = e.message; phase = 'failed'; } }
    }).catch(() => {});
  });
</script>

<section class="link-import" aria-label="Download music from a link">
  <form class="link-search" class:busy={searching} onsubmit={(e) => { e.preventDefault(); find(); }} aria-busy={searching}>
    <span class="search-icon"><Icon name="search" size={20} /></span>
    <input bind:this={linkInput} type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"
      aria-label="Music link" placeholder="Paste a TikTok, YouTube, SoundCloud or Spotify link" bind:value={link}
      oninput={reset} onpaste={paste} />
    {#if link}<button type="button" class="clear" aria-label="Clear music link" onclick={() => { link = ''; reset(); linkInput?.focus(); }}><Icon name="x" size={17} /></button>{/if}
    <button type="submit" class="btn primary find" disabled={!link.trim() || searching} aria-label="Find sound">
      {#if searching}<span class="spinner dark"></span><span>Finding…</span>{:else}Find{/if}
    </button>
  </form>
  <div class="feedback" aria-live="polite" aria-atomic="true">
    {#if searching}<p class="hint">Looking up {lookupProvider}…</p>{/if}
    {#if result}
      <div class="result">
        <div class="thumb">
          {#if result.cover && !coverFailed}<img src={result.cover} alt="" onerror={() => (coverFailed = true)} />{:else}<Cover size={56} radius={8} />{/if}
        </div>
        <div class="info">
          <span class="title">{result.title}</span>
          <span class="meta">{result.author || 'Unknown artist'}{result.duration ? ` · ${clock(result.duration)}` : ''}</span>
          <span class="destination"><a href={result.sourceUrl} target="_blank" rel="noreferrer">{providerName(result.provider || 'tiktok')}</a> · {result.canDownload === false ? 'Track information' : `${result.saved ? 'Saved in' : 'Saves to'} ${destination}`}</span>
        </div>
        {#if result.canDownload === false}
          <button type="button" class="btn ghost save" disabled={matching} onclick={searchMatches}>{#if matching}<span class="spinner"></span> Searching…{:else}<Icon name="search" size={17}/> Find on YouTube{/if}</button>
        {:else}
        <div class="result-actions">
        <button type="button" class="btn ghost save" disabled={downloading} onclick={()=>save(true)}><Icon name="cut" size={17}/>{result.saved?'Trim audio':'Import & trim'}</button>
        <button type="button" class="btn primary save" disabled={downloading} onclick={()=>save(false)}>
          {#if downloading}<span class="spinner dark"></span><span>Importing…</span>
          {:else if result.saved}<Icon name="check" size={17} /> Open
          {:else if phase === 'failed'}<Icon name="retry" size={17} /> Try again
          {:else}<Icon name="download" size={17} /> Import{/if}
        </button>
        </div>
        {/if}
      </div>
      {#if result.canDownload === false}<p class="hint">Spotify provides track information, not a full audio download. Find a recording on YouTube and choose the source before downloading.</p>{/if}
      {#if candidates.length}<div class="candidates" role="list" aria-label="YouTube matches">
        {#each candidates as candidate}
          <div class="candidate" role="listitem">
            <div class="info"><a class="title" href={candidate.url} target="_blank" rel="noreferrer">{candidate.title}</a><span class="meta">YouTube · {candidate.author} · {clock(candidate.duration)}</span></div>
            <button class="btn ghost" onclick={()=>find(candidate.url)}>Choose</button>
          </div>
        {/each}
      </div>{/if}
    {/if}
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
  .link-import { margin-bottom: 24px; }
  /* dyke.win .og-search: same pill, fill, borders and focus transition. */
  .link-search {
    display: flex; align-items: center; gap: 12px; padding: 6px 6px 6px 20px; min-height: 60px;
    background: var(--raise); border: 1px solid var(--border); border-radius: 999px;
    transition: border-color .2s, background .2s;
  }
  .link-search:focus-within { border-color: var(--border-strong); background: var(--raise-2); }
  .search-icon { display: flex; color: var(--muted); flex: none; }
  input { min-width: 0; flex: 1; padding: 10px 0; border: none; outline: none; background: none; color: #fff; font: inherit; font-size: 16px; }
  input::placeholder { color: var(--muted); }
  .find { border-radius: 999px; min-width: 88px; min-height: 46px; padding: 10px 20px; }
  .clear { display: grid; place-items: center; width: 36px; height: 44px; flex: none; padding: 0; background: none; border: none; color: var(--muted); cursor: pointer; }
  .clear:hover { color: #fff; }
  .spinner.dark { border-color: rgba(0,0,0,.15); border-top-color: #000; }
  .hint { margin: 12px 4px 0; color: var(--muted); font-size: 13px; }
  .result { display: flex; align-items: center; gap: 14px; padding: 14px 16px; margin-top: 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--card-fill); animation: fadeUp .35s var(--ease) both; }
  .thumb { width: 56px; height: 56px; flex: none; border-radius: 8px; overflow: hidden; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; }
  .info { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .title { font-size: 15px; font-weight: 600; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { font-size: 13px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .destination { font-size: 12px; color: var(--muted); margin-top: 3px; overflow-wrap: anywhere; }
  .destination a { color: inherit; text-decoration: none; }
  .destination a:hover { color: #fff; text-decoration: underline; text-underline-offset: 3px; }
  .candidates { margin-top: 12px; border-top: 1px solid var(--border); }
  .candidate { display: flex; align-items: center; gap: 16px; padding: 14px 4px; border-bottom: 1px solid var(--border); }
  .candidate .title { color: #fff; text-decoration: none; }
  .candidate .title:hover { text-decoration: underline; text-underline-offset: 3px; }
  .candidate .btn { min-height: 44px; }
  .result-actions { display: flex; align-items: center; gap: 8px; }
  .save { min-height: 44px; }
  .error { margin: 12px 4px 0; font-size: 13px; line-height: 1.5; color: var(--danger); overflow-wrap: anywhere; }
  @media (max-width: 760px) {
    .link-search { gap: 8px; padding-left: 16px; }
    .search-icon { display: none; }
    .clear { width: 28px; }
    .find { min-width: 70px; padding-inline: 14px; }
    .result { gap: 12px; padding: 14px; flex-wrap: wrap; }
    .info { flex-basis: calc(100% - 68px); }
    .save { width: 100%; }
    .result-actions { width: 100%; flex-wrap: wrap; }
    .result-actions .save { width: auto; flex: 1; padding-inline: 12px; }
  }
</style>

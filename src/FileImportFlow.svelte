<script>
  import Icon from './Icon.svelte';
  import Cover from './Cover.svelte';
  import Modal from './Modal.svelte';
  import { ui, go, lib, load } from './state.svelte.js';
  import { api, clock } from './util.js';
  import { discardPreviews } from './files.js';

  let rows = $state([]);
  let started = $state(false);
  let finished = $state(false);
  let playlistId = $state(null);
  const done = $derived(rows.filter((r) => r.status === 'ok' || r.status === 'failed').length);
  const ready = $derived(rows.filter((r) => r.status === 'ok').length);
  const failed = $derived(rows.filter((r) => r.status === 'failed').length);
  const canStart = $derived(rows.length > 0 && rows.every((r) => r.title.trim()));
  const percent = $derived(rows.length ? done / rows.length * 100 : 0);

  $effect(() => {
    const source = ui.fileImportSource;
    if (source && !ui.filesBusy) {
      rows = source.files.map((preview, i) => ({ ...preview, key: i, status: 'queued', error: '', trackId: null }));
      started = false; finished = false; playlistId = null;
      ui.fileImportSource = null;
    }
  });

  async function waitForJob(id) {
    while (true) {
      const job = await api(`/api/jobs/${id}`);
      if (job.finished) return job;
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  async function run(retry = false) {
    if (ui.filesBusy || !canStart) return;
    const batch = rows.filter((r) => !retry || r.status === 'failed');
    if (!batch.length) return;
    for (const row of batch) { row.status = 'queued'; row.error = ''; }
    started = true; finished = false; ui.filesBusy = true;
    try {
      for (const row of batch) {
        try {
          row.status = 'processing';
          let result;
          if (retry && row.trackId) result = await api(`/api/tracks/${row.trackId}/retry`, { method: 'POST' });
          else {
            result = await api('/api/files/commit', { method: 'POST', body: { token: row.token, title: row.title, author: row.author } });
            row.trackId = result.trackId;
            playlistId = result.playlistId;
            row.cover = result.cover;
          }
          const job = await waitForJob(result.jobId);
          playlistId = job.playlistId || playlistId;
          if (job.failed) throw new Error(job.items[row.trackId]?.error || 'Couldn’t extract audio');
          row.status = 'ok'; row.reused = !!job.reused;
        } catch (e) {
          row.status = 'failed'; row.error = e.message;
          if (e.status === 401) {
            for (const pending of batch) if (pending.status === 'queued') { pending.status = 'failed'; pending.error = 'Sign in again to import'; }
            break;
          }
        }
        await load().catch(() => {});
        if (row.trackId && lib.tracks[row.trackId]) row.cover = lib.tracks[row.trackId].cover;
      }
    } finally { ui.filesBusy = false; finished = true; await load().catch(() => {}); }
  }
  function close() {
    ui.fileImportOpen = false;
    if (!started) { discardPreviews(rows); rows = []; }
  }
  function remove(row) { discardPreviews([row]); rows = rows.filter((r) => r !== row); }
  function openFiles() { close(); if (playlistId) go('playlist', playlistId); }
  function editKey(e) {
    if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.currentTarget.blur(); }
  }
  function limitText(e, max) { if (e.currentTarget.textContent.length > max) e.currentTarget.textContent = e.currentTarget.textContent.slice(0, max); }
  const statusText = (row) => row.status === 'processing' ? 'Extracting audio…' : row.status === 'ok' ? (row.reused ? 'Already in library' : 'Added')
    : row.status === 'failed' ? row.error : 'Waiting';
</script>

{#if ui.fileImportOpen}
  <Modal label="Import files" title={finished ? 'File import complete' : started ? 'Importing files' : 'Import files'}
    lead={!started ? '' : finished ? `${ready} ready${failed ? ` · ${failed} failed` : ''}` : `${done} of ${rows.length}`}
    art={rows.find((r) => r.cover)?.cover || ''} size="xl" onclose={close}>
      {#if started}<div class="meter" role="progressbar" aria-label="File import progress" aria-valuenow={done} aria-valuemax={rows.length}><i style="transform:scaleX({percent / 100})"></i></div>{/if}
      <div class="files scroll">
        {#each rows as row (row.key)}
          <article class="file" class:failed={row.status === 'failed'}>
            <div class="art"><Cover src={row.cover} size="100%" radius={8} /></div>
            <div class="info">
              {#if !started}
                <div class="track-title editable" contenteditable="plaintext-only" role="textbox" tabindex="0" aria-multiline="false"
                  aria-label="Title for {row.filename}" spellcheck="false" bind:textContent={row.title}
                  oninput={(e) => limitText(e, 300)} onkeydown={editKey}
                  onblur={() => { row.title = row.title.trim() || row.filename.replace(/\.[^.]+$/, '') || row.filename; }}></div>
                <div class="author editable" contenteditable="plaintext-only" role="textbox" tabindex="0" aria-multiline="false"
                  aria-label="Author for {row.filename}" aria-placeholder="Add author" data-placeholder="Add author" spellcheck="false"
                  bind:textContent={row.author} oninput={(e) => limitText(e, 200)} onkeydown={editKey}
                  onblur={(e) => { row.author = row.author.trim(); if (!row.author) e.currentTarget.textContent = ''; }}></div>
              {:else}
                <h4 class="track-title">{row.title}</h4>
                <div class="author">{row.author || 'Unknown artist'}</div>
              {/if}
              <div class="file-meta"><span class="filename" title={row.filename}>{row.filename}</span>{#if row.duration}<span class="duration dur">{clock(row.duration)}</span>{/if}</div>
              {#if started}<p class="status" role="status">{#if row.status === 'processing'}<span class="spinner sm"></span>{:else if row.status === 'ok'}<Icon name="check" size={14} />{:else if row.status === 'failed'}<Icon name="alert" size={14} />{/if}{statusText(row)}</p>{/if}
            </div>
            {#if !started}<button class="icon-btn sm remove" aria-label="Remove {row.filename}" onclick={() => remove(row)}><Icon name="x" size={16} /></button>{/if}
          </article>
        {/each}
      </div>
      <div class="modal-foot">
        {#if !started}
          <button class="btn primary icon" aria-label="Import {rows.length} {rows.length === 1 ? 'file' : 'files'}" disabled={!canStart} onclick={() => run()}><Icon name="upload" size={19} /><span class="n">{rows.length}</span></button>
        {:else if finished}
          {#if failed}<button class="btn ghost icon" aria-label="Retry failed" onclick={() => run(true)}><Icon name="retry" size={19} /></button>{/if}
          {#if playlistId}<button class="btn primary icon" aria-label="Open My files" onclick={openFiles}><Icon name="arrow" size={20} /></button>{/if}
        {/if}
      </div>
  </Modal>
{/if}

<style>
  .files { display: grid; max-height: 52dvh; margin: 0 -8px; padding: 0 8px; }
  .file { position: relative; display: grid; grid-template-columns: 88px minmax(0,1fr); gap: 16px; align-items: center; padding: 12px 0; }
  .file:first-child { padding-top: 0; }
  .file:last-child { padding-bottom: 0; }
  .art { width: 100%; aspect-ratio: 1; border-radius: var(--r-control); box-shadow: var(--shadow-art); }
  .info { min-width: 0; padding-right: 32px; }
  .track-title { margin: 0; font-size: 15px; line-height: 1.3; font-weight: 600; letter-spacing: -.01em; overflow-wrap: anywhere; }
  .author { margin-top: 2px; font-size: 13px; line-height: 1.4; color: var(--muted); min-height: 1.4em; overflow-wrap: anywhere; }
  .editable { cursor: text; border: none; outline: none; background: none; border-radius: 4px; transition: color .2s, background .2s; }
  .editable:hover, .editable:focus { text-decoration: underline; text-decoration-color: var(--edge-strong); text-underline-offset: 5px; }
  .editable:empty::before { content: attr(data-placeholder); color: var(--muted); pointer-events: none; }
  .editable:focus-visible { outline: none; }
  .file-meta { display: flex; align-items: center; gap: 10px; margin-top: 6px; color: var(--faint); font-size: 13px; min-width: 0; }
  .filename { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .remove { position: absolute; right: -6px; top: 8px; }
  .file:first-child .remove { top: -4px; }
  .status { display: flex; align-items: center; gap: 7px; margin: 6px 0 0; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
  .status :global(svg) { flex: none; }
  .failed .track-title { color: var(--muted); }
  @media (max-width: 760px) {
    .file { grid-template-columns: 72px minmax(0,1fr); gap: 14px; }
    .info { padding-right: 28px; }
    .files { max-height: 55dvh; }
    .file-meta { flex-wrap: wrap; gap: 4px 8px; margin-top: 8px; }
    .filename { max-width: 100%; }
    .remove { right: -6px; top: 14px; }
  }
</style>

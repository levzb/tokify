<script>
  import Icon from './Icon.svelte';
  import Cover from './Cover.svelte';
  import { ui, go } from '../lib/ui.svelte.js';
  import { lib, load } from '../lib/library.svelte.js';
  import { api } from '../lib/api.js';
  import { clock } from '../lib/format.js';
  import { discardPreviews } from '../lib/fileScan.js';

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

<svelte:window onkeydown={(e) => ui.fileImportOpen && e.key === 'Escape' && close()} />

{#if ui.fileImportOpen}
  <div class="overlay" onclick={(e) => e.target === e.currentTarget && close()} role="presentation">
    <div class="modal" role="dialog" tabindex="-1" aria-modal="true" aria-label="Import files">
      <button class="modal-close icon-btn" onclick={close} aria-label="Close"><Icon name="x" size={18} /></button>
      <h3>{finished ? 'File import complete' : started ? 'Importing files' : 'Import files'}</h3>
      <p class="lead">{started ? `${done} of ${rows.length} processed${finished ? ` · ${ready} ready · ${failed} unavailable` : ''}` : 'Audio checked. Click the title or author to edit.'}</p>
      {#if started}<div class="progress" role="progressbar" aria-label="File import progress" aria-valuenow={done} aria-valuemax={rows.length}><div style="transform:scaleX({percent / 100})"></div></div>{/if}
      <div class="files">
        {#each rows as row (row.key)}
          <article class="file" class:failed={row.status === 'failed'}>
            <div class="art"><Cover src={row.cover} size="100%" radius={12} /></div>
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
              <div class="file-meta"><span class="filename" title={row.filename}>{row.filename}</span>{#if row.duration}<span class="duration mono">{clock(row.duration)}</span>{/if}</div>
              {#if started}<p class="status" role="status">{#if row.status === 'processing'}<span class="spinner"></span>{:else if row.status === 'ok'}<Icon name="check" size={14} />{:else if row.status === 'failed'}<Icon name="alert" size={14} />{/if}{statusText(row)}</p>{/if}
            </div>
            {#if !started}<button class="icon-btn remove" aria-label="Remove {row.filename}" title="Remove file" onclick={() => remove(row)}><Icon name="x" size={16} /></button>{/if}
          </article>
        {/each}
      </div>
      <div class="footer">
        {#if !started}
          <button class="btn primary btn-block" disabled={!canStart} onclick={() => run()}>Import {rows.length} {rows.length === 1 ? 'file' : 'files'}</button>
          <p class="note">Added to “Мои файлы” and All songs.</p>
        {:else if !finished}
          <button class="btn ghost btn-block" onclick={close}>Hide — keep processing</button>
        {:else}
          {#if playlistId}<button class="btn primary btn-block" onclick={openFiles}>Open My files</button>{/if}
          {#if failed}<button class="btn ghost btn-block" onclick={() => run(true)}>Try failed files again</button>{/if}
          <p class="note">{failed ? 'Couldn’t process some files. Their errors are shown above.' : 'Your files are also in All songs. Add them to any playlist.'}</p>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay { position: fixed; inset: 0; z-index: 310; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0,0,0,.78); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
  .modal { position: relative; width: 100%; max-width: 740px; max-height: 88dvh; overflow-y: auto; padding: 32px; border: 1px solid var(--border-strong); border-radius: 20px; background: var(--panel); box-shadow: var(--shadow-pop); animation: fadeUp .3s var(--ease) both; }
  .modal-close { position: absolute; right: 16px; top: 16px; }
  h3 { margin: 0 36px 6px 0; font-size: 26px; font-weight: 700; letter-spacing: -.035em; }
  .lead { margin: 0 0 28px; color: var(--muted); font-size: 14px; }
  .files { display: grid; max-height: 52dvh; overflow-y: auto; }
  .file { position: relative; display: grid; grid-template-columns: 144px minmax(0,1fr); gap: 24px; align-items: center; padding: 24px 0; border-bottom: 1px solid var(--border); }
  .file:first-child { padding-top: 0; }
  .file:last-child { border-bottom: none; padding-bottom: 0; }
  .art { width: 100%; aspect-ratio: 1; border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,.45); }
  .info { min-width: 0; padding-right: 28px; }
  .track-title { margin: 0; font-size: clamp(24px,3vw,34px); line-height: 1.14; font-weight: 800; letter-spacing: -.035em; overflow-wrap: anywhere; }
  .author { margin-top: 10px; font-size: 17px; line-height: 1.4; color: var(--muted); min-height: 1.4em; overflow-wrap: anywhere; }
  .editable { cursor: text; border: none; outline: none; background: none; border-radius: 0; transition: color .2s; }
  .editable:hover, .editable:focus { text-decoration: underline; text-decoration-color: var(--border-strong); text-underline-offset: 5px; }
  .editable:empty::before { content: attr(data-placeholder); color: var(--muted); pointer-events: none; }
  .editable:focus-visible { outline: none; }
  .file-meta { display: flex; align-items: center; gap: 10px; margin-top: 14px; color: var(--muted); font-size: 12px; min-width: 0; }
  .filename { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .duration { flex: none; }
  .remove { position: absolute; right: 0; top: 24px; width: 32px; height: 32px; }
  .file:first-child .remove { top: 0; }
  .status { display: flex; align-items: center; gap: 7px; margin: 10px 0 0; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
  .status :global(svg), .spinner { flex: none; }
  .spinner { width: 13px; height: 13px; }
  .failed .track-title { color: var(--muted); }
  .footer { display: grid; gap: 10px; margin-top: 28px; }
  .note { margin: 0; color: var(--muted); text-align: center; font-size: 12px; }
  .progress { height: 4px; border-radius: 4px; overflow: hidden; background: var(--raise-2); margin-bottom: 24px; }
  .progress > div { height: 100%; background: #fff; transform-origin: left; transition: transform .4s var(--ease); }
  @media (max-width: 760px) {
    .overlay { align-items: flex-end; padding: 0; }
    .modal { max-width: none; max-height: 92dvh; padding: 28px 20px calc(20px + var(--safe-b)); border-radius: 20px 20px 0 0; }
    .file { grid-template-columns: 92px minmax(0,1fr); gap: 16px; padding-block: 22px; }
    .track-title { font-size: 24px; }
    .author { margin-top: 8px; font-size: 16px; }
    .info { padding-right: 16px; }
    .files { max-height: 55dvh; }
    .file-meta { flex-wrap: wrap; gap: 4px 8px; margin-top: 10px; }
    .filename { max-width: 100%; }
    .remove { right: -6px; top: 16px; width: 24px; height: 32px; }
  }
</style>

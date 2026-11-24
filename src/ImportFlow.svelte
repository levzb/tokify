<script>
  import Icon from './Icon.svelte';
  import Cover from './Cover.svelte';
  import Modal from './Modal.svelte';
  import { api, plural } from './util.js';
  import { lib, ui, go, toast, startImport } from './state.svelte.js';

  const src = $derived(ui.importSource);
  const job = $derived(ui.importJob);
  const stage = $derived(job && (job.jobId && ui.importOpen && !src) ? 'progress' : 'config');

  let name = $state('');
  let mode = $state('all'); // all | first | pick
  let firstN = $state(10);
  let picked = $state(new Set());
  let known = $state({});
  let busy = $state(false);

  $effect(() => {
    if (ui.importOpen && src) {
      name = `Upload ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
      mode = 'all';
      firstN = Math.min(10, src.sounds.length);
      picked = new Set();
      known = {};
      api('/api/import/check', { method: 'POST', body: { ids: src.sounds.map((s) => s.musicId) } }).then((r) => { known = r.known; }).catch(() => {});
    }
  });

  const total = $derived(src?.sounds.length || 0);
  const chosen = $derived(!src ? [] : mode === 'all' ? src.sounds : mode === 'first' ? src.sounds.slice(0, Math.max(0, Math.min(total, firstN | 0))) : src.sounds.filter((s) => picked.has(s.musicId)));
  const already = $derived(chosen.filter((s) => known[s.musicId]?.status === 'ok').length);

  function togglePick(id) { const s = new Set(picked); s.has(id) ? s.delete(id) : s.add(id); picked = s; }
  const setN = (v) => { firstN = Math.max(1, Math.min(total, Math.round(Number(v) || 1))); };

  async function run() {
    if (!chosen.length || busy) return;
    busy = true;
    try {
      await startImport(name.trim() || 'Upload', chosen);
      ui.importSource = null;
    } catch (e) { toast(e.message); }
    finally { busy = false; }
  }
  function close() {
    if (stage === 'config') { ui.importOpen = false; ui.importSource = null; return; }
    ui.importOpen = false;
    if (job?.finished) ui.importJob = null;
  }
  function openResult() {
    const id = job.playlistId;
    ui.importOpen = false; ui.importJob = null;
    go('playlist', id);
  }
  const pct = $derived(job?.total ? (job.done / job.total) * 100 : 0);
  const jobArt = $derived(job?.order?.map((id) => lib.tracks[id]).find((t) => t?.cover && job.items[t.id]?.status === 'ok')?.cover || '');
  const pickArt = $derived(Object.values(known).find((k) => k?.cover)?.cover || '');
</script>

{#if ui.importOpen}
  {#if stage === 'config' && src}
    <Modal label="Upload" title="New upload" lead={plural(total, 'sound')} art={pickArt} size={mode === 'pick' ? 'lg' : ''} onclose={close}>
      <label class="field">
        <span class="label">Name</span>
        <input class="input" bind:value={name} maxlength="80" placeholder="Name this upload" />
      </label>

      <div class="field">
        <span class="label">Sounds</span>
        <div class="seg full" role="radiogroup">
          <button role="radio" aria-checked={mode === 'all'} class:active={mode === 'all'} onclick={() => (mode = 'all')}>All {total}</button>
          <button role="radio" aria-checked={mode === 'first'} class:active={mode === 'first'} onclick={() => (mode = 'first')}>First…</button>
          <button role="radio" aria-checked={mode === 'pick'} class:active={mode === 'pick'} onclick={() => (mode = 'pick')}>Pick</button>
        </div>
      </div>

      {#if mode === 'first'}
        <div class="first">
          <span>First</span>
          <div class="qty">
            <button class="icon-btn sm" onclick={() => setN(firstN - 1)} aria-label="Fewer" disabled={firstN <= 1}><Icon name="minus" size={16} /></button>
            <input type="number" inputmode="numeric" min="1" max={total} value={firstN} onchange={(e) => setN(e.target.value)} aria-label="Number of sounds" />
            <button class="icon-btn sm" onclick={() => setN(firstN + 1)} aria-label="More" disabled={firstN >= total}><Icon name="plus" size={16} /></button>
          </div>
          <span>of {total}</span>
        </div>
      {:else if mode === 'pick'}
        <div class="pick-head">
          <span class="sub">{picked.size} selected</span>
          <button class="icon-btn sm" aria-label={picked.size === total ? 'Clear' : 'Select all'} onclick={() => (picked = picked.size === total ? new Set() : new Set(src.sounds.map((s) => s.musicId)))}><Icon name={picked.size === total ? 'x' : 'check'} size={18} /></button>
        </div>
        <div class="pick scroll">
          {#each src.sounds as s (s.musicId)}
            {@const k = known[s.musicId]}
            <button class="line click pick-row" class:on={picked.has(s.musicId)} onclick={() => togglePick(s.musicId)} aria-pressed={picked.has(s.musicId)}>
              <span class="tick" class:on={picked.has(s.musicId)}>{#if picked.has(s.musicId)}<Icon name="check" size={13} stroke={3} />{/if}</span>
              <Cover src={k?.cover} size={40} radius={6} />
              <span class="txt">
                <span class="title">{k?.title || s.title}</span>
                <span class="sub">{s.date ? s.date.slice(0, 10) : ''}{!k ? ` · ${s.musicId}` : ''}{#if k?.status === 'ok'}{' · in library'}{/if}</span>
              </span>
            </button>
          {/each}
        </div>
      {/if}

      <div class="modal-foot">
        {#if already}<p class="sub">{already} already in library</p>{/if}
        <button class="btn primary icon" aria-label="Download {chosen.length}" disabled={!chosen.length || busy} onclick={run}>
          {#if busy}<span class="spinner sm"></span>{:else}<Icon name="download" size={19} /><span class="n">{chosen.length}</span>{/if}
        </button>
      </div>
    </Modal>
  {:else if job}
    <Modal label="Upload" title={job.finished ? job.name : 'Downloading'} art={jobArt} onclose={close}>
      <div class="progress-view">
        {#if job.finished}
          <span class="ico on big"><Icon name="check" size={24} stroke={3} /></span>
          <p class="lead">{plural(job.ok, 'sound')} ready{#if job.failed}{` · ${job.failed} unavailable`}{/if}</p>
        {:else}
          <div class="counter"><span class="n">{job.done}</span><span class="of">/ {job.total}</span></div>
        {/if}
      </div>

      <div class="meter"><i style="transform: scaleX({pct / 100})"></i></div>

      <div class="tiles scroll">
        {#each job.order as id (id)}
          {@const st = job.items[id]?.status || 'queued'}
          {@const t = lib.tracks[id]}
          <div class="tile {st}" title={t?.title || ''}>
            {#if st === 'ok' && t}
              <div class="tile-in"><Cover src={t.cover} size="100%" radius={6} /></div>
            {:else if st === 'failed'}
              <div class="tile-in failed-in" title={job.items[id]?.error}><Icon name="alert" size={18} /></div>
            {:else if st === 'working'}
              <div class="tile-in shimmer"><span class="spinner sm"></span></div>
            {:else}
              <div class="tile-in shimmer"></div>
            {/if}
          </div>
        {/each}
      </div>

      <div class="modal-foot">
        {#if job.finished}
          <button class="btn primary icon" aria-label="Open upload" onclick={openResult}><Icon name="arrow" size={20} /></button>
        {/if}
      </div>
    </Modal>
  {/if}
{/if}

<style>
  .first { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 14px; color: var(--muted); }
  .qty { display: inline-flex; align-items: center; gap: 2px; padding: 3px; background: var(--fill-1); border-radius: var(--r-item); }
  .qty input { width: 56px; border: none; background: none; color: var(--text); text-align: center; font: inherit; font-size: 16px; font-variant-numeric: tabular-nums; outline: none; -moz-appearance: textfield; appearance: textfield; }
  .qty input::-webkit-inner-spin-button, .qty input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }

  .pick-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: -8px; }
  .pick { max-height: 320px; margin: 0 -8px; }

  .progress-view { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; padding-top: 8px; }
  .ico.big { width: 52px; height: 52px; }
  .counter { display: flex; align-items: baseline; justify-content: center; gap: 8px; font-variant-numeric: tabular-nums; }
  .counter .n { font-size: 56px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; }
  .counter .of { font-size: 22px; font-weight: 600; color: var(--muted); }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(44px, 1fr)); gap: 6px; max-height: 260px; }
  .tile { aspect-ratio: 1; }
  .tile-in { width: 100%; height: 100%; border-radius: var(--r-xs); display: grid; place-items: center; }
  .ok .tile-in { animation: popCheck .5s var(--ease) both; box-shadow: 0 4px 12px rgba(0,0,0,.4); }
  .shimmer { background: linear-gradient(90deg, rgba(255,255,255,.04) 0%, rgba(255,255,255,.1) 50%, rgba(255,255,255,.04) 100%); background-size: 200% 100%; animation: shimmer 1.6s linear infinite; }
  .failed-in { background: var(--fill-1); color: var(--faint); }
  .center { text-align: center; }
</style>

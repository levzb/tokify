<script>
  import Icon from './Icon.svelte';
  import Cover from './Cover.svelte';
  import { api } from '../lib/api.js';
  import { lib } from '../lib/library.svelte.js';
  import { ui, go, toast } from '../lib/ui.svelte.js';
  import { startImport } from '../lib/importJob.svelte.js';
  import { plural } from '../lib/format.js';

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
</script>

<svelte:window onkeydown={(e) => ui.importOpen && e.key === 'Escape' && close()} />

<div class="overlay" class:open={ui.importOpen} onclick={(e) => e.target === e.currentTarget && close()} role="presentation">
  {#if ui.importOpen}
    <div class="modal" class:wide={stage === 'config' && mode === 'pick'} role="dialog" aria-modal="true" aria-label="Upload">
      <button class="modal-close" onclick={close} aria-label="Close"><Icon name="x" size={14} /></button>

      {#if stage === 'config' && src}
        <h3>New upload</h3>
        <p class="lead">Found {plural(total, 'favorite sound')} in <span class="mono">{src.label}</span></p>

        <label class="field">
          <span>Name</span>
          <input class="input" bind:value={name} maxlength="80" placeholder="Name this upload" />
        </label>

        <div class="field">
          <span>Which sounds</span>
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
              <button onclick={() => setN(firstN - 1)} aria-label="Fewer" disabled={firstN <= 1}>−</button>
              <input class="mono" type="number" inputmode="numeric" min="1" max={total} value={firstN} onchange={(e) => setN(e.target.value)} aria-label="Number of sounds" />
              <button onclick={() => setN(firstN + 1)} aria-label="More" disabled={firstN >= total}>+</button>
            </div>
            <span>of {total}, newest first</span>
          </div>
        {:else if mode === 'pick'}
          <div class="pick-head">
            <span class="sub">{picked.size} selected</span>
            <button class="btn quiet" onclick={() => (picked = picked.size === total ? new Set() : new Set(src.sounds.map((s) => s.musicId)))}>{picked.size === total ? 'Clear' : 'Select all'}</button>
          </div>
          <div class="pick">
            {#each src.sounds as s (s.musicId)}
              {@const k = known[s.musicId]}
              <button class="pick-row" class:on={picked.has(s.musicId)} onclick={() => togglePick(s.musicId)} aria-pressed={picked.has(s.musicId)}>
                <span class="tick">{#if picked.has(s.musicId)}<Icon name="check" size={13} stroke={3} />{/if}</span>
                <Cover src={k?.cover} size={40} radius={7} />
                <span class="pt">
                  <span class="t">{k?.title || s.title}</span>
                  <span class="d">{s.date ? s.date.slice(0, 10) : ''}{!k ? ` · ${s.musicId}` : ''}{#if k?.status === 'ok'}{' · in library'}{/if}</span>
                </span>
              </button>
            {/each}
          </div>
        {/if}

        <p class="summary">
          {#if chosen.length}
            {plural(chosen.length - already, 'sound')} to download{#if already}{` · ${already} already in library`}{/if}
          {:else}
            Pick at least one sound
          {/if}
        </p>
        <button class="btn primary btn-block" disabled={!chosen.length || busy} onclick={run}>
          {#if busy}<span class="spinner dark"></span>{:else}Start{/if}
        </button>

      {:else if job}
        <div class="progress-view">
          {#if job.finished}
            <div class="check"><Icon name="check" size={26} stroke={3} /></div>
            <h3 class="center">{job.name} is ready</h3>
            <p class="lead center">
              {plural(job.ok, 'sound')} ready{#if job.reused}{` (${job.reused} already in the library)`}{/if}{#if job.failed}{` · ${job.failed} unavailable`}{/if}
            </p>
          {:else}
            <div class="counter mono"><span class="n">{job.done}</span><span class="of">/ {job.total}</span></div>
            <p class="lead center">Downloading sounds and covers</p>
          {/if}

          <div class="bar"><div class="bar-fill" style="transform: scaleX({pct / 100})"></div></div>

          <div class="tiles">
            {#each job.order as id (id)}
              {@const st = job.items[id]?.status || 'queued'}
              {@const t = lib.tracks[id]}
              <div class="tile {st}" title={t?.title || ''}>
                {#if st === 'ok' && t}
                  <div class="tile-in"><Cover src={t.cover} size="100%" radius={8} /></div>
                {:else if st === 'failed'}
                  <div class="tile-in failed-in" title={job.items[id]?.error}><Icon name="alert" size={18} /></div>
                {:else if st === 'working'}
                  <div class="tile-in shimmer"><span class="spinner"></span></div>
                {:else}
                  <div class="tile-in shimmer"></div>
                {/if}
              </div>
            {/each}
          </div>

          {#if job.finished}
            <button class="btn primary btn-block" onclick={openResult}>Open upload</button>
            {#if job.failed}<p class="note">Unavailable sounds stay in the upload, greyed out, with the reason. You can retry them from their menu.</p>{/if}
          {:else}
            <button class="btn ghost btn-block" onclick={close}>Hide — keep downloading</button>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .overlay {
    position: fixed; inset: 0; z-index: 300; display: flex; align-items: center; justify-content: center; padding: 24px;
    background: rgba(0,0,0,.78); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    opacity: 0; visibility: hidden; transition: opacity .3s ease, visibility .3s ease;
  }
  .overlay.open { opacity: 1; visibility: visible; }
  .modal {
    position: relative; width: 100%; max-width: 460px; max-height: 88vh; overflow-y: auto;
    padding: 34px 28px 28px; background: var(--panel); border: 1px solid var(--border-strong); border-radius: 20px; box-shadow: var(--shadow-pop);
    animation: modalIn .35s var(--ease) both;
  }
  .modal.wide { max-width: 560px; }
  @keyframes modalIn { from { opacity: 0; transform: translateY(12px) scale(.98); } to { opacity: 1; transform: none; } }
  .modal-close {
    position: absolute; top: 16px; right: 16px; z-index: 2; width: 32px; height: 32px; display: grid; place-items: center;
    color: var(--muted); background: rgba(255,255,255,.05); border: 1px solid var(--border); border-radius: 50%; cursor: pointer;
    transition: background .2s, color .2s, transform .2s;
  }
  .modal-close:hover { background: rgba(255,255,255,.14); color: #fff; transform: rotate(90deg); }
  h3 { margin: 0 0 6px; font-size: 26px; font-weight: 700; letter-spacing: -0.035em; padding-right: 36px; }
  .center { text-align: center; padding: 0; }
  .lead { margin: 0 0 22px; font-size: 14px; color: var(--muted); }
  .lead .mono { color: #fff; font-size: 12.5px; word-break: break-all; }
  .field { display: grid; gap: 8px; margin-bottom: 18px; }
  .field > span { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.13em; color: var(--muted-2); }
  .seg.full { display: flex; }
  .seg.full button { flex: 1; }

  .first { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: -4px 0 18px; font-size: 14px; color: var(--muted); }
  .qty { display: inline-flex; align-items: center; border: 1px solid var(--border); border-radius: 999px; background: var(--raise); }
  .qty button { width: 40px; height: 40px; border: none; background: none; color: #fff; font-size: 18px; cursor: pointer; border-radius: 50%; transition: background .15s; }
  .qty button:hover { background: rgba(255,255,255,.1); }
  .qty button:disabled { color: #444; cursor: default; background: none; }
  .qty input { width: 56px; border: none; background: none; color: #fff; text-align: center; font-size: 16px; outline: none; -moz-appearance: textfield; }
  .qty input::-webkit-inner-spin-button { -webkit-appearance: none; }

  .pick-head { display: flex; align-items: center; justify-content: space-between; margin: -6px 0 6px; }
  .pick { max-height: 300px; overflow-y: auto; margin: 0 -8px 8px; padding: 0 4px; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  .pick-row { display: flex; align-items: center; gap: 12px; width: 100%; padding: 8px; border: none; background: none; text-align: left; cursor: pointer; border-radius: 10px; transition: background .15s; }
  .pick-row:hover { background: var(--raise); }
  .pick-row.on { background: var(--raise-2); }
  .tick { width: 20px; height: 20px; flex: none; border-radius: 50%; border: 1.5px solid var(--border-strong); display: grid; place-items: center; }
  .on .tick { background: #fff; border-color: #fff; color: #000; animation: popCheck .35s var(--ease) both; }
  .pt { display: flex; flex-direction: column; min-width: 0; }
  .pt .t { font-size: 14px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pt .d { font-size: 12px; color: var(--muted); }
  .summary { margin: 4px 0 14px; font-size: 13px; color: var(--muted); }
  .spinner.dark { border-color: rgba(0,0,0,.15); border-top-color: #000; }

  /* progress */
  .progress-view { display: flex; flex-direction: column; align-items: stretch; }
  .counter { display: flex; align-items: baseline; justify-content: center; gap: 10px; margin: 6px 0 4px; }
  .counter .n { font-size: 64px; font-weight: 500; letter-spacing: -0.04em; line-height: 1; color: #fff; }
  .counter .of { font-size: 22px; color: var(--muted-2); }
  .check { width: 52px; height: 52px; margin: 4px auto 18px; display: grid; place-items: center; color: #000; background: #fff; border-radius: 50%; box-shadow: 0 0 0 8px rgba(255,255,255,.06); animation: popCheck .5s cubic-bezier(.2,.85,.25,1) both; }
  .bar { height: 4px; border-radius: 99px; background: rgba(255,255,255,.1); overflow: hidden; margin: 4px 0 22px; }
  .bar-fill { height: 100%; background: #fff; border-radius: 99px; box-shadow: 0 0 14px rgba(255,255,255,.6); transform-origin: left; transition: transform .6s var(--ease); }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(44px, 1fr)); gap: 8px; margin-bottom: 22px; max-height: 260px; overflow-y: auto; }
  .tile { aspect-ratio: 1; }
  .tile-in { width: 100%; height: 100%; border-radius: 8px; display: grid; place-items: center; }
  .ok .tile-in { animation: popCheck .5s cubic-bezier(.2,.85,.25,1) both; box-shadow: 0 6px 16px rgba(0,0,0,.5); }
  .shimmer { background: linear-gradient(90deg, rgba(255,255,255,.03) 0%, rgba(255,255,255,.09) 50%, rgba(255,255,255,.03) 100%); background-size: 200% 100%; animation: shimmer 1.6s linear infinite; border: 1px solid var(--border); }
  .shimmer .spinner { width: 14px; height: 14px; }
  .failed-in { background: #141414; border: 1px solid var(--border); color: var(--muted-2); }
  .note { margin: 12px 0 0; font-size: 12px; color: var(--muted-2); text-align: center; line-height: 1.55; }

  @media (max-width: 760px) {
    .overlay { align-items: flex-end; padding: 0; }
    .modal, .modal.wide { max-width: none; max-height: 92vh; border-radius: 20px 20px 0 0; padding: 28px 20px calc(20px + var(--safe-b)); animation: sheetUp .4s var(--ease) both; }
    @keyframes sheetUp { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
    .pick { max-height: 40vh; }
  }
</style>

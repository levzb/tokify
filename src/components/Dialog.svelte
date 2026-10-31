<script>
  import { ui } from '../lib/ui.svelte.js';
  let value = $state('');
  let inputEl = $state();
  $effect(() => {
    if (ui.dialog) { value = ui.dialog.value || ''; queueMicrotask(() => { inputEl?.focus(); inputEl?.select(); }); }
  });
  function close(result) { const d = ui.dialog; ui.dialog = null; d?.resolve(result); }
  function submit(e) { e.preventDefault(); if (ui.dialog.kind === 'prompt' && !ui.dialog.allowEmpty && !value.trim()) return; close(ui.dialog.kind === 'prompt' ? value.trim() : true); }
</script>

<svelte:window onkeydown={(e) => ui.dialog && e.key === 'Escape' && close(null)} />

<div class="overlay" class:open={!!ui.dialog} onclick={(e) => e.target === e.currentTarget && close(null)} role="presentation">
  {#if ui.dialog}
    <div class="modal" role="dialog" tabindex="-1" aria-modal="true" aria-label={ui.dialog.title}>
    <form onsubmit={submit}>
      <h3>{ui.dialog.title}</h3>
      {#if ui.dialog.text}<p>{ui.dialog.text}</p>{/if}
      {#if ui.dialog.kind === 'prompt'}
        <input class="input" bind:this={inputEl} bind:value maxlength={ui.dialog.maxlength || 80} placeholder={ui.dialog.placeholder || ''} />
      {/if}
      <div class="actions">
        <button type="button" class="btn ghost" onclick={() => close(null)}>Cancel</button>
        <button class="btn {ui.dialog.danger ? 'danger-fill' : 'primary'}">{ui.dialog.confirm || 'Done'}</button>
      </div>
    </form>
    </div>
  {/if}
</div>

<style>
  .overlay {
    position: fixed; inset: 0; z-index: 500; display: flex; align-items: center; justify-content: center; padding: 24px;
    background: rgba(0,0,0,.78); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    opacity: 0; visibility: hidden; transition: opacity .3s ease, visibility .3s ease;
  }
  .overlay.open { opacity: 1; visibility: visible; }
  .modal {
    width: 100%; max-width: 420px; padding: 28px 24px 22px; display: grid; gap: 14px;
    background: var(--panel); border: 1px solid var(--border-strong); border-radius: 20px; box-shadow: var(--shadow-pop);
    animation: modalIn .35s var(--ease) both;
  }
  form { display: contents; }
  h3 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.035em; }
  p { margin: -4px 0 4px; font-size: 14px; color: var(--muted); }
  .actions { display: flex; gap: 10px; margin-top: 6px; }
  .actions .btn { flex: 1; }
  .danger-fill { background: #ff5a5a; color: #000; }
  .danger-fill:hover { background: #ff7a7a; }
  @keyframes modalIn { from { opacity: 0; transform: translateY(12px) scale(.98); } to { opacity: 1; transform: none; } }
</style>

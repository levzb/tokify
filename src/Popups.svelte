<script>
  // Everything that floats above the page: the context menu (a bottom sheet on phones),
  // the confirm/prompt dialog and the toast.
  import Icon from './Icon.svelte';
  import { ui } from './state.svelte.js';

  // ---- context menu ----
  let stack = $state([]);
  let menuEl = $state();
  let pos = $state({ x: 0, y: 0 });

  $effect(() => {
    if (ui.menu) { stack = [ui.menu.items]; place(); }
  });
  const items = $derived(stack[stack.length - 1] || []);
  function place() {
    queueMicrotask(() => {
      if (!menuEl || ui.menu?.sheet) return;
      const r = menuEl.getBoundingClientRect();
      let x = ui.menu.x, y = ui.menu.y;
      if (x + r.width > innerWidth - 12) x = Math.max(12, x - r.width);
      if (y + r.height > innerHeight - 12) y = Math.max(12, innerHeight - r.height - 12);
      pos = { x, y };
    });
  }
  function pick(it) {
    if (it.sub) { stack = [...stack, it.sub]; place(); return; }
    ui.menu = null;
    it.action?.();
  }
  const closeMenu = () => { ui.menu = null; };

  // ---- dialog ----
  let value = $state('');
  let inputEl = $state();
  $effect(() => {
    if (ui.dialog) { value = ui.dialog.value || ''; queueMicrotask(() => { inputEl?.focus(); inputEl?.select(); }); }
  });
  function closeDialog(result) { const d = ui.dialog; ui.dialog = null; d?.resolve(result); }
  function submit(e) { e.preventDefault(); if (ui.dialog.kind === 'prompt' && !ui.dialog.allowEmpty && !value.trim()) return; closeDialog(ui.dialog.kind === 'prompt' ? value.trim() : true); }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    if (ui.menu) closeMenu();
    if (ui.dialog) closeDialog(null);
  }
</script>

<svelte:window onkeydown={onKey} onresize={closeMenu} />

{#if ui.menu}
  <div class="scrim" class:sheet={ui.menu.sheet} onclick={closeMenu} oncontextmenu={(e) => { e.preventDefault(); closeMenu(); }} role="presentation"></div>
  {#key stack.length}
    <div class="menu" class:sheet={ui.menu.sheet} bind:this={menuEl} role="menu"
      style={ui.menu.sheet ? '' : `left:${pos.x || ui.menu.x}px; top:${pos.y || ui.menu.y}px`}>
      {#if ui.menu.sheet}<div class="handle"></div>{/if}
      {#if stack.length > 1}
        <button class="it back" onclick={() => { stack = stack.slice(0, -1); place(); }}><Icon name="back" size={18} /> Back</button>
        <div class="sep"></div>
      {/if}
      {#each items as it}
        {#if it.sep}<div class="sep"></div>
        {:else}
          <button class="it" class:danger={it.danger} role="menuitem" onclick={() => pick(it)}>
            {#if it.icon}<Icon name={it.icon} size={18} />{:else}<span class="dot"></span>{/if}
            <span class="lbl">{it.label}</span>
            {#if it.sub}<span class="chev"><Icon name="right" size={16} /></span>{/if}
          </button>
        {/if}
      {/each}
    </div>
  {/key}
{/if}

<div class="overlay" class:open={!!ui.dialog} onclick={(e) => e.target === e.currentTarget && closeDialog(null)} role="presentation">
  {#if ui.dialog}
    <div class="modal" role="dialog" tabindex="-1" aria-modal="true" aria-label={ui.dialog.title}>
    <form onsubmit={submit}>
      <h3>{ui.dialog.title}</h3>
      {#if ui.dialog.text}<p>{ui.dialog.text}</p>{/if}
      {#if ui.dialog.kind === 'prompt'}
        <input class="input" bind:this={inputEl} bind:value maxlength={ui.dialog.maxlength || 80} placeholder={ui.dialog.placeholder || ''} />
      {/if}
      <div class="actions">
        <button type="button" class="btn ghost" onclick={() => closeDialog(null)}>Cancel</button>
        <button class="btn {ui.dialog.danger ? 'danger-fill' : 'primary'}">{ui.dialog.confirm || 'Done'}</button>
      </div>
    </form>
    </div>
  {/if}
</div>

{#key ui.toast?.key}
  {#if ui.toast}
    <div class="toast" role="status">
      <span>{ui.toast.text}</span>
      {#if ui.toast.action}<button onclick={() => { ui.toast.onAction?.(); ui.toast = null; }}>{ui.toast.action}</button>{/if}
    </div>
  {/if}
{/key}

<style>
  /* ---- context menu (dyke .currency-menu) ---- */
  .scrim { position: fixed; inset: 0; z-index: 450; }
  .scrim.sheet { background: rgba(0,0,0,.6); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); animation: fadeIn .25s ease both; }
  .menu {
    position: fixed; z-index: 460; min-width: 230px; max-width: 300px; max-height: min(70vh, 520px); overflow-y: auto;
    padding: 6px; background: var(--panel); border: 1px solid var(--border-strong); border-radius: 12px; box-shadow: var(--shadow-menu);
    animation: drop .15s ease both;
  }
  @keyframes drop { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
  .it {
    display: flex; align-items: center; gap: 12px; width: 100%; padding: 9px 12px; min-height: 40px;
    font-size: 13.5px; font-weight: 500; text-align: left; color: var(--muted);
    background: transparent; border: none; border-radius: 8px; cursor: pointer; transition: background .15s, color .15s;
  }
  .it:hover, .it:focus-visible { background: rgba(255,255,255,.06); color: #fff; }
  .it.danger:hover { color: var(--danger); background: rgba(255,100,100,.08); }
  .lbl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chev { color: var(--muted-2); display: flex; }
  .dot { width: 18px; }
  .sep { height: 1px; background: var(--border); margin: 6px 4px; }
  .back { color: #fff; font-weight: 600; }

  .menu.sheet {
    left: 8px; right: 8px; bottom: calc(8px + var(--safe-b)); top: auto; max-width: none; max-height: 75vh;
    padding: 8px 8px 10px; border-radius: 20px; animation: sheetUp .35s var(--ease) both;
  }
  .sheet .it { min-height: 50px; font-size: 15.5px; padding: 12px 14px; color: #fff; }
  .sheet .it :global(svg) { color: var(--muted); }
  .handle { width: 36px; height: 4px; border-radius: 99px; background: var(--border-strong); margin: 2px auto 8px; }
  @keyframes sheetUp { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }

  /* ---- dialog ---- */
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
  .modal form { display: contents; }
  .modal h3 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.035em; }
  .modal p { margin: -4px 0 4px; font-size: 14px; color: var(--muted); }
  .actions { display: flex; gap: 10px; margin-top: 6px; }
  .actions .btn { flex: 1; }
  .danger-fill { background: #ff5a5a; color: #000; }
  .danger-fill:hover { background: #ff7a7a; }
  @keyframes modalIn { from { opacity: 0; transform: translateY(12px) scale(.98); } to { opacity: 1; transform: none; } }

  /* ---- toast (dyke .toast: white pill rising from the bottom) ---- */
  .toast {
    position: fixed; left: 50%; bottom: calc(var(--player-h) + 24px + var(--safe-b)); z-index: 400;
    display: flex; align-items: center; gap: 14px; max-width: calc(100vw - 32px);
    padding: 11px 20px; font-size: 13px; font-weight: 600; color: #000; background: #fff;
    border-radius: 999px; box-shadow: 0 10px 30px rgba(0,0,0,.65);
    transform: translateX(-50%); animation: rise .35s var(--ease) both;
  }
  .toast span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .toast button { border: none; background: none; font-weight: 700; color: #000; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; padding: 0; }
  @keyframes rise { from { opacity: 0; transform: translate(-50%, 20px); } to { opacity: 1; transform: translate(-50%, 0); } }
  @media (max-width: 760px) { .toast { bottom: calc(150px + var(--safe-b)); } }
</style>

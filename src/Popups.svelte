<script>
  // Everything that floats above the page: the context menu (a bottom sheet on phones),
  // the confirm/prompt dialog and the toast.
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
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
    // The dialog closes itself on Escape (Modal.svelte).
    if (e.key === 'Escape' && ui.menu) closeMenu();
  }
</script>

<svelte:window onkeydown={onKey} onresize={closeMenu} />

{#if ui.menu}
  <div class="scrim" class:sheet={ui.menu.sheet} onclick={closeMenu} oncontextmenu={(e) => { e.preventDefault(); closeMenu(); }} role="presentation"></div>
  {#key stack.length}
    <div class="menu frost" class:sheet={ui.menu.sheet} bind:this={menuEl} role="menu"
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

{#if ui.dialog}
  <Modal title={ui.dialog.title} lead={ui.dialog.text} size="sm" z={500} stack closeButton={false} onclose={() => closeDialog(null)}>
    <form class="dialog" onsubmit={submit}>
      {#if ui.dialog.kind === 'prompt'}
        <input class="input" bind:this={inputEl} bind:value maxlength={ui.dialog.maxlength || 80} placeholder={ui.dialog.placeholder || ''} />
      {/if}
      <div class="actions">
        <button type="button" class="btn ghost icon" aria-label="Cancel" onclick={() => closeDialog(null)}><Icon name="x" size={19} /></button>
        <button class="btn icon {ui.dialog.danger ? 'danger' : 'primary'}" aria-label={ui.dialog.confirm || 'Done'}><Icon name={ui.dialog.danger ? 'trash' : 'check'} size={19} stroke={ui.dialog.danger ? 2 : 2.5} /></button>
      </div>
    </form>
  </Modal>
{/if}

{#key ui.toast?.key}
  {#if ui.toast}
    <div class="toast frost" role="status">
      <span>{ui.toast.text}</span>
      {#if ui.toast.action}<button onclick={() => { ui.toast.onAction?.(); ui.toast = null; }}>{ui.toast.action}</button>{/if}
    </div>
  {/if}
{/key}

<style>
  /* ---- context menu ---- */
  .scrim { position: fixed; inset: 0; z-index: 450; }
  .scrim.sheet { background: rgba(0,0,0,.4); animation: fadeIn .25s ease both; }
  .menu {
    position: fixed; z-index: 460; min-width: 230px; max-width: 300px; max-height: min(70vh, 520px); overflow-y: auto;
    padding: 4px; border-radius: 11px;
    animation: drop .16s var(--ease) both;
  }
  @keyframes drop { from { opacity: 0; transform: translateY(-4px) scale(.98); } to { opacity: 1; transform: none; } }
  .it {
    display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 10px; min-height: 36px;
    font-size: 13.5px; font-weight: 400; text-align: left; color: var(--text);
    background: transparent; border: none; border-radius: var(--r-control); cursor: pointer; transition: background .12s;
  }
  .it :global(svg) { color: var(--muted); flex: none; }
  .it:hover, .it:focus-visible { background: var(--fill-1); }
  .it.danger { color: var(--danger); }
  .it.danger :global(svg) { color: var(--danger); }
  .lbl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chev { color: var(--muted); display: flex; }
  .dot { width: 18px; }
  .sep { height: 1px; background: var(--edge); margin: 4px 8px; }
  .back { font-weight: 600; }

  .menu.sheet {
    left: 8px; right: 8px; bottom: calc(8px + var(--safe-b)); top: auto; max-width: none; max-height: 85dvh;
    padding: 6px 6px 8px; border-radius: var(--r-sheet); animation: sheetUp .35s var(--ease) both;
  }
  .sheet .it { min-height: 46px; font-size: 15px; padding: 10px 14px; }
  .handle { width: 36px; height: 4px; border-radius: 99px; background: var(--edge-strong); margin: 4px auto 8px; }
  @keyframes sheetUp { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }

  /* ---- dialog: the shell is Modal.svelte ---- */
  .dialog { display: grid; gap: 16px; }
  .actions { display: flex; gap: 8px; }
  .actions .btn { flex: 1; }

  /* ---- toast: glass, sized to its content ---- */
  .toast {
    position: fixed; left: 50%; bottom: calc(var(--player-h) + 32px + var(--safe-b)); z-index: 400;
    display: flex; align-items: center; gap: 14px; max-width: calc(100vw - 32px);
    padding: 10px 16px; font-size: 13px; font-weight: 600; color: var(--text);
    border-radius: var(--r-item);
    transform: translateX(-50%); animation: toastIn .35s var(--ease) both;
  }
  @media (min-width: 761px) { :global(html[data-player='top']) .toast { bottom: 24px; } }
  .toast span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .toast button { border: none; background: none; font-weight: 600; color: var(--text); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; padding: 0; }
  @keyframes toastIn { from { opacity: 0; transform: translate(-50%, 16px); } to { opacity: 1; transform: translate(-50%, 0); } }
  @media (max-width: 760px) { .toast { bottom: calc(150px + var(--safe-b)); } }
</style>

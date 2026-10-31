<script>
  import Icon from './Icon.svelte';
  import { ui } from '../lib/ui.svelte.js';
  let stack = $state([]);
  let el = $state();
  let pos = $state({ x: 0, y: 0 });

  $effect(() => {
    if (ui.menu) { stack = [ui.menu.items]; place(); }
  });
  const items = $derived(stack[stack.length - 1] || []);
  function place() {
    queueMicrotask(() => {
      if (!el || ui.menu?.sheet) return;
      const r = el.getBoundingClientRect();
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
  const close = () => { ui.menu = null; };
</script>

<svelte:window onkeydown={(e) => ui.menu && e.key === 'Escape' && close()} onresize={close} />

{#if ui.menu}
  <div class="scrim" class:sheet={ui.menu.sheet} onclick={close} oncontextmenu={(e) => { e.preventDefault(); close(); }} role="presentation"></div>
  {#key stack.length}
    <div class="menu" class:sheet={ui.menu.sheet} bind:this={el} role="menu"
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

<style>
  .scrim { position: fixed; inset: 0; z-index: 450; }
  .scrim.sheet { background: rgba(0,0,0,.6); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); animation: fadeIn .25s ease both; }
  /* dyke .currency-menu */
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
</style>

<script>
  import { ui } from '../lib/ui.svelte.js';
</script>

{#key ui.toast?.key}
  {#if ui.toast}
    <div class="toast" role="status">
      <span>{ui.toast.text}</span>
      {#if ui.toast.action}<button onclick={() => { ui.toast.onAction?.(); ui.toast = null; }}>{ui.toast.action}</button>{/if}
    </div>
  {/if}
{/key}

<style>
  /* dyke .toast: white pill rising from the bottom */
  .toast {
    position: fixed; left: 50%; bottom: calc(var(--player-h) + 24px + var(--safe-b)); z-index: 400;
    display: flex; align-items: center; gap: 14px; max-width: calc(100vw - 32px);
    padding: 11px 20px; font-size: 13px; font-weight: 600; color: #000; background: #fff;
    border-radius: 999px; box-shadow: 0 10px 30px rgba(0,0,0,.65);
    transform: translateX(-50%); animation: rise .35s var(--ease) both;
  }
  .toast span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button { border: none; background: none; font-weight: 700; color: #000; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; padding: 0; }
  @keyframes rise { from { opacity: 0; transform: translate(-50%, 20px); } to { opacity: 1; transform: translate(-50%, 0); } }
  @media (max-width: 760px) { .toast { bottom: calc(150px + var(--safe-b)); } }
</style>

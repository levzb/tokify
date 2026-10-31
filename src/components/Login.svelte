<script>
  import { api } from '../lib/api.js';
  let { onDone } = $props();
  let password = $state('');
  let error = $state('');
  let busy = $state(false);

  async function submit(e) {
    e.preventDefault();
    if (!password || busy) return;
    busy = true; error = '';
    try { await api('/api/login', { method: 'POST', body: { password } }); onDone(); }
    catch (err) { error = err.message; password = ''; }
    finally { busy = false; }
  }
</script>

<div class="login">
  <div class="bg-glow"></div>
  <div class="grid-lines"></div>
  <form class="login-card" onsubmit={submit}>
    <div class="logo">tok<span>ify</span></div>
    <p>Private library. Enter your password.</p>
    <input class="input" type="password" autocomplete="current-password" placeholder="Password" bind:value={password} aria-label="Password" />
    {#if error}<div class="err" role="alert">{error}</div>{/if}
    <button class="btn primary btn-block" disabled={!password || busy}>
      {#if busy}<span class="spinner dark"></span>{:else}Sign in{/if}
    </button>
  </form>
</div>

<style>
  .login { position: fixed; inset: 0; display: grid; place-items: center; padding: 24px; overflow: hidden; }
  .login-card {
    position: relative; z-index: 1; width: 100%; max-width: 380px;
    padding: 36px 28px 28px; display: grid; gap: 14px;
    background: var(--panel); border: 1px solid var(--border-strong); border-radius: 20px;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.65);
    animation: fadeUp .8s var(--ease) both;
  }
  .logo { font-size: 26px; font-weight: 800; letter-spacing: -0.04em; text-align: center; }
  .logo span { color: var(--muted); font-weight: 500; }
  p { margin: -6px 0 8px; text-align: center; font-size: 14px; color: var(--muted); }
  .err { font-size: 13px; color: var(--danger); text-align: center; }
  .spinner.dark { border-color: rgba(0,0,0,.15); border-top-color: #000; }
</style>

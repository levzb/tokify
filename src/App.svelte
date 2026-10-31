<script>
  import { onMount } from 'svelte';
  import { api, setUnauthorizedHandler } from './lib/api.js';
  import { lib, load, playlistById } from './lib/library.svelte.js';
  import { ui } from './lib/ui.svelte.js';
  import { player, restore } from './lib/player.svelte.js';
  import { restoreImport } from './lib/importJob.svelte.js';
  import Login from './components/Login.svelte';
  import Sidebar from './components/Sidebar.svelte';
  import Home from './components/Home.svelte';
  import PlaylistView from './components/PlaylistView.svelte';
  import PlayerBar from './components/PlayerBar.svelte';
  import NowPlaying from './components/NowPlaying.svelte';
  import QueuePanel from './components/QueuePanel.svelte';
  import ContextMenu from './components/ContextMenu.svelte';
  import Dialog from './components/Dialog.svelte';
  import Toast from './components/Toast.svelte';
  import ImportFlow from './components/ImportFlow.svelte';
  import FileImportFlow from './components/FileImportFlow.svelte';

  let auth = $state('checking'); // checking | in | out
  setUnauthorizedHandler(() => { auth = 'out'; });

  async function start() {
    try {
      const me = await api('/api/me');
      if (!me.authed) { auth = 'out'; return; }
      auth = 'in';
      await load();
      restore();
      await restoreImport();
    } catch { auth = 'out'; }
  }
  onMount(start);

  // Page glow follows what is on screen: the open playlist, else the playing song.
  const glow = $derived.by(() => {
    if (ui.route.name === 'playlist') {
      const pl = playlistById(ui.route.id);
      const first = pl?.trackIds.map((id) => lib.tracks[id]).find((t) => t?.status === 'ok');
      return first?.color || '#ffffff';
    }
    return '#ffffff';
  });
</script>

{#if auth === 'out'}
  <Login onDone={start} />
{:else if auth === 'in' && lib.loaded}
  <div class="shell" class:has-player={!!player.trackId}>
    <Sidebar />
    <main class="main-scroll" style="--glow: {glow}">
      <div class="bg-glow"></div>
      <div class="grid-lines"></div>
      {#key ui.route.name + ui.route.id}
        <div class="page">
          {#if ui.route.name === 'playlist'}
            <PlaylistView id={ui.route.id} />
          {:else}
            <Home />
          {/if}
        </div>
      {/key}
    </main>
    <PlayerBar />
  </div>
  <NowPlaying />
  <QueuePanel />
  <ImportFlow />
  <FileImportFlow />
  <ContextMenu />
  <Dialog />
  <Toast />
{:else}
  <div class="boot"><span class="spinner"></span></div>
{/if}

<style>
  .shell {
    position: fixed; inset: 0;
    display: grid;
    grid-template-columns: var(--rail) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) auto;
    grid-template-areas: 'rail main' 'rail player';
  }
  .main-scroll {
    grid-area: main; position: relative; overflow-y: auto; overflow-x: hidden;
    -webkit-overflow-scrolling: touch; overscroll-behavior: contain;
  }
  .page {
    position: relative; z-index: 1; max-width: 1240px; margin: 0 auto;
    padding: 40px 40px 64px;
    animation: fadeUp .6s var(--ease) both;
  }
  .boot { position: fixed; inset: 0; display: grid; place-items: center; }

  @media (max-width: 760px) {
    .shell {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) auto auto;
      grid-template-areas: 'main' 'player' 'rail';
    }
    .page { padding: calc(20px + var(--safe-t)) 16px 28px; }
  }
</style>

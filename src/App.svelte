<script>
  import { onMount } from 'svelte';
  import { lib, load, playlistById, ui, restoreImport, restoreDownload } from './state.svelte.js';
  import { player, restore } from './player.svelte.js';
  import Sidebar from './Sidebar.svelte';
  import Home from './Home.svelte';
  import PlaylistView from './PlaylistView.svelte';
  import PlayerBar from './PlayerBar.svelte';
  import NowPlaying from '../iphone/NowPlaying.svelte';
  import QueuePanel from './QueuePanel.svelte';
  import Popups from './Popups.svelte';
  import ImportFlow from './ImportFlow.svelte';
  import FileImportFlow from './FileImportFlow.svelte';
  import DownloadFlow from './DownloadFlow.svelte';
  import ClipEditor from './ClipEditor.svelte';

  let failed = $state('');

  async function start() {
    failed = '';
    try {
      await load();
      restore();
      await restoreImport();
      restoreDownload();
    } catch (e) { failed = e.message; }
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

{#if lib.loaded}
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
  <DownloadFlow />
  <ClipEditor />
  <Popups />
{:else}
  <div class="boot">
    {#if failed}<p>{failed}</p><button class="btn ghost" onclick={start}>Try again</button>{:else}<span class="spinner"></span>{/if}
  </div>
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
  .boot { position: fixed; inset: 0; display: grid; place-content: center; justify-items: center; gap: 16px; padding: 24px; text-align: center; color: var(--muted); }

  @media (max-width: 760px) {
    .shell {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) auto auto;
      grid-template-areas: 'main' 'player' 'rail';
    }
    .page { padding: calc(20px + var(--safe-t)) 16px 28px; }
  }
</style>

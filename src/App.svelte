<script>
  import { onMount } from 'svelte';
  import { lib, load, ui, restoreImport, restoreDownload } from './state.svelte.js';
  import { player, restore } from './player.svelte.js';
  import Ambient from './Ambient.svelte';
  import Icon from './Icon.svelte';
  import Tooltip from './Tooltip.svelte';
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
  import Lyrics from './Lyrics.svelte';
  import Sound from './Sound.svelte';
  import SheetFrame from './SheetFrame.svelte';
  import Stage from './Stage.svelte';
  import Settings from './Settings.svelte';
  import { prefs, accentCss, onAccent } from './prefs.svelte.js';
  import './sleep.svelte.js';
  import { stage } from './stage.svelte.js';
  import { perf, glance } from './perf.svelte.js';
  import { loadPlugins } from './plugins.svelte.js';
  import { layout, aim, sheets, SHEET_W } from './dock.svelte.js';

  let failed = $state('');

  async function start() {
    failed = '';
    try {
      await load();
      restore();
      await restoreImport();
      restoreDownload();
      loadPlugins();
    } catch (e) { failed = e.message; }
  }
  onMount(start);
  // The open panel takes its own column; the page makes room instead of being covered.
  const sheetW = $derived(sheets.list.length ? SHEET_W : 0);
  // Things outside the shell (toasts) follow the islands too.
  $effect(() => { document.documentElement.dataset.rail = layout.rail; document.documentElement.dataset.player = layout.player; });
  $effect(() => { document.documentElement.classList.toggle('stage', stage.open); });
  $effect(() => { document.documentElement.classList.toggle('lite', perf.lite); });
  // Settings → Look, applied to the values the whole interface reads.
  $effect(() => {
    const r = document.documentElement.style, k = prefs.corners;
    r.setProperty('--accent', accentCss(lib.tracks[player.trackId]?.color));
    r.setProperty('--on-accent', onAccent());
    r.setProperty('--ambient-strength', String(prefs.light));
    r.setProperty('--glass-blur', `${prefs.frost}px`);
    r.setProperty('--island', `rgba(0, 0, 0, ${prefs.tint})`);
    // Corners: every rounded part of the interface scales together, from square to soft.
    for (const [name, px] of [['xs', 6], ['control', 8], ['island', 10], ['item', 12], ['list', 14], ['sheet', 20]]) r.setProperty(`--r-${name}`, `${Math.round(px * k * 10) / 10}px`);
  });

</script>

<Ambient />
{#if lib.loaded}
  <div class="shell" class:has-player={!!player.trackId} class:rail-right={layout.rail === 'right'} class:player-top={layout.player === 'top'} class:has-sheet={sheetW > 0} class:stage={stage.open} style:--sheet-space="{sheetW}px">
    <Sidebar />
    <main class="main-scroll" onscroll={() => glance()}>
      {#key ui.route.name + ui.route.id}
        <div class="page">
          {#if ui.route.name === 'playlist'}
            <PlaylistView id={ui.route.id} />
          {:else if ui.route.name === 'settings'}
            <Settings />
          {:else}
            <Home />
          {/if}
        </div>
      {/key}
    </main>
    <Stage />
    <PlayerBar />
    {#if aim.slot}
      <div class="dock-slot" aria-hidden="true" style="left:{aim.slot.left}px; top:{aim.slot.top}px; width:{aim.slot.width}px; height:{aim.slot.height}px"></div>
    {/if}
  </div>
  <NowPlaying />
  <SheetFrame />
  <QueuePanel />
  <ImportFlow />
  <FileImportFlow />
  <DownloadFlow />
  <ClipEditor />
  <Lyrics />
  <Sound />
  <Popups />
  <Tooltip />
{:else}
  <div class="boot">
    {#if failed}<p>{failed}</p><button class="btn ghost icon" aria-label="Try again" onclick={start}><Icon name="retry" size={19} /></button>{:else}<span class="spinner"></span>{/if}
  </div>
{/if}

<style>
  /* The page sits straight on the cover light; only the rail and the player float as islands. */
  .shell {
    position: fixed; inset: 0; z-index: 1;
    display: grid; gap: var(--gap); padding: var(--gap);
    grid-template-columns: var(--rail) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    grid-template-areas: 'rail main';
  }
  .main-scroll {
    grid-area: main; position: relative; overflow-y: auto; overflow-x: hidden;
    -webkit-overflow-scrolling: touch; overscroll-behavior: contain;
    border-radius: var(--r-island);
  }
  .page {
    position: relative; display: flex; flex-direction: column; min-height: 100%;
    max-width: 1400px; margin: 0 auto; padding: 20px 16px 24px;
    animation: pageIn .22s var(--ease) backwards; /* backwards only: a lingering transform/opacity would switch child blurs off */
  }
  .has-player .page { padding-bottom: calc(var(--player-h) + 20px); }

  /* The stage (Stage.svelte): the rail folds away and the page dissolves; only the player stays, now across the
     whole window. Everything comes back as it was. */
  .shell { transition: grid-template-columns .6s var(--ease), column-gap .6s var(--ease); }
  .shell > :global(.rail), .main-scroll { transition: opacity .45s var(--ease), filter .45s var(--ease), transform .6s var(--ease), visibility 0s; }
  .shell.stage { grid-template-columns: 0px minmax(0, 1fr); column-gap: 0; }
  .shell.stage.has-sheet, .shell.stage.has-sheet.rail-right { padding: var(--gap); }
  .shell.stage.rail-right { grid-template-columns: minmax(0, 1fr) 0px; }
  .shell.stage > :global(.rail), .shell.stage .main-scroll {
    opacity: 0; filter: blur(14px); transform: scale(.985); pointer-events: none; visibility: hidden;
    transition: opacity .45s var(--ease), filter .45s var(--ease), transform .6s var(--ease), visibility 0s .45s;
  }
  :global(:root.lite) .shell.stage > :global(.rail), :global(:root.lite) .shell.stage .main-scroll { filter: none; }
  @media (prefers-reduced-motion: reduce) { .shell, .shell > :global(.rail), .main-scroll { transition: none !important; } }
  @keyframes pageIn { from { opacity: 0; transform: translateY(5px); } }

  /* Docking: the rail can sit on the right, the player on top (phones keep their own layout). */
  @media (min-width: 761px) {
    .shell.rail-right { grid-template-columns: minmax(0, 1fr) var(--rail); grid-template-areas: 'main rail'; }
    .shell.has-sheet { padding-right: calc(var(--gap) * 2 + var(--sheet-space)); }
    .shell.has-sheet.rail-right { padding-right: var(--gap); padding-left: calc(var(--gap) * 2 + var(--sheet-space)); }
    .has-player.player-top .page { padding-top: calc(var(--player-h) + 20px); padding-bottom: 24px; }
  }
  /* The slot an island will land in while it is dragged. Solid, not dashed: dashes mean "drop files". */
  .dock-slot {
    position: fixed; z-index: 14; pointer-events: none; border-radius: var(--r-island);
    background: rgba(255, 255, 255, .06); box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, .35);
    transition: left .22s var(--ease), top .22s var(--ease), width .22s var(--ease), height .22s var(--ease);
    animation: fadeIn .15s ease both;
  }
  :global(html.docking), :global(html.docking *) { cursor: grabbing !important; user-select: none; }
  .boot { position: fixed; inset: 0; z-index: 1; display: grid; place-content: center; justify-items: center; gap: 16px; padding: 24px; text-align: center; color: var(--muted); }

  @media (max-width: 760px) {
    .shell {
      gap: 0; padding: 0;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) auto auto;
      grid-template-areas: 'main' 'player' 'rail';
    }
    .main-scroll { border-radius: 0; }
    .shell.stage { grid-template-columns: minmax(0, 1fr); }
    .shell.stage > :global(.rail) { display: none; }
    .page, .has-player .page { padding: calc(16px + var(--safe-t)) 16px 24px; }
  }
</style>

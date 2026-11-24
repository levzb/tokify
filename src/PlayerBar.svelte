<script>
  import Icon from './Icon.svelte';
  import Cover from './Cover.svelte';
  import Scrubber from './Scrubber.svelte';
  import MiniPlayer from '../iphone/MiniPlayer.svelte';
  import { layout, movable, flip, nextSide } from './dock.svelte.js';
  import { lib, playlistById, ui, go } from './state.svelte.js';
  import { player, toggle, next, prev, seek, setRepeat, setVolume, toggleMute, setShuffle, shuffleOf, contextName } from './player.svelte.js';
  import { clock, artistName } from './util.js';
  import { heardFor, soundName } from './sound.svelte.js';
  import { isNeutral } from '../server/effects.js';
  import { stage, toggleStage } from './stage.svelte.js';
  import { sleep, sleeping, sleepLeft } from './sleep.svelte.js';

  const t = $derived(lib.tracks[player.trackId]);
  const heard = $derived(heardFor(player.trackId));
  const ctxId = $derived(player.contextId);
  const shuffle = $derived(ctxId ? shuffleOf(ctxId) : false);
  const volIcon = $derived(player.volume === 0 ? 'mute' : player.volume < 0.5 ? 'volumeLow' : 'volume');
  const openContext = () => { if (ctxId && ctxId !== 'all' && playlistById(ctxId)) go('playlist', ctxId); else if (ctxId === 'all') { ui.libraryView = 'songs'; go('home'); } };
</script>

{#if t}
  <footer class="bar island" class:top={layout.player === 'top'} style="--c:{t.color || '#fff'}" use:movable={'player'}>
    <button class="grip" onclick={() => flip('player')} aria-label="Move the player to the {nextSide('player')}" title="Drag to move, or click to move it to the {nextSide('player')}"><span></span></button>
    <div class="now">
      <button class="np-cover" onclick={openContext} aria-label="Open {contextName(ctxId) || 'playlist'}"><Cover src={t.cover} size="100%" radius={0} /></button>
      <div class="txt">
        <button class="title np-title" onclick={openContext}>{t.title}</button>
        <span class="sub">{artistName(t)}</span>
      </div>
    </div>

    <div class="center">
      <div class="ctrls">
        <button class="icon-btn sm" onclick={prev} aria-label="Previous"><Icon name="prev" size={20} /></button>
        <button class="pp" style="--s:36px" onclick={toggle} aria-label={player.playing ? 'Pause' : 'Play'}>
          {#if player.loading && player.playing}<span class="spinner sm"></span>{:else}<Icon name={player.playing ? 'pause' : 'play'} size={18} />{/if}
        </button>
        <button class="icon-btn sm" onclick={next} aria-label="Next"><Icon name="next" size={20} /></button>
      </div>
      <div class="progress">
        <span class="time dur">{clock(player.pos)}</span>
        <Scrubber value={player.pos} max={player.dur} onCommit={seek} label="Seek" thin />
        <span class="time dur">{clock(player.dur)}</span>
      </div>
    </div>

    <div class="right">
      <div class="toolbox">
        {#if sleeping()}
          <button class="icon-btn sm on" onclick={() => go('settings')} aria-label={sleep.endOfSong ? 'Sleep timer: pauses when this song ends' : `Sleep timer: ${Math.ceil(sleepLeft() / 60)} min left`}>
            <Icon name="moon" size={16} /></button>
        {/if}
        <button class="icon-btn sm" class:on={shuffle} disabled={!ctxId} onclick={() => setShuffle(ctxId, !shuffle)} aria-label="Shuffle" aria-pressed={shuffle}>
          <Icon name="shuffle" size={17} />
        </button>
        <button class="icon-btn sm" class:on={player.repeat !== 'off'} onclick={() => setRepeat()} aria-label="Repeat: {player.repeat === 'one' ? 'one song' : player.repeat === 'all' ? 'playlist' : 'off'}">
          <Icon name="repeat" size={17} />{#if player.repeat === 'one'}<b class="one">1</b>{/if}
        </button>
        <button class="icon-btn sm" class:on={ui.lyricsOpen} onclick={() => { ui.lyricsTrackId = null; ui.lyricsOpen = !ui.lyricsOpen; }} aria-label="Lyrics" aria-pressed={ui.lyricsOpen}><Icon name="lyrics" size={17} /></button>
        <button class="icon-btn sm" class:on={stage.open} onclick={toggleStage} aria-label={stage.open ? 'Exit full screen' : 'Full screen'} aria-pressed={stage.open} aria-keyshortcuts="f">
          <Icon name={stage.open ? 'stageExit' : 'stage'} size={17} /></button>
        <button class="icon-btn sm" class:on={ui.soundOpen} class:fx={!isNeutral(heard)} onclick={() => { ui.soundTrackId = null; ui.soundOpen = !ui.soundOpen; }}
          aria-label="Sound" aria-pressed={ui.soundOpen} data-tip={isNeutral(heard) ? 'Sound' : `Sound: ${soundName(heard)}`}><Icon name="sound" size={17} /></button>
        <button class="icon-btn sm" class:on={ui.queueOpen} onclick={() => (ui.queueOpen = !ui.queueOpen)} aria-label="Queue" aria-pressed={ui.queueOpen}><Icon name="queue" size={17} /></button>
      </div>
      {#if player.canVolume}
        <button class="icon-btn sm" onclick={toggleMute} aria-label="Mute"><Icon name={volIcon} size={18} /></button>
        <div class="vol"><Scrubber value={player.volume} max={1} onCommit={setVolume} onLive={setVolume} label="Volume" thin /></div>
      {/if}
    </div>

    <MiniPlayer {t} />
  </footer>
{/if}

<style>
  /* An island over the bottom of the page: the list runs on underneath it. */
  .bar {
    grid-area: main; align-self: end; position: relative; z-index: 15; height: var(--player-h); overflow: hidden;
    display: grid; grid-template-columns: minmax(180px, 1fr) minmax(300px, 1.6fr) minmax(180px, 1fr); align-items: center; gap: 16px;
    padding: 0 12px 0 0;
    animation: fadeUp .3s var(--ease) both;
  }
  /* Docked on top it hangs from the top of the page column instead. */
  .bar.top { align-self: start; animation-name: fadeDown; }
  @keyframes fadeDown { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
  .bar { cursor: grab; }
  .bar :global(button), .bar :global(.scrub) { cursor: pointer; }
  :global(.bar.lifted) { z-index: 60; box-shadow: 0 24px 60px rgba(0, 0, 0, .55); }
  /* A short handle on the edge that faces the page. */
  .grip {
    position: absolute; left: 50%; top: 0; z-index: 2; width: 56px; height: 12px; margin-left: -28px; padding: 0;
    display: grid; place-items: center; background: none; border: none; cursor: grab !important;
    opacity: 0; transition: opacity .2s;
  }
  .bar.top .grip { top: auto; bottom: 0; }
  .grip span { width: 32px; height: 4px; border-radius: 2px; background: rgba(255, 255, 255, .35); transition: background .15s, width .2s var(--ease); }
  .bar:hover .grip, .grip:focus-visible { opacity: 1; }
  .grip:hover span { background: rgba(255, 255, 255, .8); width: 40px; }
  .now { display: flex; align-items: center; gap: 14px; min-width: 0; height: 100%; }
  .np-cover { width: var(--player-h); height: 100%; flex: none; padding: 0; border: none; background: none; cursor: pointer; }
  button.np-title { padding: 0; border: none; background: none; text-align: left; cursor: pointer; font-size: 15px; }
  button.np-title:hover { text-decoration: underline; }

  .center { display: flex; flex-direction: column; align-items: center; gap: 2px; max-width: 640px; width: 100%; justify-self: center; }
  .ctrls { display: flex; align-items: center; gap: 14px; }
  .ctrls .icon-btn { color: var(--text); }
  .progress { display: flex; align-items: center; gap: 10px; width: 100%; }
  .time { font-size: 11px; min-width: 34px; text-align: center; }

  .right { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
  .toolbox { display: flex; gap: 2px; }
  /* A sound effect is on: the same dot as an open panel, so it is never forgotten. */
  .toolbox .fx::after { content: ''; position: absolute; left: 50%; bottom: 1px; width: 4px; height: 4px; margin-left: -2px; border-radius: 50%; background: var(--accent); }
  .vol { width: 96px; display: flex; }

  @media (max-width: 1000px) { .vol { display: none; } }
  @media (max-width: 760px) {
    .bar { grid-area: player; align-self: auto; height: auto; display: block; overflow: visible; padding: 0 8px 8px; background: transparent; -webkit-backdrop-filter: none; backdrop-filter: none; border-radius: 0; animation: none; }
    .now, .center, .right, .grip { display: none; }
    .bar, .bar.top { cursor: auto; align-self: auto; animation: none; }
  }
</style>

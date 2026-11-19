<script>
  import Icon from './Icon.svelte';
  import Cover from './Cover.svelte';
  import Scrubber from './Scrubber.svelte';
  import MiniPlayer from '../iphone/MiniPlayer.svelte';
  import { lib, playlistById, ui, go } from './state.svelte.js';
  import { player, toggle, next, prev, seek, setRepeat, setVolume, toggleMute, setShuffle, shuffleOf, contextName } from './player.svelte.js';
  import { clock, artistName } from './util.js';

  const t = $derived(lib.tracks[player.trackId]);
  const ctxId = $derived(player.contextId);
  const shuffle = $derived(ctxId ? shuffleOf(ctxId) : false);
  const volIcon = $derived(player.volume === 0 ? 'mute' : player.volume < 0.5 ? 'volumeLow' : 'volume');
  const openContext = () => { if (ctxId && ctxId !== 'all' && playlistById(ctxId)) go('playlist', ctxId); else if (ctxId === 'all') { ui.libraryView = 'songs'; go('home'); } };
</script>

{#if t}
  <footer class="bar" style="--c:{t.color || '#fff'}">
    <div class="now">
      <button class="np-cover" onclick={openContext} aria-label="Open {contextName(ctxId) || 'playlist'}"><Cover src={t.cover} size={56} radius={8} /></button>
      <div class="np-txt">
        <button class="np-title" onclick={openContext}>{t.title}</button>
        <span class="np-author">{artistName(t)}</span>
      </div>
    </div>

    <div class="center">
      <div class="ctrls">
        <button class="icon-btn sm" class:on={shuffle} disabled={!ctxId} onclick={() => setShuffle(ctxId, !shuffle)} aria-label="Shuffle" aria-pressed={shuffle}>
          <Icon name="shuffle" size={18} />{#if shuffle}<i class="dot"></i>{/if}
        </button>
        <button class="icon-btn" onclick={prev} aria-label="Previous"><Icon name="prev" size={20} /></button>
        <button class="pp" onclick={toggle} aria-label={player.playing ? 'Pause' : 'Play'}>
          {#if player.loading && player.playing}<span class="spinner dark"></span>{:else}<Icon name={player.playing ? 'pause' : 'play'} size={18} />{/if}
        </button>
        <button class="icon-btn" onclick={next} aria-label="Next"><Icon name="next" size={20} /></button>
        <button class="icon-btn sm" class:on={player.repeat !== 'off'} onclick={() => setRepeat()} aria-label="Repeat: {player.repeat === 'one' ? 'one song' : player.repeat === 'all' ? 'playlist' : 'off'}">
          <Icon name="repeat" size={18} />{#if player.repeat === 'one'}<b class="one">1</b>{/if}{#if player.repeat !== 'off'}<i class="dot"></i>{/if}
        </button>
      </div>
      <div class="progress">
        <span class="time mono">{clock(player.pos)}</span>
        <Scrubber value={player.pos} max={player.dur} onCommit={seek} label="Seek" />
        <span class="time mono">{clock(player.dur)}</span>
      </div>
    </div>

    <div class="right">
      <button class="icon-btn sm" class:on={ui.queueOpen} onclick={() => (ui.queueOpen = !ui.queueOpen)} aria-label="Queue" aria-pressed={ui.queueOpen}><Icon name="queue" size={19} /></button>
      {#if player.canVolume}
        <button class="icon-btn sm" onclick={toggleMute} aria-label="Mute"><Icon name={volIcon} size={19} /></button>
        <div class="vol"><Scrubber value={player.volume} max={1} onCommit={setVolume} onLive={setVolume} label="Volume" thin /></div>
      {/if}
    </div>

    <MiniPlayer {t} />
  </footer>
{/if}

<style>
  .bar {
    grid-area: player; position: relative; z-index: 15; height: var(--player-h);
    display: grid; grid-template-columns: minmax(180px, 1fr) minmax(320px, 2fr) minmax(180px, 1fr); align-items: center; gap: 16px;
    padding: 0 20px; background: #000; border-top: 1px solid var(--border);
    animation: fadeUp .5s var(--ease) both;
  }
  .bar::before { /* the song's own color, like the glow behind dyke's products */
    content: ''; position: absolute; left: 0; top: 0; width: 360px; height: 100%; pointer-events: none;
    background: radial-gradient(260px 90px at 40px 50%, color-mix(in srgb, var(--c) 16%, transparent), transparent 70%);
    transition: background .6s;
  }
  .now { position: relative; display: flex; align-items: center; gap: 14px; min-width: 0; }
  .np-cover { padding: 0; border: none; background: none; cursor: pointer; border-radius: 8px; box-shadow: 0 8px 20px rgba(0,0,0,.6); }
  .np-txt { display: flex; flex-direction: column; min-width: 0; }
  .np-title { padding: 0; border: none; background: none; text-align: left; cursor: pointer; font-size: 14px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: -0.01em; }
  button.np-title:hover { text-decoration: underline; text-underline-offset: 3px; }
  .np-author { font-size: 12.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .center { display: flex; flex-direction: column; align-items: center; gap: 4px; max-width: 680px; width: 100%; justify-self: center; }
  .ctrls { display: flex; align-items: center; gap: 10px; }
  .icon-btn { position: relative; }
  .icon-btn.sm { width: 36px; height: 36px; }
  .icon-btn.on { color: #fff; }
  .dot { position: absolute; bottom: 3px; left: 50%; width: 4px; height: 4px; margin-left: -2px; border-radius: 50%; background: #fff; }
  .one { position: absolute; top: 5px; right: 4px; font-size: 9px; font-weight: 800; line-height: 1; background: #000; padding: 1px 2px; border-radius: 3px; }
  .pp {
    width: 38px; height: 38px; border-radius: 50%; border: none; cursor: pointer; display: grid; place-items: center;
    background: #fff; color: #000; transition: background .2s, transform .2s var(--ease);
  }
  .pp:hover { background: #d8d8d8; transform: scale(1.05); }
  .pp:active { transform: scale(.96); }
  .spinner.dark { width: 16px; height: 16px; border-color: rgba(0,0,0,.15); border-top-color: #000; }
  .progress { display: flex; align-items: center; gap: 10px; width: 100%; }
  .time { font-size: 11px; color: var(--muted); min-width: 36px; text-align: center; }

  .right { display: flex; align-items: center; justify-content: flex-end; gap: 4px; }
  .vol { width: 110px; display: flex; }

  @media (max-width: 760px) {
    .bar { height: auto; display: block; padding: 0 8px 6px; background: transparent; border: none; }
    .bar::before, .now, .center, .right { display: none; }
  }
</style>

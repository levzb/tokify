<script>
  import { blurred, SIZE } from '../src/blur.js';
  // Phone: full-screen player opened from the mini player. Swipe down to close.
  import Icon from '../src/Icon.svelte';
  import Cover from '../src/Cover.svelte';
  import Scrubber from '../src/Scrubber.svelte';
  import { lib, ui, openMenu } from '../src/state.svelte.js';
  import { player, toggle, next, prev, seek, setRepeat, setShuffle, shuffleOf, contextName } from '../src/player.svelte.js';
  import { trackMenu } from '../src/menus.js';
  import { clock, artistName } from '../src/util.js';
  import { heardFor } from '../src/sound.svelte.js';
  import { isNeutral } from '../server/effects.js';
  import { openStage } from '../src/stage.svelte.js';

  const t = $derived(lib.tracks[player.trackId]);
  const ctxId = $derived(player.contextId);
  const shuffle = $derived(ctxId ? shuffleOf(ctxId) : false);
  let dy = $state(0);
  let startY = null;
  const close = () => { ui.nowPlayingOpen = false; dy = 0; };
  function tStart(e) { if (e.target.closest('.scrub')) return; startY = e.touches[0].clientY; }
  function tMove(e) { if (startY == null) return; dy = Math.max(0, e.touches[0].clientY - startY); }
  function tEnd() { if (startY == null) return; startY = null; if (dy > 110) close(); else dy = 0; }
  $effect(() => { if (!t) ui.nowPlayingOpen = false; });
</script>

{#if ui.nowPlayingOpen && t}
  <div class="np" style="--c:{t.color || '#fff'}; transform: translateY({dy}px); transition: {dy ? 'none' : ''}"
    ontouchstart={tStart} ontouchmove={tMove} ontouchend={tEnd} role="dialog" tabindex="-1" aria-modal="true" aria-label="Now playing">
    <div class="backdrop" aria-hidden="true">{#if t.cover}<canvas width={SIZE} height={SIZE} use:blurred={t.cover}></canvas>{/if}</div>
    <div class="top">
      <button class="icon-btn fill" onclick={close} aria-label="Close"><Icon name="down" size={24} /></button>
      <span class="ctx">{contextName(ctxId) || 'Queue'}</span>
      <button class="icon-btn fill" onclick={(e) => openMenu(e, trackMenu(t), { anchor: e.currentTarget })} aria-label="Song menu"><Icon name="more" size={22} /></button>
    </div>
    <div class="art">{#key t.id}<div class="art-in"><Cover src={t.cover} size="100%" radius={10} /></div>{/key}</div>
    <div class="meta">
      <div class="title">{t.title}</div>
      <div class="author">{artistName(t)}</div>
    </div>
    <div class="progress">
      <Scrubber value={player.pos} max={player.dur} onCommit={seek} label="Seek" />
      <div class="times dur"><span>{clock(player.pos)}</span><span>-{clock(Math.max(0, player.dur - player.pos))}</span></div>
    </div>
    <div class="ctrls">
      <button class="icon-btn" class:on={shuffle} disabled={!ctxId} onclick={() => setShuffle(ctxId, !shuffle)} aria-label="Shuffle" aria-pressed={shuffle}>
        <Icon name="shuffle" size={22} />
      </button>
      <button class="icon-btn big" onclick={prev} aria-label="Previous"><Icon name="prev" size={30} /></button>
      <button class="pp" style="--s:68px" onclick={toggle} aria-label={player.playing ? 'Pause' : 'Play'}><Icon name={player.playing ? 'pause' : 'play'} size={30} /></button>
      <button class="icon-btn big" onclick={next} aria-label="Next"><Icon name="next" size={30} /></button>
      <button class="icon-btn" class:on={player.repeat !== 'off'} onclick={() => setRepeat()} aria-label="Repeat">
        <Icon name="repeat" size={22} />{#if player.repeat === 'one'}<b class="one">1</b>{/if}
      </button>
    </div>
    <div class="bottom">
      <button class="icon-btn" aria-label="Lyrics" onclick={() => { ui.lyricsTrackId = null; ui.lyricsOpen = true; }}><Icon name="lyrics" size={22} /></button>
      <button class="icon-btn" aria-label="Full screen" onclick={openStage}><Icon name="stage" size={22} /></button>
      <button class="icon-btn" class:on={!isNeutral(heardFor(player.trackId))} aria-label="Sound" onclick={() => { ui.soundTrackId = null; ui.soundOpen = true; }}><Icon name="sound" size={22} /></button>
      <button class="icon-btn" aria-label="Queue" onclick={() => { ui.queueOpen = true; }}><Icon name="queue" size={22} /></button>
    </div>
  </div>
{/if}

<style>
  .np {
    position: fixed; inset: 0; z-index: 200; display: flex; flex-direction: column;
    padding: calc(8px + var(--safe-t)) 24px calc(18px + var(--safe-b));
    background: var(--ground); overflow: hidden;
    animation: up .45s var(--ease) both; transition: transform .3s var(--ease);
  }
  @keyframes up { from { transform: translateY(100%); } to { transform: none; } }
  /* The cover itself, blurred into the room the controls sit in. */
  .backdrop { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(120% 70% at 50% 0%, color-mix(in srgb, var(--c) 45%, transparent), transparent 75%); }
  .backdrop canvas { position: absolute; left: 50%; top: 40%; width: 120vmax; height: 120vmax; transform: translate(-50%, -50%); opacity: 0; transition: opacity .5s ease; }
  .backdrop :global(canvas.ready) { opacity: .8; }
  .backdrop::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(7,7,8,.2), rgba(7,7,8,.55) 55%, rgba(7,7,8,.8)); }
  .top, .art, .meta, .progress, .ctrls, .bottom { position: relative; }
  .top { display: flex; align-items: center; justify-content: space-between; height: 52px; }
  .ctx { font-size: 13px; font-weight: 700; color: var(--text); text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60%; }
  .art { flex: 1; min-height: 0; display: grid; place-items: center; margin: 18px 0; container-type: size; }
  .art-in { width: min(100cqw, 100cqh); aspect-ratio: 1; box-shadow: 0 30px 80px rgba(0,0,0,.55); border-radius: 10px; animation: popIn .45s var(--ease) both; }
  @keyframes popIn { from { opacity: 0; transform: scale(.94); } to { opacity: 1; transform: none; } }
  .meta { margin-bottom: 18px; min-width: 0; }
  .title { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.25; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .author { font-size: 15px; color: var(--muted); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .progress { display: flex; flex-direction: column; gap: 2px; }
  .times { display: flex; justify-content: space-between; font-size: 12px; }
  .ctrls { display: flex; align-items: center; justify-content: space-between; margin: 16px 0 10px; }
  .ctrls .icon-btn { width: 48px; height: 48px; }
  .ctrls .icon-btn.big { width: 60px; height: 60px; color: var(--text); }
  .pp { box-shadow: var(--shadow-art); }
  .bottom { display: flex; justify-content: flex-end; }
</style>

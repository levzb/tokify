<script>
  // Phone: full-screen player opened from the mini player. Swipe down to close.
  import Icon from './Icon.svelte';
  import Cover from './Cover.svelte';
  import Scrubber from './Scrubber.svelte';
  import { lib } from '../lib/library.svelte.js';
  import { ui, openMenu } from '../lib/ui.svelte.js';
  import { player, toggle, next, prev, seek, setRepeat, setShuffle, shuffleOf, contextName } from '../lib/player.svelte.js';
  import { trackMenu } from '../lib/menus.js';
  import { clock, artistName } from '../lib/format.js';

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
    <div class="glow"></div>
    <div class="top">
      <button class="icon-btn" onclick={close} aria-label="Close"><Icon name="down" size={24} /></button>
      <span class="ctx">{contextName(ctxId) || 'Queue'}</span>
      <button class="icon-btn" onclick={(e) => openMenu(e, trackMenu(t), { anchor: e.currentTarget })} aria-label="Song menu"><Icon name="more" size={22} /></button>
    </div>
    <div class="art">{#key t.id}<div class="art-in"><Cover src={t.cover} size="100%" radius={14} /></div>{/key}</div>
    <div class="meta">
      <div class="title">{t.title}</div>
      <div class="author">{artistName(t)}</div>
    </div>
    <div class="progress">
      <Scrubber value={player.pos} max={player.dur} onCommit={seek} label="Seek" />
      <div class="times mono"><span>{clock(player.pos)}</span><span>-{clock(Math.max(0, player.dur - player.pos))}</span></div>
    </div>
    <div class="ctrls">
      <button class="icon-btn" class:on={shuffle} disabled={!ctxId} onclick={() => setShuffle(ctxId, !shuffle)} aria-label="Shuffle" aria-pressed={shuffle}>
        <Icon name="shuffle" size={22} />{#if shuffle}<i class="dot"></i>{/if}
      </button>
      <button class="icon-btn big" onclick={prev} aria-label="Previous"><Icon name="prev" size={30} /></button>
      <button class="pp" onclick={toggle} aria-label={player.playing ? 'Pause' : 'Play'}><Icon name={player.playing ? 'pause' : 'play'} size={30} /></button>
      <button class="icon-btn big" onclick={next} aria-label="Next"><Icon name="next" size={30} /></button>
      <button class="icon-btn" class:on={player.repeat !== 'off'} onclick={() => setRepeat()} aria-label="Repeat">
        <Icon name="repeat" size={22} />{#if player.repeat === 'one'}<b class="one">1</b>{/if}{#if player.repeat !== 'off'}<i class="dot"></i>{/if}
      </button>
    </div>
    <div class="bottom">
      <button class="btn quiet" onclick={() => { ui.queueOpen = true; }}><Icon name="queue" size={18} /> Queue</button>
    </div>
  </div>
{/if}

<style>
  .np {
    position: fixed; inset: 0; z-index: 200; display: flex; flex-direction: column;
    padding: calc(8px + var(--safe-t)) 24px calc(18px + var(--safe-b));
    background: #000; overflow: hidden;
    animation: up .45s var(--ease) both; transition: transform .3s var(--ease);
  }
  @keyframes up { from { transform: translateY(100%); } to { transform: none; } }
  .glow { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(120% 60% at 50% 0%, color-mix(in srgb, var(--c) 30%, transparent), transparent 70%); transition: background .6s; }
  .top, .art, .meta, .progress, .ctrls, .bottom { position: relative; }
  .top { display: flex; align-items: center; justify-content: space-between; height: 52px; }
  .top .icon-btn { color: #fff; }
  .ctx { font-size: 12px; font-weight: 600; letter-spacing: 0.02em; color: var(--muted); text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60%; }
  .art { flex: 1; min-height: 0; display: grid; place-items: center; margin: 18px 0; container-type: size; }
  .art-in { width: min(100cqw, 100cqh); aspect-ratio: 1; box-shadow: 0 30px 80px rgba(0,0,0,.7); border-radius: 14px; animation: popIn .45s var(--ease) both; }
  @keyframes popIn { from { opacity: 0; transform: scale(.94); } to { opacity: 1; transform: none; } }
  .meta { margin-bottom: 18px; min-width: 0; }
  .title { font-size: 22px; font-weight: 700; letter-spacing: -0.03em; line-height: 1.25; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .author { font-size: 15px; color: var(--muted); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .progress { display: flex; flex-direction: column; gap: 2px; }
  .times { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--muted); }
  .ctrls { display: flex; align-items: center; justify-content: space-between; margin: 16px 0 10px; }
  .icon-btn { position: relative; width: 48px; height: 48px; }
  .icon-btn.big { width: 60px; height: 60px; color: #fff; }
  .icon-btn.on { color: #fff; }
  .dot { position: absolute; bottom: 4px; left: 50%; width: 4px; height: 4px; margin-left: -2px; border-radius: 50%; background: #fff; }
  .one { position: absolute; top: 9px; right: 8px; font-size: 9px; font-weight: 800; background: #000; padding: 1px 2px; border-radius: 3px; }
  .pp { width: 72px; height: 72px; border-radius: 50%; border: none; display: grid; place-items: center; background: #fff; color: #000; box-shadow: 0 14px 36px rgba(0,0,0,.6); transition: transform .2s var(--ease); }
  .pp:active { transform: scale(.95); }
  .bottom { display: flex; justify-content: flex-end; }
</style>

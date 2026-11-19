<script>
  // Phone: the slim player above the bottom bar. Tapping it opens NowPlaying.
  import Icon from '../src/Icon.svelte';
  import Cover from '../src/Cover.svelte';
  import { ui } from '../src/state.svelte.js';
  import { player, toggle, next } from '../src/player.svelte.js';
  import { artistName } from '../src/util.js';

  let { t } = $props();
</script>

<div class="mini" role="button" tabindex="0" onclick={() => (ui.nowPlayingOpen = true)} onkeydown={(e) => e.key === 'Enter' && (ui.nowPlayingOpen = true)}>
  <Cover src={t.cover} size={42} radius={7} />
  <div class="np-txt">
    <span class="np-title">{t.title}</span>
    <span class="np-author">{artistName(t)}</span>
  </div>
  <button class="icon-btn" onclick={(e) => { e.stopPropagation(); toggle(); }} aria-label={player.playing ? 'Pause' : 'Play'}>
    <Icon name={player.playing ? 'pause' : 'play'} size={22} />
  </button>
  <button class="icon-btn" onclick={(e) => { e.stopPropagation(); next(); }} aria-label="Next"><Icon name="next" size={20} /></button>
  <div class="mini-progress"><div style="width:{player.dur ? (player.pos / player.dur) * 100 : 0}%"></div></div>
</div>

<style>
  .mini { display: none; }
  .np-txt { display: flex; flex-direction: column; min-width: 0; }
  .np-title { font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: -0.01em; }
  .np-author { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  @media (max-width: 760px) {
    .mini {
      position: relative; display: flex; align-items: center; gap: 10px; padding: 7px 4px 7px 7px; overflow: hidden; cursor: pointer;
      border-radius: 12px; border: 1px solid var(--border);
      background: linear-gradient(90deg, color-mix(in srgb, var(--c) 22%, #0b0b0b), #0b0b0b 75%);
      box-shadow: 0 10px 30px rgba(0,0,0,.6);
    }
    .np-txt { flex: 1; }
    .np-title { font-size: 13.5px; }
    .np-author { font-size: 12px; }
    .icon-btn { width: 44px; height: 44px; color: #fff; }
    .mini-progress { position: absolute; left: 10px; right: 10px; bottom: 0; height: 2px; background: rgba(255,255,255,.12); border-radius: 2px; overflow: hidden; }
    .mini-progress div { height: 100%; background: #fff; }
  }
</style>

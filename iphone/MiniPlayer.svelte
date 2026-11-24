<script>
  // Phone: the slim frosted player above the bottom bar. Tapping it opens NowPlaying.
  import Icon from '../src/Icon.svelte';
  import Cover from '../src/Cover.svelte';
  import { ui } from '../src/state.svelte.js';
  import { player, toggle, next } from '../src/player.svelte.js';
  import { artistName } from '../src/util.js';

  let { t } = $props();
</script>

<div class="mini frost" role="button" tabindex="0" onclick={() => (ui.nowPlayingOpen = true)} onkeydown={(e) => e.key === 'Enter' && (ui.nowPlayingOpen = true)}>
  <Cover src={t.cover} size={42} radius={6} />
  <div class="txt">
    <span class="title np-title">{t.title}</span>
    <span class="sub">{artistName(t)}</span>
  </div>
  <button class="icon-btn" onclick={(e) => { e.stopPropagation(); toggle(); }} aria-label={player.playing ? 'Pause' : 'Play'}>
    <Icon name={player.playing ? 'pause' : 'play'} size={22} />
  </button>
  <button class="icon-btn" onclick={(e) => { e.stopPropagation(); next(); }} aria-label="Next"><Icon name="next" size={20} /></button>
  <div class="meter mini-progress"><i style="transform:scaleX({player.dur ? player.pos / player.dur : 0})"></i></div>
</div>

<style>
  .mini { display: none; }
  @media (max-width: 760px) {
    .mini {
      position: relative; display: flex; align-items: center; gap: 10px; padding: 7px 4px 7px 7px; overflow: hidden; cursor: pointer;
      border-radius: 12px;
      background: linear-gradient(90deg, color-mix(in srgb, var(--c) 30%, transparent), transparent 80%), var(--surface);
    }
    .mini .sub { font-size: 12px; }
    .icon-btn { width: 44px; height: 44px; color: var(--text); }
    .mini-progress { position: absolute; left: 10px; right: 10px; bottom: 0; height: 2px; }
  }
</style>

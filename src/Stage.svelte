<script>
  // The stage (stage.svelte.js): the window becomes the playing song. Its cover lights the whole room and drifts
  // slowly; beside it the song, and its words as big as they go. Timed words are sung word by word: the line
  // being sung fills in as it goes, the ones around it step back into soft focus, and when the song moves on the
  // lines follow one after another like a short cascade. A break in the singing is three dots that fill up until
  // the next line. Plain words scroll; a song without words keeps the room to its cover. Only the player stays.
  import Icon from './Icon.svelte';
  import Cover from './Cover.svelte';
  import { lib, ui, playlistById } from './state.svelte.js';
  import { player, seek, contextName } from './player.svelte.js';
  import { stage, closeStage } from './stage.svelte.js';
  import { words, loadLyrics, timedLines, lineAt, canListen, listenTo } from './lyrics.svelte.js';
  import { layout } from './dock.svelte.js';
  import { blurred, SIZE } from './blur.js';
  import { perf, watchFrames } from './perf.svelte.js';
  import { artistName } from './util.js';
  import { providerName } from '../server/shared.js';

  const t = $derived(stage.open ? lib.tracks[player.trackId] : null);
  $effect(() => { if (stage.open && !lib.tracks[player.trackId]) closeStage(); });
  $effect(() => { if (t) loadLyrics(t.id); });
  // The moving light is the costliest thing here; a device that cannot keep up gets it standing still.
  $effect(() => { if (stage.open && !perf.lite) return watchFrames(); });

  const w = $derived(t ? words[t.id] : null);
  const res = $derived(w?.res || null);
  const timed = $derived(timedLines(res));
  // A long wait before the first words is a break too.
  const lines = $derived(timed.length && timed[0].t > 4 ? [{ t: 0, text: '' }, ...timed] : timed);
  const plain = $derived(!lines.length && res?.status === 'found' ? res.text : '');
  const solo = $derived(!lines.length && !plain);

  const at = $derived(t ? player.pos + (t.start || 0) : 0);
  const current = $derived(lines.length ? lineAt(lines, at) : -1);
  // How far into its line the song is, 0..1. Words finish a little before the next line comes.
  const span = (i) => {
    const a = lines[i].t, b = lines[i + 1]?.t ?? a + 6;
    return Math.max(0.5, Math.min(b - a, lines[i].text ? 12 : 90)) * (lines[i].text ? 0.9 : 1);
  };
  const prog = $derived(current >= 0 ? Math.min(1, Math.max(0, (at - lines[current].t) / span(current))) : 0);

  // A line's words, each with the stretch of the line it is sung in (by letters).
  // Japanese, Chinese and Korean are sung character by character and written without spaces.
  const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uff00-\uffef]/;
  function tokens(text) {
    const parts = [];
    for (const word of text.split(/\s+/).filter(Boolean)) {
      if (CJK.test(word)) { const chars = [...word]; chars.forEach((ch, i) => parts.push({ w: ch, sp: i === chars.length - 1 })); }
      else parts.push({ w: word, sp: true });
    }
    const total = parts.reduce((n, p) => n + p.w.length, 0) || 1;
    let c = 0;
    return parts.map((p) => { const a = c / total; c += p.w.length; return { ...p, a, b: c / total }; });
  }
  const sung = (k) => Math.min(1, Math.max(0, (prog - k.a) / Math.max(0.0001, k.b - k.a)));

  // ---- keeping the sung line at the eye's height ----
  let view = $state(), col = $state();
  let height = $state(0);
  let shift = $state(0);
  $effect(() => {
    if (!view) return;
    const ro = new ResizeObserver(() => { height = view.clientHeight; });
    ro.observe(view);
    document.fonts?.ready.then(() => { height = view.clientHeight + 0.001; });
    return () => ro.disconnect();
  });
  $effect(() => {
    const i = Math.max(0, current), el = col?.children[i];
    if (!el || !height) return;
    shift = Math.round(height * (matchMedia('(max-width: 760px)').matches ? 0.3 : 0.36) - (el.offsetTop + el.offsetHeight / 2));
  });
  const look = (i) => {
    const d = i - current;
    if (current < 0) return { o: i === 0 ? 0.55 : Math.max(0.12, 0.45 - 0.08 * i), b: Math.min(4, i * 0.8), s: 0.97 };
    if (d === 0) return { o: 1, b: 0, s: 1 };
    if (d < 0) return { o: d === -1 ? 0.34 : 0.2, b: Math.min(3, -d * 0.9), s: 0.96 };
    return { o: Math.max(0.1, 0.46 - 0.09 * (d - 1)), b: Math.min(4.5, (d - 1) * 0.9 + 0.4), s: 0.96 };
  };
  const jump = (l) => { if (t) seek(Math.max(0, l.t - (t.start || 0))); };

  // ---- what is around the song ----
  const from = $derived.by(() => {
    const id = player.contextId, pl = id && id !== 'all' ? playlistById(id) : null;
    const name = contextName(id);
    return pl?.origin ? `${name} · from ${providerName(pl.origin)}` : name;
  });
  const nextId = $derived(player.queue[0]?.id || player.upNext[0] || null);
  const nextT = $derived(nextId && nextId !== t?.id ? lib.tracks[nextId] : null);
  const status = $derived(!w || w.busy ? 'listening' : w.error ? 'error' : res?.status || 'listening');

  // ---- the controls step away while you watch ----
  let awake = $state(true), nap = 0;
  function stir() { awake = true; clearTimeout(nap); nap = setTimeout(() => (awake = false), 2600); }
  $effect(() => { if (stage.open) stir(); return () => clearTimeout(nap); });

  // The room clears, then the stage comes forward from a little way off.
  // A blur across the whole window is costly; on a light device these are a plain fade.
  const soft = (px) => (perf.lite ? '' : `filter:blur(${px}px);`);
  const enter = () => ({ duration: 700, css: (k) => { const e = 1 - Math.pow(1 - k, 4); return `opacity:${e};transform:scale(${1.035 - 0.035 * e});${soft((1 - e) * 14)}`; } });
  const leave = () => ({ duration: 320, css: (k) => `opacity:${k};${soft((1 - k) * 10)}` });
  const song = () => ({ duration: 650, css: (k) => { const e = 1 - Math.pow(1 - k, 3); return `opacity:${e};transform:translateY(${(1 - e) * 18}px);${soft((1 - e) * 8)}`; } });
</script>

{#if t}
  <div class="stage" class:idle={!awake} class:paused={!player.playing} class:top={layout.player === 'top'} style="--c:{t.color || '#8a8fa8'}"
    role="region" aria-label="Full screen: {t.title}" onpointermove={stir} onpointerdown={stir} in:enter out:leave>
    <div class="light" aria-hidden="true">
      {#key t.cover}
        <div class="drift" in:song>
          {#if t.cover}
            <canvas class="a" data-round width={SIZE} height={SIZE} use:blurred={t.cover}></canvas>
            <canvas class="b" data-round width={SIZE} height={SIZE} use:blurred={t.cover}></canvas>
          {/if}
        </div>
      {/key}
      <div class="dim"></div>
    </div>

    <button class="icon-btn exit" onclick={closeStage} aria-label="Exit full screen" aria-keyshortcuts="f"><Icon name="stageExit" size={20} /></button>

    {#key t.id}
      <div class="scene" class:solo in:song>
        <aside class="about">
          <div class="art" class:playing={player.playing}><Cover src={t.cover} size="100%" radius={10} /></div>
          <div class="who">
            <h1 class="name">{t.title}</h1>
            <p class="by">{artistName(t)}</p>
            {#if solo}
              <p class="state" role="status">
                {#if status === 'listening'}<span class="ear" aria-hidden="true"><i></i><i></i><i></i><i></i></span>{w?.listening ? 'Listening with Shazam…' : 'Looking for the words…'}
                {:else if status === 'unheard'}Not recognised yet
                {:else if status === 'instrumental'}Instrumental
                {:else if status === 'nolyrics'}No words found for this song
                {:else if status === 'unknown'}Couldn’t recognise this sound
                {:else if status === 'error'}{w.error}{/if}
              </p>
              {#if status !== 'listening' && canListen(res)}
                <button class="btn ghost listen" onclick={() => listenTo(t.id)}><Icon name="ear" size={18} />Recognise with Shazam</button>
              {/if}
            {/if}
            <div class="around">
              {#if from}<p>{from}</p>{/if}
              {#if nextT}<p class="next">Next: <span>{nextT.title}</span> · {artistName(nextT)}</p>{/if}
            </div>
          </div>
        </aside>

        {#if lines.length}
          <div class="words" bind:this={view}>
            <ol class="lines" bind:this={col} aria-label="Lyrics">
              {#each lines as l, i (i)}
                {@const v = look(i)}
                <li class="line" class:now={i === current} class:gap={!l.text}
                  style="opacity:{v.o}; filter:{v.b && !perf.lite ? `blur(${v.b}px)` : 'none'}; transform:translateY({shift}px) scale({v.s}); transition-delay:{current < 0 ? 0 : Math.min(Math.abs(i - current), 7) * 32}ms">
                  <button onclick={() => jump(l)} aria-current={i === current || null} aria-label={l.text ? null : 'Instrumental break'}>
                    {#if !l.text}
                      <span class="dots" aria-hidden="true">
                        {#each [0, 1, 2] as k}<i style="--f:{i === current ? Math.min(1, Math.max(0, prog * 3 - k)) : 0}"></i>{/each}
                      </span>
                    {:else if i === current}
                      {#each tokens(l.text) as k}<span class="word" style="--f:{sung(k)}">{k.w}</span>{k.sp ? ' ' : ''}{/each}
                    {:else}{l.text}{/if}
                  </button>
                </li>
              {/each}
            </ol>
          </div>
        {:else if plain}
          <div class="words plain scroll" tabindex="0" aria-label="Lyrics">{plain}</div>
        {/if}
      </div>
    {/key}
  </div>
{/if}

<style>
  .stage {
    position: fixed; inset: 0; z-index: 2; overflow: hidden; isolation: isolate;
    --pad: clamp(28px, 4.6vw, 88px);
    --below: calc(var(--player-h) + var(--gap) * 2 + 24px);
  }
  /* With a mouse, the pointer and the exit step away while you watch; a touch screen keeps the exit in reach. */
  @media (hover: hover) {
    .stage.idle, .stage.idle * { cursor: none; }
    .idle .exit { opacity: 0; pointer-events: none; }
  }

  /* ---- the room: the cover's light, alive ---- */
  .light { position: absolute; inset: 0; z-index: -1; pointer-events: none; }
  .drift { position: absolute; inset: 0; }
  /* Two round lights, each a 72px canvas the GPU only scales and moves: no blending, no mask, nothing to redraw. */
  .drift canvas {
    position: absolute; left: 50%; top: 50%; width: 150vmax; height: 150vmax; margin: -75vmax 0 0 -75vmax;
    opacity: 0; transition: opacity 1.2s ease; will-change: transform;
  }
  .drift :global(canvas.ready) { opacity: .62; }
  .drift :global(canvas.b.ready) { opacity: .4; }
  .drift .a { animation: orbitA 48s ease-in-out infinite alternate; }
  .drift .b { animation: orbitB 63s ease-in-out infinite alternate; transform-origin: 40% 60%; }
  @keyframes orbitA { from { transform: translate(-14vmax, -8vmax) rotate(0deg) scale(1); } to { transform: translate(10vmax, 6vmax) rotate(40deg) scale(1.15); } }
  @keyframes orbitB { from { transform: translate(12vmax, 10vmax) rotate(180deg) scale(1.2); } to { transform: translate(-8vmax, -6vmax) rotate(120deg) scale(.95); } }
  .paused .drift canvas { animation-play-state: paused; }
  :global(:root.lite) .drift canvas, :global(:root.lite) .art.playing, :global(:root.lite) .now .dots { animation: none; }
  /* Readable everywhere: darker towards the words' edge and under the player. */
  .dim {
    position: absolute; inset: 0;
    background:
      linear-gradient(180deg, rgba(7, 7, 8, .2), transparent 30%, transparent 62%, rgba(7, 7, 8, .55)),
      radial-gradient(120% 90% at 30% 45%, transparent 35%, rgba(7, 7, 8, .45));
  }

  .exit {
    position: absolute; z-index: 3; right: calc(var(--gap) + 12px); top: calc(var(--gap) + 12px + var(--safe-t));
    transition: opacity .5s var(--ease), color .15s, background .15s;
  }

  /* ---- the scene: the song beside its words ---- */
  .scene {
    position: absolute; inset: 0; display: grid; align-items: center;
    grid-template-columns: clamp(250px, 26vw, 420px) minmax(0, 1fr); column-gap: clamp(40px, 6vw, 128px);
    padding: var(--pad) var(--pad) var(--below);
  }
  .top .scene { padding: var(--below) var(--pad) var(--pad); }
  .about { display: grid; gap: 28px; align-content: center; min-width: 0; }
  .art {
    width: 100%; aspect-ratio: 1; border-radius: 10px;
    box-shadow: 0 30px 80px -20px color-mix(in srgb, var(--c) 55%, rgba(0, 0, 0, .6)), 0 12px 32px rgba(0, 0, 0, .45);
    transition: transform 1.2s var(--ease), box-shadow 1.2s var(--ease);
  }
  .art.playing { animation: breathe 5.5s ease-in-out infinite; }
  .paused .art { transform: scale(.94); box-shadow: 0 18px 50px -20px rgba(0, 0, 0, .6); }
  @keyframes breathe { 50% { transform: scale(1.018); } }
  .who { display: grid; gap: 6px; min-width: 0; }
  .name {
    margin: 0; font-size: clamp(24px, 2.3vw, 40px); line-height: 1.12; font-weight: 800; letter-spacing: -.03em; text-wrap: balance;
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
  }
  .by { margin: 0; font-size: clamp(15px, 1.2vw, 19px); font-weight: 500; color: var(--muted); }
  .around { display: grid; gap: 4px; margin-top: 14px; font-size: 13px; color: var(--faint); }
  .around p { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .next span { color: var(--muted); font-weight: 500; }
  .state { display: flex; align-items: center; gap: 12px; margin: 14px 0 0; font-size: 15px; color: var(--muted); }
  .ear { display: inline-flex; align-items: center; gap: 3px; height: 18px; }
  .ear i { width: 3px; height: 30%; border-radius: 2px; background: var(--text); animation: ear 1.1s ease-in-out infinite; }
  .ear i:nth-child(2) { animation-delay: -.3s; } .ear i:nth-child(3) { animation-delay: -.6s; } .ear i:nth-child(4) { animation-delay: -.15s; }
  @keyframes ear { 50% { height: 100%; } }

  /* A song without words: the cover takes the room. */
  .scene.solo { grid-template-columns: minmax(0, 1fr); justify-items: center; text-align: center; }
  .solo .about { justify-items: center; gap: 34px; }
  .solo .art { width: min(46vh, 40vw, 460px); }
  .solo .who { justify-items: center; }
  .solo .name { font-size: clamp(28px, 3vw, 48px); }
  .solo .state { justify-content: center; }
  .listen { margin-top: 16px; gap: 8px; }
  .solo .listen { justify-self: center; margin-inline: auto; display: flex; }
  .solo .around { justify-items: center; }

  /* ---- the words ---- */
  .words {
    position: relative; height: 100%; min-height: 0; overflow: hidden;
    mask-image: linear-gradient(180deg, transparent, #000 14%, #000 78%, transparent);
  }
  .lines { list-style: none; margin: 0; padding: 0; max-width: 21em; font-size: clamp(28px, 2.1vw + 12px, 56px); }
  .line {
    transform-origin: 0 50%; will-change: transform;
    transition: transform .8s var(--ease), opacity .6s var(--ease), filter .6s var(--ease);
  }
  .line button {
    display: block; width: 100%; margin: 0; padding: .16em .3em; margin-left: -.3em; border: none; border-radius: 14px; background: none;
    font: inherit; font-weight: 800; line-height: 1.16; letter-spacing: -.028em; color: var(--text); text-align: left; text-wrap: pretty;
    cursor: pointer; transition: background .2s;
  }
  .line:not(.now) button:hover { background: rgba(255, 255, 255, .06); }
  .line button:focus-visible { outline: none; box-shadow: inset 0 0 0 2px rgba(255, 255, 255, .55); }
  .word {
    display: inline-block; opacity: calc(.36 + .64 * var(--f));
    transform: translateY(calc(var(--f) * -.04em));
  }
  .paused .line.now { opacity: .62 !important; }
  .dots { display: inline-flex; gap: .32em; padding: .28em 0; }
  .dots i {
    width: .34em; height: .34em; border-radius: 50%; background: var(--text);
    opacity: calc(.24 + .76 * var(--f)); transform: scale(calc(.72 + .38 * var(--f)));
  }
  .now .dots { animation: hum 2.4s ease-in-out infinite; }
  @keyframes hum { 50% { transform: scale(1.08); } }

  .plain {
    overflow-y: auto; padding: 18vh 0 24vh; white-space: pre-line; max-width: 26em;
    font-size: clamp(22px, 1.4vw + 10px, 34px); line-height: 1.42; font-weight: 700; letter-spacing: -.02em; color: rgba(255, 255, 255, .88);
    scrollbar-width: none;
  }
  .plain::-webkit-scrollbar { display: none; }

  /* ---- smaller windows: the song sits above its words ---- */
  @media (max-width: 1100px) {
    .scene:not(.solo) { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); align-items: stretch; row-gap: 24px; }
    .scene:not(.solo) .about { grid-template-columns: 96px minmax(0, 1fr); align-items: center; gap: 20px; }
    .scene:not(.solo) .around { margin-top: 6px; }
    .scene:not(.solo) .name { font-size: 26px; -webkit-line-clamp: 2; }
  }
  @media (max-width: 760px) {
    .stage { --pad: 20px; --below: calc(84px + var(--safe-b)); }
    .exit { right: 10px; top: calc(10px + var(--safe-t)); }
    .scene { padding-top: calc(22px + var(--safe-t)); }
    .scene:not(.solo) .about { grid-template-columns: 56px minmax(0, 1fr); gap: 14px; padding-right: 44px; }
    .scene:not(.solo) .name { font-size: 19px; }
    .scene:not(.solo) .by { font-size: 14px; }
    .scene:not(.solo) .around { display: none; }
    .lines { font-size: clamp(25px, 7.4vw, 34px); }
    .solo .art { width: min(72vw, 40vh); }
  }

  @media (prefers-reduced-motion: reduce) {
    .drift canvas, .art.playing, .now .dots, .ear i { animation: none; }
    .line { transition: opacity .3s, filter .3s; }
  }
</style>

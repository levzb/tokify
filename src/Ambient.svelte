<script module>
  import { lib, ui, playlistById, tracksOf, allSongs } from './state.svelte.js';
  import { player } from './player.svelte.js';
  const firstCover = (list) => list.find((t) => t.cover && t.status === 'ok') || null;
  import { search, heroOf } from './search.svelte.js';
  import { stage } from './stage.svelte.js';
  // The cover lighting the room right now; panels without a cover of their own borrow it.
  // A search preview lights everything with its cover; in the search room the hit in the big slot does.
  export function roomLight() {
    // On the stage the room belongs to the song that is playing.
    if (stage.open && lib.tracks[player.trackId]?.cover) return lib.tracks[player.trackId];
    if (search.prev.url && search.prev.cover) return { cover: search.prev.cover };
    if (search.open && ui.route.name === 'home') { const art = heroOf()?.art; if (art) return { cover: art }; }
    const pl = ui.route.name === 'playlist' ? playlistById(ui.route.id) : null;
    if (pl) {
      if (pl.cover) return { cover: pl.cover, color: firstCover(tracksOf(pl))?.color };
      const own = firstCover(tracksOf(pl));
      if (own) return own;
    }
    const now = lib.tracks[player.trackId];
    if (now?.cover) return now;
    return firstCover(allSongs());
  }
</script>

<script>
  // Content is the colour: the page backdrop is a heavily blurred copy of a cover. An open playlist
  // lights the room with its own cover; elsewhere the playing song does, else the library's first.
  //
  // The blur is baked once into a small canvas and only scaled up by the GPU. A CSS filter here was
  // re-rasterised piece by piece whenever something on top repainted (hover), and each piece clipped
  // the blur at its own edges, leaving light and dark squares behind.
  import { fade } from 'svelte/transition';
  import { blurred, SIZE } from './blur.js';

  const source = $derived.by(roomLight);
  const src = $derived(source?.cover || '');
  const color = $derived(source?.color || '#3a3f55');

  // A light cover gets an extra shade, so white type stays readable on the bare page.
  function luminance(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 0.2;
    const n = parseInt(m[1], 16), ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  const shade = $derived(Math.min(0.45, Math.max(0, luminance(color) - 0.12) * 0.9));

</script>

<div class="ambient" aria-hidden="true">
  {#key src}
    <div class="light" style="--c:{color}" in:fade={{ duration: 900 }} out:fade={{ duration: 900 }}>
      {#if src}<canvas width={SIZE} height={SIZE} use:blurred={src}></canvas>{/if}
    </div>
  {/key}
  <div class="shade" style="opacity:{shade}"></div>
  <div class="veil"></div>
</div>

<style>
  /* Its own compositor layer: nothing painted on top can invalidate it. */
  .ambient {
    position: fixed; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; background: var(--ground);
    contain: strict; will-change: transform; transform: translateZ(0);
  }
  .light {
    position: absolute; inset: 0;
    background:
      radial-gradient(70% 60% at 25% 15%, color-mix(in srgb, var(--c) 55%, transparent), transparent 70%),
      radial-gradient(60% 60% at 85% 90%, color-mix(in srgb, var(--c) 35%, transparent), transparent 70%);
    opacity: var(--ambient-strength);
  }
  .light canvas {
    position: absolute; left: 50%; top: 45%; width: 130vmax; height: 130vmax;
    transform: translate(-50%, -50%); opacity: 0; transition: opacity .6s ease;
  }
  .light :global(canvas.ready) { opacity: 1; }
  /* A device that cannot keep up (perf.svelte.js) keeps the cover's colour glow without the scaled-up cover:
     stretching it across the window every frame is what such a device struggles with. */
  :global(:root.lite) .light canvas { display: none; }
  .shade { position: absolute; inset: 0; background: #000; transition: opacity .9s ease; }
  .veil { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(7, 7, 8, .28), rgba(7, 7, 8, .42) 55%, rgba(7, 7, 8, .62)); }
  /* Matte grain: frosted glass rather than tinted plastic. */
  .veil::after {
    content: ''; position: absolute; inset: 0; opacity: .035;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  }
</style>

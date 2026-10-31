<script>
  // Progress / volume slider. Drag with mouse or finger; commits on release.
  let { value = 0, max = 1, onCommit, onLive = null, label = '', thin = false } = $props();
  let el = $state();
  let dragging = $state(false);
  let local = $state(0);
  const shown = $derived(dragging ? local : value);
  const pct = $derived(max > 0 ? Math.max(0, Math.min(100, (shown / max) * 100)) : 0);

  function at(e) { const r = el.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * max; }
  function down(e) {
    if (!max) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    dragging = true; local = at(e); onLive?.(local);
  }
  function move(e) { if (dragging) { local = at(e); onLive?.(local); } }
  function up(e) { if (!dragging) return; dragging = false; onCommit?.(at(e)); }
  function key(e) {
    const step = max / 20;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); onCommit?.(Math.min(max, value + step)); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); onCommit?.(Math.max(0, value - step)); }
  }
</script>

<div class="scrub" class:dragging class:thin bind:this={el} role="slider" tabindex="0" aria-label={label}
  aria-valuemin="0" aria-valuemax={Math.round(max)} aria-valuenow={Math.round(shown)}
  onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onkeydown={key}>
  <div class="track"><div class="fill" style="width:{pct}%"></div></div>
  <div class="thumb" style="left:{pct}%"></div>
</div>

<style>
  .scrub { position: relative; height: 20px; display: flex; align-items: center; cursor: pointer; touch-action: none; flex: 1; min-width: 0; }
  .track { position: relative; width: 100%; height: 4px; border-radius: 99px; background: rgba(255,255,255,.14); overflow: hidden; transition: transform .15s; }
  .fill { height: 100%; background: #fff; border-radius: 99px; }
  .thumb {
    position: absolute; top: 50%; width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 50%; background: #fff;
    box-shadow: 0 2px 8px rgba(0,0,0,.5); transform: scale(0); transition: transform .15s var(--ease);
  }
  .scrub:hover .thumb, .scrub.dragging .thumb, .scrub:focus-visible .thumb { transform: scale(1); }
  .scrub:hover .track, .scrub.dragging .track { transform: scaleY(1.3); }
  .scrub:focus-visible { outline: none; }
  .scrub.thin { height: 14px; }
  .thin .track { height: 3px; }
  @media (hover: none) { .thumb { transform: scale(1); } }
</style>

<script>
  // A setting slider, across or upright (the equaliser). Drag, tap anywhere on it, or use the arrow keys
  // (Page Up/Down for big steps, Home/End for the ends). Double-click puts it back on `reset`.
  // With a `center` it is two-sided: the fill grows from that value, and a drag clicks into it when close.
  // Changes are reported live through `onchange`; set from outside (a preset) the knob glides there.
  let { value, min = 0, max = 1, step = 0.01, center = null, reset = center ?? min, marks = [], label = '', valuetext = '',
    vertical = false, onchange } = $props();
  let el = $state();
  let dragging = $state(false);

  const span = $derived(max - min);
  const frac = (v) => (Math.min(max, Math.max(min, v)) - min) / span;
  const p = $derived(frac(value) * 100);
  const c = $derived(center == null ? 0 : frac(center) * 100);
  const snap = (v) => +(Math.min(max, Math.max(min, Math.round(v / step) * step))).toFixed(4);

  function at(e) {
    const r = el.getBoundingClientRect();
    const f = vertical ? (r.bottom - e.clientY) / r.height : (e.clientX - r.left) / r.width;
    const v = min + Math.min(1, Math.max(0, f)) * span;
    return snap(center != null && Math.abs(v - center) <= span * 0.03 ? center : v);
  }
  function down(e) {
    if (e.button) return;
    e.preventDefault();
    el.focus({ preventScroll: true });
    el.setPointerCapture(e.pointerId);
    dragging = true;
    onchange(at(e));
  }
  function move(e) { if (dragging) onchange(at(e)); }
  function up() { dragging = false; }
  function key(e) {
    const big = span / 10;
    const by = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: big, PageDown: -big }[e.key];
    const v = by != null ? value + by : e.key === 'Home' ? min : e.key === 'End' ? max : null;
    if (v == null) return;
    e.preventDefault();
    onchange(snap(v));
  }
</script>

<div bind:this={el} class="fader" class:vertical class:dragging role="slider" tabindex="0"
  aria-label={label} aria-orientation={vertical ? 'vertical' : 'horizontal'}
  aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={valuetext || null}
  style="--p:{p}%; --lo:{Math.min(p, c)}%; --hi:{Math.max(p, c)}%"
  onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onkeydown={key}
  ondblclick={() => onchange(reset)}>
  <span class="rail">
    {#each marks as m (m)}<i class="mark" style="--m:{frac(m) * 100}%"></i>{/each}
    <span class="fill"></span>
  </span>
  <span class="knob"></span>
</div>

<style>
  .fader {
    position: relative; display: flex; align-items: center; height: 28px; cursor: pointer; outline: none;
    touch-action: pan-y; -webkit-tap-highlight-color: transparent;
  }
  .rail { position: relative; flex: 1; height: 4px; border-radius: 99px; background: rgba(255, 255, 255, .14); }
  .fill {
    position: absolute; top: 0; bottom: 0; left: var(--lo); right: calc(100% - var(--hi)); border-radius: inherit;
    background: var(--text); transition: left .45s var(--ease), right .45s var(--ease);
  }
  .mark { position: absolute; left: var(--m); top: 50%; width: 2px; height: 10px; margin: -5px 0 0 -1px; border-radius: 1px; background: rgba(255, 255, 255, .22); }
  .knob {
    position: absolute; left: var(--p); top: 50%; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%;
    background: #fff; box-shadow: 0 2px 8px rgba(0, 0, 0, .45);
    transition: left .45s var(--ease), bottom .45s var(--ease), transform .18s var(--ease), box-shadow .18s;
  }
  /* Following the finger: no glide. */
  .dragging .fill, .dragging .knob { transition: transform .18s var(--ease), box-shadow .18s; }
  .fader:hover .knob, .dragging .knob { transform: scale(1.15); }
  .fader:focus-visible .knob { box-shadow: 0 0 0 5px rgba(255, 255, 255, .22), 0 2px 8px rgba(0, 0, 0, .45); }

  .vertical { flex-direction: column; justify-content: center; width: 28px; height: 100%; touch-action: none; }
  .vertical .rail { flex: none; width: 4px; height: 100%; }
  .vertical .fill { left: 0; right: 0; top: calc(100% - var(--hi)); bottom: var(--lo); transition: top .45s var(--ease), bottom .45s var(--ease); }
  .vertical .mark { left: 50%; top: auto; bottom: var(--m); width: 10px; height: 2px; margin: 0 0 -1px -5px; }
  .vertical .knob { left: 50%; top: auto; bottom: var(--p); margin: 0 0 -9px -9px; }
  .vertical.dragging .fill { transition: none; }

  @media (prefers-reduced-motion: reduce) { .fill, .knob, .vertical .fill { transition: none; } }
</style>

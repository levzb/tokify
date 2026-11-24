<script>
  // One tooltip for every icon action: buttons speak in icons, this names them on hover (and shows a key
  // when the button has one). It reads the button's own label, so nothing is written twice.
  // The rail keeps its own side tooltips. Touch screens never see it.
  import { onMount } from 'svelte';

  const PICK = '[data-tip], .icon-btn[aria-label], .btn.icon[aria-label], .pp[aria-label]';
  const KEYS = { Space: 'Space', '[': '[', ']': ']', f: 'F' };
  let tip = $state(null), el = null, timer = 0;

  function hide() { clearTimeout(timer); tip = null; }
  function show() {
    if (!el?.isConnected) return;
    const text = el.dataset.tip || el.getAttribute('aria-label');
    if (!text) return;
    const r = el.getBoundingClientRect();
    const below = r.top < 52;
    const key = (el.getAttribute('aria-keyshortcuts') || '').split(' ').map((k) => KEYS[k] || '').filter(Boolean)[0] || '';
    tip = { text, key, below, x: Math.min(innerWidth - 12, Math.max(12, r.left + r.width / 2)), y: below ? r.bottom + 8 : r.top - 8 };
  }
  function over(e) {
    const hit = e.target.closest?.(PICK);
    if (hit === el) return;
    const warm = !!tip; // moving between buttons: the next name shows at once
    hide(); el = hit && !hit.closest('.rail') ? hit : null;
    if (el) timer = setTimeout(show, warm ? 0 : 450);
  }
  onMount(() => {
    if (!matchMedia('(hover: hover)').matches) return;
    const gone = () => { hide(); };
    addEventListener('pointerover', over, true);
    addEventListener('pointerdown', gone, true);
    addEventListener('scroll', gone, true);
    addEventListener('keydown', gone, true);
    return () => {
      removeEventListener('pointerover', over, true);
      removeEventListener('pointerdown', gone, true);
      removeEventListener('scroll', gone, true);
      removeEventListener('keydown', gone, true);
    };
  });
  // A label that changes under the pointer (play → pause) updates in place.
  $effect(() => {
    if (!tip || !el) return;
    const mo = new MutationObserver(() => { if (tip) tip = { ...tip, text: el.dataset.tip || el.getAttribute('aria-label') || tip.text }; });
    mo.observe(el, { attributes: true, attributeFilter: ['aria-label', 'data-tip'] });
    return () => mo.disconnect();
  });
</script>

{#if tip}
  <div class="tooltip frost" class:below={tip.below} style="left:{tip.x}px; top:{tip.y}px" role="tooltip">
    <span>{tip.text}</span>{#if tip.key}<kbd>{tip.key}</kbd>{/if}
  </div>
{/if}

<style>
  .tooltip {
    position: fixed; z-index: 1000; display: flex; align-items: center; gap: 8px; max-width: 260px;
    padding: 6px 10px; border-radius: var(--r-control); pointer-events: none;
    font-size: 13px; font-weight: 500; line-height: 1.3; color: var(--text); white-space: nowrap;
    translate: -50% -100%; animation: tipIn .14s var(--ease) both;
  }
  .tooltip.below { translate: -50% 0; }
  span { overflow: hidden; text-overflow: ellipsis; }
  kbd {
    font: inherit; font-size: 12px; color: var(--muted); padding: 1px 6px; border-radius: 5px;
    background: var(--fill-2);
  }
  @keyframes tipIn { from { opacity: 0; transform: translateY(3px); } }
  .below { animation-name: tipInDown; }
  @keyframes tipInDown { from { opacity: 0; transform: translateY(-3px); } }
</style>

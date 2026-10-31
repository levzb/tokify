<script>
  import { icons } from '../lib/icons.js';
  let { name, size = 20, stroke = 2 } = $props();
</script>

<svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" stroke-width={stroke}
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html icons[name] || ''}</svg>

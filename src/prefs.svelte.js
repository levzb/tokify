// The listener's own settings (Settings.svelte), remembered per browser in `tokify.prefs`. Everything here is
// applied live: App.svelte turns the look into the `:root` values the whole interface already reads.
const KEY = 'tokify.prefs';

/** Accent: the play button, progress, switches that are on and every check. */
export const ACCENTS = [
  { id: 'white', name: 'White', hex: '#ffffff' },
  { id: 'mint', name: 'Mint', hex: '#a6f0cf' },
  { id: 'sky', name: 'Sky', hex: '#a9d8ff' },
  { id: 'lilac', name: 'Lilac', hex: '#cdbdff' },
  { id: 'rose', name: 'Rose', hex: '#ffb8cb' },
  { id: 'amber', name: 'Amber', hex: '#ffd796' },
  { id: 'cover', name: 'From the cover' },
  { id: 'custom', name: 'Your colour' },
];
/** Ranges of the sliders. Glass: how dark the islands are (tint) and how much they blur what is behind (frost). */
export const RANGE = {
  light: { min: 0.15, max: 1 },
  tint: { min: 0.1, max: 0.92 },
  frost: { min: 0, max: 48 },
  corners: { min: 0, max: 1.8 },
};

const LOOK = { accent: 'white', custom: '#ff8a5c', light: 1, tint: 0.5, frost: 24, corners: 1 };
const DEFAULTS = { ...LOOK, xfade: 1.5 };
const OLD_GLASS = { clear: [0.3, 10], frosted: [0.5, 24], solid: [0.84, 24] };

const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } })();
const num = (v, r, d) => (Number.isFinite(v) ? Math.min(r.max, Math.max(r.min, v)) : d);
const clean = (v) => {
  if (OLD_GLASS[v.glass] && v.tint == null) [v.tint, v.frost] = OLD_GLASS[v.glass];
  return {
    accent: ACCENTS.some((a) => a.id === v.accent) ? v.accent : DEFAULTS.accent,
    custom: /^#[0-9a-f]{6}$/i.test(v.custom || '') ? v.custom : DEFAULTS.custom,
    light: num(v.light, RANGE.light, DEFAULTS.light),
    tint: num(v.tint, RANGE.tint, DEFAULTS.tint),
    frost: num(v.frost, RANGE.frost, DEFAULTS.frost),
    corners: num(v.corners, RANGE.corners, DEFAULTS.corners),
    xfade: Number.isFinite(v.xfade) ? Math.min(12, Math.max(0.5, v.xfade)) : DEFAULTS.xfade,
  };
};

export const prefs = $state(clean(saved));

export function setPref(key, value) {
  prefs[key] = value;
  try { localStorage.setItem(KEY, JSON.stringify($state.snapshot(prefs))); } catch {}
}
export const lookChanged = () => Object.keys(LOOK).some((k) => k !== 'custom' && prefs[k] !== LOOK[k]);
export const lookNow = () => Object.fromEntries(Object.keys(LOOK).map((k) => [k, prefs[k]]));
export function setLook(v) { for (const k of Object.keys(LOOK)) if (k in v) setPref(k, v[k]); }
export function resetLook() { setLook({ ...LOOK, custom: prefs.custom }); }

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; })
    .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
}
/** A cover's colour as an accent: lifted towards white so a black glyph on it stays readable on any cover. */
export const coverTint = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? `color-mix(in oklab, ${c} 52%, #fff)` : '#ffffff');
export function accentCss(coverColor) {
  if (prefs.accent === 'cover') return coverTint(coverColor);
  if (prefs.accent === 'custom') return prefs.custom;
  return ACCENTS.find((a) => a.id === prefs.accent)?.hex || '#ffffff';
}
/** The glyph on the accent (the play triangle): black, or white on a dark colour of your own. */
export const onAccent = () => (prefs.accent === 'custom' && luminance(prefs.custom) < 0.36 ? '#ffffff' : '#000000');

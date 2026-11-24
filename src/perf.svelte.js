// Lighter effects, for slower computers and older phones: a setting (Settings → Look), never switched by
// itself. `html.lite` carries it: the blurred cover light stands still or gives way to its colour glow, and the
// softening blurs become plain fades. While the stage is open or the page scrolls, Tokify still counts frames;
// if this device clearly struggles it offers the setting once, and Settings says what it measured.
import { toast } from './state.svelte.js';

const KEY = 'tokify.lite', ASKED = 'tokify.lite-offered';
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

export const perf = $state({ lite: typeof window !== 'undefined' && read(KEY) === '1', fps: 0 });

export function setLite(on) {
  perf.lite = !!on;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch {}
}

let gaps = [], raf = 0, last = 0, until = 0, holds = 0;
const SLOW = 25; // ms between frames: 40 fps

function judge() {
  const s = gaps.sort((a, b) => a - b);
  const typical = s[Math.floor(s.length * 0.6)];
  gaps = [];
  perf.fps = Math.round(1000 / typical);
  if (typical > SLOW && !perf.lite && !read(ASKED)) {
    try { localStorage.setItem(ASKED, '1'); } catch {}
    toast('Tokify is running slowly here', { action: 'Lighten', onAction: () => setLite(true) });
  }
}
function tick(t) {
  // A pause longer than a quarter second is the tab being hidden or the machine busy elsewhere, not slowness.
  if (last && t - last < 250) gaps.push(t - last);
  last = t;
  if (gaps.length >= 90) judge();
  if (perf.lite || (!holds && performance.now() > until)) { raf = 0; last = 0; return; }
  raf = requestAnimationFrame(tick);
}
function run() { if (!raf && !perf.lite && typeof requestAnimationFrame !== 'undefined') raf = requestAnimationFrame(tick); }

/** Count frames while something keeps moving (the stage is open). Returns a stop function. */
export function watchFrames() {
  holds++; run();
  return () => { holds = Math.max(0, holds - 1); };
}
/** Count frames for a moment (a scroll tick). */
export function glance(ms = 700) { until = Math.max(until, performance.now() + ms); run(); }

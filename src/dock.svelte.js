// Movable islands: the rail docks left or right, the player bottom or top.
// Drag either one by its grip or any empty part of it; it follows the pointer, the slot it will land in
// lights up, and on release it glides into place. Clicking the grip flips it to the other side.
// The choice is remembered per browser. Phones keep their own fixed layout.
import { tick } from 'svelte';

const KEY = 'tokify.layout';
const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } })();

export const layout = $state({
  rail: saved.rail === 'right' ? 'right' : 'left',
  player: saved.player === 'top' ? 'top' : 'bottom',
});
// The slot being aimed at while dragging: { left, top, width, height } in viewport pixels.
export const aim = $state({ slot: null });

const SIDES = { rail: ['left', 'right'], player: ['bottom', 'top'] };
const other = (what) => SIDES[what].find((s) => s !== layout[what]);
const ease = 'cubic-bezier(.22, 1, .36, 1)';
const desktop = () => !matchMedia('(max-width: 760px)').matches;

function save() { try { localStorage.setItem(KEY, JSON.stringify(layout)); } catch {} }

// Where each island would sit on a given side, measured from the live shell.
function slotFor(what, side) {
  const shell = document.querySelector('.shell'), main = document.querySelector('.main-scroll');
  if (!shell || !main) return null;
  const s = shell.getBoundingClientRect(), gap = parseFloat(getComputedStyle(shell).paddingTop) || 8;
  if (what === 'rail') {
    const w = document.querySelector('.rail')?.offsetWidth || 64;
    return { left: side === 'left' ? s.left + gap : s.right - gap - w, top: s.top + gap, width: w, height: s.height - 2 * gap };
  }
  const m = main.getBoundingClientRect(), h = document.querySelector('.bar')?.offsetHeight || 72;
  return { left: m.left, top: side === 'top' ? m.top : m.bottom - h, width: m.width, height: h };
}

// Moves an island and lets everything that shifts glide there instead of jumping.
export async function place(what, side) {
  if (layout[what] === side) return;
  const nodes = [...document.querySelectorAll('.rail, .bar, .main-scroll')];
  const before = nodes.map((n) => n.getBoundingClientRect());
  layout[what] = side;
  save();
  await tick();
  nodes.forEach((n, i) => {
    n.style.translate = '';
    const a = n.getBoundingClientRect(), b = before[i];
    const dx = b.left - a.left, dy = b.top - a.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    n.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], { duration: 420, easing: ease });
  });
}

export const flip = (what) => place(what, other(what));
export const nextSide = other;

// use:movable={'rail'} or use:movable={'player'}
export function movable(node, what) {
  let start = null, dragging = false, side = null, eatClick = false;

  function down(e) {
    if (e.button !== 0 || !desktop()) return;
    const t = e.target;
    if (!t.closest('.grip') && t.closest('button, a, input, select, textarea, [role="slider"], .scrub, .vol, .list .item')) return;
    if (!t.closest('button')) e.preventDefault(); // no text selection while dragging
    start = { x: e.clientX, y: e.clientY };
    dragging = false;
    // The pointer leaves the island at once, so follow it on the window.
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  }
  function move(e) {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!dragging) {
      if (Math.hypot(dx, dy) < 6) return;
      dragging = true;
      node.classList.add('lifted');
      document.documentElement.classList.add('docking');
    }
    node.style.translate = `${dx}px ${dy}px`;
    side = what === 'rail'
      ? (e.clientX < innerWidth / 2 ? 'left' : 'right')
      : (e.clientY < innerHeight / 2 ? 'top' : 'bottom');
    aim.slot = slotFor(what, side);
  }
  async function up() {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', up);
    if (!start) return;
    start = null;
    if (!dragging) return;
    dragging = false;
    eatClick = true;
    setTimeout(() => (eatClick = false), 0);
    node.classList.remove('lifted');
    document.documentElement.classList.remove('docking');
    aim.slot = null;
    if (side && side !== layout[what]) { await place(what, side); return; }
    // Same side: glide back home.
    const [x, y] = (node.style.translate || '0px 0px').split(' ').map(parseFloat);
    node.style.translate = '';
    node.animate([{ translate: `${x || 0}px ${y || 0}px` }, { translate: '0 0' }], { duration: 320, easing: ease });
  }
  function click(e) { if (eatClick) { e.stopPropagation(); e.preventDefault(); eatClick = false; } }

  node.addEventListener('pointerdown', down);
  node.addEventListener('click', click, true);
  return {
    destroy() {
      node.removeEventListener('pointerdown', down);
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      node.removeEventListener('click', click, true);
    },
  };
}

// One panel for everything that used to open in a dialog. It docks on the free side of the screen
// (opposite the rail) and the page makes room for it. Opening something while it is open swaps the
// content; a dialog (`stack`) sits over the current content until it is answered.
// One width for every panel, so swapping what is inside never moves its edge or the page.
export const SHEET_W = 440;
export const sheets = $state({ list: [] }); // [{ id, art, stack, close }]
let sheetSeq = 0;
export function openSheet({ art = '', stack = false, close }) {
  const id = ++sheetSeq;
  sheets.list.push({ id, art, stack, close });
  // Let the current flush settle first: a flow that swaps its own step has already let go of the old one.
  if (!stack) setTimeout(() => {
    for (const s of sheets.list) if (s.id < id && !s.stack) s.close?.();
  });
  return sheets.list.at(-1);
}
export function closeSheet(id) {
  if (sheets.list.some((s) => s.id === id)) sheets.list = sheets.list.filter((s) => s.id !== id);
}
// Reopened while it was still leaving: Svelte brings the same one back, so it takes its place again.
export function reopenSheet(entry) {
  if (!sheets.list.some((s) => s.id === entry.id)) sheets.list.push(entry);
}
export const topSheet = () => sheets.list.at(-1)?.id;

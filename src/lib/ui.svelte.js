// Global UI state: route, toasts, context menu, dialogs.
export const ui = $state({
  route: { name: 'home', id: null },
  toast: null,
  menu: null,          // { x, y, items, sheet }
  dialog: null,        // { kind, title, text, value, confirm, danger, resolve }
  queueOpen: false,
  nowPlayingOpen: false,
  importJob: null,     // { jobId, playlistId, name }
  importOpen: false,
  importSource: null,
  fileImportSource: null,
  fileImportOpen: false,
  filesBusy: false,
  downloadOpen: false,
  downloadSource: null,
  clipTrackId: null,
  libraryView: 'imports',
  search: '',
});

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, id] = h.split('/');
  if (name === 'p' && id) return { name: 'playlist', id: decodeURIComponent(id) };
  return { name: 'home', id: null };
}
ui.route = parseHash();
addEventListener('hashchange', () => {
  ui.route = parseHash();
  ui.menu = null;
  document.querySelector('.main-scroll')?.scrollTo({ top: 0 });
});

export const go = (name, id) => { location.hash = name === 'playlist' ? `#/p/${encodeURIComponent(id)}` : '#/'; };

let toastTimer;
export function toast(text, { action, onAction, ms = 2600 } = {}) {
  clearTimeout(toastTimer);
  ui.toast = { text, action, onAction, key: Math.random() };
  toastTimer = setTimeout(() => { ui.toast = null; }, action ? 5000 : ms);
}

export function openMenu(e, items, { anchor } = {}) {
  const coarse = matchMedia('(max-width: 760px), (pointer: coarse)').matches;
  let x = 0, y = 0;
  if (anchor) { const r = anchor.getBoundingClientRect(); x = r.right; y = r.bottom + 6; }
  else if (e) { x = e.clientX; y = e.clientY; }
  ui.menu = { x, y, items, sheet: coarse, key: Math.random() };
}

export function ask(opts) {
  return new Promise((resolve) => { ui.dialog = { ...opts, resolve }; });
}

export function pickImage() {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = () => resolve(inp.files?.[0] || null);
    inp.click();
  });
}

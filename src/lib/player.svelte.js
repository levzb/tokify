// Playback engine. One <audio> element plays one continuous server-rendered stream per session;
// transitions are baked into the stream, so nothing depends on JS running while the phone is locked.
// Next/previous are seeks inside the stream. Queue edits start a new session at the current position.
import { buildTimeline, planPos, streamTime, entryAt, SR } from '../../shared/timeline.js';
import { lib, playlistById, playable, allSongs, patchPlaylist } from './library.svelte.js';
import { api } from './api.js';
import { toast } from './ui.svelte.js';
import { artistName } from './format.js';

const KEY = 'tokify.player.v1';
const store = {
  get() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } },
  set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} },
};

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const player = $state({
  trackId: null,
  contextId: null,
  playing: false,
  loading: false,
  pos: 0,
  dur: 0,
  repeat: 'off',      // off | all | one
  volume: 1,
  muted: false,
  canVolume: !isIOS,  // iOS ignores audio.volume; the hardware buttons own volume there
  queue: [],          // user queue: [{ key, id }]
  upNext: [],         // context tracks coming after (for the queue panel)
  allShuffle: false,
  allTransition: 'crossfade',
});

let audio = null;
let ctx = { id: null, order: [], index: -1 };
let session = null;
let curIdx = -1;
let curRef = null;
let restoredPos = 0;
let retried = false;

const uuid = () => {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const qkey = () => Math.random().toString(36).slice(2);
const shuffled = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------- context helpers ----------
export const contextName = (cid) => (cid === 'all' ? 'All songs' : playlistById(cid)?.name || '');
export const shuffleOf = (cid) => (cid === 'all' ? player.allShuffle : !!playlistById(cid)?.shuffle);
export const transitionOf = (cid) => (cid === 'all' ? player.allTransition : playlistById(cid)?.transition || 'crossfade');
function contextIds(cid) {
  if (cid === 'all') return allSongs().filter(playable).map((t) => t.id);
  if (cid === 'queue' || !cid) return ctx.order.filter((id) => playable(lib.tracks[id]));
  const pl = playlistById(cid);
  return pl ? pl.trackIds.filter((id) => playable(lib.tracks[id])) : [];
}

// ---------- session ----------
function buildItems(firstId, offset) {
  const items = [{ id: firstId, offset, ref: curRef }];
  const sam = (id) => lib.tracks[id]?.samples || 0;
  let total = sam(firstId) - offset;
  const cycles = [ctx.order];
  if (player.repeat === 'one') {
    while (total < SR * 3600 * 2 && items.length < 400) { items.push({ id: firstId, ref: curRef }); total += sam(firstId); }
    return { items, cycles };
  }
  for (const q of player.queue) if (playable(lib.tracks[q.id])) { items.push({ id: q.id, ref: { t: 'q', key: q.key } }); total += sam(q.id); }
  const start = curRef?.t === 'c' ? ctx.index + 1 : ctx.index + 1;
  for (let i = Math.max(0, start); i < ctx.order.length; i++) { items.push({ id: ctx.order[i], ref: { t: 'c', i, cycle: 0 } }); total += sam(ctx.order[i]); }
  if (player.repeat === 'all' && ctx.order.length) {
    let k = 1;
    while (total < SR * 3600 * 4 && items.length < 1500) {
      const order = shuffleOf(ctx.id) ? shuffled(ctx.order) : ctx.order;
      cycles[k] = order;
      order.forEach((id, i) => { items.push({ id, ref: { t: 'c', i, cycle: k } }); total += sam(id); });
      k++;
    }
  }
  return { items, cycles };
}

function startSession(firstId, offset = 0, autoplay = true) {
  const t = lib.tracks[firstId];
  if (!playable(t)) return;
  const { items, cycles } = buildItems(firstId, Math.max(0, Math.round(offset)));
  const plan = items.filter((it) => playable(lib.tracks[it.id])).map((it) => ({ ...it, samples: lib.tracks[it.id].samples }));
  const mode = transitionOf(ctx.id);
  const tl = buildTimeline(plan, mode);
  const id = uuid();
  session = { id, tl, entries: tl.entries, cycles, sig: signature(tl.entries, 0, mode) };
  curIdx = -1;
  retried = false;
  ensureAudio();
  // Set the source and call play() synchronously so iOS counts it as part of the tap.
  audio.src = `/stream/${id}.mp3`;
  api('/api/sessions', { method: 'POST', body: { id, mode, items: plan.map((p) => ({ id: p.id, offset: p.offset || 0 })) } })
    .catch((e) => toast(e.message));
  if (autoplay) {
    player.loading = true;
    audio.play().catch((e) => { player.loading = false; if (e.name !== 'AbortError') toast('Tap play again — the browser blocked autoplay'); });
  }
  setEntry(0);
}

const signature = (entries, from, mode) => mode + '|' + entries.slice(from, from + 80).map((e) => e.id).join(',');

let rebuildTimer = null;
function scheduleRebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(rebuild, 350);
}
function rebuild() {
  if (!session || !player.trackId) { computeUpNext(); return; }
  const e = session.entries[curIdx];
  if (!e) return;
  const offset = Math.max(0, Math.round(player.pos * SR));
  const { items } = buildItems(player.trackId, 0);
  const plan = items.filter((it) => playable(lib.tracks[it.id])).map((it) => ({ ...it, samples: lib.tracks[it.id].samples }));
  const mode = transitionOf(ctx.id);
  const next = signature(buildTimeline(plan, mode).entries, 0, mode);
  const now = signature(session.entries, curIdx, session.tl.mode);
  if (next === now) { computeUpNext(); return; } // nothing ahead changed: keep the stream
  startSession(player.trackId, offset, player.playing);
}

function setEntry(i) {
  if (!session) return;
  const e = session.entries[i];
  if (!e) return;
  const changed = curIdx !== i;
  curIdx = i;
  curRef = e.ref || curRef;
  if (curRef?.t === 'c') {
    if (curRef.cycle > 0 && session.cycles[curRef.cycle]) ctx.order = session.cycles[curRef.cycle];
    ctx.index = curRef.i;
  }
  // everything queued up to here has been played
  const consumed = new Set(session.entries.slice(0, i + 1).filter((x) => x.ref?.t === 'q').map((x) => x.ref.key));
  if (consumed.size) player.queue = player.queue.filter((q) => !consumed.has(q.key));
  player.trackId = e.id;
  player.dur = (lib.tracks[e.id]?.samples || e.len) / SR;
  if (changed) { updateMetadata(); computeUpNext(); persist(); }
}

function computeUpNext() {
  if (!ctx.order.length) { player.upNext = []; return; }
  const list = [];
  for (let i = ctx.index + 1; i < ctx.order.length && list.length < 60; i++) list.push(ctx.order[i]);
  if (player.repeat === 'all') for (let i = 0; i <= ctx.index && list.length < 60; i++) list.push(ctx.order[i]);
  player.upNext = list;
}

// ---------- time ----------
function onTime() {
  if (!session || !audio) return;
  const p = planPos(audio.currentTime);
  const i = entryAt(session.entries, p);
  if (i !== curIdx) setEntry(i);
  const e = session.entries[curIdx];
  if (!e) return;
  player.pos = Math.max(0, Math.min(player.dur, (p - e.start + e.srcOffset) / SR));
}

let raf = 0;
function loop() {
  onTime();
  raf = player.playing && document.visibilityState === 'visible' ? requestAnimationFrame(loop) : 0;
}

function seekPlan(p) {
  if (!audio) return;
  audio.currentTime = Math.max(0, streamTime(p));
  onTime();
  positionState();
}

// ---------- public controls ----------
export function playContext(cid, startId = null) {
  const ids = contextIds(cid);
  if (!ids.length) { toast('Nothing to play here yet'); return; }
  if (startId && !ids.includes(startId)) {
    const t = lib.tracks[startId];
    toast(t?.status === 'failed' ? 'This sound is unavailable' : 'Still downloading');
    return;
  }
  let order = ids, index = startId ? ids.indexOf(startId) : 0;
  if (shuffleOf(cid)) {
    const first = startId || ids[Math.floor(Math.random() * ids.length)];
    order = [first, ...shuffled(ids.filter((x) => x !== first))];
    index = 0;
  }
  ctx = { id: cid, order, index };
  player.contextId = cid;
  curRef = { t: 'c', i: index, cycle: 0 };
  startSession(order[index], 0, true);
}

export function toggle() {
  if (!player.trackId) return;
  if (!session) { startSession(player.trackId, restoredPos * SR, true); return; }
  if (audio.paused) {
    player.loading = true;
    audio.play().catch(() => { player.loading = false; });
  } else audio.pause();
}

export function next() {
  if (player.repeat === 'one' && ctx.order.length > 1) {
    ctx.index = (ctx.index + 1) % ctx.order.length;
    curRef = { t: 'c', i: ctx.index, cycle: 0 };
    return startSession(ctx.order[ctx.index], 0, player.playing || !audio?.paused);
  }
  if (!session) {
    if (ctx.order.length) { const i = Math.min(ctx.order.length - 1, ctx.index + 1); ctx.index = i; curRef = { t: 'c', i, cycle: 0 }; startSession(ctx.order[i], 0, true); }
    return;
  }
  if (curIdx + 1 < session.entries.length) seekPlan(session.entries[curIdx + 1].start);
  else if (player.repeat !== 'off' && ctx.order.length) {
    const index = player.repeat === 'one' ? ctx.index : 0;
    ctx.index = index;
    curRef = { t: 'c', i: index, cycle: 0 };
    startSession(ctx.order[index], 0, true);
  } else finish();
}

export function prev() {
  if (!session) return;
  const e = session.entries[curIdx];
  if (player.pos > 3 || !e) return seek(0);
  if (curIdx > 0) return seekPlan(session.entries[curIdx - 1].start);
  if (curRef?.t === 'c' && ctx.index > 0) {
    ctx.index -= 1;
    curRef = { t: 'c', i: ctx.index, cycle: 0 };
    return startSession(ctx.order[ctx.index], 0, player.playing || !audio.paused);
  }
  seek(0);
}

export function seek(sec) {
  if (!session) { restoredPos = sec; player.pos = sec; return; }
  const e = session.entries[curIdx];
  if (!e) return;
  const target = Math.round(sec * SR) - e.srcOffset;
  if (target < 0) { startSession(player.trackId, Math.round(sec * SR), player.playing); return; }
  seekPlan(e.start + Math.min(target, e.len - 1));
}

export function setRepeat(mode) {
  player.repeat = mode ?? (player.repeat === 'off' ? 'all' : player.repeat === 'all' ? 'one' : 'off');
  persist();
  scheduleRebuild();
}

/** Repeat a specific row using the same rendered transitions as any playlist. */
export function toggleTrackRepeat(cid, id) {
  if (!playable(lib.tracks[id])) return;
  const current = player.trackId === id && player.contextId === cid;
  if (current && player.repeat === 'one') { setRepeat('off'); return; }
  player.repeat = 'one';
  clearTimeout(rebuildTimer);
  if (current) startSession(id, Math.round(player.pos * SR), true);
  else playContext(cid, id);
  persist();
}

export function setVolume(v) {
  player.volume = Math.max(0, Math.min(1, v));
  player.muted = player.volume === 0;
  if (audio) audio.volume = player.volume;
  persist();
}
export function toggleMute() {
  if (player.muted || player.volume === 0) setVolume(player._lastVol || 0.8);
  else { player._lastVol = player.volume; setVolume(0); }
}

export async function setShuffle(cid, on) {
  if (cid === 'all') { player.allShuffle = on; persist(); }
  else await patchPlaylist(cid, { shuffle: on }).catch(() => {});
  if (ctx.id !== cid || !player.trackId) return;
  const ids = contextIds(cid);
  if (on) { ctx.order = [player.trackId, ...shuffled(ids.filter((x) => x !== player.trackId))]; ctx.index = 0; }
  else { ctx.order = ids; ctx.index = Math.max(0, ids.indexOf(player.trackId)); }
  if (curRef?.t === 'c') curRef = { t: 'c', i: ctx.index, cycle: 0 };
  scheduleRebuild();
}

export async function setTransition(cid, mode) {
  if (cid === 'all') { player.allTransition = mode; persist(); }
  else await patchPlaylist(cid, { transition: mode }).catch(() => {});
  if (ctx.id === cid) scheduleRebuild();
}

/** Call after a playlist's tracks or order changed. */
export function contextChanged(cid) {
  if (ctx.id !== cid) return;
  const ids = contextIds(cid);
  if (shuffleOf(cid)) {
    const keep = ctx.order.filter((id) => ids.includes(id));
    const added = ids.filter((id) => !keep.includes(id));
    ctx.order = [...keep.slice(0, ctx.index + 1), ...shuffled([...keep.slice(ctx.index + 1), ...added])];
  } else ctx.order = ids;
  const i = ctx.order.indexOf(player.trackId);
  if (i >= 0) ctx.index = i; else ctx.index = Math.min(ctx.index, ctx.order.length - 1) - 1;
  if (curRef?.t === 'c') curRef = { t: 'c', i: Math.max(0, ctx.index), cycle: 0 };
  scheduleRebuild();
}

export function playNext(id) {
  if (!playable(lib.tracks[id])) return toast('This sound is unavailable');
  if (!player.trackId) return playSingle(id);
  player.queue = [{ key: qkey(), id }, ...player.queue];
  toast('Playing next');
  scheduleRebuild();
}
export function addToQueue(id) {
  if (!playable(lib.tracks[id])) return toast('This sound is unavailable');
  if (!player.trackId) return playSingle(id);
  player.queue = [...player.queue, { key: qkey(), id }];
  toast('Added to queue');
  scheduleRebuild();
}
export function removeFromQueue(key) {
  player.queue = player.queue.filter((q) => q.key !== key);
  scheduleRebuild();
}
export function playFromQueue(key) {
  const i = player.queue.findIndex((q) => q.key === key);
  if (i < 0) return;
  const q = player.queue[i];
  player.queue = player.queue.slice(i + 1);
  curRef = { t: 'q', key: q.key };
  startSession(q.id, 0, true);
}
export function playUpNext(i) {
  const id = player.upNext[i];
  const idx = ctx.order.indexOf(id, ctx.index + 1);
  ctx.index = idx >= 0 ? idx : ctx.order.indexOf(id);
  curRef = { t: 'c', i: ctx.index, cycle: 0 };
  startSession(id, 0, true);
}
function playSingle(id) {
  ctx = { id: 'queue', order: [id], index: 0 };
  player.contextId = null;
  curRef = { t: 'c', i: 0, cycle: 0 };
  startSession(id, 0, true);
}

function finish() {
  audio.pause();
  session = null;
  curIdx = -1;
  ctx.index = 0;
  curRef = { t: 'c', i: 0, cycle: 0 };
  player.trackId = ctx.order[0] || null;
  player.dur = (lib.tracks[player.trackId]?.samples || 0) / SR;
  player.pos = 0; restoredPos = 0;
  player.playing = false;
  updateMetadata();
  computeUpNext();
  persist();
}

// ---------- media session (lock screen, headphones, Control Center) ----------
export function trackDetailsChanged(id) { if (player.trackId === id) updateMetadata(); }
function updateMetadata() {
  if (!('mediaSession' in navigator)) return;
  const t = lib.tracks[player.trackId];
  if (!t) return;
  const artwork = t.cover
    ? [{ src: new URL(t.cover, location.href).href, sizes: '600x600', type: 'image/jpeg' }]
    : [{ src: new URL('/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }];
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: artistName(t), album: contextName(player.contextId), artwork });
  } catch {}
  positionState();
}
function positionState() {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState || !player.dur) return;
  try { navigator.mediaSession.setPositionState({ duration: player.dur, position: Math.min(player.pos, player.dur), playbackRate: 1 }); } catch {}
}
function bindMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch {} };
  set('play', () => { if (!audio || audio.paused) toggle(); });
  set('pause', () => audio?.pause());
  set('nexttrack', () => next());
  set('previoustrack', () => prev());
  set('seekto', (d) => { if (d.seekTime != null) seek(d.seekTime); });
  // Without these, iOS shows next/previous instead of ±10 s buttons.
  set('seekbackward', null);
  set('seekforward', null);
}

// ---------- audio element ----------
function ensureAudio() {
  if (audio) return;
  audio = document.createElement('audio');
  audio.preload = 'auto';
  audio.setAttribute('playsinline', '');
  audio.style.display = 'none';
  document.body.appendChild(audio);
  audio.volume = player.volume;
  audio.addEventListener('timeupdate', onTime);
  audio.addEventListener('play', () => { player.playing = true; cancelAnimationFrame(raf); loop(); try { navigator.mediaSession.playbackState = 'playing'; } catch {} });
  audio.addEventListener('playing', () => { player.loading = false; bindMediaSession(); updateMetadata(); });
  audio.addEventListener('waiting', () => { player.loading = true; });
  audio.addEventListener('pause', () => { player.playing = false; player.loading = false; persist(); try { navigator.mediaSession.playbackState = 'paused'; } catch {} });
  audio.addEventListener('seeked', positionState);
  audio.addEventListener('ended', () => {
    if (player.repeat === 'off') finish();
    else if (player.repeat === 'one') startSession(player.trackId, 0, true);
    else next();
  });
  audio.addEventListener('error', () => {
    if (!session) return;
    player.loading = false;
    if (!retried && player.trackId) { retried = true; const pos = player.pos; startSession(player.trackId, pos * SR, true); retried = true; return; }
    player.playing = false;
    toast('Playback stopped. Is the Mac server reachable?');
  });
  bindMediaSession();
}

// ---------- persistence ----------
let saveTimer = 0;
function persist(immediate = false) {
  clearTimeout(saveTimer);
  const save = () => store.set({
    trackId: player.trackId, pos: player.pos, contextId: player.contextId, ctx, curRef,
    repeat: player.repeat, volume: player.volume, queue: player.queue,
    allShuffle: player.allShuffle, allTransition: player.allTransition,
  });
  if (immediate) save(); else saveTimer = setTimeout(save, 200);
}
setInterval(() => { if (player.playing) persist(); }, 5000);
addEventListener('pagehide', () => persist(true));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && player.playing) { cancelAnimationFrame(raf); loop(); } });

/** Restore where the owner stopped, paused. Call once the library is loaded. */
export function restore() {
  const s = store.get();
  if (!s) return;
  player.repeat = s.repeat || 'off';
  player.volume = s.volume ?? 1;
  player.allShuffle = !!s.allShuffle;
  player.allTransition = s.allTransition || 'crossfade';
  player.queue = (s.queue || []).filter((q) => playable(lib.tracks[q.id]));
  if (s.trackId && playable(lib.tracks[s.trackId])) {
    ctx = { id: s.ctx?.id ?? null, order: (s.ctx?.order || [s.trackId]).filter((id) => playable(lib.tracks[id])), index: 0 };
    ctx.index = Math.max(0, ctx.order.indexOf(s.trackId));
    curRef = s.curRef?.t === 'q' ? s.curRef : { t: 'c', i: ctx.index, cycle: 0 };
    player.contextId = s.contextId ?? null;
    player.trackId = s.trackId;
    player.dur = lib.tracks[s.trackId].samples / SR;
    restoredPos = Math.min(s.pos || 0, player.dur - 1);
    player.pos = restoredPos;
    updateMetadata();
    computeUpNext();
  }
}

/** Keyboard: space toggles, arrows seek. */
addEventListener('keydown', (e) => {
  if (e.defaultPrevented) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'Space') { e.preventDefault(); toggle(); }
  else if (e.code === 'ArrowRight' && e.shiftKey) { e.preventDefault(); next(); }
  else if (e.code === 'ArrowLeft' && e.shiftKey) { e.preventDefault(); prev(); }
  else if (e.code === 'ArrowRight') { e.preventDefault(); seek(Math.min(player.dur, player.pos + 5)); }
  else if (e.code === 'ArrowLeft') { e.preventDefault(); seek(Math.max(0, player.pos - 5)); }
});

export const isCurrent = (id) => player.trackId === id;

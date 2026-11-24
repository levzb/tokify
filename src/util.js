// Small helpers for the whole app: server requests, number/text formatting, icons.
import { SR, providerName } from '../server/shared.js';

// ---------- server requests ----------
export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body, raw } = {}) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (raw) { init.body = raw; init.headers['Content-Type'] = raw.type || 'application/octet-stream'; }
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  let r;
  try { r = await fetch(path, init); } catch { throw new ApiError('Can’t reach Tokify. Is the computer on and Tokify running?', 0); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(data.error || `Error ${r.status}`, r.status);
  return data;
}

// ---------- formatting ----------
export function clock(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m % 60).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export const trackSec = (t) => (t?.samples || 0) / SR;
export const artistName = (t) => t?.author || (t?.origin === 'external' ? 'Unknown artist' : providerName(t?.origin || 'tiktok'));

export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const songs = (n) => plural(n, 'song');

export function longDuration(sec) {
  const m = Math.round(sec / 60);
  if (sec < 60) return `${Math.round(sec)} sec`;
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} hr ${m % 60} min`;
}

// ---------- icons ----------
// One authored set: 24px grid, 2px round strokes (matches the cart icon on dyke.win).
export const icons = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h5v-6h4v6h5V9.5"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 17v3h16v-3"/>',
  upload: '<path d="M12 15V4"/><path d="m7 9 5-5 5 5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.6-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1.2" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1.2" fill="currentColor" stroke="none"/>',
  next: '<path d="M5 5.2v13.6a.8.8 0 0 0 1.2.7l10.2-6.8a.8.8 0 0 0 0-1.4L6.2 4.5A.8.8 0 0 0 5 5.2Z" fill="currentColor" stroke="none"/><path d="M19 5v14"/>',
  prev: '<path d="M19 5.2v13.6a.8.8 0 0 1-1.2.7L7.6 12.7a.8.8 0 0 1 0-1.4l10.2-6.8a.8.8 0 0 1 1.2.7Z" fill="currentColor" stroke="none"/><path d="M5 5v14"/>',
  // Song endings. Direct and crossfade: Lucide (ISC, square-split-horizontal, squares-intersect);
  // fade: Material Symbols (Apache 2.0, transition_fade).
  endDirect: '<path d="M12 2v20m4-19h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3m-8 0H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3"/>',
  endFade: '<path fill="currentColor" stroke="none" d="M5 21q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h3q.825 0 1.413.588T10 5v14q0 .825-.587 1.413T8 21zm6.288-.288Q11 20.426 11 20t.288-.712T12 19t.713.288T13 20t-.288.713T12 21t-.712-.288m0-4Q11 16.426 11 16t.288-.712T12 15t.713.288T13 16t-.288.713T12 17t-.712-.288m0-4Q11 12.425 11 12t.288-.712T12 11t.713.288T13 12t-.288.713T12 13t-.712-.288m0-4Q11 8.426 11 8t.288-.712T12 7t.713.288T13 8t-.288.713T12 9t-.712-.288m0-4Q11 4.426 11 4t.288-.712T12 3t.713.288T13 4t-.288.713T12 5t-.712-.288m2 14Q13 18.426 13 18t.288-.712T14 17t.713.288T15 18t-.288.713T14 19t-.712-.288m0-4Q13 14.425 13 14t.288-.712T14 13t.713.288T15 14t-.288.713T14 15t-.712-.288m0-4Q13 10.426 13 10t.288-.712T14 9t.713.288T15 10t-.288.713T14 11t-.712-.288m0-4Q13 6.426 13 6t.288-.712T14 5t.713.288T15 6t-.288.713T14 7t-.712-.288m2 14Q15 20.426 15 20t.288-.712T16 19t.713.288T17 20t-.288.713T16 21t-.712-.288m0-4Q15 16.426 15 16t.288-.712T16 15t.713.288T17 16t-.288.713T16 17t-.712-.288m0-4Q15 12.425 15 12t.288-.712T16 11t.713.288T17 12t-.288.713T16 13t-.712-.288m0-4Q15 8.426 15 8t.288-.712T16 7t.713.288T17 8t-.288.713T16 9t-.712-.288m0-4Q15 4.426 15 4t.288-.712T16 3t.713.288T17 4t-.288.713T16 5t-.712-.288M18 19q-.425 0-.712-.288T17 18t.288-.712T18 17t.713.288T19 18t-.288.713T18 19m0-4q-.425 0-.712-.288T17 14t.288-.712T18 13t.713.288T19 14t-.288.713T18 15m0-4q-.425 0-.712-.288T17 10t.288-.712T18 9t.713.288T19 10t-.288.713T18 11m-.712-4.288Q17 6.426 17 6t.288-.712T18 5t.713.288T19 6t-.288.713T18 7t-.712-.288m2 14Q19 20.426 19 20t.288-.712T20 19t.713.288T21 20t-.288.713T20 21t-.712-.288m0-4Q19 16.426 19 16t.288-.712T20 15t.713.288T21 16t-.288.713T20 17t-.712-.288m0-4Q19 12.425 19 12t.288-.712T20 11t.713.288T21 12t-.288.713T20 13t-.712-.288m0-4Q19 8.426 19 8t.288-.712T20 7t.713.288T21 8t-.288.713T20 9t-.712-.288m0-4Q19 4.426 19 4t.288-.712T20 3t.713.288T21 4t-.288.713T20 5t-.712-.288"/>',
  endCrossfade: '<path d="M10 22a2 2 0 0 1-2-2m6-18a2 2 0 0 1 2 2m0 18h-2M2 10V8m0-4a2 2 0 0 1 2-2m16 6a2 2 0 0 1 2 2m0 4v2m0 4a2 2 0 0 1-2 2M4 16a2 2 0 0 1-2-2m6-4a2 2 0 0 1 2-2h5a1 1 0 0 1 1 1v5a2 2 0 0 1-2 2H9a1 1 0 0 1-1-1zm0-8h2"/>',
  lyrics: '<path d="m11 7.601l-5.994 8.19a1 1 0 0 0 .1 1.298l.817.818a1 1 0 0 0 1.314.087L15.09 12"/><path d="M16.5 21.174C15.5 20.5 14.372 20 13 20c-2.058 0-3.928 2.356-6 2s-2.775-3.369-1.5-4.5"/><circle cx="16" cy="7" r="5"/>',
  // Settings, sleep timer, quit: Lucide (ISC) settings, moon, power.
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  ear: '<path d="M6 8.5a6.5 6.5 0 1 1 13 0c0 6-6 6-6 10a3.5 3.5 0 1 1-7 0"/><path d="M15 8.5a2.5 2.5 0 0 0-5 0v1a2 2 0 1 1 0 4"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  // Full screen in and out: Lucide (ISC) maximize-2 / minimize-2.
  stage: '<path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/>',
  stageExit: '<path d="m14 10 7-7"/><path d="M20 10h-6V4"/><path d="m3 21 7-7"/><path d="M4 14h6v6"/>',
  sound: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M2 14h4"/><path d="M10 8h4"/><path d="M18 16h4"/>',
  shuffle: '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
  volumeLow: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
  mute: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m22 9-6 6M16 9l6 6"/>',
  queue: '<path d="M3 6h13M3 12h13M3 18h8"/><path d="M16 15v6l5-3-5-3Z" fill="currentColor"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  grip: '<path d="M5 9h14M5 15h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
  cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8.1 8.1 12 12M14 10l6-6M8.1 15.9 12 12"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  note: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4.5M12 16h.01"/>',
  retry: '<path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/>',
  playNext: '<path d="M3 6h11M3 12h11M3 18h7"/><path d="M18 9v10M13 14h10"/>',
  addQueue: '<path d="M3 6h13M3 12h13M3 18h8"/><path d="M18 14v7M14.5 17.5h7"/>',
  listAdd: '<path d="M11 12H3M16 6H3M16 18H3"/><path d="M18 9v6M15 12h6"/>',
  remove: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  // Cut at the playhead: the crossed-out side goes, the waveform side stays.
  trimStart: '<path d="M12 3v18"/><path d="M16 8v8M20 10.5v3"/><path d="m4 9.5 4 5M8 9.5l-4 5"/>',
  trimEnd: '<path d="M12 3v18"/><path d="M8 8v8M4 10.5v3"/><path d="m16 9.5 4 5M20 9.5l-4 5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
};

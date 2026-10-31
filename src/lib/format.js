import { SR } from '../../shared/timeline.js';

export function clock(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m % 60).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export const trackSec = (t) => (t?.samples || 0) / SR;
export const artistName = (t) => t?.author || (t?.origin === 'external' ? 'Unknown artist' : 'TikTok');

export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const songs = (n) => plural(n, 'song');

export function longDuration(sec) {
  const m = Math.round(sec / 60);
  if (sec < 60) return `${Math.round(sec)} sec`;
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} hr ${m % 60} min`;
}

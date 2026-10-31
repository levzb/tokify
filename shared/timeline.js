// Shared by the server (renders the stream) and the client (maps stream time to tracks).
// Everything is in samples at 48 kHz so both sides agree exactly.

export const SR = 48000;
export const FRAME = 1152; // samples per MP3 frame
export const FRAME_BYTES = 480; // 160 kbps CBR at 48 kHz: 144 * 160000 / 48000, never padded
export const STREAM_DELAY = 1105; // encoder (576) + decoder (529) delay, in samples
export const TAIL = Math.round(SR * 0.6); // silence appended to every stream

export const TRANSITIONS = ['none', 'fade', 'crossfade'];

const s = (sec) => Math.round(sec * SR);
const DECLICK = s(0.008);

/**
 * items: [{ id, samples, offset? }] in play order. `samples` is the track's effective length
 * (silence trimmed). `offset` (first item only) starts that track part-way through.
 * Returns entries with absolute stream positions plus envelope info for the renderer.
 */
export function buildTimeline(items, mode = 'none') {
  const entries = [];
  let cursor = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const offset = Math.max(0, Math.min(it.offset || 0, it.samples - s(1)));
    const len = it.samples - offset;
    if (len <= 0) continue;
    const prev = entries[entries.length - 1];
    let start = cursor;
    let fadeIn = offset > 0 ? s(0.12) : DECLICK;
    if (prev) {
      if (mode === 'crossfade') {
        const x = Math.min(s(1.5), Math.floor(prev.len / 3), Math.floor(len / 3));
        start = prev.start + prev.len - x;
        prev.fadeOut = x;
        fadeIn = x;
      } else if (mode === 'fade') {
        prev.fadeOut = Math.min(s(3), Math.floor(prev.len / 4));
        start = prev.start + prev.len + s(0.35);
        fadeIn = Math.min(s(1.2), Math.floor(len / 6));
      }
    }
    const e = { id: it.id, ref: it.ref, start, len, srcOffset: offset, fadeIn, fadeOut: DECLICK };
    if (mode === 'fade') e.fadeOut = Math.min(s(3), Math.floor(len / 4));
    entries.push(e);
    cursor = start + len;
  }
  const last = entries[entries.length - 1];
  const audioEnd = last ? last.start + last.len : 0;
  const total = audioEnd + TAIL;
  const frames = Math.ceil((total + STREAM_DELAY) / FRAME) + 2;
  return { entries, total, audioEnd, frames, bytes: frames * FRAME_BYTES, mode };
}

/** Plan position (samples) for a media-element currentTime (seconds). */
export const planPos = (currentTime) => Math.round(currentTime * SR) - STREAM_DELAY;
/** media-element currentTime (seconds) for a plan position (samples). */
export const streamTime = (pos) => (pos + STREAM_DELAY) / SR;

/** Index of the entry that is "current" at plan position `pos`. A track becomes current when it starts. */
export function entryAt(entries, pos) {
  let lo = 0, hi = entries.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].start <= pos) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** Linear gain 0..1 of an entry at local sample `k` (0 = entry start). Equal-power curves. */
export function envelope(e, k) {
  let g = 1;
  if (k < e.fadeIn) g *= Math.sin((k / e.fadeIn) * Math.PI / 2);
  const tail = e.len - k;
  if (tail < e.fadeOut) g *= Math.sin((Math.max(0, tail) / e.fadeOut) * Math.PI / 2);
  return g;
}

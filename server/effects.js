// Sound effects, shared by the player (Web Audio, src/sound.svelte.js) and offline downloads (ffmpeg,
// server/stream.js), so a download sounds like what was playing. No Node APIs here: Vite bundles this file too.
//
// The chain is the same on both sides, in this order:
//   speed (with or without pitch) → 5-band equaliser → bass → 8D orbit → reverb → limiter.

export const SOUND_DEFAULT = Object.freeze({ speed: 1, keepPitch: false, bass: 0, reverb: 0, orbit: false, eq: Object.freeze([0, 0, 0, 0, 0]) });

// Shelves at the ends, bells in between (Q 1), the same filters as BiquadFilterNode.
export const EQ_BANDS = [
  { f: 60, type: 'lowshelf', label: '60' },
  { f: 230, type: 'peaking', label: '230' },
  { f: 910, type: 'peaking', label: '910' },
  { f: 3600, type: 'peaking', label: '3.6k' },
  { f: 14000, type: 'highshelf', label: '14k' },
];
export const EQ_MAX = 12;
export const EQ_PRESETS = [
  { id: 'flat', label: 'Flat', eq: [0, 0, 0, 0, 0] },
  { id: 'warm', label: 'Warm', eq: [4, 2, 0, -1.5, -2] },
  { id: 'vocal', label: 'Vocal', eq: [-2, -1, 2, 4, 1] },
  { id: 'bright', label: 'Bright', eq: [-1, 0, 0, 3, 5] },
];

export const SPEED = { min: 0.5, max: 1.5 };
export const BASS_MAX = 12;   // dB on a low shelf at 100 Hz
export const BASS_HZ = 100;
export const ORBIT_HZ = 0.125; // one turn around the head every 8 seconds
export const ORBIT_DEPTH = 0.85;
// The orbit dips each ear in turn (gain swings between 1 − depth and 1); this brings the average level back.
export const ORBIT_MAKEUP_DB = 3.5;
export const REVERB_SECONDS = 3.2;

export const PRESETS = [
  { id: 'original', label: 'Original', hint: 'As it was recorded', s: {} },
  { id: 'slowed', label: 'Slowed + Reverb', hint: 'Slower and deeper, in a big room', s: { speed: 0.8, reverb: 0.5, bass: 2 } },
  { id: 'spedup', label: 'Sped up', hint: 'Faster and higher, TikTok style', s: { speed: 1.2 } },
  { id: 'nightcore', label: 'Nightcore', hint: 'Much faster and higher, extra sparkle', s: { speed: 1.3, eq: [1, 0, 0, 2, 3] } },
  { id: 'bass', label: 'Bass boosted', hint: 'Heavy low end', s: { bass: 9, eq: [2, 0, 0, 0, 0] } },
  { id: '8d', label: '8D', hint: 'Circles around your head. Use headphones', s: { orbit: true, reverb: 0.3 } },
];

const num = (v, lo, hi, step, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.min(hi, Math.max(lo, n)) / step) * step;
};
const fix = (n) => Math.round(n * 1000) / 1000;

/** Any object → valid settings (out-of-range values are clamped, unknown keys dropped). */
export function cleanSound(x) {
  const s = x && typeof x === 'object' ? x : {};
  const eq = Array.isArray(s.eq) ? s.eq : [];
  return {
    speed: fix(num(s.speed, SPEED.min, SPEED.max, 0.01, 1)),
    keepPitch: s.keepPitch === true,
    bass: fix(num(s.bass, 0, BASS_MAX, 0.5, 0)),
    reverb: fix(num(s.reverb, 0, 1, 0.01, 0)),
    orbit: s.orbit === true,
    eq: EQ_BANDS.map((_, i) => fix(num(eq[i], -EQ_MAX, EQ_MAX, 0.5, 0))),
  };
}

export const presetSound = (p) => cleanSound({ ...SOUND_DEFAULT, ...p.s });
export const sameSound = (a, b) => JSON.stringify(cleanSound(a)) === JSON.stringify(cleanSound(b));
const same = sameSound;
/** Speed with the pitch kept is still the original sound at 1×. */
export const isNeutral = (s) => same({ ...s, keepPitch: false }, SOUND_DEFAULT);
export const presetOf = (s) => PRESETS.find((p) => same(s, presetSound(p))) || null;
export const eqPresetOf = (eq) => EQ_PRESETS.find((p) => p.eq.every((g, i) => g === eq[i])) || null;
/** What the sound is called: a preset's name, or "Custom". */
export const soundLabel = (s) => presetOf(s)?.label || (isNeutral(s) ? 'Original' : 'Custom');
/** Anything beyond speed needs the audio graph (Web Audio) or a filter pass (ffmpeg). */
export const needsGraph = (s) => s.bass > 0 || s.reverb > 0 || s.orbit || s.eq.some((g) => g !== 0);
/** Boosting pushes peaks over full scale: lower the level a little (at most 4 dB) and let the limiter catch the rest. */
export const headroomDb = (s) => -Math.min(4, 0.3 * Math.max(0, s.bass + Math.max(0, s.eq[0]), ...s.eq));
/** Dry and wet levels for a reverb amount 0..1: the room swells while the direct sound steps back a little. */
export const reverbMix = (r) => ({ dry: 1 - 0.3 * r, wet: 0.9 * r });

// Deterministic so the player and a download use the very same room.
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A big, soft hall as an impulse response: [left, right] Float32Arrays at `rate`.
 * Noise that dies away over ~2.6 s and gets darker as it fades, a different noise per ear for width,
 * 18 ms before the room answers, scaled to unit energy so the wet sound is about as loud as the dry one.
 */
export function impulse(rate = 48000, seconds = REVERB_SECONDS) {
  const n = Math.round(rate * seconds), pre = Math.round(rate * 0.018), rt60 = 2.6;
  return [0x5eed, 0xbeef].map((seed) => {
    const rnd = mulberry32(seed), out = new Float32Array(n);
    let y = 0, energy = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / rate;
      const a = 0.85 * Math.exp(-t / 0.9) + 0.08; // lowpass closing as the tail fades
      y += a * ((rnd() * 2 - 1) - y);
      const v = y * Math.pow(10, (-3 * t) / rt60) * Math.min(1, t / 0.012); // 60 dB down at rt60, soft onset
      out[i] = v; energy += v * v;
    }
    const k = 1 / Math.sqrt(energy || 1);
    for (let i = 0; i < n; i++) out[i] *= k;
    return out;
  });
}

/** The impulse as a 32-bit float stereo WAV, for ffmpeg's afir. */
export function impulseWav(rate = 48000) {
  const [l, r] = impulse(rate), n = l.length, bytes = n * 8;
  const buf = new ArrayBuffer(44 + bytes), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 3, true); v.setUint16(22, 2, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 8, true); v.setUint16(32, 8, true); v.setUint16(34, 32, true); str(36, 'data'); v.setUint32(40, bytes, true);
  for (let i = 0; i < n; i++) { v.setFloat32(44 + i * 8, l[i], true); v.setFloat32(48 + i * 8, r[i], true); }
  return new Uint8Array(buf);
}

/**
 * The ffmpeg filtergraph for settings `s`, reading from label `input` (e.g. "[0:a]") and, when there is
 * reverb, the impulse from `ir` (e.g. "[1:a]"). Ends in "[fx]". Returns null when there is nothing to do.
 */
export function ffmpegGraph(s, input, ir) {
  s = cleanSound(s);
  if (isNeutral(s)) return null;
  const chain = ['aformat=sample_rates=48000:channel_layouts=stereo'];
  if (s.speed !== 1) {
    chain.push(s.keepPitch ? `atempo=${s.speed}` : `asetrate=${Math.round(48000 * s.speed)},aresample=48000`);
  }
  EQ_BANDS.forEach((b, i) => {
    const g = s.eq[i];
    if (!g) return;
    if (b.type === 'lowshelf') chain.push(`bass=f=${b.f}:t=s:w=1:g=${g}`);
    else if (b.type === 'highshelf') chain.push(`treble=f=${b.f}:t=s:w=1:g=${g}`);
    else chain.push(`equalizer=f=${b.f}:t=q:w=1:g=${g}`);
  });
  if (s.bass) chain.push(`bass=f=${BASS_HZ}:t=s:w=1:g=${s.bass}`);
  if (s.orbit) chain.push(`apulsator=mode=sine:hz=${ORBIT_HZ}:amount=${ORBIT_DEPTH}`, `volume=${ORBIT_MAKEUP_DB}dB`);
  const limit = needsGraph(s) ? `volume=${headroomDb(s)}dB,alimiter=limit=0.94:attack=2:release=80:level=0` : 'anull';
  if (!s.reverb) return `${input}${chain.join(',')},${limit}[fx]`;
  const { dry, wet } = reverbMix(s.reverb);
  return `${input}${chain.join(',')},asplit=2[fxd][fxw];` +
    `${ir}aformat=sample_rates=48000:channel_layouts=stereo[fxir];` +
    `[fxw][fxir]afir=gtype=-1:irgain=1:dry=1:wet=1[fxr];` +
    `[fxd][fxr]amix=inputs=2:weights=${dry.toFixed(3)} ${wet.toFixed(3)}:normalize=0:duration=first,${limit}[fx]`;
}

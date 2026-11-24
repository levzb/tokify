// How the music sounds: speed and pitch, a 5-band equaliser, bass, an 8D orbit and reverb.
// One sound for all songs, and any song can have its own; both remembered per browser. The settings and the filter recipe are
// shared with offline downloads (server/effects.js), so a download sounds like what was playing.
//
// Speed is the <audio> element's own playbackRate, so it costs nothing and works everywhere. The rest needs
// a Web Audio graph, built only once something beyond speed is first turned on: a browser can't take an
// element back out of a graph, and plain playback is the safest on a locked phone.
import {
  SOUND_DEFAULT, EQ_BANDS, BASS_HZ, ORBIT_HZ, ORBIT_DEPTH, ORBIT_MAKEUP_DB, cleanSound, presetSound, needsGraph,
  headroomDb, reverbMix, impulse, sameSound, presetOf, isNeutral, soundLabel,
} from '../server/effects.js';

const KEY = 'tokify.sound.v1', SONGS = 'tokify.sound.songs.v1';
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };

/** The sound for all songs. */
export const sound = $state(cleanSound({ ...SOUND_DEFAULT, ...read(KEY, {}) }));
/** Songs with a sound of their own: { trackId: settings }. Those keep it whatever the sound for all songs is. */
export const songSounds = $state(Object.fromEntries(Object.entries(read(SONGS, {}) || {}).map(([id, v]) => [id, cleanSound(v)])));
/** What the panel is changing: one song (its id) or all songs (null). */
export const scope = $state({ trackId: null });

export const ownSound = (id) => (id && songSounds[id]) || null;
/** What a song sounds like: its own sound, or the one for all songs. */
export const heardFor = (id) => ownSound(id) || sound;
/** The settings the panel shows and changes. */
export const edited = () => heardFor(scope.trackId);

export function setSound(patch) {
  const next = cleanSound({ ...$state.snapshot(edited()), ...patch });
  if (scope.trackId) songSounds[scope.trackId] = next;
  else Object.assign(sound, next);
}
export const usePreset = (p) => setSound(presetSound(p));
/** Back to the recording itself (for one song that is its own plain sound, even if all songs are slowed). */
export const resetSound = () => setSound(SOUND_DEFAULT);
/** The song follows the sound for all songs again. */
export function forgetSongSound(id) { delete songSounds[id]; }

// ---------- your presets ----------
// Sounds you saved under a name, kept next to the setting in this browser.
const MINE = 'tokify.sound.presets.v1';
export const MINE_MAX = 12;
export const NAME_MAX = 24;
export const mine = $state((() => {
  try {
    const list = JSON.parse(localStorage.getItem(MINE) || '[]');
    return (Array.isArray(list) ? list : []).filter((p) => p && typeof p.name === 'string' && p.id)
      .slice(0, MINE_MAX).map((p) => ({ id: String(p.id), name: p.name.slice(0, NAME_MAX), s: cleanSound(p.s) }));
  } catch { return []; }
})());
const saveMine = () => { try { localStorage.setItem(MINE, JSON.stringify($state.snapshot(mine))); } catch {} };

export const mineOf = (s) => mine.find((p) => sameSound(p.s, s)) || null;
/** What the sound is called: your name for it, a built-in preset's, "Original" or "Custom". */
export const soundName = (s) => mineOf(s)?.name || soundLabel(s);
/** Only a sound that is not plain, not built in and not already saved is worth saving. */
export const canSave = (s) => !isNeutral(s) && !presetOf(s) && !mineOf(s) && mine.length < MINE_MAX;
export const nextName = () => {
  for (let n = mine.length + 1; ; n++) if (!mine.some((p) => p.name === `My sound ${n}`)) return `My sound ${n}`;
};
export function savePreset(name) {
  const p = { id: Math.random().toString(36).slice(2, 10), name: (name.trim() || nextName()).slice(0, NAME_MAX), s: cleanSound($state.snapshot(edited())) };
  mine.push(p);
  saveMine();
  return p;
}
/** Removes a saved preset; returns a function that puts it back where it was. */
export function deletePreset(id) {
  const i = mine.findIndex((p) => p.id === id);
  if (i < 0) return () => {};
  const [p] = mine.splice(i, 1);
  saveMine();
  return () => { if (!mine.some((x) => x.id === p.id)) { mine.splice(Math.min(i, mine.length), 0, p); saveMine(); } };
}

// ---------- playback ----------
// The sound follows the song that is playing: at every change of song its own sound (or the one for all
// songs) takes over, gliding in the 40 ms the parameters take.
let audio = null, g = null, playingId = () => null;
const link = $state({ bound: false });
const heard = () => heardFor(playingId());

/** Hands the player's <audio> element over, and how to tell which song is playing. Called once. */
export function bindSound(el, current) {
  audio = el;
  playingId = current;
  // A new source resets playbackRate to defaultPlaybackRate; setting both keeps the speed across songs.
  el.addEventListener('loadstart', () => rate(heard()));
  link.bound = true;
}

/** Call from a tap that starts playback: a browser only lets audio processing start from a gesture.
 *  Built when any song will need it, so one with its own sound later in the list is not left silent. */
export function wakeSound() {
  if (audio && (needsGraph(sound) || Object.values(songSounds).some(needsGraph))) build();
  g?.ctx.resume().catch(() => {});
}

function rate(s) {
  if (!audio) return;
  audio.defaultPlaybackRate = s.speed;
  audio.playbackRate = s.speed;
  audio.preservesPitch = audio.webkitPreservesPitch = s.keepPitch;
}

function build() {
  if (g || !audio) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const ctx = new AC({ latencyHint: 'playback' });
  const src = ctx.createMediaElementSource(audio);
  const node = (type, f, gain = 0) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = 1; b.gain.value = gain; return b; };
  const bands = EQ_BANDS.map((b) => node(b.type, b.f));
  const bass = node('lowshelf', BASS_HZ);

  // 8D: each ear's level swings between 1 − depth and 1, the two ears in opposite phase.
  const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2);
  const left = ctx.createGain(), right = ctx.createGain(), lfo = ctx.createOscillator();
  const swingL = ctx.createGain(), swingR = ctx.createGain(), makeup = ctx.createGain();
  lfo.frequency.value = ORBIT_HZ;
  lfo.connect(swingL).connect(left.gain);
  lfo.connect(swingR).connect(right.gain);
  lfo.start();

  const dry = ctx.createGain(), wet = ctx.createGain(), conv = ctx.createConvolver(), level = ctx.createGain();
  conv.normalize = false;
  const limiter = ctx.createDynamicsCompressor();
  limiter.knee.value = 0; limiter.attack.value = 0.002; limiter.release.value = 0.08;

  let chain = src;
  for (const b of [...bands, bass]) { chain.connect(b); chain = b; }
  chain.connect(split);
  split.connect(left, 0); split.connect(right, 1);
  left.connect(merge, 0, 0); right.connect(merge, 0, 1);
  merge.connect(makeup);
  makeup.connect(dry).connect(level);
  wet.connect(level);
  level.connect(limiter).connect(ctx.destination);

  g = { ctx, bands, bass, left, right, swingL, swingR, makeup, dry, wet, conv, level, limiter, reverbOn: false };
  apply(heard(), true);
}

function apply(s, now = false) {
  if (!g) return;
  const t = g.ctx.currentTime, set = (p, v) => (now ? p.setValueAtTime(v, t) : p.setTargetAtTime(v, t, 0.04));
  g.bands.forEach((b, i) => set(b.gain, s.eq[i]));
  set(g.bass.gain, s.bass);
  const d = s.orbit ? ORBIT_DEPTH / 2 : 0;
  set(g.left.gain, 1 - d); set(g.right.gain, 1 - d);
  set(g.swingL.gain, d); set(g.swingR.gain, -d);
  set(g.makeup.gain, s.orbit ? Math.pow(10, ORBIT_MAKEUP_DB / 20) : 1);
  // The room only costs anything while it is on.
  const wantReverb = s.reverb > 0;
  if (wantReverb && !g.reverbOn) {
    if (!g.conv.buffer) {
      const [l, r] = impulse(g.ctx.sampleRate), buf = g.ctx.createBuffer(2, l.length, g.ctx.sampleRate);
      buf.copyToChannel(l, 0); buf.copyToChannel(r, 1); g.conv.buffer = buf;
    }
    g.makeup.connect(g.conv).connect(g.wet);
    g.reverbOn = true;
  } else if (!wantReverb && g.reverbOn) {
    try { g.makeup.disconnect(g.conv); } catch {}
    g.reverbOn = false;
  }
  const mix = reverbMix(s.reverb);
  set(g.dry.gain, wantReverb ? mix.dry : 1);
  set(g.wet.gain, wantReverb ? mix.wet : 0);
  // Back to plain sound: no level change and the limiter does nothing.
  const active = needsGraph(s);
  set(g.level.gain, active ? Math.pow(10, headroomDb(s) / 20) : 1);
  set(g.limiter.threshold, active ? -1 : 0);
  set(g.limiter.ratio, active ? 20 : 1);
}

$effect.root(() => {
  $effect(() => { const v = $state.snapshot(sound); try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} });
  $effect(() => { const v = $state.snapshot(songSounds); try { localStorage.setItem(SONGS, JSON.stringify(v)); } catch {} });
  $effect(() => {
    if (!link.bound) return;
    const s = $state.snapshot(heard());
    rate(s);
    // Turned on from the panel (a tap), so the graph may start now.
    if (needsGraph(s) && !g) build();
    apply(s);
    if (g && !audio.paused) g.ctx.resume().catch(() => {});
  });
});

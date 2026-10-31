import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { SR } from '../shared/timeline.js';
import { DIRS } from './db.js';

export function run(cmd, args, { input, maxBytes = 1 << 30 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], err = [];
    let size = 0;
    p.stdout.on('data', (d) => {
      size += d.length;
      if (size > maxBytes) { p.kill('SIGTERM'); reject(new Error('Decoded audio is too large to process')); }
      else out.push(d);
    });
    p.stderr.on('data', (d) => err.push(d));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve({ stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString() });
      else reject(new Error(`${cmd} exited ${code}: ${Buffer.concat(err).toString().slice(-400)}`));
    });
    p.stdin.on('error', () => {});
    if (input) p.stdin.end(input); else p.stdin.end();
  });
}

/** Decode any audio file to interleaved stereo Float32 at 48 kHz. */
export async function decode(file) {
  const { stdout } = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-f', 'f32le', '-ac', '2', '-ar', String(SR), 'pipe:1']);
  return new Float32Array(stdout.buffer, stdout.byteOffset, stdout.length / 4);
}

/**
 * Measure what the mixer needs: exact length, leading/trailing silence, loudness.
 * Silence is trimmed only below -60 dBFS (inaudible), so "как есть" still means as-is.
 */
export async function analyze(file) {
  const pcm = await decode(file);
  const n = pcm.length / 2;
  if (n < SR * 0.5) throw new Error('Sound is too short or damaged');
  const thr = 0.001; // -60 dBFS
  let a = 0, b = n - 1;
  while (a < n && Math.abs(pcm[a * 2]) < thr && Math.abs(pcm[a * 2 + 1]) < thr) a++;
  while (b > a && Math.abs(pcm[b * 2]) < thr && Math.abs(pcm[b * 2 + 1]) < thr) b--;
  const pad = Math.round(SR * 0.05);
  const trimStart = Math.max(0, a - pad);
  const end = Math.min(n, b + 1 + pad);
  const samples = end - trimStart;

  // Integrated loudness (EBU R128) so quiet and loud clips sit at the same level.
  let gain = 0;
  try {
    const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-']);
    const m = stderr.match(/I:\s+(-?[\d.]+) LUFS/g);
    const lufs = m ? parseFloat(m[m.length - 1].replace(/[^-\d.]/g, '')) : NaN;
    if (Number.isFinite(lufs) && lufs > -70) gain = Math.max(-10, Math.min(6, -14 - lufs));
  } catch { /* keep 0 dB */ }
  return { samples, trimStart, gain: Math.round(gain * 10) / 10 };
}

/** Normalize any image (JPEG/PNG/WebP/HEIC) to a 600px JPEG using macOS sips, falling back to ffmpeg. */
export async function normalizeImage(src, dest) {
  try {
    await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '86', '-Z', '600', src, '--out', dest]);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  } catch { /* fall through */ }
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vf', "scale='min(600,iw)':-2", '-frames:v', '1', '-q:v', '3', dest]);
  return dest;
}

/** A glow color for the cover: the most colorful of its 8x8 averages, kept away from black and white. */
export async function coverColor(file) {
  try {
    const { stdout } = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', 'scale=8:8:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
    let best = null, bestScore = -1;
    for (let i = 0; i + 2 < stdout.length; i += 3) {
      const r = stdout[i], g = stdout[i + 1], b = stdout[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      const lum = (max + min) / 510;
      const score = sat * (1 - Math.abs(lum - 0.5) * 1.4);
      if (score > bestScore) { bestScore = score; best = [r, g, b]; }
    }
    if (!best || bestScore < 0.08) return '#ffffff';
    // lift dark colors so the glow reads on black
    const max = Math.max(...best);
    const k = max < 150 ? 150 / Math.max(1, max) : 1;
    return '#' + best.map((v) => Math.min(255, Math.round(v * k)).toString(16).padStart(2, '0')).join('');
  } catch {
    return '#ffffff';
  }
}

export const coverPath = (name) => path.join(DIRS.covers, name);
export const customPath = (name) => path.join(DIRS.custom, name);
export const audioPath = (name) => path.join(DIRS.audio, name);

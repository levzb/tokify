// Audio work with ffmpeg: decoding, loudness and silence analysis, covers, and non-destructive excerpts.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { SR } from './shared.js';
import { db, DIRS } from './db.js';
import { tool } from './system.js';

/** Run ffmpeg/ffprobe (or another program) and collect its output. */
export function run(cmd, args, { input, maxBytes = 1 << 30 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(['ffmpeg', 'ffprobe'].includes(cmd) ? tool(cmd) : cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
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

/** Normalize any image to a 600px JPEG. macOS sips also reads HEIC; elsewhere ffmpeg does the work. */
export async function normalizeImage(src, dest) {
  if (process.platform === 'darwin') try {
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

// ---------- excerpts: keep the downloaded file, change the playback range ----------
const MIN = Math.round(SR * .5);
const bad = (message, code=400) => Object.assign(new Error(message), {code});
const waves = new Map();
function track(id) {
  const t=db.prepare("SELECT * FROM tracks WHERE id=? AND status='ok'").get(id);
  if(!t?.audio_file || !fs.existsSync(audioPath(t.audio_file)))throw bad('Audio is unavailable. Download this song first.');
  return t;
}
export function clipBase(t) { return {start:t.base_trim_start ?? t.trim_start,samples:t.base_samples ?? t.samples}; }

/** Preserve a saved excerpt when its original has to be downloaded again. */
export function analysisWithClip(id,a) {
  const t=db.prepare('SELECT clip_start,clip_end FROM tracks WHERE id=?').get(id);
  const clipped=t?.clip_start!==null && t?.clip_start!==undefined;
  const start=clipped?Math.min(Math.max(0,t.clip_start),Math.max(0,a.samples-MIN)):0;
  const end=clipped?Math.max(start+Math.min(MIN,a.samples),Math.min(a.samples,t.clip_end ?? a.samples)):a.samples;
  return {...a,baseStart:a.trimStart,baseSamples:a.samples,trimStart:a.trimStart+start,samples:end-start,clipStart:clipped?start:null,clipEnd:clipped?end:null};
}
export async function clipInfo(id) {
  const t=track(id),base=clipBase(t),file=audioPath(t.audio_file),stat=fs.statSync(file);
  const key=`${t.id}:${stat.size}:${stat.mtimeMs}:${base.start}:${base.samples}`;
  if(!waves.has(key)){
    const p=(async()=>{
      const {stdout}=await run('ffmpeg',['-hide_banner','-loglevel','error','-i',file,'-vn','-af',`atrim=start_sample=${base.start}:end_sample=${base.start+base.samples},asetpts=PTS-STARTPTS`,'-f','f32le','-ac','1','-ar','2000','pipe:1'],{maxBytes:32<<20});
      const pcm=new Float32Array(stdout.buffer,stdout.byteOffset,stdout.length/4),peaks=[];
      const count=Math.min(600,Math.max(1,pcm.length));let max=0;
      for(let b=0;b<count;b++){let v=0;for(let k=Math.floor(b*pcm.length/count);k<Math.floor((b+1)*pcm.length/count);k++)v=Math.max(v,Math.abs(pcm[k]) || 0);peaks.push(v);max=Math.max(max,v);}
      return peaks.map(v=>Math.round(Math.pow(v/Math.max(max,.0001),.65)*1000)/1000);
    })();waves.set(key,p);p.catch(()=>waves.delete(key));while(waves.size>50)waves.delete(waves.keys().next().value);
  }
  let waveform;try{waveform=await waves.get(key);}catch{throw bad('Couldn’t read this audio for editing');}
  return {id,duration:base.samples/SR,sourceOffset:base.start/SR,start:(t.clip_start ?? 0)/SR,end:(t.clip_end ?? base.samples)/SR,
    version:t.ver,edited:t.clip_start!==null,minimum:Math.min(.5,base.samples/SR),audioUrl:`/api/tracks/${encodeURIComponent(id)}/source?v=${stat.mtimeMs}`,waveform};
}
export function setClip(id,{start,end,reset=false,version}={}) {
  const t=track(id),base=clipBase(t);
  if(version!==undefined && version!==t.ver)throw bad('This song changed in another window. Reopen the editor before saving.');
  if(reset){start=0;end=base.samples/SR;}
  if(typeof start!=='number'||typeof end!=='number'||!Number.isFinite(start)||!Number.isFinite(end))throw bad('Enter a valid start and end time');
  const a=Math.round(start*SR),b=Math.round(end*SR);
  if(a<0||b>base.samples||b-a<Math.min(MIN,base.samples))throw bad('Select at least 0.5 seconds within the original recording');
  const full=a===0&&b===base.samples;
  db.prepare(`UPDATE tracks SET base_trim_start=?,base_samples=?,trim_start=?,samples=?,clip_start=?,clip_end=?,ver=ver+1 WHERE id=?`)
    .run(base.start,base.samples,base.start+a,b-a,full?null:a,full?null:b,id);
  return {ok:true,start:a/SR,end:b/SR,duration:(b-a)/SR,edited:!full};
}
export function serveClipSource(req,res,id){
  const t=track(id),file=audioPath(t.audio_file),size=fs.statSync(file).size;
  let start=0,end=size-1,partial=false;
  if(req.headers.range){const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!m||(!m[1]&&!m[2])){res.writeHead(416,{'Content-Range':`bytes */${size}`});return res.end();}partial=true;if(!m[1])start=Math.max(0,size-Number(m[2]));else{start=Number(m[1]);if(m[2])end=Math.min(size-1,Number(m[2]));}if(start>=size||start>end||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)){res.writeHead(416,{'Content-Range':`bytes */${size}`});return res.end();}}
  const type={'.mp3':'audio/mpeg','.m4a':'audio/mp4','.aac':'audio/aac','.wav':'audio/wav','.ogg':'audio/ogg','.webm':'audio/webm'}[path.extname(file)] || 'application/octet-stream';
  res.writeHead(partial?206:200,{'Content-Type':type,'Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'private, no-store',...(partial?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});
  if(req.method==='HEAD')return res.end();const stream=fs.createReadStream(file,{start,end});res.on('close',()=>stream.destroy());stream.on('error',()=>res.destroy());stream.pipe(res);
}

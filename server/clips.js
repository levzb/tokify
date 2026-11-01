// Non-destructive excerpts: keep the downloaded file and change the playback range.
import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { run, audioPath } from './audio.js';
import { SR } from '../shared/timeline.js';
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

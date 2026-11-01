// Private offline exports. Preparing, downloading and listening need no internet.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Zip, ZipPassThrough } from 'fflate';
import { once } from 'node:events';
import { db, DATA, DIRS } from './db.js';
import { run, audioPath, coverPath, customPath } from './audio.js';
import { renderMixFile } from './stream.js';

const dir = path.join(DATA, 'exports');
fs.mkdirSync(dir, { recursive: true });
const jobs = new Map(), queue = [];
let running = false;
const bad = (message, code = 400) => Object.assign(new Error(message), { code });
const digest = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const safeName = (v) => {
  let name = Array.from(String(v || '').toWellFormed().normalize('NFC').replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '')).slice(0, 100).join('').trim();
  while (Buffer.byteLength(name) > 180) name = Array.from(name).slice(0,-1).join('');
  return name || 'Tokify';
};
const oneLine = (v) => String(v || '').replace(/[\r\n]/g, ' ');
const persist = (job) => {
  const file = path.join(dir, job.id + '.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify(job));
  fs.renameSync(file + '.tmp', file);
};
const coverOf = (t) => t.custom_cover ? customPath(t.custom_cover) : t.cover_file ? coverPath(t.cover_file) : null;
const statKey = (f) => { const s = f && fs.statSync(f, { throwIfNoEntry: false }); return s ? [s.size, s.mtimeMs] : null; };

function source({ contextId = 'all', trackIds }) {
  if (trackIds !== undefined) {
    if (!Array.isArray(trackIds) || !trackIds.length || trackIds.length > 5000 || trackIds.some((s) => typeof s !== 'string')) throw bad('Choose songs to download');
    const q = db.prepare('SELECT * FROM tracks WHERE id=?');
    const rows = [...new Set(trackIds)].map((id) => q.get(id));
    if (rows.some((t) => !t)) throw bad('Song not found');
    return { name: rows.length === 1 ? rows[0].title : 'Selected songs', rows };
  }
  if (typeof contextId !== 'string' || contextId.length > 200) throw bad('Invalid playlist');
  if (contextId !== 'all') {
    const pl = db.prepare('SELECT * FROM playlists WHERE id=?').get(contextId);
    if (!pl) throw bad('Playlist not found');
    return { name: pl.name, cover: pl.custom_cover && customPath(pl.custom_cover), rows: db.prepare('SELECT t.* FROM tracks t JOIN playlist_tracks pt ON pt.track_id=t.id WHERE pt.playlist_id=? ORDER BY pt.pos').all(pl.id) };
  }
  const all = db.prepare('SELECT * FROM tracks WHERE id IN (SELECT track_id FROM playlist_tracks) ORDER BY added DESC').all();
  const byId = new Map(all.map((t) => [t.id, t])), seen = new Set(), rows = [];
  const add = (id) => { if (!seen.has(id) && byId.has(id)) { seen.add(id); rows.push(byId.get(id)); } };
  const pls = db.prepare("SELECT id FROM playlists WHERE kind IN ('external','import') ORDER BY CASE WHEN kind='external' THEN 0 ELSE 1 END, created DESC").all();
  const pt = db.prepare('SELECT track_id FROM playlist_tracks WHERE playlist_id=? ORDER BY pos');
  for (const p of pls) for (const t of pt.all(p.id)) add(t.track_id);
  for (const t of all) add(t.id);
  return { name: 'All songs', rows };
}

export function createExport(options = {}) {
  if (!options || typeof options !== 'object') throw bad('Choose a download format');
  const format = options.format || 'mix';
  if (!['mix', 'zip'].includes(format)) throw bad('Choose MP3 or ZIP');
  const mode = options.mode || 'crossfade';
  if (!['none', 'fade', 'crossfade'].includes(mode)) throw bad('Invalid transition');
  if (options.shuffle !== undefined && typeof options.shuffle !== 'boolean') throw bad('Invalid shuffle setting');
  const selection = source(options);
  const omitted = [], tracks = [];
  for (const t of selection.rows) {
    const stat = t.status === 'ok' && t.samples > 0 && t.audio_file && statKey(audioPath(t.audio_file));
    if (stat) tracks.push({ ...t, fileStamp: stat, coverStamp: statKey(coverOf(t)) });
    else omitted.push({ id: t.id, title: t.title, author: t.author, reason: t.error || (t.status === 'pending' ? 'Not downloaded yet' : 'Audio is unavailable') });
  }
  if (!tracks.length) throw bad('No downloaded songs available. Unavailable sounds cannot be exported offline.');
  if (options.shuffle) for (let i = tracks.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [tracks[i], tracks[j]] = [tracks[j], tracks[i]]; }
  const id = digest({ format, mode: format === 'mix' ? mode : 'none', name: selection.name,
    tracks: tracks.map((t) => [t.id,t.ver,t.title,t.author,t.fileStamp,t.coverStamp]), omitted, cover: statKey(selection.cover) });
  const existing = jobs.get(id);
  if (existing && existing.status !== 'error' && (existing.status !== 'ready' || fs.existsSync(path.join(dir, existing.file)))) return publicJob(existing);
  const job = { id, status: 'queued', format, mode, name: selection.name, cover: selection.cover || null,
    tracks, omitted, done: 0, total: tracks.length, progress: 0, created: Date.now(), bytes: 0,
    file: id + (format === 'mix' ? '.mp3' : '.zip'), filename: safeName(selection.name) + (format === 'mix' ? ' - offline.mp3' : '.zip') };
  jobs.set(id, job); persist(job); queue.push(job); drain();
  return publicJob(job);
}
export function exportJob(id) { const j = jobs.get(id); return j ? publicJob(j) : null; }
export const recentExports = () => [...jobs.values()].sort((a,b) => b.created-a.created).slice(0,20).map(publicJob);
function publicJob(j) {
  return { id:j.id, status:j.status, format:j.format, mode:j.mode, name:j.name, done:j.done, total:j.total, progress:j.progress,
    omitted:j.omitted.length, bytes:j.bytes, filename:j.filename, error:j.error || null,
    url:j.status === 'ready' ? `/api/exports/${j.id}/file` : null,
    reportUrl:j.status === 'ready' ? `/api/exports/${j.id}/report` : null };
}
export function exportReport(id) {
  const j = jobs.get(id);if (!j) throw bad('Download not found');
  return { name:j.name, tracks:j.tracks.map((t)=>({id:t.id,title:t.title,author:t.author,duration:t.samples/48000})), unavailable:j.omitted, mode:j.mode, format:j.format };
}
const escapeMeta = (v) => String(v || '').replace(/([\\=;#\n\r])/g, '\\$1');
const timestamp = (sec) => { sec=Math.floor(sec);return `${Math.floor(sec/3600)}:${String(Math.floor(sec/60)%60).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`; };
async function makeMix(j, work, update) {
  const raw = path.join(work,'raw.mp3'), meta = path.join(work,'chapters.txt');
  const tl = await renderMixFile(j.tracks.map((t)=>({id:t.id})), j.mode, raw, (p)=>update(p.done,p.progress*.94));
  let text = `;FFMETADATA1\ntitle=${escapeMeta(j.name)}\nartist=Tokify\nalbum=${escapeMeta(j.name)}\n`;
  const lines=[];
  for (let i=0;i<tl.entries.length;i++) {
    const e=tl.entries[i],t=j.tracks[i];const start=Math.round(e.start/48),end=Math.round((tl.entries[i+1]?.start ?? tl.audioEnd)/48);
    text+=`[CHAPTER]\nTIMEBASE=1/1000\nSTART=${start}\nEND=${end}\ntitle=${escapeMeta((t.author ? t.author+' — ' : '')+t.title)}\n`;
    lines.push(`${timestamp(e.start/48000)}  ${oneLine(t.author ? t.author+' — ' : '')}${oneLine(t.title)}`);
  }
  fs.writeFileSync(meta,text);
  const cover=j.cover || coverOf(j.tracks[0]);
  const args=['-hide_banner','-loglevel','error','-y','-i',raw,'-f','ffmetadata','-i',meta];
  if(cover && fs.existsSync(cover))args.push('-i',cover);
  args.push('-map','0:a:0');if(cover && fs.existsSync(cover))args.push('-map','2:v:0','-c:v','mjpeg','-disposition:v','attached_pic');
  args.push('-map_metadata','1','-map_chapters','1','-c:a','copy','-id3v2_version','3',path.join(work,'output.mp3'));
  await run('ffmpeg',args,{maxBytes:1<<20});
  fs.renameSync(path.join(work,'output.mp3'),path.join(dir,j.file));
  fs.writeFileSync(path.join(dir,j.id+'.txt'),`${j.name}\n\n${lines.join('\n')}\n\nUnavailable (${j.omitted.length}):\n${j.omitted.map((t)=>`${oneLine(t.title)} — ${oneLine(t.reason)}`).join('\n')}\n`);
}
async function makeZip(j, work, update) {
  const stage=path.join(work,'bundle'), trackDir=path.join(stage,'tracks'), cache=path.join(dir,'tracks');
  fs.mkdirSync(trackDir,{recursive:true});fs.mkdirSync(cache,{recursive:true});
  let m3u='#EXTM3U\n';
  for(let i=0;i<j.tracks.length;i++){
    const t=j.tracks[i],key=digest([t.id,t.ver,t.title,t.author,t.fileStamp,t.coverStamp,j.name]),file=path.join(cache,key+'.mp3');
    if(!fs.existsSync(file)){
      const tmp=file+'.part.mp3',cover=coverOf(t);
      const args=['-hide_banner','-loglevel','error','-y','-i',audioPath(t.audio_file)];
      if(cover && fs.existsSync(cover))args.push('-i',cover);
      args.push('-map','0:a:0');if(cover && fs.existsSync(cover))args.push('-map','1:v:0','-c:v','mjpeg','-disposition:v','attached_pic');
      args.push('-af',`atrim=start_sample=${t.trim_start}:end_sample=${t.trim_start+t.samples},asetpts=PTS-STARTPTS,volume=${t.gain || 0}dB`,
        '-c:a','libmp3lame','-b:a','192k','-ar','48000','-id3v2_version','3','-metadata',`title=${t.title}`,'-metadata',`artist=${t.author || ''}`,'-metadata',`album=${j.name}`,tmp);
      try{await run('ffmpeg',args,{maxBytes:1<<20});fs.renameSync(tmp,file);}finally{fs.rmSync(tmp,{force:true});}
    }
    const filename=`${String(i+1).padStart(4,'0')} - ${safeName((t.author ? t.author+' - ' : '')+t.title)}.mp3`;
    fs.linkSync(file,path.join(trackDir,filename));
    m3u+=`#EXTINF:${Math.round(t.samples/48000)},${oneLine(t.author ? t.author+' - ' : '')}${oneLine(t.title)}\ntracks/${filename}\n`;
    update(i+1,(i+1)/j.total*.95);
  }
  fs.writeFileSync(path.join(stage,'playlist.m3u8'),m3u);
  fs.writeFileSync(path.join(stage,'library.json'),JSON.stringify(exportReport(j.id),null,2));
  fs.writeFileSync(path.join(stage,'unavailable.txt'),j.omitted.length ? j.omitted.map((t)=>`${oneLine(t.title)} — ${oneLine(t.reason)}`).join('\n') : 'All selected songs are included.\n');
  fs.writeFileSync(path.join(stage,'README.txt'),'Tokify offline music\n\ntracks/ contains MP3 files with title, artist and available cover art.\nplaylist.m3u8 keeps their order in players that support playlists.\nFor continuous playback from iPhone Files, export One continuous MP3 in Tokify instead.\nNo internet or Mac is needed after copying the files to your phone.\n');
  const destination=path.join(work,'output.zip');
  await writeZip(stage,destination);
  fs.renameSync(destination,path.join(dir,j.file));
}
// Stream stored ZIP entries with the UTF-8 flag. No OS zip/locale dependency,
// and backpressure keeps a multi-hour library out of JavaScript memory.
async function writeZip(root,destination){
  const files=[];const walk=(folder)=>{for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const f=path.join(folder,entry.name);if(entry.isDirectory())walk(f);else if(entry.isFile())files.push(f);}};walk(root);
  const bytes=files.reduce((n,f)=>n+fs.statSync(f).size+1024,0);
  if(bytes>0xff000000 || files.length>65000)throw new Error('ZIP exceeds 4 GB. Export smaller playlists instead.');
  const output=fs.createWriteStream(destination);let pending=[],failure;
  output.on('error',e=>{failure=e});
  const archive=new Zip((error,data)=>{if(error)failure=error;else pending.push(Buffer.from(data));});
  const flush=async()=>{for(const data of pending){if(failure)throw failure;if(!output.write(data))await once(output,'drain');}pending=[];if(failure)throw failure;};
  try{
    for(const file of files){const entry=new ZipPassThrough(path.relative(root,file).split(path.sep).join('/'));archive.add(entry);await flush();for await(const data of fs.createReadStream(file)){entry.push(data,false);await flush();}entry.push(new Uint8Array(),true);await flush();}
    archive.end();await flush();output.end();await once(output,'finish');
  }catch(e){archive.terminate();output.destroy();throw e;}
}

async function drain(){
  if(running)return;running=true;
  while(queue.length){
    const j=queue.shift(),work=path.join(dir,j.id+'.work');
    try{
      fs.rmSync(work,{recursive:true,force:true});fs.mkdirSync(work,{recursive:true});j.status='building';persist(j);
      let last=0;const update=(done,progress)=>{j.done=done;j.progress=progress;if(Date.now()-last>1000){last=Date.now();persist(j);}};
      if(j.format==='mix')await makeMix(j,work,update);else await makeZip(j,work,update);
      j.status='ready';j.done=j.total;j.progress=1;j.bytes=fs.statSync(path.join(dir,j.file)).size;delete j.error;
    }catch(e){j.status='error';j.error=`Couldn’t prepare the download: ${e.message}`;console.error('[export]',e.message);}
    finally{fs.rmSync(work,{recursive:true,force:true});persist(j);}
  }
  running=false;
}
export function serveExport(req,res,id){
  const j=jobs.get(id);if(!j || j.status!=='ready')throw bad('Download is not ready');
  const file=path.join(dir,j.file),stat=fs.statSync(file,{throwIfNoEntry:false});if(!stat)throw bad('Prepared file is missing. Prepare it again.');
  const size=stat.size;let start=0,end=size-1,partial=false;
  if(req.headers.range){
    const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if(!m || (!m[1]&&!m[2])){res.writeHead(416,{'Content-Range':`bytes */${size}`});return res.end();}
    partial=true;
    if(!m[1])start=Math.max(0,size-Number(m[2]));else{start=Number(m[1]);if(m[2])end=Math.min(size-1,Number(m[2]));}
    if(start>=size || start>end || !Number.isSafeInteger(start)||!Number.isSafeInteger(end)){res.writeHead(416,{'Content-Range':`bytes */${size}`});return res.end();}
  }
  res.writeHead(partial?206:200,{'Content-Type':j.format==='mix'?'audio/mpeg':'application/zip','Content-Length':end-start+1,
    'Content-Disposition':`attachment; filename="tokify-offline.${j.format==='mix'?'mp3':'zip'}"; filename*=UTF-8''${encodeURIComponent(j.filename)}`,
    'Accept-Ranges':'bytes','Cache-Control':'private, no-store',...(partial?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});
  if(req.method==='HEAD')return res.end();
  const stream=fs.createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
}
// Resume accepted work after a server restart, without contacting TikTok.
for(const name of fs.readdirSync(dir)){
  if(!/^[a-f0-9]{64}\.json$/.test(name))continue;
  try{const j=JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));if(j.id+'.json'!==name)continue;jobs.set(j.id,j);if(['queued','building'].includes(j.status)){j.status='queued';queue.push(j);}}catch{}
}
if(queue.length)setImmediate(drain);

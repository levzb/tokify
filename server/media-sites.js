import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, DIRS, db, uid } from './db.js';
import { run, analyze, audioPath, coverPath, normalizeImage, coverColor } from './audio.js';
import { analysisWithClip } from './clips.js';
import { parseMediaLink } from '../shared/media-link.js';
import { SoundError } from './tiktok.js';

export const MAX_MEDIA_SECONDS=2700;
function downloader(){
  if(process.env.TOKIFY_YTDLP)return process.env.TOKIFY_YTDLP;
  const local=path.join(ROOT,'data','tools','yt-dlp',process.platform==='win32'?'Scripts/yt-dlp.exe':'bin/yt-dlp');
  return fs.existsSync(local)?local:'yt-dlp';
}
const baseArgs=()=>['--ignore-config','--no-playlist','--no-progress','--no-warnings','--no-cache-dir',
  '--socket-timeout','20','--retries','1','--extractor-retries','1','--js-runtimes',`node:${process.execPath}`,
  '--use-extractors','youtube.*,soundcloud.*'];
export function runDownloader(args,{timeout=100_000,maxBytes=12<<20}={}){
  return new Promise((resolve,reject)=>{
    const p=spawn(downloader(),[...baseArgs(),...args],{stdio:['ignore','pipe','pipe'],windowsHide:true});
    const out=[],err=[];let size=0,settled=false;
    const finish=(e,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(e)reject(e);else resolve(value);};
    const stop=(message)=>{p.kill('SIGTERM');const kill=setTimeout(()=>p.kill('SIGKILL'),2000);kill.unref();finish(new SoundError(message));};
    const timer=setTimeout(()=>stop('The source took too long to respond. Try again.'),timeout);
    p.stdout.on('data',b=>{size+=b.length;if(size>maxBytes)stop('The source returned too much data');else out.push(b);});
    p.stderr.on('data',b=>{if(err.reduce((n,s)=>n+s.length,0)<20000)err.push(b);});
    p.on('error',e=>finish(new SoundError(e.code==='ENOENT'?'YouTube and SoundCloud support needs yt-dlp. On the Mac run: npm run setup:media':'Couldn’t start the audio downloader')));
    p.on('close',code=>{
      if(code===0)return finish(null,Buffer.concat(out).toString('utf8'));
      const message=Buffer.concat(err).toString('utf8').replace(/\x1b\[[0-9;]*m/g,'').trim();
      finish(new SoundError(message ? message.split('\n').filter(s=>/ERROR:/i.test(s)).pop()?.replace(/^ERROR:\s*/,'').slice(0,500) || 'The source is unavailable. Check the link and internet connection.' : 'The source is unavailable. Check the link and internet connection.'));
    });
  });
}
export function metadataFromDownloader(raw,link){
  if(!raw || raw._type==='playlist' || raw.entries)throw new SoundError('Choose an individual video or track');
  if(raw.is_live || ['is_live','is_upcoming'].includes(raw.live_status))throw new SoundError('Live and upcoming streams cannot be downloaded');
  if(!Number.isFinite(raw.duration) || raw.duration<=0)throw new SoundError('No audio duration was found');
  if(raw.duration>MAX_MEDIA_SECONDS)throw new SoundError('Maximum length is 45 minutes per track');
  if(raw.is_preview || /preview/i.test(raw.format_id || '') || (raw.requested_downloads || []).some(f=>/preview/i.test(f.format_id || '')))throw new SoundError('Only a preview is available. The full track cannot be downloaded.');
  if(raw.has_drm || ['premium_only','subscriber_only','needs_auth','private'].includes(raw.availability))throw new SoundError('This track requires access that the downloader does not have');
  const id=String(raw.id || '');
  if(link.provider==='youtube' && !/^[A-Za-z0-9_-]{11}$/.test(id))throw new SoundError('Invalid YouTube video metadata');
  if(link.provider==='soundcloud' && !/^\d{1,22}$/.test(id))throw new SoundError('Invalid SoundCloud track metadata');
  const musicId=(link.provider==='youtube'?'yt-':'sc-')+id;
  let coverUrl='';try{const u=new URL(raw.thumbnail);if(u.protocol==='https:')coverUrl=u.href;}catch{}
  const sourceUrl=link.provider==='youtube'?`https://www.youtube.com/watch?v=${id}`:parseMediaLink(raw.webpage_url || link.url).url;
  return {musicId,provider:link.provider,title:raw.track || raw.title || 'Untitled',author:raw.artist || raw.uploader || raw.channel || '',duration:raw.duration,coverUrl,sourceUrl};
}
const metadataCache = new Map();
export async function resolveMediaSite(link){
  const cached=metadataCache.get(link.url);if(cached?.expires>Date.now())return cached.info;
  const text=await runDownloader(['--skip-download','--dump-single-json','-f','bestaudio/best[height<=480]',link.url]);
  let raw;try{raw=JSON.parse(text);}catch{throw new SoundError('The source returned invalid track information');}
  const info=metadataFromDownloader(raw,link);
  const entry={info,expires:Date.now()+10*60_000};metadataCache.set(link.url,entry);metadataCache.set(info.sourceUrl,entry);
  while(metadataCache.size>200)metadataCache.delete(metadataCache.keys().next().value);
  return info;
}
export async function fetchMediaCover(url,dest){
  const u=new URL(url);if(u.protocol!=='https:')throw new SoundError('Invalid cover URL');
  const r=await fetch(u,{signal:AbortSignal.timeout(25_000),headers:{'User-Agent':'Mozilla/5.0'}});
  if(!r.ok)throw new SoundError('Cover unavailable');
  const parts=[];let size=0;for await(const b of r.body){size+=b.length;if(size>10<<20){throw new SoundError('Cover is too large');}parts.push(b);}
  fs.writeFileSync(dest,Buffer.concat(parts));
}
export async function processMediaTrack(id){
  const t=db.prepare('SELECT * FROM tracks WHERE id=?').get(id);
  if(!t || !['youtube','soundcloud'].includes(t.origin))throw new SoundError('Unknown audio source');
  const link=parseMediaLink(t.link),work=path.join(DIRS.tmp,`${id}-${uid()}`);fs.mkdirSync(work,{recursive:true});
  try{
    const info=await resolveMediaSite(link);
    if(info.musicId!==id)throw new SoundError('The link now points to a different track');
    db.prepare('UPDATE tracks SET title=COALESCE(title_override,?),author=COALESCE(author_override,?) WHERE id=?').run(info.title,info.author,id);
    await runDownloader(['-f','bestaudio/best[height<=480]','--max-filesize','512M','--match-filter','!is_live & duration <= 2700',
      '--extract-audio','--audio-format','m4a','--audio-quality','192K','--output',path.join(work,'audio.%(ext)s'),info.sourceUrl],{timeout:12*60_000,maxBytes:1<<20});
    const downloaded=path.join(work,'audio.m4a');if(!fs.existsSync(downloaded))throw new SoundError('No playable audio was downloaded');
    const probe=await run('ffprobe',['-v','error','-show_entries','format=duration','-of','json',downloaded],{maxBytes:10000});
    const seconds=Number(JSON.parse(probe.stdout.toString()).format?.duration || 0);
    if(seconds<info.duration-Math.max(5,info.duration*.15))throw new SoundError('The source returned only part of this recording. The full track is unavailable.');
    if(seconds>MAX_MEDIA_SECONDS+5)throw new SoundError('Maximum length is 45 minutes per track');
    const a=analysisWithClip(id,await analyze(downloaded));const audioFile=id+'.m4a';fs.renameSync(downloaded,audioPath(audioFile));
    let coverFile=null,color=t.color || '#ffffff';
    if(info.coverUrl){const tmp=path.join(work,'cover');try{await fetchMediaCover(info.coverUrl,tmp);coverFile=id+'.jpg';await normalizeImage(tmp,coverPath(coverFile));color=await coverColor(coverPath(coverFile));}catch{coverFile=null;}}
    db.prepare(`UPDATE tracks SET status='ok',error=NULL,title=COALESCE(title_override,?),author=COALESCE(author_override,?),samples=?,trim_start=?,gain=?,audio_file=?,cover_file=COALESCE(?,cover_file),color=?,base_trim_start=?,base_samples=?,clip_start=?,clip_end=?,ver=ver+1 WHERE id=?`)
      .run(info.title,info.author,a.samples,a.trimStart,a.gain,audioFile,coverFile,color,a.baseStart,a.baseSamples,a.clipStart,a.clipEnd,id);
    return false;
  }finally{fs.rmSync(work,{recursive:true,force:true});}
}

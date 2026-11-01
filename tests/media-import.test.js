import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
const data=fs.mkdtempSync(path.join(os.tmpdir(),'tokify-media-import-'));process.env.TOKIFY_DATA=data;
const fake=path.join(data,'fake-dlp.mjs');process.env.TOKIFY_YTDLP=fake;
fs.writeFileSync(fake,`#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';
const args=process.argv.slice(2),url=args.at(-1),sc=url.includes('soundcloud'),bad=url.includes('failure');
if(bad){console.error('ERROR: This recording is unavailable');process.exit(1);}
if(args.includes('--dump-single-json'))console.log(JSON.stringify({id:sc?'293':'jNQXAC9IVRw',title:sc?'My SoundCloud track':'My YouTube video',uploader:'My artist',duration:2,webpage_url:sc?'https://soundcloud.com/forss/flickermood':'https://www.youtube.com/watch?v=jNQXAC9IVRw',format_id:'audio'}));
else {const file=args[args.indexOf('--output')+1].replace('%(ext)s','m4a');fs.copyFileSync(process.env.MEDIA_FIXTURE,file);fs.appendFileSync(process.env.MEDIA_COUNT,'audio\\n');}
`,{mode:0o755});
const{db}=await import('../server/db.js');const{setClip}=await import('../server/clips.js');const{previewLink,downloadLink}=await import('../server/link-import.js');const{jobStatus,retryTrack}=await import('../server/importer.js');
const wav=path.join(data,'fixture.m4a');assert.equal(spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=440:duration=2:sample_rate=48000','-c:a','aac','-ac','2',wav]).status,0);process.env.MEDIA_FIXTURE=wav;process.env.MEDIA_COUNT=path.join(data,'count.txt');
async function finish(id){for(let i=0;i<200;i++){const j=jobStatus(id);if(j.finished)return j;await new Promise(r=>setTimeout(r,30));}throw Error('Media job timed out');}
await test('YouTube and SoundCloud processing use one external playlist and preserve metadata on retry',async(t)=>{
 t.after(()=>{db.close();fs.rmSync(data,{recursive:true,force:true});});let playlist;
 for(const [url,origin,id]of [['https://www.youtube.com/watch?v=jNQXAC9IVRw','youtube','yt-jNQXAC9IVRw'],['https://soundcloud.com/forss/flickermood','soundcloud','sc-293']]){
  const p=await previewLink(url);assert.equal(p.provider,origin);assert.equal(p.canDownload,true);assert.equal(fs.existsSync(process.env.MEDIA_COUNT),!!playlist,'lookup must not download audio');const r=downloadLink(p.token);const job=await finish(r.jobId);assert.equal(job.ok,1);assert.equal(job.failed,0);if(!playlist)playlist=r.playlistId;assert.equal(r.playlistId,playlist);
  const row=db.prepare('SELECT * FROM tracks WHERE id=?').get(id);assert.equal(row.origin,origin);assert.equal(row.status,'ok');assert.ok(row.samples>90000);assert.ok(fs.existsSync(path.join(data,'audio',row.audio_file)));
  const again=await previewLink(url);assert.equal(again.saved,true);assert.equal((await finish(downloadLink(again.token).jobId)).reused,1);
 }
 assert.equal(fs.readFileSync(process.env.MEDIA_COUNT,'utf8').trim().split('\n').length,2);
 db.prepare("UPDATE tracks SET title='My edited song',author='',title_override='My edited song',author_override='' WHERE id='yt-jNQXAC9IVRw'").run();const tiktok=db.prepare("SELECT audio_file FROM tracks WHERE id='yt-jNQXAC9IVRw'").get();setClip('yt-jNQXAC9IVRw',{start:.3,end:1.5});fs.rmSync(path.join(data,'audio',tiktok.audio_file));assert.equal((await finish(retryTrack('yt-jNQXAC9IVRw').id)).ok,1);const edited=db.prepare("SELECT title,author FROM tracks WHERE id='yt-jNQXAC9IVRw'").get();assert.equal(edited.title,'My edited song');assert.equal(edited.author,'');const clipped=db.prepare("SELECT samples,trim_start,base_samples FROM tracks WHERE id='yt-jNQXAC9IVRw'").get();assert.equal(clipped.samples,57600);assert.ok(clipped.trim_start>=14400);assert.ok(clipped.base_samples>90000);
 const spotify=await previewLink('https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl',{resolve:async()=>({provider:'spotify',metadataOnly:true,title:'Spotify song',author:'Artist',duration:200,musicId:null})});assert.equal(spotify.canDownload,false);assert.throws(()=>downloadLink(spotify.token),/Spotify/);assert.equal(db.prepare('SELECT COUNT(*) n FROM tracks').get().n,2);
});

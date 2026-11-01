import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'tokify-links-'));
process.env.TOKIFY_DATA = data;
const { db } = await import('../server/db.js');
const { previewLink, downloadLink, linkPreviewCover } = await import('../server/link-import.js');
const { jobStatus, retryTrack } = await import('../server/importer.js');
const fixture = path.join(data, 'fixture.wav');
assert.equal(spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=330:duration=2:sample_rate=48000','-ac','2',fixture]).status,0);
const wav=fs.readFileSync(fixture),image=fs.readFileSync(new URL('../public/icon-512.png',import.meta.url));
let audioRequests=0;
const media=http.createServer((req,res)=>{
  if(req.url==='/audio'){audioRequests++;res.writeHead(200,{'Content-Type':'audio/wav'});res.end(wav);}
  else if(req.url==='/cover'){res.writeHead(200,{'Content-Type':'image/png'});res.end(image);}
  else{res.writeHead(404);res.end();}
});
await new Promise(r=>media.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${media.address().port}`;
const musicId='7500000000000000001';
const metadata={musicId,title:'Video sound',author:'Fixture artist',duration:2,playUrl:base+'/audio',coverUrl:base+'/cover'};
const resolve=async()=>metadata;
async function finish(id){for(let i=0;i<200;i++){const j=jobStatus(id);if(j.finished)return j;await new Promise(r=>setTimeout(r,25));}throw Error('Import timed out');}
await test('video link preview, real audio processing, shared external destination, failures and deduplication',async(t)=>{
 t.after(async()=>{await new Promise(r=>media.close(r));db.close();fs.rmSync(data,{recursive:true,force:true});});
 const found=await previewLink('https://www.tiktok.com/@creator/video/7400000000000000001',{resolve});
 assert.equal(found.title,'Video sound');assert.equal(found.saved,false);assert.equal(db.prepare('SELECT COUNT(*) n FROM tracks').get().n,0);assert.equal(audioRequests,0,'preview must not download audio');
 assert.ok((await linkPreviewCover(found.token)).length>100);
 const result=downloadLink(found.token);assert.deepEqual(downloadLink(found.token),result);
 const job=await finish(result.jobId);assert.equal(job.ok,1);assert.equal(job.failed,0);assert.equal(audioRequests,1);
 const pl=db.prepare('SELECT * FROM playlists WHERE id=?').get(result.playlistId);assert.equal(pl.kind,'external');assert.equal(pl.name,'Мои файлы');
 const track=db.prepare('SELECT * FROM tracks WHERE id=?').get(musicId);assert.equal(track.status,'ok');assert.equal(track.origin,'tiktok');assert.equal(track.author,'Fixture artist');assert.ok(track.samples>95000);assert.ok(track.cover_file);assert.ok(fs.existsSync(path.join(data,'audio',track.audio_file)));
 // A redownload must retain local edits, including an intentionally empty artist.
 db.prepare("UPDATE tracks SET title='My edited title',author='',title_override='My edited title',author_override='' WHERE id=?").run(musicId);
 fs.rmSync(path.join(data,'audio',track.audio_file));
 const retry=retryTrack(musicId);assert.equal((await finish(retry.id)).ok,1);assert.equal(audioRequests,2);
 const edited=db.prepare('SELECT title,author FROM tracks WHERE id=?').get(musicId);assert.equal(edited.title,'My edited title');assert.equal(edited.author,'');
 const again=await previewLink(`https://www.tiktok.com/music/sound-${musicId}`,{resolve:()=>{throw Error('Cached sound should not hit TikTok');}});
 assert.equal(again.title,'My edited title');assert.equal(again.author,'');
 assert.equal(again.saved,true);assert.equal(again.playlistId,pl.id);assert.ok(await linkPreviewCover(again.token));
 const duplicate=downloadLink(again.token);assert.equal((await finish(duplicate.jobId)).reused,1);assert.equal(audioRequests,2);assert.equal(db.prepare('SELECT COUNT(*) n FROM playlist_tracks').get().n,1);
 db.prepare('UPDATE playlists SET name=? WHERE id=?').run('My renamed files',pl.id);
 const brokenId='7500000000000000002';
 const broken=await previewLink('https://www.tiktok.com/@creator/video/7400000000000000002',{resolve:async()=>({...metadata,musicId:brokenId,playUrl:base+'/missing'})});
 const failed=downloadLink(broken.token);const failure=await finish(failed.jobId);assert.equal(failure.failed,1);assert.equal(failed.playlistId,pl.id);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM playlists').get().n,1);assert.equal(db.prepare('SELECT status FROM tracks WHERE id=?').get(brokenId).status,'failed');assert.match(db.prepare('SELECT error FROM tracks WHERE id=?').get(brokenId).error,/404/);assert.equal(db.prepare('SELECT COUNT(*) n FROM playlist_tracks').get().n,2,'unavailable sound remains visible');
 await assert.rejects(previewLink('https://www.tiktok.com/@person/video/7400000000000000003',{resolve:async()=>{throw Error('Private video');}}),/Private video/);
 assert.throws(()=>downloadLink('expired'),/expired/);
});

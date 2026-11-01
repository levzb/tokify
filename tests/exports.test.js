import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { unzipSync, strFromU8 } from 'fflate';
import { buildTimeline } from '../shared/timeline.js';
const data=fs.mkdtempSync(path.join(os.tmpdir(),'tokify-exports-'));process.env.TOKIFY_DATA=data;
const {db}=await import('../server/db.js');
const {createExport,exportJob,exportReport,safeName}=await import('../server/exports.js');
// Offline preparation must never fetch remote resources.
globalThis.fetch=()=>{throw Error('Export attempted a network request');};
const ids=['7400000000000000001','7400000000000000002'];
const probe=(file)=>JSON.parse(spawnSync('ffprobe',['-v','error','-show_format','-show_chapters','-show_streams','-of','json',file],{encoding:'utf8'}).stdout);
for(const [i,id]of ids.entries()){
 assert.equal(spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i',`sine=frequency=${330+i*110}:duration=3:sample_rate=48000`,'-ac','2',path.join(data,'audio',id+'.wav')]).status,0);
 db.prepare("INSERT INTO tracks(id,title,author,status,samples,audio_file,cover_file,source_name,added) VALUES(?,?,?,'ok',?,?,?,?,?)").run(id,['Ночной звук🎵','../Other/Title'][i],'Мой автор',144000,id+'.wav',i===0?'fixture.png':null,'Export test',i);
}
fs.copyFileSync(new URL('../public/icon-512.png',import.meta.url),path.join(data,'covers','fixture.png'));
db.prepare("INSERT INTO tracks(id,title,status,error) VALUES('7400000000000000003','Unavailable sound','failed','Removed by TikTok')").run();
db.prepare("INSERT INTO playlists(id,name,kind,created) VALUES('fixture','Мой плейлист','import',1)").run();
for(const [i,id]of [...ids,'7400000000000000003'].entries())db.prepare("INSERT INTO playlist_tracks VALUES('fixture',?,?)").run(id,i);
db.prepare("INSERT INTO playlists(id,name,kind,created) VALUES('duplicate','Duplicate','custom',2)").run();db.prepare("INSERT INTO playlist_tracks VALUES('duplicate',?,0)").run(ids[0]);
async function finish(id){for(let i=0;i<400;i++){const j=exportJob(id);if(['ready','error'].includes(j.status)){assert.equal(j.status,'ready',j.error);return j;}await new Promise(r=>setTimeout(r,25));}throw Error('Export timed out');}
await test('offline exports: continuous transitions, portable ZIP, metadata, cache and persistence',async(t)=>{
 t.after(()=>{db.close();fs.rmSync(data,{recursive:true,force:true});});
 await t.test('invalid, empty and unavailable selections are explained',()=>{
   for(const options of [{format:'bad'},{mode:'bad'},{contextId:'missing'},{trackIds:[]},{trackIds:['../no']},{trackIds:['7400000000000000003']}])assert.throws(()=>createExport(options));
   assert.ok(Buffer.byteLength(safeName('🎵'.repeat(200)))<=180);assert.ok(!safeName('../My/track').includes('/'));
 });
 for(const mode of ['none','fade','crossfade'])await t.test(`one offline MP3 contains every ready song and baked ${mode} transitions`,async()=>{
   const started=createExport({contextId:'all',format:'mix',mode});
   assert.equal(started.total,2,'duplicate playlist memberships must not duplicate songs');assert.equal(started.omitted,1);
   assert.equal(createExport({contextId:'all',format:'mix',mode}).id,started.id);
   const job=await finish(started.id),file=path.join(data,'exports',job.id+'.mp3');assert.equal(fs.statSync(file).size,job.bytes);
   const info=probe(file),timeline=buildTimeline(ids.map(id=>({id,samples:144000})),mode);
   assert.ok(Math.abs(Number(info.format.duration)-timeline.frames*1152/48000)<.1);
   assert.equal(info.chapters.length,2);assert.equal(info.chapters[0].tags.title,'Мой автор — Ночной звук🎵');assert.equal(info.streams[0].codec_name,'mp3');assert.equal(info.format.tags.title,'All songs');
   const report=exportReport(job.id);assert.equal(report.unavailable.length,1);assert.match(report.unavailable[0].reason,/Removed/);
   const modified=fs.statSync(file).mtimeMs;assert.equal(createExport({contextId:'all',format:'mix',mode}).status,'ready');assert.equal(fs.statSync(file).mtimeMs,modified);
 });
 await t.test('ZIP has separate tagged MP3s, a playlist, Unicode names and an unavailable report',async()=>{
   const job=await finish(createExport({contextId:'fixture',format:'zip'}).id);
   const zip=unzipSync(fs.readFileSync(path.join(data,'exports',job.id+'.zip'))),names=Object.keys(zip),mp3s=names.filter(n=>n.endsWith('.mp3'));
   assert.equal(mp3s.length,2);assert.ok(names.every(n=>!n.split('/').includes('..')));assert.match(strFromU8(zip['playlist.m3u8']),/Ночной звук/);assert.match(strFromU8(zip['unavailable.txt']),/Removed by TikTok/);
   assert.equal(JSON.parse(strFromU8(zip['library.json'])).unavailable.length,1);
   const file=path.join(data,'verify.mp3');fs.writeFileSync(file,zip[mp3s.find(n=>n.includes('Ночной'))]);const info=probe(file);assert.equal(info.format.tags.title,'Ночной звук🎵');assert.equal(info.format.tags.artist,'Мой автор');assert.ok(info.streams.some(s=>s.disposition.attached_pic));
 });
 await t.test('completed exports survive module restart and metadata edits invalidate the prepared copy',async()=>{
   const old=createExport({trackIds:[ids[0]],format:'mix'});await finish(old.id);
   const restarted=await import('../server/exports.js?reload=1');assert.equal(restarted.exportJob(old.id).status,'ready');
   db.prepare('UPDATE tracks SET title=?,ver=ver+1 WHERE id=?').run('Edited title',ids[0]);
   const updated=createExport({trackIds:[ids[0]],format:'mix'});assert.notEqual(updated.id,old.id);await finish(updated.id);
 });
});

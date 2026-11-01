import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import{spawnSync}from'node:child_process';
const data=fs.mkdtempSync(path.join(os.tmpdir(),'tokify-clips-'));process.env.TOKIFY_DATA=data;
const{db}=await import('../server/db.js'),{clipInfo,setClip,analysisWithClip}=await import('../server/clips.js'),{renderMixFile}=await import('../server/stream.js');
const id='yt-jNQXAC9IVRw',file=path.join(data,'audio','fixture.wav');
assert.equal(spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=220:duration=4:sample_rate=48000','-f','lavfi','-i','sine=frequency=880:duration=4:sample_rate=48000','-filter_complex','[0:a][1:a]concat=n=2:v=0:a=1','-ac','2',file]).status,0);
db.prepare("INSERT INTO tracks(id,title,author,status,samples,trim_start,audio_file,origin) VALUES(?,'An editable song','Artist','ok',384000,0,'fixture.wav','youtube')").run(id);
for(const pl of ['a','b']){db.prepare("INSERT INTO playlists(id,name,kind,created)VALUES(?,?,'custom',1)").run(pl,pl);db.prepare('INSERT INTO playlist_tracks VALUES(?,?,0)').run(pl,id);}
const hash=()=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
await test('non-destructive excerpts: waveform, exact source range, expansion, reset and retry',async(t)=>{
 t.after(()=>{db.close();fs.rmSync(data,{recursive:true,force:true});});const original=hash();
 const initial=await clipInfo(id);assert.equal(initial.duration,8);assert.equal(initial.start,0);assert.equal(initial.end,8);assert.equal(initial.edited,false);assert.ok(initial.waveform.length>100);assert.ok(initial.waveform.every(n=>n>=0&&n<=1));
 for(const range of [{start:-1,end:3},{start:1,end:9},{start:1,end:1.1},{start:'1',end:2},{start:NaN,end:2},{start:4,end:2}])assert.throws(()=>setClip(id,range));
 setClip(id,{start:1,end:3,version:initial.version});assert.throws(()=>setClip(id,{start:2,end:4,version:initial.version}),/changed/);
 const next=await clipInfo(id);assert.equal(next.duration,8);assert.equal(next.start,1);assert.equal(next.end,3);
 // Widen/move beyond the currently saved two-second excerpt using the intact original.
 setClip(id,{start:5,end:7,version:next.version});const row=db.prepare('SELECT * FROM tracks WHERE id=?').get(id);assert.equal(row.trim_start,240000);assert.equal(row.samples,96000);assert.equal(row.base_samples,384000);assert.equal(hash(),original);assert.equal(db.prepare('SELECT COUNT(*) n FROM playlist_tracks WHERE track_id=?').get(id).n,2);
 const rendered=path.join(data,'excerpt.mp3');await renderMixFile([{id}],'none',rendered);
 const r=spawnSync('ffmpeg',['-v','error','-ss','0.4','-i',rendered,'-t','1','-f','f32le','-ar','48000','-ac','1','pipe:1']);assert.equal(r.status,0,r.stderr.toString());const pcm=new Float32Array(r.stdout.buffer,r.stdout.byteOffset,r.stdout.length/4);let crossings=0;for(let i=1;i<pcm.length;i++)if(pcm[i-1]<=0&&pcm[i]>0)crossings++;assert.ok(Math.abs(crossings-880)<4,`expected selected 880 Hz segment, got ${crossings}`);
 const reapplied=analysisWithClip(id,{samples:384000,trimStart:500,gain:0});assert.equal(reapplied.trimStart,240500);assert.equal(reapplied.samples,96000);assert.equal(reapplied.baseStart,500);assert.equal(reapplied.clipStart,240000);
 setClip(id,{reset:true});const restored=db.prepare('SELECT * FROM tracks WHERE id=?').get(id);assert.equal(restored.samples,384000);assert.equal(restored.trim_start,0);assert.equal(restored.clip_start,null);assert.equal(hash(),original);
});

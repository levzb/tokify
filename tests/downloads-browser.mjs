import { chromium, webkit, devices } from 'playwright';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import { spawn,spawnSync } from 'node:child_process';import {once} from 'node:events';import {DatabaseSync} from 'node:sqlite';
const root=path.resolve(import.meta.dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'tokify-download-ui-'));
const env={...process.env,TOKIFY_DATA:data,HOST:'127.0.0.1',PORT:'18797'},base='http://127.0.0.1:18797';let server,logs='';
try{
 assert.equal(spawnSync(process.execPath,['--input-type=module','-e',"import {setPassword} from './server/auth.js';setPassword('download-test-password');"],{cwd:root,env}).status,0);
 const db=new DatabaseSync(path.join(data,'library.sqlite'));
 db.prepare("INSERT INTO playlists(id,name,kind,created) VALUES('download-fixture','Night drive','import',1)").run();
 for(let i=0;i<2;i++){const id=String(7300000000000000001n+BigInt(i));assert.equal(spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i',`sine=frequency=${330+i*110}:duration=4:sample_rate=48000`,'-ac','2',path.join(data,'audio',id+'.wav')]).status,0);db.prepare("INSERT INTO tracks(id,title,author,status,samples,audio_file,source_name,added) VALUES(?,?,?,'ok',?,?,?,?)").run(id,['Afterglow','Night drive'][i],['Luma','Vela'][i],192000,id+'.wav','Night drive',i);db.prepare("INSERT INTO playlist_tracks VALUES('download-fixture',?,?)").run(id,i);}
 db.prepare("INSERT INTO tracks(id,title,status,error) VALUES('7300000000000000003','Missing sound','failed','Removed from TikTok')").run();db.prepare("INSERT INTO playlist_tracks VALUES('download-fixture','7300000000000000003',2)").run();db.close();
 server=spawn(process.execPath,['server/index.js'],{cwd:root,env,stdio:['ignore','pipe','pipe']});server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/me')).ok)break}catch{}await new Promise(r=>setTimeout(r,50));}
 for(const[name,engine,options]of[['desktop',chromium,{viewport:{width:1440,height:1000}}],['iphone',webkit,{...devices['iPhone 13']}]]){
  const b=await engine.launch(),ctx=await b.newContext({...options,acceptDownloads:true});
  try{
   await ctx.request.post(base+'/api/login',{data:{password:'download-test-password'}});const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.getByRole('heading',{name:'Uploads',exact:true}).waitFor();
   await p.getByRole('button',{name:'Download library',exact:true}).click();const modal=p.getByRole('dialog',{name:'Listen offline',exact:true});await modal.waitFor();assert.match(await modal.innerText(),/2 ready · 1 unavailable/);
   await p.waitForTimeout(450);await p.screenshot({path:`screenshots/download-config-${name}.png`});
   await p.getByRole('button',{name:'Prepare download',exact:true}).click();await p.getByRole('link',{name:'Download MP3',exact:true}).waitFor({timeout:30000});await p.waitForTimeout(450);await p.screenshot({path:`screenshots/download-ready-${name}.png`});
   const event=p.waitForEvent('download');await p.getByRole('link',{name:'Download MP3',exact:true}).click();const download=await event;assert.match(download.suggestedFilename(),/offline\.mp3$/);const saved=path.join(data,`saved-${name}.mp3`);await download.saveAs(saved);assert.ok(fs.statSync(saved).size>50000);
   const report=await ctx.request.get(base+await p.getByRole('link',{name:'download report',exact:true}).getAttribute('href'));assert.equal((await report.json()).unavailable.length,1);
   await p.getByRole('button',{name:'Close download',exact:true}).click();await p.goto(base+'/#/p/download-fixture');await p.getByRole('button',{name:'Download playlist',exact:true}).click();await modal.waitFor();await p.getByRole('button',{name:'Close download',exact:true}).click();
   if(name==='desktop'){
    await p.getByRole('button',{name:'Download playlist',exact:true}).click();await p.getByRole('radio',{name:'Separate songs · ZIP',exact:false}).click();await p.getByRole('button',{name:'Prepare download',exact:true}).click();await p.getByRole('link',{name:'Download ZIP',exact:true}).waitFor({timeout:30000});await p.getByRole('button',{name:'Close download',exact:true}).click();
   }
   // Test the actual downloaded bytes with every network request disabled.
   await ctx.setOffline(true);const offline=await ctx.newPage();await offline.setContent('<input type="file"><audio controls></audio><button>Play saved music</button><script>document.querySelector("button").onclick=()=>{const f=document.querySelector("input").files[0],a=document.querySelector("audio");a.src=URL.createObjectURL(f);a.play();};</script>');
   await offline.locator('input').setInputFiles(saved);await offline.getByRole('button',{name:'Play saved music'}).click();await offline.waitForFunction(()=>document.querySelector('audio').currentTime>5,{},{timeout:20000});
   assert.ok(await offline.locator('audio').evaluate(a=>a.duration>6&&a.duration<8));assert.equal(await offline.locator('audio').evaluate(a=>a.paused),false);
   await offline.locator('audio').evaluate(a=>{a.currentTime=1});await offline.waitForFunction(()=>document.querySelector('audio').currentTime>1.2);assert.deepEqual(errors,[]);
   console.log(`${name}: offline export, counts/report, MP3 download, playlist controls and actual saved-file playback/seek with network disabled passed`);
  }finally{await b.close();}
 }
}finally{if(server?.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}fs.rmSync(data,{recursive:true,force:true});if(logs.includes('[export]'))console.log(logs);}

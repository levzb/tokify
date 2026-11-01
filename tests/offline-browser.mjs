import { chromium, webkit } from 'playwright';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';import {DatabaseSync} from 'node:sqlite';
const root=path.resolve(import.meta.dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'tokify-local-edit-'));
const env={...process.env,TOKIFY_DATA:data,PORT:'18798',HOST:'127.0.0.1',TOKIFY_NO_OPEN:'1'},base='http://127.0.0.1:18798';let pid;
function boot(){const r=spawnSync(process.execPath,['scripts/offline.mjs'],{cwd:root,env,encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);pid=Number(fs.readFileSync(path.join(data,'server.pid'),'utf8'));}
async function stop(){if(!pid)return;try{process.kill(pid,'SIGTERM');}catch{}for(let i=0;i<100;i++){try{process.kill(pid,0);}catch{pid=null;return;}await new Promise(r=>setTimeout(r,50));}throw Error('Local server did not stop');}
try{
 assert.equal(spawnSync(process.execPath,['--input-type=module','-e',"import {setPassword} from './server/auth.js';setPassword('local-test-password');"],{cwd:root,env}).status,0);
 const ids=['7200000000000000001','7200000000000000002','7200000000000000003'];const db=new DatabaseSync(path.join(data,'library.sqlite'));
 db.prepare("INSERT INTO playlists(id,name,kind,created) VALUES('source','My saved sounds','import',1)").run();
 for(const [i,id]of ids.entries()){
  assert.equal(spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i',`sine=frequency=${330+i*110}:duration=6:sample_rate=48000`,'-ac','2',path.join(data,'audio',id+'.wav')]).status,0);
  db.prepare("INSERT INTO tracks(id,title,author,status,samples,audio_file,source_name,added) VALUES(?,?,?,'ok',?,?,?,?)").run(id,['Afterglow','Night drive','Slow motion'][i],['Luma','Vela','Mira Lane'][i],288000,id+'.wav','My saved sounds',i);
  db.prepare("INSERT INTO playlist_tracks VALUES('source',?,?)").run(id,i);
 }db.close();boot();
 for(const [name,engine]of [['chromium',chromium],['safari',webkit]]){
  const browser=await engine.launch(),ctx=await browser.newContext({viewport:{width:1440,height:1000}});let outside=0;
  try{
   await ctx.addInitScript(()=>Object.defineProperty(navigator,'onLine',{get:()=>false}));
   await ctx.route('**/*',route=>{const host=new URL(route.request().url()).hostname;if(['127.0.0.1','localhost'].includes(host))return route.continue();outside++;return route.abort();});
   await ctx.request.post(base+'/api/login',{data:{password:'local-test-password'}});const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.getByRole('heading',{name:'Uploads',exact:true}).waitFor();assert.equal(await p.evaluate(()=>navigator.onLine),false);
   const flight=`Flight mix · ${name}`,ambient=`Ambient · ${name}`;
   async function create(name){await p.getByRole('button',{name:/^New playlist/}).click();await p.locator('.hero .title').waitFor();const id=decodeURIComponent(p.url().split('/p/')[1]);await p.locator('.hero .title').click();await p.getByRole('dialog',{name:'Rename',exact:true}).locator('input').fill(name);await p.getByRole('button',{name:'Save',exact:true}).click();await p.locator('.hero .title').filter({hasText:name}).waitFor();return id;}
   const flightId=await create(flight);await p.getByRole('button',{name:'Home',exact:true}).click();
   async function add(names,playlist){await p.getByRole('tab',{name:'All songs',exact:true}).click();await p.getByRole('button',{name:'Select',exact:true}).click();for(const name of names)await p.locator('.list .row').filter({hasText:name}).locator('.title').click();await p.getByRole('button',{name:'Add to playlist',exact:true}).click();await p.getByRole('menuitem',{name:playlist,exact:true}).click();await p.getByRole('button',{name:'Select',exact:true}).waitFor();}
   await add(['Afterglow','Night drive'],flight);await p.locator('.rail').getByRole('button',{name:flight,exact:true}).click();await p.locator('.hero .title').filter({hasText:flight}).waitFor();await p.waitForFunction(()=>document.querySelectorAll('.list .row').length===2);
   const before=await p.locator('.list .row .title').allTextContents(),a=await p.locator('.list .row').first().boundingBox(),b=await p.locator('.list .row').nth(1).boundingBox();
   const reordered=p.waitForResponse(r=>r.url().endsWith('/api/playlists/'+flightId)&&r.request().method()==='PATCH');
   await p.mouse.move(a.x+a.width*.4,a.y+a.height*.5);await p.mouse.down();await p.mouse.move(b.x+b.width*.4,b.y+b.height*.7,{steps:12});await p.mouse.up();await reordered;assert.deepEqual(await p.locator('.list .row .title').allTextContents(),before.toReversed());
   const first=p.locator('.list .row').first();const removed=await first.locator('.title').innerText();await first.hover();await first.getByRole('button',{name:'Song menu',exact:true}).click();await p.getByRole('menuitem',{name:'Remove from playlist',exact:true}).click();await p.waitForFunction(()=>document.querySelectorAll('.list .row').length===1);
   let row=p.locator('.list .row').first();const keptTitle=await row.locator('.title').innerText();await row.hover();await row.getByRole('button',{name:'Song menu',exact:true}).click();await p.getByRole('menuitem',{name:'Rename song',exact:true}).click();const edited=`My flight sound · ${name}`;await p.getByRole('dialog',{name:'Song title',exact:true}).locator('input').fill(edited);await p.getByRole('button',{name:'Save',exact:true}).click();await p.locator('.list .row').filter({hasText:edited}).waitFor();
   await p.getByRole('button',{name:'Home',exact:true}).click();const ambientId=await create(ambient);await p.getByRole('button',{name:'Home',exact:true}).click();await add([removed,'Slow motion'],ambient);await p.locator('.rail').getByRole('button',{name:ambient,exact:true}).click();await p.locator('.hero .title').filter({hasText:ambient}).waitFor();await p.waitForFunction(()=>document.querySelectorAll('.list .row').length===2);
   await p.waitForTimeout(500);await p.screenshot({path:`screenshots/offline-organize-${name}.png`});
   const snapshot=await(await ctx.request.get(base+'/api/library')).json();const wanted=snapshot.playlists.filter(pl=>[flightId,ambientId].includes(pl.id));assert.equal(wanted.find(pl=>pl.id===flightId).trackIds.length,1);assert.equal(wanted.find(pl=>pl.id===ambientId).trackIds.length,2);assert.equal(snapshot.tracks.length,3);
   await p.reload();await p.locator('.hero .title').filter({hasText:ambient}).waitFor();await stop();boot();await p.reload();await p.locator('.hero .title').filter({hasText:ambient}).waitFor();
   const restored=await(await ctx.request.get(base+'/api/library')).json();assert.deepEqual(restored.playlists.filter(pl=>[flightId,ambientId].includes(pl.id)),wanted);assert.ok(restored.tracks.some(t=>t.title===edited));
   await p.locator('.rail').getByRole('button',{name:flight,exact:true}).click();await p.locator('.list .row .title').filter({hasText:edited}).click();await p.waitForFunction(()=>{const a=document.querySelector('audio');return a&&!a.paused&&a.currentTime>.2});
   assert.equal(outside,0);assert.deepEqual(errors,[]);console.log(`${name}: local offline launcher, create/rename playlists, multi-select filing, drag reorder, remove, metadata edit, reload, server restart and audio passed with internet blocked`);
   // Restore the shared test track name before the second browser's run.
   const changed=restored.tracks.find(t=>t.title===edited);await ctx.request.patch(base+'/api/tracks/'+changed.id,{data:{title:keptTitle}});
  }finally{await browser.close();}
 }
}finally{await stop();fs.rmSync(data,{recursive:true,force:true});}

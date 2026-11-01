import { chromium, webkit, devices } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
const root=path.resolve(import.meta.dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'tokify-links-ui-'));
const env={...process.env,TOKIFY_DATA:data,PORT:'18796',HOST:'127.0.0.1'},base='http://127.0.0.1:18796';
let server,logs='';
try {
 assert.equal(spawnSync(process.execPath,['--input-type=module','-e',"import {setPassword} from './server/auth.js';setPassword('link-test-password');"],{cwd:root,env}).status,0);
 const ids=['7500000000000000001','7500000000000000002','7500000000000000003','7500000000000000004'];
 const db=new DatabaseSync(path.join(data,'library.sqlite'));
 db.prepare("INSERT INTO playlists (id,name,kind,created) VALUES ('saved','Saved sounds','import',1)").run();
 for(const[i,id]of ids.entries()){
   assert.equal(spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i',`sine=frequency=${330+i*110}:duration=5:sample_rate=48000`,'-ac','2',path.join(data,'audio',id+'.wav')]).status,0);
   assert.equal(spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i',`color=c=${['0x88625f','0x4c697b','0x71715b','0x705a7b'][i]}:s=400x400`,'-vf',`drawbox=x=140:y=120:w=120:h=120:color=white@0.25:t=fill`,'-frames:v','1',path.join(data,'covers',id+'.jpg')]).status,0);
   db.prepare("INSERT INTO tracks (id,title,author,status,samples,audio_file,cover_file,source_name,added) VALUES (?,?,?,'ok',?,?,?,?,1)").run(id,['Afterglow','Night drive','Slow motion','Soft focus'][i],['Luma','Vela','Mira Lane','Sunday Club'][i],240000,id+'.wav',id+'.jpg','Saved sounds');
   db.prepare("INSERT INTO playlist_tracks VALUES ('saved',?,?)").run(id,i);
 }
 db.close();
 server=spawn(process.execPath,['server/index.js'],{cwd:root,env,stdio:['ignore','pipe','pipe']});server.stdout.on('data',s=>logs+=s);server.stderr.on('data',s=>logs+=s);
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/me')).ok)break}catch{}await new Promise(r=>setTimeout(r,50));}
 for(const[name,engine,options,index]of[['desktop',chromium,{viewport:{width:1440,height:1000}},0],['iphone',webkit,{...devices['iPhone 13']},1]]){
   const b=await engine.launch(),ctx=await b.newContext(options);
   try {
     await ctx.request.post(base+'/api/login',{data:{password:'link-test-password'}});
     const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.getByRole('heading',{name:'Uploads',exact:true}).waitFor();
     const input=p.getByRole('textbox',{name:'Music link',exact:true});
     assert.ok((await input.boundingBox()).y<(await p.locator('.top').boundingBox()).y);
     assert.equal(await p.getByRole('button',{name:'Import',exact:true}).count(),0);
     await input.fill('https://example.com/video/123');await p.getByRole('button',{name:'Find sound',exact:true}).click();await p.getByRole('alert').filter({hasText:'tiktok.com'}).waitFor();
     await input.fill(`https://www.tiktok.com/music/sound-${ids[index]}`);await input.press('Enter');await p.getByRole('button',{name:'Import',exact:true}).waitFor();
     await p.locator('.link-import .thumb img').waitFor();await p.waitForTimeout(400);await p.screenshot({path:`screenshots/link-found-${name}.png`});
     await p.getByRole('button',{name:'Import',exact:true}).click();await p.locator('.link-import').getByRole('button',{name:'Open',exact:true}).waitFor();
     const library=await(await ctx.request.get(base+'/api/library')).json(),ext=library.playlists.find(p=>p.kind==='external');assert.ok(ext.trackIds.includes(ids[index]));assert.equal(library.playlists[0].id,ext.id);assert.equal(library.playlists.length,2);
     await p.screenshot({path:`screenshots/link-saved-${name}.png`});await p.locator('.link-import').getByRole('button',{name:'Open',exact:true}).click();await p.locator('.hero .title').filter({hasText:'Мои файлы'}).waitFor();
     let row=p.locator('.list .row').filter({hasText:['Afterglow','Night drive'][index]});
     await row.locator('.title').click();await p.waitForFunction(()=>{const a=document.querySelector('audio');return a&&!a.paused&&a.currentTime>.1});
     await row.getByRole('button',{name:'Song menu',exact:true}).click();
     await p.getByRole('menuitem',{name:'Rename song',exact:true}).click();
     await p.getByRole('dialog',{name:'Song title',exact:true}).locator('input').fill(`My sound · ${name}`);
     await p.getByRole('button',{name:'Save',exact:true}).click();
     row=p.locator('.list .row').filter({hasText:`My sound · ${name}`});await row.waitFor();
     await row.getByRole('button',{name:'Song menu',exact:true}).click();await p.getByRole('menuitem',{name:'Edit author',exact:true}).click();
     await p.getByRole('dialog',{name:'Author',exact:true}).locator('input').fill('My artist');await p.getByRole('button',{name:'Save',exact:true}).click();await row.getByText('My artist',{exact:true}).waitFor();
     assert.equal(await p.locator('audio').evaluate(a=>a.paused),false,'editing must keep playback running');
     assert.ok((await p.locator('.bar .np-title').allTextContents()).every(t=>t===`My sound · ${name}`));
     await row.getByRole('button',{name:'Song menu',exact:true}).click();await p.getByRole('menuitem',{name:'Edit author',exact:true}).waitFor();
     await p.waitForTimeout(400);await p.screenshot({path:`screenshots/song-menu-${name}.png`});await p.keyboard.press('Escape');
     await p.reload();await p.locator('.list .row').filter({hasText:`My sound · ${name}`}).getByText('My artist',{exact:true}).waitFor();
     await p.getByRole('button',{name:'Home',exact:true}).click();await input.fill(`https://www.tiktok.com/music/sound-${ids[index]}`);await p.getByRole('button',{name:'Find sound',exact:true}).click();await p.locator('.link-import').getByRole('button',{name:'Open',exact:true}).waitFor();assert.equal(await p.getByRole('button',{name:'Import',exact:true}).count(),0);
     // Ignore a slow preview if the user has already cleared/replaced its input.
     await p.route('**/api/links/resolve',async route=>{await new Promise(r=>setTimeout(r,400));await route.continue();});
     await input.fill(`https://www.tiktok.com/music/sound-${ids[2]}`);await p.getByRole('button',{name:'Find sound',exact:true}).click();await input.fill('');await p.waitForTimeout(650);assert.equal(await p.locator('.link-import .result').count(),0);await p.unroute('**/api/links/resolve');
     if(name==='desktop'){
       await input.evaluate((el,text)=>{const d=new DataTransfer();d.setData('text/plain',text);el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true}));},`Check this out! https://www.tiktok.com/music/sound-${ids[2]}?from=share`);
       await p.getByRole('button',{name:'Import',exact:true}).waitFor();assert.match(await input.inputValue(),/sound-7500000000000000003$/);
     }
     assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
     console.log(`${name}: invalid link, lookup, preview, Download, existing external playlist, deduplication, Open, title/author edits during playback, persistence, stale results and layout passed`);
   }finally{await b.close();}
 }
}finally{
 if(server?.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}fs.rmSync(data,{recursive:true,force:true});if(logs.includes('Error'))console.log(logs);
}

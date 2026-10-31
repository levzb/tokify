import { chromium, webkit, devices } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
const root = path.resolve(import.meta.dirname, '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'tokify-files-ui-'));
const env = { ...process.env, TOKIFY_DATA: data, PORT: '18790', HOST: '127.0.0.1' };
const base = 'http://127.0.0.1:18790';
let server, logs = '';
const run = (args) => { const r = spawnSync('ffmpeg', ['-v','error','-y',...args]); assert.equal(r.status,0,r.stderr.toString()); };
try {
  const setup = spawnSync(process.execPath, ['--input-type=module','-e',"import {setPassword} from './server/auth.js';setPassword('file-test-password');"], { cwd:root, env }); assert.equal(setup.status,0);
  const audio = path.join(data,'Мой трек.wav'), video = path.join(data,'Видео.mp4'), empty = path.join(data,'Фото.png'), silent = path.join(data,'Без звука.mp4');
  run(['-f','lavfi','-i','sine=frequency=440:duration=4:sample_rate=48000','-ac','2',audio]);
  run(['-f','lavfi','-i','testsrc2=s=96x96:r=10:d=3','-f','lavfi','-i','sine=frequency=660:duration=3','-c:v','mpeg4','-c:a','aac','-shortest',video]);
  fs.copyFileSync(path.join(root,'public/icon-512.png'),empty);
  run(['-f','lavfi','-i','color=c=blue:s=96x96:r=10:d=1','-an','-c:v','mpeg4',silent]);
  fs.copyFileSync(audio,path.join(data,'audio','1234567890123456789.wav'));
  const d = new DatabaseSync(path.join(data,'library.sqlite'));
  d.prepare("INSERT INTO tracks (id,title,status,samples,audio_file,source_name,added) VALUES ('1234567890123456789','Проверочный TikTok','ok',192000,'1234567890123456789.wav','Проверочная выгрузка',1)").run();
  d.prepare("INSERT INTO playlists (id,name,kind,created) VALUES ('tiktok-test','Проверочная выгрузка','import',1)").run();
  d.prepare("INSERT INTO playlist_tracks VALUES ('tiktok-test','1234567890123456789',0)").run(); d.close();
  server = spawn(process.execPath,['server/index.js'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',s=>logs+=s); server.stderr.on('data',s=>logs+=s);
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/me')).ok)break}catch{}await new Promise(r=>setTimeout(r,50))}
  for(const[name,engine,options]of[['desktop',chromium,{viewport:{width:1440,height:1000}}],['iphone',webkit,{...devices['iPhone 13']} ]]){
    const b=await engine.launch(),ctx=await b.newContext(options);
    try{
      const q=ctx.request;await q.post(base+'/api/login',{data:{password:'file-test-password'}});
      const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
      await p.goto(base);await p.getByRole('heading',{name:'Uploads',exact:true}).waitFor();
      let scans=0;p.on('request',r=>{if(r.url().endsWith('/api/files/scan'))scans++});
      await p.locator('input[type=file][multiple]').setInputFiles(empty);
      await p.getByRole('alert').filter({hasText:'Only audio and video'}).waitFor();assert.equal(scans,0);
      assert.equal(await p.getByRole('button',{name:'Upload',exact:true}).count(),0);
      await p.locator('input[type=file][multiple]').setInputFiles(silent);
      await p.getByRole('alert').filter({hasText:'no audio track'}).waitFor();
      assert.equal(await p.getByRole('button',{name:'Upload',exact:true}).count(),0);
      const beforeScan=(await(await q.get(base+'/api/library')).json()).tracks.length;
      await p.locator('input[type=file][multiple]').setInputFiles([audio,video,empty,silent]);
      await p.getByRole('button',{name:'Upload',exact:true}).waitFor();
      assert.equal((await(await q.get(base+'/api/library')).json()).tracks.length,beforeScan);
      assert.match(await p.getByRole('alert').innerText(),/Фото.png/);assert.match(await p.getByRole('alert').innerText(),/Без звука.mp4/);
      await p.getByRole('button',{name:'Upload',exact:true}).click();await p.getByRole('dialog',{name:'Import files',exact:true}).waitFor();
      assert.equal(await p.getByLabel('Title for Мой трек.wav',{exact:true}).innerText(),'Мой трек');
      await p.getByLabel('Title for Мой трек.wav',{exact:true}).fill('Ночной фрагмент');
      await p.getByLabel('Author for Мой трек.wav',{exact:true}).fill('Мой автор');
      await p.getByLabel('Author for Видео.mp4',{exact:true}).fill('Автор видео');
      assert.equal(await p.locator('.modal input').count(),0);assert.equal(await p.locator('.modal .file').count(),2);
      await p.waitForTimeout(500);await p.screenshot({path:`screenshots/files-config-${name}.png`});
      await p.getByRole('button',{name:'Import 2 files',exact:true}).click();
      await p.getByRole('heading',{name:'File import complete',exact:true}).waitFor({timeout:30000});
      assert.match(await p.locator('.modal .lead').innerText(),/2 ready · 0 unavailable/);
      await p.waitForTimeout(500);await p.screenshot({path:`screenshots/files-result-${name}.png`});
      await p.getByRole('button',{name:'Open My files',exact:true}).click();await p.locator('.list .row').first().waitFor();
      assert.equal(await p.locator('.list .row').count(),2);assert.equal(await p.locator('.list .row.failed').count(),0);
      const library=await(await q.get(base+'/api/library')).json();const external=library.playlists.find(x=>x.kind==='external');
      assert.equal(library.playlists[0].id,external.id);assert.equal(library.tracks.filter(t=>t.origin==='external').length,2);
      assert.equal(library.tracks.find(t=>t.title==='Ночной фрагмент').author,'Мой автор');
      // The normal playback stream works with file IDs and ignores the failed file.
      const row=p.locator('.list .row').filter({hasText:'Ночной фрагмент'});await row.locator('.title').click();
      await p.waitForFunction(()=>{const a=document.querySelector('audio');return a&&!a.paused&&a.currentTime>.15},null,{timeout:20000});
      await p.waitForTimeout(600);if(name==='iphone')await p.locator('.main-scroll').evaluate(el=>el.scrollTop=260);
      await p.screenshot({path:`screenshots/files-playlist-${name}.png`});
      await p.getByRole('button',{name:'Home',exact:true}).click();
      await p.getByRole('heading',{name:'Uploads',exact:true}).waitFor();
      assert.equal(await p.locator('.import .name').first().innerText(),'Мои файлы');
      await p.waitForTimeout(650);await p.screenshot({path:`screenshots/files-home-${name}.png`});
      await p.getByRole('tab',{name:'All songs',exact:true}).click();await p.locator('.list .row').filter({hasText:'Ночной фрагмент'}).waitFor();
      await p.reload();await p.getByRole('tab',{name:'All songs',exact:true}).click();await p.locator('.list .row').filter({hasText:'Ночной фрагмент'}).waitFor();
      // Existing TikTok archive parsing still works in the same input zone.
      await p.locator('input[type=file][multiple]').setInputFiles(path.join(root,'TikTok_Data_1793457765.zip'));
      await p.getByRole('button',{name:'Upload',exact:true}).click();await p.getByText('New upload',{exact:true}).waitFor();
      assert.match(await p.locator('.modal .lead').innerText(),/967/);await p.getByRole('button',{name:'Close',exact:true}).click();
      const ownRow=p.locator('.list .row').filter({hasText:'Ночной фрагмент'});
      await ownRow.getByRole('button',{name:'Song menu',exact:true}).click();
      await p.getByRole('menuitem',{name:'Rename song',exact:true}).click();
      await p.getByRole('dialog').locator('input').fill('Название после импорта');
      await p.getByRole('button',{name:'Save',exact:true}).click();
      await p.locator('.list .row').filter({hasText:'Название после импорта'}).waitFor();
      await p.locator('.list .row').filter({hasText:'Название после импорта'}).getByRole('button',{name:'Song menu',exact:true}).click();
      await p.getByRole('menuitem',{name:'Edit author',exact:true}).click();
      await p.getByRole('dialog').locator('input').fill('Автор после импорта');
      await p.getByRole('button',{name:'Save',exact:true}).click();
      await p.locator('.list .row').filter({hasText:'Автор после импорта'}).waitFor();
      assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
      console.log(`${name}: audio/video upload, editable metadata, early rejection of photos and silent videos, inline metadata, playback, deduplication, pinned My files, persistence and TikTok archive passed`);
    }finally{await ctx.request.post(base+'/api/logout');await b.close()}
  }
}finally{
 if(server?.exitCode===null){server.kill('SIGTERM');await once(server,'exit')}
 fs.rmSync(data,{recursive:true,force:true});
 if(logs.includes('[import]'))console.log(logs);
}

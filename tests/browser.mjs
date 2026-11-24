// Browser checks in Chromium (desktop) and WebKit with an iPhone screen; not a physical iPhone.
//   npm run test:browser                 every isolated check (temporary libraries, nothing of yours changes)
//   npm run test:browser -- clips media  only these
//   npm run test:browser -- library      your real library: Tokify must be running (TOKIFY_BASE_URL)
// Needs: npx playwright install chromium webkit. Screenshots go to screenshots/.
import { chromium, webkit, devices } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { zipSync, strToU8 } from 'fflate';
import { tool } from '../server/system.js';
const FFMPEG = tool('ffmpeg');
// Title and author: with a mouse they edit in place (click the text); on a phone through the song menu.
async function editSong(p, row, field, value) {
  const inline = await p.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches);
  if (inline) {
    await row.locator(field === 'title' ? '.title' : '.author').click();
    const input = p.locator('.list input.inline-edit'); await input.fill(value); await input.press('Enter');
  } else {
    await row.getByRole('button', { name: 'Song menu', exact: true }).click();
    await p.getByRole('menuitem', { name: field === 'title' ? 'Rename song' : 'Edit author', exact: true }).click();
    await p.getByRole('dialog', { name: field === 'title' ? 'Song title' : 'Author', exact: true }).locator('input').fill(value);
    await p.getByRole('button', { name: 'Save', exact: true }).click();
  }
}

// ---------- files: own audio/video files: checks, preview, editing, import ----------
async function files() {
const root = path.resolve(import.meta.dirname, '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'tokify-files-ui-'));
const env = { ...process.env, TOKIFY_DATA: data, PORT: '18790', HOST: '127.0.0.1' };
const base = 'http://127.0.0.1:18790';
let server, logs = '';
const run = (args) => { const r = spawnSync(FFMPEG, ['-v','error','-y',...args]); assert.equal(r.status,0,r.stderr.toString()); };
try {
  assert.equal(spawnSync(process.execPath,['--input-type=module','-e',"import './server/db.js';"],{cwd:root,env}).status,0); // creates the database
  const audio = path.join(data,'Мой трек.wav'), video = path.join(data,'Видео.mp4'), empty = path.join(data,'Фото.png'), silent = path.join(data,'Без звука.mp4');
  run(['-f','lavfi','-i','sine=frequency=440:duration=4:sample_rate=48000','-ac','2',audio]);
  run(['-f','lavfi','-i','testsrc2=s=96x96:r=10:d=3','-f','lavfi','-i','sine=frequency=660:duration=3','-c:v','mpeg4','-c:a','aac','-shortest',video]);
  fs.copyFileSync(path.join(root,'iphone/public/icon-512.png'),empty);
  run(['-f','lavfi','-i','color=c=blue:s=96x96:r=10:d=1','-an','-c:v','mpeg4',silent]);
  fs.copyFileSync(audio,path.join(data,'audio','1234567890123456789.wav'));
  const d = new DatabaseSync(path.join(data,'library.sqlite'));
  d.prepare("INSERT INTO tracks (id,title,status,samples,audio_file,source_name,added) VALUES ('1234567890123456789','Проверочный TikTok','ok',192000,'1234567890123456789.wav','Проверочная выгрузка',1)").run();
  d.prepare("INSERT INTO playlists (id,name,kind,created) VALUES ('tiktok-test','Проверочная выгрузка','import',1)").run();
  d.prepare("INSERT INTO playlist_tracks VALUES ('tiktok-test','1234567890123456789',0)").run(); d.close();
  server = spawn(process.execPath,['server/index.js'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',s=>logs+=s); server.stderr.on('data',s=>logs+=s);
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/ping')).ok)break}catch{}await new Promise(r=>setTimeout(r,50))}
  for(const[name,engine,options]of[['desktop',chromium,{viewport:{width:1440,height:1000}}],['iphone',webkit,{...devices['iPhone 13']} ]]){
    const b=await engine.launch(),ctx=await b.newContext(options);
    try{
      const q=ctx.request;
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
      assert.equal(await p.locator('.modal .lead').innerText(),'2 ready');
      await p.waitForTimeout(500);await p.screenshot({path:`screenshots/files-result-${name}.png`});
      await p.getByRole('button',{name:'Open My files',exact:true}).click();await p.locator('.list .row').first().waitFor();
      assert.equal(await p.locator('.list .row').count(),2);assert.equal(await p.locator('.list .row.failed').count(),0);
      const library=await(await q.get(base+'/api/library')).json();const external=library.playlists.find(x=>x.kind==='external');
      assert.equal(library.playlists[0].id,external.id);assert.equal(library.tracks.filter(t=>t.origin==='external').length,2);
      assert.equal(library.tracks.find(t=>t.title==='Ночной фрагмент').author,'Мой автор');
      // The normal playback stream works with file IDs and ignores the failed file.
      const row=p.locator('.list .row').filter({hasText:'Ночной фрагмент'});await row.locator('.c-idx').click();
      await p.waitForFunction(()=>{const a=document.querySelector('audio');return a&&!a.paused&&a.currentTime>.15},null,{timeout:20000});
      await p.waitForTimeout(600);if(name==='iphone')await p.locator('.main-scroll').evaluate(el=>el.scrollTop=260);
      await p.screenshot({path:`screenshots/files-playlist-${name}.png`});
      await p.getByRole('button',{name:'Home',exact:true}).click();
      await p.getByRole('heading',{name:'Uploads',exact:true}).waitFor();
      assert.equal(await p.locator('.import .name').first().innerText(),'Мои файлы');
      await p.waitForTimeout(650);await p.screenshot({path:`screenshots/files-home-${name}.png`});
      await p.getByRole('tab',{name:'All songs',exact:true}).click();await p.locator('.list .row').filter({hasText:'Ночной фрагмент'}).waitFor();
      await p.reload();await p.getByRole('tab',{name:'All songs',exact:true}).click();await p.locator('.list .row').filter({hasText:'Ночной фрагмент'}).waitFor();
      // TikTok archive parsing still works in the same input zone (a generated three-sound export).
      const archive=path.join(data,'TikTok_Data_test.zip');
      fs.writeFileSync(archive,zipSync({'user_data_tiktok.json':strToU8(JSON.stringify({'Likes and Favorites':{'Favorite Sounds':{FavoriteSoundList:[1,2,3].map(i=>({Date:`2026-01-0${i}`,Link:`https://www.tiktok.com/music/sound-760000000000000000${i}`}))}}}))}));
      await p.locator('input[type=file][multiple]').setInputFiles(archive);
      await p.getByRole('button',{name:'Upload',exact:true}).click();await p.getByText('New upload',{exact:true}).waitFor();
      assert.equal(await p.locator('.modal .lead').innerText(),'3 sounds');await p.getByRole('button',{name:'Close',exact:true}).click();
      const ownRow=p.locator('.list .row').filter({hasText:'Ночной фрагмент'});
      await editSong(p,ownRow,'title','Название после импорта');
      await p.locator('.list .row').filter({hasText:'Название после импорта'}).waitFor();
      await editSong(p,p.locator('.list .row').filter({hasText:'Название после импорта'}),'author','Автор после импорта');
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
}

// ---------- links: TikTok links: search, import, open ----------
async function links() {
const root=path.resolve(import.meta.dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'tokify-links-ui-'));
const env={...process.env,TOKIFY_DATA:data,PORT:'18796',HOST:'127.0.0.1'},base='http://127.0.0.1:18796';
let server,logs='';
try {
 assert.equal(spawnSync(process.execPath,['--input-type=module','-e',"import './server/db.js';"],{cwd:root,env}).status,0); // creates the database
 const ids=['7500000000000000001','7500000000000000002','7500000000000000003','7500000000000000004'];
 const db=new DatabaseSync(path.join(data,'library.sqlite'));
 db.prepare("INSERT INTO playlists (id,name,kind,created) VALUES ('saved','Saved sounds','import',1)").run();
 for(const[i,id]of ids.entries()){
   assert.equal(spawnSync(FFMPEG,['-v','error','-y','-f','lavfi','-i',`sine=frequency=${330+i*110}:duration=5:sample_rate=48000`,'-ac','2',path.join(data,'audio',id+'.wav')]).status,0);
   assert.equal(spawnSync(FFMPEG,['-v','error','-y','-f','lavfi','-i',`color=c=${['0x88625f','0x4c697b','0x71715b','0x705a7b'][i]}:s=400x400`,'-vf',`drawbox=x=140:y=120:w=120:h=120:color=white@0.25:t=fill`,'-frames:v','1',path.join(data,'covers',id+'.jpg')]).status,0);
   db.prepare("INSERT INTO tracks (id,title,author,status,samples,audio_file,cover_file,source_name,added) VALUES (?,?,?,'ok',?,?,?,?,1)").run(id,['Afterglow','Night drive','Slow motion','Soft focus'][i],['Luma','Vela','Mira Lane','Sunday Club'][i],240000,id+'.wav',id+'.jpg','Saved sounds');
   db.prepare("INSERT INTO playlist_tracks VALUES ('saved',?,?)").run(id,i);
 }
 db.close();
 server=spawn(process.execPath,['server/index.js'],{cwd:root,env,stdio:['ignore','pipe','pipe']});server.stdout.on('data',s=>logs+=s);server.stderr.on('data',s=>logs+=s);
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/ping')).ok)break}catch{}await new Promise(r=>setTimeout(r,50));}
 for(const[name,engine,options,index]of[['desktop',chromium,{viewport:{width:1440,height:1000}},0],['iphone',webkit,{...devices['iPhone 13']},1]]){
   const b=await engine.launch(),ctx=await b.newContext(options);
   try {
     
     const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.getByRole('heading',{name:'Uploads',exact:true}).waitFor();
     const input=p.getByRole('textbox',{name:'Music link',exact:true});
     assert.ok((await input.boundingBox()).y<(await p.locator('.top').boundingBox()).y);
     await input.click();await p.locator('.top').waitFor({state:'detached'});await p.keyboard.press('Escape');await p.locator('.top').waitFor();await p.locator('.room-body').waitFor({state:'detached'});
     assert.equal(await p.getByRole('button',{name:'Import',exact:true}).count(),0);
     await input.fill('https://example.com/video/123');await p.getByRole('button',{name:'Find sound',exact:true}).click();await p.getByRole('alert').filter({hasText:'tiktok.com'}).waitFor();
     await input.fill(`https://www.tiktok.com/music/sound-${ids[index]}`);await input.press('Enter');await p.getByRole('button',{name:'Import',exact:true}).waitFor();
     await p.locator('.link-import .thumb img').waitFor();await p.waitForTimeout(400);await p.screenshot({path:`screenshots/link-found-${name}.png`});
     await p.getByRole('button',{name:'Import',exact:true}).click();await p.locator('.link-import').getByRole('button',{name:'Open',exact:true}).waitFor();
     const library=await(await ctx.request.get(base+'/api/library')).json(),ext=library.playlists.find(p=>p.kind==='external');assert.ok(ext.trackIds.includes(ids[index]));assert.equal(library.playlists[0].id,ext.id);assert.equal(library.playlists.length,2);
     await p.screenshot({path:`screenshots/link-saved-${name}.png`});await p.locator('.link-import').getByRole('button',{name:'Open',exact:true}).click();await p.locator('.hero .title').filter({hasText:'Мои файлы'}).waitFor();
     let row=p.locator('.list .row').filter({hasText:['Afterglow','Night drive'][index]});
     await row.locator('.c-idx').click();await p.waitForFunction(()=>{const a=document.querySelector('audio');return a&&!a.paused&&a.currentTime>.1});
     await editSong(p,row,'title',`My sound · ${name}`);
     row=p.locator('.list .row').filter({hasText:`My sound · ${name}`});await row.waitFor();
     await editSong(p,row,'author','My artist');await row.getByText('My artist',{exact:true}).waitFor();
     assert.equal(await p.locator('audio').evaluate(a=>a.paused),false,'editing must keep playback running');
     assert.ok((await p.locator('.bar .np-title').allTextContents()).every(t=>t===`My sound · ${name}`));
     await row.getByRole('button',{name:'Song menu',exact:true}).click();await p.getByRole('menuitem',{name:'Add to playlist',exact:true}).waitFor();
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
}

// ---------- media: YouTube, SoundCloud and Spotify links (stand-in downloader) ----------
async function media() {
const root=path.resolve(import.meta.dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'tokify-multimedia-ui-')),base='http://127.0.0.1:18799';let server,logs='';
const fake=path.join(data,'downloader.mjs'),preload=path.join(data,'spotify.mjs'),audio=path.join(data,'fixture.m4a');
fs.writeFileSync(fake,`#!/usr/bin/env node
import fs from 'node:fs';const a=process.argv.slice(2),url=a.at(-1),query=url.startsWith('ytsearch'),sc=url.includes('soundcloud'),id=sc?'293':new URL(url).searchParams.get('v');
if(query)console.log(JSON.stringify({entries:[{id:'u7XjPmN-tHw',title:'Selected YouTube recording',uploader:'The artist',duration:3}]}));
else if(a.includes('--dump-single-json'))console.log(JSON.stringify({id,title:sc?'SoundCloud recording':'YouTube recording',uploader:'The artist',duration:3,webpage_url:sc?'https://soundcloud.com/artist/track':url,format_id:url.includes('/preview')?'hls_preview':'audio'}));
else fs.copyFileSync(process.env.MEDIA_FIXTURE,a[a.indexOf('--output')+1].replace('%(ext)s','m4a'));
`,{mode:0o755});
fs.writeFileSync(preload,`const native=globalThis.fetch;globalThis.fetch=(url,options)=>{if(String(url).startsWith('https://open.spotify.com/embed/track/'))return Promise.resolve(new Response('<script id="__NEXT_DATA__">'+JSON.stringify({props:{pageProps:{state:{data:{entity:{type:'track',title:'Spotify song',artists:[{name:'The artist'}],duration:195000,visualIdentity:{image:[]}}}}}}})+'</script>',{status:200}));return native(url,options);};`);
const env={...process.env,TOKIFY_DATA:data,HOST:'127.0.0.1',PORT:'18799',TOKIFY_YTDLP:fake,MEDIA_FIXTURE:audio};
try{
 assert.equal(spawnSync(process.execPath,['--input-type=module','-e',"import './server/db.js';"],{cwd:root,env}).status,0); // creates the database
 assert.equal(spawnSync(FFMPEG,['-v','error','-y','-f','lavfi','-i','sine=frequency=440:duration=3:sample_rate=48000','-c:a','aac',audio]).status,0);
 server=spawn(process.execPath,['--import',pathToFileURL(preload).href,'server/index.js'],{cwd:root,env,stdio:['ignore','pipe','pipe']});server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/ping')).ok)break}catch{}await new Promise(r=>setTimeout(r,50));}
 for(const[name,engine,options]of [['desktop',chromium,{viewport:{width:1440,height:1000}}],['iphone',webkit,{...devices['iPhone 13']} ]]){
 const browser=await engine.launch(),ctx=await browser.newContext(options);
 try{
 const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.getByRole('heading',{name:'Uploads',exact:true}).waitFor();const input=p.getByRole('textbox',{name:'Music link',exact:true}),section=p.locator('.link-import');
 for(const[url,provider]of [['https://youtu.be/jNQXAC9IVRw','YouTube'],['https://soundcloud.com/artist/track','SoundCloud']]){
  await input.fill(url);await p.getByRole('button',{name:'Find sound',exact:true}).click();await section.locator('.result').waitFor();await section.getByRole('link',{name:provider,exact:true}).waitFor();await p.waitForTimeout(350);await p.screenshot({path:`screenshots/media-${provider.toLowerCase()}-${name}.png`});
  if(await section.getByRole('button',{name:'Import',exact:true}).count()){await section.getByRole('button',{name:'Import',exact:true}).click();await section.getByRole('button',{name:'Open',exact:true}).waitFor({timeout:30000});}
 }
 await input.fill('https://soundcloud.com/artist/preview');await p.getByRole('button',{name:'Find sound',exact:true}).click();await p.getByRole('alert').filter({hasText:'Only a preview'}).waitFor();assert.equal(await section.getByRole('button',{name:'Import',exact:true}).count(),0);
 await input.fill('https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl');await p.getByRole('button',{name:'Find sound',exact:true}).click();await section.getByRole('button',{name:'Find on YouTube',exact:true}).waitFor();assert.equal(await section.getByRole('button',{name:'Import',exact:true}).count(),0);assert.match(await section.innerText(),/not a full audio download/);
 const before=(await(await ctx.request.get(base+'/api/library')).json()).tracks.length;await section.getByRole('button',{name:'Find on YouTube',exact:true}).click();await section.getByRole('button',{name:'Choose Selected YouTube recording',exact:true}).waitFor();assert.equal((await(await ctx.request.get(base+'/api/library')).json()).tracks.length,before,'Spotify search must not add or download audio');await p.waitForTimeout(350);await p.screenshot({path:`screenshots/media-spotify-${name}.png`});
 await section.getByRole('button',{name:'Choose Selected YouTube recording',exact:true}).click();await section.getByRole('link',{name:'YouTube',exact:true}).waitFor();if(await section.getByRole('button',{name:'Import',exact:true}).count()){await section.getByRole('button',{name:'Import',exact:true}).click();await section.getByRole('button',{name:'Open',exact:true}).waitFor({timeout:30000});}
 const lib=await(await ctx.request.get(base+'/api/library')).json();assert.equal(lib.playlists.filter(p=>p.kind==='external').length,1);assert.equal(lib.playlists[0].kind,'external');assert.equal(lib.tracks.length,3);assert.ok(lib.tracks.every(t=>['youtube','soundcloud'].includes(t.origin)));
 // Words instead of a link search YouTube; a hit opens the same card (here: already saved, so Open).
 await p.getByRole('button',{name:'Home',exact:true}).click();await input.fill('the artist recording');await p.getByRole('button',{name:'Find sound',exact:true}).click();await section.getByRole('listitem').filter({hasText:'Selected YouTube recording'}).waitFor();await section.getByRole('button',{name:'Choose Selected YouTube recording',exact:true}).click();await section.getByRole('button',{name:'Open',exact:true}).waitFor();assert.equal((await(await ctx.request.get(base+'/api/library')).json()).tracks.length,3,'search must not add songs by itself');
 // New source IDs must work in every ordinary playlist and in the renderer.
 const created=await ctx.request.post(base+'/api/playlists',{data:{name:'Multisource',trackIds:lib.tracks.map(t=>t.id)}});assert.equal(created.status(),200);const{id}=await created.json();const changed=await ctx.request.patch(base+'/api/playlists/'+id,{data:{trackIds:lib.tracks.map(t=>t.id).reverse()}});assert.equal(changed.status(),200);
 const sid=crypto.randomUUID(),session=await ctx.request.post(base+'/api/sessions',{data:{id:sid,mode:'crossfade',items:lib.tracks.map(t=>({id:t.id}))}});assert.equal(session.status(),200);const stream=await ctx.request.get(base+'/stream/'+sid+'.mp3');assert.equal(stream.status(),200);assert.ok((await stream.body()).length>10000);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);console.log(`${name}: YouTube, SoundCloud, preview rejection, explicit Spotify → YouTube choice, shared destination, playlists, reorder and continuous playback passed`);
 }finally{await browser.close();}
 }
}finally{if(server?.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}fs.rmSync(data,{recursive:true,force:true});if(logs.includes('[import]'))console.log(logs);}
}

// ---------- clips: trim editor: waveform, preview, save, restore ----------
async function clips() {
const root=path.resolve(import.meta.dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'tokify-clip-ui-')),base='http://127.0.0.1:18800',env={...process.env,TOKIFY_DATA:data,HOST:'127.0.0.1',PORT:'18800'};let server,logs='';
try{
 assert.equal(spawnSync(process.execPath,['--input-type=module','-e',"import './server/db.js';"],{cwd:root,env}).status,0); // creates the database
 const file=path.join(data,'audio','original.wav');assert.equal(spawnSync(FFMPEG,['-v','error','-y','-f','lavfi','-i','aevalsrc=0.2*sin(2*PI*440*t)*(0.2+0.8*abs(sin(PI*t/0.8))):s=48000:d=8','-ac','2',file]).status,0);
 const ids=['1234567890123456789','yt-jNQXAC9IVRw','sc-293','file-'+'a'.repeat(64)],names=['Favorite sound','Afterglow','Night drive','My recording'];
 const db=new DatabaseSync(path.join(data,'library.sqlite'));db.prepare("INSERT INTO playlists(id,name,kind,created)VALUES('source','Saved sounds','import',1)").run();
 fs.copyFileSync(path.join(root,'iphone/public/icon-512.png'),path.join(data,'covers','cover.png'));
 ids.forEach((id,i)=>{db.prepare("INSERT INTO tracks(id,title,author,status,samples,audio_file,cover_file,origin,source_name,added,link)VALUES(?,?,?,'ok',384000,'original.wav','cover.png',?,'Saved sounds',?,?)").run(id,names[i],['Mira Lane','Luma','Vela','Me'][i],['tiktok','youtube','soundcloud','external'][i],i,i===1?'https://www.youtube.com/watch?v=jNQXAC9IVRw':'');db.prepare("INSERT INTO playlist_tracks VALUES('source',?,?)").run(id,i);});db.close();
 server=spawn(process.execPath,['server/index.js'],{cwd:root,env,stdio:['ignore','pipe','pipe']});server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/ping')).ok)break}catch{}await new Promise(r=>setTimeout(r,50));}
 for(const[name,engine,options,index]of [['desktop',chromium,{viewport:{width:1440,height:1000}},0],['iphone',webkit,{...devices['iPhone 13']},2]]){
 const browser=await engine.launch(),ctx=await browser.newContext(options);try{
 const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/#/p/source');await p.locator('.hero .title').waitFor();
 const row=()=>p.locator('.list .row').filter({hasText:names[index]});
 await row().locator('.c-idx').click();await p.waitForFunction(()=>{const a=document.querySelector('audio:not(.clip-audio)');return a&&!a.paused&&a.currentTime>.1});
 async function open(){await row().hover();await row().getByRole('button',{name:'Song menu',exact:true}).click();await p.getByRole('menuitem',{name:'Trim audio',exact:true}).click();await p.getByRole('button',{name:'Play excerpt',exact:true}).waitFor({timeout:20000});}
 await open();const editor=p.getByRole('dialog',{name:'Trim audio',exact:true});assert.equal(await p.locator('audio:not(.clip-audio)').evaluate(a=>a.paused),true);
 await p.getByRole('slider',{name:'Excerpt start',exact:true}).press('ArrowRight');assert.equal(await p.getByRole('spinbutton',{name:'Excerpt start seconds',exact:true}).inputValue(),'0.1');
 if(name==='desktop'){await editor.evaluate(el=>Promise.all(el.getAnimations({subtree:true}).filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished)));const w=await p.getByRole('group',{name:'Excerpt waveform',exact:true}).boundingBox(),h=await p.getByRole('slider',{name:'Excerpt end',exact:true}).boundingBox();await p.mouse.move(h.x+h.width/2,h.y+h.height/2);await p.mouse.down();await p.mouse.move(w.x+w.width*.75,w.y+w.height/2,{steps:10});await p.mouse.up();assert.ok(Math.abs(Number(await p.getByRole('spinbutton',{name:'Excerpt end seconds',exact:true}).inputValue())-6)<.05);}
 await p.getByRole('spinbutton',{name:'Excerpt start seconds',exact:true}).fill('1');await p.getByRole('spinbutton',{name:'Excerpt end seconds',exact:true}).fill('0.1');assert.equal(await p.getByRole('button',{name:'Save excerpt',exact:true}).isDisabled(),true);
 await p.getByRole('spinbutton',{name:'Excerpt end seconds',exact:true}).fill('3');
 await p.getByRole('spinbutton',{name:'Excerpt start seconds',exact:true}).fill('1');await p.getByRole('spinbutton',{name:'Excerpt end seconds',exact:true}).fill('3');await p.getByRole('button',{name:'Play excerpt',exact:true}).click();await p.waitForFunction(()=>{const a=document.querySelector('.clip-audio');return a&&!a.paused&&a.currentTime>1.1;});await p.waitForTimeout(2400);const at=await p.locator('.clip-audio').evaluate(a=>a.currentTime);assert.ok(at>=1&&at<=3.2,'preview must loop inside the selection');
 await p.getByRole('button',{name:'Pause preview',exact:true}).click();assert.equal(await p.locator('audio:not(.clip-audio)').evaluate(a=>a.paused),true);
 await editor.evaluate(el=>el.scrollTop=0);await p.waitForTimeout(400);await p.screenshot({path:`screenshots/clip-editor-${name}.png`});
 await p.getByRole('button',{name:'Close editor',exact:true}).click();assert.equal((await(await ctx.request.get(base+'/api/tracks/'+ids[index]+'/clip')).json()).edited,false);
 await open();await p.getByRole('spinbutton',{name:'Excerpt start seconds',exact:true}).fill('1');await p.getByRole('spinbutton',{name:'Excerpt end seconds',exact:true}).fill('3');await p.getByRole('button',{name:'Save excerpt',exact:true}).click();await editor.waitFor({state:'hidden'});
 let lib=await(await ctx.request.get(base+'/api/library')).json();assert.equal(lib.tracks.find(t=>t.id===ids[index]).samples,96000);
 await row().locator('.c-idx').click();await p.waitForFunction(()=>{const a=document.querySelector('audio:not(.clip-audio)');return a&&!a.paused&&a.currentTime>.1&&document.querySelector('.bar .progress .time:last-child')?.textContent.trim()==='0:02'});
 await open();assert.equal(await p.getByRole('spinbutton',{name:'Excerpt start seconds',exact:true}).inputValue(),'1');assert.equal(await p.getByRole('spinbutton',{name:'Excerpt end seconds',exact:true}).inputValue(),'3');
 // Moving the window beyond the old excerpt must still use the eight-second original.
 await p.getByRole('spinbutton',{name:'Excerpt end seconds',exact:true}).fill('6');await p.getByRole('spinbutton',{name:'Excerpt start seconds',exact:true}).fill('4');await p.getByRole('button',{name:'Save excerpt',exact:true}).click();await editor.waitFor({state:'hidden'});await p.reload();await p.locator('.hero .title').waitFor();await open();assert.equal(await p.getByRole('spinbutton',{name:'Excerpt start seconds',exact:true}).inputValue(),'4');
 await p.getByRole('button',{name:'Restore original',exact:true}).click();await p.getByRole('button',{name:'Save excerpt',exact:true}).click();await editor.waitFor({state:'hidden'});lib=await(await ctx.request.get(base+'/api/library')).json();assert.equal(lib.tracks.find(t=>t.id===ids[index]).samples,384000);
 if(name==='desktop'){
  await p.getByRole('button',{name:'Home',exact:true}).click();await p.getByRole('textbox',{name:'Music link',exact:true}).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw');await p.getByRole('button',{name:'Find sound',exact:true}).click();await p.getByRole('button',{name:'Import & trim',exact:true}).click();await p.getByRole('button',{name:'Play excerpt',exact:true}).waitFor({timeout:20000});await p.getByRole('spinbutton',{name:'Excerpt start seconds',exact:true}).fill('2');await p.getByRole('spinbutton',{name:'Excerpt end seconds',exact:true}).fill('5');await p.getByRole('button',{name:'Save excerpt',exact:true}).click();await editor.waitFor({state:'hidden'});const l=await(await ctx.request.get(base+'/api/library')).json();assert.ok(l.playlists.find(pl=>pl.kind==='external').trackIds.includes(ids[1]));assert.equal(l.tracks.find(t=>t.id===ids[1]).samples,144000);
 }
 assert.deepEqual(errors,[]);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);console.log(`${name}: waveform editor, bounded looping preview, cancel, save, actual excerpt playback, widening, persistence and restore passed`);
 }finally{await browser.close();}
 }
}finally{if(server?.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}fs.rmSync(data,{recursive:true,force:true});if(logs.includes('Error'))console.log(logs);}
}

// ---------- downloads: offline MP3/ZIP downloads, played back with the network off ----------
async function downloads() {
const root=path.resolve(import.meta.dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'tokify-download-ui-'));
const env={...process.env,TOKIFY_DATA:data,HOST:'127.0.0.1',PORT:'18797'},base='http://127.0.0.1:18797';let server,logs='';
try{
 assert.equal(spawnSync(process.execPath,['--input-type=module','-e',"import './server/db.js';"],{cwd:root,env}).status,0); // creates the database
 const db=new DatabaseSync(path.join(data,'library.sqlite'));
 db.prepare("INSERT INTO playlists(id,name,kind,created) VALUES('download-fixture','Night drive','import',1)").run();
 for(let i=0;i<2;i++){const id=String(7300000000000000001n+BigInt(i));assert.equal(spawnSync(FFMPEG,['-v','error','-y','-f','lavfi','-i',`sine=frequency=${330+i*110}:duration=4:sample_rate=48000`,'-ac','2',path.join(data,'audio',id+'.wav')]).status,0);db.prepare("INSERT INTO tracks(id,title,author,status,samples,audio_file,source_name,added) VALUES(?,?,?,'ok',?,?,?,?)").run(id,['Afterglow','Night drive'][i],['Luma','Vela'][i],192000,id+'.wav','Night drive',i);db.prepare("INSERT INTO playlist_tracks VALUES('download-fixture',?,?)").run(id,i);}
 db.prepare("INSERT INTO tracks(id,title,status,error) VALUES('7300000000000000003','Missing sound','failed','Removed from TikTok')").run();db.prepare("INSERT INTO playlist_tracks VALUES('download-fixture','7300000000000000003',2)").run();db.close();
 server=spawn(process.execPath,['server/index.js'],{cwd:root,env,stdio:['ignore','pipe','pipe']});server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/ping')).ok)break}catch{}await new Promise(r=>setTimeout(r,50));}
 for(const[name,engine,options]of[['desktop',chromium,{viewport:{width:1440,height:1000}}],['iphone',webkit,{...devices['iPhone 13']}]]){
  const b=await engine.launch(),ctx=await b.newContext({...options,acceptDownloads:true});
  try{
   const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.getByRole('heading',{name:'Uploads',exact:true}).waitFor();
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
   // WebKit for Windows cannot play blob: media at all (NotSupportedError), so that step runs elsewhere.
   if(name==='iphone'&&process.platform==='win32'){assert.deepEqual(errors,[]);console.log(`${name}: offline export, counts/report and MP3 download passed (saved-file playback is checked in Chromium; WebKit for Windows cannot play blob: media)`);continue;}
   await ctx.setOffline(true);const offline=await ctx.newPage();await offline.setContent('<input type="file"><audio controls></audio><button>Play saved music</button><script>document.querySelector("button").onclick=()=>{const f=document.querySelector("input").files[0],a=document.querySelector("audio");a.src=URL.createObjectURL(f);a.play();};</script>');
   await offline.locator('input').setInputFiles(saved);await offline.getByRole('button',{name:'Play saved music'}).click();await offline.waitForFunction(()=>document.querySelector('audio').currentTime>5,{},{timeout:20000});
   assert.ok(await offline.locator('audio').evaluate(a=>a.duration>6&&a.duration<8));assert.equal(await offline.locator('audio').evaluate(a=>a.paused),false);
   await offline.locator('audio').evaluate(a=>{a.currentTime=1});await offline.waitForFunction(()=>document.querySelector('audio').currentTime>1.2);assert.deepEqual(errors,[]);
   console.log(`${name}: offline export, counts/report, MP3 download, playlist controls and actual saved-file playback/seek with network disabled passed`);
  }finally{await b.close();}
 }
}finally{if(server?.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}fs.rmSync(data,{recursive:true,force:true});if(logs.includes('[export]'))console.log(logs);}
}

// ---------- offline: organizing the library with the internet blocked, through npm start ----------
async function offline() {
const root=path.resolve(import.meta.dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'tokify-local-edit-'));
const env={...process.env,TOKIFY_DATA:data,PORT:'18798',HOST:'127.0.0.1',TOKIFY_NO_OPEN:'1'},base='http://127.0.0.1:18798';let pid;
function boot(){const r=spawnSync(process.execPath,['server/system.js','start'],{cwd:root,env,encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);pid=Number(fs.readFileSync(path.join(data,'server.pid'),'utf8'));}
async function stop(){if(!pid)return;try{process.kill(pid,'SIGTERM');}catch{}for(let i=0;i<100;i++){try{process.kill(pid,0);}catch{pid=null;return;}await new Promise(r=>setTimeout(r,50));}throw Error('Local server did not stop');}
try{
 assert.equal(spawnSync(process.execPath,['--input-type=module','-e',"import './server/db.js';"],{cwd:root,env}).status,0); // creates the database
 const ids=['7200000000000000001','7200000000000000002','7200000000000000003'];const db=new DatabaseSync(path.join(data,'library.sqlite'));
 db.prepare("INSERT INTO playlists(id,name,kind,created) VALUES('source','My saved sounds','import',1)").run();
 for(const [i,id]of ids.entries()){
  assert.equal(spawnSync(FFMPEG,['-v','error','-y','-f','lavfi','-i',`sine=frequency=${330+i*110}:duration=6:sample_rate=48000`,'-ac','2',path.join(data,'audio',id+'.wav')]).status,0);
  db.prepare("INSERT INTO tracks(id,title,author,status,samples,audio_file,source_name,added) VALUES(?,?,?,'ok',?,?,?,?)").run(id,['Afterglow','Night drive','Slow motion'][i],['Luma','Vela','Mira Lane'][i],288000,id+'.wav','My saved sounds',i);
  db.prepare("INSERT INTO playlist_tracks VALUES('source',?,?)").run(id,i);
 }db.close();boot();
 for(const [name,engine]of [['chromium',chromium],['safari',webkit]]){
  const browser=await engine.launch(),ctx=await browser.newContext({viewport:{width:1440,height:1000}});let outside=0;
  try{
   await ctx.addInitScript(()=>Object.defineProperty(navigator,'onLine',{get:()=>false}));
   await ctx.route('**/*',route=>{const host=new URL(route.request().url()).hostname;if(['127.0.0.1','localhost'].includes(host))return route.continue();outside++;return route.abort();});
   const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.getByRole('heading',{name:'Uploads',exact:true}).waitFor();assert.equal(await p.evaluate(()=>navigator.onLine),false);
   const flight=`Flight mix · ${name}`,ambient=`Ambient · ${name}`;
   async function create(name){await p.getByRole('button',{name:/^New playlist/}).click();await p.locator('.hero .title').waitFor();const id=decodeURIComponent(p.url().split('/p/')[1]);await p.locator('.hero .title').click();await p.getByRole('textbox',{name:'Playlist name',exact:true}).fill(name);await p.keyboard.press('Enter');await p.locator('.hero .title').filter({hasText:name}).waitFor();return id;}
   const flightId=await create(flight);await p.getByRole('button',{name:'Home',exact:true}).click();
   const playlistCount=async()=>(await(await ctx.request.get(base+'/api/library')).json()).playlists.length;const before0=await playlistCount();
   await p.getByRole('button',{name:/^New playlist/}).click();await p.locator('.hero .title').waitFor();assert.equal(await playlistCount(),before0+1);await p.getByRole('button',{name:'Home',exact:true}).click();
   for(let i=0;i<40&&await playlistCount()!==before0;i++)await p.waitForTimeout(100);assert.equal(await playlistCount(),before0,'an untouched new playlist is removed on leaving it');
   async function add(names,playlist){await p.getByRole('tab',{name:'All songs',exact:true}).click();await p.getByRole('button',{name:'Select',exact:true}).click();for(const name of names)await p.locator('.list .row').filter({hasText:name}).locator('.title').click();await p.getByRole('button',{name:'Add to playlist',exact:true}).click();await p.getByRole('menuitem',{name:playlist,exact:true}).click();await p.getByRole('button',{name:'Select',exact:true}).waitFor();}
   await add(['Afterglow','Night drive'],flight);await p.locator('.rail').getByRole('button',{name:flight,exact:true}).click();await p.locator('.hero .title').filter({hasText:flight}).waitFor();await p.waitForFunction(()=>document.querySelectorAll('.list .row').length===2);
   const before=await p.locator('.list .row .title').allTextContents(),a=await p.locator('.list .row').first().boundingBox(),b=await p.locator('.list .row').nth(1).boundingBox();
   const reordered=p.waitForResponse(r=>r.url().endsWith('/api/playlists/'+flightId)&&r.request().method()==='PATCH');
   await p.mouse.move(a.x+a.width*.4,a.y+a.height*.5);await p.mouse.down();await p.mouse.move(b.x+b.width*.4,b.y+b.height*.7,{steps:12});await p.mouse.up();await reordered;assert.deepEqual(await p.locator('.list .row .title').allTextContents(),before.toReversed());
   const first=p.locator('.list .row').first();const removed=await first.locator('.title').innerText();await first.hover();await first.getByRole('button',{name:'Song menu',exact:true}).click();await p.getByRole('menuitem',{name:'Remove from playlist',exact:true}).click();await p.waitForFunction(()=>document.querySelectorAll('.list .row').length===1);
   let row=p.locator('.list .row').first();const keptTitle=await row.locator('.title').innerText();await row.hover();const edited=`My flight sound · ${name}`;await editSong(p,row,'title',edited);await p.locator('.list .row').filter({hasText:edited}).waitFor();
   await p.getByRole('button',{name:'Home',exact:true}).click();const ambientId=await create(ambient);await p.getByRole('button',{name:'Home',exact:true}).click();await add([removed,'Slow motion'],ambient);await p.locator('.rail').getByRole('button',{name:ambient,exact:true}).click();await p.locator('.hero .title').filter({hasText:ambient}).waitFor();await p.waitForFunction(()=>document.querySelectorAll('.list .row').length===2);
   await p.waitForTimeout(500);await p.screenshot({path:`screenshots/offline-organize-${name}.png`});
   const snapshot=await(await ctx.request.get(base+'/api/library')).json();const wanted=snapshot.playlists.filter(pl=>[flightId,ambientId].includes(pl.id));assert.equal(wanted.find(pl=>pl.id===flightId).trackIds.length,1);assert.equal(wanted.find(pl=>pl.id===ambientId).trackIds.length,2);assert.equal(snapshot.tracks.length,3);
   await p.reload();await p.locator('.hero .title').filter({hasText:ambient}).waitFor();await stop();boot();await p.reload();await p.locator('.hero .title').filter({hasText:ambient}).waitFor();
   const restored=await(await ctx.request.get(base+'/api/library')).json();assert.deepEqual(restored.playlists.filter(pl=>[flightId,ambientId].includes(pl.id)),wanted);assert.ok(restored.tracks.some(t=>t.title===edited));
   await p.locator('.rail').getByRole('button',{name:flight,exact:true}).click();await p.locator('.list .row').filter({hasText:edited}).locator('.c-idx').click();await p.waitForFunction(()=>{const a=document.querySelector('audio');return a&&!a.paused&&a.currentTime>.2});
   assert.equal(outside,0);assert.deepEqual(errors,[]);console.log(`${name}: local offline launcher, create/rename playlists, multi-select filing, drag reorder, remove, metadata edit, reload, server restart and audio passed with internet blocked`);
   // Restore the shared test track name before the second browser's run.
   const changed=restored.tracks.find(t=>t.title===edited);await ctx.request.patch(base+'/api/tracks/'+changed.id,{data:{title:keptTitle}});
  }finally{await browser.close();}
 }
}finally{await stop();fs.rmSync(data,{recursive:true,force:true});}
}

// ---------- library: your real library (Tokify running, TikTok archive in the folder) ----------
async function library() {
const base = process.env.TOKIFY_BASE_URL || 'http://localhost:8788';
const errors = [];
const browsers = [];
const playlistIds = [];
let auth;
try {
  const browser = await chromium.launch(); browsers.push(browser);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  auth = ctx.request;
  const lib = await (await auth.get(base + '/api/library')).json();
  const original = lib.playlists.find((p) => p.kind === 'import' && p.trackIds.length > 100);
  const tracks = original.trackIds.map((id) => lib.tracks.find((t) => t.id === id)).filter((t) => t.status === 'ok').slice(0, 3);
  assert.equal(tracks.length, 3);
  const unavailable = lib.tracks.find((t) => t.status === 'failed');
  const create = await auth.post(base + '/api/playlists', { data: { name: 'Проверка плеера', trackIds: [...tracks.map((t) => t.id), ...(unavailable ? [unavailable.id] : [])] } });
  const { id } = await create.json(); playlistIds.push(id);
  const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base); await page.getByRole('heading', { name: 'Uploads', exact: true }).waitFor();
  await page.waitForTimeout(1100); await page.screenshot({ path: 'screenshots/01-import-desktop.png' });
  await page.locator('.import').filter({ hasText: original.name }).click();
  await page.waitForTimeout(600); await page.screenshot({ path: 'screenshots/06-processing-desktop.png' });
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('input[type=file][multiple]').first().setInputFiles('TikTok_Data_1793457765.zip');
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.getByText('New upload', { exact: true }).waitFor();
  assert.match(await page.locator('.lead').first().innerText(), /967/);
  await page.waitForTimeout(500); await page.screenshot({ path: 'screenshots/02-config-desktop.png' });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('nav').getByRole('button', { name: original.name, exact: true }).click();
  await page.waitForTimeout(800); await page.screenshot({ path: 'screenshots/03-playlist-desktop.png' });
  await page.goto(base + '/#/p/' + id);
  await page.locator('nav').getByRole('button', { name: 'Проверка плеера', exact: true }).click();
  await page.locator('.actions > .play').click();
  await page.waitForFunction(() => { const a = document.querySelector('audio'); return a && !a.paused && a.currentTime > .3; }, null, { timeout: 30000 });
  const initialTitle = await page.locator('.bar .np-title').first().innerText();
  await page.getByRole('button', { name: 'Next', exact: true }).filter({ visible: true }).click();
  await page.waitForFunction((title) => document.querySelector('.bar .np-title')?.textContent !== title, initialTitle);
  await page.keyboard.press('Space'); await page.waitForFunction(() => document.querySelector('audio').paused);
  await page.keyboard.press('Space'); await page.waitForFunction(() => !document.querySelector('audio').paused);
  await page.locator('.row').nth(2).getByRole('button', { name: 'Song menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Play next', exact: true }).click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Queue', exact: true }).click();
  await page.waitForTimeout(500); await page.screenshot({ path: 'screenshots/05-queue-desktop.png' });
  await page.locator('.panel.open').getByRole('button', { name: 'Close', exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole('radio', { name: 'Direct', exact: true }).click(); await page.waitForTimeout(700);
  await page.getByRole('radio', { name: 'Fade', exact: true }).click(); await page.waitForTimeout(700);
  await page.getByRole('radio', { name: 'Crossfade', exact: true }).click(); await page.waitForTimeout(700);
  // Restart at the first clip; stop JavaScript across a track boundary.
  await page.locator('.row').first().locator('.c-idx').click();
  await page.waitForFunction(() => {const a=document.querySelector('audio');return !a.paused && a.currentTime>.3;});
  const firstDuration = tracks[0].samples / 48000;
  const startAt = Math.max(0, firstDuration - Math.min(1.5, firstDuration/3) - 2);
  await page.evaluate((time) => { document.querySelector('audio').currentTime = time; }, startAt);
  await page.waitForTimeout(400);
  const before = await page.locator('audio').evaluate((a) => a.currentTime);
  const cdp = await ctx.newCDPSession(page); await cdp.send('Debugger.enable'); await cdp.send('Debugger.pause');
  await new Promise((r) => setTimeout(r, 6000));
  await cdp.send('Debugger.resume');
  const after = await page.locator('audio').evaluate((a) => a.currentTime);
  assert.ok(after - before > 4.5, `audio stopped with JS paused: ${before} -> ${after}`);
  console.log('Chromium: audio advanced across the transition while JavaScript was paused:', (after-before).toFixed(2), 's');
  await cdp.detach();
  await page.waitForTimeout(500); await page.screenshot({ path: 'screenshots/04-player-desktop.png' });
  await page.keyboard.press('Space'); await page.waitForTimeout(400);
  const savedTitle = await page.locator('.bar .np-title').first().innerText();
  await page.reload(); await page.locator('.bar').waitFor(); assert.equal(await page.locator('.bar .np-title').first().innerText(), savedTitle);
  console.log('Chromium: playback, next, space, queue, transitions, resume passed');
  await ctx.storageState({ path: 'screenshots/qa-state.json' });
  const wk = await webkit.launch(); browsers.push(wk);
  const mobile = await wk.newContext({ ...devices['iPhone 13'], storageState: 'screenshots/qa-state.json' });
  const phone = await mobile.newPage(); phone.on('pageerror', (e) => errors.push(e.message));
  await phone.goto(base); await phone.getByRole('heading', { name: 'Uploads', exact: true }).waitFor();
  await phone.waitForTimeout(1100); await phone.screenshot({ path: 'screenshots/01-import-iphone.png' });
  await phone.locator('.import').filter({ hasText: original.name }).tap();
  await phone.waitForTimeout(600); await phone.screenshot({ path: 'screenshots/06-processing-iphone.png' });
  await phone.getByRole('button', { name: /Hide.*keep downloading/ }).tap();
  await phone.locator('input[type=file][multiple]').first().setInputFiles('TikTok_Data_1793457765.zip');
  await phone.getByRole('button', { name: 'Upload', exact: true }).tap(); await phone.getByText('New upload', { exact: true }).waitFor();
  await phone.waitForTimeout(500); await phone.screenshot({ path: 'screenshots/02-config-iphone.png' });
  await phone.getByRole('button', { name: 'Close', exact: true }).tap();
  await phone.locator('nav').getByRole('button', { name: original.name, exact: true }).tap();
  await phone.waitForTimeout(800); await phone.screenshot({ path: 'screenshots/03-playlist-iphone.png' });
  await phone.locator('nav').getByRole('button', { name: 'Проверка плеера', exact: true }).tap();
  await phone.locator('.actions > .play').tap();
  await phone.waitForFunction(() => { const a=document.querySelector('audio');return a && !a.paused && a.currentTime>.3; }, null, { timeout:30000 });
  await phone.waitForTimeout(600); await phone.screenshot({ path:'screenshots/04-player-iphone.png' });
  await phone.locator('.mini .np-title').tap(); await phone.waitForTimeout(600); await phone.screenshot({ path:'screenshots/05-nowplaying-iphone.png' });
  assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  console.log('WebKit with iPhone viewport: touch playback, layout, full player passed (not a physical iPhone)');
  assert.deepEqual(errors, []);
} finally {
  for (const id of playlistIds) await auth?.delete(base + '/api/playlists/' + id).catch(()=>{});
  for (const b of browsers) await b.close();
}
}

// ---------- repeat: repeat one song in your real library (Tokify running) ----------
async function repeat() {
const base = process.env.TOKIFY_BASE_URL || 'http://localhost:8788';
for (const [name, engine, options] of [
  ['desktop', chromium, { viewport: { width: 1440, height: 1000 } }],
  ['iphone', webkit, { ...devices['iPhone 13'] }],
]) {
  const browser = await engine.launch();
  const ctx = await browser.newContext(options);
  const api = ctx.request;
  let playlist;
  try {
    const library = await (await api.get(base + '/api/library')).json();
    const tracks = library.tracks.filter((t) => t.status === 'ok').slice(0, 3);
    assert.equal(tracks.length, 3);
    playlist = (await (await api.post(base + '/api/playlists', { data: { name: 'Проверка повтора', trackIds: tracks.map((t) => t.id) } })).json()).id;
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + '/#/p/' + playlist);
    await page.locator('.row').first().waitFor();
    const rows = page.locator('.row');
    const button = rows.first().getByRole('button', { name: 'Repeat song', exact: true });
    const sessionAfter = async (action) => {
      const pending = page.waitForRequest((r) => r.url().endsWith('/api/sessions') && r.method() === 'POST');
      await action();
      return (await pending).postDataJSON();
    };
    const press = async (locator) => {
      if (name === 'iphone') return locator.tap();
      if (await locator.getAttribute('aria-label') === 'Repeat song') await locator.locator('..').locator('..').hover();
      return locator.click();
    };
    let data = await sessionAfter(() => press(button));
    assert.ok(data.items.length > 1 && data.items.every((it) => it.id === tracks[0].id));
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    await page.waitForFunction(() => { const a = document.querySelector('audio'); return a && !a.paused && a.currentTime > .1; });
    for (const [label, mode] of [['Direct', 'none'], ['Fade', 'fade'], ['Crossfade', 'crossfade']]) {
      data = await sessionAfter(() => press(page.getByRole('radio', { name: label, exact: true })));
      assert.equal(data.mode, mode);
      assert.ok(data.items.every((it) => it.id === tracks[0].id));
    }
    // Unselecting repeat restores the following songs in the current playlist.
    data = await sessionAfter(() => press(button));
    assert.equal(await button.getAttribute('aria-pressed'), 'false');
    assert.ok(data.items.some((it) => it.id === tracks[1].id));
    // A different row starts repeating that song, rather than the previous song.
    const second = rows.nth(1).getByRole('button', { name: 'Repeat song', exact: true });
    data = await sessionAfter(() => press(second));
    assert.ok(data.items.every((it) => it.id === tracks[1].id));
    assert.equal(await second.getAttribute('aria-pressed'), 'true');
    assert.equal(await button.getAttribute('aria-pressed'), 'false');
    await page.waitForTimeout(500);
    await page.reload(); await page.locator('.row').first().waitFor();
    assert.equal(await rows.nth(1).getByRole('button', { name: 'Repeat song', exact: true }).getAttribute('aria-pressed'), 'true');
    // Enable the first playlist icon and check the full active ring fits in its scroll area.
    const firstPlaylist = page.locator('nav .list .item').first(); await press(firstPlaylist);
    await page.waitForTimeout(800);
    const padding = await firstPlaylist.evaluate((el) => {
      const a = el.getBoundingClientRect(), b = el.parentElement.getBoundingClientRect();
      return { top: a.top - b.top, left: a.left - b.left, bottom: b.bottom - a.bottom };
    });
    assert.ok(padding.top >= 6, 'playlist outline is clipped at the top');
    if (name === 'iphone') assert.ok(padding.left >= 6 && padding.bottom >= 6);
    await page.locator('nav').getByRole('button', { name: 'Проверка повтора', exact: true }).click();
    await page.waitForTimeout(800);
    if (name === 'iphone') await page.locator('.main-scroll').evaluate((el) => { el.scrollTop = 260; });
    await page.screenshot({ path: `screenshots/repeat-${name}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(name + ': repeat any row, all 3 transitions, disable, switch song, restore, sidebar outline and layout passed');
  } finally {
    if (playlist) await api.delete(base + '/api/playlists/' + playlist);
    await api.post(base + '/api/logout').catch(() => {});
    await browser.close();
  }
}
}

const checks = { files, links, media, clips, downloads, offline, library, repeat };
const isolated = ['files', 'links', 'media', 'clips', 'downloads', 'offline'];
const chosen = process.argv.slice(2);
const unknown = chosen.filter((name) => !checks[name]);
if (unknown.length) { console.error(`Unknown check: ${unknown.join(', ')}. Choose from: ${Object.keys(checks).join(', ')}`); process.exit(1); }
fs.mkdirSync('screenshots', { recursive: true });
for (const name of chosen.length ? chosen : isolated) {
  console.log(`\n# ${name}`);
  await checks[name]();
}

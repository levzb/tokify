import{chromium,webkit,devices}from'playwright';import fs from'node:fs';import os from'node:os';import path from'node:path';import assert from'node:assert/strict';import{spawn,spawnSync}from'node:child_process';import{once}from'node:events';
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
 assert.equal(spawnSync(process.execPath,['--input-type=module','-e',"import {setPassword}from'./server/auth.js';setPassword('media-test-password');"],{cwd:root,env}).status,0);
 assert.equal(spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=440:duration=3:sample_rate=48000','-c:a','aac',audio]).status,0);
 server=spawn(process.execPath,['--import',preload,'server/index.js'],{cwd:root,env,stdio:['ignore','pipe','pipe']});server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/me')).ok)break}catch{}await new Promise(r=>setTimeout(r,50));}
 for(const[name,engine,options]of [['desktop',chromium,{viewport:{width:1440,height:1000}}],['iphone',webkit,{...devices['iPhone 13']} ]]){
 const browser=await engine.launch(),ctx=await browser.newContext(options);
 try{
 await ctx.request.post(base+'/api/login',{data:{password:'media-test-password'}});const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.getByRole('heading',{name:'Uploads',exact:true}).waitFor();const input=p.getByRole('textbox',{name:'Music link',exact:true}),section=p.locator('.link-import');
 for(const[url,provider]of [['https://youtu.be/jNQXAC9IVRw','YouTube'],['https://soundcloud.com/artist/track','SoundCloud']]){
  await input.fill(url);await p.getByRole('button',{name:'Find sound',exact:true}).click();await section.locator('.result').waitFor();await section.getByRole('link',{name:provider,exact:true}).waitFor();await p.waitForTimeout(350);await p.screenshot({path:`screenshots/media-${provider.toLowerCase()}-${name}.png`});
  if(await section.getByRole('button',{name:'Import',exact:true}).count()){await section.getByRole('button',{name:'Import',exact:true}).click();await section.getByRole('button',{name:'Open',exact:true}).waitFor({timeout:30000});}
 }
 await input.fill('https://soundcloud.com/artist/preview');await p.getByRole('button',{name:'Find sound',exact:true}).click();await p.getByRole('alert').filter({hasText:'Only a preview'}).waitFor();assert.equal(await section.getByRole('button',{name:'Import',exact:true}).count(),0);
 await input.fill('https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl');await p.getByRole('button',{name:'Find sound',exact:true}).click();await section.getByRole('button',{name:'Find on YouTube',exact:true}).waitFor();assert.equal(await section.getByRole('button',{name:'Import',exact:true}).count(),0);assert.match(await section.innerText(),/not a full audio download/);
 const before=(await(await ctx.request.get(base+'/api/library')).json()).tracks.length;await section.getByRole('button',{name:'Find on YouTube',exact:true}).click();await section.getByRole('button',{name:'Choose',exact:true}).waitFor();assert.equal((await(await ctx.request.get(base+'/api/library')).json()).tracks.length,before,'Spotify search must not add or download audio');await p.waitForTimeout(350);await p.screenshot({path:`screenshots/media-spotify-${name}.png`});
 await section.getByRole('button',{name:'Choose',exact:true}).click();await section.getByRole('link',{name:'YouTube',exact:true}).waitFor();if(await section.getByRole('button',{name:'Import',exact:true}).count()){await section.getByRole('button',{name:'Import',exact:true}).click();await section.getByRole('button',{name:'Open',exact:true}).waitFor({timeout:30000});}
 const lib=await(await ctx.request.get(base+'/api/library')).json();assert.equal(lib.playlists.filter(p=>p.kind==='external').length,1);assert.equal(lib.playlists[0].kind,'external');assert.equal(lib.tracks.length,3);assert.ok(lib.tracks.every(t=>['youtube','soundcloud'].includes(t.origin)));
 // New source IDs must work in every ordinary playlist and in the renderer.
 const created=await ctx.request.post(base+'/api/playlists',{data:{name:'Multisource',trackIds:lib.tracks.map(t=>t.id)}});assert.equal(created.status(),200);const{id}=await created.json();const changed=await ctx.request.patch(base+'/api/playlists/'+id,{data:{trackIds:lib.tracks.map(t=>t.id).reverse()}});assert.equal(changed.status(),200);
 const sid=crypto.randomUUID(),session=await ctx.request.post(base+'/api/sessions',{data:{id:sid,mode:'crossfade',items:lib.tracks.map(t=>({id:t.id}))}});assert.equal(session.status(),200);const stream=await ctx.request.get(base+'/stream/'+sid+'.mp3');assert.equal(stream.status(),200);assert.ok((await stream.body()).length>10000);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);console.log(`${name}: YouTube, SoundCloud, preview rejection, explicit Spotify → YouTube choice, shared destination, playlists, reorder and continuous playback passed`);
 }finally{await browser.close();}
 }
}finally{if(server?.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}fs.rmSync(data,{recursive:true,force:true});if(logs.includes('[import]'))console.log(logs);}

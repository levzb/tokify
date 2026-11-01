import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { buildTimeline, SR, FRAME_BYTES } from '../shared/timeline.js';

const root = path.resolve(import.meta.dirname, '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'tokify-test-'));
const env = { ...process.env, TOKIFY_DATA: data, HOST: '127.0.0.1', PORT: '18789' };
let server, cookie;
let logs = '';
const base = 'http://127.0.0.1:18789';
const ids = ['1234567890123456789', '2234567890123456789'];
const setup = spawnSync(process.execPath, ['--input-type=module', '-e', `import { setPassword } from './server/auth.js'; setPassword('test-password-only');`], { cwd: root, env });
assert.equal(setup.status, 0, setup.stderr?.toString());
for (const [i, id] of ids.entries()) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${440 * (i + 1)}:duration=8:sample_rate=48000`, '-ac', '2', path.join(data, 'audio', `${id}.wav`)]);
  assert.equal(r.status, 0, r.stderr?.toString());
}
const db = new DatabaseSync(path.join(data, 'library.sqlite'));
for (const id of ids) db.prepare("INSERT INTO tracks (id,title,author,status,samples,audio_file,added) VALUES (?,?,'Fixture','ok',?,?,1)").run(id, `Test ${id}`, 8 * SR, `${id}.wav`);
db.close();
async function boot() {
  server = spawn(process.execPath, ['server/index.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (s) => { logs += s; }); server.stderr.on('data', (s) => { logs += s; });
  for (let i = 0; i < 100; i++) { try { const r = await fetch(base + '/api/me'); if (r.ok) return; } catch {} await new Promise((r) => setTimeout(r, 50)); }
  throw new Error('Server did not start: ' + logs);
}
async function stop() { server.kill('SIGTERM'); await once(server, 'exit'); }
async function request(p, method = 'GET', body, extra = {}) {
  return fetch(base + p, { method, headers: { cookie: cookie || '', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
}
async function json(p, method, body) { const r = await request(p, method, body); assert.equal(r.status, 200, await r.clone().text()); return r.json(); }

await test('backend, library, persistence and continuous audio', async (t) => {
  t.after(async () => { if (server?.exitCode === null) await stop(); fs.rmSync(data, { recursive: true, force: true }); });
  await boot();
  await t.test('password protects library and audio; malformed inputs do not crash', async () => {
    assert.equal((await request('/api/library')).status, 401);
    assert.equal((await request('/stream/' + randomUUID() + '.mp3')).status, 401);
    assert.equal((await request('/api/login', 'POST', { password: 'wrong' })).status, 401);
    const login = await request('/api/login', 'POST', { password: 'test-password-only' });
    assert.equal(login.status, 200); cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/api/playlists', 'POST', '{bad')).status, 400);
    assert.equal((await request('/api/imports', 'POST', { items: [{ musicId: '../bad' }] })).status, 400);
    assert.equal((await request('/api/playlists', 'POST', { trackIds: 'wrong' })).status, 400);
    assert.equal((await request('/%GG')).status, 400);
    assert.equal((await request('/api/playlists', 'POST', {}, { Origin: 'https://evil.example' })).status, 403);
  });
  let playlist;
  await t.test('TikTok link APIs require login and reject invalid links or expired previews', async () => {
    const unauth = await fetch(base+'/api/tiktok/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({link:'https://www.tiktok.com/music/sound-123'})});
    assert.equal(unauth.status,401);
    assert.equal((await request('/api/tiktok/resolve','POST',{link:'https://example.com/video/123'})).status,400);
    assert.equal((await request('/api/tiktok/resolve','POST',{link:'https://tiktok.com/@person'})).status,400);
    assert.equal((await request('/api/tiktok/download','POST',{token:'expired'})).status,400);
  });
  await t.test('create, rename, reorder, deduplicate and remove playlist membership', async () => {
    playlist = (await json('/api/playlists', 'POST', { name: 'Мои звуки 🎧', trackIds: ids })).id;
    assert.equal((await request(`/api/playlists/${playlist}`, 'PATCH', { trackIds: [ids[0]] })).status, 400);
    await json(`/api/playlists/${playlist}`, 'PATCH', { name: 'Ночь', trackIds: ids.toReversed(), transition: 'fade', shuffle: true });
    const lib = await json('/api/library'); assert.equal(lib.playlists[0].name, 'Ночь'); assert.deepEqual(lib.playlists[0].trackIds, ids.toReversed()); assert.equal(lib.playlists[0].shuffle, true);
    assert.equal((await json(`/api/playlists/${playlist}/tracks`, 'POST', { trackIds: ids })).added, 0);
    assert.equal((await request('/api/playlists/missing/tracks', 'POST', { trackIds: ids })).status, 404);
  });
  await t.test('reimport reuses audio, durable job survives server restart', async () => {
    const result = await json('/api/imports', 'POST', { name: 'Import', items: [...ids, ids[0]].map((musicId) => ({ musicId })) });
    let j;
    for (let i = 0; i < 30; i++) { j = await json('/api/jobs/' + result.jobId); if (j.finished) break; await new Promise((r) => setTimeout(r, 30)); }
    assert.equal(j.reused, 2); assert.equal(j.total, 2); assert.equal(j.failed, 0);
    await stop(); await boot();
    assert.equal((await json('/api/jobs/' + result.jobId)).reused, 2);
    assert.equal((await json('/api/library')).playlists.length, 2);
  });
  await t.test('unfinished import resumes after restart without downloading cached audio', async () => {
    await stop();
    const storage = new DatabaseSync(path.join(data, 'library.sqlite'));
    const job = { id: 'restart-fixture', playlistId: null, name: 'Interrupted', total: 1, done: 0, ok: 0, failed: 0, reused: 0, finished: false, items: { [ids[0]]: { status: 'working' } }, started: Date.now() };
    storage.prepare('INSERT INTO import_jobs VALUES (?, ?)').run(job.id, JSON.stringify(job)); storage.close();
    await boot();
    let resumed;
    for (let i = 0; i < 30; i++) { resumed = await json('/api/jobs/restart-fixture'); if (resumed.finished) break; await new Promise((r) => setTimeout(r, 30)); }
    assert.equal(resumed.finished, true); assert.equal(resumed.done, 1); assert.equal(resumed.reused, 1);
  });
  await t.test('custom covers: upload, private retrieval, restore, reject damaged image', async () => {
    const image = fs.readFileSync(path.join(root, 'public/icon-512.png'));
    const put = (p, body) => fetch(base + p, { method: 'PUT', headers: { cookie, 'Content-Type': 'image/png' }, body });
    assert.equal((await put(`/api/playlists/${playlist}/cover`, image)).status, 200);
    assert.equal((await put(`/api/tracks/${ids[0]}/cover`, image)).status, 200);
    const lib = await json('/api/library'); const cover = lib.playlists.find((p) => p.id === playlist).cover;
    assert.equal((await fetch(base + cover)).status, 200);
    assert.equal((await fetch(base + cover.split('?')[0])).status, 403);
    assert.equal((await request(`/api/playlists/${playlist}/cover`, 'DELETE')).status, 200);
    assert.equal((await request(`/api/tracks/${ids[0]}/cover`, 'DELETE')).status, 200);
    assert.equal((await put(`/api/playlists/${playlist}/cover`, Buffer.alloc(200, 'x'))).status, 400);
  });
  for (const mode of ['none', 'fade', 'crossfade']) await t.test(`continuous ${mode} stream: valid MP3, transitions, chunk seams, byte ranges`, async () => {
    const id = randomUUID(); const plan = ids.map((id) => ({ id, samples: SR * 8 })); const expected = buildTimeline(plan, mode);
    const session = await json('/api/sessions', 'POST', { id, mode, items: ids.map((id) => ({ id })) });
    assert.equal(session.bytes, expected.bytes);
    const r = await request(`/stream/${id}.mp3`); assert.equal(r.status, 200);
    const audio = Buffer.from(await r.arrayBuffer()); assert.equal(audio.length, expected.bytes); assert.equal(audio.length % FRAME_BYTES, 0);
    const file = path.join(data, `${mode}.mp3`); fs.writeFileSync(file, audio);
    const pcm = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', String(SR), 'pipe:1'], { maxBuffer: 10 << 20 }); assert.equal(pcm.status, 0);
    const samples = new Float32Array(pcm.stdout.buffer, pcm.stdout.byteOffset, pcm.stdout.length / 4);
    const rms = (sec, len = .02) => { const a = Math.round(sec * SR); let v = 0; for (let i = a; i < a + len * SR; i++) v += samples[i] ** 2; return Math.sqrt(v / (len * SR)); };
    for (const seam of [6, 12]) assert.ok(rms(seam) > .025, `gap at chunk seam ${seam}s`);
    if (mode === 'fade') assert.ok(rms(8.15) < .003, 'sequential fades leave their intended brief silence');
    if (mode === 'crossfade') assert.ok(rms(6.7) > .04, 'overlap has audio from both clips');
    const part = await request(`/stream/${id}.mp3`, 'GET', undefined, { Range: 'bytes=117000-123999' }); assert.equal(part.status, 206); assert.deepEqual(Buffer.from(await part.arrayBuffer()), audio.subarray(117000, 124000));
    const suffix = await request(`/stream/${id}.mp3`, 'GET', undefined, { Range: 'bytes=-1000' }); assert.equal(suffix.status, 206); assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), audio.subarray(-1000));
    assert.equal((await request(`/stream/${id}.mp3`, 'GET', undefined, { Range: `bytes=${audio.length}-` })).status, 416);
    assert.equal((await request(`/stream/${id}.mp3`, 'HEAD')).headers.get('content-length'), String(audio.length));
  });
  for (const mode of ['none', 'fade', 'crossfade']) await t.test(`one song repeats with ${mode} transitions inside the audio stream`, async () => {
    const id = randomUUID();
    const items = Array.from({ length: 3 }, () => ({ id: ids[0] }));
    const result = await json('/api/sessions', 'POST', { id, mode, items });
    assert.equal(result.entries, 3);
    const response = await request(`/stream/${id}.mp3`);
    const audio = Buffer.from(await response.arrayBuffer());
    const file = path.join(data, `repeat-${mode}.mp3`); fs.writeFileSync(file, audio);
    const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', String(SR), 'pipe:1'], { maxBuffer: 10 << 20 });
    assert.equal(decoded.status, 0);
    const samples = new Float32Array(decoded.stdout.buffer, decoded.stdout.byteOffset, decoded.stdout.length / 4);
    const step = mode === 'crossfade' ? 6.5 : mode === 'fade' ? 8.35 : 8;
    for (let i = 1; i < 3; i++) {
      const begin = Math.round((i * step + 1) * SR);
      let power = 0;
      for (let k = begin; k < begin + SR / 10; k++) power += samples[k] ** 2;
      assert.ok(Math.sqrt(power / (SR / 10)) > .02, `repeat ${i + 1} has no sound`);
    }
    assert.ok(Math.abs(samples.length / SR - (step * 2 + 8.6)) < .1);
  });
  await t.test('parallel Safari probes arriving before session creation all resume promptly', async () => {
    const id = randomUUID();
    const started = Date.now();
    const probes = Array.from({ length: 3 }, () => request(`/stream/${id}.mp3`, 'HEAD'));
    await new Promise((r) => setTimeout(r, 100));
    await json('/api/sessions', 'POST', { id, mode: 'none', items: [{ id: ids[0] }] });
    for (const response of await Promise.all(probes)) assert.equal(response.status, 200);
    assert.ok(Date.now() - started < 3000, 'a waiting probe was skipped');
  });
  let fileTrack, filePlaylist;
  const rawUpload = async (file, meta) => {
    const r = await fetch(base + '/api/files', { method: 'POST', headers: { cookie, 'Content-Type': 'application/octet-stream', 'X-File-Metadata': encodeURIComponent(JSON.stringify(meta)) }, body: fs.readFileSync(file) });
    assert.equal(r.status, 200, await r.clone().text());
    const result = await r.json();
    for (let i = 0; i < 100; i++) {
      const job = await json('/api/jobs/' + result.jobId);
      if (job.finished) return { ...result, job };
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('File processing did not finish');
  };
  await t.test('external audio import: title, author, private files and pinned upload', async () => {
    const r = await rawUpload(path.join(data, 'audio', ids[0] + '.wav'), { filename: 'Мой звук.wav', author: 'Мой автор' });
    assert.equal(r.job.ok, 1); fileTrack = r.trackId; filePlaylist = r.playlistId;
    assert.match(fileTrack, /^file-[a-f0-9]{64}$/);
    const l = await json('/api/library'), t = l.tracks.find((t) => t.id === fileTrack);
    assert.equal(t.title, 'Мой звук'); assert.equal(t.author, 'Мой автор'); assert.equal(t.origin, 'external'); assert.ok(t.samples > 0);
    assert.equal(l.playlists[0].id, filePlaylist); assert.equal(l.playlists[0].kind, 'external');
    assert.equal(fs.readdirSync(path.join(data, 'uploads')).length, 0, 'original is removed after successful extraction');
  });
  await t.test('external file deduplication, metadata edits and all playlist operations', async () => {
    const r = await rawUpload(path.join(data, 'audio', ids[0] + '.wav'), { filename: 'Copy.wav', title: 'Новое имя', author: 'Автор' });
    assert.equal(r.trackId, fileTrack); assert.equal(r.playlistId, filePlaylist); assert.equal(r.job.reused, 1);
    let l = await json('/api/library'); assert.equal(l.playlists.filter((p) => p.kind === 'external').length, 1);
    assert.equal(l.playlists[0].trackIds.length, 1);
    await json('/api/tracks/' + fileTrack, 'PATCH', { title: 'После правки', author: '' });
    assert.equal((await json('/api/library')).tracks.find((t) => t.id === fileTrack).title, 'После правки');
    await json('/api/tracks/' + ids[0], 'PATCH', { title: 'My TikTok title', author: 'My artist' });
    assert.equal((await json('/api/library')).tracks.find(t=>t.id===ids[0]).title,'My TikTok title');
    assert.equal((await request('/api/tracks/' + ids[0], 'PATCH', { title: '  ' })).status,400);
    assert.equal((await request('/api/tracks/' + ids[0], 'PATCH', { author: null })).status,400);
    assert.equal((await request('/api/tracks/missing', 'PATCH', { title: 'Missing' })).status,404);
    await json(`/api/playlists/${playlist}/tracks`, 'POST', { trackIds: [fileTrack] });
    const all = (await json('/api/library')).playlists.find((p) => p.id === playlist).trackIds;
    await json('/api/playlists/' + playlist, 'PATCH', { trackIds: all.toReversed() });
    const session = await json('/api/sessions', 'POST', { id: randomUUID(), mode: 'crossfade', items: [{ id: fileTrack }, { id: ids[0] }, { id: fileTrack }] });
    assert.equal(session.entries, 3);
  });
  await t.test('video import extracts its audio and a cover; later imports keep My files first', async () => {
    const video = path.join(data, 'test-video.mp4');
    const generated = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=96x96:r=10:d=3', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=3', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', video]);
    assert.equal(generated.status, 0);
    const r = await rawUpload(video, { filename: 'video.mp4', title: 'Из видео', author: 'Режиссёр' }); assert.equal(r.job.ok, 1);
    const l = await json('/api/library'), t = l.tracks.find((t) => t.id === r.trackId);
    assert.equal(t.title, 'Из видео'); assert.ok(t.cover); assert.ok(t.samples / SR > 2.8 && t.samples / SR < 3.2);
    await json('/api/imports', 'POST', { name: 'Later TikTok upload', items: [{ musicId: ids[0] }] });
    assert.equal((await json('/api/library')).playlists[0].id, filePlaylist);
  });
  const scan = (file, filename, endpoint = '/api/files/scan') => fetch(base + endpoint, { method: 'POST', headers: { cookie,
    'Content-Type': 'application/octet-stream', 'X-File-Metadata': encodeURIComponent(JSON.stringify({ filename })) }, body: fs.readFileSync(file) });
  await t.test('photos, disguised images, corrupt audio and videos without audio are rejected before import', async () => {
    const before = (await json('/api/library')).tracks.length;
    const image = path.join(root,'public/icon-512.png');
    const photo = await scan(image,'Photo.png'); assert.equal(photo.status,400); assert.match((await photo.json()).error,/only audio and video/i);
    const disguised = await scan(image,'Disguised.mp3'); assert.equal(disguised.status,400); assert.match((await disguised.json()).error,/no audio track/i);
    const legacy = await scan(image,'Photo.png','/api/files'); assert.equal(legacy.status,400);
    const silent = path.join(data,'no-audio.mp4');
    assert.equal(spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=blue:s=96x96:r=10:d=1','-an','-c:v','mpeg4',silent]).status,0);
    const noAudio = await scan(silent,'Video.mp4'); assert.equal(noAudio.status,400); assert.match((await noAudio.json()).error,/no audio track/i);
    const corrupt = path.join(data,'corrupt.wav'); fs.writeFileSync(corrupt,Buffer.alloc(200,'x'));
    assert.equal((await scan(corrupt,'Broken.wav')).status,400);
    assert.equal((await json('/api/library')).tracks.length,before);
    assert.equal(fs.readdirSync(path.join(data,'uploads')).length,0);
  });
  await t.test('scan prepares a private preview without adding music; commit uses the staged file and edited metadata', async () => {
    const before = (await json('/api/library')).tracks.length;
    const r = await scan(path.join(data,'audio',ids[1]+'.wav'),'Preview.wav'); assert.equal(r.status,200);
    const preview = await r.json(); assert.equal(preview.title,'Preview'); assert.ok(preview.duration > 7.9);
    assert.equal((await json('/api/library')).tracks.length,before);
    assert.ok(fs.existsSync(path.join(data,'uploads',`stage-${preview.token}.source`)));
    const committed = await json('/api/files/commit','POST',{token:preview.token,title:'Из предпросмотра',author:'Автор превью'});
    let job; for(let i=0;i<100;i++){job=await json('/api/jobs/'+committed.jobId);if(job.finished)break;await new Promise(r=>setTimeout(r,30));}
    assert.equal(job.ok,1);
    const track=(await json('/api/library')).tracks.find(t=>t.id===committed.trackId);
    assert.equal(track.title,'Из предпросмотра');assert.equal(track.author,'Автор превью');
    assert.ok(!fs.existsSync(path.join(data,'uploads',`stage-${preview.token}.json`)));
  });
  await t.test('TikTok links share the existing external upload and reuse cached sounds without changing their origin', async () => {
    const before = (await json('/api/library')).playlists.length;
    const found = await json('/api/tiktok/resolve','POST',{link:`https://www.tiktok.com/music/sound-${ids[0]}`});
    assert.equal(found.musicId,ids[0]);assert.equal(found.saved,false);assert.ok(found.token);
    assert.equal((await json('/api/library')).playlists.length,before,'search must not create an upload');
    const result = await json('/api/tiktok/download','POST',{token:found.token});
    assert.equal(result.playlistId,filePlaylist);
    assert.deepEqual(await json('/api/tiktok/download','POST',{token:found.token}),result,'same preview is idempotent');
    let job;for(let i=0;i<50;i++){job=await json('/api/jobs/'+result.jobId);if(job.finished)break;await new Promise(r=>setTimeout(r,30));}
    assert.equal(job.kind,'link');assert.equal(job.reused,1);assert.equal(job.failed,0);
    const lib=await json('/api/library');assert.equal(lib.playlists.length,before);assert.equal(lib.playlists[0].id,filePlaylist);
    assert.equal(lib.playlists[0].trackIds.filter(id=>id===ids[0]).length,1);
    assert.equal(lib.tracks.find(t=>t.id===ids[0]).origin,'tiktok');
    const saved=await json('/api/tiktok/resolve','POST',{link:`https://www.tiktok.com/music/sound-${ids[0]}`});
    assert.equal(saved.saved,true);assert.equal(saved.playlistId,filePlaylist);
    if(saved.cover){assert.equal((await fetch(base+saved.cover)).status,401);assert.equal((await request(saved.cover)).status,200);}
  });
  await t.test('preview cover requires login; cancellation and expiration remove staged files', async () => {
    const r=await scan(path.join(data,'test-video.mp4'),'Cover.mp4');assert.equal(r.status,200);const preview=await r.json();assert.ok(preview.cover);
    assert.equal((await fetch(base+preview.cover)).status,401);
    assert.equal((await request(preview.cover)).status,200);
    await json('/api/files/staged/'+preview.token,'DELETE');
    assert.equal((await request(preview.cover)).status,400);
    assert.equal((await request('/api/files/commit','POST',{token:preview.token})).status,400);
    const expired=await(await scan(path.join(data,'audio',ids[0]+'.wav'),'Expires.wav')).json();
    const stateFile=path.join(data,'uploads',`stage-${expired.token}.json`);
    const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));state.expires=Date.now()-1;fs.writeFileSync(stateFile,JSON.stringify(state));
    assert.equal((await request('/api/files/commit','POST',{token:expired.token})).status,400);
    assert.equal(fs.readdirSync(path.join(data,'uploads')).length,0);
    await stop();await boot();assert.equal((await json('/api/library')).playlists[0].id,filePlaylist);
  });
  await t.test('edited TikTok metadata survives a server restart and a reimport', async () => {
    await json('/api/tracks/'+ids[0],'PATCH',{author:''});
    await stop();await boot();
    let track=(await json('/api/library')).tracks.find(t=>t.id===ids[0]);
    assert.equal(track.title,'My TikTok title');assert.equal(track.author,'');
    const imported=await json('/api/imports','POST',{name:'Edited reimport',items:[{musicId:ids[0],title:'Original export title'}]});
    for(let i=0;i<30;i++){const job=await json('/api/jobs/'+imported.jobId);if(job.finished)break;await new Promise(r=>setTimeout(r,30));}
    track=(await json('/api/library')).tracks.find(t=>t.id===ids[0]);assert.equal(track.title,'My TikTok title');assert.equal(track.author,'');
  });
  await t.test('excerpt API keeps the original private and applies the range everywhere', async () => {
    const url='/api/tracks/'+ids[0];assert.equal((await fetch(base+url+'/clip')).status,401);assert.equal((await fetch(base+url+'/source')).status,401);
    const info=await json(url+'/clip');assert.equal(info.duration,8);assert.ok(info.waveform.length);
    const partial=await request(url+'/source','GET',undefined,{Range:'bytes=0-99'});assert.equal(partial.status,206);assert.deepEqual(Buffer.from(await partial.arrayBuffer()),fs.readFileSync(path.join(data,'audio',ids[0]+'.wav')).subarray(0,100));
    assert.equal((await request(url+'/source','HEAD')).status,200);assert.equal((await request(url+'/source','GET',undefined,{Range:'bytes=999999999-'})).status,416);
    await json(url+'/clip','PATCH',{start:1.25,end:3.75,version:info.version});let track=(await json('/api/library')).tracks.find(t=>t.id===ids[0]);assert.equal(track.samples,120000);assert.equal(track.clipped,true);assert.equal(track.originalDuration,8);
    await stop();await boot();assert.equal((await json(url+'/clip')).start,1.25);
    assert.equal((await request(url+'/clip','PATCH',{start:0,end:.1})).status,400);await json(url+'/clip','PATCH',{reset:true});track=(await json('/api/library')).tracks.find(t=>t.id===ids[0]);assert.equal(track.samples,384000);assert.equal(track.clipped,false);
  });
  await t.test('offline export downloads require login, support ranges and stay on disk after restart', async () => {
    assert.equal((await fetch(base+'/api/exports')).status,401);
    const job=await json('/api/exports','POST',{trackIds:[ids[0]],format:'mix',mode:'crossfade'});
    let ready;for(let i=0;i<200;i++){ready=await json('/api/exports/'+job.id);if(ready.status==='ready')break;assert.notEqual(ready.status,'error',ready.error);await new Promise(r=>setTimeout(r,30));}
    assert.equal(ready.status,'ready');assert.equal((await fetch(base+ready.url)).status,401);
    const full=await request(ready.url);assert.equal(full.status,200);assert.match(full.headers.get('content-disposition'),/attachment/);
    const audio=Buffer.from(await full.arrayBuffer());assert.equal(audio.length,ready.bytes);
    const range=await request(ready.url,'GET',undefined,{Range:'bytes=100-199'});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),audio.subarray(100,200));
    assert.equal((await request(ready.url,'GET',undefined,{Range:'bytes=999999999-'})).status,416);
    assert.equal((await request(ready.url,'HEAD')).headers.get('content-length'),String(audio.length));
    assert.equal((await json(ready.reportUrl)).tracks.length,1);await stop();await boot();assert.equal((await json('/api/exports/'+job.id)).status,'ready');
  });
  await t.test('deleting playlists hides songs but preserves the private download cache', async () => {
    for (const p of (await json('/api/library')).playlists) await json('/api/playlists/' + p.id, 'DELETE');
    assert.equal((await json('/api/library')).tracks.length, 0);
    assert.ok(fs.existsSync(path.join(data, 'audio', ids[0] + '.wav')));
  });
});

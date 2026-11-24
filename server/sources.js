// Where songs come from: TikTok, YouTube, SoundCloud and Spotify. Only fetching lives here;
// turning a fetched sound into a library song is in imports.js.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { parseTikTokLink, musicFromTikTokData, parseMediaLink } from './shared.js';
import { tool } from './system.js';

// ---------- TikTok ----------
// Sound pages only expose their data to a real browser, so they are opened in headless Chromium
// on the owner's computer (authorized by the owner for their own favorites).

let browserP = null;
let idleTimer = null;

async function browser() {
  clearTimeout(idleTimer);
  if (!browserP) {
    browserP = (async () => {
      const { chromium } = await import('playwright');
      const b = await chromium.launch({ headless: true });
      const ctx = await b.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 } });
      // Only the page's own scripts and data are needed.
      await ctx.route('**/*', (route) => {
        const req = route.request();
        if (req.isNavigationRequest() && req.frame() === req.frame().page().mainFrame()) {
          const host = new URL(req.url()).hostname;
          if (!['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'].includes(host)) return route.abort();
        }
        const t = req.resourceType();
        if (t === 'image' || t === 'media' || t === 'font' || t === 'stylesheet') return route.abort();
        return route.continue();
      });
      return { b, ctx };
    })().catch((e) => { browserP = null; throw e; });
  }
  return browserP;
}

function scheduleClose() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    const p = browserP; browserP = null;
    if (p) try { (await p).b.close(); } catch {}
  }, 60_000);
  idleTimer.unref();
}

export class SoundError extends Error {
  constructor(message, { retryable = false } = {}) { super(message); this.retryable = retryable; }
}

// Short-lived metadata cache: previewing a link does not download its audio, and
// clicking Download can reuse the exact sound found in a video.
const soundCache = new Map();
export function rememberSound(info) {
  if (!info?.playUrl || !info.musicId) return;
  soundCache.set(info.musicId, { info, expires: Date.now() + 10 * 60_000 });
  if (soundCache.size > 200) soundCache.delete(soundCache.keys().next().value);
}

async function pageMusic(url, videoId = null) {
  const { ctx } = await browser();
  const page = await ctx.newPage();
  let found = null;
  page.on('response', async (r) => {
    if (!/\/api\/(?:music|item)\/detail/.test(r.url())) return;
    try { const m = musicFromTikTokData(await r.json(), videoId); if (m) found = m; } catch {}
  });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      .catch(() => { throw new SoundError('TikTok didn’t open — check the link and internet connection', { retryable: true }); });
    const deadline = Date.now() + 22_000;
    while (Date.now() < deadline) {
      if (found?.playUrl) return found;
      const data = await page.evaluate(() => {
        for (const id of ['__UNIVERSAL_DATA_FOR_REHYDRATION__', 'SIGI_STATE']) {
          try { const s = document.getElementById(id)?.textContent; if (s) return JSON.parse(s); } catch {}
        }
        return null;
      }).catch(() => null);
      const m = musicFromTikTokData(data, videoId);
      if (m?.playUrl) return m;
      if (m) found = m;
      // The music ID alone can be resolved through its own page.
      if (found && videoId) return found;
      await page.waitForTimeout(350);
    }
    if (found) return found;
    throw new SoundError('No accessible sound found. The post may be private, removed, or blocked by TikTok. Try the sound’s own link.', { retryable: true });
  } finally {
    await page.close().catch(() => {});
    scheduleClose();
  }
}

/** Returns sound metadata with a playable audio URL, or a visible error. */
export async function soundInfo(musicId) {
  const cached = soundCache.get(musicId);
  if (cached?.expires > Date.now()) return cached.info;
  soundCache.delete(musicId);
  const info = await pageMusic(`https://www.tiktok.com/music/sound-${musicId}`);
  if (!info.playUrl) throw new SoundError('TikTok doesn’t provide audio for this sound');
  rememberSound(info);
  return info;
}

export async function resolveTikTokLink(input) {
  let link;
  try { link = parseTikTokLink(input); } catch (e) { throw Object.assign(e, { code: 400 }); }
  if (link.musicId) return soundInfo(link.musicId);
  const info = await pageMusic(link.url, link.videoId);
  if (!info.playUrl) return soundInfo(info.musicId);
  rememberSound(info);
  return info;
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export async function download(url, dest, { minBytes = 1000, maxBytes = 64 << 20 } = {}) {
  const r = await fetch(url, { signal: AbortSignal.timeout(45_000), headers: { 'User-Agent': UA, Referer: 'https://www.tiktok.com/' } }).catch(() => null);
  if (!r || !r.ok) throw new SoundError(r ? `File unavailable (${r.status})` : 'Can’t reach TikTok', { retryable: !r || r.status >= 500 });
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of r.body) {
      size += chunk.length;
      if (size > maxBytes) throw new SoundError('TikTok file is too large');
      chunks.push(chunk);
    }
  } catch (e) {
    if (e instanceof SoundError) throw e;
    throw new SoundError('Download interrupted — try again', { retryable: true });
  }
  const buf = Buffer.concat(chunks);
  if (buf.length < minBytes) throw new SoundError('TikTok returned an empty file');
  fs.writeFileSync(dest, buf);
  return { type: r.headers.get('content-type') || '', size: buf.length };
}

export async function shutdown() {
  clearTimeout(idleTimer);
  const p = browserP; browserP = null;
  if (p) try { (await p).b.close(); } catch {}
}

// ---------- YouTube and SoundCloud (yt-dlp) ----------
export const MAX_MEDIA_SECONDS=2700;
const baseArgs=()=>['--ignore-config','--no-playlist','--no-progress','--no-warnings','--no-cache-dir',
  '--socket-timeout','20','--retries','1','--extractor-retries','1','--js-runtimes',`node:${process.execPath}`,
  '--use-extractors','youtube.*,soundcloud.*'];
export function runDownloader(args,{timeout=100_000,maxBytes=12<<20}={}){
  return new Promise((resolve,reject)=>{
    const exe=tool('yt-dlp'),script=/\.m?js$/.test(exe); // a .js stand-in (tests) runs with this Node
    const p=spawn(script?process.execPath:exe,[...(script?[exe]:[]),...baseArgs(),...args],{stdio:['ignore','pipe','pipe'],windowsHide:true});
    const out=[],err=[];let size=0,settled=false;
    const finish=(e,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(e)reject(e);else resolve(value);};
    const stop=(message)=>{p.kill('SIGTERM');const kill=setTimeout(()=>p.kill('SIGKILL'),2000);kill.unref();finish(new SoundError(message));};
    const timer=setTimeout(()=>stop('The source took too long to respond. Try again.'),timeout);
    p.stdout.on('data',b=>{size+=b.length;if(size>maxBytes)stop('The source returned too much data');else out.push(b);});
    p.stderr.on('data',b=>{if(err.reduce((n,s)=>n+s.length,0)<20000)err.push(b);});
    p.on('error',e=>finish(new SoundError(e.code==='ENOENT'?'YouTube and SoundCloud support needs yt-dlp. Run: npm run setup':'Couldn’t start the audio downloader')));
    p.on('close',code=>{
      if(code===0)return finish(null,Buffer.concat(out).toString('utf8'));
      const message=Buffer.concat(err).toString('utf8').replace(/\x1b\[[0-9;]*m/g,'').trim();
      // The downloader's usual refusals, in plain words.
      if(/confirm your age|age-restricted/i.test(message))return finish(new SoundError('YouTube shows this video only to signed-in adults'));
      if(/HTTP Error 403/i.test(message))return finish(new SoundError('YouTube refused the download for now. Try again in a few minutes.'));
      finish(new SoundError(message ? message.split('\n').filter(s=>/ERROR:/i.test(s)).pop()?.replace(/^ERROR:\s*/,'').slice(0,500) || 'The source is unavailable. Check the link and internet connection.' : 'The source is unavailable. Check the link and internet connection.'));
    });
  });
}
export function metadataFromDownloader(raw,link){
  if(!raw || raw._type==='playlist' || raw.entries)throw new SoundError('Choose an individual video or track');
  if(raw.is_live || ['is_live','is_upcoming'].includes(raw.live_status))throw new SoundError('Live and upcoming streams cannot be downloaded');
  if(!Number.isFinite(raw.duration) || raw.duration<=0)throw new SoundError('No audio duration was found');
  if(raw.duration>MAX_MEDIA_SECONDS)throw new SoundError('Maximum length is 45 minutes per track');
  if(raw.is_preview || /preview/i.test(raw.format_id || '') || (raw.requested_downloads || []).some(f=>/preview/i.test(f.format_id || '')))throw new SoundError('Only a preview is available. The full track cannot be downloaded.');
  if(raw.has_drm || ['premium_only','subscriber_only','needs_auth','private'].includes(raw.availability))throw new SoundError('This track requires access that the downloader does not have');
  const id=String(raw.id || '');
  if(link.provider==='youtube' && !/^[A-Za-z0-9_-]{11}$/.test(id))throw new SoundError('Invalid YouTube video metadata');
  if(link.provider==='soundcloud' && !/^\d{1,22}$/.test(id))throw new SoundError('Invalid SoundCloud track metadata');
  const musicId=(link.provider==='youtube'?'yt-':'sc-')+id;
  let coverUrl='';try{const u=new URL(raw.thumbnail);if(u.protocol==='https:')coverUrl=u.href;}catch{}
  const sourceUrl=link.provider==='youtube'?`https://www.youtube.com/watch?v=${id}`:parseMediaLink(raw.webpage_url || link.url).url;
  return {musicId,provider:link.provider,title:raw.track || raw.title || 'Untitled',author:raw.artist || raw.uploader || raw.channel || '',duration:raw.duration,coverUrl,sourceUrl};
}
const metadataCache = new Map();
export async function resolveMediaSite(link){
  const cached=metadataCache.get(link.url);if(cached?.expires>Date.now())return cached.info;
  if(link.provider==='youtube'&&fastYouTube()){
    try{const info=await fastYouTubeInfo(link);metadataCache.set(link.url,{info,expires:Date.now()+10*60_000});return info;}
    catch(e){if(e instanceof SoundError)throw e;}
  }
  const text=await runDownloader(['--skip-download','--dump-single-json','-f','bestaudio/best[height<=480]',link.url]);
  let raw;try{raw=JSON.parse(text);}catch{throw new SoundError('The source returned invalid track information');}
  const info=metadataFromDownloader(raw,link);
  const entry={info,expires:Date.now()+10*60_000};metadataCache.set(link.url,entry);metadataCache.set(info.sourceUrl,entry);
  while(metadataCache.size>200)metadataCache.delete(metadataCache.keys().next().value);
  return info;
}
export async function fetchMediaCover(url,dest){
  const u=new URL(url);if(u.protocol!=='https:')throw new SoundError('Invalid cover URL');
  const r=await fetch(u,{signal:AbortSignal.timeout(25_000),headers:{'User-Agent':'Mozilla/5.0'}});
  if(!r.ok)throw new SoundError('Cover unavailable');
  const parts=[];let size=0;for await(const b of r.body){size+=b.length;if(size>10<<20){throw new SoundError('Cover is too large');}parts.push(b);}
  fs.writeFileSync(dest,Buffer.concat(parts));
}

// ---------- Spotify: track information only, the audio comes from a chosen YouTube source ----------
export function spotifyMetadata(html,id){
  const m=html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  let entity;try{entity=JSON.parse(m?.[1] || '').props?.pageProps?.state?.data?.entity;}catch{}
  if(!entity?.title || entity.type!=='track')throw new SoundError('Spotify track information is unavailable. Try a direct YouTube or SoundCloud link.');
  const cover=[...(entity.visualIdentity?.image || [])].sort((a,b)=>(b.maxWidth || 0)-(a.maxWidth || 0))[0]?.url || '';
  return {provider:'spotify',mediaId:id,musicId:null,title:entity.title,author:(entity.artists || []).map(a=>a.name).filter(Boolean).join(', '),
    duration:Number(entity.duration || 0)/1000,coverUrl:cover.startsWith('https://')?cover:'',sourceUrl:`https://open.spotify.com/track/${id}`,metadataOnly:true};
}
async function spotifyFetch(url){
  const r=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(25_000),headers:{'User-Agent':'Mozilla/5.0','Accept-Language':'en-US,en;q=0.9'}})
    .catch(()=>{throw new SoundError('Couldn’t reach Spotify. Check the internet connection.');});
  return r;
}
export async function resolveSpotify(link){
  let parsed=link;
  for(let i=0;!parsed.mediaId && i<6;i++){
    const r=await spotifyFetch(parsed.url);const location=r.headers.get('location');
    if(!location)throw new SoundError('Couldn’t expand this Spotify link. Copy the full open.spotify.com/track/… link.');
    const next=new URL(location,parsed.url);if(!['open.spotify.com','spotify.link'].includes(next.hostname))throw new SoundError('Spotify redirected outside its supported track pages');
    parsed=parseMediaLink(next.href);
  }
  if(!parsed.mediaId)throw new SoundError('Paste the full Spotify track link');
  const r=await spotifyFetch(`https://open.spotify.com/embed/track/${parsed.mediaId}`);
  if(!r.ok)throw new SoundError('This Spotify track is unavailable');
  const parts=[];let size=0;for await(const b of r.body){size+=b.length;if(size>8<<20)throw new SoundError('Spotify returned too much data');parts.push(b);}
  return spotifyMetadata(Buffer.concat(parts).toString('utf8'),parsed.mediaId);
}
// ---------- YouTube, fast path ----------
// Searching and reading a video's details go straight to YouTube's own web API (well under a second);
// the downloader needs several seconds per call. Anything it cannot answer falls back to the downloader.
// Tests run a stand-in downloader (a .js file), which also switches this off; TOKIFY_YOUTUBE_API=0 does too.
const fastYouTube=()=>process.env.TOKIFY_YOUTUBE_API!=='0'&&!/\.m?js$/.test(tool('yt-dlp'));
async function youtubei(endpoint,body){
  const r=await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false`,{method:'POST',
    headers:{'Content-Type':'application/json','User-Agent':UA},signal:AbortSignal.timeout(8000),
    body:JSON.stringify({context:{client:{clientName:'WEB',clientVersion:'2.20250312.04.00',hl:'en',gl:'US'}},...body})});
  if(!r.ok)throw new Error(`YouTube answered ${r.status}`);
  return r.json();
}
function* findKey(o,key){
  if(!o||typeof o!=='object')return;
  if(Array.isArray(o)){for(const v of o)yield* findKey(v,key);return;}
  for(const [k,v] of Object.entries(o)){if(k===key)yield v;else yield* findKey(v,key);}
}
const seconds=(clock)=>String(clock||'').split(':').reduce((n,part)=>n*60+(Number(part)||0),0);
const YT_ID=/^[A-Za-z0-9_-]{11}$/;
// What a search already told us about a video, so choosing it needs no second lookup.
const seen=new Map();
const remember=(id,d)=>{seen.set(id,{...d,expires:Date.now()+30*60_000});while(seen.size>300)seen.delete(seen.keys().next().value);};
async function fastSearch(q,count){
  const data=await youtubei('search',{query:q,params:'EgIQAQ=='}); // videos only
  const out=[];
  for(const v of findKey(data,'videoRenderer')){
    const duration=seconds(v.lengthText?.simpleText);
    if(!YT_ID.test(v.videoId||'')||!duration||duration>MAX_MEDIA_SECONDS)continue;
    out.push({id:v.videoId,title:(v.title?.runs||[]).map(r=>r.text).join('')||'YouTube video',author:v.ownerText?.runs?.[0]?.text||v.longBylineText?.runs?.[0]?.text||'',duration});
    if(out.length>=count)break;
  }
  return out;
}
async function slowSearch(q,count){
  const text=await runDownloader(['--flat-playlist','--skip-download','--dump-single-json',`ytsearch${count}:${q}`],{timeout:100_000});
  let raw;try{raw=JSON.parse(text);}catch{throw new SoundError('YouTube search returned invalid information');}
  return (raw.entries || []).filter(e=>e&&YT_ID.test(String(e.id))&&!e.is_live&&e.duration>0&&e.duration<=MAX_MEDIA_SECONDS).slice(0,count)
    .map(e=>({id:e.id,title:e.title || 'YouTube video',author:e.uploader || e.channel || '',duration:e.duration}));
}
// Search YouTube by words (song, artist). Only playable, finite videos come back; the cover goes through
// /api/search/thumb so the page never talks to another site.
export async function youtubeSearch(query,count=8){
  const q=String(query||'').replace(/\s+/g,' ').trim().slice(0,200);
  if(q.length<2)throw new SoundError('Type a song or an artist');
  let found=[];
  if(fastYouTube())found=await fastSearch(q,count).catch(()=>[]);
  if(!found.length)found=await slowSearch(q,count);
  return found.map(({id,...d})=>{remember(id,d);return {...d,provider:'youtube',url:`https://www.youtube.com/watch?v=${id}`,cover:`/api/search/thumb/${id}`};});
}
// A pasted or chosen YouTube link: title, artist and length without starting the downloader.
async function fastYouTubeInfo(link){
  const id=link.mediaId||new URL(link.url).searchParams.get('v');
  if(!YT_ID.test(id||''))throw new Error('no id');
  let d=seen.get(id);
  if(!(d?.expires>Date.now())){
    const v=(await youtubei('player',{videoId:id})).videoDetails;
    if(!v||v.videoId!==id)throw new Error('no details');
    if(v.isUpcoming||(v.isLiveContent&&!Number(v.lengthSeconds)))throw new SoundError('Live and upcoming streams cannot be downloaded');
    d={title:v.title,author:v.author,duration:Number(v.lengthSeconds)};
  }
  if(!(d.duration>0))throw new Error('no length');
  if(d.duration>MAX_MEDIA_SECONDS)throw new SoundError('Maximum length is 45 minutes per track');
  return {musicId:'yt-'+id,provider:'youtube',title:d.title||'Untitled',author:d.author||'',duration:d.duration,
    coverUrl:`https://i.ytimg.com/vi/${id}/hqdefault.jpg`,sourceUrl:`https://www.youtube.com/watch?v=${id}`};
}

// ---------- 30-second previews ----------
// The downloader streams the audio and ffmpeg keeps 30 seconds from a quarter of the way in (at most 45 s, so
// little has to come down), then both stop. Made once and kept for replays: Safari asks for byte ranges, so the
// clip must be whole. Nothing is saved to the library. At most two are made at a time.
export const PREVIEW_SECONDS=30;
export const previewStart=(duration)=>duration>PREVIEW_SECONDS*2?Math.round(Math.min(duration*.25,45,duration-PREVIEW_SECONDS)):0;
const clips=new Map();
let making=0;const waiting=[];
const slot=()=>making<3?(making++,Promise.resolve()):new Promise((r)=>waiting.push(r));
const release=()=>{const next=waiting.shift();if(next)next();else making--;};
export function previewClip(pageUrl,duration=0){
  const hit=clips.get(pageUrl);
  if(hit)return hit;
  if(!duration){const id=/[?&]v=([A-Za-z0-9_-]{11})/.exec(pageUrl)?.[1];duration=(id&&seen.get(id)?.duration)||metadataCache.get(pageUrl)?.info.duration||0;}
  const value=slot().then(()=>new Promise((resolve,reject)=>{
    const exe=tool('yt-dlp');
    if(/\.m?js$/.test(exe))return reject(new SoundError('Previews need the real downloader'));
    const yd=spawn(exe,[...baseArgs(),'-f','bestaudio[ext=m4a]/bestaudio/best','-o','-',pageUrl],{stdio:['ignore','pipe','ignore'],windowsHide:true});
    const ff=spawn(tool('ffmpeg'),['-hide_banner','-loglevel','error','-ss',String(previewStart(duration)),'-t',String(PREVIEW_SECONDS),'-i','pipe:0',
      '-vn','-ac','2','-ar','44100','-c:a','libmp3lame','-b:a','128k','-af','afade=t=in:d=0.5,afade=t=out:st=28.8:d=1.2','-f','mp3','pipe:1'],{stdio:['pipe','pipe','ignore'],windowsHide:true});
    yd.stdout.pipe(ff.stdin);ff.stdin.on('error',()=>{});yd.on('error',()=>ff.kill('SIGKILL'));
    const out=[];let size=0;
    const timer=setTimeout(()=>{ff.kill('SIGKILL');yd.kill('SIGKILL');},60_000);
    ff.stdout.on('data',(b)=>{size+=b.length;if(size>4<<20)ff.kill('SIGKILL');else out.push(b);});
    ff.on('error',()=>{clearTimeout(timer);yd.kill('SIGKILL');reject(new SoundError('Couldn’t start ffmpeg'));});
    ff.on('close',(code)=>{clearTimeout(timer);yd.kill('SIGKILL');const b=Buffer.concat(out);code===0&&b.length>4000?resolve(b):reject(new SoundError('Couldn’t make a preview of this track'));});
  })).finally(release);
  value.catch(()=>clips.delete(pageUrl));
  clips.set(pageUrl,value);
  while(clips.size>24)clips.delete(clips.keys().next().value);
  return value;
}
export async function youtubeThumb(id,size='mq'){
  if(!/^[A-Za-z0-9_-]{11}$/.test(String(id)))return null;
  const r=await fetch(`https://i.ytimg.com/vi/${id}/${size==='hq'?'hqdefault':'mqdefault'}.jpg`,{signal:AbortSignal.timeout(10_000)}).catch(()=>null);
  if(!r?.ok)return null;
  const b=Buffer.from(await r.arrayBuffer());
  return b.length>200&&b.length<2<<20?b:null;
}
export async function spotifyYouTubeMatches(info){
  if(info.provider!=='spotify')throw new SoundError('Find a Spotify track first');
  return youtubeSearch(`${info.author} ${info.title}`,4);
}

// ---------- whole playlists ----------
// What is in a playlist, without downloading anything: its name, owner, cover and songs. YouTube playlists and
// SoundCloud sets are listed by the downloader (flat, one call for the whole list). Spotify's public embed page
// lists up to 100 songs; the playlist page itself says how many there are in all.
export const MAX_PLAYLIST_SONGS = 1000;
const bestImage = (list) => [...(list || [])].filter((i) => /^https:\/\//.test(i?.url || '')).sort((a, b) => (b.width || b.maxWidth || 0) - (a.width || a.maxWidth || 0))[0]?.url || '';
const slugTitle = (url) => { try { if (/\/tracks\/\d+$/.test(url)) return ''; const s = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean)[1] || ''); return s.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim(); } catch { return ''; } };
// YouTube's auto-made artist channels are called "Name - Topic".
export const channelArtist = (s) => String(s || '').replace(/\s+-\s+Topic$/i, '').trim();

export function playlistFromDownloader(raw, pl) {
  if (!raw || !Array.isArray(raw.entries)) throw new SoundError('This playlist is empty or private');
  const songs = [];let unavailable = 0;const seenIds = new Set();
  for (const e of raw.entries) {
    if (!e) { unavailable++; continue; }
    let song;
    if (pl.provider === 'youtube') {
      // Private and deleted videos come back without a title.
      if (!YT_ID.test(String(e.id)) || !e.title || /^\[(private|deleted) video\]$/i.test(e.title)) { unavailable++; continue; }
      if (e.duration > MAX_MEDIA_SECONDS || e.live_status === 'is_live' || e.live_status === 'is_upcoming') { unavailable++; continue; }
      song = { id: 'yt-' + e.id, title: e.title, author: channelArtist(e.channel || e.uploader), duration: Number(e.duration) || 0, url: `https://www.youtube.com/watch?v=${e.id}` };
    } else {
      let url;try { url = parseMediaLink(e.url || e.webpage_url || '').url; } catch { unavailable++; continue; }
      if (!/^\d{1,22}$/.test(String(e.id))) { unavailable++; continue; }
      // Songs listed by number only get their name when they are downloaded.
      song = { id: 'sc-' + e.id, title: e.title || slugTitle(url) || '', author: e.uploader || '', duration: Number(e.duration) || 0, url };
    }
    if (seenIds.has(song.id)) continue;
    seenIds.add(song.id);songs.push(song);
  }
  return { provider: pl.provider, kind: 'playlist', url: pl.url, name: String(raw.title || 'Playlist').slice(0, 200), owner: channelArtist(raw.uploader || raw.channel || ''),
    cover: bestImage(raw.thumbnails), songs: songs.slice(0, MAX_PLAYLIST_SONGS), total: songs.length + unavailable, unavailable };
}

export function spotifyListFromEmbed(html, pl) {
  const m = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  let e;try { e = JSON.parse(m?.[1] || '').props?.pageProps?.state?.data?.entity; } catch {}
  if (!e || !['playlist', 'album'].includes(e.type) || !Array.isArray(e.trackList)) throw new SoundError('Spotify didn’t show this playlist. Check that it is public.');
  const cover = bestImage(e.coverArt?.sources) || bestImage(e.visualIdentity?.image);
  const songs = [];let unavailable = 0;
  for (const t of e.trackList) {
    const id = /^spotify:track:([A-Za-z0-9]{22})$/.exec(t?.uri || '')?.[1];
    // "Not available in your country" on Spotify is no reason to skip a song: its recording comes from YouTube.
    if (!id || !t.title || t.entityType === 'episode') { unavailable++; continue; }
    songs.push({ id: 'sp-' + id, spotifyId: id, title: t.title, author: t.subtitle || '', duration: Number(t.duration || 0) / 1000,
      url: `https://open.spotify.com/track/${id}`, cover: e.type === 'album' ? cover : '' });
  }
  return { provider: 'spotify', kind: e.type, url: pl.url, name: String(e.name || e.title || 'Spotify playlist').slice(0, 200),
    owner: e.subtitle || (e.authors || []).map((a) => a.name).join(', '), cover, songs, total: songs.length + unavailable, unavailable };
}

async function readPage(r, limit = 8 << 20) {
  const parts = [];let size = 0;
  for await (const b of r.body) { size += b.length; if (size > limit) throw new SoundError('Spotify returned too much data'); parts.push(b); }
  return Buffer.concat(parts).toString('utf8');
}
export async function fetchPlaylist(pl) {
  if (pl.provider === 'spotify') {
    const r = await spotifyFetch(`https://open.spotify.com/embed/${pl.kind}/${pl.id}`);
    if (!r.ok) throw new SoundError(r.status === 404 ? 'This Spotify playlist doesn’t exist or is private' : 'Spotify is unavailable right now. Try again.');
    const list = spotifyListFromEmbed(await readPage(r), pl);
    // The embed shows the first 100 songs; the page says how many there really are.
    if (list.total >= 100) {
      try {
        const page = await readPage(await spotifyFetch(pl.url), 4 << 20);
        const n = Number(/<meta name="music:song_count" content="(\d+)"/.exec(page)?.[1] || /·\s*([\d,]+)\s+(?:items|songs)/.exec(page)?.[1]?.replace(/,/g, ''));
        if (n > list.total) list.total = n;
      } catch {}
    }
    return list;
  }
  const text = await runDownloader(['--flat-playlist', '--skip-download', '--dump-single-json', '--playlist-end', String(MAX_PLAYLIST_SONGS + 50), pl.url], { timeout: 180_000, maxBytes: 64 << 20 });
  let raw;try { raw = JSON.parse(text); } catch { throw new SoundError('The playlist came back unreadable. Try again.'); }
  return playlistFromDownloader(raw, pl);
}

/** Follows a share link (on.soundcloud.com, spotify.link) to the page it stands for, staying on those sites. */
export async function expandLink(url) {
  const allowed = /^(on\.soundcloud\.com|soundcloud\.app\.goo\.gl|soundcloud\.com|m\.soundcloud\.com|www\.soundcloud\.com|spotify\.link|spotify\.app\.link|open\.spotify\.com)$/;
  let at = new URL(url);
  for (let i = 0; i < 6; i++) {
    if (!/^(on\.soundcloud\.com|soundcloud\.app\.goo\.gl|spotify\.link|spotify\.app\.link)$/.test(at.hostname)) return at.href;
    const r = await fetch(at, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'Mozilla/5.0' } })
      .catch(() => { throw new SoundError('Couldn’t open this share link. Check the internet connection.'); });
    let next = r.headers.get('location');
    // Spotify's share links answer with a page that sends you on.
    if (!next && r.ok) next = /https:\/\/open\.spotify\.com\/[^"'\s<>]+/.exec(await readPage(r, 2 << 20))?.[0];
    if (!next) throw new SoundError('Couldn’t open this share link. Copy the full link instead.');
    at = new URL(next.replace(/&amp;/g, '&'), at);
    if (!allowed.test(at.hostname)) throw new SoundError('This share link leads outside SoundCloud and Spotify');
  }
  return at.href;
}

// ---------- a Spotify song's recording on YouTube ----------
// Spotify gives the song, not the audio. The recording is the YouTube video that is clearly the same song: its
// title has the song's name, the length agrees (a few seconds' slack for a different upload), and it is not a
// live, sped-up, cover or karaoke version unless the song itself is. YouTube's own "Artist - Topic" uploads are
// the album recordings, so they win; their timing also matches synced lyrics best.
const fold = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const bareTitle = (s) => fold(String(s || '').replace(/\s+-\s+(remaster(ed)?|mono|stereo|single|radio|edit|version|from|bonus).*$/i, '').replace(/[([].*?[)\]]/g, ' '));
const VERSIONS = ['live', 'cover', 'remix', 'sped up', 'speed up', 'slowed', 'nightcore', 'karaoke', 'instrumental', '8d', 'reverb', 'bass boosted', 'acoustic', 'piano', '1 hour', 'loop', 'reaction', 'tutorial', 'lesson', 'mashup'];
const has = (text, word) => ` ${text} `.includes(` ${word} `);
export function recordingScore(c, want) {
  const ct = fold(c.title), ca = fold(c.author), T = bareTitle(want.title) || fold(want.title), full = fold(want.title);
  const A = fold(String(want.author || '').split(/\s*,\s*|\s+&\s+|\s+(?:feat|ft)\.?\s+/i)[0]);
  if (!T || !(ct.includes(T) || T.split(' ').every((w) => has(ct, w)))) return -Infinity;
  const d = want.duration ? Math.abs((c.duration || 0) - want.duration) : 0;
  if (want.duration && d > Math.max(10, want.duration * 0.07)) return -Infinity;
  let s = 20 - d * 0.8;
  if (/\s-\sTopic$/i.test(c.author || '')) s += 8;
  if (A && (has(ca, A) || ca.includes(A) || ct.includes(A))) s += 5;
  else if (A) s -= 4;
  for (const v of VERSIONS) if (has(ct, v) && !has(full, v)) s -= 12;
  if (/official (music )?video|\bmv\b/.test(ct)) s -= 2; // videos often open with a scene before the song
  return s;
}
// SoundCloud by words, for songs YouTube does not show.
export async function soundcloudSearch(q, count = 6) {
  const text = await runDownloader(['--flat-playlist', '--skip-download', '--dump-single-json', `scsearch${count}:${String(q).slice(0, 200)}`], { timeout: 60_000 });
  let raw;try { raw = JSON.parse(text); } catch { return []; }
  return (raw.entries || []).filter((e) => e && /^\d{1,22}$/.test(String(e.id)) && e.duration > 0 && e.duration <= MAX_MEDIA_SECONDS)
    .map((e) => ({ provider: 'soundcloud', title: e.title || '', author: e.uploader || '', duration: e.duration, url: `https://api.soundcloud.com/tracks/${e.id}` }));
}
/** Likely recordings of a song on SoundCloud, best first. */
export async function soundcloudRecordings(want) {
  const artist = String(want.author || '').split(/\s*,\s*/)[0];
  const found = await soundcloudSearch(`${artist} ${want.title}`).catch((e) => { if (e instanceof SoundError) return []; throw e; });
  return found.map((c) => ({ c, s: recordingScore(c, want) })).filter((x) => x.s > -Infinity).sort((a, b) => b.s - a.s).map((x) => x.c);
}
/** Likely recordings of a song, best first: YouTube, and SoundCloud when YouTube has none. */
export async function findRecordings(want) {
  const artist = String(want.author || '').split(/\s*,\s*/)[0];
  const rank = (found) => found.map((c) => ({ c, s: recordingScore(c, want) })).filter((x) => x.s > -Infinity).sort((a, b) => b.s - a.s).map((x) => x.c);
  const quiet = (e) => { if (e instanceof SoundError) return []; throw e; };
  for (const q of [`${artist} ${want.title}`, `${artist} - ${want.title} audio`]) {
    const best = rank(await youtubeSearch(q, 8).catch(quiet));
    if (best.length) return best;
  }
  return soundcloudRecordings(want);
}
export const findRecording = async (want) => (await findRecordings(want))[0] || null;
/** A Spotify song's cover, from its own embed page. */
export async function spotifyCover(spotifyId) {
  try { return (await resolveSpotify({ provider: 'spotify', mediaId: spotifyId, url: `https://open.spotify.com/track/${spotifyId}` })).coverUrl || ''; }
  catch { return ''; }
}

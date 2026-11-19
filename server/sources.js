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
export async function spotifyYouTubeMatches(info){
  if(info.provider!=='spotify')throw new SoundError('Find a Spotify track first');
  const query=`${info.author} ${info.title}`.trim().slice(0,400);
  const text=await runDownloader(['--flat-playlist','--skip-download','--dump-single-json',`ytsearch4:${query}`],{timeout:100_000});
  let raw;try{raw=JSON.parse(text);}catch{throw new SoundError('YouTube search returned invalid information');}
  return (raw.entries || []).filter(e=>e&&/^[A-Za-z0-9_-]{11}$/.test(String(e.id))&&!e.is_live&&e.duration>0&&e.duration<=MAX_MEDIA_SECONDS).slice(0,4).map(e=>({
    title:e.title || 'YouTube video',author:e.uploader || e.channel || '',duration:e.duration,provider:'youtube',url:`https://www.youtube.com/watch?v=${e.id}`,
  }));
}

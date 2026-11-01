import { parseMediaLink } from '../shared/media-link.js';
import { runDownloader, MAX_MEDIA_SECONDS } from './media-sites.js';
import { SoundError } from './tiktok.js';

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

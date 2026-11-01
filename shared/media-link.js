import { parseTikTokLink } from './tiktok-link.js';
export const TRACK_ID_RE = /^(?:\d{1,22}|file-[a-f0-9]{64}|yt-[A-Za-z0-9_-]{11}|sc-\d{1,22})$/;
export const providerName = (p) => ({tiktok:'TikTok',youtube:'YouTube',soundcloud:'SoundCloud',spotify:'Spotify',external:'File'}[p] || 'Audio');

/** Only individual media links from explicitly supported hosts reach the server. */
export function parseMediaLink(input) {
  if (typeof input !== 'string' || input.length > 5000) throw new Error('Paste a TikTok, YouTube, SoundCloud or Spotify track link');
  const match=input.trim().match(/https?:\/\/[^\s<>"“”]+/i);
  let u;try{u=new URL((match?.[0] || input.trim()).replace(/[),.!;]+$/,''));}catch{throw new Error('Paste a TikTok, YouTube, SoundCloud or Spotify track link');}
  if (!['https:','http:'].includes(u.protocol) || u.username || u.password || u.port) throw new Error('Use a link from TikTok, YouTube, SoundCloud or Spotify');
  u.protocol='https:';u.hash='';const host=u.hostname.toLowerCase();
  if(['tiktok.com','www.tiktok.com','m.tiktok.com','vm.tiktok.com','vt.tiktok.com'].includes(host))return {...parseTikTokLink(u.href),provider:'tiktok'};
  if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be','www.youtu.be'].includes(host)){
    let id=host.endsWith('youtu.be')?u.pathname.split('/')[1]:u.pathname==='/watch'?u.searchParams.get('v'):/^\/(?:shorts|live|embed)\/([^/]+)\/?$/.exec(u.pathname)?.[1];
    if(!/^[A-Za-z0-9_-]{11}$/.test(id || ''))throw new Error('Paste an individual YouTube video link, not a channel or playlist');
    return {provider:'youtube',mediaId:id,musicId:'yt-'+id,url:`https://www.youtube.com/watch?v=${id}`};
  }
  if(['soundcloud.com','www.soundcloud.com','m.soundcloud.com','on.soundcloud.com','soundcloud.app.goo.gl'].includes(host)){
    if(['on.soundcloud.com','soundcloud.app.goo.gl'].includes(host)){
      if(!/^\/[A-Za-z0-9_-]+\/?$/.test(u.pathname))throw new Error('Paste an individual SoundCloud track link');
      u.search='';return {provider:'soundcloud',url:u.href,musicId:null};
    }
    const parts=u.pathname.split('/').filter(Boolean);
    if(parts.length<2 || parts.length>3 || ['sets','likes','tracks','albums','reposts','popular-tracks','following','followers'].includes(parts[1]) || (parts.length===3&&!/^s-[A-Za-z0-9]+$/.test(parts[2])))throw new Error('Paste an individual SoundCloud track link, not a profile or playlist');
    const secret=u.searchParams.get('secret_token');u.search='';if(secret&&/^s-[A-Za-z0-9]+$/.test(secret))u.searchParams.set('secret_token',secret);
    return {provider:'soundcloud',url:u.href,musicId:null};
  }
  if(host==='open.spotify.com'){
    const id=/^\/(?:intl-[a-z-]+\/)?(?:embed\/)?track\/([A-Za-z0-9]{22})\/?$/.exec(u.pathname)?.[1];
    if(!id)throw new Error('Paste an individual Spotify track link, not an album or playlist');
    return {provider:'spotify',mediaId:id,musicId:null,url:`https://open.spotify.com/track/${id}`};
  }
  if(host==='spotify.link'){
    if(!/^\/[A-Za-z0-9]+\/?$/.test(u.pathname))throw new Error('Paste a Spotify track link');
    u.search='';return {provider:'spotify',url:u.href,musicId:null};
  }
  throw new Error('Use a link from tiktok.com, youtube.com, soundcloud.com or open.spotify.com');
}

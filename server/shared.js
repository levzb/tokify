// Code shared by the server and the browser app (Vite bundles this file too), so no Node APIs here.
// Sections: playback timeline · TikTok export · media links · file policy.

// ---------- playback timeline ----------

export const SR = 48000;
export const FRAME = 1152; // samples per MP3 frame
export const FRAME_BYTES = 480; // 160 kbps CBR at 48 kHz: 144 * 160000 / 48000, never padded
export const STREAM_DELAY = 1105; // encoder (576) + decoder (529) delay, in samples
export const TAIL = Math.round(SR * 0.6); // silence appended to every stream

export const TRANSITIONS = ['none', 'fade', 'crossfade'];

const s = (sec) => Math.round(sec * SR);
const DECLICK = s(0.008);

/**
 * items: [{ id, samples, offset? }] in play order. `samples` is the track's effective length
 * (silence trimmed). `offset` (first item only) starts that track part-way through.
 * Returns entries with absolute stream positions plus envelope info for the renderer.
 */
/** How long two songs overlap in a crossfade, in seconds: a setting, the same on both sides of the stream. */
export const XFADE = { min: 0.5, max: 12, def: 1.5 };
export const xfadeSec = (v) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.min(XFADE.max, Math.max(XFADE.min, +v)) : XFADE.def);

export function buildTimeline(items, mode = 'none', xfade = XFADE.def) {
  const over = xfadeSec(xfade);
  const entries = [];
  let cursor = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const offset = Math.max(0, Math.min(it.offset || 0, it.samples - s(1)));
    const len = it.samples - offset;
    if (len <= 0) continue;
    const prev = entries[entries.length - 1];
    let start = cursor;
    let fadeIn = offset > 0 ? s(0.12) : DECLICK;
    if (prev) {
      if (mode === 'crossfade') {
        const x = Math.min(s(over), Math.floor(prev.len / 3), Math.floor(len / 3));
        start = prev.start + prev.len - x;
        prev.fadeOut = x;
        fadeIn = x;
      } else if (mode === 'fade') {
        prev.fadeOut = Math.min(s(3), Math.floor(prev.len / 4));
        start = prev.start + prev.len + s(0.35);
        fadeIn = Math.min(s(1.2), Math.floor(len / 6));
      }
    }
    const e = { id: it.id, ref: it.ref, start, len, srcOffset: offset, fadeIn, fadeOut: DECLICK };
    if (mode === 'fade') e.fadeOut = Math.min(s(3), Math.floor(len / 4));
    entries.push(e);
    cursor = start + len;
  }
  const last = entries[entries.length - 1];
  const audioEnd = last ? last.start + last.len : 0;
  const total = audioEnd + TAIL;
  const frames = Math.ceil((total + STREAM_DELAY) / FRAME) + 2;
  return { entries, total, audioEnd, frames, bytes: frames * FRAME_BYTES, mode, xfade: over };
}

/** Plan position (samples) for a media-element currentTime (seconds). */
export const planPos = (currentTime) => Math.round(currentTime * SR) - STREAM_DELAY;
/** media-element currentTime (seconds) for a plan position (samples). */
export const streamTime = (pos) => (pos + STREAM_DELAY) / SR;

/** Index of the entry that is "current" at plan position `pos`. A track becomes current when it starts. */
export function entryAt(entries, pos) {
  let lo = 0, hi = entries.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].start <= pos) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** Linear gain 0..1 of an entry at local sample `k` (0 = entry start). Equal-power curves. */
export function envelope(e, k) {
  let g = 1;
  if (k < e.fadeIn) g *= Math.sin((k / e.fadeIn) * Math.PI / 2);
  const tail = e.len - k;
  if (tail < e.fadeOut) g *= Math.sin((Math.max(0, tail) / e.fadeOut) * Math.PI / 2);
  return g;
}

// ---------- TikTok "Download your data" export ----------
// Finds Favorite Sounds in a TikTok "Download your data" JSON export.
// TikTok renames sections between versions ("Activity" / "Your Activity", "Favorite Sounds" /
// "FavoriteSoundList"), so this walks the whole tree instead of trusting one path.

const MUSIC_RE = /^https?:\/\/(?:[a-z0-9-]+\.)?tiktok\.com\/(?:music\/[^?#\s"]*?-?|(?:h5\/)?share\/music\/)(\d{1,22})(?:\.html)?(?:[/?#]|$)/i;

export function musicIdFrom(link) {
  const m = MUSIC_RE.exec(String(link || ''));
  return m ? m[1] : null;
}

/** Title guess from the link slug: /music/Song-Name-123 -> "Song Name". */
export function titleFromLink(link) {
  try {
    const u = new URL(link);
    const seg = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    const t = seg.replace(/-?\d{1,22}(\.html)?$/, '').replace(/-/g, ' ').trim();
    return t || 'TikTok sound';
  } catch { return 'TikTok sound'; }
}

const isFavSoundKey = (k) => /favou?rite\s*sounds?|favou?ritesoundlist/i.test(k.replace(/[_\s]/g, ''));

export function findFavoriteSounds(root) {
  const out = [];
  const seen = new Set();
  const take = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    const link = entry.Link || entry.link || entry.URL || entry.url || '';
    const id = musicIdFrom(link);
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ musicId: id, link, title: entry.Title || entry.title || titleFromLink(link), date: entry.Date || entry.date || '' });
  };
  const walk = (node, inFav) => {
    if (Array.isArray(node)) { for (const x of node) inFav ? take(x) : walk(x, false); return; }
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      const fav = inFav || isFavSoundKey(k);
      if (fav && Array.isArray(v)) v.forEach(take);
      else walk(v, fav);
    }
  };
  walk(root, false);
  return out;
}

// ---------- media links ----------

const HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com']);

/** Accept a link or TikTok's copied share text, and strip tracking parameters. */
export function parseTikTokLink(input) {
  if (typeof input !== 'string' || input.length > 5000) throw new Error('Paste a TikTok video or sound link');
  const match = input.trim().match(/https?:\/\/[^\s<>"“”]+/i);
  let u;
  try { u = new URL((match?.[0] || input.trim()).replace(/[),.!;]+$/, '')); } catch { throw new Error('Paste a TikTok video or sound link'); }
  if (!['http:', 'https:'].includes(u.protocol) || !HOSTS.has(u.hostname.toLowerCase()) || u.username || u.password || u.port)
    throw new Error('Use a link from tiktok.com');
  u.protocol = 'https:';
  const musicId = musicIdFrom(u.href);
  const videoId = /\/(?:@[^/]+\/video|share\/video|v)\/(\d{1,22})(?:\.html)?\/?$/i.exec(u.pathname)?.[1] || null;
  const short = /^(vm|vt)\.tiktok\.com$/.test(u.hostname) && /^\/[A-Za-z0-9_-]+\/?$/.test(u.pathname);
  const share = /^\/t\/[A-Za-z0-9_-]+\/?$/.test(u.pathname);
  if (!musicId && !videoId && !short && !share) throw new Error('This is a profile or another TikTok page. Paste a video or sound link');
  u.search = ''; u.hash = '';
  return { url: u.href, musicId, videoId };
}

/** TikTok's API and both supported page hydration formats. */
export function musicFromTikTokData(data, videoId = null) {
  const scope = data?.__DEFAULT_SCOPE__;
  const item = data?.itemInfo?.itemStruct || scope?.['webapp.video-detail']?.itemInfo?.itemStruct;
  const fallback = data?.ItemModule && (videoId ? data.ItemModule[videoId] : Object.values(data.ItemModule)[0]);
  const info = data?.musicInfo || scope?.['webapp.music-detail']?.musicInfo;
  const m = info?.music || item?.music || fallback?.music;
  if (!m || !/^\d{1,22}$/.test(String(m.id || ''))) return null;
  const url = (value) => {
    const s = typeof value === 'string' ? value : value?.urlList?.[0] || value?.UrlList?.[0] || '';
    try { const u = new URL(s); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; }
  };
  return {
    musicId: String(m.id), title: m.title || 'TikTok sound',
    author: m.authorName || info?.author?.nickname || '', duration: Number(m.duration) || 0,
    playUrl: url(m.playUrl || m.play_url),
    coverUrl: url(m.coverLarge || m.coverMedium || m.coverThumb || m.coverUrl),
  };
}

export const TRACK_ID_RE = /^(?:\d{1,22}|file-[a-f0-9]{64}|yt-[A-Za-z0-9_-]{11}|sc-\d{1,22}|sp-[A-Za-z0-9]{22})$/;
export const providerName = (p) => ({tiktok:'TikTok',youtube:'YouTube',soundcloud:'SoundCloud',spotify:'Spotify',external:'File'}[p] || 'Audio');

/**
 * A whole playlist: a YouTube or YouTube Music playlist, a SoundCloud set (or album), a Spotify playlist or album.
 * Returns null for anything else (a single song is parseMediaLink's job). A video opened from inside a playlist
 * (watch?v=…&list=…) stays that one video.
 */
export function parsePlaylistLink(input) {
  if (typeof input !== 'string' || input.length > 5000) return null;
  const match = input.trim().match(/https?:\/\/[^\s<>"“”]+/i);
  let u; try { u = new URL((match?.[0] || input.trim()).replace(/[),.!;]+$/, '')); } catch { return null; }
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host) && u.pathname.replace(/\/$/, '') === '/playlist') {
    const id = u.searchParams.get('list') || '';
    if (!/^[A-Za-z0-9_-]{10,80}$/.test(id)) return null;
    // Mixes go on for ever; Liked and Watch later belong to a signed-in account.
    if (/^(RD|UL|LL|WL)/.test(id)) throw new Error('This is a YouTube mix or a personal list. Paste a regular playlist link.');
    return { provider: 'youtube', kind: 'playlist', id, url: `https://www.youtube.com/playlist?list=${id}` };
  }
  if (['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com'].includes(host)) {
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 3 || parts.length > 4 || parts[1] !== 'sets' || !/^[A-Za-z0-9_-]+$/.test(parts[0] + parts[2])) return null;
    if (parts[3] && !/^s-[A-Za-z0-9]+$/.test(parts[3])) return null;
    return { provider: 'soundcloud', kind: 'playlist', id: parts.slice(0, 4).join('/'), url: `https://soundcloud.com/${parts.slice(0, 4).join('/')}` };
  }
  if (host === 'open.spotify.com') {
    const m = /^\/(?:intl-[a-z-]+\/)?(?:embed\/)?(playlist|album)\/([A-Za-z0-9]{22})\/?$/.exec(u.pathname);
    if (!m) return null;
    return { provider: 'spotify', kind: m[1], id: m[2], url: `https://open.spotify.com/${m[1]}/${m[2]}` };
  }
  return null;
}
/** Share links that only say where to go (the app's "Copy link"); the server follows them to see what they are. */
export const isShortLink = (input) => /^https?:\/\/(on\.soundcloud\.com|soundcloud\.app\.goo\.gl|spotify\.link)\//i.test(String(input || '').trim().match(/https?:\/\/\S+/i)?.[0] || '');

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
    if(!/^[A-Za-z0-9_-]{11}$/.test(id || ''))throw new Error('Paste a YouTube video or playlist link, not a channel');
    return {provider:'youtube',mediaId:id,musicId:'yt-'+id,url:`https://www.youtube.com/watch?v=${id}`};
  }
  // Long sets list some songs only by number; the downloader finds those by it.
  if(['api.soundcloud.com','api-v2.soundcloud.com'].includes(host)){
    const id=/^\/tracks\/(\d{1,22})\/?$/.exec(u.pathname)?.[1];
    if(!id)throw new Error('Paste an individual SoundCloud track link');
    return {provider:'soundcloud',url:`https://api.soundcloud.com/tracks/${id}`,musicId:'sc-'+id};
  }
  if(['soundcloud.com','www.soundcloud.com','m.soundcloud.com','on.soundcloud.com','soundcloud.app.goo.gl'].includes(host)){
    if(['on.soundcloud.com','soundcloud.app.goo.gl'].includes(host)){
      if(!/^\/[A-Za-z0-9_-]+\/?$/.test(u.pathname))throw new Error('Paste an individual SoundCloud track link');
      u.search='';return {provider:'soundcloud',url:u.href,musicId:null};
    }
    const parts=u.pathname.split('/').filter(Boolean);
    if(parts.length<2 || parts.length>3 || ['sets','likes','tracks','albums','reposts','popular-tracks','following','followers'].includes(parts[1]) || (parts.length===3&&!/^s-[A-Za-z0-9]+$/.test(parts[2])))throw new Error('Paste a SoundCloud track or playlist link, not a profile');
    const secret=u.searchParams.get('secret_token');u.search='';if(secret&&/^s-[A-Za-z0-9]+$/.test(secret))u.searchParams.set('secret_token',secret);
    return {provider:'soundcloud',url:u.href,musicId:null};
  }
  if(host==='open.spotify.com'){
    const id=/^\/(?:intl-[a-z-]+\/)?(?:embed\/)?track\/([A-Za-z0-9]{22})\/?$/.exec(u.pathname)?.[1];
    if(!id)throw new Error('Paste a Spotify track, playlist or album link');
    return {provider:'spotify',mediaId:id,musicId:null,url:`https://open.spotify.com/track/${id}`};
  }
  if(host==='spotify.link'){
    if(!/^\/[A-Za-z0-9]+\/?$/.test(u.pathname))throw new Error('Paste a Spotify track link');
    u.search='';return {provider:'spotify',url:u.href,musicId:null};
  }
  throw new Error('Use a link from tiktok.com, youtube.com, soundcloud.com or open.spotify.com');
}

// ---------- file policy (also checked with ffprobe on the server) ----------
export const MEDIA_EXTENSIONS = ['mp3','mp2','mp1','m4a','m4b','aac','wav','wave','flac','ogg','oga','opus','aiff','aif','aifc','wma','amr','caf','alac','ape','ac3','eac3','dts','au','snd',
  'mp4','mov','m4v','webm','mkv','mka','avi','mpg','mpeg','3gp','3g2','wmv','flv','ts','mts','m2ts','vob','ogv','mxf'];
const extensions = new Set(MEDIA_EXTENSIONS);
export const MEDIA_ACCEPT = '.zip,.json,' + MEDIA_EXTENSIONS.map((ext) => '.' + ext).join(',');
export function mediaFileError(filename, type = '') {
  const ext = String(filename).split('.').pop().toLowerCase();
  if (type.startsWith('image/') || !extensions.has(ext)) return 'Only audio and video files are supported. Photos and documents cannot be imported.';
  return null;
}

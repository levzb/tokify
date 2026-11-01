import { musicIdFrom } from './export.js';

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

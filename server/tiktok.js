// Fetches a TikTok sound's metadata, audio and cover.
// Sound pages only expose data to a real browser, so this opens them in headless Chromium
// on the owner's Mac (authorized by the owner for their own favorites).
import fs from 'node:fs';
import { parseTikTokLink, musicFromTikTokData } from '../shared/tiktok-link.js';

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

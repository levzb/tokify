// Fetches a TikTok sound's metadata, audio and cover.
// Sound pages only expose data to a real browser, so this opens them in headless Chromium
// on the owner's Mac (authorized by the owner for their own favorites).
import fs from 'node:fs';

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
        const t = route.request().resourceType();
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

/** Returns { title, author, duration, playUrl, coverUrl } or throws SoundError. */
export async function soundInfo(musicId) {
  const { ctx } = await browser();
  const page = await ctx.newPage();
  try {
    const detail = page.waitForResponse((r) => r.url().includes('/api/music/detail'), { timeout: 25_000 })
      .then((r) => r.json()).catch(() => null);
    await page.goto(`https://www.tiktok.com/music/sound-${musicId}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      .catch(() => { throw new SoundError('TikTok didn’t open — check the internet connection', { retryable: true }); });
    const j = await detail;
    if (!j) throw new SoundError('TikTok didn’t respond in time', { retryable: true });
    const m = j.musicInfo?.music;
    if (!m || !m.id || (j.statusCode && j.statusCode !== 0)) throw new SoundError('Sound was removed or is unavailable');
    if (!m.playUrl) throw new SoundError('TikTok doesn’t provide audio for this sound');
    return {
      title: m.title || 'Untitled',
      author: m.authorName || j.musicInfo?.author?.nickname || '',
      duration: m.duration || 0,
      playUrl: m.playUrl,
      coverUrl: m.coverLarge || m.coverMedium || m.coverThumb || '',
    };
  } finally {
    await page.close().catch(() => {});
    scheduleClose();
  }
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

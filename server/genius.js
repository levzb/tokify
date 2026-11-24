// Genius's API finds songs; their web pages contain the actual lyrics. Keep these two requests separate:
// a developer token improves search, but cannot authenticate a request for the lyrics page.
import { parse, TextNode } from 'node-html-parser';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
export function createGeniusPageFetcher(python, script = fileURLToPath(new URL('./genius.py', import.meta.url))) {
  return async (url) => {
    const { stdout } = await execute(python, [script, url], { timeout: 20_000, maxBuffer: 8 << 20, windowsHide: true, encoding: 'utf8' });
    const result = JSON.parse(stdout);
    if (result.error) throw new Error(result.error);
    return new Response(result.body, { status: result.status });
  };
}

const UA = 'Tokify (self-hosted music player)';
const fold = (s) => String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const decoration = /\s*[([](?:official(?:\s+music)?(?:\s+video|\s+audio)?|lyrics?|audio|video|music video|visuali[sz]er|hq|hd|4k|remaster(?:ed)?[^)\]]*|slowed[^)\]]*|sped[ -]?up[^)\]]*)[)\]]/gi;
const version = /\b(remix|live|cover|instrumental|translation|romaniz\w*)\b/i;
const titleKey = (s) => fold(String(s || '').replace(decoration, '').replace(/\s+(?:feat\.?|ft\.?|featuring)\s.+$/i, ''));
const artistKey = (s) => fold(String(s || '').replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/\s*-\s*Topic$/i, ''));

export function cleanSongQuery(title, author = '') {
  // YouTube titles commonly contain the actual artist; their uploader need not be that artist.
  const m = String(title || '').match(/^(.+?)\s+[-–—]\s+(.+)$/);
  const suffix = m && /^(?:(?:super|ultra|very|slightly|extremely|extra)\s+)?(?:slowed|sped[ -]?up|reverb|remaster|official|lyrics?)(?:\b|$)/i.test(m[2]);
  const rendition = m && /^(?:instrumental|acoustic|live|remix)(?:\b|$)/i.test(m[2]);
  return {
    title: (m && !rendition ? (suffix ? m[1] : m[2]) : String(title || '')).replace(decoration, '').trim(),
    artist: String(m && !suffix && !rendition ? m[1] : author || '').replace(/\s*-\s*Topic$/i, '').trim(),
  };
}

export function selectGeniusSong(hits, title, artist = '') {
  const T = titleKey(title), A = artistKey(artist);
  if (!T) return null;
  const matches = hits.filter((s) => {
    if (!s?.title || !s.primary_artist?.name || !s.url) return false;
    if (/^Genius(?:\s|$)/i.test(s.primary_artist.name)) return false; // translations, romanisations, lists
    const t = titleKey(s.title);
    // Genius often appends an English translation to a Cyrillic title in parentheses.
    const base = titleKey(s.title.replace(/\s*\([^)]*\)\s*$/, ''));
    if (t !== T && !(base === T && !version.test(s.title))) return false;
    const artists = [s.primary_artist, ...(s.featured_artists || [])].map((a) => artistKey(a.name));
    return !A || artists.includes(A) || artists.includes(artistKey(artist.split(/,|\s+(?:&|feat\.?|ft\.?)\s+/i)[0]));
  });
  // Prefer the original over an acoustic/alternate rendition with an appended parenthesis.
  const exact = matches.filter((s) => titleKey(s.title) === T);
  const best = exact.length ? exact : matches;
  // A common title without an artist is ambiguous. Never silently pick a different artist's lyrics.
  const identities = new Set(best.map((s) => `${titleKey(s.title)}|${artistKey(s.primary_artist.name)}`));
  return identities.size === 1 ? best[0] : null;
}

export function parseGeniusLyrics(html) {
  const root = parse(html);
  const containers = root.querySelectorAll('[data-lyrics-container="true"]');
  // Older pages used one .lyrics block. Avoid CSS class hashes, which change between releases.
  if (!containers.length) {
    const old = root.querySelector('.lyrics');
    if (old) containers.push(old);
  }
  return containers.filter((el) => !el.parentNode?.closest?.('[data-lyrics-container="true"]')).map((el) => {
    // The site's summary and contributor/language controls can be inside a lyrics container.
    el.querySelectorAll('script, style, noscript, button, [data-exclude-from-selection="true"], [class*="LyricsHeader"], [class*="SongDescription"], [class*="LyricsFooter"]').forEach((n) => n.remove());
    el.querySelectorAll('br').forEach((n) => n.replaceWith(new TextNode('\n')));
    return el.text;
  }).join('\n\n').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function createGeniusProvider({ token = '', baseUrl = 'https://genius.com', apiUrl = 'https://api.genius.com', fetcher = fetch, pageFetcher = fetcher } = {}) {
  let apiRestUntil = 0, webRestUntil = 0;
  const failure = (message) => Object.assign(new Error(message), { code: 502 });
  async function request(url, json = false, authenticated = false) {
    if (Date.now() < (authenticated ? apiRestUntil : webRestUntil)) {
      throw failure('Genius asked for a break. Try again in a few minutes; LRCLIB is still available.');
    }
    const headers = { 'User-Agent': UA, Accept: json ? 'application/json' : 'text/html' };
    if (authenticated) headers.Authorization = `Bearer ${token}`;
    const transport = json ? fetcher : pageFetcher;
    const r = await transport(url, { headers, redirect: 'error', signal: AbortSignal.timeout(12_000) });
    if (r.status === 404) return null;
    if ([401, 403, 429].includes(r.status)) {
      if (authenticated) apiRestUntil = Date.now() + 10 * 60_000;
      else webRestUntil = Date.now() + 10 * 60_000;
      throw failure(`Genius answered ${r.status}. ${r.status === 401 ? 'Check the Genius Client Access Token.' : 'Try again later; LRCLIB is still available.'}`);
    }
    if (!r.ok) throw failure(`Genius answered ${r.status}.`);
    const body = await r.text();
    if (!json) return body;
    try { return JSON.parse(body); }
    catch { throw failure('Genius returned a page instead of search results. Try again later.'); }
  }
  return async (title, artist = '') => {
    if (!title?.trim()) return null;
    const queries = [...new Set([`${title} ${artist}`.trim(), title.trim()])];
    for (const q of queries) {
      const url = token ? `${apiUrl}/search?${new URLSearchParams({ q })}`
        : `${baseUrl}/api/search/song?${new URLSearchParams({ q, per_page: '10' })}`;
      const data = await request(url, true, !!token);
      if (!data) continue;
      const hits = data.response?.hits ?? data.response?.sections?.flatMap((s) => s.hits || []);
      if (!Array.isArray(hits)) throw failure('Genius returned an unexpected search response.');
      const song = selectGeniusSong(hits.filter((h) => h.type === 'song').map((h) => h.result), title, artist);
      if (!song) continue;
      // Search metadata must never turn the server into a fetcher for arbitrary hosts.
      let page;
      try { page = new URL(song.url); } catch { continue; }
      if (page.protocol !== 'https:' || page.hostname !== 'genius.com' || page.port || page.username || page.password) continue;
      try {
        const html = await request(`${baseUrl}${page.pathname}`);
        if (!html) continue;
        const text = parseGeniusLyrics(html);
        if (!text) throw failure('Genius returned a song page without readable lyrics.');
        return { title: song.title, artist: song.primary_artist.name, text, source: 'Genius', synced: null };
      } catch (e) {
        // Metadata search can work while the web host is blocked. The fallback can still use this identity.
        e.song = { title: song.title, artist: song.primary_artist.name };
        throw e;
      }
    }
    return null;
  };
}

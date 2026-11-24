import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { cleanSongQuery, selectGeniusSong, parseGeniusLyrics, createGeniusProvider, createGeniusPageFetcher } from '../server/genius.js';

const song = (title = 'Duvet', artist = 'bôa (UK)', extra = {}) => ({ title, primary_artist: { name: artist }, url: 'https://genius.com/Boa-uk-duvet-lyrics', ...extra });
const results = (songs) => ({ response: { hits: songs.map((result) => ({ type: 'song', result })) } });
const page = '<div id="lyrics-root"><div data-lyrics-container="true"><div class="LyricsHeader__Container">ContributorsTranslations</div><div data-exclude-from-selection="true">About the song</div>[Verse]<br>Invented &amp; original<br><a href="/annotation">Second line</a><button>Read more</button></div><div data-lyrics-container="true">[Chorus]<br>Another invented line</div></div>';

test('song queries accept a title alone, artist/title uploads and recording labels', () => {
  assert.deepEqual(cleanSongQuery('Duvet', null), { title: 'Duvet', artist: '' });
  assert.deepEqual(cleanSongQuery('bôa — Duvet (Official Music Video)', 'Fan channel'), { title: 'Duvet', artist: 'bôa' });
  assert.deepEqual(cleanSongQuery('Duvet', 'bôa - Topic'), { title: 'Duvet', artist: 'bôa' });
  assert.deepEqual(cleanSongQuery('Duvet - slowed + reverb', 'bôa'), { title: 'Duvet', artist: 'bôa' });
  assert.deepEqual(cleanSongQuery('#voyuitwaaien - SUPER slowed + reverb', 'latex fruit'), { title: '#voyuitwaaien', artist: 'latex fruit' });
  assert.deepEqual(cleanSongQuery('Roi - Instrumental Slowed', 'Mckyyy'), { title: 'Roi - Instrumental Slowed', artist: 'Mckyyy' });
  assert.deepEqual(cleanSongQuery("Don't You (Forget About Me)", 'Simple Minds'), { title: "Don't You (Forget About Me)", artist: 'Simple Minds' });
});

test('Genius matching rejects translations and unrelated hits and prefers the original', () => {
  const original = song();
  const hits = [song('Duvet', 'Genius Russian Translations'), song('Duvet (Acoustic)'), song('Duvet Remix'), song('Another song'), original];
  assert.equal(selectGeniusSong(hits, 'Duvet', 'boa'), original);
  assert.equal(selectGeniusSong(hits, 'Duvet'), original);
  assert.equal(selectGeniusSong(hits, 'Duvet', 'Another artist'), null);
  const kino = song('Группа крови (Blood Type)', 'КИНО (KINO)');
  assert.equal(selectGeniusSong([kino], 'Группа крови', 'Кино'), kino);
  assert.equal(selectGeniusSong([song('Duvet Remix')], 'Duvet'), null);
  assert.equal(selectGeniusSong([song()], ''), null);
});

test('a title shared by multiple artists needs an artist', () => {
  const first = song('Hello', 'Adele'), second = song('Hello', 'Lionel Richie');
  assert.equal(selectGeniusSong([first, second], 'Hello'), null);
  assert.equal(selectGeniusSong([first, second], 'Hello', 'Adele'), first);
});

test('Genius parser keeps lines, annotations and section headers, excluding page controls and summary', () => {
  assert.equal(parseGeniusLyrics(page), '[Verse]\nInvented & original\nSecond line\n\n[Chorus]\nAnother invented line');
  assert.equal(parseGeniusLyrics('<div class="lyrics">One<br/>Two &lt;three&gt;</div>'), 'One\nTwo <three>');
  assert.equal(parseGeniusLyrics('<html>Please complete the challenge</html>'), '');
  assert.equal(parseGeniusLyrics('<div data-lyrics-container="true">One<div data-lyrics-container="true">Two</div></div>'), 'OneTwo');
});

test('authenticated search retries just the title but still checks the artist; token stays off the page request', async () => {
  const calls = [];
  const genius = createGeniusProvider({ token: 'test-token', fetcher: async (url, options) => {
    calls.push({ url, options });
    if (url.startsWith('https://api.genius.com/')) {
      const q = new URL(url).searchParams.get('q');
      return Response.json(results(q === 'Duvet' ? [song()] : [song('Duvet', 'Genius Translations')]));
    }
    return new Response(page);
  } });
  const found = await genius('Duvet', 'bôa');
  assert.equal(found.source, 'Genius');
  assert.equal(found.artist, 'bôa (UK)');
  assert.equal(found.synced, null);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
  assert.equal(calls[2].options.headers.Authorization, undefined);
  assert.equal(calls[2].options.redirect, 'error');
});

test('public title-only search does not require a token', async () => {
  const calls = [];
  const genius = createGeniusProvider({ fetcher: async (url) => {
    calls.push(url);
    return url.includes('/api/search/') ? Response.json({ response: { sections: [{ hits: [{ type: 'song', result: song() }] }] } }) : new Response(page);
  } });
  assert.equal((await genius('Duvet')).title, 'Duvet');
  assert.equal(calls.length, 2);
  assert.ok(calls[0].includes('/api/search/song?'));
});

test('the page transport is separate from API search and receives no API token', async () => {
  let pageCalls = 0;
  const genius = createGeniusProvider({ token: 'private-api-token', fetcher: async () => Response.json(results([song()])),
    pageFetcher: async (url, options) => {
      pageCalls++;
      assert.equal(url, 'https://genius.com/Boa-uk-duvet-lyrics');
      assert.equal(options.headers.Authorization, undefined);
      return new Response(page);
    } });
  assert.equal((await genius('Duvet')).source, 'Genius');
  assert.equal(pageCalls, 1);
});

test('page helper passes a URL as an argument and returns failures without caching them', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokify-genius-helper-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, 'helper.mjs');
  fs.writeFileSync(script, `const url = process.argv[2];
console.log(JSON.stringify(url.endsWith('/error-lyrics') ? {error:'Temporary transport error'} : {status:200,body:'<div>Invented text</div>'}));`);
  const fetcher = createGeniusPageFetcher(process.execPath, script);
  const r = await fetcher('https://genius.com/test-lyrics');
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '<div>Invented text</div>');
  await assert.rejects(fetcher('https://genius.com/error-lyrics'), /Temporary transport error/);
  assert.equal((await fetcher('https://genius.com/test-lyrics')).status, 200);
});

test('Genius refuses unrelated hosts and unsafe URLs from search metadata', async () => {
  for (const url of ['http://genius.com/x', 'https://evil.example/x', 'https://genius.com:123/x', 'https://user@genius.com/x', 'not a URL']) {
    let calls = 0;
    const genius = createGeniusProvider({ token: 'test', fetcher: async () => { calls++; return Response.json(results([song('Duvet', 'bôa', { url })])); } });
    assert.equal(await genius('Duvet'), null);
    assert.equal(calls, 1);
  }
});

test('403 and 429 pause Genius requests instead of hammering it', async () => {
  for (const status of [401, 403, 429]) {
    let calls = 0;
    const genius = createGeniusProvider({ fetcher: async () => { calls++; return new Response('', { status }); } });
    await assert.rejects(genius('Duvet'), new RegExp(String(status)));
    await assert.rejects(genius('Duvet'), /break/);
    assert.equal(calls, 1);
  }
});

test('a blocked web page preserves the resolved artist and leaves authenticated metadata search available', async () => {
  let searches = 0, pages = 0;
  const genius = createGeniusProvider({ token: 'test-token', fetcher: async (url) => {
    if (url.startsWith('https://api.genius.com/')) { searches++; return Response.json(results([song()])); }
    pages++;
    return new Response('', { status: 403 });
  } });
  await assert.rejects(genius('Duvet'), (e) => e.song?.artist === 'bôa (UK)');
  await assert.rejects(genius('Duvet'), (e) => e.song?.artist === 'bôa (UK)' && /break/.test(e.message));
  assert.equal(searches, 2);
  assert.equal(pages, 1);
});

test('malformed search results and missing lyrics are errors, genuine misses are null', async () => {
  const malformed = createGeniusProvider({ fetcher: async () => new Response('<html>challenge</html>') });
  await assert.rejects(malformed('Duvet'), /instead of search results/);
  const missing = createGeniusProvider({ fetcher: async (url) => url.includes('/api/') ? Response.json(results([song()])) : new Response('<html>No lyrics</html>') });
  await assert.rejects(missing('Duvet'), /without readable lyrics/);
  const empty = createGeniusProvider({ fetcher: async () => Response.json(results([])) });
  assert.equal(await empty('Duvet'), null);
});

test('library lyrics use Genius without audio, cache the result, fall back on outages and do not cache failures', async (t) => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'tokify-lyrics-'));
  let geniusStatus = 200, pageStatus = 200, lrclibStatus = 200, lrclibSongs = [], requests = 0, fallbackArtist = '';
  const server = http.createServer((req, res) => {
    requests++;
    const u = new URL(req.url, 'http://fixture');
    if (u.pathname === '/search') {
      assert.equal(req.headers.authorization, 'Bearer fixture-token');
      res.writeHead(geniusStatus, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(results([song()])));
    }
    if (u.pathname.endsWith('-lyrics')) {
      assert.equal(req.headers.authorization, undefined);
      res.writeHead(pageStatus);
      return res.end(page);
    }
    fallbackArtist = u.searchParams.get('artist_name');
    res.writeHead(lrclibStatus, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(lrclibSongs));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  process.env.TOKIFY_DATA = data;
  process.env.TOKIFY_GENIUS_URL = origin;
  process.env.TOKIFY_GENIUS_API = origin;
  process.env.TOKIFY_GENIUS_TOKEN = 'fixture-token';
  process.env.TOKIFY_LRCLIB = origin;
  const { db } = await import('../server/db.js');
  const { findLyrics, lyricsOf } = await import('../server/lyrics.js');
  t.after(async () => { await new Promise((r) => server.close(r)); db.close(); fs.rmSync(data, { recursive: true, force: true }); });
  const add = (id, title = 'Duvet', author = '') => db.prepare("INSERT INTO tracks(id,title,author,status,origin) VALUES(?,?,?,'ok','file')").run(id, title, author);

  add('named');
  const one = findLyrics('named'), two = findLyrics('named');
  assert.equal(one, two, 'same-track requests share their lookup');
  const found = await one;
  assert.equal(found.status, 'found');
  assert.equal(found.source, 'Genius');
  assert.deepEqual(found.lines, []);
  const count = requests;
  assert.deepEqual(lyricsOf('named'), found);
  assert.equal(requests, count, 'cached read makes no network calls');

  geniusStatus = 503;
  lrclibSongs = [{ trackName: 'Duvet', artistName: 'bôa', plainLyrics: 'Fallback invented line' },
    { trackName: 'Duvet Another Song', artistName: 'bôa', plainLyrics: 'This longer invented text belongs to a completely different song' }];
  add('fallback', 'Duvet', 'bôa');
  const fallback = await findLyrics('fallback');
  assert.equal(fallback.source, 'LRCLIB');
  assert.equal(fallback.text, 'Fallback invented line');

  lrclibStatus = 503;
  add('outage');
  await assert.rejects(findLyrics('outage'), /503/);
  assert.deepEqual(lyricsOf('outage'), { status: 'new' });

  geniusStatus = 200;
  lrclibStatus = 200;
  assert.equal((await findLyrics('outage')).source, 'Genius', 'a temporary outage can be retried');

  pageStatus = 403;
  add('blocked-page');
  assert.equal((await findLyrics('blocked-page')).source, 'LRCLIB');
  assert.equal(fallbackArtist, 'bôa', 'resolved metadata makes title-only fallback unambiguous');

  geniusStatus = 403;
  add('blocked');
  assert.equal((await findLyrics('blocked')).source, 'LRCLIB');
  const before = requests;
  add('blocked-again');
  await findLyrics('blocked-again');
  assert.equal(requests - before, 1, 'Genius cooldown still permits LRCLIB');

  // A sound with no real name waits for the Shazam button: nothing is looked up or kept before that.
  fs.mkdirSync(path.join(data, 'audio'), { recursive: true });
  fs.writeFileSync(path.join(data, 'audio', 'sound.m4a'), '');
  db.prepare("INSERT INTO tracks(id,title,author,status,origin,audio_file) VALUES('sound','original sound','','ok','tiktok','sound.m4a')").run();
  const quiet = requests;
  assert.equal((await findLyrics('sound')).status, 'unheard');
  assert.deepEqual(lyricsOf('sound'), { status: 'new' });
  assert.equal(requests, quiet, 'no lookups for an unrecognised sound');
  await assert.rejects(findLyrics('sound', { listen: true }), /not installed/, 'listening is asked for, not automatic');
});

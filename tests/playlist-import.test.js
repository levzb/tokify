import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { tool } from '../server/system.js';
import { parsePlaylistLink, parseMediaLink, isShortLink, TRACK_ID_RE } from '../server/shared.js';

const FFMPEG = tool('ffmpeg');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'tokify-playlists-'));
process.env.TOKIFY_DATA = data;

// A stand-in downloader: a playlist of two videos (and a private one), a search that finds the album
// recording, single-video details and the download itself.
const fake = path.join(data, 'fake-dlp.mjs');
process.env.TOKIFY_YTDLP = fake;
fs.writeFileSync(fake, `#!/usr/bin/env node
import fs from 'node:fs';
const args=process.argv.slice(2),url=args.at(-1);
const video=(id,title)=>({id,title,uploader:'Fixture artist',duration:2,webpage_url:'https://www.youtube.com/watch?v='+id,format_id:'audio'});
if(url.includes('playlist?list='))console.log(JSON.stringify({_type:'playlist',title:'Road trip',uploader:'Fixture DJ',thumbnails:[],entries:[
  {id:'aaaaaaaaaaa',title:'First song',channel:'Band - Topic',duration:2},{id:'bbbbbbbbbbb',title:null,duration:null},{id:'ccccccccccc',title:'Second song',channel:'Band',duration:2}]}));
else if(url.startsWith('ytsearch'))console.log(JSON.stringify({entries:[
  {id:'ddddddddddd',title:'Night Drive (Live)',uploader:'Singer',duration:2},{id:'eeeeeeeeeee',title:'Night Drive',uploader:'Singer - Topic',duration:2}]}));
else if(url.startsWith('scsearch'))console.log(JSON.stringify({entries:[]}));
else if(args.includes('--dump-single-json'))console.log(JSON.stringify(video(new URL(url).searchParams.get('v'),'Video')));
else{const file=args[args.indexOf('--output')+1].replace('%(ext)s','m4a');fs.copyFileSync(process.env.MEDIA_FIXTURE,file);fs.appendFileSync(process.env.MEDIA_COUNT,url+'\\n');}
`, { mode: 0o755 });
const audio = path.join(data, 'fixture.m4a');
assert.equal(spawnSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2:sample_rate=48000', '-c:a', 'aac', '-ac', '2', audio]).status, 0);
process.env.MEDIA_FIXTURE = audio;
process.env.MEDIA_COUNT = path.join(data, 'count.txt');

// A stand-in LRCLIB with timed words for the Spotify song.
const lrclib = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/get' && u.searchParams.get('track_name') === 'Night Drive') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ trackName: 'Night Drive', artistName: 'Singer', duration: 2, plainLyrics: 'Lights on\nKeep going', syncedLyrics: '[00:00.20] Lights on\n[00:01.10] Keep going' }));
  }
  res.writeHead(404); res.end('{}');
});
await new Promise((r) => lrclib.listen(0, '127.0.0.1', r));
process.env.TOKIFY_LRCLIB = `http://127.0.0.1:${lrclib.address().port}`;

const { db } = await import('../server/db.js');
const { previewLink, importPlaylist, jobStatus } = await import('../server/imports.js');
const { lyricsOf, parseLrc } = await import('../server/lyrics.js');
const { recordingScore, spotifyListFromEmbed, playlistFromDownloader } = await import('../server/sources.js');
async function finish(id) { for (let i = 0; i < 400; i++) { const j = jobStatus(id); if (j.finished) return j; await new Promise((r) => setTimeout(r, 30)); } throw Error('Playlist import timed out'); }

test('playlist links are told apart from single songs', () => {
  assert.deepEqual(parsePlaylistLink('https://www.youtube.com/playlist?list=PLOzDu-MXXLliO9fBNZOQTBDddoA3FzZUo&si=x'),
    { provider: 'youtube', kind: 'playlist', id: 'PLOzDu-MXXLliO9fBNZOQTBDddoA3FzZUo', url: 'https://www.youtube.com/playlist?list=PLOzDu-MXXLliO9fBNZOQTBDddoA3FzZUo' });
  assert.equal(parsePlaylistLink('https://music.youtube.com/playlist?list=OLAK5uy_kXyz1234567890').provider, 'youtube');
  assert.equal(parsePlaylistLink('https://www.youtube.com/watch?v=jNQXAC9IVRw&list=PLabcdefghijk'), null, 'a video opened from a playlist stays that video');
  assert.throws(() => parsePlaylistLink('https://www.youtube.com/playlist?list=RDabcdefghijklmnop'), /mix/);
  assert.equal(parsePlaylistLink('Listen: https://open.spotify.com/playlist/3nWckIxa8wzTZbfU2kXhNP?si=abc').url, 'https://open.spotify.com/playlist/3nWckIxa8wzTZbfU2kXhNP');
  assert.equal(parsePlaylistLink('https://open.spotify.com/intl-de/album/11dFghVXANMlKmJXsNCbNl').kind, 'album');
  assert.equal(parsePlaylistLink('https://soundcloud.com/chillhopdotcom/sets/summer-2023?utm_source=x').url, 'https://soundcloud.com/chillhopdotcom/sets/summer-2023');
  assert.equal(parsePlaylistLink('https://soundcloud.com/a/sets/b/s-SecretToken').url, 'https://soundcloud.com/a/sets/b/s-SecretToken');
  for (const url of ['https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl', 'https://soundcloud.com/forss/flickermood', 'https://www.youtube.com/@name', 'https://evil.example/playlist?list=PLabcdefghijk', 'https://open.spotify.com/artist/11dFghVXANMlKmJXsNCbNl'])
    assert.equal(parsePlaylistLink(url), null, url);
  assert.equal(isShortLink('https://on.soundcloud.com/AbC12'), true);
  assert.equal(isShortLink('https://spotify.link/xyz'), true);
  assert.equal(isShortLink('https://soundcloud.com/a/b'), false);
  assert.equal(parseMediaLink('https://api-v2.soundcloud.com/tracks/1514427898').musicId, 'sc-1514427898');
  assert.ok(TRACK_ID_RE.test('sp-3nWckIxa8wzTZbfU2kXhNP'));
});

test('playlist listings: private videos and numbered SoundCloud songs', () => {
  const yt = playlistFromDownloader({ title: 'Mix', uploader: 'Someone - Topic', entries: [{ id: 'aaaaaaaaaaa', title: 'A', channel: 'X - Topic', duration: 9 }, { id: 'bbbbbbbbbbb', title: null }, { id: 'aaaaaaaaaaa', title: 'A' }] }, { provider: 'youtube', url: 'u' });
  assert.deepEqual(yt.songs.map((s) => [s.id, s.author]), [['yt-aaaaaaaaaaa', 'X']]);
  assert.equal(yt.unavailable, 1); assert.equal(yt.owner, 'Someone');
  const sc = playlistFromDownloader({ title: 'Set', entries: [{ id: '1', url: 'https://soundcloud.com/a/first-song' }, { id: '2', url: 'https://api-v2.soundcloud.com/tracks/2' }] }, { provider: 'soundcloud', url: 'u' });
  assert.deepEqual(sc.songs.map((s) => [s.id, s.title, s.url]), [['sc-1', 'first song', 'https://soundcloud.com/a/first-song'], ['sc-2', '', 'https://api.soundcloud.com/tracks/2']]);
  const entity = { type: 'playlist', name: 'Mine', subtitle: 'Owner', coverArt: { sources: [{ url: 'https://i.scdn.co/a.jpg' }] }, trackList: [
    { uri: 'spotify:track:42qNWdLKCI41S4uzfamhFM', title: 'Duvet', subtitle: 'bôa', duration: 203600, isPlayable: true, entityType: 'track' },
    { uri: 'spotify:track:3uZ0IzwNUV1LN0aLoDJ2lW', title: 'apathy', subtitle: 'rukiawaa', duration: 278000, isPlayable: false, playabilityReason: 'COUNTRY_RESTRICTED', entityType: 'track' },
    { uri: 'spotify:episode:3uZ0IzwNUV1LN0aLoDJ2lW', title: 'A podcast', entityType: 'episode' }] };
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } })}</script>`;
  const sp = spotifyListFromEmbed(html, { url: 'https://open.spotify.com/playlist/x' });
  assert.deepEqual(sp.songs.map((s) => s.id), ['sp-42qNWdLKCI41S4uzfamhFM', 'sp-3uZ0IzwNUV1LN0aLoDJ2lW'], 'a song Spotify keeps from this country still comes in');
  assert.equal(sp.songs[0].duration, 203.6); assert.equal(sp.unavailable, 1); assert.equal(sp.cover, 'https://i.scdn.co/a.jpg');
});

test('the recording chosen for a Spotify song', () => {
  const want = { title: 'Duvet', author: 'bôa', duration: 204 };
  const score = (c) => recordingScore({ duration: 204, author: '', ...c }, want);
  assert.ok(score({ title: 'Duvet', author: 'bôa - Topic' }) > score({ title: 'Bôa - Duvet (Lyrics)', author: 'Fan' }));
  assert.ok(score({ title: 'Bôa - Duvet (Lyrics)', author: 'Fan' }) > score({ title: 'Bôa - Duvet (Live in Paris)', author: 'bôa' }));
  assert.ok(score({ title: 'Duvet', author: 'bôa', duration: 206 }) > score({ title: 'Duvet', author: 'bôa', duration: 212 }));
  assert.equal(score({ title: 'Duvet', author: 'bôa', duration: 260 }), -Infinity, 'a different cut is not the song');
  assert.equal(score({ title: 'Something else', author: 'bôa' }), -Infinity);
  assert.ok(recordingScore({ title: 'Roi (Instrumental Slowed)', author: 'Mckyyy', duration: 93 }, { title: 'Roi - Instrumental Slowed', author: 'Mckyyy', duration: 93 }) > 0, 'a slowed song may be slowed');
});

test('timed lyrics', () => {
  assert.deepEqual(parseLrc('[00:01.00] One\n[00:02.50]\n[00:03.00]\n[01:04.10][01:09.00] Two\nnot a line'), [
    { t: 1, text: 'One' }, { t: 2.5, text: '' }, { t: 64.1, text: 'Two' }, { t: 69, text: 'Two' }]);
  assert.deepEqual(parseLrc(''), []);
});

await test('a YouTube playlist and a Spotify playlist become library playlists; importing again adds only what is new', async (t) => {
  t.after(async () => { await new Promise((r) => lrclib.close(r)); db.close(); fs.rmSync(data, { recursive: true, force: true }); });

  const yt = await previewLink('https://www.youtube.com/playlist?list=PLfixture0001');
  assert.equal(yt.kind, 'playlist'); assert.equal(yt.name, 'Road trip'); assert.equal(yt.songs.length, 2); assert.equal(yt.unavailable, 1);
  assert.equal(yt.playlistId, null); assert.equal(yt.fresh, 2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tracks').get().n, 0, 'a preview saves nothing');
  const r = await importPlaylist(yt.token);
  assert.equal(r.total, 2);
  const job = await finish(r.jobId); assert.equal(job.ok, 2); assert.equal(job.failed, 0);
  const pl = db.prepare('SELECT * FROM playlists WHERE id=?').get(r.playlistId);
  assert.equal(pl.name, 'Road trip'); assert.equal(pl.origin, 'youtube'); assert.equal(pl.link, 'https://www.youtube.com/playlist?list=PLfixture0001');
  assert.deepEqual(db.prepare('SELECT track_id FROM playlist_tracks WHERE playlist_id=? ORDER BY pos').all(r.playlistId).map((x) => x.track_id), ['yt-aaaaaaaaaaa', 'yt-ccccccccccc']);

  const again = await previewLink('https://www.youtube.com/playlist?list=PLfixture0001');
  assert.equal(again.playlistId, r.playlistId); assert.equal(again.fresh, 0); assert.ok(again.songs.every((s) => s.have));
  const r2 = await importPlaylist(again.token);
  assert.equal(r2.playlistId, r.playlistId); assert.equal(r2.jobId, null, 'nothing new, nothing downloads');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM playlists WHERE origin='youtube'").get().n, 1);

  // Spotify: the song keeps Spotify's name, its audio is the album recording, and the timed words come along.
  const list = async (p) => ({ provider: 'spotify', kind: 'playlist', url: p.url, name: 'Late', owner: 'Me', cover: '', total: 124, unavailable: 0,
    songs: [{ id: 'sp-3nWckIxa8wzTZbfU2kXhNP', spotifyId: '3nWckIxa8wzTZbfU2kXhNP', title: 'Night Drive', author: 'Singer, Friend', duration: 2, url: 'https://open.spotify.com/track/3nWckIxa8wzTZbfU2kXhNP', cover: 'http://127.0.0.1/no-cover' }] }); // no trip to Spotify for a cover
  const sp = await previewLink('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', { list });
  assert.equal(sp.total, 124); assert.equal(sp.songs.length, 1);
  const rs = await importPlaylist(sp.token);
  assert.equal((await finish(rs.jobId)).ok, 1);
  const song = db.prepare("SELECT * FROM tracks WHERE id='sp-3nWckIxa8wzTZbfU2kXhNP'").get();
  assert.equal(song.status, 'ok'); assert.equal(song.origin, 'spotify'); assert.equal(song.title, 'Night Drive'); assert.equal(song.author, 'Singer, Friend');
  assert.equal(song.source_url, 'https://www.youtube.com/watch?v=eeeeeeeeeee', 'the album recording, not the live one');
  const words = lyricsOf(song.id);
  assert.equal(words.status, 'found'); assert.equal(words.text, 'Lights on\nKeep going');
  assert.deepEqual(words.lines, [{ t: 0.2, text: 'Lights on' }, { t: 1.1, text: 'Keep going' }]);
  assert.ok(fs.readFileSync(process.env.MEDIA_COUNT, 'utf8').trim().split('\n').length === 3);
});

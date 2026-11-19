// Link and export parsing. No server, database or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { findFavoriteSounds, musicIdFrom, titleFromLink, parseTikTokLink, musicFromTikTokData, parseMediaLink, TRACK_ID_RE } from '../server/shared.js';
import { metadataFromDownloader, spotifyMetadata } from '../server/sources.js';

// ---------- TikTok export ----------
const exportId = '7693678184747469598';
test('TikTok URL variants including the real h5 export format', () => {
  for (const link of [`https://m.tiktok.com/h5/share/music/${exportId}.html`, `https://www.tiktok.com/music/Song-name-${exportId}?lang=en`, `https://www.tiktok.com/share/music/${exportId}`]) assert.equal(musicIdFrom(link), exportId);
  for (const link of [`https://eviltiktok.com/share/music/${exportId}`, `https://tiktok.com.evil.com/share/music/${exportId}`, `https://www.tiktok.com/@a/video/${exportId}`]) assert.equal(musicIdFrom(link), null);
  assert.equal(musicIdFrom('https://m.tiktok.com/h5/share/music/77874607.html'), '77874607');
  assert.equal(titleFromLink(`https://www.tiktok.com/music/Song-name-${exportId}`), 'Song name');
});
test('favorites only, deduplicated, across export schema versions', () => {
  const link = `https://m.tiktok.com/h5/share/music/${exportId}.html`;
  const j = { 'Likes and Favorites': { 'Favorite Sounds': { FavoriteSoundList: [{ Date: '2026-10-26', Link: link }, { Link: link }, null] }, 'Like List': { ItemFavoriteList: [{ Link: 'https://www.tiktok.com/music/wrong-1234567890123456789' }] } } };
  assert.deepEqual(findFavoriteSounds(j), [{ musicId: exportId, link, title: 'TikTok sound', date: '2026-10-26' }]);
  assert.equal(findFavoriteSounds({ FavoriteSounds: [{ Link: link }] }).length, 1);
  assert.deepEqual(findFavoriteSounds({}), []);
});
test('owner archive regression (local archive only)', { skip: !fs.existsSync('TikTok_Data_1793457765.zip') }, () => {
  const files = unzipSync(fs.readFileSync('TikTok_Data_1793457765.zip'));
  const j = JSON.parse(strFromU8(files['user_data_tiktok.json']));
  const expected = j['Likes and Favorites']['Favorite Sounds'].FavoriteSoundList;
  const actual = findFavoriteSounds(j);
  assert.equal(actual.length, new Set(expected.map((s) => musicIdFrom(s.Link))).size);
  assert.equal(actual.length, 967);
});

// ---------- TikTok links ----------
const id = '7600000000000000001';
test('TikTok links: sound, video, mobile, both short hosts and copied share text', () => {
  assert.equal(parseTikTokLink(`https://www.tiktok.com/music/My-Sound-${id}?is_from_webapp=1#x`).musicId, id);
  assert.equal(parseTikTokLink(`https://m.tiktok.com/v/${id}.html`).videoId, id);
  assert.equal(parseTikTokLink(`https://www.tiktok.com/@someone/video/${id}`).videoId, id);
  assert.equal(parseTikTokLink(`https://www.tiktok.com/h5/share/music/${id}.html`).musicId, id);
  for (const s of ['https://vm.tiktok.com/ZMexample/', 'https://vt.tiktok.com/ZMexample/', 'https://www.tiktok.com/t/ZMexample/']) assert.equal(parseTikTokLink(s).url, s);
  assert.equal(parseTikTokLink(`Watch this! https://www.tiktok.com/@someone/video/${id}?_r=1 More text`).url, `https://www.tiktok.com/@someone/video/${id}`);
});
test('TikTok links reject profiles, outside hosts, credentials, ports and malformed input', () => {
  for (const s of [null, {}, '', 'https://tiktok.com/@someone', 'https://tiktok.com/', 'https://example.com/video/123',
    'https://tiktok.com.evil.example/music/sound-123', 'https://tiktok.com@127.0.0.1/video/123', 'https://www.tiktok.com:8080/music/sound-123',
    'https://user:pass@www.tiktok.com/music/sound-123', 'ftp://www.tiktok.com/music/sound-123', 'http://127.0.0.1', 'x'.repeat(5001)]) assert.throws(() => parseTikTokLink(s), String(s));
});
test('music metadata is extracted from API, video hydration, music hydration and SIGI_STATE', () => {
  const music = {id,title:'Found sound',authorName:'Creator',duration:19,playUrl:'https://v16.tiktokcdn.com/sound.mp3',coverMedium:'https://p16.tiktokcdn.com/cover.jpeg'};
  for(const data of [
    {musicInfo:{music}},
    {itemInfo:{itemStruct:{music}}},
    {__DEFAULT_SCOPE__:{'webapp.video-detail':{itemInfo:{itemStruct:{music}}}}},
    {__DEFAULT_SCOPE__:{'webapp.music-detail':{musicInfo:{music}}}},
    {ItemModule:{[id]:{music}}},
  ]) {
    const result=musicFromTikTokData(data,id);assert.equal(result.musicId,id);assert.equal(result.title,'Found sound');assert.equal(result.author,'Creator');assert.equal(result.duration,19);assert.ok(result.playUrl);assert.ok(result.coverUrl);
  }
  assert.equal(musicFromTikTokData({itemInfo:{itemStruct:{music:{...music,playUrl:{urlList:[music.playUrl]}}}}}).playUrl,music.playUrl);
  assert.equal(musicFromTikTokData({musicInfo:{music:{...music,playUrl:'file:///etc/passwd'}}}).playUrl,'');
  assert.equal(musicFromTikTokData({itemInfo:{itemStruct:{music:{...music,id:'../../bad'}}}}),null);
  assert.equal(musicFromTikTokData({}),null);
});

// ---------- YouTube, SoundCloud, Spotify ----------
test('supported video and track links normalize and discard tracking without starting playlists',()=>{
 for(const url of ['https://youtu.be/jNQXAC9IVRw?t=2','https://m.youtube.com/watch?v=jNQXAC9IVRw&list=PLabc','https://music.youtube.com/watch?v=jNQXAC9IVRw','https://www.youtube.com/shorts/jNQXAC9IVRw'])assert.equal(parseMediaLink(url).url,'https://www.youtube.com/watch?v=jNQXAC9IVRw');
 assert.equal(parseMediaLink('Watch: https://soundcloud.com/forss/flickermood?utm_source=copy').provider,'soundcloud');
 assert.equal(parseMediaLink('https://on.soundcloud.com/abc123/').provider,'soundcloud');assert.equal(parseMediaLink('https://soundcloud.com/a/song?secret_token=s-private&utm=x').url,'https://soundcloud.com/a/song?secret_token=s-private');
 assert.equal(parseMediaLink('https://open.spotify.com/intl-en/track/11dFghVXANMlKmJXsNCbNl?si=test').url,'https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl');
 assert.equal(parseMediaLink('https://spotify.link/abc123').provider,'spotify');assert.equal(parseMediaLink('https://www.tiktok.com/music/sound-123').musicId,'123');
 for(const id of ['yt-jNQXAC9IVRw','sc-293','123','file-'+'a'.repeat(64)])assert.ok(TRACK_ID_RE.test(id));
});
test('unsupported hosts, arbitrary protocols, profiles, lists and credentials are rejected',()=>{
 for(const url of ['https://youtube.com.evil.example/watch?v=jNQXAC9IVRw','https://youtube.com@127.0.0.1/watch?v=jNQXAC9IVRw','file:///tmp/audio.mp3','https://youtube.com:8080/watch?v=jNQXAC9IVRw','https://www.youtube.com/playlist?list=PLabc','https://www.youtube.com/@name','https://soundcloud.com/artist','https://soundcloud.com/artist/sets/list','https://soundcloud.com/artist/likes','https://open.spotify.com/album/11dFghVXANMlKmJXsNCbNl','https://example.com/song.mp3','https://user:password@youtube.com/watch?v=jNQXAC9IVRw'])assert.throws(()=>parseMediaLink(url),url);
});
test('downloader metadata uses stable source IDs and rejects preview-only, protected, live and oversized media',()=>{
 const link=parseMediaLink('https://www.youtube.com/watch?v=jNQXAC9IVRw'),raw={id:'jNQXAC9IVRw',title:'My video',uploader:'Creator',duration:19,thumbnail:'https://i.ytimg.com/cover.jpg'};
 assert.equal(metadataFromDownloader(raw,link).musicId,'yt-jNQXAC9IVRw');
 const sc=metadataFromDownloader({...raw,id:'293',webpage_url:'https://soundcloud.com/forss/flickermood'},parseMediaLink('https://soundcloud.com/forss/flickermood'));assert.equal(sc.musicId,'sc-293');
 for(const patch of [{_type:'playlist'},{entries:[]},{is_live:true},{duration:0},{duration:2701},{has_drm:true},{format_id:'hls_aac_preview'},{requested_downloads:[{format_id:'http_mp3_preview'}]},{availability:'premium_only'},{id:'../../bad'}])assert.throws(()=>metadataFromDownloader({...raw,...patch},link));
});
test('Spotify provides metadata only, even when the embed contains a preview',()=>{
 const id='11dFghVXANMlKmJXsNCbNl';const entity={type:'track',title:'A track',duration:195000,artists:[{name:'One'},{name:'Two'}],visualIdentity:{image:[{url:'https://i.scdn.co/a.jpg',maxWidth:300}]},audioPreview:{url:'https://example.com/preview.mp3'}};
 const result=spotifyMetadata(`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{state:{data:{entity}}}}})}</script>`,id);assert.equal(result.metadataOnly,true);assert.equal(result.author,'One, Two');assert.equal(result.duration,195);assert.equal(result.playUrl,undefined);assert.equal(result.musicId,null);
 assert.throws(()=>spotifyMetadata('<html>Unavailable</html>',id),/unavailable/);
});

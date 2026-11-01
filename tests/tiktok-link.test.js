import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTikTokLink, musicFromTikTokData } from '../shared/tiktok-link.js';

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

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { findFavoriteSounds, musicIdFrom, titleFromLink } from '../shared/export.js';

const id = '7693678184747469598';
test('TikTok URL variants including the real h5 export format', () => {
  for (const link of [`https://m.tiktok.com/h5/share/music/${id}.html`, `https://www.tiktok.com/music/Song-name-${id}?lang=en`, `https://www.tiktok.com/share/music/${id}`]) assert.equal(musicIdFrom(link), id);
  for (const link of [`https://eviltiktok.com/share/music/${id}`, `https://tiktok.com.evil.com/share/music/${id}`, `https://www.tiktok.com/@a/video/${id}`]) assert.equal(musicIdFrom(link), null);
  assert.equal(musicIdFrom('https://m.tiktok.com/h5/share/music/77874607.html'), '77874607');
  assert.equal(titleFromLink(`https://www.tiktok.com/music/Song-name-${id}`), 'Song name');
});
test('favorites only, deduplicated, across export schema versions', () => {
  const link = `https://m.tiktok.com/h5/share/music/${id}.html`;
  const j = { 'Likes and Favorites': { 'Favorite Sounds': { FavoriteSoundList: [{ Date: '2026-10-26', Link: link }, { Link: link }, null] }, 'Like List': { ItemFavoriteList: [{ Link: 'https://www.tiktok.com/music/wrong-1234567890123456789' }] } } };
  assert.deepEqual(findFavoriteSounds(j), [{ musicId: id, link, title: 'TikTok sound', date: '2026-10-26' }]);
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

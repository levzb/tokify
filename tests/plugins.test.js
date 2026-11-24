import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'tokify-plugins-'));
const dir = path.join(data, 'plugins');
process.env.TOKIFY_DATA = data;
process.env.TOKIFY_PLUGINS = dir;
const plugin = (id, manifest, server) => {
  fs.mkdirSync(path.join(dir, id), { recursive: true });
  fs.writeFileSync(path.join(dir, id, 'plugin.json'), typeof manifest === 'string' ? manifest : JSON.stringify({ id, name: id, api: 1, ...manifest }));
  if (server) fs.writeFileSync(path.join(dir, id, 'server.js'), server);
};

test('plugins load, switch, keep settings and answer lyrics; broken ones stay contained', async (t) => {
  plugin('words', { enabled: true, settings: [{ key: 'n', type: 'number', min: 1, max: 5, default: 2 }], actions: [{ id: 'go', label: 'Go', scope: 'song' }] }, `
    export default function (t) {
      t.lyrics.addProvider({ name: 'Fixture', priority: 1, find: (track) => ({ synced: '[00:01.00] hello ' + track.title }) });
      t.action('go', ({ trackId }) => ({ message: 'went ' + trackId + ' ' + t.settings().n }));
      t.route('GET', 'echo', ({ query }) => ({ q: query.q }));
      t.on('track.ready', (id) => t.store.set('last', id));
    }`);
  plugin('throws', { enabled: true }, 'export default function () { throw new Error("boom"); }');
  plugin('old', { enabled: true, api: 99 }, 'export default function () {}');
  plugin('garbled', '{ not json');
  const { db } = await import('../server/db.js');
  const P = await import('../server/plugins.js');
  t.after(() => { db.close(); fs.rmSync(data, { recursive: true, force: true }); });

  await P.loadPlugins();
  const list = Object.fromEntries(P.listPlugins().map((p) => [p.id, p]));
  assert.equal(list.words.active, true);
  assert.equal(list.throws.active, false);
  assert.equal(list.throws.error, 'boom');
  assert.match(list.old.error, /API 99/);
  assert.ok(list.garbled.broken);

  const r = await P.pluginLyrics({ title: 'x' }, {});
  assert.deepEqual(r, { synced: '[00:01.00] hello x', text: '', source: 'Fixture' });
  assert.equal((await P.updatePlugin('words', { settings: { n: 40 } })).values.n, 5, 'numbers are kept in range');
  assert.equal((await P.runAction('words', 'go', { trackId: 'abc' })).message, 'went abc 5');
  assert.deepEqual((await P.pluginRequest('GET', '/api/plugins/words/echo', { q: '1' }, null)).value, { q: '1' });
  P.emit('track.ready', 'song1');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(JSON.parse(db.prepare("SELECT store FROM plugins WHERE id='words'").get().store).last, 'song1');

  await P.updatePlugin('words', { enabled: false });
  assert.equal(await P.pluginLyrics({ title: 'x' }, {}), null, 'a plugin that is off is not asked');
  await assert.rejects(P.runAction('words', 'go', {}), /off/);
  assert.equal(await P.pluginRequest('GET', '/api/plugins/words/echo', {}, null), null);
});

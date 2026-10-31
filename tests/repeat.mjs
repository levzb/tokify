import { chromium, webkit, devices } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const base = process.env.TOKIFY_BASE_URL || 'http://localhost:8788';
const password = fs.readFileSync(process.env.TOKIFY_PASSWORD_FILE || 'data/initial-password.txt', 'utf8').trim();
for (const [name, engine, options] of [
  ['desktop', chromium, { viewport: { width: 1440, height: 1000 } }],
  ['iphone', webkit, { ...devices['iPhone 13'] }],
]) {
  const browser = await engine.launch();
  const ctx = await browser.newContext(options);
  const api = ctx.request;
  let playlist;
  try {
    assert.equal((await api.post(base + '/api/login', { data: { password } })).status(), 200);
    const library = await (await api.get(base + '/api/library')).json();
    const tracks = library.tracks.filter((t) => t.status === 'ok').slice(0, 3);
    assert.equal(tracks.length, 3);
    playlist = (await (await api.post(base + '/api/playlists', { data: { name: 'Проверка повтора', trackIds: tracks.map((t) => t.id) } })).json()).id;
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + '/#/p/' + playlist);
    await page.locator('.row').first().waitFor();
    const rows = page.locator('.row');
    const button = rows.first().getByRole('button', { name: 'Repeat song', exact: true });
    const sessionAfter = async (action) => {
      const pending = page.waitForRequest((r) => r.url().endsWith('/api/sessions') && r.method() === 'POST');
      await action();
      return (await pending).postDataJSON();
    };
    const press = async (locator) => {
      if (name === 'iphone') return locator.tap();
      if (await locator.getAttribute('aria-label') === 'Repeat song') await locator.locator('..').locator('..').hover();
      return locator.click();
    };
    let data = await sessionAfter(() => press(button));
    assert.ok(data.items.length > 1 && data.items.every((it) => it.id === tracks[0].id));
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    await page.waitForFunction(() => { const a = document.querySelector('audio'); return a && !a.paused && a.currentTime > .1; });
    for (const [label, mode] of [['Direct', 'none'], ['Fade', 'fade'], ['Crossfade', 'crossfade']]) {
      data = await sessionAfter(() => press(page.getByRole('radio', { name: label, exact: true })));
      assert.equal(data.mode, mode);
      assert.ok(data.items.every((it) => it.id === tracks[0].id));
    }
    // Unselecting repeat restores the following songs in the current playlist.
    data = await sessionAfter(() => press(button));
    assert.equal(await button.getAttribute('aria-pressed'), 'false');
    assert.ok(data.items.some((it) => it.id === tracks[1].id));
    // A different row starts repeating that song, rather than the previous song.
    const second = rows.nth(1).getByRole('button', { name: 'Repeat song', exact: true });
    data = await sessionAfter(() => press(second));
    assert.ok(data.items.every((it) => it.id === tracks[1].id));
    assert.equal(await second.getAttribute('aria-pressed'), 'true');
    assert.equal(await button.getAttribute('aria-pressed'), 'false');
    await page.waitForTimeout(500);
    await page.reload(); await page.locator('.row').first().waitFor();
    assert.equal(await rows.nth(1).getByRole('button', { name: 'Repeat song', exact: true }).getAttribute('aria-pressed'), 'true');
    // Enable the first playlist icon and check the full active ring fits in its scroll area.
    const firstPlaylist = page.locator('nav .list .item').first(); await press(firstPlaylist);
    await page.waitForTimeout(800);
    const padding = await firstPlaylist.evaluate((el) => {
      const a = el.getBoundingClientRect(), b = el.parentElement.getBoundingClientRect();
      return { top: a.top - b.top, left: a.left - b.left, bottom: b.bottom - a.bottom };
    });
    assert.ok(padding.top >= 6, 'playlist outline is clipped at the top');
    if (name === 'iphone') assert.ok(padding.left >= 6 && padding.bottom >= 6);
    await page.locator('nav').getByRole('button', { name: 'Проверка повтора', exact: true }).click();
    await page.waitForTimeout(800);
    if (name === 'iphone') await page.locator('.main-scroll').evaluate((el) => { el.scrollTop = 260; });
    await page.screenshot({ path: `screenshots/repeat-${name}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(name + ': repeat any row, all 3 transitions, disable, switch song, restore, sidebar outline and layout passed');
  } finally {
    if (playlist) await api.delete(base + '/api/playlists/' + playlist);
    await api.post(base + '/api/logout').catch(() => {});
    await browser.close();
  }
}

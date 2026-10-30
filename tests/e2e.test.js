// Browser tests: drives the real UI in Chromium at phone size.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.js';
import { addDays, localToday } from '../www/cycle.js';

const PORT = 8765;
const URL_ = `http://127.0.0.1:${PORT}/`;
let server, browser, ctx, page;
const errors = [];

before(async () => {
  server = await serve(PORT);
  browser = await chromium.launch();
  ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, acceptDownloads: true });
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  await page.goto(URL_);
});

after(async () => {
  await browser?.close();
  server?.close();
});

const today = localToday();
const tab = (name) => page.click(`.tabbar button[data-view=${name}]`);

async function logDay(date, { temp, bleeding, mucus } = {}) {
  await tab('today');
  await page.fill('#entry-form input[name=date]', date);
  await page.dispatchEvent('#entry-form input[name=date]', 'change');
  if (temp != null) await page.fill('#entry-form input[name=temp]', String(temp));
  if (bleeding) await page.click(`.chips[data-name=bleeding] button[data-v=${bleeding}]`);
  if (mucus) await page.click(`.chips[data-name=mucus] button[data-v=${mucus}]`);
  await page.click('#entry-form button[type=submit]');
  await page.waitForFunction(() => /Saved/.test(document.querySelector('#form-msg').textContent));
}

test('empty state', async () => {
  assert.match(await page.textContent('#status-card'), /Welcome/);
  assert.equal(await page.inputValue('#entry-form input[name=date]'), today);
});

test('logging a cycle by hand detects the temperature shift', async () => {
  // Period started 17 days ago; low temps then a clear rise.
  const start = addDays(today, -16);
  const temps = [36.4, 36.5, 36.4, 36.3, 36.4, 36.5, 36.4, 36.3, 36.4, 36.5, 36.4, 36.3, 36.7, 36.8, 36.8, 36.9, 36.8];
  for (let i = 0; i < temps.length; i++) {
    await logDay(addDays(start, i), { temp: temps[i], bleeding: i < 4 ? 'medium' : undefined });
  }
  const st = await page.evaluate(() => window.__app.analysis.current.shift);
  assert.equal(st.state, 'confirmed');
  assert.equal(st.firstHigh, addDays(start, 12));
  assert.equal(st.coverline, 36.5);
  // Confirmed on CD 15 -> today (CD 17) is infertile post-ovulation.
  assert.equal(await page.textContent('#status-label'), 'Infertile');
  assert.match(await page.textContent('#status-card'), /Cycle day 17/);
  assert.match(await page.textContent('#status-card'), /Next period/);
});

test('validation rejects bad temperatures and future dates', async () => {
  await tab('today');
  await page.fill('#entry-form input[name=date]', today);
  await page.dispatchEvent('#entry-form input[name=date]', 'change');
  await page.fill('#entry-form input[name=temp]', '42');
  await page.click('#entry-form button[type=submit]');
  assert.match(await page.textContent('#form-msg'), /out of range/);
  await page.fill('#entry-form input[name=date]', addDays(today, 3));
  await page.dispatchEvent('#entry-form input[name=date]', 'change');
  await page.fill('#entry-form input[name=temp]', '36.5');
  await page.click('#entry-form button[type=submit]');
  assert.match(await page.textContent('#form-msg'), /future/);
});

test('editing and deleting a day', async () => {
  const d = addDays(today, -2);
  await page.fill('#entry-form input[name=date]', d);
  await page.dispatchEvent('#entry-form input[name=date]', 'change');
  assert.equal(await page.inputValue('#entry-form input[name=temp]'), '36.8');
  await page.click('#delete-entry');
  assert.equal(await page.evaluate((x) => x in window.__app.state.entries, d), false);
});

test('chart renders points, coverline and summary', async () => {
  await tab('chart');
  assert.ok(await page.locator('#chart-wrap svg circle.tpt').count() >= 15);
  assert.equal(await page.locator('#chart-wrap svg line.cover').count(), 1);
  const summary = await page.textContent('#cycle-summary');
  assert.match(summary, /confirmed/);
  assert.match(summary, /Coverline36\.50 °C/);
});

test('data persists across reload', async () => {
  await page.reload();
  const n = await page.evaluate(() => Object.keys(window.__app.state.entries).length);
  assert.equal(n, 16);
});

test('demo data, calendar, stats', async () => {
  await tab('settings');
  await page.click('#load-demo');
  const a = await page.evaluate(() => {
    const A = window.__app.analysis;
    return { n: A.cycles.length, lengths: A.cycles.map((c) => c.length), shifts: A.cycles.map((c) => c.shift && c.shift.state) };
  });
  assert.equal(a.n, 4);
  assert.deepEqual(a.lengths, [28, 30, 27, null]);
  assert.deepEqual(a.shifts.slice(0, 3), ['confirmed', 'confirmed', 'confirmed']);

  await tab('calendar');
  assert.equal(await page.locator('#calendar button').count(), 42);
  assert.ok(await page.locator('#calendar button.period, #calendar button.pred-period').count() > 0);
  assert.equal(await page.locator('#calendar button.today').count(), 1);
  await page.click('#month-prev');
  assert.ok(await page.locator('#calendar button.period').count() > 0);
  await page.click('#month-next');
  // tap today's cell opens the editor for that day
  await page.click('#calendar button.today');
  assert.equal(await page.inputValue('#entry-form input[name=date]'), today);
  assert.ok(await page.isVisible('#view-today'));

  await tab('stats');
  const stats = await page.textContent('#stats');
  assert.match(stats, /Completed cycles3/);
  assert.match(stats, /27 \/ 30 d/);
  assert.equal(await page.locator('#history tr').count(), 5);

  await tab('chart');
  await page.click('#cycle-prev');
  assert.match(await page.textContent('#cycle-label'), /Cycle 3\/4/);
  assert.equal(await page.locator('#chart-wrap svg circle.excl').count(), 1);
});

test('Fahrenheit display', async () => {
  await tab('settings');
  await page.selectOption('#settings-form select[name=unit]', 'F');
  await tab('stats');
  assert.match(await page.textContent('#history'), /CL °F/);
  await tab('today');
  await page.fill('#entry-form input[name=temp]', '97.70');
  await page.click('#entry-form button[type=submit]');
  const t = await page.evaluate((d) => window.__app.state.entries[d].temp, today);
  assert.ok(Math.abs(t - 36.5) < 0.01);
  await tab('settings');
  await page.selectOption('#settings-form select[name=unit]', 'C');
});

test('export and re-import', async () => {
  await tab('settings');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-json')]);
  const path = await dl.path();
  const json = JSON.parse(await readFile(path, 'utf8'));
  const before = await page.evaluate(() => JSON.stringify(window.__app.state.entries));
  assert.equal(JSON.stringify(json.entries), before);

  const [dlc] = await Promise.all([page.waitForEvent('download'), page.click('#export-csv')]);
  const csv = await readFile(await dlc.path(), 'utf8');
  assert.match(csv, /^date,temp_c/);

  await page.click('#clear-all');
  assert.equal(await page.evaluate(() => Object.keys(window.__app.state.entries).length), 0);
  await page.setInputFiles('#import-file', path);
  await page.waitForFunction(() => /Imported/.test(document.querySelector('#data-msg').textContent));
  assert.equal(await page.evaluate(() => JSON.stringify(window.__app.state.entries)), before);
});

test('no horizontal page scroll on a phone and no JS errors', async () => {
  for (const v of ['today', 'chart', 'calendar', 'stats', 'settings']) {
    await tab(v);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 0, `${v} overflows by ${over}px`);
  }
  assert.deepEqual(errors, []);
});

test('works offline after first load (service worker)', async () => {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await ctx.setOffline(true);
  await page.reload();
  assert.match(await page.textContent('#status-card'), /Cycle day/);
  await ctx.setOffline(false);
});

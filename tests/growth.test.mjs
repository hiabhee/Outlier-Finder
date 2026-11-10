import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { read, bootSocial } from './helpers/socialApp.mjs';
const context = vm.createContext({});
vm.runInContext(read('core/growth.js'), context);
const observe = context.OutlierFinder.growth.observe;
const start = 100000000;

test('growth needs real observations at least one minute apart', () => {
  const initial = observe(null, 1000, start);
  assert.equal(initial.state, 'collecting');
  assert.equal(observe(initial, 1500, start + 1000).viewsPerMinute, null);
  const measured = observe(initial, 1600, start + 120000);
  assert.equal(measured.state, 'growing');
  assert.equal(measured.viewsPerMinute, 300);
  assert.equal(measured.deltaViews, 600);
  assert.equal(measured.percentChange, 60);
  assert.equal(measured.elapsedMinutes, 2);
});

test('counter corrections, stale windows, unchanged counts and zero baselines are handled', () => {
  const initial = observe(null, 1000, start);
  assert.equal(observe(initial, 900, start + 120000).state, 'collecting');
  assert.equal(observe(initial, 1500, start + 3600001).state, 'collecting');
  assert.equal(observe(initial, 1000, start + 120000).viewsPerMinute, 0);
  assert.equal(observe(observe(null, 0, start), 100, start + 60000).percentChange, null);
  assert.equal(observe(initial, -1, start), null);
});

test('X post growth persists between visits and is independent of follower availability', async () => {
  const now = Date.now();
  const previous = observe(null, 100000, now - 120000);
  const app = await bootSocial({ html: read('tests/fixtures/x-posts.html'), stored: { 'of:growth:x': { '1234567890123456789': previous } } });
  try {
    await app.waitFor(() => app.window.document.querySelector('.of-badge__growth')?.textContent.includes('views/min'));
    assert.match(app.window.document.querySelector('.of-badge').textContent, /SCORE N\/A/);
    app.window.document.querySelector('.of-badge').click();
    assert.match(app.window.document.querySelector('.of-panel').textContent, /Views gained/);
    assert.match(app.window.document.querySelector('.of-panel').textContent, /20K/);
    assert.equal(app.storage['of:growth:x']['1234567890123456789'].state, 'growing');
  } finally { app.close(); }
});

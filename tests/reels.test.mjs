import test from 'node:test';
import assert from 'node:assert/strict';
import { bootSocial } from './helpers/socialApp.mjs';
const A = 'ReelA_123', B = 'ReelB_456', C = 'ReelC_789';
const post = (id, views = 120000) => ({ code: id, play_count: views, like_count: 500, user: { username: id === A ? 'alice' : 'bob', follower_count: 10000 } });
const json = (value) => '<script type="application/json">' + JSON.stringify(value) + '</script>';
const wrappers = (content) => '<div>'.repeat(9) + content + '</div>'.repeat(9);
const slot = (id, top) => '<div data-reel-slot="' + id + '" data-top="' + top + '">' + wrappers('<video id="' + id + '" src="https://example.com/' + id + '.mp4"></video>') + '</div>';
function fixture({ metadata = true, single = false } = {}) {
  return '<html><body><div role="main"><div id="reel-scroller">' + slot(A, 20) + (single ? '' : slot(B, 780) + slot(C, 1540)) + '</div></div>' +
    (metadata ? json({ items: [post(A), post(B, 300000), post(C, 900000)] }) : '') + '</body></html>';
}
function geometry(window) {
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const owner = this.closest('[data-reel-slot]');
    return new window.DOMRect(owner ? Number(owner.dataset.left || 300) : 0, owner ? Number(owner.dataset.top) : 0, owner ? 420 : 1024, owner ? Number(owner.dataset.height || 720) : 768);
  };
}
const badge = (app) => app.window.document.querySelector('.of-reel-overlay .of-badge');
function moveToSecond(app) {
  app.window.document.querySelector('[data-reel-slot="' + A + '"]').dataset.top = '-740';
  app.window.document.querySelector('[data-reel-slot="' + B + '"]').dataset.top = '20';
  app.window.document.querySelector('[data-reel-slot="' + C + '"]').dataset.top = '780';
}

test('deeply nested individual Reel players show a fixed score overlay, not a badge below the whole feed', async () => {
  const app = await bootSocial({ html: fixture(), url: 'https://www.instagram.com/reels/' + A + '/?hl=en', setup: geometry });
  try {
    await app.waitFor(() => badge(app)?.textContent === '12xVIRAL');
    const overlay = app.window.document.querySelector('.of-reel-overlay');
    assert.equal(overlay.parentElement, app.window.document.body);
    assert.equal(overlay.style.position, 'fixed'); assert.equal(overlay.style.left, '300px'); assert.equal(overlay.style.top, '20px');
    assert.ok(badge(app).classList.contains('of-badge--reel'));
    assert.equal(app.window.document.querySelectorAll('.of-badge').length, 1);
    assert.equal((await app.message('OF_GET_STATS')).stats.scanned, 1, 'preloaded videos are not assigned the active post id');
    assert.equal(app.requests.length, 0);
  } finally { app.close(); }
});

test('scrolling a non-bubbling inner scroller updates the score to the next active Reel', async () => {
  const app = await bootSocial({ html: fixture(), url: 'https://www.instagram.com/reels/' + A + '/', setup: geometry });
  try {
    await app.waitFor(() => badge(app)?.textContent === '12xVIRAL');
    moveToSecond(app);
    app.window.history.replaceState({}, '', '/reels/' + B + '/');
    app.window.document.querySelector('#reel-scroller').dispatchEvent(new app.window.Event('scroll'));
    await app.waitFor(() => badge(app)?.textContent === '30xMASSIVE');
    assert.equal(badge(app).dataset.ofVideoId, 'instagram:' + B);
    assert.equal(app.window.document.querySelectorAll('.of-badge').length, 1);
    assert.equal((await app.message('OF_GET_STATS')).stats.scanned, 2);
  } finally { app.close(); }
});

test('a URL-only route change updates a reused video slot without a DOM mutation', async () => {
  const app = await bootSocial({ html: fixture({ single: true }), url: 'https://www.instagram.com/reels/' + A + '/', setup: geometry });
  try {
    await app.waitFor(() => badge(app)?.textContent === '12xVIRAL');
    const video = app.window.document.querySelector('video');
    app.window.history.replaceState({}, '', '/reels/' + B + '/');
    await app.waitFor(() => badge(app)?.textContent === '30xMASSIVE');
    assert.equal(app.window.document.querySelector('video'), video);
    assert.equal(badge(app).dataset.ofVideoId, 'instagram:' + B);
  } finally { app.close(); }
});

test('a newly visible preloaded video is not given the previous Reel score before the URL changes', async () => {
  const app = await bootSocial({ html: fixture(), url: 'https://www.instagram.com/reels/' + A + '/', setup: geometry });
  try {
    await app.waitFor(() => badge(app)?.textContent === '12xVIRAL');
    moveToSecond(app);
    app.window.document.querySelector('#reel-scroller').dispatchEvent(new app.window.Event('scroll'));
    await app.waitFor(() => !badge(app));
    app.window.OutlierFinder.socialState.observer.scan();
    assert.equal(badge(app), null);
    app.window.history.replaceState({}, '', '/reels/' + B + '/');
    await app.waitFor(() => badge(app)?.textContent === '30xMASSIVE');
  } finally { app.close(); }
});

test('late results from an earlier Reel cannot overwrite a reused player or its score', async () => {
  let release;
  const delayed = new Promise((resolve) => { release = resolve; });
  const app = await bootSocial({ html: fixture({ metadata: false, single: true }), url: 'https://www.instagram.com/reels/' + A + '/', setup: geometry,
    postHtml: (url) => url.includes(A) ? delayed : json(post(B, 300000)) });
  try {
    await app.waitFor(() => app.requests.length === 1);
    app.window.history.replaceState({}, '', '/reels/' + B + '/');
    await app.waitFor(() => badge(app)?.textContent === '30xMASSIVE');
    release(json(post(A)));
    await app.waitFor(() => app.window.OutlierFinder.socialState.pending.size === 0);
    assert.equal(badge(app).dataset.ofVideoId, 'instagram:' + B);
    assert.equal(badge(app).textContent, '30xMASSIVE');
    assert.equal([...app.window.OutlierFinder.socialState.cards.values()][0].videoId, 'instagram:' + B);
  } finally { release(json(post(A))); app.close(); }
});

test('the score overlay follows player layout changes and is removed when leaving the viewer', async () => {
  const app = await bootSocial({ html: fixture(), url: 'https://www.instagram.com/reels/' + A + '/', setup: geometry });
  try {
    await app.waitFor(() => badge(app)?.textContent === '12xVIRAL');
    app.window.document.querySelector('[data-reel-slot="' + A + '"]').dataset.left = '420';
    app.window.dispatchEvent(new app.window.Event('resize'));
    await app.waitFor(() => app.window.document.querySelector('.of-reel-overlay')?.style.left === '420px');
    app.window.history.replaceState({}, '', '/alice/');
    await app.waitFor(() => !app.window.document.querySelector('.of-reel-overlay'));
  } finally { app.close(); }
});


test('a Reel awaiting media dimensions does not put a hidden flow badge at the bottom of the page', async () => {
  const html = fixture({ single: true }).replace('data-top="20"', 'data-top="20" data-height="0"');
  const app = await bootSocial({ html, url: 'https://www.instagram.com/reels/' + A + '/', setup: geometry });
  try {
    await app.waitFor(() => app.window.OutlierFinder.socialState.observer?.running);
    app.window.OutlierFinder.socialState.observer.scan();
    assert.equal(app.window.document.querySelector('.of-badge'), null);
    app.window.document.querySelector('[data-reel-slot]').dataset.height = '720';
    app.window.document.querySelector('video').dispatchEvent(new app.window.Event('loadedmetadata'));
    await app.waitFor(() => badge(app)?.textContent === '12xVIRAL');
    assert.equal(app.window.document.querySelectorAll('.of-badge').length, 1);
  } finally { app.close(); }
});

test('a visually displayed Reel can be aria-hidden and mounted outside main/dialog landmarks', async () => {
  const html = fixture().replace('role="main"', 'class="viewer-portal"').replace('<video id="' + A, '<video aria-hidden="true" id="' + A);
  const app = await bootSocial({ html, url: 'https://www.instagram.com/reels/' + A + '/', setup: geometry });
  try {
    await app.waitFor(() => badge(app)?.textContent === '12xVIRAL');
    assert.equal(badge(app).dataset.ofVideoId, 'instagram:' + A);
  } finally { app.close(); }
});

test('CSS-hidden preloaded videos are rejected even when their rectangles overlap the visible player', async () => {
  const html = fixture().replace('data-reel-slot="' + A + '"', 'style="opacity:0" data-reel-slot="' + A + '"').replace('data-top="780"', 'data-top="20"');
  const app = await bootSocial({ html, url: 'https://www.instagram.com/reels/' + B + '/', setup: geometry });
  try {
    await app.waitFor(() => badge(app)?.textContent === '30xMASSIVE');
    assert.equal(badge(app).dataset.ofVideoId, 'instagram:' + B);
  } finally { app.close(); }
});

test('React removing the Reel score alone triggers repair without a scroll or route change', async () => {
  const app = await bootSocial({ html: fixture(), url: 'https://www.instagram.com/reels/' + A + '/', setup: geometry });
  try {
    await app.waitFor(() => badge(app)?.textContent === '12xVIRAL');
    const previous = badge(app); previous.remove();
    await app.waitFor(() => badge(app) && badge(app) !== previous && badge(app).textContent === '12xVIRAL');
    assert.equal(app.window.document.querySelectorAll('.of-badge').length, 1);
  } finally { app.close(); }
});

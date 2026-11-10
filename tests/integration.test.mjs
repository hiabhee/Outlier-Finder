import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const channelHtml = read('tests/fixtures/channel.html');

async function boot({ html = read('tests/fixtures/cards.html'), replyHtml = channelHtml, watchHtml = read('tests/fixtures/watch.html') } = {}) {
  const dom = new JSDOM(html, { url: 'https://www.youtube.com/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const storage = { settings: { request: { minIntervalMs: 0 } } };
  const storageListeners = [];
  const backgroundListeners = [];
  const contentListeners = [];
  const requests = [];
  const chrome = {
    runtime: {
      getManifest: () => manifest,
      onMessage: { addListener: (listener) => contentListeners.push(listener) },
      sendMessage(message, callback = () => {}) {
        for (const listener of backgroundListeners) listener(message, { tab: { id: 1 } }, callback);
      }
    },
    storage: {
      local: {
        get(keys, callback) {
          const names = keys == null ? Object.keys(storage) : Array.isArray(keys) ? keys : [keys];
          callback(Object.fromEntries(names.filter((key) => key in storage).map((key) => [key, storage[key]])));
        },
        set(values, callback = () => {}) {
          const changes = {};
          for (const [key, value] of Object.entries(values)) {
            changes[key] = { oldValue: storage[key], newValue: value };
            storage[key] = value;
          }
          callback();
          for (const listener of storageListeners) listener(changes, 'local');
        },
        remove(keys, callback) { for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key]; callback(); }
      },
      onChanged: { addListener: (listener) => storageListeners.push(listener) }
    },
    action: { setBadgeText(_values, callback) { callback(); }, setBadgeBackgroundColor(_values, callback) { callback?.(); } }
  };
  window.chrome = chrome;
  const background = vm.createContext({
    URL, AbortController, setTimeout, clearTimeout, console,
    chrome: { ...chrome, runtime: { ...chrome.runtime,
      onMessage: { addListener: (listener) => backgroundListeners.push(listener) },
      onInstalled: { addListener() {} }, onStartup: { addListener() {} }
    } },
    fetch: async (url) => { requests.push(url); return { ok: true, url, text: async () => new URL(url).pathname === '/watch' ? watchHtml : replyHtml }; }
  });
  background.importScripts = (...files) => files.forEach((file) => vm.runInContext(read(file.replace(/^\//, '')), background));
  vm.runInContext(read(manifest.background.service_worker), background);
  for (const file of manifest.content_scripts[0].js) window.eval(read(file));
  const waitFor = async (condition) => {
    const deadline = Date.now() + 2500;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('Timed out waiting for integration state');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  const message = (type) => new Promise((resolve) => contentListeners.forEach((listener) => listener({ type }, {}, resolve)));
  return { window, requests, storage, message, waitFor, chrome, close: () => { window.OutlierFinder.state.observer?.stop(); window.close(); } };
}

test('nested channel header is parsed without borrowing recommendation counts', async () => {
  const context = vm.createContext({ URL, setTimeout, clearTimeout });
  for (const file of ['core/dataValidator.js', 'background/dataFetcher.js']) vm.runInContext(read(file), context);
  const parsed = context.OutlierFinder.parseChannelHtml(channelHtml, 'https://www.youtube.com/@creator');
  assert.equal(parsed?.subscriberCount, 10000);
});

test('real DOM + content scripts + service worker render the correct score on a thumbnail', async () => {
  const app = await boot();
  try {
    await app.waitFor(() => app.window.OutlierFinder.state.results.size === 1);
    const payload = app.window.OutlierFinder.state.results.get('dQw4w9WgXcQ');
    assert.equal(payload.state, 'scored', payload.reason);
    const badge = app.window.document.querySelector('yt-lockup-view-model .of-badge');
    assert.ok(badge, 'badge belongs to the video card');
    assert.ok(badge.parentElement.querySelector('img'), 'overlay container includes the thumbnail');
    assert.equal(badge.closest('a'), null, 'badge button is outside YouTube navigation anchors');
    assert.equal(badge.parentElement.style.position, 'relative');
    assert.equal(badge.textContent, '42xMASSIVE');
    assert.equal(app.requests.length, 1);
    const response = await app.message('OF_GET_STATS');
    assert.equal(response.stats.scanned, 1);
    assert.equal(response.stats.outliers, 1);
  } finally { app.close(); }
});

test('unavailable channel data is exposed in popup diagnostics', async () => {
  const app = await boot({ replyHtml: channelHtml.replace('10K subscribers', 'Subscribers hidden') });
  try {
    await app.waitFor(() => app.window.OutlierFinder.state.results.size === 1);
    const response = await app.message('OF_GET_STATS');
    assert.equal(response.stats.unavailable, 1);
    assert.equal(response.stats.scored, 0);
    assert.match(response.stats.lastError, /subscriber count not found/);
    assert.equal(app.window.document.querySelector('.of-badge--scored'), null);
    const badge = app.window.document.querySelector('.of-badge--unavailable');
    assert.equal(badge.textContent, 'SCORE N/A');
    assert.match(badge.title, /subscriber count not found/);
  } finally { app.close(); }
});


test('duplicate cards reuse channel requests and each receive one badge', async () => {
  const fixture = read('tests/fixtures/cards.html');
  const app = await boot({ html: fixture.replace('</body>', fixture.match(/<ytd-rich-item-renderer>[\s\S]*<\/ytd-rich-item-renderer>/)[0] + '</body>') });
  try {
    await app.waitFor(() => app.window.document.querySelectorAll('.of-badge--scored').length === 2);
    assert.equal(app.requests.length, 1);
    assert.equal(app.window.OutlierFinder.state.stats.scanned, 1);
    for (const card of app.window.document.querySelectorAll('yt-lockup-view-model')) {
      assert.equal(card.querySelectorAll('.of-badge').length, 1);
    }
  } finally { app.close(); }
});

test('normal videos receive a neutral numeric score, rather than disappearing', async () => {
  const app = await boot({ replyHtml: channelHtml.replace('10K subscribers', '2M subscribers') });
  try {
    await app.waitFor(() => app.window.document.querySelector('.of-badge--scored'));
    const badge = app.window.document.querySelector('.of-badge');
    assert.equal(badge.textContent, '0.2xSCORE');
    assert.ok(badge.classList.contains('of-badge--normal'));
    const stats = (await app.message('OF_GET_STATS')).stats;
    assert.equal(stats.scored, 1);
    assert.equal(stats.outliers, 0);
  } finally { app.close(); }
});

async function openPopup(app, connected = true) {
  const popup = new JSDOM(read('popup/popup.html'), {
    url: 'chrome-extension://fixture/popup/popup.html', runScripts: 'outside-only'
  });
  popup.window.chrome = {
    ...app.chrome,
    tabs: {
      query(_query, callback) { callback([{ id: 1, url: 'https://www.youtube.com/' }]); },
      sendMessage(_id, message, callback) {
        if (connected) app.message(message.type).then(callback);
        else callback(null);
      }
    }
  };
  for (const script of popup.window.document.querySelectorAll('script[src]')) {
    const file = new URL(script.getAttribute('src'), new URL('../popup/popup.html', import.meta.url));
    popup.window.eval(fs.readFileSync(file, 'utf8'));
  }
  return popup;
}

test('popup shows the lookup error instead of claiming an empty scan succeeded', async () => {
  const app = await boot({ replyHtml: channelHtml.replace('10K subscribers', 'Subscribers hidden') });
  let popup;
  try {
    await app.waitFor(() => app.window.OutlierFinder.state.results.size === 1);
    popup = await openPopup(app);
    await app.waitFor(() => popup.window.document.querySelector('#ofp-status').textContent.includes('unavailable'));
    assert.equal(popup.window.document.querySelector('#ofp-status').textContent, '0 scored · 0 waiting · 1 unavailable');
    assert.match(popup.window.document.querySelector('#ofp-status-detail').textContent, /subscriber count not found/);
  } finally { popup?.window.close(); app.close(); }
});

test('popup reports a disconnected tab and asks for a refresh', async () => {
  const app = await boot();
  let popup;
  try {
    popup = await openPopup(app, false);
    await app.waitFor(() => popup.window.document.querySelector('#ofp-status').textContent.includes('not connected'));
    assert.match(popup.window.document.querySelector('#ofp-status-detail').textContent, /Refresh YouTube/);
    assert.doesNotMatch(popup.window.document.querySelector('#ofp-subtitle').textContent, /Connected to YouTube/);
  } finally { popup?.window.close(); app.close(); }
});


test('missing views leave a visible unavailable badge with the extraction reason', async () => {
  const app = await boot({ html: read('tests/fixtures/cards.html').replace('420K views', 'Views unavailable') });
  try {
    await app.waitFor(() => app.window.document.querySelector('.of-badge--unavailable'));
    const badge = app.window.document.querySelector('.of-badge');
    assert.equal(badge.textContent, 'SCORE N/A');
    assert.match(badge.title, /view count unavailable/);
    assert.equal(app.requests.length, 0);
  } finally { app.close(); }
});

test('a real zero-view count renders 0x rather than hiding the badge', async () => {
  const app = await boot({ html: read('tests/fixtures/cards.html').replace('420K views', '0 views') });
  try {
    await app.waitFor(() => app.window.document.querySelector('.of-badge--scored'));
    assert.equal(app.window.document.querySelector('.of-badge').textContent, '0xSCORE');
  } finally { app.close(); }
});

test('display-contents thumbnails anchor the badge to a container with a layout box', async () => {
  const app = await boot({ html: read('tests/fixtures/cards.html').replace('<yt-thumbnail-view-model>', '<yt-thumbnail-view-model style="display:contents">') });
  try {
    await app.waitFor(() => app.window.document.querySelector('.of-badge--scored'));
    const badge = app.window.document.querySelector('.of-badge');
    assert.notEqual(app.window.getComputedStyle(badge.parentElement).display, 'contents');
    assert.equal(badge.closest('a'), null);
  } finally { app.close(); }
});

test('metadata extraction tolerates renamed CSS classes and label-free view counts', async () => {
  const html = read('tests/fixtures/cards.html')
    .replaceAll('yt-content-metadata-view-model-wiz__metadata-row', 'ytContentMetadataViewModelMetadataRow')
    .replaceAll('yt-content-metadata-view-model-wiz__metadata-text', 'ytContentMetadataViewModelMetadataText')
    .replace('420K views', '1.1M')
    .replace('4 days ago', '2mo ago');
  const app = await boot({ html });
  try {
    await app.waitFor(() => app.window.OutlierFinder.state.results.size === 1);
    const result = app.window.OutlierFinder.state.results.get('dQw4w9WgXcQ');
    assert.equal(result.state, 'scored', result.reason);
    assert.equal(result.views, 1100000);
    assert.equal(result.score, 110);
    assert.equal(app.window.document.querySelector('.of-badge').textContent, '110xMEGA OUTLIER');
  } finally { app.close(); }
});

test('absolute channel links are accepted on collaboration cards', async () => {
  const html = read('tests/fixtures/cards.html').replace('href="/@creator"', 'href="https://www.youtube.com/@creator"');
  const app = await boot({ html });
  try {
    await app.waitFor(() => app.window.OutlierFinder.state.results.size === 1);
    const result = app.window.OutlierFinder.state.results.get('dQw4w9WgXcQ');
    assert.equal(result.state, 'scored', result.reason);
    assert.equal(result.score, 42);
  } finally { app.close(); }
});


test('the three metadata samples from the live YouTube page produce numeric scores', async () => {
  const metadata = new JSDOM(read('tests/fixtures/live-metadata.html'));
  const samples = [...metadata.window.document.querySelectorAll('yt-content-metadata-view-model')].map((node) => node.outerHTML);
  metadata.window.close();
  const expected = [{ views: 562000, age: 3 }, { views: 6200, age: 2 }, { views: 251000, age: 13 }];
  for (let index = 0; index < samples.length; index += 1) {
    const html = read('tests/fixtures/cards.html').replace(/<yt-content-metadata-view-model>[\s\S]*?<\/yt-content-metadata-view-model>/, samples[index]);
    const app = await boot({ html });
    try {
      await app.waitFor(() => app.window.OutlierFinder.state.results.size === 1);
      const result = app.window.OutlierFinder.state.results.get('dQw4w9WgXcQ');
      assert.equal(result.state, 'scored', result.reason);
      assert.equal(result.views, expected[index].views);
      assert.equal(app.window.OutlierFinder.state.videos.get('dQw4w9WgXcQ').ageDays, expected[index].age);
      assert.ok(app.window.document.querySelector('.of-badge--scored'));
    } finally { app.close(); }
  }
});

test('semantic accessibility labels work even when metadata CSS classes change again', async () => {
  const metadata = read('tests/fixtures/live-metadata.html').split('\n')[0]
    .replaceAll('ytContentMetadataViewModelMetadataText', 'newMetadataText')
    .replaceAll('ytContentMetadataViewModelMetadataRow', 'newMetadataRow');
  const html = read('tests/fixtures/cards.html').replace(/<yt-content-metadata-view-model>[\s\S]*?<\/yt-content-metadata-view-model>/, metadata);
  const app = await boot({ html });
  try {
    await app.waitFor(() => app.window.OutlierFinder.state.results.size === 1);
    assert.equal(app.window.OutlierFinder.state.results.get('dQw4w9WgXcQ').views, 562000);
  } finally { app.close(); }
});


test('cards without channel links resolve the owner from the public video page', async () => {
  const html = read('tests/fixtures/cards.html').replace('<a href="/@creator">Creator</a>', '<span>Creator</span>');
  const app = await boot({ html });
  try {
    await app.waitFor(() => app.window.OutlierFinder.state.results.size === 1);
    const result = app.window.OutlierFinder.state.results.get('dQw4w9WgXcQ');
    assert.equal(result.state, 'scored', result.reason);
    assert.equal(result.score, 42);
    assert.equal(result.channel.channelId, 'UCabcdefghijklmnopqrstuv');
    assert.equal(app.requests.filter((url) => new URL(url).pathname === '/watch').length, 1);
    assert.equal(app.requests.length, 2);
    const owner = await new Promise((resolve) => app.chrome.runtime.sendMessage({ type: 'GET_VIDEO_CHANNEL', videoId: 'dQw4w9WgXcQ' }, resolve));
    assert.equal(owner.cached, true);
    assert.equal(app.requests.length, 2, 'cached owner lookup makes no additional request');
    assert.equal(app.window.document.querySelector('.of-badge').textContent, '42xMASSIVE');
  } finally { app.close(); }
});

test('private or unavailable owner pages never supply a channel or a fabricated score', async () => {
  const html = read('tests/fixtures/cards.html').replace('<a href="/@creator">Creator</a>', '<span>Creator</span>');
  const watchHtml = read('tests/fixtures/watch.html').replace('"status": "OK"', '"status": "LOGIN_REQUIRED"');
  const app = await boot({ html, watchHtml });
  try {
    await app.waitFor(() => app.window.OutlierFinder.state.results.size === 1);
    const result = app.window.OutlierFinder.state.results.get('dQw4w9WgXcQ');
    assert.equal(result.state, 'unavailable');
    assert.equal(result.score, null);
    assert.match(result.reason, /video owner unavailable/);
    assert.equal(app.requests.length, 1);
    const owner = await new Promise((resolve) => app.chrome.runtime.sendMessage({ type: 'GET_VIDEO_CHANNEL', videoId: 'dQw4w9WgXcQ' }, resolve));
    assert.equal(owner.cachedFailure, true);
    assert.equal(app.requests.length, 1, 'owner lookup failures use the negative cache');
  } finally { app.close(); }
});

test('owner parsing validates video identity and ignores recommended channels', () => {
  const context = vm.createContext({ URL, setTimeout, clearTimeout });
  for (const file of ['core/dataValidator.js', 'background/dataFetcher.js']) vm.runInContext(read(file), context);
  const parse = context.OutlierFinder.parseVideoOwnerHtml;
  const html = read('tests/fixtures/watch.html');
  assert.equal(parse(html, 'abcdefghijk'), null);
  assert.equal(parse(html, '../watch'), null);
  assert.equal(parse(html.replace('UCabcdefghijklmnopqrstuv', 'not-a-channel-id'), 'dQw4w9WgXcQ'), null);
  assert.equal(parse('<script>var ytInitialData = {"contents":{"channelId":"UCabcdefghijklmnopqrstuv"}};</script>', 'dQw4w9WgXcQ'), null);
});

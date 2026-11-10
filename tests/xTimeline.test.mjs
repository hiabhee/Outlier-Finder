import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { read, bootSocial } from './helpers/socialApp.mjs';

function reader() {
  const listeners = new Map(), sent = [];
  let calls = 0;
  const pending = Promise.resolve({ ok: true, url: 'https://x.com/i/api/graphql/hash/SearchTimeline', clone: () => ({ text: async () => JSON.stringify(payload) }) });
  const location = new URL('https://x.com/explore');
  const context = vm.createContext({ URL, Reflect, Promise, Map, Set, WeakMap, WeakSet, location,
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    postMessage(value) { sent.push(value); },
    fetch() { calls++; return pending; }
  });
  vm.runInContext('window=globalThis', context);
  vm.runInContext(read('content/xTimelineReader.js'), context);
  const dispatch = data => { context.incoming = data; vm.runInContext('for (const fn of []) {}', context); for (const fn of listeners.get('message') || []) { context.fn = fn; vm.runInContext('fn({source:window,origin:location.origin,data:incoming})', context); } };
  return { context, sent, pending, dispatch, calls: () => calls };
}
const tweet = (id, username, count) => ({ rest_id: id, core: { user_results: { result: { core: { screen_name: username }, legacy: { followers_count: count } } } } });
const payload = { data: { entries: [tweet('123', 'alice', 10000), tweet('456', 'bob', 20000), { message: { followers_count: 99 } }] } };
const settle = () => new Promise(resolve => setTimeout(resolve, 10));

test('X reader observes public Explore responses without changing fetch results or issuing requests', async () => {
  const app = reader();
  app.dispatch({ type: 'OF_X_READER_CONFIG', enabled: true });
  const returned = vm.runInContext("fetch('/i/api/graphql/hash/SearchTimeline')", app.context);
  assert.equal(returned, app.pending);
  await settle();
  const posts = app.sent.find(value => value.type === 'OF_X_PUBLIC_POSTS')?.posts;
  assert.deepEqual(JSON.parse(JSON.stringify(posts)), [{ postId: '456', username: 'bob', followerCount: 20000 }, { postId: '123', username: 'alice', followerCount: 10000 }]);
  assert.equal(app.calls(), 1);
  const diagnostics = app.context.__ofTimelineDiagnostics;
  assert.equal(diagnostics.fetchRequests, 1);
  assert.equal(diagnostics.matchingRequests, 1);
  assert.equal(diagnostics.responses, 1);
  assert.equal(diagnostics.authorRecords, 2);
  assert.deepEqual(Array.from(diagnostics.operations), ['SearchTimeline']);
  assert.equal(JSON.stringify(diagnostics).includes('alice'), false);
});

test('X reader ignores messaging, unapproved operations, cross-origin URLs and disabled state', async () => {
  const app = reader();
  app.dispatch({ type: 'OF_X_READER_CONFIG', enabled: true });
  for (const url of ['/i/api/graphql/hash/DmInbox', 'https://evil.example/i/api/graphql/hash/SearchTimeline', '/i/api/graphql/hash/AccountSettings']) {
    app.context.target = url; vm.runInContext('fetch(target)', app.context);
  }
  app.dispatch({ type: 'OF_X_READER_CONFIG', enabled: false });
  vm.runInContext("fetch('/i/api/graphql/hash/SearchTimeline')", app.context);
  await settle();
  assert.equal(app.sent.filter(value => value.type === 'OF_X_PUBLIC_POSTS').length, 0);
});

test('Explore timeline counts score multiple creators without visiting their profiles', async () => {
  const first = read('tests/fixtures/x-posts.html');
  const second = first.replaceAll('alice', 'bob').replaceAll('Alice', 'Bob').replaceAll('1234567890123456789', '4564567890123456789');
  const app = await bootSocial({ html: first + second, url: 'https://x.com/explore', setup(window) {
    window.eval(read('content/xDataBridge.js'));
    window.dispatchEvent(new window.MessageEvent('message', { source: window, origin: window.location.origin, data: { type: 'OF_X_PUBLIC_POSTS', posts: [{ postId: '1234567890123456789', username: 'alice', followerCount: 10000 }, { postId: '4564567890123456789', username: 'bob', followerCount: 20000 }] } }));
  } });
  try {
    await app.waitFor(() => [...app.window.OutlierFinder.socialState.results.values()].filter(value => value.payload.state === 'scored').length === 2);
    assert.equal(app.requests.length, 0);
    assert.equal(app.storage['of:channel:x:alice'].data.followerCount, 10000);
    assert.equal(app.storage['of:channel:x:bob'].data.followerCount, 20000);
  } finally { await settle(); app.close(); }
});

test('late timeline counts replace N/A badges and reject mismatched author identities', async () => {
  const app = await bootSocial({ html: read('tests/fixtures/x-posts.html'), url: 'https://x.com/explore', setup(window) { window.eval(read('content/xDataBridge.js')); } });
  const send = posts => app.window.dispatchEvent(new app.window.MessageEvent('message', { source: app.window, origin: app.window.location.origin, data: { type: 'OF_X_PUBLIC_POSTS', posts } }));
  try {
    await app.waitFor(() => [...app.window.OutlierFinder.socialState.results.values()][0]?.payload.state === 'unavailable');
    send([{ postId: '1234567890123456789', username: 'other', followerCount: 1 }]);
    assert.equal(app.window.OutlierFinder.xTimeline.get('1234567890123456789', 'alice'), null);
    send([{ postId: '1234567890123456789', username: 'alice', followerCount: 10000 }]);
    await app.waitFor(() => [...app.window.OutlierFinder.socialState.results.values()][0]?.payload.state === 'scored');
    assert.equal([...app.window.OutlierFinder.socialState.results.values()][0].payload.score, 12);
    await app.waitFor(() => app.storage['of:channel:x:alice']?.data.source === 'public-timeline');
  } finally { await settle(); app.close(); }
});

test('X XHR reader reuses one load listener and leaves open return values unchanged', async () => {
  const app = reader();
  const listeners = [];
  function XHR() { this.status = 200; this.responseType = 'json'; this.response = payload; }
  XHR.prototype.open = function () { return 'original-result'; };
  XHR.prototype.addEventListener = function (type, listener) { listeners.push(listener); };
  app.context.XMLHttpRequest = XHR;
  vm.runInContext('delete window.__ofTimelineReaderVersion', app.context);
  vm.runInContext(read('content/xTimelineReader.js'), app.context);
  app.dispatch({ type: 'OF_X_READER_CONFIG', enabled: true });
  const xhr = new XHR();
  assert.equal(xhr.open('GET', '/i/api/graphql/hash/SearchTimeline'), 'original-result');
  xhr.open('GET', '/i/api/graphql/hash/SearchTimeline');
  assert.equal(listeners.length, 1);
  listeners[0]();
  assert.equal(app.sent.at(-1).posts.length, 2);
  xhr.open('GET', '/i/api/graphql/hash/DmInbox');
  const before = app.sent.length;
  listeners[0]();
  assert.equal(app.sent.length, before);
});

test('a legacy reader boolean does not prevent current reader initialization', () => {
  const app = reader();
  vm.runInContext('window.__ofTimelineReader=true; delete window.__ofTimelineReaderVersion; delete window.__ofTimelineDiagnostics;', app.context);
  vm.runInContext(read('content/xTimelineReader.js'), app.context);
  assert.equal(app.context.__ofTimelineReaderVersion, '1.3.0');
  assert.equal(app.context.__ofTimelineDiagnostics.responses, 0);
  const diagnostics = app.context.__ofTimelineDiagnostics;
  vm.runInContext(read('content/xTimelineReader.js'), app.context);
  assert.equal(app.context.__ofTimelineDiagnostics, diagnostics);
});

test('current X relationship counts work without legacy user fields', async () => {
  const app = reader();
  const makePost = (id, username, relationships, privacy = {}) => ({ rest_id: id, core: { user_results: { result: { __typename: 'User', core: { screen_name: username }, relationship_counts: relationships, privacy } } } });
  app.context.currentPayload = JSON.stringify({ entries: [
    makePost('123', 'alice', { followers: 52800, following: 123 }),
    makePost('456', 'bob', { followers_count: 10000, following_count: 777 }),
    makePost('789', 'carol', { following: 9000 }),
    makePost('901', 'privateuser', { followers: 500 }, { protected: true }),
    makePost('902', 'empty', { followers: 0, following: 555 })
  ] });
  const response = vm.runInContext('({ok:true,url:"https://x.com/i/api/graphql/hash/HomeLatestTimeline",clone:()=>({text:async()=>currentPayload})})', app.context);
  // Install a new reader over a page-provided fetch to exercise response parsing.
  app.context.fetch = () => Promise.resolve(response);
  vm.runInContext('delete window.__ofTimelineReaderVersion', app.context);
  vm.runInContext(read('content/xTimelineReader.js'), app.context);
  app.dispatch({ type: 'OF_X_READER_CONFIG', enabled: true });
  vm.runInContext("fetch('/i/api/graphql/hash/HomeLatestTimeline')", app.context);
  await settle();
  const posts = app.sent.filter(value => value.type === 'OF_X_PUBLIC_POSTS').at(-1).posts;
  assert.deepEqual(JSON.parse(JSON.stringify(posts)), [
    { postId: '902', username: 'empty', followerCount: 0 },
    { postId: '456', username: 'bob', followerCount: 10000 },
    { postId: '123', username: 'alice', followerCount: 52800 }
  ]);
});

test('trending detail pages observe public search timelines', async () => {
  const app = reader();
  app.context.location.pathname = '/i/trending/2119458557858820467';
  app.dispatch({ type: 'OF_X_READER_CONFIG', enabled: true });
  vm.runInContext("fetch('/i/api/graphql/hash/SearchTimeline')", app.context);
  await settle();
  assert.equal(app.context.__ofTimelineDiagnostics.authorRecords, 2);
});

test('trending detail post cards score inside role=main containers', async () => {
  const html = read('tests/fixtures/x-posts.html').replace('<main>', '<div role="main">').replace('</main>', '</div>');
  const app = await bootSocial({ html, url: 'https://x.com/i/trending/2119458557858820467', setup(window) {
    window.eval(read('content/xDataBridge.js'));
    window.dispatchEvent(new window.MessageEvent('message', { source: window, origin: window.location.origin, data: { type: 'OF_X_PUBLIC_POSTS', posts: [{ postId: '1234567890123456789', username: 'alice', followerCount: 10000 }] } }));
  } });
  try {
    await app.waitFor(() => [...app.window.OutlierFinder.socialState.results.values()][0]?.payload.state === 'scored');
    assert.equal([...app.window.OutlierFinder.socialState.results.values()][0].payload.score, 12);
    assert.equal(app.window.document.querySelectorAll('.of-badge').length, 1);
    assert.equal(app.requests.length, 0);
  } finally { await settle(); app.close(); }
});

test('actual trending operations supply author counts on public trend detail pages', async () => {
  for (const operation of ['GenericTimelineById', 'AiTrendByRestId']) {
    const app = reader();
    app.context.location.pathname = '/i/trending/2119458557858820467';
    app.dispatch({ type: 'OF_X_READER_CONFIG', enabled: true });
    app.context.operation = operation;
    vm.runInContext("fetch('/i/api/graphql/hash/' + operation)", app.context);
    await settle();
    assert.equal(app.context.__ofTimelineDiagnostics.matchingRequests, 1, operation);
    assert.equal(app.context.__ofTimelineDiagnostics.responses, 1, operation);
    assert.equal(app.context.__ofTimelineDiagnostics.authorRecords, 2, operation);
  }
});

test('trend-specific operations are excluded on messaging and unrelated pages', async () => {
  for (const pathname of ['/messages', '/i/chat/123', '/home']) {
    const app = reader();
    app.context.location.pathname = pathname;
    app.dispatch({ type: 'OF_X_READER_CONFIG', enabled: true });
    vm.runInContext("fetch('/i/api/graphql/hash/GenericTimelineById')", app.context);
    vm.runInContext("fetch('/i/api/graphql/hash/AiTrendByRestId')", app.context);
    await settle();
    assert.equal(app.context.__ofTimelineDiagnostics.matchingRequests, 0, pathname);
    assert.equal(app.context.__ofTimelineDiagnostics.authorRecords, 0, pathname);
  }
});

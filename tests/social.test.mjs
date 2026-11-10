import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { read, bootSocial, openSocialPopup } from './helpers/socialApp.mjs';

const xHtml = read('tests/fixtures/x-posts.html');
const igHtml = read('tests/fixtures/instagram-posts.html');
const profile = (platform, username = 'alice', count = 10000) => ({
  ['of:channel:' + platform + ':' + username]: { data: { platform, username, followerCount: count, approximate: false }, expiresAt: Date.now() + 60000 }
});
const result = (app) => [...app.window.OutlierFinder.socialState.results.values()][0]?.payload;

function socialCore() {
  const context = vm.createContext({ URL });
  for (const file of ['core/settings.js', 'core/dataValidator.js', 'core/outlierCalculator.js', 'core/classification.js', 'core/social.js']) vm.runInContext(read(file), context);
  return context.OutlierFinder;
}

test('social identifiers are canonical, platform-scoped, and reject unrelated URLs', () => {
  const { social: S } = socialCore();
  assert.equal(S.postRef('https://twitter.com/Alice/status/123', 'x').videoId, 'x:123');
  assert.equal(S.postRef('https://www.instagram.com/p/AbC_123/', 'instagram').videoId, 'instagram:AbC_123');
  assert.equal(S.profileRef('x', 'ALICE').key, 'x:alice');
  assert.equal(S.profileRef('instagram', 'alice').key, 'instagram:alice');
  assert.equal(S.profileFromUrl(undefined, 'x'), null);
  assert.equal(S.profileRef('x', '../home'), null);
  assert.equal(S.profileRef('instagram', 'direct'), null);
  assert.equal(S.postRef('https://evil.example/alice/status/123', 'x'), null);
});

test('view and likes ratios keep distinct units and thresholds', () => {
  const OF = socialCore(), settings = OF.settings.normalizeSettings({});
  const views = OF.social.evaluatePost({ views: 120000, likes: 500 }, { followerCount: 10000 }, settings);
  assert.equal(views.metric, 'views'); assert.equal(views.scoreText, '12x'); assert.equal(views.eligible, true);
  const likes = OF.social.evaluatePost({ views: null, likes: 500 }, { followerCount: 10000 }, settings);
  assert.equal(likes.metric, 'likes'); assert.equal(likes.scoreText, '5%'); assert.equal(likes.eligible, true);
  assert.equal(OF.social.evaluatePost({ views: null, likes: 500 }, { followerCount: 10000 }, { ...settings, socialLikeFallback: false }).score, null);
  assert.equal(OF.social.evaluatePost({ views: 1, likes: null }, { followerCount: 10000 }, settings).scoreText, '<0.001x');
  assert.equal(OF.social.evaluatePost({ views: null, likes: 1 }, { followerCount: 10000 }, settings).scoreText, '0.01%');
  assert.equal(OF.social.evaluatePost({ views: 0, likes: 500 }, { followerCount: 10000 }, settings).scoreText, '0x');
  assert.equal(OF.social.evaluatePost({ views: 1, likes: 500 }, { followerCount: 0 }, settings).score, null);
});

test('X post cards show views/followers and ignore quoted-post metrics', async () => {
  const app = await bootSocial({ html: xHtml, stored: profile('x') });
  try {
    await app.waitFor(() => result(app)?.state === 'scored');
    assert.equal(result(app).score, 12);
    assert.equal(app.window.document.querySelectorAll('.of-badge').length, 1);
    assert.equal(app.window.document.querySelector('.of-badge__score').textContent, '12x');
    assert.equal(app.window.document.querySelector('.of-badge__label').textContent, 'VIRAL');
    assert.equal(app.window.document.querySelector('.of-badge').closest('a'), null);
    assert.equal(app.requests.length, 0);
    const stats = (await app.message('OF_GET_STATS')).stats;
    assert.equal(stats.platform, 'x'); assert.equal(stats.scanned, 1);
  } finally { app.close(); }
});

test('Instagram photos show labeled likes engagement and ignore captions and comment likes', async () => {
  const app = await bootSocial({ html: igHtml, url: 'https://www.instagram.com/', stored: profile('instagram') });
  try {
    await app.waitFor(() => result(app)?.state === 'scored');
    assert.equal(result(app).metric, 'likes'); assert.equal(result(app).scoreText, '5%');
    assert.equal(app.window.document.querySelector('.of-badge').textContent, '5%ENGAGEMENT');
    app.window.document.querySelector('.of-badge').click();
    const panel = app.window.document.querySelector('.of-panel');
    assert.ok(panel.textContent.includes('Followers')); assert.ok(panel.textContent.includes('Likes'));
    assert.equal(panel.querySelector('a').textContent, 'Open on Instagram');
    assert.equal(panel.querySelector('a').href, 'https://www.instagram.com/p/AbCd_123/');
  } finally { app.close(); }
});

test('Instagram prefers public views when available, including zero', async () => {
  const app = await bootSocial({ html: igHtml.replace('500 likes', '0 views'), url: 'https://www.instagram.com/', stored: profile('instagram') });
  try {
    await app.waitFor(() => result(app)?.state === 'scored');
    assert.equal(result(app).metric, 'views'); assert.equal(result(app).score, 0);
    assert.equal(app.window.document.querySelector('.of-badge').textContent, '0xSCORE');
  } finally { app.close(); }
});

test('hidden metrics stay unavailable and never trigger a profile request', async () => {
  const html = igHtml.replace('500 likes', 'Liked by alice and others');
  const app = await bootSocial({ html, url: 'https://www.instagram.com/' });
  try {
    await app.waitFor(() => result(app)?.state === 'unavailable');
    assert.equal(result(app).score, null);
    assert.equal(app.requests.filter((request) => !new URL(request.url).pathname.startsWith('/p/')).length, 0);
    assert.equal(app.requests.length, 1);
    assert.equal(app.window.document.querySelector('.of-badge').textContent, 'SCORE N/A');
  } finally { app.close(); }
});

test('public profile requests omit cookies and accept only the requested creator', async () => {
  const profileHtml = '<meta property="og:url" content="https://x.com/alice"><meta name="description" content="10K Followers, 12 Following">';
  const app = await bootSocial({ html: xHtml, profileHtml });
  try {
    await app.waitFor(() => result(app)?.state === 'scored');
    assert.equal(result(app).score, 12); assert.equal(app.requests.length, 1);
    assert.equal(app.requests[0].url, 'https://x.com/alice'); assert.equal(app.requests[0].credentials, 'omit');
    assert.equal(app.storage['of:channel:x:alice'].data.followerCount, 10000);
  } finally { app.close(); }
});

test('an observed hovercard follower count recovers a failed public lookup', async () => {
  const app = await bootSocial({ html: xHtml });
  try {
    await app.waitFor(() => result(app)?.state === 'unavailable');
    const hover = app.window.document.createElement('aside');
    hover.dataset.testid = 'HoverCard';
    hover.innerHTML = '<a href="/alice/followers"><span title="10000">10K</span> Followers</a>';
    app.window.document.body.appendChild(hover);
    await app.waitFor(() => result(app)?.state === 'scored');
    assert.equal(result(app).score, 12); assert.equal(app.requests.length, 1);
  } finally { app.close(); }
});

test('likes-only mode can be disabled in settings', async () => {
  const app = await bootSocial({ html: igHtml, url: 'https://www.instagram.com/', settings: { socialLikeFallback: false }, stored: profile('instagram') });
  try {
    await app.waitFor(() => result(app)?.state === 'unavailable');
    assert.equal(result(app).score, null);
    assert.equal(app.requests.filter((request) => !new URL(request.url).pathname.startsWith('/p/')).length, 0);
    assert.equal(app.requests.length, 1);
  } finally { app.close(); }
});

test('X and Instagram direct-message surfaces are never scanned', async () => {
  for (const [url, html] of [['https://x.com/messages/123', xHtml], ['https://www.instagram.com/direct/inbox/', igHtml]]) {
    const app = await bootSocial({ html, url });
    try {
      await app.waitFor(() => app.window.OutlierFinder.socialState.observer?.running);
      app.window.OutlierFinder.socialState.observer.scan();
      assert.equal(app.window.OutlierFinder.socialState.results.size, 0); assert.equal(app.requests.length, 0);
      assert.equal(app.window.document.querySelector('.of-badge'), null);
    } finally { app.close(); }
  }
});

test('live metric changes update a social badge without duplicates', async () => {
  const app = await bootSocial({ html: xHtml, stored: profile('x') });
  try {
    await app.waitFor(() => result(app)?.state === 'scored');
    const metric = app.window.document.querySelector('a[href*="alice/status"][href*="analytics"]');
    metric.setAttribute('aria-label', '240000 views'); metric.textContent = '240K';
    await app.waitFor(() => result(app)?.score === 24);
    assert.equal(app.window.document.querySelectorAll('.of-badge').length, 1);
  } finally { app.close(); }
});

test('a popup on X shows social stats and platform-aware links', async () => {
  const app = await bootSocial({ html: xHtml, stored: profile('x') });
  let popup;
  try {
    await app.waitFor(() => result(app)?.state === 'scored');
    popup = await openSocialPopup(app, 'https://x.com/home');
    await app.waitFor(() => popup.window.document.querySelector('#ofp-subtitle').textContent.includes('Connected to X'));
    assert.equal(popup.window.document.querySelector('#ofp-scanned').textContent, '1');
    assert.equal(popup.window.document.querySelector('.ofp-card').href, 'https://x.com/alice/status/1234567890123456789');
    const filter = popup.window.document.querySelector('#ofp-platform');
    filter.value = 'instagram'; filter.dispatchEvent(new popup.window.Event('change'));
    assert.equal(popup.window.document.querySelectorAll('.ofp-card').length, 0);
  } finally { popup?.window.close(); app.close(); }
});

test('public profile parsing rejects mismatched identities and private-account data', () => {
  const context = vm.createContext({ URL });
  for (const file of ['core/dataValidator.js', 'core/social.js', 'background/socialFetcher.js']) vm.runInContext(read(file), context);
  const OF = context.OutlierFinder, ref = OF.social.profileRef('instagram', 'alice');
  const meta = '<meta property="og:url" content="https://www.instagram.com/alice/"><meta property="og:description" content="10K Followers, 5 Following, 30 Posts">';
  assert.equal(OF.parseSocialProfileHtml(meta, ref).followerCount, 10000);
  assert.equal(OF.parseSocialProfileHtml(meta.replace('/alice/', '/bob/'), ref), null);
  const data = { users: [{ username: 'bob', follower_count: 9000000 }, { username: 'alice', follower_count: 12345 }] };
  assert.equal(OF.parseSocialProfileHtml('<script type="application/json">' + JSON.stringify(data) + '</script>', ref).followerCount, 12345);
  data.users[1].is_private = true;
  assert.equal(OF.parseSocialProfileHtml('<script type="application/json">' + JSON.stringify(data) + '</script>', ref), null);
  assert.equal(OF.parseSocialProfileHtml('<meta property="og:title" content="@alice_wrong"><meta name="description" content="9M Followers">', ref), null);
});

test('an Instagram profile grid uses its own follower count and gives each tile a distinct badge', async () => {
  const html = '<main><header><ul><li><span title="10000">10K</span> followers</li></ul></header><div>' +
    '<div><a href="/reel/AbC_123/"><img src="https://example.com/one.jpg"><span aria-label="100000 views">100K</span></a></div>' +
    '<div><a href="/reel/DeF_456/"><img src="https://example.com/two.jpg"><span aria-label="200000 views">200K</span></a></div></div></main>';
  const app = await bootSocial({ html, url: 'https://www.instagram.com/alice/' });
  try {
    await app.waitFor(() => app.window.document.querySelectorAll('.of-badge--scored').length === 2);
    assert.deepEqual([...app.window.document.querySelectorAll('.of-badge__score')].map((node) => node.textContent).sort(), ['10x', '20x']);
    assert.equal(app.requests.length, 0);
    for (const badge of app.window.document.querySelectorAll('.of-badge')) assert.equal(badge.closest('a'), null);
  } finally { app.close(); }
});

test('likes engagement is excluded from x-multiplier filters and can be saved', async () => {
  const app = await bootSocial({ html: igHtml, url: 'https://www.instagram.com/', stored: profile('instagram') });
  let popup;
  try {
    await app.waitFor(() => result(app)?.state === 'scored');
    app.window.document.querySelector('.of-badge').click();
    const save = [...app.window.document.querySelectorAll('.of-panel__btn')].find((node) => node.textContent === 'Save for later');
    save.click();
    await app.waitFor(() => app.storage['of:savedVideos']?.length === 1);
    assert.equal(app.storage['of:savedVideos'][0].metric, 'likes');
    assert.equal(app.storage['of:savedVideos'][0].scoreText, '5%');
    popup = await openSocialPopup(app, 'https://www.instagram.com/');
    await app.waitFor(() => popup.window.document.querySelector('.ofp-card'));
    assert.equal(popup.window.document.querySelector('.ofp-card-score').textContent, '5%');
    popup.window.document.querySelector('[data-filter="5"]').click();
    assert.equal(popup.window.document.querySelectorAll('.ofp-card').length, 0);
    popup.window.document.querySelector('[data-filter="all"]').click();
    const filter = popup.window.document.querySelector('#ofp-metric');
    filter.value = 'likes'; filter.dispatchEvent(new popup.window.Event('change'));
    assert.equal(popup.window.document.querySelectorAll('.ofp-card').length, 1);
  } finally { popup?.window.close(); app.close(); }
});

test('turning off one social platform removes its badges immediately', async () => {
  const app = await bootSocial({ html: xHtml, stored: profile('x') });
  try {
    await app.waitFor(() => result(app)?.state === 'scored');
    await new Promise((resolve) => app.chrome.storage.local.set({ settings: { xEnabled: false, instagramEnabled: true } }, resolve));
    assert.equal(app.window.document.querySelector('.of-badge'), null);
    assert.equal((await app.message('OF_GET_STATS')).stats.enabled, false);
  } finally { app.close(); }
});

test('navigation into messages removes existing badges without reading message content', async () => {
  const app = await bootSocial({ html: xHtml, stored: profile('x') });
  try {
    await app.waitFor(() => result(app)?.state === 'scored');
    app.window.history.pushState({}, '', '/messages/123');
    app.window.OutlierFinder.socialState.observer.scan();
    assert.equal(app.window.document.querySelector('.of-badge'), null);
    assert.equal((await app.message('OF_GET_STATS')).stats.enabled, false);
  } finally { app.close(); }
});

test('follower caches do not collide between X and Instagram', async () => {
  const app = await bootSocial({ html: igHtml, url: 'https://www.instagram.com/', stored: { ...profile('x', 'alice', 100), ...profile('instagram', 'alice', 20000) } });
  try {
    await app.waitFor(() => result(app)?.state === 'scored');
    assert.equal(result(app).scoreText, '2.5%'); assert.equal(result(app).followerCount, 20000);
  } finally { app.close(); }
});

test('social settings persist through the options page without resetting platform switches', async () => {
  const { JSDOM } = await import('jsdom');
  const app = await bootSocial({ html: xHtml, settings: { xEnabled: false, instagramEnabled: true, socialLikeFallback: false } });
  const page = new JSDOM(read('options/options.html'), { url: 'chrome-extension://fixture/options/options.html', runScripts: 'outside-only' });
  try {
    page.window.chrome = app.chrome;
    page.window.eval(read('core/settings.js')); page.window.eval(read('options/options.js'));
    await app.waitFor(() => page.window.document.querySelector('#ofo-socialMinLikes').value !== '');
    assert.equal(page.window.document.querySelector('#ofo-xEnabled').checked, false);
    page.window.document.querySelector('#ofo-socialMinLikes').value = '250';
    page.window.document.querySelector('#ofo-socialMinEngagementPercent').value = '4';
    page.window.document.querySelector('#ofo-form').dispatchEvent(new page.window.Event('submit', { cancelable: true }));
    await app.waitFor(() => app.storage.settings.socialMinLikes === 250);
    assert.equal(app.storage.settings.xEnabled, false); assert.equal(app.storage.settings.instagramEnabled, true);
    assert.equal(app.storage.settings.socialLikeFallback, false); assert.equal(app.storage.settings.socialMinEngagementPercent, 4);
    assert.equal(app.window.OutlierFinder.socialState.observer.running, false);
  } finally { page.window.close(); app.close(); }
});

test('unavailable follower panels link to the creator profile instead of inventing a score', async () => {
  const app = await bootSocial({ html: xHtml });
  try {
    await app.waitFor(() => result(app)?.state === 'unavailable');
    app.window.document.querySelector('.of-badge').click();
    const link = [...app.window.document.querySelectorAll('.of-panel a')].find((node) => node.textContent === 'Open creator profile');
    assert.equal(link.href, 'https://x.com/alice'); assert.equal(result(app).score, null);
  } finally { app.close(); }
});

test('creator-prefixed Instagram permalinks use the same canonical post key', () => {
  const { social: S } = socialCore();
  const short = S.postRef('https://www.instagram.com/reel/AbC_123/', 'instagram');
  const prefixed = S.postRef('https://www.instagram.com/ggrockz/reel/AbC_123/?hl=en', 'instagram');
  assert.equal(prefixed.videoId, short.videoId); assert.equal(prefixed.videoUrl, short.videoUrl);
  assert.equal(prefixed.profile, null, 'the URL username alone is not treated as a verified owner');
  assert.equal(S.postRef('https://www.instagram.com/accounts/reel/AbC_123/', 'instagram'), null);
  assert.equal(S.postRef('https://www.youtube.com/reel/AbC_123/', 'youtube'), null);
});

test('an Instagram feed Reel with a deep bare like counter and untagged author row receives its own badge', async () => {
  const html = '<div role="main"><article id="ggrockz-post"><div><a href="/ggrockz/">ggrockz</a>' +
    '<a href="/ggrockz/reel/FeedABC123/"><time>18h</time></a></div><video></video>' +
    '<div class="actions"><div class="likes">' + '<div>'.repeat(6) + '<svg aria-label="Like"></svg>' + '</div>'.repeat(6) + '<span>51.5K</span></div>' +
    '<div><svg aria-label="Comment"></svg><span>355</span></div><div><svg aria-label="Share"></svg><span>69K</span></div></div>' +
    '<p>ggrockz caption</p><ul><li><a href="/commenter/">commenter</a><span>999 likes</span></li></ul></article></div>';
  const app = await bootSocial({ html, url: 'https://www.instagram.com/', stored: profile('instagram', 'ggrockz', 1000000) });
  try {
    await app.waitFor(() => result(app)?.state === 'scored');
    assert.equal(result(app).scoreText, '5.15%'); assert.equal(result(app).metricCount, 51500);
    const card = app.window.document.querySelector('#ggrockz-post');
    assert.ok(card.firstElementChild.classList.contains('of-badge'));
    assert.equal(card.querySelectorAll('.of-badge').length, 1); assert.equal(app.requests.length, 0);
  } finally { app.close(); }
});

test('a removed feed badge is restored from its cached score without reading a different post', async () => {
  const app = await bootSocial({ html: igHtml, url: 'https://www.instagram.com/', stored: profile('instagram') });
  try {
    await app.waitFor(() => app.window.document.querySelector('.of-badge--scored'));
    const old = app.window.document.querySelector('.of-badge'); old.remove();
    await app.waitFor(() => app.window.document.querySelector('.of-badge--scored') && app.window.document.querySelector('.of-badge') !== old);
    assert.equal(app.window.document.querySelector('.of-badge').textContent, '5%ENGAGEMENT');
    assert.equal(app.window.document.querySelectorAll('.of-badge').length, 1); assert.equal(app.requests.length, 0);
    await new Promise((resolve) => app.chrome.storage.local.set({ settings: { badgeVisible: false } }, resolve));
    app.window.OutlierFinder.socialState.observer.scan();
    assert.equal(app.window.document.querySelector('.of-badge'), null, 'an intentionally hidden badge is not repaired');
  } finally { app.close(); }
});

test('X recovers from a blocked public profile using an explicitly entered follower count', async () => {
  const app = await bootSocial({ html: xHtml });
  try {
    await app.waitFor(() => result(app)?.state === 'unavailable');
    app.window.document.querySelector('.of-badge').click();
    const input = app.window.document.querySelector('input[aria-label="Creator follower count"]');
    assert.ok(input);
    input.value = '10000';
    input.closest('form').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
    await app.waitFor(() => result(app)?.state === 'scored');
    assert.equal(result(app).score, 12);
    assert.equal(app.storage['of:channel:x:alice'].data.source, 'user-entered');
    assert.equal(app.storage['of:channel:x:alice'].data.approximate, true);
  } finally { app.close(); }
});

test('X reads matching creator counts from initial page state without executing scripts', async () => {
  const state = { entities: { users: { a: { screen_name: 'alice', followers_count: 10000 }, b: { screen_name: 'other', followers_count: 1 } } } };
  const app = await bootSocial({ html: xHtml + '<script>window.__INITIAL_STATE__=' + JSON.stringify(state) + ';window.mustNotExecute=true;</script>' });
  try {
    await app.waitFor(() => result(app)?.state === 'scored');
    assert.equal(result(app).score, 12);
    assert.equal(app.window.mustNotExecute, undefined);
    assert.equal(app.storage['of:channel:x:other'], undefined);
  } finally { app.close(); }
});

test('X state parser handles split core and legacy user fields and rejects malformed scripts', () => {
  const S = socialCore().social;
  const entries = S.xProfilesFromScript(JSON.stringify({ user: { core: { screen_name: 'alice' }, legacy: { followers_count: 10000 } } }));
  assert.equal(entries[0].ref.key, 'x:alice');
  assert.equal(entries[0].followerCount, 10000);
  assert.equal(S.xProfilesFromScript('window.__INITIAL_STATE__=alert(1)').length, 0);
  assert.equal(S.xProfilesFromScript('{"screen_name":"alice","followers_count":100,"protected":true}').length, 0);
});

test('missing X followers preserves readable metrics and uses the social formula', async () => {
  const app = await bootSocial({ html: xHtml });
  try {
    await app.waitFor(() => result(app)?.state === 'unavailable');
    app.window.document.querySelector('.of-badge').click();
    const panel = app.window.document.querySelector('.of-panel');
    assert.match(panel.textContent, /120K/);
    assert.match(panel.textContent, /Post views ÷ creator followers/);
    assert.doesNotMatch(panel.textContent, /channel subscribers/);
  } finally { app.close(); }
});

test('X follower hovercards nested in articles recover unavailable scores', async () => {
  const app = await bootSocial({ html: xHtml });
  try {
    await app.waitFor(() => result(app)?.state === 'unavailable');
    const hover = app.window.document.createElement('div');
    hover.dataset.testid = 'HoverCard';
    hover.innerHTML = '<a href="/alice/verified_followers"><span title="10000">10K</span> Followers</a>';
    app.window.document.querySelector('article').appendChild(hover);
    await app.waitFor(() => result(app)?.state === 'scored');
    assert.equal(result(app).score, 12);
  } finally { app.close(); }
});

test('actual X nested 52.8K follower markup is cached only for its matching creator', async () => {
  const html = xHtml.replaceAll('alice', 'wojakcodes').replaceAll('Alice', 'wojakcodes') + '<a href="/wojakcodes/verified_followers" dir="ltr" role="link"><span><span>52.8K</span></span> <span><span>Followers</span></span></a><a href="/wojakcodes/followers_you_follow" aria-label="Followers you know">Followed by someone and 5 others you follow</a>';
  const app = await bootSocial({ html, url: 'https://x.com/wojakcodes' });
  try {
    await app.waitFor(() => result(app)?.state === 'scored');
    assert.equal(app.storage['of:channel:x:wojakcodes'].data.followerCount, 52800);
    assert.equal(app.storage['of:channel:x:wojakcodes'].data.approximate, true);
    assert.equal(result(app).subscriberCount, 52800);
    assert.equal(app.storage['of:channel:x:alice'], undefined);
  } finally { app.close(); }
});

test('X embedded users with relationship counts preserve creator identity', () => {
  const S = socialCore().social;
  const entries = S.xProfilesFromScript(JSON.stringify({ users: [
    { core: { screen_name: 'alice' }, relationship_counts: { followers: 52800, following: 10 } },
    { core: { screen_name: 'bob' }, relationship_counts: { following: 9000 } },
    { core: { screen_name: 'privateuser' }, relationship_counts: { followers: 50 }, privacy: { protected: true } }
  ] }));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].ref.key, 'x:alice');
  assert.equal(entries[0].followerCount, 52800);
});

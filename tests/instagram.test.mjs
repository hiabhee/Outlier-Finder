import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { read, bootSocial } from './helpers/socialApp.mjs';
const bare = read('tests/fixtures/instagram-bare-grid.html');
const id = 'DfMeFsVIPp7';
const result = (app) => [...app.window.OutlierFinder.socialState.results.values()][0]?.payload;
const media = () => ({ code: id, play_count: 120000, like_count: 500, user: { username: 'alice', follower_count: 10000, is_private: false } });
const htmlFor = (value) => '<html><script type="application/json">' + JSON.stringify(value) + '</script></html>';

function parser() {
  const context = vm.createContext({ URL });
  for (const file of ['core/dataValidator.js', 'core/social.js', 'core/instagram.js']) vm.runInContext(read(file), context);
  return context.OutlierFinder.instagram;
}

test('Instagram metadata is matched to the requested shortcode, never recommendations', () => {
  const I = parser();
  const data = { items: [media(), { code: 'Other123', play_count: 999999999, user: { username: 'wrong', follower_count: 1 } }] };
  const post = I.parsePostHtml(htmlFor(data), id);
  assert.equal(post.views, 120000); assert.equal(post.profile.username, 'alice'); assert.equal(post.profile.followerCount, 10000);
  assert.equal(I.parsePostHtml(htmlFor(data), 'Missing123'), null);
  assert.equal(I.parsePostHtml(htmlFor(data), '../foo'), null);
});

test('hidden or private post metadata never supplies counts', () => {
  const I = parser();
  const hidden = { ...media(), like_and_view_counts_disabled: true };
  const post = I.parsePostHtml(htmlFor(hidden), id);
  assert.equal(post.hidden, true); assert.equal(post.likes, null); assert.equal(post.views, null);
  const privatePost = media(); privatePost.user.is_private = true;
  assert.equal(I.parsePostHtml(htmlFor(privatePost), id).restricted, true);
});

test('structured WatchAction and LikeAction counts work without Instagram CSS classes', () => {
  const value = { '@type': 'VideoObject', url: 'https://www.instagram.com/reel/' + id + '/',
    author: { '@type': 'Person', url: 'https://www.instagram.com/alice/' },
    interactionStatistic: [{ interactionType: 'https://schema.org/WatchAction', userInteractionCount: '420000' }, { interactionType: { '@type': 'LikeAction' }, userInteractionCount: 1234 }, { interactionType: 'CommentAction', userInteractionCount: 999999 }] };
  const post = parser().parsePostHtml(htmlFor(value), id);
  assert.equal(post.views, 420000); assert.equal(post.likes, 1234); assert.equal(post.profile.username, 'alice');
});

test('public description reads only the count prefix and validates canonical post identity', () => {
  const html = '<meta property="og:url" content="https://www.instagram.com/p/' + id + '/"><meta property="og:description" content="500 likes, 12 comments - alice on October 10, 2026: &quot;My plan for 9M views&quot;">';
  const post = parser().parsePostHtml(html, id);
  assert.equal(post.likes, 500); assert.equal(post.views, null); assert.equal(post.profile.username, 'alice');
  assert.equal(parser().parsePostHtml(html.replace(id, 'Wrong123'), id), null);
});

test('the supplied bare tile gets a score from rendered-page media metadata without network requests', async () => {
  const html = bare.replace('</body>', '<script type="application/json">' + JSON.stringify({ data: { items: [media()] } }) + '</script></body>');
  const app = await bootSocial({ html, url: 'https://www.instagram.com/alice/reels/' });
  try {
    await app.waitFor(() => result(app)?.state === 'scored');
    assert.equal(result(app).score, 12); assert.equal(app.requests.length, 0);
    assert.equal(app.window.document.querySelector('.of-badge').textContent, '12xVIRAL');
  } finally { app.close(); }
});

test('a bare tile falls back to a public post request, caches it, and preserves author association', async () => {
  const app = await bootSocial({ html: bare, url: 'https://www.instagram.com/explore/', postHtml: htmlFor({ items: [media()] }) });
  try {
    await app.waitFor(() => result(app)?.state === 'scored');
    assert.equal(result(app).score, 12); assert.equal(app.requests.length, 1);
    assert.equal(app.requests[0].url, 'https://www.instagram.com/p/' + id + '/');
    assert.equal(app.requests[0].credentials, 'omit');
    const response = await new Promise((resolve) => app.chrome.runtime.sendMessage({ type: 'GET_INSTAGRAM_POST', postId: id }, resolve));
    assert.equal(response.cached, true); assert.equal(response.post.profile.username, 'alice');
    assert.equal(app.requests.length, 1);
  } finally { app.close(); }
});

test('bare tiles stay unavailable if the public page redirects to login', async () => {
  const app = await bootSocial({ html: bare, url: 'https://www.instagram.com/alice/', postHtml: htmlFor(media()), responseUrl: 'https://www.instagram.com/accounts/login/' });
  try {
    await app.waitFor(() => result(app)?.state === 'unavailable');
    assert.equal(result(app).score, null); assert.equal(app.requests.length, 1);
    const response = await new Promise((resolve) => app.chrome.runtime.sendMessage({ type: 'GET_INSTAGRAM_POST', postId: id }, resolve));
    assert.equal(response.cachedFailure, true); assert.equal(app.requests.length, 1);
  } finally { app.close(); }
});

test('counter-free markup is not mistaken for zero, likes, or a Reel-icon count', async () => {
  const app = await bootSocial({ html: bare, url: 'https://www.instagram.com/alice/' });
  try {
    await app.waitFor(() => result(app)?.state === 'unavailable');
    assert.match(result(app).reason, /no readable counts/);
    assert.equal(result(app).score, null);
  } finally { app.close(); }
});

test('hover-rendered labeled metrics recover a tile even after a failed metadata request', async () => {
  const stored = { 'of:channel:instagram:alice': { data: { followerCount: 10000 }, expiresAt: Date.now() + 60000 } };
  const app = await bootSocial({ html: bare, url: 'https://www.instagram.com/alice/reels/', stored });
  try {
    await app.waitFor(() => result(app)?.state === 'unavailable');
    const overlay = app.window.document.createElement('ul');
    overlay.innerHTML = '<li><span aria-label="500 likes">500</span></li><li>10 comments</li>';
    app.window.document.querySelector('a[href*="/p/"]').appendChild(overlay);
    await app.waitFor(() => result(app)?.state === 'scored');
    assert.equal(result(app).metric, 'likes'); assert.equal(result(app).scoreText, '5%');
    assert.equal(app.requests.length, 1);
  } finally { app.close(); }
});

test('displayed profile followers take precedence over an older embedded owner count', async () => {
  const header = '<header><ul><li><span title="20000">20K</span> followers</li></ul></header>';
  const html = bare.replace('<main>', '<main>' + header).replace('</body>', '<script type="application/json">' + JSON.stringify({ items: [media()] }) + '</script></body>');
  const app = await bootSocial({ html, url: 'https://www.instagram.com/alice/reels/' });
  try {
    await app.waitFor(() => result(app)?.state === 'scored' && result(app)?.followerCount === 20000);
    assert.equal(result(app).score, 6); assert.equal(app.requests.length, 0);
  } finally { app.close(); }
});

test('owner-only metadata can complete a card whose displayed views are already known', async () => {
  const html = bare.replace('</a></div>', '<span aria-label="120000 views">120K</span></a></div>');
  const postHtml = htmlFor({ code: id, owner: { username: 'alice', follower_count: 10000 } });
  const app = await bootSocial({ html, url: 'https://www.instagram.com/explore/', postHtml });
  try {
    await app.waitFor(() => result(app)?.state === 'scored');
    assert.equal(result(app).score, 12); assert.equal(app.requests.length, 1);
  } finally { app.close(); }
});

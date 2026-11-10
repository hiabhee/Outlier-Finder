import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function fixture() {
  const card = { dataset: {}, isConnected: true, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, bottom: 100, left: 0, right: 100 }) };
  let video = { videoId: 'dQw4w9WgXcQ', views: null, channel: null };
  const processed = [];
  const context = vm.createContext({
    setTimeout, clearTimeout, console,
    document: {},
    OutlierFinder: { extractor: {
      findVideoCards: () => [card],
      getCardVideoId: () => ({ videoId: video.videoId }),
      extractVideoCard: () => ({ ...video, cardElement: card })
    } }
  });
  vm.runInContext(fs.readFileSync(new URL('../content/observer.js', import.meta.url), 'utf8'), context);
  const observer = new context.OutlierFinder.VideoObserver({ onVideo: (item) => processed.push(item) });
  observer.running = true;
  return { observer, processed, card, update: (value) => { video = value; } };
}

test('partially loaded cards are retried once metadata appears', () => {
  const f = fixture();
  f.observer.scan();
  assert.equal(f.processed[0].views, null);
  f.update({ videoId: 'dQw4w9WgXcQ', views: 420000, channel: { url: '/@creator' } });
  f.observer.scan();
  f.observer.scan();
  assert.equal(f.processed.length, 2);
  assert.equal(f.processed[1].views, 420000);
});

test('a recycled card is processed with its new video identity', () => {
  const f = fixture();
  f.update({ videoId: 'dQw4w9WgXcQ', views: 420000, channel: { url: '/@creator' } });
  f.observer.scan();
  f.update({ videoId: 'abcdefghijk', views: 9000, channel: { url: '/@other' } });
  f.observer.scan();
  assert.equal(f.processed.length, 2);
  assert.equal(f.processed[1].videoId, 'abcdefghijk');
  assert.equal(f.card.dataset.ofVideoId, 'abcdefghijk');
});

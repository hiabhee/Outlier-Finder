import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function load(context, file) {
  vm.runInContext(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), context);
}

test('compact YouTube cards expose views and publication age', () => {
  const context = vm.createContext({ URL });
  load(context, 'core/dataValidator.js');
  load(context, 'content/videoExtractor.js');
  const anchor = { getAttribute: (name) => name === 'href' ? '/watch?v=dQw4w9WgXcQ' : '' };
  const metadata = { textContent: '1.1M 2mo ago' };
  const card = {
    querySelectorAll: (selector) => selector === "a[href*='/watch']" ? [anchor] :
      selector === '.yt-content-metadata-view-model__metadata-text' ? [metadata] : [],
    querySelector: () => null,
    hasAttribute: () => false
  };
  const video = context.OutlierFinder.extractor.extractVideoCard(card);
  assert.equal(video.views, 1100000);
  assert.equal(video.ageDays, 60);
});

test('score visibility includes below-threshold videos without inventing missing scores', () => {
  const context = vm.createContext({ URL });
  for (const file of ['core/settings.js', 'core/dataValidator.js', 'core/outlierCalculator.js', 'core/classification.js']) load(context, file);
  const OF = context.OutlierFinder;
  const settings = OF.settings.normalizeSettings({});
  const source = fs.readFileSync(new URL('../content/content.js', import.meta.url), 'utf8');
  const decide = source.slice(source.indexOf('  function decideDisplay'), source.indexOf('  function buildPayload'));
  vm.runInContext(decide + '\nglobalThis.checkDisplay = decideDisplay;', context);
  const classification = OF.classification.classifyOutlier(0.5, 1100000, settings);
  const payload = { score: 0.5, views: 1100000, eligible: false };
  assert.equal(settings.showAllScores, true);
  assert.equal(context.checkDisplay(classification, payload, settings), true);
  assert.equal(context.checkDisplay(classification, payload, { ...settings, showAllScores: false }), false);
  assert.equal(context.checkDisplay(classification, { score: null }, settings), false);
  assert.equal(context.checkDisplay(classification, payload, { ...settings, badgeVisible: false }), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function load(relativePath) {
  const filename = path.join(__dirname, "..", relativePath);
  const code = fs.readFileSync(filename, "utf8");
  vm.runInThisContext(code, { filename });
}

load("core/settings.js");
load("core/dataValidator.js");
load("core/outlierCalculator.js");
load("core/classification.js");
load("background/dataFetcher.js");

const OF = globalThis.OutlierFinder;
const V = OF.validator;
const C = OF.calculator;
const CL = OF.classification;
const DEFAULTS = OF.settings.DEFAULTS;

test("parseCount handles YouTube count formats", () => {
  assert.equal(V.parseCount("1.2M"), 1200000);
  assert.equal(V.parseCount("1.2M views"), 1200000);
  assert.equal(V.parseCount("1,234 views"), 1234);
  assert.equal(V.parseCount("12,345,678"), 12345678);
  assert.equal(V.parseCount("2.5K subscribers"), 2500);
  assert.equal(V.parseCount("1.2B"), 1200000000);
  assert.equal(V.parseCount("1.2 million"), 1200000);
  assert.equal(V.parseCount("No views"), 0);
  assert.equal(V.parseCount("hidden"), null);
  assert.equal(V.parseCount(""), null);
});

test("parseViewCount extracts views from metadata strings", () => {
  assert.equal(V.parseViewCount("1.2M views"), 1200000);
  assert.equal(V.parseViewCount("1.2M views • 4 days ago"), 1200000);
  assert.equal(V.parseViewCount("1.2 million views"), 1200000);
  assert.equal(V.parseViewCount("420K views"), 420000);
  assert.equal(V.parseViewCount("No views"), null);
  assert.equal(V.parseViewCount("4 days ago"), null);
});

test("parseSubscriberCount reports exact and approximate values", () => {
  const approximate = V.parseSubscriberCount("1.2M subscribers");
  assert.equal(approximate.count, 1200000);
  assert.equal(approximate.approximate, true);
  assert.equal(approximate.exact, false);

  const exact = V.parseSubscriberCount("1,234 subscribers");
  assert.equal(exact.count, 1234);
  assert.equal(exact.approximate, false);
  assert.equal(exact.exact, true);

  assert.equal(V.parseSubscriberCount("Subscribers hidden"), null);
});

test("parseAgeDays understands common YouTube age text", () => {
  assert.equal(V.parseAgeDays("4 days ago"), 4);
  assert.equal(V.parseAgeDays("2 weeks ago"), 14);
  assert.equal(V.parseAgeDays("1 month ago"), 30);
  assert.equal(V.parseAgeDays("1 year ago"), 365);
  assert.equal(V.parseAgeDays("Streamed 3 hours ago"), 0.13);
  assert.equal(V.parseAgeDays("Premiered 2 days ago"), 2);
  assert.equal(V.parseAgeDays("today"), 0);
  assert.equal(V.parseAgeDays("yesterday"), 1);
  assert.equal(V.parseAgeDays("unknown"), null);
});

test("URL helpers validate ids and channel references", () => {
  assert.equal(V.isValidVideoId("dQw4w9WgXcQ"), true);
  assert.equal(V.isValidVideoId("short"), false);

  assert.deepEqual(V.videoIdFromUrl("/watch?v=dQw4w9WgXcQ&t=10"), {
    videoId: "dQw4w9WgXcQ",
    isShort: false
  });
  assert.deepEqual(V.videoIdFromUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ"), {
    videoId: "dQw4w9WgXcQ",
    isShort: true
  });
  assert.equal(V.videoIdFromUrl("/watch?v=bad"), null);

  const handle = V.normalizeChannelRef("/@creator");
  assert.equal(handle.handle, "@creator");
  assert.equal(handle.url, "https://www.youtube.com/@creator");
  assert.equal(handle.key, "@creator");

  const channelId = "UCabcdefghijklmnopqrstuv";
  const channel = V.normalizeChannelRef("/channel/" + channelId);
  assert.equal(channel.channelId, channelId);
  assert.equal(channel.key, channelId);
  assert.equal(channel.url, "https://www.youtube.com/channel/" + channelId);

  assert.equal(V.normalizeChannelRef("/watch?v=dQw4w9WgXcQ"), null);
});

test("outlier score and evaluation use validated numbers", () => {
  assert.equal(C.calculateOutlierScore(420000, 10000), 42);
  assert.equal(C.calculateOutlierScore(500000, 8000), 62.5);
  assert.equal(C.calculateOutlierScore(0, 10000), 0);
  assert.equal(C.calculateOutlierScore(1000, 0), null);
  assert.equal(C.calculateOutlierScore(null, 10000), null);
  assert.equal(C.calculateOutlierScore(1000, "nope"), null);

  const evaluation = C.evaluateVideo(
    { views: 420000, ageDays: 4 },
    { subscriberCount: 10000 },
    DEFAULTS
  );
  assert.equal(evaluation.score, 42);
  assert.equal(evaluation.viewsPerDay, 105000);
  assert.equal(evaluation.eligible, true);

  const belowMinViews = C.evaluateVideo(
    { views: 4000, ageDays: 4 },
    { subscriberCount: 100 },
    DEFAULTS
  );
  assert.equal(belowMinViews.score, 40);
  assert.equal(belowMinViews.eligible, false);
  assert.deepEqual(belowMinViews.checks, { views: false, subscribers: true, score: true });
});

test("classification maps scores to the PRD categories", () => {
  const normal = CL.classifyOutlier(1.1, 90000, DEFAULTS);
  assert.equal(normal.category, "normal");
  assert.equal(normal.qualifies, false);

  const above = CL.classifyOutlier(3, 90000, DEFAULTS);
  assert.equal(above.category, "above-average");
  assert.equal(above.qualifies, false);

  const potential = CL.classifyOutlier(5.2, 52000, DEFAULTS);
  assert.equal(potential.category, "potential");
  assert.equal(potential.qualifies, true);
  assert.equal(potential.shouldShow, true);

  const viral = CL.classifyOutlier(12, 120000, DEFAULTS);
  assert.equal(viral.category, "viral");

  const strong = CL.classifyOutlier(34, 340000, DEFAULTS);
  assert.equal(strong.category, "strong");

  const massive = CL.classifyOutlier(78, 780000, DEFAULTS);
  assert.equal(massive.category, "massive");

  const lowViews = CL.classifyOutlier(78, 4000, DEFAULTS);
  assert.equal(lowViews.category, "massive");
  assert.equal(lowViews.qualifies, false);
  assert.equal(lowViews.shouldShow, false);
});

test("custom thresholds and category visibility are respected", () => {
  const settings = OF.settings.normalizeSettings({
    minScore: 3,
    thresholds: { aboveAverage: 1.5, potential: 3, viral: 8, strong: 20, massive: 40 },
    showViral: false
  });

  const custom = CL.classifyOutlier(9, 90000, settings);
  assert.equal(custom.category, "viral");
  assert.equal(custom.qualifies, true);
  assert.equal(custom.enabled, false);
  assert.equal(custom.shouldShow, false);
});

test("formatting helpers produce compact display values", () => {
  assert.equal(C.formatCount(420000), "420K");
  assert.equal(C.formatCount(1200000), "1.2M");
  assert.equal(C.formatCount(1500), "1.5K");
  assert.equal(C.formatCount(999), "999");
  assert.equal(C.formatScore(42), "42");
  assert.equal(C.formatScore(5.2), "5.2");
  assert.equal(C.formatScore(5), "5");
  assert.equal(C.formatRatio(42), "42x");
  assert.equal(C.formatViewsPerDay(105000), "105K/day");
});

test("settings normalization clamps values and orders thresholds", () => {
  const settings = OF.settings.normalizeSettings({
    minViews: -50,
    minScore: "7.5",
    thresholds: { aboveAverage: 10, potential: 4, viral: 2, strong: 1, massive: 0.5 },
    cache: { subscriberMs: 1, failureMs: 999999999 },
    request: { maxConcurrent: 99 }
  });

  assert.equal(settings.minViews, 0);
  assert.equal(settings.minScore, 7.5);
  assert.equal(settings.thresholds.aboveAverage, 10);
  assert.equal(settings.thresholds.potential, 10);
  assert.equal(settings.thresholds.viral, 10);
  assert.equal(settings.thresholds.strong, 10);
  assert.equal(settings.thresholds.massive, 10);
  assert.equal(settings.cache.subscriberMs, OF.settings.MINUTE);
  assert.equal(settings.cache.failureMs, 24 * OF.settings.HOUR);
  assert.equal(settings.request.maxConcurrent, 8);
});

test("channel page parsing finds the header subscriber count and channel id", () => {
  const currentId = "UCabcdefghijklmnopqrstuv";
  const recommendedId = "UCzyxwvutsrqponmlkjihgfe";

  const data = {
    header: {
      pageHeaderViewModel: {
        metadata: {
          contentMetadataViewModel: {
            metadataRows: [
              { metadataParts: [{ text: { content: "@creator" } }, { text: { content: "12.4K subscribers" } }] }
            ]
          }
        }
      }
    },
    externalId: currentId,
    contents: [{ channelRenderer: { channelId: recommendedId, subscriberCountText: "1.2M subscribers" } }]
  };

  const html =
    "<html><script>var ytInitialData = " +
    JSON.stringify(data) +
    ";</script><body>channel page</body></html>";

  const parsed = OF.parseChannelHtml(html, "https://www.youtube.com/@creator");
  assert.ok(parsed);
  assert.equal(parsed.subscriberCount, 12400);
  assert.equal(parsed.approximate, true);
  assert.equal(parsed.channelId, currentId);
});

test("channel page parsing prefers the channel id in the URL", () => {
  const urlId = "UCabcdefghijklmnopqrstuv";
  const html = '<html><script>var ytInitialData = {"externalId":"UCzyxwvutsrqponmlkjihgfe","header":{"subscriberCountText":{"simpleText":"8.2K subscribers"}}};</script></html>';

  const parsed = OF.parseChannelHtml(html, "https://www.youtube.com/channel/" + urlId);
  assert.equal(parsed.subscriberCount, 8200);
  assert.equal(parsed.channelId, urlId);
});

test("channel page parsing returns null when subscriber data is hidden", () => {
  const html = '<html><script>var ytInitialData = {"header":{}};</script><body>No subscriber count here</body></html>';
  assert.equal(OF.parseChannelHtml(html, "https://www.youtube.com/@creator"), null);
});


test("channel parsing never takes counts from recommendations or descriptions", () => {
  for (const header of [{}, { title: "My road to 1M subscribers" }]) {
    const data = {
      header,
      contents: { channelRenderer: { subscriberCountText: { simpleText: "9M subscribers" } } },
      metadata: { channelMetadataRenderer: { description: "Celebrating 1M subscribers" } }
    };
    const html = "<script>var ytInitialData = " + JSON.stringify(data) + ";</script>";
    // A title mentioning subscribers is not a subscriber metric either.
    assert.equal(OF.parseChannelHtml(html, "https://www.youtube.com/@creator"), null);
  }
});

test("header subscriber data wins over recommendation subscriberCountText", () => {
  const data = {
    contents: { channelRenderer: { subscriberCountText: { simpleText: "9M subscribers" } } },
    header: { c4TabbedHeaderRenderer: { subscriberCountText: { simpleText: "8.2K subscribers" } } }
  };
  const parsed = OF.parseChannelHtml("var ytInitialData = " + JSON.stringify(data), "https://www.youtube.com/@creator");
  assert.equal(parsed.subscriberCount, 8200);
});

test("scores below one are underperforming", () => {
  assert.equal(CL.classifyOutlier(0.9, 10000, DEFAULTS).category, "underperforming");
  assert.equal(CL.classifyOutlier(1, 10000, DEFAULTS).category, "normal");
});

test("channel fetches deduplicate concurrent requests", async () => {
  const fetcher = OF.dataFetcher;
  const original = fetcher.fetchWithThrottle;
  let calls = 0;
  let finish;
  fetcher.fetchWithThrottle = () => {
    calls += 1;
    return new Promise((resolve) => { finish = resolve; });
  };
  try {
    const ref = { key: "@dedup", url: "https://www.youtube.com/@dedup" };
    const first = fetcher.fetchChannel(ref, DEFAULTS);
    const second = fetcher.fetchChannel(ref, DEFAULTS);
    assert.equal(calls, 1);
    finish({ ok: false, error: "unavailable" });
    const results = await Promise.all([first, second]);
    assert.equal(results[0], results[1]);
    assert.equal(fetcher.inFlight.size, 0);
  } finally {
    fetcher.fetchWithThrottle = original;
  }
});

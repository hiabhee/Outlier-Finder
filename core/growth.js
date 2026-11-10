(function (root) {
  "use strict";
  const OF = root.OutlierFinder = root.OutlierFinder || {};
  const WINDOW = 60 * 60 * 1000;
  function observe(previous, views, now) {
    if (!Number.isSafeInteger(views) || views < 0 || !Number.isSafeInteger(now) || now < 0) return null;
    let samples = Array.isArray(previous?.samples) ? previous.samples.filter(s => Number.isSafeInteger(s.views) && s.views >= 0 && Number.isSafeInteger(s.at) && s.at <= now && s.at >= now - WINDOW) : [];
    const last = samples.at(-1);
    if (last && views < last.views) samples = []; // Counter corrections start a new baseline.
    const current = samples.at(-1);
    if (!current || now - current.at >= 60000) samples.push({ views, at: now });
    const first = samples[0], latest = samples.at(-1);
    const elapsedMs = latest.at - first.at;
    const measured = elapsedMs >= 60000;
    const delta = measured ? latest.views - first.views : null;
    return { samples: samples.slice(-61), updatedAt: now, state: measured ? (delta > 0 ? "growing" : "steady") : "collecting",
      deltaViews: delta, elapsedMinutes: measured ? elapsedMs / 60000 : null,
      viewsPerMinute: measured ? delta / (elapsedMs / 60000) : null,
      percentChange: measured && first.views > 0 ? delta / first.views * 100 : null,
      fromViews: first.views, toViews: latest.views };
  }
  OF.growth = { observe, WINDOW };
})(globalThis);

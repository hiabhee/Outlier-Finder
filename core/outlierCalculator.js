(function (root) {
  "use strict";

  const OF = (root.OutlierFinder = root.OutlierFinder || {});

  function toNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const num = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
    return Number.isFinite(num) ? num : null;
  }

  function calculateOutlierScore(views, subscribers) {
    const viewCount = toNumber(views);
    const subscriberCount = toNumber(subscribers);

    if (viewCount === null || subscriberCount === null) return null;
    if (viewCount < 0 || subscriberCount <= 0) return null;

    const score = viewCount / subscriberCount;
    return Number.isFinite(score) ? Math.round(score * 100) / 100 : null;
  }

  function calculateViewsPerDay(views, ageDays) {
    const viewCount = toNumber(views);
    const days = toNumber(ageDays);

    if (viewCount === null || days === null || viewCount < 0) return null;
    if (days <= 0) return viewCount;

    return Math.round(viewCount / days);
  }

  function meetsMinimums(views, subscribers, score, settings) {
    const viewCount = toNumber(views);
    const subscriberCount = toNumber(subscribers);
    const outlierScore = toNumber(score);

    const checks = {
      views: viewCount !== null && viewCount >= settings.minViews,
      subscribers: subscriberCount !== null && subscriberCount >= settings.minSubscribers,
      score: outlierScore !== null && outlierScore >= settings.minScore
    };

    const reasons = [];
    if (!checks.views) reasons.push("below minimum views");
    if (!checks.subscribers) reasons.push("below minimum subscribers");
    if (!checks.score) reasons.push("below minimum outlier score");

    return {
      eligible: checks.views && checks.subscribers && checks.score,
      checks,
      reasons
    };
  }

  function evaluateVideo(video, channel, settings) {
    const views = toNumber(video && video.views);
    const subscriberCount = toNumber(channel && channel.subscriberCount);
    const score = calculateOutlierScore(views, subscriberCount);
    const minimums = meetsMinimums(views, subscriberCount, score, settings);

    return {
      views,
      subscriberCount,
      score,
      viewsPerDay: calculateViewsPerDay(views, video && video.ageDays),
      eligible: minimums.eligible,
      checks: minimums.checks,
      reasons: minimums.reasons
    };
  }

  function trimDecimal(value) {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }

  function formatCount(value) {
    const num = toNumber(value);
    if (num === null) return "—";
    if (num < 0) return "—";
    if (num >= 1e9) return trimDecimal(num / 1e9) + "B";
    if (num >= 1e6) return trimDecimal(num / 1e6) + "M";
    if (num >= 1e3) return trimDecimal(num / 1e3) + "K";
    return String(Math.round(num));
  }

  function formatScore(value) {
    const num = toNumber(value);
    if (num === null) return "—";
    if (num >= 100) return String(Math.round(num));
    if (num >= 10) return String(Math.round(num));
    return trimDecimal(num);
  }

  function formatRatio(value) {
    const num = toNumber(value);
    if (num === null) return "—";
    return formatScore(num) + "x";
  }

  function formatViewsPerDay(value) {
    const num = toNumber(value);
    if (num === null) return "—";
    if (num >= 1000) return formatCount(num) + "/day";
    return Math.round(num).toLocaleString("en-US") + "/day";
  }

  OF.calculator = {
    toNumber,
    calculateOutlierScore,
    calculateViewsPerDay,
    meetsMinimums,
    evaluateVideo,
    formatCount,
    formatScore,
    formatRatio,
    formatViewsPerDay
  };
})(typeof globalThis !== "undefined" ? globalThis : this);

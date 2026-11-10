(function () {
  "use strict";

  const OF = globalThis.OutlierFinder;
  const S = OF.settings;

  const els = {
    form: document.getElementById("ofo-form"),
    enabled: document.getElementById("ofo-enabled"),
    xEnabled: document.getElementById("ofo-xEnabled"),
    instagramEnabled: document.getElementById("ofo-instagramEnabled"),
    socialLikeFallback: document.getElementById("ofo-socialLikeFallback"),
    socialMinLikes: document.getElementById("ofo-socialMinLikes"),
    socialMinEngagementPercent: document.getElementById("ofo-socialMinEngagementPercent"),

    scanShorts: document.getElementById("ofo-scanShorts"),
    scanLive: document.getElementById("ofo-scanLive"),
    minViews: document.getElementById("ofo-minViews"),
    minSubscribers: document.getElementById("ofo-minSubscribers"),
    minScore: document.getElementById("ofo-minScore"),
    aboveAverage: document.getElementById("ofo-aboveAverage"),
    potential: document.getElementById("ofo-potential"),
    viral: document.getElementById("ofo-viral"),
    strong: document.getElementById("ofo-strong"),
    massive: document.getElementById("ofo-massive"),
    badgeVisible: document.getElementById("ofo-badgeVisible"),
    showAllScores: document.getElementById("ofo-showAllScores"),
    showPotential: document.getElementById("ofo-showPotential"),
    showViral: document.getElementById("ofo-showViral"),
    showStrong: document.getElementById("ofo-showStrong"),
    showMassive: document.getElementById("ofo-showMassive"),
    showAboveAverage: document.getElementById("ofo-showAboveAverage"),
    showNormal: document.getElementById("ofo-showNormal"),
    showUnavailable: document.getElementById("ofo-showUnavailable"),
    cacheEnabled: document.getElementById("ofo-cacheEnabled"),
    subscriberCacheHours: document.getElementById("ofo-subscriberCacheHours"),
    failureCacheMinutes: document.getElementById("ofo-failureCacheMinutes"),
    maxConcurrent: document.getElementById("ofo-maxConcurrent"),
    minIntervalMs: document.getElementById("ofo-minIntervalMs"),
    maxRecentOutliers: document.getElementById("ofo-maxRecentOutliers"),
    reset: document.getElementById("ofo-reset"),
    status: document.getElementById("ofo-status")
  };

  let current = S.normalizeSettings(S.DEFAULTS);
  let statusTimer = null;

  function num(element, fallback) {
    const value = parseFloat(element.value);
    return Number.isFinite(value) ? value : fallback;
  }

  function populate(settings) {
    current = S.normalizeSettings(settings);
    els.enabled.checked = current.enabled;
    els.xEnabled.checked = current.xEnabled;
    els.instagramEnabled.checked = current.instagramEnabled;
    els.socialLikeFallback.checked = current.socialLikeFallback;
    els.socialMinLikes.value = current.socialMinLikes;
    els.socialMinEngagementPercent.value = current.socialMinEngagementPercent;

    els.scanShorts.checked = current.scanShorts;
    els.scanLive.checked = current.scanLive;

    els.minViews.value = current.minViews;
    els.minSubscribers.value = current.minSubscribers;
    els.minScore.value = current.minScore;

    els.aboveAverage.value = current.thresholds.aboveAverage;
    els.potential.value = current.thresholds.potential;
    els.viral.value = current.thresholds.viral;
    els.strong.value = current.thresholds.strong;
    els.massive.value = current.thresholds.massive;

    els.badgeVisible.checked = current.badgeVisible;
    els.showAllScores.checked = current.showAllScores;
    els.showPotential.checked = current.showPotential;
    els.showViral.checked = current.showViral;
    els.showStrong.checked = current.showStrong;
    els.showMassive.checked = current.showMassive;
    els.showAboveAverage.checked = current.showAboveAverage;
    els.showNormal.checked = current.showNormal;
    els.showUnavailable.checked = current.showUnavailable;

    els.cacheEnabled.checked = current.cacheEnabled;
    els.subscriberCacheHours.value = Math.round((current.cache.subscriberMs / S.HOUR) * 10) / 10;
    els.failureCacheMinutes.value = Math.round(current.cache.failureMs / S.MINUTE);
    els.maxConcurrent.value = current.request.maxConcurrent;
    els.minIntervalMs.value = current.request.minIntervalMs;
    els.maxRecentOutliers.value = current.maxRecentOutliers;
  }

  function readForm() {
    return S.normalizeSettings({
      enabled: els.enabled.checked,
      xEnabled: els.xEnabled.checked,
      instagramEnabled: els.instagramEnabled.checked,
      socialLikeFallback: els.socialLikeFallback.checked,
      socialMinLikes: num(els.socialMinLikes, current.socialMinLikes),
      socialMinEngagementPercent: num(els.socialMinEngagementPercent, current.socialMinEngagementPercent),

      scanShorts: els.scanShorts.checked,
      scanLive: els.scanLive.checked,
      minViews: num(els.minViews, current.minViews),
      minSubscribers: num(els.minSubscribers, current.minSubscribers),
      minScore: num(els.minScore, current.minScore),
      badgeVisible: els.badgeVisible.checked,
      showAllScores: els.showAllScores.checked,
      showPotential: els.showPotential.checked,
      showViral: els.showViral.checked,
      showStrong: els.showStrong.checked,
      showMassive: els.showMassive.checked,
      showAboveAverage: els.showAboveAverage.checked,
      showNormal: els.showNormal.checked,
      showUnavailable: els.showUnavailable.checked,
      cacheEnabled: els.cacheEnabled.checked,
      maxRecentOutliers: num(els.maxRecentOutliers, current.maxRecentOutliers),
      thresholds: {
        aboveAverage: num(els.aboveAverage, current.thresholds.aboveAverage),
        potential: num(els.potential, current.thresholds.potential),
        viral: num(els.viral, current.thresholds.viral),
        strong: num(els.strong, current.thresholds.strong),
        massive: num(els.massive, current.thresholds.massive)
      },
      cache: {
        subscriberMs: num(els.subscriberCacheHours, current.cache.subscriberMs / S.HOUR) * S.HOUR,
        viewsMs: current.cache.viewsMs,
        metadataMs: current.cache.metadataMs,
        failureMs: num(els.failureCacheMinutes, current.cache.failureMs / S.MINUTE) * S.MINUTE
      },
      request: {
        maxConcurrent: num(els.maxConcurrent, current.request.maxConcurrent),
        minIntervalMs: num(els.minIntervalMs, current.request.minIntervalMs),
        timeoutMs: current.request.timeoutMs
      }
    });
  }

  function showStatus(text) {
    els.status.textContent = text;
    els.status.classList.add("is-visible");
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      els.status.classList.remove("is-visible");
    }, 2200);
  }

  els.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const settings = readForm();
    current = await S.saveSettings(settings);
    populate(current);
    showStatus("Settings saved");
  });

  els.reset.addEventListener("click", async () => {
    const settings = await S.resetSettings();
    current = settings;
    populate(current);
    showStatus("Defaults restored");
  });

  S.getSettings()
    .then((settings) => populate(settings))
    .catch(() => populate(S.DEFAULTS));
})();

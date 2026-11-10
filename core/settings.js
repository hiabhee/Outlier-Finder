(function (root) {
  "use strict";

  const OF = (root.OutlierFinder = root.OutlierFinder || {});

  const HOUR = 60 * 60 * 1000;
  const MINUTE = 60 * 1000;

  const DEFAULTS = Object.freeze({
    enabled: true,
    xEnabled: true,
    instagramEnabled: true,
    socialLikeFallback: true,
    socialMinLikes: 100,
    socialMinEngagementPercent: 2,
    minViews: 5000,
    minSubscribers: 100,
    minScore: 5,
    showNormal: false,
    showAboveAverage: false,
    showPotential: true,
    showViral: true,
    showStrong: true,
    showMassive: true,
    showUnavailable: false,
    scanShorts: false,
    scanLive: false,
    badgeVisible: true,
    showAllScores: true,
    cacheEnabled: true,
    cache: Object.freeze({
      subscriberMs: 24 * HOUR,
      viewsMs: 45 * MINUTE,
      metadataMs: 24 * HOUR,
      failureMs: 20 * MINUTE
    }),
    thresholds: Object.freeze({
      aboveAverage: 2,
      potential: 5,
      viral: 10,
      strong: 30,
      massive: 50
    }),
    request: Object.freeze({
      maxConcurrent: 2,
      minIntervalMs: 350,
      timeoutMs: 12000
    }),
    maxRecentOutliers: 200
  });

  function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeSettings(partial) {
    const base = clone(DEFAULTS);
    if (!isPlainObject(partial)) return base;

    const merged = Object.assign(base, partial);
    merged.cache = Object.assign(clone(DEFAULTS.cache), partial.cache || {});
    merged.thresholds = Object.assign(clone(DEFAULTS.thresholds), partial.thresholds || {});
    merged.request = Object.assign(clone(DEFAULTS.request), partial.request || {});

    merged.socialMinLikes = clampNumber(merged.socialMinLikes, 0, 1e9, DEFAULTS.socialMinLikes);
    merged.socialMinEngagementPercent = clampNumber(merged.socialMinEngagementPercent, 0, 10000, DEFAULTS.socialMinEngagementPercent);
    merged.minViews = clampNumber(merged.minViews, 0, 1000000000, DEFAULTS.minViews);
    merged.minSubscribers = clampNumber(merged.minSubscribers, 0, 1000000000, DEFAULTS.minSubscribers);
    merged.minScore = clampNumber(merged.minScore, 0, 100000, DEFAULTS.minScore);
    merged.maxRecentOutliers = clampNumber(merged.maxRecentOutliers, 10, 1000, DEFAULTS.maxRecentOutliers);

    merged.thresholds.aboveAverage = clampNumber(merged.thresholds.aboveAverage, 0.1, 100000, DEFAULTS.thresholds.aboveAverage);
    merged.thresholds.potential = Math.max(merged.thresholds.aboveAverage, clampNumber(merged.thresholds.potential, 0.1, 100000, DEFAULTS.thresholds.potential));
    merged.thresholds.viral = Math.max(merged.thresholds.potential, clampNumber(merged.thresholds.viral, 0.1, 100000, DEFAULTS.thresholds.viral));
    merged.thresholds.strong = Math.max(merged.thresholds.viral, clampNumber(merged.thresholds.strong, 0.1, 100000, DEFAULTS.thresholds.strong));
    merged.thresholds.massive = Math.max(merged.thresholds.strong, clampNumber(merged.thresholds.massive, 0.1, 100000, DEFAULTS.thresholds.massive));

    merged.cache.subscriberMs = clampNumber(merged.cache.subscriberMs, MINUTE, 30 * 24 * HOUR, DEFAULTS.cache.subscriberMs);
    merged.cache.viewsMs = clampNumber(merged.cache.viewsMs, MINUTE, 24 * HOUR, DEFAULTS.cache.viewsMs);
    merged.cache.metadataMs = clampNumber(merged.cache.metadataMs, MINUTE, 30 * 24 * HOUR, DEFAULTS.cache.metadataMs);
    merged.cache.failureMs = clampNumber(merged.cache.failureMs, MINUTE, 24 * HOUR, DEFAULTS.cache.failureMs);

    merged.request.maxConcurrent = clampNumber(merged.request.maxConcurrent, 1, 8, DEFAULTS.request.maxConcurrent);
    merged.request.minIntervalMs = clampNumber(merged.request.minIntervalMs, 0, 10000, DEFAULTS.request.minIntervalMs);
    merged.request.timeoutMs = clampNumber(merged.request.timeoutMs, 1000, 60000, DEFAULTS.request.timeoutMs);

    return merged;
  }

  function clampNumber(value, min, max, fallback) {
    const num = typeof value === "number" ? value : parseFloat(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, num));
  }

  function storageGet(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (result) => resolve(result || {}));
      } catch (error) {
        resolve({});
      }
    });
  }

  function storageSet(values) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set(values, () => resolve(!chrome.runtime.lastError));
      } catch (error) {
        resolve(false);
      }
    });
  }

  async function getSettings() {
    const result = await storageGet("settings");
    return normalizeSettings(result.settings);
  }

  async function saveSettings(settings) {
    const normalized = normalizeSettings(settings);
    await storageSet({ settings: normalized });
    return normalized;
  }

  async function resetSettings() {
    return saveSettings(DEFAULTS);
  }

  function onSettingsChanged(callback) {
    if (!root.chrome || !chrome.storage || !chrome.storage.onChanged) return () => {};
    const listener = (changes, area) => {
      if (area !== "local" || !changes.settings) return;
      callback(normalizeSettings(changes.settings.newValue));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }

  async function ensureDefaults() {
    const result = await storageGet("settings");
    if (!result.settings) {
      await saveSettings(DEFAULTS);
      return normalizeSettings(DEFAULTS);
    }
    const normalized = normalizeSettings(result.settings);
    await saveSettings(normalized);
    return normalized;
  }

  OF.settings = {
    DEFAULTS,
    HOUR,
    MINUTE,
    normalizeSettings,
    getSettings,
    saveSettings,
    resetSettings,
    ensureDefaults,
    onSettingsChanged,
    storageGet,
    storageSet
  };
})(typeof globalThis !== "undefined" ? globalThis : this);

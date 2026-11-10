importScripts(
  "/core/settings.js",
  "/core/dataValidator.js",
  "/core/outlierCalculator.js",
  "/core/classification.js",
  "/background/cacheManager.js",
  "/background/dataFetcher.js",
  "/core/social.js",
  "/core/instagram.js",
  "/background/socialFetcher.js",
  "/core/growth.js",
  "/background/growthTracker.js"
);

(function (root) {
  "use strict";

  const OF = root.OutlierFinder;
  const S = OF.settings;
  const cache = OF.cacheManager;
  const fetcher = OF.dataFetcher;

  async function handleChannelRequest(message) {
    const ref = message.ref || {};
    const key = ref.key || ref.channelId || ref.url;

    if (!key) return { ok: false, error: "missing channel reference" };

    const settings = await S.getSettings();
    fetcher.configure(settings.request);

    if (settings.cacheEnabled) {
      const cached = await cache.getChannel(key);
      if (cached && cached.data) {
        return { ok: true, cached: true, channel: cached.data };
      }

      const failure = await cache.getFailure(key);
      if (failure) {
        return { ok: false, cachedFailure: true, error: failure.reason || "subscriber data unavailable" };
      }
    }

    const result = await fetcher.fetchChannel(ref, settings);

    if (!result.ok) {
      if (settings.cacheEnabled) {
        await cache.setFailure(key, result.error, settings.cache.failureMs);
      }
      return { ok: false, error: result.error };
    }

    const data = Object.assign({}, result.channel, { fetchedAt: Date.now() });

    if (settings.cacheEnabled) {
      await cache.setChannel(key, data, settings.cache.subscriberMs);
      if (data.channelId) {
        await cache.setAlias(key, data.channelId);
        await cache.setChannel(data.channelId, data, settings.cache.subscriberMs);
      }
      if (ref.channelId && ref.channelId !== data.channelId && data.channelId) {
        await cache.setAlias(ref.channelId, data.channelId);
      }
    }

    return { ok: true, cached: false, channel: data };
  }

  async function handleVideoOwnerRequest(message) {
    const videoId = message.videoId;
    if (!OF.validator.isValidVideoId(videoId)) return { ok: false, error: "invalid video id" };
    const settings = await S.getSettings();
    const failureKey = "owner:" + videoId;
    if (settings.cacheEnabled) {
      const ref = await cache.getVideoOwner(videoId);
      if (ref) return { ok: true, ref, cached: true };
      const failure = await cache.getFailure(failureKey);
      if (failure) return { ok: false, error: failure.reason, cachedFailure: true };
    }
    const result = await fetcher.fetchVideoOwner(videoId, settings);
    if (settings.cacheEnabled) {
      if (result.ok) await cache.setVideoOwner(videoId, result.ref, settings.cache.metadataMs);
      else await cache.setFailure(failureKey, result.error, settings.cache.failureMs);
    }
    return result;
  }

  function updateActionBadge(sender, stats) {
    if (!sender || !sender.tab || typeof sender.tab.id !== "number") return;
    if (!chrome.action || !chrome.action.setBadgeText) return;

    const enabled = stats.enabled !== false;
    const count = enabled ? Number(stats.outliers) || 0 : 0;
    const text = count > 99 ? "99+" : count > 0 ? String(count) : "";

    try {
      chrome.action.setBadgeText({ tabId: sender.tab.id, text }, () => void chrome.runtime.lastError);
      chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: "#16a34a" }, () => void chrome.runtime.lastError);
    } catch (error) {
      // The tab may have closed.
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return;

    switch (message.type) {
      case "OBSERVE_X_GROWTH":
        OF.observeXGrowth(message.postId, message.views).then(sendResponse).catch(() => sendResponse({ ok: false }));
        return true;

      case "GET_INSTAGRAM_POST":
        OF.socialFetcher.getInstagramPost(message.postId)
          .then(sendResponse)
          .catch(() => sendResponse({ ok: false, error: "Instagram post lookup failed" }));
        return true;

      case "GET_SOCIAL_PROFILE":
        OF.socialFetcher.getProfile(message.ref)
          .then(sendResponse)
          .catch(() => sendResponse({ ok: false, error: "profile lookup failed" }));
        return true;

      case "CACHE_SOCIAL_PROFILE":
        OF.socialFetcher.observe(message.ref, message.followerCount, message.approximate, message.source)
          .then(sendResponse)
          .catch(() => sendResponse({ ok: false, error: "profile cache write failed" }));
        return true;

      case "GET_VIDEO_CHANNEL":
        handleVideoOwnerRequest(message)
          .then(sendResponse)
          .catch(() => sendResponse({ ok: false, error: "video owner lookup failed" }));
        return true;

      case "GET_CHANNEL_DATA":
        handleChannelRequest(message)
          .then(sendResponse)
          .catch((error) => sendResponse({ ok: false, error: error.message || "channel lookup failed" }));
        return true;

      case "CACHE_VIDEO":
        (async () => {
          const settings = await S.getSettings();
          if (settings.cacheEnabled) await cache.setVideo(message.video, settings);
          sendResponse({ ok: true });
        })().catch(() => sendResponse({ ok: false }));
        return true;

      case "RECORD_OUTLIER":
        (async () => {
          const settings = await S.getSettings();
          await cache.addRecentOutlier(message.outlier, settings.maxRecentOutliers);
          sendResponse({ ok: true });
        })().catch(() => sendResponse({ ok: false }));
        return true;

      case "UPDATE_STATS":
        cache.setLastStats(message.stats).catch(() => {});
        updateActionBadge(sender, message.stats || {});
        sendResponse({ ok: true });
        return;

      case "GET_RECENT_OUTLIERS":
        cache
          .getRecentOutliers()
          .then((outliers) => sendResponse({ ok: true, outliers }))
          .catch(() => sendResponse({ ok: false, outliers: [] }));
        return true;

      case "GET_SAVED_VIDEOS":
        cache
          .getSavedVideos()
          .then((videos) => sendResponse({ ok: true, videos }))
          .catch(() => sendResponse({ ok: false, videos: [] }));
        return true;

      case "CLEAR_CACHE":
        OF.socialFetcher.observed.clear();
        cache
          .clearTransient()
          .then((count) => sendResponse({ ok: true, count }))
          .catch(() => sendResponse({ ok: false }));
        return true;

      case "SET_ENABLED":
        (async () => {
          const settings = await S.getSettings();
          settings.enabled = !!message.enabled;
          const saved = await S.saveSettings(settings);
          sendResponse({ ok: true, enabled: saved.enabled });
        })().catch(() => sendResponse({ ok: false }));
        return true;

      case "OPEN_OPTIONS":
        chrome.runtime.openOptionsPage();
        sendResponse({ ok: true });
        return;

      default:
        return;
    }
  });

  chrome.runtime.onInstalled.addListener((details) => {
    S.ensureDefaults().catch(() => {});
    // Parser fixes must not remain hidden behind failures cached by older builds.
    if (details.reason === "update") cache.clearTransient().catch(() => {});
    try {
      chrome.action.setBadgeBackgroundColor({ color: "#16a34a" });
    } catch (error) {
      // Ignore unsupported badge APIs.
    }
  });

  chrome.runtime.onStartup.addListener(() => {
    S.ensureDefaults().catch(() => {});
  });
})(typeof globalThis !== "undefined" ? globalThis : self);

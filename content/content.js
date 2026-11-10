(function (root) {
  "use strict";

  const OF = (root.OutlierFinder = root.OutlierFinder || {});
  const C = OF.calculator;
  const V = OF.validator;
  const S = OF.settings;

  const state = {
    settings: S.normalizeSettings(S.DEFAULTS),
    enabled: true,
    observer: null,
    badgeManager: null,
    videos: new Map(),
    results: new Map(),
    videoPromises: new Map(),
    channelRequests: new Map(),
    recent: [],
    savedIds: new Set(),
    stats: {
      scanned: 0,
      outliers: 0,
      highestScore: 0,
      channels: new Set(),
    },
    statsTimer: null,
    started: false
  };

  function sendMessage(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve(null);
          } else {
            resolve(response || null);
          }
        });
      } catch (error) {
        resolve(null);
      }
    });
  }

  function statsSnapshot() {
    let unavailable = 0;
    let scored = 0;
    let lastError = "";
    const errors = {};
    for (const payload of state.results.values()) {
      if (payload && payload.state === "unavailable") {
        unavailable += 1;
        lastError = payload.reason || "Data unavailable";
        errors[lastError] = (errors[lastError] || 0) + 1;
      }
      if (payload && payload.state === "scored") scored += 1;
    }
    return {
      scanned: state.stats.scanned,
      outliers: state.stats.outliers,
      highestScore: Math.round(state.stats.highestScore * 10) / 10,
      channels: state.stats.channels.size,
      unavailable,
      scored,
      pending: state.videoPromises.size,
      lastError,
      errors,
      version: chrome.runtime.getManifest().version,
      enabled: state.enabled,
      updatedAt: Date.now()
    };
  }

  function scheduleStatsFlush() {
    if (state.statsTimer) return;
    state.statsTimer = setTimeout(() => {
      state.statsTimer = null;
      flushStats();
    }, 650);
  }

  function flushStats() {
    const snapshot = statsSnapshot();
    sendMessage({ type: "UPDATE_STATS", stats: snapshot });
    S.storageSet({ "of:lastStats": snapshot });
  }

  function decideDisplay(classification, evaluation, settings) {
    if (!settings.badgeVisible) return false;
    if (!classification || !evaluation) return false;
    if (settings.showAllScores && Number.isFinite(evaluation.score)) return true;
    if (evaluation.eligible && classification.enabled) return true;
    if (evaluation.score === null || evaluation.views === null) return false;
    if (["normal", "underperforming"].includes(classification.category) && settings.showNormal) return true;
    if (classification.category === "above-average" && settings.showAboveAverage) return true;
    return false;
  }

  function buildPayload(video, channel, settings, stateName) {
    const evaluation = C.evaluateVideo(video, channel, settings);
    const classification = OF.classification.classifyOutlier(evaluation.score, evaluation.views, settings);
    const display = decideDisplay(classification, evaluation, settings);

    return {
      expiresAt: Date.now() + Math.min(settings.cache.viewsMs, settings.cache.subscriberMs),
      state: stateName || "scored",
      score: evaluation.score,
      classification,
      eligible: evaluation.eligible,
      display,
      views: evaluation.views,
      viewsText: evaluation.views !== null ? C.formatCount(evaluation.views) + " views" : (video.viewsText || ""),
      subscriberCount: evaluation.subscriberCount,
      subscriberText: (channel && channel.subscriberText) || (evaluation.subscriberCount !== null ? C.formatCount(evaluation.subscriberCount) + " subscribers" : ""),
      approximateSubscribers: !!(channel && channel.approximate),
      viewsPerDay: evaluation.viewsPerDay,
      channel,
      settings
    };
  }

  function renderPayload(video, payload) {
    if (!state.badgeManager || !state.enabled) return;
    const current = OF.extractor.getCardVideoId(video.cardElement);
    if (!current || current.videoId !== video.videoId) return;
    video.cardElement.dataset.ofState = payload.state || "scored";
    video.cardElement.dataset.ofReason = payload.reason || "";
    video.cardElement.dataset.ofBadgeExpected = payload.display && state.settings.badgeVisible ? "1" : "0";
    state.badgeManager.render(video, payload);
  }

  function renderExisting(video) {
    const existing = state.results.get(video.videoId);
    if (!existing) return false;
    let display;
    if (existing.state === "unavailable") {
      display = state.settings.showAllScores || state.settings.showUnavailable;
    } else if (existing.state === "loading") {
      display = state.settings.badgeVisible;
    } else {
      display = decideDisplay(existing.classification, existing, state.settings);
    }
    renderPayload(video, Object.assign({}, existing, { settings: state.settings, display }));
    return true;
  }

  function outlierSummary(video, payload) {
    const channel = video.channel || {};
    const classification = payload.classification || {};
    return {
      videoId: video.videoId,
      title: video.title,
      videoUrl: video.videoUrl,
      thumbnailUrl: video.thumbnailUrl,
      channelName: channel.name || "Unknown channel",
      channelId: channel.channelId || null,
      subscriberCount: payload.subscriberCount,
      subscriberText: payload.subscriberText,
      views: payload.views,
      viewsText: payload.viewsText,
      score: payload.score,
      category: classification.category || null,
      label: classification.label || null,
      publishedText: video.publishedText,
      ageDays: video.ageDays,
      viewsPerDay: payload.viewsPerDay,
      approximateSubscribers: payload.approximateSubscribers,
      collectedAt: Date.now(),
      detectedAt: Date.now()
    };
  }

  function recordOutlier(video, payload) {
    const summary = outlierSummary(video, payload);
    const index = state.recent.findIndex((item) => item.videoId === video.videoId);
    if (index !== -1) state.recent.splice(index, 1);
    state.recent.unshift(summary);
    if (state.recent.length > 30) state.recent.length = 30;
    sendMessage({ type: "RECORD_OUTLIER", outlier: summary });
  }

  function requestChannel(ref) {
    if (!ref) return Promise.resolve({ ok: false, error: "missing channel" });
    const key = ref.key || ref.channelId || ref.url;
    if (!key) return Promise.resolve({ ok: false, error: "missing channel key" });

    if (state.channelRequests.has(key)) {
      return state.channelRequests.get(key);
    }

    const request = sendMessage({
      type: "GET_CHANNEL_DATA",
      ref: {
        key,
        channelId: ref.channelId || null,
        handle: ref.handle || null,
        url: ref.url || null,
        name: ref.name || null
      }
    })
      .then((response) => response || { ok: false, error: "no response from background" })
      .catch(() => ({ ok: false, error: "channel request failed" }))
      .finally(() => {
        state.channelRequests.delete(key);
      });

    state.channelRequests.set(key, request);
    return request;
  }

  function markUnavailable(video, reason, displayOverride) {
    const settings = state.settings;
    const payload = {
      expiresAt: Date.now() + settings.cache.failureMs,
      state: "unavailable",
      score: null,
      classification: null,
      eligible: false,
      display: displayOverride === true || settings.showAllScores || settings.showUnavailable,
      views: video.views,
      viewsText: video.viewsText,
      subscriberCount: null,
      subscriberText: "",
      approximateSubscribers: false,
      viewsPerDay: null,
      channel: video.channel,
      reason,
      settings
    };
    state.results.set(video.videoId, payload);
    console.warn("[Outlier Finder] Score unavailable:", reason);
    renderPayload(video, payload);
  }

  async function processVideo(video) {
    if (!state.enabled || !video || !video.videoId) return;
    const settings = state.settings;

    if (video.isShort && !settings.scanShorts) return;
    if (video.isLive && !settings.scanLive) return;

    const id = video.videoId;

    if (state.videoPromises.has(id)) {
      state.videoPromises.get(id).then(() => {
        renderExisting(video);
      });
      return;
    }

    const previousVideo = state.videos.get(id);
    const previousResult = state.results.get(id);
    const metadataChanged = previousVideo && (previousVideo.views !== video.views ||
      (previousVideo.channel && previousVideo.channel.key) !== (video.channel && video.channel.key));
    const expired = previousResult && previousResult.expiresAt <= Date.now();
    if (metadataChanged || expired) state.results.delete(id);

    if (state.videos.has(id) && state.results.has(id)) {
      state.videos.set(id, video);
      renderExisting(video);
      return;
    }

    state.results.delete(id);
    const alreadySeen = state.videos.has(id);
    state.videos.set(id, video);
    if (!alreadySeen) state.stats.scanned += 1;
    if (video.channel && video.channel.key) state.stats.channels.add(video.channel.key);

    if (video.views === null || video.views === undefined) {
      markUnavailable(video, "view count unavailable");
      scheduleStatsFlush();
      return;
    }

    renderPayload(video, { state: "loading", display: settings.badgeVisible, settings });

    const promise = (async () => {
      try {
        if (!video.channel || !video.channel.url) {
          const owner = await sendMessage({ type: "GET_VIDEO_CHANNEL", videoId: id });
          if (!owner || !owner.ok || !owner.ref || !owner.ref.url) {
            markUnavailable(video, (owner && owner.error) || "video owner lookup failed");
            scheduleStatsFlush();
            return;
          }
          video.channel = Object.assign({}, video.channel, owner.ref);
          video.channelRef = video.channel;
          state.stats.channels.add(video.channel.key);
        }
        const response = await requestChannel(video.channel);

        if (!response || !response.ok) {
          markUnavailable(video, (response && response.error) || "subscriber data unavailable");
          scheduleStatsFlush();
          return;
        }

        const channel = response.channel || {};
        const validation = V.validateChannelData(channel);
        if (!validation.ok) {
          markUnavailable(video, validation.reason);
          scheduleStatsFlush();
          return;
        }

        const mergedChannel = Object.assign({}, video.channel, channel);
        video.channel = mergedChannel;

        const payload = buildPayload(video, mergedChannel, state.settings, "scored");
        state.results.set(id, payload);
        renderPayload(video, payload);

        const eligibleResults = Array.from(state.results.values()).filter((item) => item.eligible);
        state.stats.outliers = eligibleResults.length;
        state.stats.highestScore = Math.max(0, ...eligibleResults.map((item) => item.score));
        sendMessage({ type: "CACHE_VIDEO", video: outlierSummary(video, payload) });

        if (payload.eligible) {
          recordOutlier(video, payload);
        }

        scheduleStatsFlush();
      } catch (error) {
        markUnavailable(video, "unexpected extraction error");
        scheduleStatsFlush();
      } finally {
        state.videoPromises.delete(id);
      }
    })();

    state.videoPromises.set(id, promise);
    await promise;
  }

  function reapplySettings() {
    const settings = state.settings;
    if (!state.enabled) {
      if (state.observer) state.observer.stop();
      if (state.badgeManager) state.badgeManager.removeAll();
      flushStats();
      return;
    }

    if (state.observer && !state.observer.running) state.observer.start();
    if (state.observer) state.observer.reset();

    for (const [id, video] of state.videos) {
      if ((video.isShort && !settings.scanShorts) || (video.isLive && !settings.scanLive)) {
        if (state.badgeManager) state.badgeManager.removeBadge(video);
        state.results.delete(id);
        continue;
      }

      const existing = state.results.get(id);
      if (!existing) continue;

      if (existing.channel && Number.isFinite(existing.subscriberCount)) {
        const payload = buildPayload(video, existing.channel, settings, existing.state === "scored" ? "scored" : existing.state);
        state.results.set(id, payload);
        renderPayload(video, payload);
      } else {
        const display = settings.showAllScores || settings.showUnavailable;
        renderPayload(video, Object.assign({}, existing, { settings, display }));
      }
    }

    let outliers = 0;
    let highest = 0;
    for (const payload of state.results.values()) {
      if (payload && payload.eligible) {
        outliers += 1;
        if (payload.score > highest) highest = payload.score;
      }
    }
    state.stats.outliers = outliers;
    state.stats.highestScore = highest;

    flushStats();
  }

  async function handleSettingsChange(newSettings) {
    state.settings = newSettings;
    state.enabled = newSettings.enabled;
    reapplySettings();
  }

  async function toggleSave(video, payload) {
    const stored = await S.storageGet("of:savedVideos");
    const list = Array.isArray(stored["of:savedVideos"]) ? stored["of:savedVideos"] : [];
    const index = list.findIndex((item) => item.videoId === video.videoId);

    if (index !== -1) {
      list.splice(index, 1);
      state.savedIds.delete(video.videoId);
    } else {
      const summary = outlierSummary(video, payload);
      summary.savedAt = Date.now();
      list.unshift(summary);
      state.savedIds.add(video.videoId);
    }

    await S.storageSet({ "of:savedVideos": list.slice(0, 500) });
    return state.savedIds.has(video.videoId);
  }

  function isSaved(videoId) {
    return state.savedIds.has(videoId);
  }

  function handleRuntimeMessage(message, sender, sendResponse) {
    if (!message || !message.type) return;

    if (message.type === "OF_GET_STATS") {
      sendResponse({
        ok: true,
        stats: statsSnapshot(),
        outliers: state.recent,
        enabled: state.enabled
      });
      return;
    }

    if (message.type === "OF_RESCAN") {
      state.results.clear();
      state.stats.outliers = 0;
      state.stats.highestScore = 0;
      if (state.observer) state.observer.reset();
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "OF_SET_ENABLED") {
      S.saveSettings(Object.assign({}, state.settings, { enabled: !!message.enabled }))
        .then((settings) => {
          state.settings = settings;
          state.enabled = settings.enabled;
          reapplySettings();
          sendResponse({ ok: true, enabled: state.enabled });
        })
        .catch(() => sendResponse({ ok: false }));
      return true;
    }
  }

  async function init() {
    if (state.started) return;
    state.started = true;

    const [settings, saved] = await Promise.all([S.getSettings(), S.storageGet("of:savedVideos")]);
    state.settings = settings;
    state.enabled = settings.enabled;

    if (Array.isArray(saved["of:savedVideos"])) {
      for (const item of saved["of:savedVideos"]) {
        if (item && item.videoId) state.savedIds.add(item.videoId);
      }
    }

    state.badgeManager = new OF.BadgeManager({
      onToggleSave: toggleSave,
      isSaved
    });

    state.observer = new OF.VideoObserver({
      onVideo: (video) => {
        processVideo(video);
      },
      scanDebounceMs: 320
    });

    S.onSettingsChanged(handleSettingsChange);
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes["of:savedVideos"]) return;
      const list = Array.isArray(changes["of:savedVideos"].newValue) ? changes["of:savedVideos"].newValue : [];
      state.savedIds = new Set(list.map((item) => item && item.videoId).filter(Boolean));
    });
    root.addEventListener("pagehide", flushStats);
    root.addEventListener("beforeunload", flushStats);

    if (state.enabled) {
      state.observer.start();
    }

    flushStats();
    console.info("[Outlier Finder v" + chrome.runtime.getManifest().version + "] active — scanning YouTube video cards.");
  }

  OF.state = state;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(typeof globalThis !== "undefined" ? globalThis : this);

(function () {
  "use strict";

  const OF = globalThis.OutlierFinder;
  const C = OF.calculator;

  const els = {
    enabled: document.getElementById("ofp-enabled"),
    subtitle: document.getElementById("ofp-subtitle"),
    status: document.getElementById("ofp-status"),
    statusDetail: document.getElementById("ofp-status-detail"),
    scanned: document.getElementById("ofp-scanned"),
    outliers: document.getElementById("ofp-outliers"),
    highest: document.getElementById("ofp-highest"),
    channels: document.getElementById("ofp-channels"),
    list: document.getElementById("ofp-list"),
    listCount: document.getElementById("ofp-list-count"),
    empty: document.getElementById("ofp-empty"),
    emptyTitle: document.getElementById("ofp-empty-title"),
    emptyText: document.getElementById("ofp-empty-text"),
    filters: Array.from(document.querySelectorAll(".ofp-chip")),
    options: document.getElementById("ofp-options"),
    clear: document.getElementById("ofp-clear"),
    saved: document.getElementById("ofp-saved"),
    platform: document.getElementById("ofp-platform"),
    metric: document.getElementById("ofp-metric")
  };

  const state = {
    settings: OF.settings.normalizeSettings(OF.settings.DEFAULTS),
    stats: { scanned: 0, outliers: 0, highestScore: 0, channels: 0, unavailable: 0, enabled: true },
    storedOutliers: [],
    liveOutliers: [],
    savedIds: new Set(),
    filter: "all",
    tabId: null,
    isSupportedTab: false,
    connected: false,
    platform: null,
    platformFilter: "all",
    metricFilter: "all"
  };

  function storageGet(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => resolve(result || {}));
    });
  }

  function getActiveTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve(tabs && tabs[0] ? tabs[0] : null);
      });
    });
  }

  function sendToTab(tabId, message) {
    return new Promise((resolve) => {
      if (typeof tabId !== "number") return resolve(null);
      try {
        chrome.tabs.sendMessage(tabId, message, (response) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(response || null);
        });
      } catch (error) {
        resolve(null);
      }
    });
  }

  function sendToBackground(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(response || null);
        });
      } catch (error) {
        resolve(null);
      }
    });
  }


  function mergeOutliers() {
    const map = new Map();
    for (const item of state.storedOutliers) {
      if (item && item.videoId) map.set(item.videoId, item);
    }
    for (const item of state.liveOutliers) {
      if (item && item.videoId) map.set(item.videoId, item);
    }
    return Array.from(map.values()).sort((a, b) => (b.detectedAt || 0) - (a.detectedAt || 0));
  }

  function renderStats() {
    els.scanned.textContent = String(state.stats.scanned || 0);
    els.outliers.textContent = String(state.stats.outliers || 0);
    els.channels.textContent = String(state.stats.channels || 0);
    els.highest.textContent = state.stats.highestScoreText || (state.stats.highestScore > 0 ? C.formatScore(state.stats.highestScore) + "x" : "—");
  }

  function scoreClass(category) {
    if (category === "potential") return "is-potential";
    if (category === "strong") return "is-strong";
    if (category === "massive") return "is-massive";
    return "";
  }

  function createCard(item) {
    const card = document.createElement("a");
    card.className = "ofp-card";
    card.href = item.videoUrl || "https://www.youtube.com/watch?v=" + item.videoId;
    card.target = "_blank";
    card.rel = "noopener noreferrer";
    card.title = item.title || "Untitled video";

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "ofp-card-thumb-wrap";

    if (item.thumbnailUrl) {
      const img = document.createElement("img");
      img.className = "ofp-card-thumb";
      img.src = item.thumbnailUrl;
      img.alt = "";
      img.loading = "lazy";
      thumbWrap.appendChild(img);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "ofp-card-thumb";
      thumbWrap.appendChild(placeholder);
    }

    const score = document.createElement("span");
    score.className = "ofp-card-score " + scoreClass(item.category);
    score.textContent = item.scoreText || C.formatScore(item.score) + "x";
    thumbWrap.appendChild(score);

    const body = document.createElement("div");
    body.className = "ofp-card-body";

    const title = document.createElement("div");
    title.className = "ofp-card-title";
    title.textContent = item.title || "Untitled video";

    const channel = document.createElement("div");
    channel.className = "ofp-card-channel";
    channel.textContent = (OF.social.LABELS[item.platform || "youtube"] || "") + " · " + (item.channelName || "Unknown creator");

    const meta = document.createElement("div");
    meta.className = "ofp-card-meta";

    const views = document.createElement("span");
    views.textContent = C.formatCount(item.metricCount ?? item.views) + (item.metric === "likes" ? " likes" : " views");
    const subs = document.createElement("span");
    subs.textContent = C.formatCount(item.followerCount ?? item.subscriberCount) + (item.platform && item.platform !== "youtube" ? " followers" : " subs");

    meta.appendChild(views);
    meta.appendChild(subs);

    body.appendChild(title);
    body.appendChild(channel);
    body.appendChild(meta);

    card.appendChild(thumbWrap);
    card.appendChild(body);
    return card;
  }

  function renderList() {
    const all = mergeOutliers();
    const threshold = state.filter === "all" ? 0 : Number(state.filter);
    const filtered = all.filter((item) =>
      (state.platformFilter === "all" || (item.platform || "youtube") === state.platformFilter) &&
      (state.metricFilter === "all" || (item.metric || "views") === state.metricFilter) &&
      (state.filter === "all" || (item.metric !== "likes" && Number(item.score) >= threshold))
    );

    els.list.textContent = "";
    const fragment = document.createDocumentFragment();
    for (const item of filtered.slice(0, 60)) {
      fragment.appendChild(createCard(item));
    }
    els.list.appendChild(fragment);

    els.listCount.textContent = String(filtered.length);

    if (filtered.length === 0) {
      els.empty.classList.remove("is-hidden");
      if (state.filter === "all") {
        els.emptyTitle.textContent = "No outliers yet";
        els.emptyText.textContent = "Browse YouTube, X or Instagram. Qualifying posts will appear here.";
      } else {
        els.emptyTitle.textContent = "Nothing at this level";
        els.emptyText.textContent = "No detected views-based outliers score " + state.filter + "x or higher yet. Try a lower filter.";
      }
    } else {
      els.empty.classList.add("is-hidden");
    }
  }

  function renderSaved() {
    els.saved.textContent = state.savedIds.size + " saved";
  }

  function renderSubtitle() {
    const version = chrome.runtime.getManifest().version;
    const platformLabel = OF.social.LABELS[state.platform] || "a supported site";
    els.subtitle.textContent = "v" + version + (state.connected ? " · Connected to " + platformLabel : " · Waiting for a supported tab");
    if (!state.settings.enabled || (state.platform === "x" && !state.settings.xEnabled) || (state.platform === "instagram" && !state.settings.instagramEnabled)) {
      els.status.textContent = "Detection is paused";
      els.statusDetail.textContent = "Enable the switch to scan videos.";
    } else if (!state.isSupportedTab) {
      els.status.textContent = "Open YouTube, X or Instagram to start scanning";
      els.statusDetail.textContent = "Scores appear directly on post cards and thumbnails.";
    } else if (!state.connected) {
      els.status.textContent = "The extension is not connected to this tab";
      els.statusDetail.textContent = "Refresh " + platformLabel + " after installing or reloading the extension.";
    } else if (state.stats.version !== version) {
      els.status.textContent = "This tab is running an older extension version";
      els.statusDetail.textContent = "Refresh " + platformLabel + " to load version " + version + ".";
    } else {
      const scored = state.stats.scored || 0;
      const pending = state.stats.pending || 0;
      const unavailable = state.stats.unavailable || 0;
      els.status.textContent = scored + " scored · " + pending + " waiting · " + unavailable + " unavailable";
      if (state.stats.lastError) {
        const reader = state.stats.xReader;
        els.statusDetail.textContent = reader
          ? "X reader: " + (reader.fetchRequests + reader.xhrRequests) + " requests, " + reader.matchingRequests + " matching, " + reader.responses + " responses, " + reader.authorRecords + " author counts. " + state.stats.lastError
          : "Data lookup: " + state.stats.lastError + ". Use Clear cache to retry.";
      } else if (!state.stats.scanned) {
        els.statusDetail.textContent = "No supported post cards found yet. Scroll to load posts.";
      } else {
        els.statusDetail.textContent = pending ? "Retrieving public audience counts…" : "Views ratios use x; likes engagement uses %. Scores appear directly on cards.";
      }
    }
  }

  async function refreshTab() {
    if (!state.isSupportedTab) return;
    const response = await sendToTab(state.tabId, { type: "OF_GET_STATS" });
    state.connected = !!(response && response.ok);
    if (state.connected) {
      state.stats = Object.assign({}, state.stats, response.stats || {});
      state.liveOutliers = Array.isArray(response.outliers) ? response.outliers : [];
    }
    render();
  }

  function render() {
    els.enabled.checked = !!state.settings.enabled;
    renderSubtitle();
    renderStats();
    renderList();
    renderSaved();
  }

  async function load() {
    const [settings, stored, tab] = await Promise.all([
      OF.settings.getSettings(),
      storageGet(["of:recentOutliers", "of:savedVideos", "of:lastStats"]),
      getActiveTab()
    ]);

    state.settings = settings;
    state.storedOutliers = Array.isArray(stored["of:recentOutliers"]) ? stored["of:recentOutliers"] : [];
    state.savedIds = new Set(
      (Array.isArray(stored["of:savedVideos"]) ? stored["of:savedVideos"] : [])
        .map((item) => item && item.videoId)
        .filter(Boolean)
    );
    if (stored["of:lastStats"]) state.stats = Object.assign({}, state.stats, stored["of:lastStats"]);

    state.platform = tab && OF.social.platformFromUrl(tab.url);
    if (tab && state.platform) {
      state.tabId = tab.id;
      state.isSupportedTab = true;
      await refreshTab();
    }

    render();
  }

  els.enabled.addEventListener("change", async () => {
    const settings = Object.assign({}, state.settings, { enabled: els.enabled.checked });
    state.settings = settings;
    await OF.settings.saveSettings(settings);
    renderSubtitle();
  });

  for (const chip of els.filters) {
    chip.addEventListener("click", () => {
      state.filter = chip.dataset.filter;
      for (const other of els.filters) other.classList.toggle("is-active", other === chip);
      renderList();
    });
  }

  els.platform.addEventListener("change", () => { state.platformFilter = els.platform.value; renderList(); });
  els.metric.addEventListener("change", () => { state.metricFilter = els.metric.value; renderList(); });

  els.options.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  els.clear.addEventListener("click", async () => {
    els.clear.disabled = true;
    els.clear.textContent = "Clearing…";
    const response = await sendToBackground({ type: "CLEAR_CACHE" });
    if (state.tabId) await sendToTab(state.tabId, { type: "OF_RESCAN" });
    await refreshTab();
    els.clear.textContent = response && response.ok ? "Cleared" : "Failed";
    setTimeout(() => {
      els.clear.disabled = false;
      els.clear.textContent = "Clear cache";
    }, 1400);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    if (changes.settings && changes.settings.newValue) {
      state.settings = OF.settings.normalizeSettings(changes.settings.newValue);
      els.enabled.checked = !!state.settings.enabled;
      renderSubtitle();
    }

    if (changes["of:recentOutliers"]) {
      const value = changes["of:recentOutliers"].newValue;
      state.storedOutliers = Array.isArray(value) ? value : [];
      renderList();
    }

    if (changes["of:savedVideos"]) {
      const value = changes["of:savedVideos"].newValue;
      state.savedIds = new Set(
        (Array.isArray(value) ? value : []).map((item) => item && item.videoId).filter(Boolean)
      );
      renderSaved();
    }

    if (changes["of:lastStats"] && !state.isSupportedTab) {
      state.stats = Object.assign({}, state.stats, changes["of:lastStats"].newValue || {});
      renderStats();
    }
  });

  const refreshTimer = setInterval(() => refreshTab().catch(() => {}), 1500);
  window.addEventListener("pagehide", () => clearInterval(refreshTimer), { once: true });

  load().catch(() => {
    render();
  });
})();

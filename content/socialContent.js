(function (root) {
  "use strict";
  const OF = root.OutlierFinder;
  const S = OF.social;
  const C = OF.calculator;
  const platform = S.platformFromUrl(root.location.href);
  const state = { settings: null, observer: null, badges: null, cards: new Map(), results: new Map(), pending: new Map(), growth: new Map(), sampledViews: new Map(), profiles: new Map(), observed: new Map(), seen: new Set(), creators: new Set(), recent: new Map(), saved: new Set(), revision: 0, timer: null };
  OF.socialState = state;

  function message(value) {
    return new Promise((resolve) => {
      try { chrome.runtime.sendMessage(value, (response) => resolve(chrome.runtime.lastError ? null : response)); }
      catch (error) { resolve(null); }
    });
  }

  function enabled() { return state.settings && state.settings.enabled && state.settings[platform === "x" ? "xEnabled" : "instagramEnabled"] && !S.privateSurface(root.location.href); }

  function stats() {
    const results = [...state.results.values()].map((entry) => entry.payload);
    const scored = results.filter((item) => item.state === "scored");
    const outliers = scored.filter((item) => item.eligible);
    const errors = {};
    for (const item of results) if (item.reason) errors[item.reason] = (errors[item.reason] || 0) + 1;
    const viewScores = scored.filter((item) => item.metric === "views").map((item) => item.score);
    const engagement = scored.filter((item) => item.metric === "likes").sort((a, b) => b.score - a.score)[0];
    return { platform, xReader: platform === "x" && OF.xTimeline ? OF.xTimeline.diagnostics() : null, scanned: state.seen.size, channels: state.creators.size, scored: scored.length,
      outliers: outliers.length, highestScore: Math.max(0, ...viewScores),
      highestScoreText: viewScores.length ? S.scoreText(Math.max(...viewScores), "views") : engagement ? engagement.scoreText : "—",
      unavailable: results.filter((item) => item.state === "unavailable").length, pending: state.pending.size,
      errors, lastError: Object.keys(errors).pop() || "", version: chrome.runtime.getManifest().version,
      enabled: !!enabled(), updatedAt: Date.now() };
  }

  function flush() {
    if (state.timer) return;
    state.timer = setTimeout(() => { state.timer = null; message({ type: "UPDATE_STATS", stats: stats() }); }, 250);
  }

  function render(post, payload) {
    if (!enabled() || !post.cardElement.isConnected) return;
    if (post.isReelViewer && !OF.socialExtractor.isCurrentReel(post.cardElement, post.videoId, post.mediaElement)) return;
    const current = OF.extractor.getCardVideoId(post.cardElement);
    if (!current || current.videoId !== post.videoId) return;
    post.cardElement.dataset.ofBadgeExpected = payload.display && state.settings.badgeVisible ? "1" : "0";
    post.cardElement.dataset.ofState = payload.state;
    post.cardElement.dataset.ofReason = payload.reason || "";
    state.badges.render(post, Object.assign({}, payload, { settings: state.settings, growth: state.growth.get(post.videoId) || null }));
    const badge = (post.thumbnailElement || post.cardElement).querySelector(".of-badge");
    if (badge && post.isReelViewer) badge.classList.add("of-badge--reel");
    else if (badge && !post.cardElement.matches("a")) {
      badge.classList.add("of-badge--post");
      if (platform === "instagram" && post.cardElement.dataset.ofGridTile !== "1" && badge.parentElement === post.cardElement && post.cardElement.firstElementChild !== badge) post.cardElement.prepend(badge);
    }
  }

  function summary(post, payload) {
    return { platform, postId: post.postId, videoId: post.videoId, videoUrl: post.videoUrl,
      title: post.title, thumbnailUrl: post.thumbnailUrl, channelName: post.channel ? post.channel.name : "Unknown creator",
      channelId: post.channel ? post.channel.key : null, subscriberCount: payload.subscriberCount,
      followerCount: payload.subscriberCount, views: post.views, likes: post.likes,
      metric: payload.metric, metricCount: payload.primaryCount, score: payload.score, scoreText: payload.scoreText,
      category: payload.classification ? payload.classification.category : null,
      publishedText: post.publishedText, ageDays: post.ageDays, detectedAt: Date.now() };
  }

  function store(post, payload, signature) {
    state.results.set(post.videoId, { payload, signature, revision: state.revision,
      expiresAt: Date.now() + (payload.state === "scored" ? state.settings.cache.viewsMs : state.settings.cache.failureMs) });
    if (state.results.size > 1000) state.results.delete(state.results.keys().next().value);
    for (const candidate of state.cards.values()) if (candidate.videoId === post.videoId) render(candidate, payload);
    if (payload.eligible) {
      const item = summary(post, payload);
      state.recent.set(post.videoId, item);
      if (state.recent.size > 100) state.recent.delete(state.recent.keys().next().value);
      message({ type: "RECORD_OUTLIER", outlier: item });
    } else state.recent.delete(post.videoId);
    flush();
  }

  function unavailable(post, reason, signature) {
    store(post, { state: "unavailable", score: null, scoreText: "N/A", classification: null,
      eligible: false, display: state.settings.showAllScores || state.settings.showUnavailable,
      reason, platformLabel: S.LABELS[platform], audienceLabel: "Followers",
      metric: post.views !== null ? "views" : "likes",
      metricLabel: post.views !== null ? "Views" : "Likes",
      primaryCount: post.views ?? post.likes,
      primaryText: Number.isFinite(post.views ?? post.likes) ? C.formatCount(post.views ?? post.likes) : "Unavailable",
      views: post.views, viewsText: Number.isFinite(post.views) ? C.formatCount(post.views) + " views" : "Unavailable",
      subscriberCount: null, subscriberText: "Unavailable",
      formulaNote: post.views !== null ? "Post views ÷ creator followers. The follower count is missing, so a ratio cannot yet be calculated." : "Likes ÷ creator followers, shown as a percentage. A readable like count and follower count are required."
    }, signature);
  }

  async function processPost(post, force) {
    if (!enabled() || !post) return;
    if (post.isReelViewer && !OF.socialExtractor.isCurrentReel(post.cardElement, post.videoId, post.mediaElement)) return;
    state.cards.set(post.cardElement, post);
    state.seen.add(post.videoId);
    if (platform === "x" && Number.isSafeInteger(post.views) && state.sampledViews.get(post.videoId) !== post.views) {
      state.sampledViews.set(post.videoId, post.views);
      message({ type: "OBSERVE_X_GROWTH", postId: post.postId, views: post.views }).then(response => {
        if (!response?.ok || !enabled()) return;
        state.growth.set(post.videoId, response.growth);
        const payload = state.results.get(post.videoId)?.payload;
        if (payload) for (const current of state.cards.values()) if (current.videoId === post.videoId) render(current, payload);
      });
    }
    const signature = JSON.stringify([post.views, post.likes, post.channel && post.channel.key, post.channel && post.channel.followerCount]);
    const cached = state.results.get(post.videoId);
    if (!force && cached && cached.signature === signature && cached.revision === state.revision && cached.expiresAt > Date.now()) {
      render(post, cached.payload); return;
    }
    const existing = state.pending.get(post.videoId);
    if (existing) {
      if (!cached) render(post, { state: "loading", display: state.settings.badgeVisible });
      existing.then(() => { if (post.cardElement.isConnected) processPost(post, force); });
      return;
    }
    if (post.metadataRestricted) { unavailable(post, "Instagram hides this post's counts or restricts the post", signature); return; }
    const readable = post.views !== null || (state.settings.socialLikeFallback && post.likes !== null);
    if (!readable && platform !== "instagram") {
      unavailable(post, "No public view count" + (state.settings.socialLikeFallback ? " or readable like count" : "") + " on this post", signature); return;
    }
    if (!post.channel && platform !== "instagram") { unavailable(post, "Post author unavailable on this card", signature); return; }
    if (post.channel) state.creators.add(post.channel.key);
    const revision = state.revision;
    render(post, { state: "loading", display: state.settings.badgeVisible });
    const promise = (async () => {
      try {
        if (platform === "instagram" && (!readable || !post.channel)) {
          const response = await message({ type: "GET_INSTAGRAM_POST", postId: post.postId });
          if (revision !== state.revision || !enabled() || (post.isReelViewer && !OF.socialExtractor.isCurrentReel(post.cardElement, post.videoId, post.mediaElement))) return;
          if (!response || !response.ok) { unavailable(post, response && response.error || "Instagram post metadata lookup did not respond", signature); return; }
          const data = response.post;
          post = Object.assign({}, post, { views: post.views ?? data.views, likes: post.likes ?? data.likes, channel: data.profile || post.channel });
          post.channelRef = post.channel;
          state.cards.set(post.cardElement, post);
        }
        if (post.views === null && (!state.settings.socialLikeFallback || post.likes === null)) {
          unavailable(post, "No readable public view count" + (state.settings.socialLikeFallback ? " or like count" : "") + " in this post's metadata", signature); return;
        }
        if (!post.channel) { unavailable(post, "Post author unavailable in public post metadata", signature); return; }
        state.creators.add(post.channel.key);
        const existingAudience = state.profiles.get(post.channel.key);
        if (Number.isFinite(post.channel.followerCount) && (!existingAudience || existingAudience.expiresAt <= Date.now())) {
          const data = Object.assign({}, post.channel);
          state.profiles.set(post.channel.key, { data, expiresAt: Date.now() + state.settings.cache.subscriberMs });
          const observedCount = String(data.followerCount);
          if (!state.observed.has(post.channel.key)) {
            state.observed.set(post.channel.key, observedCount);
            message({ type: "CACHE_SOCIAL_PROFILE", ref: data, followerCount: data.followerCount, approximate: !!data.approximate, source: data.source });
          }
        }
        let profile = state.profiles.get(post.channel.key);
        if (!profile || profile.expiresAt <= Date.now()) {
          const response = await message({ type: "GET_SOCIAL_PROFILE", ref: post.channel });
          if (revision !== state.revision || !enabled() || (post.isReelViewer && !OF.socialExtractor.isCurrentReel(post.cardElement, post.videoId, post.mediaElement))) return;
          if (!response || !response.ok) { unavailable(post, response && response.error || "Profile lookup did not respond", signature); return; }
          profile = { data: response.profile, expiresAt: Date.now() + state.settings.cache.subscriberMs };
          state.profiles.set(post.channel.key, profile);
        }
        if (revision !== state.revision || !enabled() || (post.isReelViewer && !OF.socialExtractor.isCurrentReel(post.cardElement, post.videoId, post.mediaElement))) return;
        const evaluation = S.evaluatePost(post, profile.data, state.settings);
        if (evaluation.score === null) { unavailable(post, "Follower count is unavailable or zero", signature); return; }
        const likes = evaluation.metric === "likes";
        const payload = Object.assign({}, evaluation, {
          state: "scored", display: state.settings.showAllScores || (evaluation.eligible && evaluation.classification.enabled),
          primaryCount: evaluation.metricCount, metricLabel: likes ? "Likes" : "Views", audienceLabel: "Followers",
          primaryText: C.formatCount(evaluation.metricCount), subscriberCount: evaluation.followerCount,
          subscriberText: C.formatCount(evaluation.followerCount) + " followers",
          views: post.views, viewsText: post.views !== null ? C.formatCount(post.views) + " views" : "Unavailable",
          approximateSubscribers: !!profile.data.approximate, viewsPerDay: likes ? null : C.calculateViewsPerDay(post.views, post.ageDays),
          platformLabel: S.LABELS[platform], badgeLabel: likes ? "ENGAGEMENT" : undefined,
          formulaNote: likes ? "Likes ÷ followers, shown as a percentage. This uses separate engagement thresholds." : "Post views ÷ creator followers. Rounded public counts make this ratio an estimate."
        });
        store(post, payload, signature);
      } catch (error) { if (revision === state.revision) unavailable(post, "Unexpected post extraction error", signature); }
    })().finally(() => { if (state.pending.get(post.videoId) === promise) state.pending.delete(post.videoId); flush(); });
    state.pending.set(post.videoId, promise);
    flush();
  }

  function refreshProfile(key, profile) {
    state.profiles.set(key, { data: profile, expiresAt: Date.now() + state.settings.cache.subscriberMs });
    for (const post of state.cards.values()) {
      if (post.channel && post.channel.key === key) {
        state.results.delete(post.videoId);
        processPost(post, true);
      }
    }
  }

  function onScan() {
    for (const [card] of state.cards) if (!card.isConnected) state.cards.delete(card);
    if (!enabled()) { state.badges.removeAll(); return; }
    OF.socialExtractor.collectEmbeddedPosts();
    for (const observed of OF.socialExtractor.visibleProfiles()) {
      const signature = String(observed.followerCount);
      if (state.observed.get(observed.ref.key) === signature) continue;
      state.observed.set(observed.ref.key, signature);
      message({ type: "CACHE_SOCIAL_PROFILE", ref: observed.ref, followerCount: observed.followerCount, approximate: observed.approximate })
        .then((response) => { if (response && response.ok) refreshProfile(observed.ref.key, response.profile); });
    }
  }

  async function toggleSave(post, payload) {
    const stored = await OF.settings.storageGet("of:savedVideos");
    const list = Array.isArray(stored["of:savedVideos"]) ? stored["of:savedVideos"] : [];
    const index = list.findIndex((item) => item.videoId === post.videoId);
    if (index < 0) { list.unshift(Object.assign(summary(post, payload), { savedAt: Date.now() })); state.saved.add(post.videoId); }
    else { list.splice(index, 1); state.saved.delete(post.videoId); }
    await OF.settings.storageSet({ "of:savedVideos": list.slice(0, 500) });
    return state.saved.has(post.videoId);
  }

  function reapply(settings) {
    state.settings = settings; state.revision += 1;
    state.results.clear(); state.recent.clear();
    const watch = settings.enabled && settings[platform === "x" ? "xEnabled" : "instagramEnabled"];
    if (!watch) { state.observer.stop(); state.badges.removeAll(); }
    else {
      state.observer.start();
      if (!enabled()) state.badges.removeAll();
      else { for (const post of state.cards.values()) processPost(post, true); state.observer.reset(); }
    }
    flush();
  }

  async function init() {
    state.settings = await OF.settings.getSettings();
    const saved = await OF.settings.storageGet("of:savedVideos");
    state.saved = new Set((saved["of:savedVideos"] || []).map((item) => item.videoId));
    state.badges = new OF.BadgeManager({ onToggleSave: toggleSave, onSetFollowers: async (post, count) => {
      const response = await message({ type: "CACHE_SOCIAL_PROFILE", ref: post.channel, followerCount: count, approximate: true, source: "user-entered" });
      if (!response || !response.ok) throw new Error("Could not save the follower count");
      refreshProfile(post.channel.key, response.profile);
    }, isSaved: (id) => state.saved.has(id) });
    state.observer = new OF.VideoObserver({ onVideo: processPost, onScan, watchNavigation: true, watchScroll: true });
    OF.settings.onSettingsChanged(reapply);
    if (platform === "x") root.addEventListener("of-x-counts-ready", () => {
      if (!enabled()) return;
      for (const card of state.cards.keys()) {
        const post = OF.extractor.extractVideoCard(card);
        if (post && Number.isFinite(post.channel && post.channel.followerCount)) processPost(post, true);
      }
      state.observer.reset();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      for (const [key, value] of Object.entries(changes)) {
        if (key.startsWith("of:channel:" + platform + ":") && value.newValue && value.newValue.data) refreshProfile(key.slice("of:channel:".length), value.newValue.data);
      }
      if (changes["of:savedVideos"]) state.saved = new Set((changes["of:savedVideos"].newValue || []).map((item) => item.videoId));
    });
    chrome.runtime.onMessage.addListener((request, sender, respond) => {
      if (request.type === "OF_GET_STATS") respond({ ok: true, stats: stats(), outliers: [...state.recent.values()], enabled: !!enabled() });
      if (request.type === "OF_RESCAN") {
        state.results.clear(); state.profiles.clear(); state.observed.clear(); state.sampledViews.clear(); state.revision += 1;
        for (const post of state.cards.values()) processPost(post, true);
        state.observer.reset(); respond({ ok: true });
      }
    });
    if (state.settings.enabled && state.settings[platform === "x" ? "xEnabled" : "instagramEnabled"]) state.observer.start();
    console.info("[Outlier Finder v" + chrome.runtime.getManifest().version + "] scanning " + S.LABELS[platform] + " posts");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(typeof globalThis !== "undefined" ? globalThis : this);

(function () {
  "use strict";
  // Runs in X's page world. Read only selected public timeline responses;
  // never inspect headers, cookies, request bodies, or messaging responses.
  if (window.__ofTimelineReaderVersion === "1.3.0" && window.__ofTimelineDiagnostics) return;
  window.__ofTimelineReaderVersion = "1.3.0";
  window.__ofTimelineReader = true;
  const operations = new Set(["SearchTimeline", "ExplorePage", "ExplorePageLatest", "HomeTimeline", "HomeLatestTimeline", "TweetDetail", "UserTweets", "UserTweetsAndReplies", "UserMedia", "ListLatestTweetsTimeline"]);
  const trendingOperations = new Set(["GenericTimelineById", "AiTrendByRestId"]);
  const trendingPage = () => /^\/i\/trending\/\d+(?:\/|$)/.test(location.pathname);
  let enabled = false;
  const records = new Map();
  const diagnostics = window.__ofTimelineDiagnostics = {
    enabled: false, fetchRequests: 0, xhrRequests: 0, matchingRequests: 0,
    responses: 0, parseErrors: 0, authorRecords: 0, operations: [], userFields: [], relationshipFields: []
  };
  function report() {
    window.postMessage({ type: "OF_X_READER_STATUS", status: { ...diagnostics } }, location.origin);
  }
  function observeRequest(value, transport) {
    if (!enabled || privatePage()) return;
    diagnostics[transport === "fetch" ? "fetchRequests" : "xhrRequests"]++;
    try {
      const url = new URL(value, location.href);
      const match = url.origin === location.origin && url.pathname.match(/\/graphql\/[^/]+\/([a-zA-Z0-9_]+)\/?$/);
      if (match && !diagnostics.operations.includes(match[1]) && diagnostics.operations.length < 30) diagnostics.operations.push(match[1]);
    } catch (error) { /* No URL contents are retained. */ }
    if (allowed(value)) diagnostics.matchingRequests++;
    report();
  }
  const privatePage = () => /^\/(messages|i\/chat|i\/flow|settings)(\/|$)/.test(location.pathname);
  function allowed(value) {
    try {
      const url = new URL(value, location.href);
      const match = url.pathname.match(/^\/(?:i\/api\/)?graphql\/[^/]+\/([^/]+)$/);
      return enabled && !privatePage() && url.origin === location.origin && match && (operations.has(match[1]) || (trendingPage() && trendingOperations.has(match[1])));
    } catch (error) { return false; }
  }
  function publish(posts) {
    if (posts.length && enabled && !privatePage()) window.postMessage({ type: "OF_X_PUBLIC_POSTS", posts }, location.origin);
  }
  function consume(data) {
    if (!enabled || privatePage()) return;
    diagnostics.responses++;
    const stack = [data], fresh = [];
    let visited = 0;
    while (stack.length && visited++ < 50000) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      const user = node.core && node.core.user_results && node.core.user_results.result;
      const legacy = user && user.legacy;
      if (user && diagnostics.userFields.length === 0) diagnostics.userFields = Object.keys(user).filter(key => /^[a-zA-Z_]+$/.test(key)).slice(0, 30);
      const username = user && ((user.core && user.core.screen_name) || (legacy && legacy.screen_name));
      const relationships = user && user.relationship_counts;
      if (relationships && diagnostics.relationshipFields.length === 0) diagnostics.relationshipFields = Object.keys(relationships).filter(key => /^[a-zA-Z_]+$/.test(key)).slice(0, 30);
      const followerCount = relationships?.followers ?? relationships?.followers_count ?? relationships?.follower_count ?? legacy?.followers_count;
      const postId = node.rest_id || (node.legacy && node.legacy.id_str);
      if (typeof postId === "string" && /^\d{1,25}$/.test(postId) && typeof username === "string" && /^[a-z0-9_]{1,15}$/i.test(username) && Number.isInteger(followerCount) && followerCount >= 0 && followerCount <= 1e12 && legacy?.protected !== true && user.protected !== true && !(user.privacy && user.privacy.protected)) {
        const post = { postId, username: username.toLowerCase(), followerCount };
        const rawViews = node.views?.count;
        const views = typeof rawViews === "string" && /^\d+$/.test(rawViews) ? Number(rawViews) : rawViews;
        if (Number.isSafeInteger(views) && views >= 0) post.views = views;
        if (records.get(postId)?.followerCount !== followerCount || records.get(postId)?.username !== post.username || records.get(postId)?.views !== post.views) {
          records.set(postId, post); fresh.push(post);
          if (records.size > 500) records.delete(records.keys().next().value);
        }
      }
      for (const child of Object.values(node)) if (child && typeof child === "object") stack.push(child);
    }
    diagnostics.authorRecords = records.size;
    report();
    publish(fresh);
  }
  function consumeText(text) {
    if (typeof text !== "string" || text.length > 10000000) return;
    try { consume(JSON.parse(text)); } catch (error) { diagnostics.parseErrors++; report(); }
  }
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== "OF_X_READER_CONFIG") return;
    enabled = event.data.enabled === true;
    diagnostics.enabled = enabled;
    report();
    if (!enabled) records.clear();
    else publish([...records.values()]);
  });
  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function (...args) {
      const requestUrl = typeof args[0] === "string" || args[0] instanceof URL ? String(args[0]) : args[0]?.url;
      observeRequest(requestUrl, "fetch");
      const read = allowed(requestUrl);
      const pending = Reflect.apply(originalFetch, this, args);
      if (read) Promise.resolve(pending).then(response => {
        if (response.ok && allowed(response.url || requestUrl)) return response.clone().text().then(consumeText);
      }).catch(() => {});
      return pending;
    };
  }
  if (window.XMLHttpRequest) {
    const originalOpen = XMLHttpRequest.prototype.open;
    const urls = new WeakMap(), watched = new WeakSet();
    XMLHttpRequest.prototype.open = function (...args) {
      const result = Reflect.apply(originalOpen, this, args);
      urls.set(this, String(args[1]));
      observeRequest(args[1], "xhr");
      if (!watched.has(this)) {
        watched.add(this);
        this.addEventListener("load", () => {
          if (!allowed(urls.get(this)) || this.status < 200 || this.status >= 300) return;
          try {
            if (this.responseType === "json") consume(this.response);
            else if (!this.responseType || this.responseType === "text") consumeText(this.responseText);
          } catch (error) { /* Leave the page's response untouched. */ }
        });
      }
      return result;
    };
  }
  console.info("[Outlier Finder X reader v1.3.0] initialized");
  window.postMessage({ type: "OF_X_READER_READY" }, location.origin);
})();

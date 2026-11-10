(function (root) {
  "use strict";
  // Isolated world: retain bounded, validated public counts until cards mount.
  const pending = new Map();
  let enabled = false;
  let readerStatus = null;
  const OF = root.OutlierFinder = root.OutlierFinder || {};
  const privatePage = () => /^\/(messages|i\/chat|i\/flow|settings)(\/|$)/.test(location.pathname);
  function configure() {
    root.postMessage({ type: "OF_X_READER_CONFIG", enabled: enabled && !privatePage() }, location.origin);
  }
  OF.xTimeline = {
    diagnostics() { return readerStatus; },
    get(postId, username) {
      const post = pending.get(postId);
      return enabled && !privatePage() && post && post.username === username.toLowerCase() ? post : null;
    }
  };
  root.addEventListener("message", event => {
    if (event.source !== root || event.origin !== location.origin) return;
    if (event.data?.type === "OF_X_READER_READY") { configure(); return; }
    if (enabled && !privatePage() && event.data?.type === "OF_X_READER_STATUS" && event.data.status) {
      const incoming = event.data.status;
      readerStatus = { enabled: incoming.enabled === true };
      for (const key of ["fetchRequests", "xhrRequests", "matchingRequests", "responses", "parseErrors", "authorRecords"]) readerStatus[key] = Number.isSafeInteger(incoming[key]) && incoming[key] >= 0 ? incoming[key] : 0;
      for (const key of ["operations", "userFields", "relationshipFields"]) readerStatus[key] = Array.isArray(incoming[key]) ? incoming[key].filter(value => typeof value === "string" && /^[a-zA-Z0-9_]{1,80}$/.test(value)).slice(0, 30) : [];
      return;
    }
    if (!enabled || privatePage() || event.data?.type !== "OF_X_PUBLIC_POSTS" || !Array.isArray(event.data.posts)) return;
    for (const post of event.data.posts.slice(0, 500)) {
      if (!post || typeof post.postId !== "string" || !/^\d{1,25}$/.test(post.postId) || typeof post.username !== "string" || !/^[a-z0-9_]{1,15}$/i.test(post.username) || !Number.isInteger(post.followerCount) || post.followerCount < 0 || post.followerCount > 1e12) continue;
      pending.set(post.postId, { postId: post.postId, username: post.username.toLowerCase(), followerCount: post.followerCount });
      if (Number.isSafeInteger(post.views) && post.views >= 0) pending.get(post.postId).views = post.views;
      if (pending.size > 500) pending.delete(pending.keys().next().value);
    }
    root.dispatchEvent(new Event("of-x-counts-ready"));
  });
  chrome.storage.local.get("settings", stored => {
    const settings = stored?.settings || {};
    enabled = settings.enabled !== false && settings.xEnabled !== false;
    configure();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.settings) return;
    const settings = changes.settings.newValue || {};
    enabled = settings.enabled !== false && settings.xEnabled !== false;
    if (!enabled) pending.clear();
    configure();
  });
})(globalThis);

(function (root) {
  "use strict";
  const OF = (root.OutlierFinder = root.OutlierFinder || {});
  const V = OF.validator;
  const LABELS = { x: "X", instagram: "Instagram", youtube: "YouTube" };
  const RESERVED = new Set(["home", "explore", "notifications", "messages", "direct", "accounts", "settings", "i", "p", "reel", "reels", "stories", "search", "intent", "share", "about", "privacy", "terms"]);

  function platformFromUrl(value) {
    try {
      const host = new URL(value).hostname.replace(/^www\./, "");
      if (["x.com", "twitter.com"].includes(host)) return "x";
      if (host === "instagram.com") return "instagram";
      if (["youtube.com", "m.youtube.com"].includes(host)) return "youtube";
    } catch (error) { /* Not a supported URL. */ }
    return null;
  }

  function profileRef(platform, username) {
    if (typeof username !== "string") return null;
    username = username.replace(/^@/, "").toLowerCase();
    const valid = platform === "x" ? /^[a-z0-9_]{1,15}$/ : platform === "instagram" ? /^[a-z0-9_.]{1,30}$/ : null;
    if (!valid || !valid.test(username) || RESERVED.has(username)) return null;
    return { platform, username, key: platform + ":" + username,
      url: (platform === "x" ? "https://x.com/" : "https://www.instagram.com/") + username + (platform === "instagram" ? "/" : ""), name: "@" + username };
  }

  function profileFromUrl(value, platform, base) {
    if (!value || typeof value !== "string") return null;
    try {
      const url = new URL(value, base || (platform === "x" ? "https://x.com" : "https://www.instagram.com"));
      if (platformFromUrl(url.href) !== platform) return null;
      const match = url.pathname.match(/^\/([^/]+)\/?$/);
      return match ? profileRef(platform, match[1]) : null;
    } catch (error) { return null; }
  }

  function postRef(value, platform, base) {
    if (!["x", "instagram"].includes(platform)) return null;
    try {
      const url = new URL(value, base || (platform === "x" ? "https://x.com" : "https://www.instagram.com"));
      if (platformFromUrl(url.href) !== platform) return null;
      if (platform === "x") {
        const match = url.pathname.match(/^\/([a-z0-9_]{1,15})\/status\/(\d{1,25})\/?$/i);
        const profile = match && profileRef(platform, match[1]);
        if (!profile) return null;
        return { platform, postId: match[2], videoId: platform + ":" + match[2], profile,
          videoUrl: profile.url + "/status/" + match[2] };
      }
      const match = url.pathname.match(/^\/(?:([a-zA-Z0-9_.]{1,30})\/)?(p|reel|reels)\/([a-zA-Z0-9_-]{3,80})\/?$/);
      if (!match || (match[1] && !profileRef("instagram", match[1]))) return null;
      return { platform, postId: match[3], videoId: platform + ":" + match[3], profile: null,
        profileHint: match[1] ? profileRef("instagram", match[1]) : null,
        videoUrl: "https://www.instagram.com/" + (match[2] === "p" ? "p" : "reel") + "/" + match[3] + "/" };
    } catch (error) { return null; }
  }

  function metricCount(value, metric, allowBare) {
    const text = V.normalizeText(value);
    if (!text) return null;
    const unit = metric === "followers" ? "followers?" : metric === "likes" ? "likes?" : "(?:views?|plays?)";
    const number = "(\\d[\\d.,]*(?:\\s*(?:thousand|million|billion|[KMB]))?)";
    const before = text.match(new RegExp(number + "\\s*" + unit + "\\b", "i"));
    const after = text.match(new RegExp("\\b" + unit + "\\s*:?\\s*" + number, "i"));
    const match = before || after;
    if (match) return V.parseCount(match[1]);
    if (new RegExp("^(?:no|zero)\\s+" + unit + "$", "i").test(text)) return 0;
    if (allowBare && /^\d[\d.,]*(?:\s*(?:thousand|million|billion|[KMB]))?$/i.test(text)) return V.parseCount(text);
    return null;
  }

  function scoreText(score, metric) {
    if (!Number.isFinite(score)) return "N/A";
    if (metric === "likes") {
      const percent = score * 100;
      return percent > 0 && percent < 0.01 ? "<0.01%" : String(Math.round(percent * 100) / 100) + "%";
    }
    if (score > 0 && score < 0.1) return (score < 0.001 ? "<0.001" : String(Math.round(score * 1000) / 1000)) + "x";
    return OF.calculator.formatRatio(score);
  }

  function evaluatePost(post, profile, settings) {
    const followers = profile && profile.followerCount;
    const views = Number.isFinite(post.views) && post.views >= 0 ? post.views : null;
    const likes = Number.isFinite(post.likes) && post.likes >= 0 ? post.likes : null;
    const metric = views !== null ? "views" : settings.socialLikeFallback && likes !== null ? "likes" : null;
    const count = metric === "views" ? views : metric === "likes" ? likes : null;
    const ratio = count !== null && Number.isFinite(followers) && followers > 0 ? count / followers : null;
    const score = Number.isFinite(ratio) ? ratio : null;
    const options = metric === "likes" ? Object.assign({}, settings, {
      minViews: settings.socialMinLikes, minScore: settings.socialMinEngagementPercent / 100,
      thresholds: { aboveAverage: 0.01, potential: 0.02, viral: 0.05, strong: 0.1, massive: 0.2 }
    }) : settings;
    const classification = OF.classification.classifyOutlier(score, count, options);
    const minimums = OF.calculator.meetsMinimums(count, followers, score, options);
    return { score, metric, metricCount: count, followerCount: followers,
      scoreText: scoreText(score, metric),
      classification, eligible: minimums.eligible };
  }

  function privateSurface(value) {
    try { return /^\/(messages|direct|accounts|settings|stories)(\/|$)|^\/i\/(chat|flow)(\/|$)/.test(new URL(value).pathname); }
    catch (error) { return true; }
  }

  // Parse data only: never evaluate page scripts. Match each count to its owner.
  function xProfilesFromScript(text) {
    text = String(text || "").trim();
    const assignment = text.match(/^(?:window\.)?__INITIAL_STATE__\s*=\s*/);
    if (assignment) {
      const start = assignment[0].length;
      let depth = 0, quoted = false, escaped = false, end = -1;
      for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; continue; }
        if (c === '"') quoted = true;
        else if (c === "{") depth++;
        else if (c === "}" && --depth === 0) { end = i + 1; break; }
      }
      if (end < 0) return [];
      text = text.slice(start, end);
    }
    let data;
    try { data = JSON.parse(text); } catch (error) { return []; }
    const stack = [data], found = new Map();
    let visited = 0;
    while (stack.length && visited++ < 50000) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      const legacy = node.legacy || node;
      const username = legacy.screen_name || (node.core && node.core.screen_name);
      const ref = username && profileRef("x", username);
      const count = node.relationship_counts?.followers ?? node.relationship_counts?.followers_count ?? node.relationship_counts?.follower_count ?? legacy.followers_count;
      if (ref && legacy.protected !== true && node.protected !== true && node.privacy?.protected !== true && Number.isInteger(count) && count >= 0 && count <= 1e12) found.set(ref.key, { ref, followerCount: count, approximate: false });
      for (const child of Object.values(node)) if (child && typeof child === "object") stack.push(child);
    }
    return [...found.values()];
  }

  OF.social = { LABELS, platformFromUrl, profileRef, profileFromUrl, postRef, metricCount, evaluatePost, scoreText, privateSurface, xProfilesFromScript };
})(typeof globalThis !== "undefined" ? globalThis : this);

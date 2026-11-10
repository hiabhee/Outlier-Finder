(function (root) {
  "use strict";
  const OF = root.OutlierFinder;
  const S = OF.social;
  const validId = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{3,80}$/.test(value);

  function count(value) {
    if (typeof value === "string" && /^\d+$/.test(value)) value = Number(value);
    return Number.isFinite(value) && value >= 0 && value <= 1e12 && Number.isInteger(value) ? value : null;
  }

  function firstCount(values) {
    for (const value of values) { const number = count(value); if (number !== null) return number; }
    return null;
  }

  function ownerRef(value) {
    if (!value || typeof value !== "object" || value.is_private === true) return null;
    const ref = typeof value.username === "string" ? S.profileRef("instagram", value.username) :
      S.profileFromUrl(typeof value.url === "string" ? value.url : value.url && value.url["@id"], "instagram");
    if (!ref) return null;
    const followers = firstCount([value.follower_count, value.followers_count, value.edge_followed_by && value.edge_followed_by.count]);
    return followers === null ? ref : Object.assign(ref, { followerCount: followers, approximate: false });
  }

  function record(value) {
    if (!value || typeof value !== "object") return null;
    let id = value.shortcode || value.code;
    if (!validId(id)) {
      const ref = S.postRef(typeof value.url === "string" ? value.url : value["@id"], "instagram");
      if (!ref) return null;
      id = ref.postId;
    }
    if (value.is_private === true || (value.owner && value.owner.is_private === true) || (value.user && value.user.is_private === true)) return { postId: id, restricted: true };
    const hidden = value.like_and_view_counts_disabled === true || value.hide_like_and_view_counts === true;
    let views = hidden ? null : firstCount([value.video_view_count, value.video_play_count, value.play_count, value.ig_play_count, value.view_count]);
    let likes = hidden ? null : firstCount([value.like_count, value.edge_media_preview_like && value.edge_media_preview_like.count, value.edge_liked_by && value.edge_liked_by.count, value.edge_media_to_like && value.edge_media_to_like.count]);
    if (!hidden) {
      const stats = Array.isArray(value.interactionStatistic) ? value.interactionStatistic : [value.interactionStatistic];
      for (const stat of stats) {
        if (!stat) continue;
        const action = typeof stat.interactionType === "object" ? stat.interactionType["@type"] || stat.interactionType["@id"] : stat.interactionType;
        if (/^(?:https?:\/\/schema\.org\/)?(?:WatchAction|ViewAction)$/.test(action || "")) views = views ?? count(stat.userInteractionCount);
        if (/^(?:https?:\/\/schema\.org\/)?LikeAction$/.test(action || "")) likes = likes ?? count(stat.userInteractionCount);
      }
    }
    const authors = Array.isArray(value.author) ? value.author : [value.author];
    const profile = ownerRef(value.owner) || ownerRef(value.user) || authors.map(ownerRef).find(Boolean) || ownerRef(value.creator);
    if (views === null && likes === null && !profile && !hidden) return null;
    return { platform: "instagram", postId: id, views, likes, profile, hidden, source: "post-metadata" };
  }

  function collect(value) {
    const records = new Map();
    const stack = [value];
    let visited = 0;
    while (stack.length && visited++ < 100000) {
      const current = stack.pop();
      if (!current || typeof current !== "object") continue;
      const next = record(current);
      if (next) {
        const previous = records.get(next.postId);
        if (!previous || next.restricted || (!previous.restricted && !previous.hidden)) {
          records.set(next.postId, previous && !next.restricted && !next.hidden ? {
            ...previous, views: previous.views ?? next.views, likes: previous.likes ?? next.likes, profile: previous.profile || next.profile
          } : next);
        }
      }
      for (const child of Object.values(current)) if (child && typeof child === "object") stack.push(child);
    }
    return records;
  }

  function jsonBody(text) {
    if (!text || text.length > 5000000) return null;
    try { return JSON.parse(text); } catch (error) { /* Try a legacy public assignment. */ }
    const assignment = text.match(/^(?:window\.)?_sharedData\s*=\s*([\s\S]+?);?\s*$/);
    if (!assignment) return null;
    try { return JSON.parse(assignment[1]); } catch (error) { return null; }
  }

  function decode(text) {
    return String(text || "").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, "&");
  }

  function attributes(tag) {
    const result = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) result[match[1].toLowerCase()] = decode(match[2] === undefined ? match[3] : match[2]);
    return result;
  }

  function parsePostHtml(html, postId) {
    if (!validId(postId)) return null;
    let found = null;
    for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
      const value = jsonBody(match[1]);
      if (!value) continue;
      const candidate = collect(value).get(postId);
      if (!candidate) continue;
      if (candidate.restricted || candidate.hidden) return candidate;
      found = found ? { ...found, views: found.views ?? candidate.views, likes: found.likes ?? candidate.likes, profile: found.profile || candidate.profile } : candidate;
    }
    const metadata = {};
    const identities = [];
    for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
      const attrs = attributes(tag);
      if (attrs.property || attrs.name) metadata[(attrs.property || attrs.name).toLowerCase()] = attrs.content || "";
    }
    if (metadata["og:url"]) identities.push(metadata["og:url"]);
    for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
      const attrs = attributes(tag); if (attrs.rel === "canonical") identities.push(attrs.href);
    }
    const identity = identities.length && identities.every((url) => S.postRef(url, "instagram")?.postId === postId);
    if (identity) {
      // Only the metric prefix precedes the author/date. Caption text never
      // supplies counts, even if it mentions a large number of views or likes.
      for (const description of [metadata["og:description"], metadata.description].filter(Boolean)) {
        const prefix = description.split(/\s[-–]\s/)[0];
        if (!/^\s*[\d.,]+\s*(?:[KMB]|thousand|million|billion)?\s+(?:likes?|views?|plays?)\b/i.test(prefix)) continue;
        found = found || { platform: "instagram", postId, views: null, likes: null, profile: null, source: "public-post-description" };
        found.views = found.views ?? S.metricCount(prefix, "views", false);
        found.likes = found.likes ?? S.metricCount(prefix, "likes", false);
        const author = description.match(/\s[-–]\s([a-z0-9_.]{1,30})\s+on\b/i);
        if (author && !found.profile) found.profile = S.profileRef("instagram", author[1]);
      }
    }
    return found;
  }

  function pageProfile(value) {
    try {
      const url = new URL(value);
      if (S.platformFromUrl(url.href) !== "instagram") return null;
      const match = url.pathname.match(/^\/([^/]+)(?:\/reels)?\/?$/);
      return match ? S.profileRef("instagram", match[1]) : null;
    } catch (error) { return null; }
  }

  OF.instagram = { validId, collect, jsonBody, parsePostHtml, pageProfile };
})(typeof globalThis !== "undefined" ? globalThis : this);

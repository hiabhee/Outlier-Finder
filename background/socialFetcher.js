(function (root) {
  "use strict";
  const OF = root.OutlierFinder;
  const S = OF.social;

  function decode(text) {
    return String(text || "").replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'").replace(/&amp;/gi, "&").replace(/&#(\d+);/g, (_, n) => Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : "").replace(/&#x([a-f0-9]+);/gi, (_, n) => parseInt(n, 16) <= 0x10ffff ? String.fromCodePoint(parseInt(n, 16)) : "");
  }

  function attributes(tag) {
    const result = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) result[match[1].toLowerCase()] = decode(match[2] === undefined ? match[3] : match[2]);
    return result;
  }

  function parseProfileHtml(html, ref) {
    if (ref.platform === "x") {
      for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
        const owner = S.xProfilesFromScript(script[1]).find(entry => entry.ref.key === ref.key);
        if (owner) return Object.assign({}, ref, { followerCount: owner.followerCount, approximate: false, fetchedAt: Date.now(), source: "public-profile" });
      }
    }
    const metadata = {};
    let identity = false;
    for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
      const attrs = attributes(tag);
      if (attrs.property || attrs.name) metadata[(attrs.property || attrs.name).toLowerCase()] = attrs.content || "";
    }
    const urls = [metadata["og:url"]];
    for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
      const attrs = attributes(tag);
      if (attrs.rel === "canonical") urls.push(attrs.href);
    }
    for (const url of urls.filter(Boolean)) {
      const owner = S.profileFromUrl(url, ref.platform);
      if (owner && owner.key === ref.key) identity = true;
      else return null;
    }
    const escapedUsername = ref.username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp("@" + escapedUsername + "(?![a-z0-9_.])", "i").test(metadata["og:title"] || "")) identity = true;
    const candidates = [];
    for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
      let value;
      try { value = JSON.parse(match[1]); } catch (error) { continue; }
      const stack = [value];
      let visited = 0;
      while (stack.length && visited++ < 50000) {
        const current = stack.pop();
        if (!current || typeof current !== "object") continue;
        const username = current.screen_name || current.username || current.alternateName;
        const nodeRef = typeof username === "string" ? S.profileRef(ref.platform, username) : S.profileFromUrl(current.url, ref.platform);
        if (nodeRef && nodeRef.key === ref.key) {
          identity = true;
          if (current.is_private === true || current.protected === true) return null;
          const count = current.followers_count ?? current.follower_count ?? (current.edge_followed_by && current.edge_followed_by.count);
          if (Number.isFinite(count) && count >= 0) candidates.push({ count, approximate: false });
          const stats = Array.isArray(current.interactionStatistic) ? current.interactionStatistic : [current.interactionStatistic];
          for (const stat of stats) {
            if (!stat || !/FollowAction|SubscribeAction/i.test(JSON.stringify(stat.interactionType))) continue;
            const number = Number(stat.userInteractionCount);
            if (Number.isFinite(number) && number >= 0) candidates.push({ count: number, approximate: false });
          }
        }
        for (const child of Object.values(current)) if (child && typeof child === "object") stack.push(child);
      }
    }
    if (!identity) return null;
    if (!candidates.length) {
      for (const text of [metadata["og:description"], metadata.description]) {
        const count = S.metricCount(text, "followers", false);
        if (count !== null) candidates.push({ count, approximate: /\d\s*[KMB]\b/i.test(text) });
      }
    }
    const result = candidates.find((candidate) => candidate.count <= 1e12);
    return result ? Object.assign({}, ref, { followerCount: result.count, approximate: result.approximate, fetchedAt: Date.now(), source: "public-profile" }) : null;
  }

  class SocialFetcher {
    constructor() { this.inFlight = new Map(); this.observed = new Map(); }

    async observe(ref, followerCount, approximate, source) {
      const normalized = S.profileRef(ref && ref.platform, ref && ref.username);
      if (!normalized || !Number.isFinite(followerCount) || followerCount < 0 || followerCount > 1e12 || !Number.isInteger(followerCount)) return { ok: false, error: "invalid follower count" };
      const settings = await OF.settings.getSettings();
      const profile = Object.assign({}, normalized, { followerCount, approximate: !!approximate, fetchedAt: Date.now(), source: source === "user-entered" ? "user-entered" : source === "public-timeline" ? "public-timeline" : "visible-profile" });
      this.observed.set(normalized.key, { profile, expiresAt: Date.now() + settings.cache.subscriberMs });
      if (this.observed.size > 500) this.observed.delete(this.observed.keys().next().value);
      if (settings.cacheEnabled) await OF.cacheManager.setChannel(normalized.key, profile, settings.cache.subscriberMs);
      return { ok: true, profile };
    }

    async getInstagramPost(postId) {
      if (!OF.instagram.validId(postId)) return { ok: false, error: "invalid Instagram post id" };
      const key = "post:instagram:" + postId;
      if (this.inFlight.has(key)) return this.inFlight.get(key);
      const promise = this.lookupInstagramPost(postId).finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, promise);
      return promise;
    }

    async lookupInstagramPost(postId) {
      const key = "instagram:" + postId;
      const failureKey = "post:" + key;
      const settings = await OF.settings.getSettings();
      const cache = OF.cacheManager;
      if (settings.cacheEnabled) {
        const cached = await cache.getPostMetadata(key);
        if (cached) return { ok: true, post: cached, cached: true };
        const failure = await cache.getFailure(failureKey);
        if (failure) return { ok: false, error: failure.reason, cachedFailure: true };
      }
      const fetcher = OF.dataFetcher;
      fetcher.configure(settings.request);
      await fetcher.acquire();
      let result;
      try {
        const page = await fetcher.fetchPublicHtml("https://www.instagram.com/p/" + postId + "/");
        const finalPost = page.ok && S.postRef(page.url, "instagram");
        const post = finalPost && finalPost.postId === postId ? OF.instagram.parsePostHtml(page.html, postId) : null;
        if (post && (post.restricted || post.hidden)) result = { ok: false, error: "Instagram hides this post's counts or restricts the post" };
        else if (post && (post.views !== null || post.likes !== null || post.profile)) result = { ok: true, post };
        else result = { ok: false, error: page.ok ? "Instagram exposes no readable counts in this tile or public post metadata. Open the post to load its displayed metrics" : page.error };
      } catch (error) { result = { ok: false, error: "public Instagram post lookup failed" }; }
      finally { fetcher.release(); }
      if (settings.cacheEnabled) {
        if (result.ok) await cache.setPostMetadata(key, result.post, settings.cache.viewsMs);
        else await cache.setFailure(failureKey, result.error, settings.cache.failureMs);
      }
      return result;
    }

    async getProfile(ref) {
      ref = S.profileRef(ref && ref.platform, ref && ref.username);
      if (!ref) return { ok: false, error: "post author unavailable" };
      if (this.inFlight.has(ref.key)) return this.inFlight.get(ref.key);
      const promise = this.lookup(ref).finally(() => this.inFlight.delete(ref.key));
      this.inFlight.set(ref.key, promise);
      return promise;
    }

    async lookup(ref) {
      const settings = await OF.settings.getSettings();
      const cache = OF.cacheManager;
      const observed = this.observed.get(ref.key);
      if (observed && observed.expiresAt > Date.now()) return { ok: true, profile: observed.profile };
      if (settings.cacheEnabled) {
        const cached = await cache.getChannel(ref.key);
        if (cached) return { ok: true, profile: cached.data, cached: true };
        const failure = await cache.getFailure(ref.key);
        if (failure) return { ok: false, error: failure.reason, cachedFailure: true };
      }
      const fetcher = OF.dataFetcher;
      fetcher.configure(settings.request);
      await fetcher.acquire();
      let result;
      try {
        const page = await fetcher.fetchPublicHtml(ref.url);
        const finalRef = page.ok ? S.profileFromUrl(page.url, ref.platform) : null;
        const profile = finalRef && finalRef.key === ref.key ? parseProfileHtml(page.html, ref) : null;
        result = profile ? { ok: true, profile } : { ok: false, error: page.ok ? "Followers unavailable. Open the author's profile or hover their name to read the displayed count" : page.error };
      } catch (error) {
        result = { ok: false, error: "public profile request failed" };
      } finally { fetcher.release(); }
      const latest = this.observed.get(ref.key);
      if (latest && latest.expiresAt > Date.now()) return { ok: true, profile: latest.profile };
      if (settings.cacheEnabled) {
        if (result.ok) await cache.setChannel(ref.key, result.profile, settings.cache.subscriberMs);
        else await cache.setFailure(ref.key, result.error, settings.cache.failureMs);
      }
      return result;
    }
  }

  OF.parseSocialProfileHtml = parseProfileHtml;
  OF.socialFetcher = new SocialFetcher();
})(typeof globalThis !== "undefined" ? globalThis : this);

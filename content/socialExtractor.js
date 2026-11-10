(function (root) {
  "use strict";
  const OF = root.OutlierFinder;
  const S = OF.social;
  const V = OF.validator;
  const platform = S.platformFromUrl(root.location.href);
  const embedded = new Map();
  const scriptCache = new WeakMap();
  let activeReel = null;
  let reelOverlay = null;
  let routeBinding = null;

  function reelRoute() {
    const ref = platform === "instagram" && S.postRef(root.location.href, platform);
    return !!(ref && ref.videoUrl.startsWith("https://www.instagram.com/reel/"));
  }

  function visibleArea(video) {
    if (!video.isConnected) return 0;
    // aria-hidden removes media from the accessibility tree, not the screen.
    // Use rendered CSS visibility so decorative but visible Reel videos count.
    if (typeof video.checkVisibility === "function") {
      if (!video.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, opacityProperty: true, visibilityProperty: true })) return 0;
    } else {
      for (let node = video; node && node.nodeType === 1; node = node.parentElement) {
        const style = root.getComputedStyle(node);
        if (style.display === "none" || ["hidden", "collapse"].includes(style.visibility) || style.opacity === "0") return 0;
      }
    }
    const rect = video.getBoundingClientRect();
    const width = Math.max(0, Math.min(rect.right, root.innerWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, root.innerHeight) - Math.max(rect.top, 0));
    return width * height;
  }

  function activeVideo() {
    const videos = [...document.querySelectorAll('video')];
    const dialogs = videos.filter((video) => video.closest('[role="dialog"]') && visibleArea(video) > 0);
    const candidates = dialogs.length ? dialogs : videos;
    return candidates.filter((video) => visibleArea(video) > 0).sort((a, b) => visibleArea(b) - visibleArea(a))[0] || null;
  }

  function clearReel(resetRoute = true) {
    if (activeReel) {
      delete activeReel.card.dataset.ofReelViewer;
      delete activeReel.card.dataset.ofProcessed;
    }
    if (reelOverlay) reelOverlay.remove();
    reelOverlay = null;
    activeReel = null;
    if (resetRoute) routeBinding = null;
  }

  function isCurrentReel(card, videoId, mediaElement) {
    if (!activeReel || !reelRoute() || activeReel.card !== card || activeReel.ref.videoId !== videoId || activeReel.video !== mediaElement) return false;
    const route = S.postRef(root.location.href, platform);
    return (!route || route.videoId === videoId) && activeVideo() === mediaElement;
  }

  function reelCards() {
    if (!reelRoute()) { clearReel(); return null; }
    const video = activeVideo();
    if (!video) {
      const mounted = document.querySelector('video');
      clearReel(false);
      return mounted ? [] : null;
    }
    let card = null;
    // Reels can have many anonymous wrappers. Stop before crossing into a
    // container holding another preloaded video; never use that entire feed.
    for (let node = video.parentElement; node && node !== document.body; node = node.parentElement) {
      if (node.querySelectorAll("video").length !== 1) break;
      const rect = node.getBoundingClientRect();
      const display = root.getComputedStyle(node).display;
      if (node.tagName !== "A" && rect.width > 0 && rect.height > 0 && !["contents", "inline"].includes(display)) card = node;
      if (node.matches('main, [role="main"], [role="dialog"]')) break;
    }
    if (!card) card = video.parentElement;
    const explicit = new Map();
    for (const link of card.querySelectorAll("a[href]")) {
      if (link.closest('.of-badge, .of-tooltip, .of-panel-overlay')) continue;
      const ref = S.postRef(link.getAttribute("href"), platform, root.location.href);
      if (ref) explicit.set(ref.videoId, ref);
    }
    for (const node of [card, ...card.querySelectorAll('[data-shortcode], [data-instgrm-permalink]')]) {
      const code = node.getAttribute("data-shortcode");
      const ref = code && OF.instagram.validId(code) ? S.postRef("/reel/" + code + "/", platform) : S.postRef(node.getAttribute("data-instgrm-permalink"), platform);
      if (ref) explicit.set(ref.videoId, ref);
    }
    const route = S.postRef(root.location.href, platform);
    const own = explicit.size === 1 ? [...explicit.values()][0] : null;
    // A route can change before the corresponding DOM is replaced. Wait rather
    // than combining the next URL with the previous Reel's visible counters.
    if (route && own && route.videoId !== own.videoId) { clearReel(false); return []; }
    const ref = route || own;
    if (!ref) { clearReel(); return []; }
    if (route && !own && routeBinding && routeBinding.videoId === route.videoId && routeBinding.video !== video && routeBinding.video.isConnected) {
      clearReel(false);
      return [];
    }
    if (activeReel && (activeReel.card !== card || activeReel.ref.videoId !== ref.videoId || activeReel.video !== video)) clearReel();
    activeReel = { card, video, ref, confirmed: !!own };
    routeBinding = { videoId: ref.videoId, video };
    card.dataset.ofReelViewer = "1";
    if (!reelOverlay || !reelOverlay.isConnected) {
      delete card.dataset.ofProcessed;
      reelOverlay = document.createElement("div");
      reelOverlay.className = "of-reel-overlay";
      reelOverlay.style.position = "fixed";
      document.body.appendChild(reelOverlay);
    }
    const rect = video.getBoundingClientRect();
    reelOverlay.style.left = Math.max(0, rect.left) + "px";
    reelOverlay.style.top = Math.max(0, rect.top) + "px";
    return [card];
  }

  function collectEmbeddedPosts() {
    if (platform !== "instagram" || S.privateSurface(root.location.href)) return;
    embedded.clear();
    const wanted = new Set([...document.querySelectorAll('main a[href], [role="main"] a[href], [role="dialog"] a[href]')]
      .map((link) => S.postRef(link.getAttribute("href"), platform, root.location.href)).filter(Boolean).map((ref) => ref.postId));
    const current = S.postRef(root.location.href, platform);
    if (current) wanted.add(current.postId);
    if (!wanted.size) return;
    for (const script of document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"]')) {
      const text = script.textContent;
      if (!text || text.length > 5000000) continue;
      let cached = scriptCache.get(script);
      if (!cached || cached.text !== text) {
        const value = OF.instagram.jsonBody(text);
        cached = { text, records: value ? OF.instagram.collect(value) : new Map() };
        scriptCache.set(script, cached);
      }
      for (const [id, post] of cached.records) if (wanted.has(id)) {
        const previous = embedded.get(id);
        if (!previous || post.restricted || post.hidden) embedded.set(id, post);
        else if (!previous.restricted && !previous.hidden) embedded.set(id, { ...previous, views: previous.views ?? post.views, likes: previous.likes ?? post.likes, profile: previous.profile || post.profile });
      }
    }
  }

  function owns(card, element) {
    return !element.closest(".of-badge, .of-tooltip, .of-panel-overlay") &&
      (!element.closest("article") || element.closest("article") === card || (card.dataset.ofReelViewer === "1" && activeReel && element.closest("article").contains(activeReel.video))) &&
      !element.closest('[data-testid="quoteTweet"], [data-testid="card.wrapper"]');
  }

  function links(card) { return [...card.querySelectorAll("a[href]")].filter((link) => owns(card, link)); }

  function identity(card) {
    if (activeReel && activeReel.card === card) return isCurrentReel(card, activeReel.ref.videoId, activeReel.video) ? activeReel.ref : null;
    if (card.matches("main, [role=dialog]")) {
      const current = S.postRef(root.location.href, platform);
      if (current) return current;
    }
    const anchors = links(card);
    const ordered = [...anchors.filter((link) => link.querySelector("time")), ...anchors];
    if (card.matches("a[href]")) ordered.unshift(card);
    for (const link of ordered) {
      const ref = S.postRef(link.getAttribute("href"), platform, root.location.href);
      if (ref) return ref;
    }
    return null;
  }

  function findVideoCards(scope) {
    if (S.privateSurface(root.location.href)) return [];
    const doc = scope || document;
    if (platform === "instagram") {
      const reels = reelCards();
      if (reels) return reels;
    }
    if (platform === "x") return [...doc.querySelectorAll('main article[data-testid="tweet"], main article[role="article"], [role="main"] article[data-testid="tweet"], [role="main"] article[role="article"]')]
      .filter((card) => identity(card) && !card.closest('[data-testid="placementTracking"]') && !card.querySelector('[data-testid="promotedIndicator"]') && ![...card.querySelectorAll('[data-testid="placementTracking"], [data-testid="promotedIndicator"], [data-testid="socialContext"]')].some((node) => /\b(?:ad|promoted|sponsored)\b/i.test(node.textContent)));
    const articles = [...doc.querySelectorAll("main article, [role='main'] article, [role='dialog'] article")].filter((card) => identity(card) && ![...card.querySelectorAll("header span")].some((node) => /^sponsored$/i.test(V.normalizeText(node.textContent))));
    // Profile grids have permalink tiles rather than article elements.
    for (const anchor of doc.querySelectorAll('main a[href*="/p/"], main a[href*="/reel/"], main a[href*="/reels/"], [role="main"] a[href*="/p/"], [role="main"] a[href*="/reel/"], [role="main"] a[href*="/reels/"]')) {
      if (anchor.closest("article") || !S.postRef(anchor.getAttribute("href"), platform, root.location.href)) continue;
      if (anchor.querySelector("img, video")) {
        const host = anchor.parentElement;
        const ids = new Set([...host.querySelectorAll('a[href]')].map((link) => S.postRef(link.getAttribute("href"), platform, root.location.href)).filter(Boolean).map((ref) => ref.videoId));
        if (ids.size !== 1 || articles.includes(host)) continue;
        host.dataset.ofGridTile = "1";
        articles.push(host);
      }
    }
    if (!articles.length && S.postRef(root.location.href, platform)) {
      const detail = doc.querySelector('main, [role="main"], [role="dialog"]');
      if (detail && detail.querySelector("img, video")) articles.push(detail);
    }
    return articles;
  }

  function countIn(element, metric, allowBare) {
    if (!element) return null;
    for (const value of [element.getAttribute("aria-label"), element.getAttribute("title"), element.textContent]) {
      const count = S.metricCount(value, metric, allowBare);
      if (count !== null) return count;
    }
    return null;
  }

  function metric(card, ref, name) {
    if (platform === "x") {
      const selectors = name === "views" ? 'a[href*="/analytics"], [data-testid="app-text-transition-container"]' : '[data-testid="like"], [data-testid="unlike"]';
      for (const node of card.querySelectorAll(selectors)) {
        if (!owns(card, node)) continue;
        const href = node.getAttribute("href") || "";
        if (name === "views" && !href.includes("/status/" + ref.postId + "/analytics")) continue;
        const count = countIn(node, name, true);
        if (count !== null) return count;
      }
      // Detailed post pages can label counts on a group instead of a link.
      for (const node of card.querySelectorAll('[role="group"][aria-label]')) {
        if (!owns(card, node)) continue;
        const count = S.metricCount(node.getAttribute("aria-label"), name, false);
        if (count !== null) return count;
      }
    } else {
      // Read only metric-bearing controls/text, never numbers in captions.
      for (const node of card.querySelectorAll('[aria-label], a[href*="liked_by"], section span, section button')) {
        if (!owns(card, node) || node.closest("header, h1, [data-testid=post-caption], [data-testid=post-comment-root]") || (card.dataset.ofGridTile !== "1" && node.closest("ul, [role=list]"))) continue;
        if (node.querySelector('a[href*="/p/"], time')) continue;
        const label = node.getAttribute("aria-label");
        const labelled = S.metricCount(label, name, false);
        if (labelled !== null) return labelled;
        if (node.querySelector("svg, time") || node.closest('button[aria-label="Like"], button[aria-label="Unlike"]')) continue;
        const text = V.normalizeText(node.textContent);
        const unit = name === "views" ? "(?:views?|plays?)" : "likes?";
        if (!new RegExp("^(?:[\\d.,]+\\s*[KMB]?|no)\\s*" + unit + "$", "i").test(text)) continue;
        const count = S.metricCount(text, name, false);
        if (count !== null) return count;
      }
    }
    if (platform === "instagram") {
      // Some feed controls put the like count in its own adjacent button.
      if (name === "likes") for (const icon of card.querySelectorAll('[aria-label="Like"], [aria-label="Unlike"]')) {
        if (!owns(card, icon) || icon.closest('header, h1, [data-testid=post-caption], ul, [role=list]')) continue;
        const control = icon.closest('button, [role="button"]');
        const counter = control && control.nextElementSibling;
        if (!counter?.matches('button, [role="button"]') || counter.querySelector('svg, time, a')) continue;
        const text = V.normalizeText(counter.textContent);
        if (!/^[\d.,]+\s*[KMB]?$/i.test(text)) continue;
        const count = countIn(counter, name, true);
        if (count !== null) return count;
      }
      for (const icon of card.querySelectorAll('svg[aria-label]')) {
        if (!owns(card, icon) || icon.closest("header, h1, [data-testid=post-caption]") || (card.dataset.ofGridTile !== "1" && icon.closest("ul, [role=list]"))) continue;
        const label = icon.getAttribute("aria-label") || "";
        const relevant = name === "likes" ? /^(?:likes?|unlike)$/i.test(label) : /^(?:views?|plays?|view count|play count)$/i.test(label);
        if (!relevant) continue;
        let container = icon.parentElement;
        for (let depth = 0; container && container !== card && depth < 8; depth++, container = container.parentElement) {
          if (container.querySelectorAll("svg").length > 1) break;
          const count = countIn(container, name, true);
          if (count !== null) return count;
        }
      }
    }
    return null;
  }

  function author(card, ref) {
    if (ref.profile) return ref.profile;
    const candidates = [...card.querySelectorAll("header a[href], h2 a[href], [data-testid=post-owner] a[href]")];
    for (const anchor of candidates) {
      // Comments, captions, and tagged accounts are not the post owner.
      if (!anchor.closest("header") && anchor.closest("ul, [data-testid='post-comment-root'], section")) continue;
      const profile = S.profileFromUrl(anchor.getAttribute("href"), platform, root.location.href);
      if (profile) return Object.assign(profile, { name: V.normalizeText(anchor.textContent) || profile.name });
    }
    // Some feed posts have an untagged creator row instead of header/h2.
    // Only accept an unambiguous profile before the media, not commenters or
    // caption mentions. A creator-prefixed permalink can confirm that profile.
    const media = card.querySelector("video") || [...card.querySelectorAll("a[href]")]
      .find((link) => S.postRef(link.getAttribute("href"), platform, root.location.href)?.videoId === ref.videoId && link.querySelector("img"))?.querySelector("img");
    if (media) {
      const before = new Map();
      for (const anchor of links(card)) {
        if (anchor.closest("ul, [role=list], h1, [data-testid=post-caption], [data-testid=post-comment-root]")) continue;
        if (!(anchor.compareDocumentPosition(media) & 4)) continue;
        const profile = S.profileFromUrl(anchor.getAttribute("href"), platform, root.location.href);
        if (profile) before.set(profile.key, Object.assign(profile, { name: V.normalizeText(anchor.textContent) || profile.name }));
      }
      if (ref.profileHint && before.has(ref.profileHint.key)) return before.get(ref.profileHint.key);
      if (before.size === 1) return [...before.values()][0];
    }
    // Grid tiles belong to the profile being viewed.
    if (card.dataset.ofGridTile === "1") return OF.instagram.pageProfile(root.location.href);
    return null;
  }

  function xBadgeHost(card) {
    const author = [...card.querySelectorAll('[data-testid="User-Name"]')].find((node) => owns(card, node));
    const content = [...card.querySelectorAll('[data-testid="tweetText"], [data-testid="tweetPhoto"], [role="group"]')].find((node) => owns(card, node));
    let container = content?.parentElement || author?.parentElement || card;
    while (container !== card && author && !container.contains(author)) container = container.parentElement;
    let host = container.querySelector(':scope > .of-x-badge-line');
    if (!host) {
      host = document.createElement('div');
      host.className = 'of-x-badge-line';
      let firstContent = content;
      while (firstContent && firstContent.parentElement !== container) firstContent = firstContent.parentElement;
      if (firstContent) firstContent.before(host);
      else container.appendChild(host);
    }
    return host;
  }

  function extractVideoCard(card) {
    const ref = identity(card);
    if (!ref) return null;
    const metadata = platform === "instagram" ? embedded.get(ref.postId) : null;
    const restricted = metadata && (metadata.restricted || metadata.hidden);
    const viewer = activeReel && activeReel.card === card ? activeReel : null;
    const useDom = !viewer || viewer.confirmed;
    let profile = (metadata && metadata.profile) || (useDom ? author(card, ref) : null);
    const timeline = platform === "x" && profile && OF.xTimeline && OF.xTimeline.get(ref.postId, profile.username);
    if (timeline) profile = Object.assign({}, profile, { followerCount: timeline.followerCount, approximate: false, source: "public-timeline" });
    const time = [...card.querySelectorAll("time[datetime]")].find((node) => owns(card, node));
    const publishedAt = time ? Date.parse(time.getAttribute("datetime")) : NaN;
    const textNode = platform === "x" ? card.querySelector('[data-testid="tweetText"]') : card.querySelector('h1, [data-testid="post-caption"]');
    const image = platform === "x" ? card.querySelector('[data-testid="tweetPhoto"] img') : card.querySelector("img");
    const title = V.normalizeText(textNode && textNode.textContent) || (image && image.alt) || S.LABELS[platform] + " post";
    return Object.assign(ref, {
      title: title.slice(0, 500), channel: profile, channelRef: profile,
      views: restricted ? null : (timeline && Number.isSafeInteger(timeline.views) ? timeline.views : null) ?? (useDom ? metric(card, ref, "views") : null) ?? (metadata && metadata.views) ?? null,
      likes: restricted ? null : (useDom ? metric(card, ref, "likes") : null) ?? (metadata && metadata.likes) ?? null,
      metadataRestricted: !!restricted,
      thumbnailUrl: image ? image.currentSrc || image.src : "",
      publishedText: time ? time.getAttribute("title") || time.textContent : "",
      ageDays: Number.isFinite(publishedAt) ? Math.max(0, (Date.now() - publishedAt) / 86400000) : null,
      // X articles lay their children out horizontally. Keep the badge inside
      // the existing content column instead of creating another article column.
      cardElement: card, thumbnailElement: viewer ? reelOverlay : platform === "x"
        ? xBadgeHost(card)
        : card.matches("a[href]") ? card.parentElement : card,
      isReelViewer: !!viewer, mediaElement: viewer ? viewer.video : null,
      isShort: false, isLive: false
    });
  }

  function visibleProfiles() {
    if (S.privateSurface(root.location.href)) return [];
    const profiles = new Map();
    for (const anchor of document.querySelectorAll('a[href*="followers"]')) {
      if (anchor.closest("[data-testid=tweetText], [data-testid=UserDescription], .of-panel-overlay")) continue;
      // X may mount the profile hovercard within a timeline article.
      if (anchor.closest("article") && !anchor.closest('[data-testid="HoverCard"], [data-testid="UserHoverCard"], [role="dialog"]')) continue;
      let url;
      try { url = new URL(anchor.getAttribute("href"), root.location.href); } catch (error) { continue; }
      if (S.platformFromUrl(url.href) !== platform) continue;
      const match = url.pathname.match(/^\/([^/]+)\/(?:verified_followers|followers)\/?$/);
      const ref = match && S.profileRef(platform, match[1]);
      if (!ref) continue;
      let count = null;
      let exactCount = null;
      for (const node of [anchor, ...anchor.querySelectorAll("[title], [aria-label]")]) {
        const titleCount = S.metricCount(node.getAttribute("title"), "followers", true);
        const value = titleCount !== null ? titleCount : countIn(node, "followers", true);
        if (value !== null) count = value;
        if (titleCount !== null && !/\d\s*[KMB]\b/i.test(node.getAttribute("title"))) exactCount = titleCount;
      }
      if (exactCount !== null) count = exactCount;
      if (count !== null) profiles.set(ref.key, { ref, followerCount: count, approximate: exactCount === null && /\d\s*[KMB](?=\s|followers|$)/i.test(anchor.textContent) });
    }
    if (platform === "x") {
      const wanted = new Set([...document.querySelectorAll('article[data-testid="tweet"], article[role="article"]')].map(card => identity(card)?.profile?.key).filter(Boolean));
      const current = S.profileFromUrl(root.location.href, "x");
      if (current) wanted.add(current.key);
      for (const script of document.querySelectorAll("script")) {
        const text = script.textContent;
        if (!text.includes("followers_count")) continue;
        let cached = scriptCache.get(script);
        if (!cached || cached.text !== text) { cached = { text, profiles: S.xProfilesFromScript(text) }; scriptCache.set(script, cached); }
        for (const entry of cached.profiles || []) if (wanted.has(entry.ref.key) && !profiles.has(entry.ref.key)) profiles.set(entry.ref.key, entry);
      }
    }
    if (platform === "instagram") {
      const ref = OF.instagram.pageProfile(root.location.href);
      const header = document.querySelector("main header");
      if (ref && header) {
        for (const node of header.querySelectorAll("li, [aria-label]")) {
          let count = countIn(node, "followers", false);
          if (count === null) continue;
          let approximate = /\d\s*[KMB](?=\s|followers|$)/i.test(node.textContent);
          for (const exact of node.querySelectorAll("[title]")) {
            const number = S.metricCount(exact.getAttribute("title"), "followers", true);
            if (number !== null) { count = number; approximate = false; break; }
          }
          profiles.set(ref.key, { ref, followerCount: count, approximate });
        }
      }
    }
    for (const post of embedded.values()) {
      if (post.restricted || post.hidden || !post.profile || !Number.isFinite(post.profile.followerCount) || profiles.has(post.profile.key)) continue;
      profiles.set(post.profile.key, { ref: post.profile, followerCount: post.profile.followerCount, approximate: false });
    }
    return [...profiles.values()];
  }

  OF.extractor = { findVideoCards, getCardVideoId: identity, extractVideoCard, fingerprint(card) {
    const post = extractVideoCard(card);
    return post ? JSON.stringify([post.videoId, post.views, post.likes, post.channel && post.channel.key, post.channel && post.channel.followerCount, post.metadataRestricted]) : "";
  } };
  OF.socialExtractor = { visibleProfiles, metric, collectEmbeddedPosts, isCurrentReel };
})(typeof globalThis !== "undefined" ? globalThis : this);

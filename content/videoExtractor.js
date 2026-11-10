(function (root) {
  "use strict";

  const OF = (root.OutlierFinder = root.OutlierFinder || {});
  const V = OF.validator;

  const CARD_SELECTOR = [
    "ytd-rich-item-renderer",
    "ytd-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-compact-video-renderer",
    "ytd-playlist-video-renderer",
    "yt-lockup-view-model"
  ].join(",");

  const AD_SELECTOR = [
    "ytd-ad-slot-renderer",
    "ytd-promoted-sparkles-web-renderer",
    "ytd-display-ad-renderer",
    "ytd-in-feed-ad-layout-renderer",
    "#ad-badge",
    ".badge-style-type-ad"
  ].join(",");

  const THUMBNAIL_SELECTORS = [
    "ytd-thumbnail",
    "yt-thumbnail-view-model",
    "a#thumbnail",
    "a.yt-lockup-view-model__content-image",
    "a[href*='/watch?v=']"
  ];

  const TITLE_SELECTORS = [
    "#video-title",
    "a#video-title-link",
    "#video-title-link yt-formatted-string",
    ".yt-lockup-metadata-view-model__title",
    "a.yt-lockup-metadata-view-model__title",
    "h3 a",
    "h3"
  ];

  const CHANNEL_SELECTORS = [
    "ytd-channel-name a",
    "#channel-name a",
    ".ytd-channel-name a",
    "ytd-video-owner-renderer a",
    ".yt-lockup-metadata-view-model__metadata-row a[href^='/@']",
    ".yt-lockup-metadata-view-model__metadata-row a[href^='/channel/']",
    "a.yt-core-attributed-string__link[href^='/@']",
    "a[href^='/@']",
    "a[href^='/channel/']",
    "a[href^='/c/']",
    "a[href^='/user/']"
  ];

  const METADATA_SELECTORS = [
    "yt-content-metadata-view-model [role='text']",
    "yt-content-metadata-view-model [aria-label]",
    ".ytContentMetadataViewModelMetadataText",
    "#metadata-line",
    ".inline-metadata-item",
    ".yt-content-metadata-view-model__metadata-row",
    ".yt-content-metadata-view-model-wiz__metadata-row",
    ".yt-content-metadata-view-model-wiz__metadata-text",
    ".yt-content-metadata-view-model-wiz__metadata-text span",
    ".yt-content-metadata-view-model__metadata-text",
    ".yt-content-metadata-view-model__metadata-text span",
    "#metadata",
    ".ytd-video-meta-block"
  ];

  const LIVE_SELECTOR = [
    "ytd-thumbnail-overlay-time-status-renderer[overlay-style='LIVE']",
    ".yt-badge-shape--live",
    ".badge-style-type-live-now",
    "[class*='live-badge']"
  ].join(",");

  function textOf(element) {
    return element ? V.normalizeText(element.textContent) : "";
  }

  function firstMatch(card, selectors) {
    for (const selector of selectors) {
      const element = card.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  function findWatchLink(card) {
    const preferred = card.querySelectorAll("a[href*='/watch']");
    for (const anchor of preferred) {
      const parsed = V.videoIdFromUrl(anchor.getAttribute("href"), root.location && root.location.href);
      if (parsed && !parsed.isShort) return { anchor, parsed };
    }
    const shortAnchors = card.querySelectorAll("a[href*='/shorts/']");
    for (const anchor of shortAnchors) {
      const parsed = V.videoIdFromUrl(anchor.getAttribute("href"), root.location && root.location.href);
      if (parsed) return { anchor, parsed };
    }
    return null;
  }

  function isAdCard(card) {
    if (card.matches && card.matches(AD_SELECTOR)) return true;
    if (card.closest && card.closest(AD_SELECTOR)) return true;
    if (card.querySelector(AD_SELECTOR)) return true;
    if (card.hasAttribute && card.hasAttribute("is-ad")) return true;

    const badgeTexts = card.querySelectorAll("ytd-badge-supported-renderer, .badge-shape-wiz__text, .yt-badge-shape__text");
    for (const badge of badgeTexts) {
      if (/^(sponsored|ad|ads)$/i.test(textOf(badge))) return true;
    }
    return false;
  }

  function isLiveCard(card, metadataText) {
    if (card.querySelector(LIVE_SELECTOR)) return true;
    if (/\bwatching\s+now\b/i.test(metadataText)) return true;

    const badges = card.querySelectorAll("ytd-badge-supported-renderer, .yt-badge-shape__text, .badge-shape-wiz__text");
    for (const badge of badges) {
      if (/^live$/i.test(textOf(badge))) return true;
    }
    return false;
  }

  function isShortCard(card, parsed, href) {
    if (parsed && parsed.isShort) return true;
    if (/^YT-REEL/i.test(card.tagName || "")) return true;
    if (card.querySelector("a[href*='/shorts/']")) return true;
    return /\/shorts\//.test(href || "");
  }

  function getThumbnailHost(card, watchAnchor) {
    for (const selector of THUMBNAIL_SELECTORS) {
      const element = card.querySelector(selector);
      if (element) return element;
    }
    return watchAnchor || card;
  }

  function getThumbnailUrl(card, host) {
    const scopes = [host, card];
    for (const scope of scopes) {
      if (!scope || !scope.querySelector) continue;
      const image = scope.querySelector("img#img, img.yt-core-image, img");
      if (!image) continue;
      const candidates = [image.currentSrc, image.src, image.getAttribute("data-src")];
      for (const url of candidates) {
        if (url && !url.startsWith("data:")) return url;
      }
    }
    return "";
  }

  function getTitle(card, watchAnchor) {
    const element = firstMatch(card, TITLE_SELECTORS);
    if (element) {
      const text = textOf(element) || V.normalizeText(element.getAttribute("title"));
      if (text) return text;
    }
    if (watchAnchor) {
      const text = V.normalizeText(watchAnchor.getAttribute("title")) || V.normalizeText(watchAnchor.getAttribute("aria-label"));
      if (text) return text;
    }
    return "";
  }

  function getChannel(card) {
    const anchor = firstMatch(card, CHANNEL_SELECTORS);
    let ref = null;
    let name = "";

    if (anchor) {
      const href = anchor.getAttribute("href");
      ref = V.normalizeChannelRef(href, root.location && root.location.href);
      name = textOf(anchor);
    }

    if (!ref) {
      // Collaboration cards can use absolute URLs and unversioned link classes.
      for (const candidate of card.querySelectorAll("a[href]")) {
        try {
          const candidateRef = V.normalizeChannelRef(candidate.getAttribute("href"), root.location && root.location.href);
          if (!candidateRef) continue;
          ref = candidateRef;
          name = textOf(candidate);
          break;
        } catch (error) {
          // Skip malformed links and keep looking for a valid channel.
        }
      }
    }

    if (!name) {
      const nameElement = card.querySelector("ytd-channel-name #text, #channel-name #text, ytd-channel-name");
      name = textOf(nameElement);
    }

    if (!ref && name) {
      ref = {
        channelId: null,
        handle: null,
        url: null,
        key: "name:" + name.toLowerCase()
      };
    }

    if (!ref) return null;

    return {
      channelId: ref.channelId || null,
      handle: ref.handle || null,
      url: ref.url || null,
      key: ref.key,
      name: name || ref.handle || ref.channelId || "Unknown channel"
    };
  }

  function collectMetadataParts(card, watchAnchor, titleElement) {
    const parts = [];
    const seen = new Set();

    const push = (value) => {
      const text = V.normalizeText(value);
      if (!text || text.length > 240 || seen.has(text)) return;
      seen.add(text);
      parts.push(text);
    };

    for (const selector of METADATA_SELECTORS) {
      const elements = card.querySelectorAll(selector);
      for (const element of elements) {
        // Compact layouts expose full counts/ages to accessibility APIs while
        // rendering only “562K” and “3d ago” visually.
        push(element.getAttribute && element.getAttribute("aria-label"));
        push(textOf(element));
      }
    }

    for (const anchor of [watchAnchor, titleElement]) {
      if (!anchor) continue;
      push(anchor.getAttribute("aria-label"));
      push(anchor.getAttribute("title"));
    }

    const thumbnail = card.querySelector("ytd-thumbnail, a#thumbnail");
    if (thumbnail) {
      push(thumbnail.getAttribute("aria-label"));
      push(thumbnail.getAttribute("title"));
    }

    return parts;
  }

  function extractPublishedText(parts) {
    const compact = /\b(\d+(?:[.,]\d+)?)\s*(mo|[smhdwy])\s+ago\b/i;
    const pattern = /(?:streamed|premiered|scheduled)?\s*(?:\d+(?:[.,]\d+)?|an?)\s*(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?|mo|s|m|h|d|w|y)\s+ago/i;
    for (const part of parts) {
      const match = part.match(pattern) || part.match(compact);
      if (match) return V.normalizeText(match[0]);
    }
    return "";
  }

  function extractViews(parts) {
    for (const part of parts) {
      const count = V.parseViewCount(part);
      if (count !== null) return { count, text: part };
    }
    // Compact cards can omit “views”: “1.1M 2mo ago”. Restrict this
    // fallback to a count immediately followed by publication age.
    for (const part of parts) {
      const match = part.match(/^([\d.,]+\s*[KMB]?)\s*(?:[•·]\s*)?\d+(?:[.,]\d+)?\s*(?:mo|[smhdwy]|days?|weeks?|months?|years?)\s+ago$/i);
      if (match) return { count: V.parseCount(match[1]), text: match[1] + " views" };
    }
    return { count: null, text: "" };
  }

  function extractVideoCard(card) {
    if (!card || !card.querySelector) return null;
    if (isAdCard(card)) return null;

    const watch = findWatchLink(card);
    if (!watch) return null;

    const href = watch.anchor.getAttribute("href") || "";
    const isShort = isShortCard(card, watch.parsed, href);

    const metadataParts = collectMetadataParts(card, watch.anchor, firstMatch(card, TITLE_SELECTORS));
    const metadataText = metadataParts.join(" ");
    const isLive = isLiveCard(card, metadataText);

    const views = extractViews(metadataParts);
    const publishedText = extractPublishedText(metadataParts);
    const ageDays = V.parseAgeDays(publishedText);
    const thumbnailHost = getThumbnailHost(card, watch.anchor);
    const channel = getChannel(card);

    return {
      videoId: watch.parsed.videoId,
      videoUrl: "https://www.youtube.com/watch?v=" + watch.parsed.videoId,
      title: getTitle(card, watch.anchor),
      thumbnailUrl: getThumbnailUrl(card, thumbnailHost),
      views: views.count,
      viewsText: views.text,
      publishedText,
      ageDays,
      channel,
      channelRef: channel,
      isShort,
      isLive,
      cardElement: card,
      thumbnailElement: thumbnailHost,
      watchAnchor: watch.anchor,
      metadataText
    };
  }

  function getCardVideoId(card) {
    if (!card || !card.querySelector) return null;
    const watch = findWatchLink(card);
    return watch ? watch.parsed : null;
  }

  function findVideoCards(scope) {
    const rootElement = scope || document;
    const nodes = rootElement.querySelectorAll(CARD_SELECTOR);
    const cards = [];

    for (const card of nodes) {
      if (!card || card.nodeType !== 1) continue;
      if (isAdCard(card)) continue;
      if (card.querySelector(CARD_SELECTOR)) continue;
      if (!findWatchLink(card)) continue;
      cards.push(card);
    }

    return cards;
  }

  OF.extractor = {
    CARD_SELECTOR,
    findVideoCards,
    getCardVideoId,
    extractVideoCard,
    getThumbnailHost,
    isAdCard,
    isLiveCard,
    isShortCard
  };
})(typeof globalThis !== "undefined" ? globalThis : this);

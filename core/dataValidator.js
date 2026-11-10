(function (root) {
  "use strict";

  const OF = (root.OutlierFinder = root.OutlierFinder || {});

  const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;

  function normalizeNumberString(value, hasSuffix) {
    let text = String(value).replace(/\s+/g, "");
    if (!text) return text;

    const lastComma = text.lastIndexOf(",");
    const lastDot = text.lastIndexOf(".");

    if (lastComma !== -1 && lastDot !== -1) {
      if (lastComma > lastDot) {
        text = text.replace(/\./g, "").replace(",", ".");
      } else {
        text = text.replace(/,/g, "");
      }
      return text;
    }

    if (lastComma !== -1) {
      const parts = text.split(",");
      const looksDecimal = parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2 && parts[0].length <= 3;
      if (looksDecimal && (hasSuffix || parts[0].length <= 3)) {
        text = parts[0] + "." + parts[1];
      } else {
        text = text.replace(/,/g, "");
      }
      return text;
    }

    if (lastDot !== -1 && hasSuffix) {
      const parts = text.split(".");
      if (parts.length > 2) {
        text = parts.slice(0, -1).join("") + "." + parts[parts.length - 1];
      }
    }

    return text;
  }

  function parseCount(input) {
    if (input === null || input === undefined) return null;
    const raw = String(input).replace(/\u00a0/g, " ").trim();
    if (!raw) return null;
    if (/(^|\b)(no|zero)\s+(views?|subscribers?|subs)\b/i.test(raw)) return 0;
    if (/\bhidden\b/i.test(raw)) return null;

    const cleaned = raw
      .replace(/\bviews?\b/gi, " ")
      .replace(/\bsubscribers?\b/gi, " ")
      .replace(/\bsubs\b/gi, " ")
      .replace(/\bwatching\b/gi, " ")
      .replace(/\blikes?\b/gi, " ")
      .replace(/\bvideo\s+views\b/gi, " ");

    const match = cleaned.match(/(\d[\d.,\s]*)\s*(thousand|million|billion|[KMB])?/i);
    if (!match) return null;

    const numberText = normalizeNumberString(match[1], !!match[2]);
    const value = parseFloat(numberText);
    if (!Number.isFinite(value)) return null;

    const suffix = (match[2] || "").toUpperCase();
    const multiplier =
      suffix === "K" || suffix === "THOUSAND" ? 1e3 :
      suffix === "M" || suffix === "MILLION" ? 1e6 :
      suffix === "B" || suffix === "BILLION" ? 1e9 : 1;

    return Math.round(value * multiplier);
  }

  function parseViewCount(text) {
    if (!text) return null;
    const raw = String(text).replace(/\u00a0/g, " ");
    const match = raw.match(/([\d][\d.,\s]*\s*(?:thousand|million|billion|[KMB])?)\s*(?:video\s+)?(?:views?|watching)/i);
    if (match) return parseCount(match[1]);
    if (/^\s*[\d.,]+\s*(?:thousand|million|billion|[KMB])?\s*$/i.test(raw)) return parseCount(raw);
    return null;
  }

  function parseSubscriberCount(text) {
    if (text === null || text === undefined) return null;
    const raw = String(text).replace(/\u00a0/g, " ").trim();
    if (!raw) return null;
    if (/\bhidden\b/i.test(raw)) return null;

    const direct = raw.match(/([\d][\d.,\s]*\s*[KMB]?)\s*(?:subscribers?|subs)\b/i);
    const source = direct ? direct[1] : raw;
    const count = parseCount(source);
    if (count === null) return null;

    const numberText = (direct ? direct[1] : raw).trim();
    const approximate = /[KMB]\b/i.test(numberText) || /~|approx/i.test(raw);

    return {
      count,
      text: raw,
      approximate,
      exact: !approximate
    };
  }

  const UNIT_DAYS = {
    second: 1 / 86400,
    minute: 1 / 1440,
    hour: 1 / 24,
    day: 1,
    week: 7,
    month: 30,
    year: 365,
    s: 1 / 86400,
    m: 1 / 1440,
    h: 1 / 24,
    d: 1,
    w: 7,
    mo: 30,
    y: 365
  };

  function parseAgeDays(text, nowMs) {
    if (!text) return null;
    const raw = String(text).replace(/\u00a0/g, " ").trim();
    if (/\b(today|just now|now)\b/i.test(raw)) return 0;
    if (/\byesterday\b/i.test(raw)) return 1;

    const match = raw.match(/(\d+(?:[.,]\d+)?|an?)\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?|mo|s|m|h|d|w|y)\b/i);
    if (!match) return null;

    const rawValue = match[1].toLowerCase();
    const amount = rawValue === "a" || rawValue === "an" ? 1 : parseFloat(rawValue.replace(",", "."));
    if (!Number.isFinite(amount)) return null;

    const rawUnit = match[2].toLowerCase();
    const unit = rawUnit.length > 1 ? rawUnit.replace(/s$/, "") : rawUnit;
    const unitDays = UNIT_DAYS[unit];
    if (!unitDays) return null;

    return Math.round(amount * unitDays * 100) / 100;
  }

  function isValidVideoId(value) {
    return typeof value === "string" && VIDEO_ID_RE.test(value);
  }

  function isValidChannelId(value) {
    return typeof value === "string" && CHANNEL_ID_RE.test(value);
  }

  function parseYouTubeUrl(href, base) {
    if (!href) return null;
    try {
      const url = new URL(href, base || "https://www.youtube.com");
      const host = url.hostname.replace(/^www\./, "");
      if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "youtu.be") return null;
      return url;
    } catch (error) {
      return null;
    }
  }

  function videoIdFromUrl(href, base) {
    const url = parseYouTubeUrl(href, base);
    if (!url) return null;

    if (url.hostname.replace(/^www\./, "") === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return isValidVideoId(id) ? { videoId: id, isShort: false } : null;
    }

    const watchId = url.searchParams.get("v");
    if (isValidVideoId(watchId)) {
      return { videoId: watchId, isShort: false };
    }

    const shortMatch = url.pathname.match(/^\/(shorts|live)\/([A-Za-z0-9_-]{11})/);
    if (shortMatch) {
      return { videoId: shortMatch[2], isShort: shortMatch[1] === "shorts" };
    }

    return null;
  }

  function normalizeChannelRef(href, base) {
    const url = parseYouTubeUrl(href, base);
    if (!url) return null;

    const path = url.pathname;

    const channelMatch = path.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})/);
    if (channelMatch) {
      return {
        channelId: channelMatch[1],
        handle: null,
        url: "https://www.youtube.com/channel/" + channelMatch[1],
        key: channelMatch[1]
      };
    }

    const handleMatch = path.match(/^\/(@[^/]+)/);
    if (handleMatch) {
      const handle = decodeURIComponent(handleMatch[1]);
      return {
        channelId: null,
        handle,
        url: "https://www.youtube.com/" + handleMatch[1],
        key: handle.toLowerCase()
      };
    }

    const legacyMatch = path.match(/^\/(c|user)\/([^/]+)/);
    if (legacyMatch) {
      const handle = decodeURIComponent(legacyMatch[2]);
      return {
        channelId: null,
        handle,
        url: "https://www.youtube.com/" + legacyMatch[1] + "/" + legacyMatch[2],
        key: (legacyMatch[1] + "/" + handle).toLowerCase()
      };
    }

    return null;
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isLiveText(text) {
    const raw = normalizeText(text);
    if (!raw) return false;
    return /\blive\b/i.test(raw) || /\bwatching\s+now\b/i.test(raw);
  }

  function validateVideo(video) {
    const errors = [];
    if (!video || typeof video !== "object") {
      return { ok: false, errors: ["missing video object"] };
    }
    if (!isValidVideoId(video.videoId)) errors.push("invalid video id");
    if (!video.channelRef || !video.channelRef.key) errors.push("missing channel reference");
    if (video.views !== null && video.views !== undefined && !Number.isFinite(video.views)) {
      errors.push("invalid view count");
    }
    return { ok: errors.length === 0, errors };
  }

  function validateChannelData(data) {
    if (!data || typeof data !== "object") return { ok: false, reason: "missing channel data" };
    if (data.hidden) return { ok: false, reason: "subscriber count hidden" };
    if (!Number.isFinite(data.subscriberCount)) return { ok: false, reason: "subscriber count unavailable" };
    if (data.subscriberCount <= 0) return { ok: false, reason: "subscriber count is zero" };
    return { ok: true, reason: null };
  }

  OF.validator = {
    VIDEO_ID_RE,
    CHANNEL_ID_RE,
    parseCount,
    parseViewCount,
    parseSubscriberCount,
    parseAgeDays,
    isValidVideoId,
    isValidChannelId,
    parseYouTubeUrl,
    videoIdFromUrl,
    normalizeChannelRef,
    normalizeText,
    isLiveText,
    validateVideo,
    validateChannelData
  };
})(typeof globalThis !== "undefined" ? globalThis : this);

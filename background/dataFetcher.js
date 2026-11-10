(function (root) {
  "use strict";

  const OF = (root.OutlierFinder = root.OutlierFinder || {});
  const V = OF.validator;

  const CHANNEL_ID_RE = /"(?:externalId|browseId|channelId)":"(UC[A-Za-z0-9_-]{22})"/;

  function extractJsonAfter(html, marker) {
    const markerIndex = html.indexOf(marker);
    if (markerIndex === -1) return null;
    const start = html.indexOf("{", markerIndex);
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < html.length; i += 1) {
      const ch = html[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) return html.slice(start, i + 1);
      }
    }
    return null;
  }

  function collectSubscriberStrings(value, output, limit) {
    const stack = [value];
    let visited = 0;

    while (stack.length && visited < limit) {
      const current = stack.pop();
      visited += 1;

      if (typeof current === "string") {
        if (current.length <= 160 && /subscriber/i.test(current)) {
          output.push(current);
        }
        continue;
      }

      if (current && typeof current === "object") {
        for (const key of Object.keys(current)) {
          const child = current[key];
          if (typeof child === "string") {
            if (/subscriber/i.test(key) && child.length <= 160) output.push(child);
            else if (child.length <= 160 && /subscriber/i.test(child)) output.push(child);
          } else if (child && typeof child === "object") {
            stack.push(child);
          }
        }
      }
    }
  }

  function parseChannelHtml(html, url) {
    const candidates = [];

    // Only the channel header owns this count. Recommendations and video
    // descriptions may mention other channels and must never supply a ratio.
    const assignment = html.match(/(?:var\s+)?ytInitialData\s*=\s*|window\s*\[\s*["']ytInitialData["']\s*\]\s*=\s*/);
    const jsonText = assignment ? extractJsonAfter(html, assignment[0]) : null;
    let data = null;
    if (jsonText) {
      try {
        data = JSON.parse(jsonText);
        const header = data.header || {};
        const legacy = header.c4TabbedHeaderRenderer || header;
        const modern = header.pageHeaderRenderer || header;
        const page = (modern.content && modern.content.pageHeaderViewModel) || modern.pageHeaderViewModel || {};
        if (legacy.subscriberCountText) {
          collectSubscriberStrings({ subscriberCountText: legacy.subscriberCountText }, candidates, 1000);
        }
        if (page.metadata) collectSubscriberStrings(page.metadata, candidates, 10000);
      } catch (error) {
        return null;
      }
    }

    let parsed = null;
    let subscriberText = "";
    for (const candidate of candidates) {
      const result = V.parseSubscriberCount(candidate);
      if (result && Number.isFinite(result.count) && result.count > 0 && result.count <= 10000000000) {
        parsed = result;
        subscriberText = candidate;
        break;
      }
    }

    if (!parsed) return null;

    let channelId = null;

    const pathMatch = url.match(/\/channel\/(UC[A-Za-z0-9_-]{22})/);
    if (pathMatch) channelId = pathMatch[1];

    if (!channelId) {
      const externalMatch = JSON.stringify((data && data.metadata) || {}).match(/"externalId":"(UC[A-Za-z0-9_-]{22})"/) || html.match(/"externalId":"(UC[A-Za-z0-9_-]{22})"/);
      if (externalMatch) channelId = externalMatch[1];
    }

    if (!channelId) {
      const idMatch = html.match(CHANNEL_ID_RE);
      if (idMatch) channelId = idMatch[1];
    }

    return {
      subscriberCount: parsed.count,
      subscriberText: V.normalizeText(subscriberText),
      approximate: parsed.approximate,
      exact: parsed.exact,
      hidden: false,
      channelId,
      fetchedAt: Date.now(),
      sourceUrl: url
    };
  }

  function parseVideoOwnerHtml(html, videoId) {
    if (!V.isValidVideoId(videoId)) return null;
    const assignment = html.match(/(?:var\s+)?ytInitialPlayerResponse\s*=\s*|window\s*\[\s*["']ytInitialPlayerResponse["']\s*\]\s*=\s*/);
    if (!assignment) return null;
    try {
      const data = JSON.parse(extractJsonAfter(html, assignment[0]));
      if (!data || (data.playabilityStatus && data.playabilityStatus.status !== "OK")) return null;
      const details = data.videoDetails;
      // Only the requested video's own metadata can establish its owner.
      if (!details || details.videoId !== videoId || !V.isValidChannelId(details.channelId)) return null;
      const ref = V.normalizeChannelRef("/channel/" + details.channelId);
      return Object.assign(ref, { name: V.normalizeText(details.author) || details.channelId });
    } catch (error) {
      return null;
    }
  }

  function buildCandidateUrls(ref) {
    const urls = [];
    const add = (value) => {
      if (!value) return;
      try {
        const normalizedRef = V.normalizeChannelRef(value);
        if (!normalizedRef) return;
        const url = new URL(normalizedRef.url);
        url.searchParams.set("hl", "en");
        url.searchParams.set("gl", "US");
        const normalized = url.toString();
        if (!urls.includes(normalized)) urls.push(normalized);
      } catch (error) {
        // Ignore malformed URLs.
      }
    };

    if (ref.url) {
      add(ref.url);
      add(ref.url.replace(/\/$/, "") + "/about");
    }

    if (ref.channelId) {
      add("https://www.youtube.com/channel/" + ref.channelId);
      add("https://www.youtube.com/channel/" + ref.channelId + "/about");
    }

    return urls;
  }

  class DataFetcher {
    constructor() {
      this.inFlight = new Map();
      this.active = 0;
      this.waiters = [];
      this.lastStart = 0;
      this.pumpTimer = null;
      this.maxConcurrent = 2;
      this.minIntervalMs = 350;
      this.timeoutMs = 12000;
    }

    configure(requestSettings) {
      if (!requestSettings) return;
      if (Number.isFinite(requestSettings.maxConcurrent)) this.maxConcurrent = requestSettings.maxConcurrent;
      if (Number.isFinite(requestSettings.minIntervalMs)) this.minIntervalMs = requestSettings.minIntervalMs;
      if (Number.isFinite(requestSettings.timeoutMs)) this.timeoutMs = requestSettings.timeoutMs;
    }

    acquire() {
      return new Promise((resolve) => {
        this.waiters.push(resolve);
        this.pump();
      });
    }

    pump() {
      while (this.waiters.length && this.active < this.maxConcurrent) {
        const wait = Math.max(0, this.minIntervalMs - (Date.now() - this.lastStart));
        if (wait > 0) {
          if (!this.pumpTimer) {
            this.pumpTimer = setTimeout(() => {
              this.pumpTimer = null;
              this.pump();
            }, wait);
          }
          return;
        }

        const resolve = this.waiters.shift();
        this.active += 1;
        this.lastStart = Date.now();
        resolve();
      }
    }

    release() {
      this.active = Math.max(0, this.active - 1);
      this.pump();
    }

    async fetchChannel(ref, settings) {
      const key = ref.key || ref.channelId || ref.url;
      if (!key) return { ok: false, error: "missing channel reference" };
      if (this.inFlight.has(key)) return this.inFlight.get(key);

      this.configure(settings && settings.request);

      const promise = this.fetchWithThrottle(ref, settings)
        .finally(() => this.inFlight.delete(key));

      this.inFlight.set(key, promise);
      return promise;
    }

    async fetchWithThrottle(ref, settings) {
      await this.acquire();
      try {
        const urls = buildCandidateUrls(ref);
        if (!urls.length) return { ok: false, error: "no channel url" };

        let lastError = "subscriber count not found";
        for (const url of urls) {
          const result = await this.fetchAndParse(url, settings);
          if (result.ok) {
            result.channel.url = ref.url || ("https://www.youtube.com/channel/" + (result.channel.channelId || ""));
            result.channel.handle = ref.handle || null;
            return result;
          }
          lastError = result.error || lastError;
        }
        return { ok: false, error: lastError };
      } catch (error) {
        return { ok: false, error: "network request failed" };
      } finally {
        this.release();
      }
    }

    async fetchVideoOwner(videoId, settings) {
      if (!V.isValidVideoId(videoId)) return { ok: false, error: "invalid video id" };
      const key = "owner:" + videoId;
      if (this.inFlight.has(key)) return this.inFlight.get(key);
      this.configure(settings && settings.request);
      const promise = (async () => {
        await this.acquire();
        try {
          const page = await this.fetchPublicHtml("https://www.youtube.com/watch?v=" + videoId + "&hl=en&gl=US");
          if (!page.ok) return page;
          const ref = parseVideoOwnerHtml(page.html, videoId);
          return ref ? { ok: true, ref } : { ok: false, error: "video owner unavailable on public video page" };
        } finally {
          this.release();
        }
      })().finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, promise);
      return promise;
    }

    async fetchAndParse(url, settings) {
      const page = await this.fetchPublicHtml(url);
      if (!page.ok) return page;
      const channel = parseChannelHtml(page.html, url);
      return channel ? { ok: true, channel } : { ok: false, error: "subscriber count not found" };
    }

    async fetchPublicHtml(url) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(url, {
          method: "GET",
          credentials: "omit",
          redirect: "follow",
          signal: controller.signal,
          headers: {
            Accept: "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9"
          }
        });

        if (!response.ok) {
          return { ok: false, error: "Public page request failed (" + response.status + ")" };
        }

        const html = await response.text();
        if (!html || html.length < 1000) {
          return { ok: false, error: "empty public page response" };
        }

        const finalUrl = new URL(response.url || url);
        if (finalUrl.hostname === "consent.youtube.com" ||
            /<title[^>]*>\s*Before you continue to YouTube/i.test(html) ||
            /<form[^>]+action=["']https:\/\/consent\.youtube\.com/i.test(html)) {
          return { ok: false, error: "YouTube consent page blocked the request" };
        }

        return { ok: true, html, url: response.url || url };
      } catch (error) {
        if (error && error.name === "AbortError") {
          return { ok: false, error: "Public page request timed out" };
        }
        return { ok: false, error: "network request failed" };
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  OF.dataFetcher = new DataFetcher();
  OF.parseChannelHtml = parseChannelHtml;
  OF.parseVideoOwnerHtml = parseVideoOwnerHtml;
})(typeof globalThis !== "undefined" ? globalThis : this);

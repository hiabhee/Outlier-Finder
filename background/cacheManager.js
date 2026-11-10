(function (root) {
  "use strict";

  const OF = (root.OutlierFinder = root.OutlierFinder || {});

  const KEYS = {
    channel: "of:channel:",
    failure: "of:fail:",
    alias: "of:alias:",
    video: "of:video:",
    owner: "of:owner:",
    post: "of:post:",
    recent: "of:recentOutliers",
    saved: "of:savedVideos",
    stats: "of:lastStats"
  };

  function storageGet(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => resolve(result || {}));
    });
  }

  function storageSet(values) {
    return new Promise((resolve) => {
      chrome.storage.local.set(values, () => resolve());
    });
  }

  function storageRemove(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.remove(keys, () => resolve());
    });
  }

  class CacheManager {
    constructor() {
      this.writeQueue = Promise.resolve();
    }

    enqueue(task) {
      this.writeQueue = this.writeQueue.then(task, task);
      return this.writeQueue;
    }

    async getAlias(key) {
      const result = await storageGet(KEYS.alias + key);
      return result[KEYS.alias + key] || null;
    }

    async setAlias(key, canonicalKey) {
      if (!key || !canonicalKey || key === canonicalKey) return;
      await storageSet({ [KEYS.alias + key]: canonicalKey });
    }

    async getChannel(key) {
      if (!key) return null;
      const alias = await this.getAlias(key);
      const storageKey = KEYS.channel + (alias || key);
      const result = await storageGet(storageKey);
      const entry = result[storageKey];
      if (!entry) return null;

      if (!entry.expiresAt || entry.expiresAt <= Date.now()) {
        await storageRemove(storageKey);
        return null;
      }

      return entry;
    }

    async setChannel(key, data, ttlMs) {
      if (!key || !data) return;
      const now = Date.now();
      const entry = {
        data,
        fetchedAt: now,
        expiresAt: now + ttlMs
      };
      await storageSet({ [KEYS.channel + key]: entry });
    }

    async getFailure(key) {
      if (!key) return null;
      const result = await storageGet(KEYS.failure + key);
      const entry = result[KEYS.failure + key];
      if (!entry) return null;
      if (!entry.expiresAt || entry.expiresAt <= Date.now()) {
        await storageRemove(KEYS.failure + key);
        return null;
      }
      return entry;
    }

    async setFailure(key, reason, ttlMs) {
      if (!key) return;
      const now = Date.now();
      await storageSet({
        [KEYS.failure + key]: {
          reason: reason || "unavailable",
          failedAt: now,
          expiresAt: now + ttlMs
        }
      });
    }

    async getPostMetadata(key) {
      const storageKey = KEYS.post + key;
      const result = await storageGet(storageKey);
      const entry = result[storageKey];
      if (!entry) return null;
      if (!entry.expiresAt || entry.expiresAt <= Date.now()) {
        await storageRemove(storageKey);
        return null;
      }
      return entry.data;
    }

    async setPostMetadata(key, data, ttlMs) {
      await storageSet({ [KEYS.post + key]: { data, expiresAt: Date.now() + ttlMs } });
    }

    async getVideoOwner(videoId) {
      const key = KEYS.owner + videoId;
      const result = await storageGet(key);
      const entry = result[key];
      if (!entry) return null;
      if (!entry.expiresAt || entry.expiresAt <= Date.now()) {
        await storageRemove(key);
        return null;
      }
      return entry.data;
    }

    async setVideoOwner(videoId, ref, ttlMs) {
      await storageSet({ [KEYS.owner + videoId]: { data: ref, expiresAt: Date.now() + ttlMs } });
    }

    async setVideo(video, settings) {
      if (!video || !OF.validator.isValidVideoId(video.videoId)) return;
      const now = Date.now();
      await storageSet({ [KEYS.video + video.videoId]: {
        data: video,
        fetchedAt: now,
        viewsExpireAt: now + settings.cache.viewsMs,
        expiresAt: now + settings.cache.metadataMs
      } });
    }

    async clearTransient() {
      const all = await storageGet(null);
      const keys = Object.keys(all).filter(
        (key) =>
          key.startsWith(KEYS.channel) ||
          key.startsWith(KEYS.failure) ||
          key.startsWith(KEYS.alias) ||
          key.startsWith(KEYS.video) ||
          key.startsWith(KEYS.owner) ||
          key.startsWith(KEYS.post) || key === "of:growth:x"
      );
      if (keys.length) await storageRemove(keys);
      return keys.length;
    }

    async getRecentOutliers() {
      const result = await storageGet(KEYS.recent);
      return Array.isArray(result[KEYS.recent]) ? result[KEYS.recent] : [];
    }

    addRecentOutlier(outlier, maxItems) {
      if (!outlier || !outlier.videoId) return Promise.resolve();
      return this.enqueue(async () => {
        const result = await storageGet(KEYS.recent);
        const list = Array.isArray(result[KEYS.recent]) ? result[KEYS.recent].slice() : [];
        const index = list.findIndex((item) => item.videoId === outlier.videoId);
        if (index !== -1) list.splice(index, 1);
        list.unshift(outlier);
        const limit = Number.isFinite(maxItems) ? maxItems : 200;
        await storageSet({ [KEYS.recent]: list.slice(0, limit) });
      });
    }

    async getSavedVideos() {
      const result = await storageGet(KEYS.saved);
      return Array.isArray(result[KEYS.saved]) ? result[KEYS.saved] : [];
    }

    async setLastStats(stats) {
      if (!stats) return;
      await storageSet({ [KEYS.stats]: stats });
    }
  }

  OF.cacheManager = new CacheManager();
  OF.cacheKeys = KEYS;
})(typeof globalThis !== "undefined" ? globalThis : this);

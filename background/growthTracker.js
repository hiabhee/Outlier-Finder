(function (root) {
  "use strict";
  const OF = root.OutlierFinder;
  let queue = Promise.resolve();
  OF.observeXGrowth = function (postId, views) {
    const job = queue.then(async () => {
      if (typeof postId !== "string" || !/^\d{1,25}$/.test(postId) || !Number.isSafeInteger(views) || views < 0) return { ok: false };
      const settings = await OF.settings.getSettings();
      if (!settings.enabled || !settings.xEnabled) return { ok: false };
      const now = Date.now(), key = "of:growth:x";
      const stored = await OF.settings.storageGet(key);
      const records = Object.fromEntries(Object.entries(stored[key] || {}).filter(([id, value]) => /^\d{1,25}$/.test(id) && Number.isSafeInteger(value?.updatedAt) && value.updatedAt >= now - OF.growth.WINDOW));
      const growth = OF.growth.observe(records[postId], views, now);
      if (!growth) return { ok: false };
      records[postId] = growth;
      const bounded = Object.fromEntries(Object.entries(records).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 500));
      if (!await OF.settings.storageSet({ [key]: bounded })) return { ok: false };
      return { ok: true, growth };
    });
    queue = job.catch(() => {});
    return job;
  };
})(globalThis);

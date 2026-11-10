(function (root) {
  "use strict";

  const OF = (root.OutlierFinder = root.OutlierFinder || {});

  class VideoObserver {
    constructor(options) {
      this.onVideo = options.onVideo;
      this.onScan = options.onScan || (() => {});
      this.watchNavigation = !!options.watchNavigation;
      this.watchScroll = !!options.watchScroll;
      this.routeTimer = null;
      this.lastRoute = "";
      this.scrollHandler = () => this.scheduleScan(80);
      this.mediaHandler = () => this.scheduleScan(60);
      this.scanDebounceMs = options.scanDebounceMs || 320;
      this.rootMargin = options.rootMargin || "320px";
      this.mutationObserver = null;
      this.intersectionObserver = null;
      this.debounceTimer = null;
      this.running = false;
      this.videoByCard = new WeakMap();
      this.processedCards = new WeakSet();
      this.pendingCards = new Set();
      this.navigationHandler = () => this.scheduleScan(120);
      this.visibilityHandler = () => {
        if (document.visibilityState === "visible") this.scheduleScan(400);
      };
    }

    start() {
      if (this.running) return;
      this.running = true;

      this.mutationObserver = new MutationObserver((records) => {
        const isExtensionNode = (node) => {
          const element = node.nodeType === 1 ? node : node.parentElement;
          return element && element.closest && element.closest(
            ".of-badge, .of-tooltip, .of-panel-overlay, .of-reel-overlay"
          );
        };
        if (records.some((record) => {
          // React can discard an injected badge while hydrating or recycling a
          // card. A missing expected badge must trigger a repair scan.
          if (record.type === "childList" && [...record.removedNodes].some((node) => node.nodeType === 1 && node.matches(".of-badge, .of-reel-overlay"))) return true;
          if (isExtensionNode(record.target)) return false;
          if (record.type !== "childList") return true;
          return [...record.addedNodes, ...record.removedNodes].some((node) => !isExtensionNode(node));
        })) this.scheduleScan();
      });
      this.mutationObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["href", "aria-label", "src", "poster", "data-shortcode", "data-post-id"]
      });

      if ("IntersectionObserver" in root) {
        this.intersectionObserver = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              const card = entry.target;
              const video = this.videoByCard.get(card);
              if (!video) continue;
              this.pendingCards.delete(card);
              if (this.processedCards.has(card)) continue;
              this.processedCards.add(card);
              try {
                this.onVideo(video);
              } catch (error) {
                console.warn("[Outlier Finder] card processing failed", error);
              }
            }
          },
          { rootMargin: this.rootMargin, threshold: 0.01 }
        );
      }

      document.addEventListener("yt-navigate-finish", this.navigationHandler, true);
      document.addEventListener("yt-page-data-updated", this.navigationHandler, true);
      root.addEventListener("popstate", this.navigationHandler, true);
      document.addEventListener("visibilitychange", this.visibilityHandler);

      if (this.watchScroll) {
        document.addEventListener("scroll", this.scrollHandler, { capture: true, passive: true });
        document.addEventListener("loadedmetadata", this.mediaHandler, true);
        document.addEventListener("play", this.mediaHandler, true);
        root.addEventListener("resize", this.scrollHandler, { passive: true });
      }
      if (this.watchNavigation) {
        this.lastRoute = root.location.href;
        this.routeTimer = root.setInterval(() => {
          if (root.location.href === this.lastRoute) return;
          this.lastRoute = root.location.href;
          this.scheduleScan(40);
        }, 250);
      }
      this.scheduleScan(60);
    }

    stop() {
      if (!this.running) return;
      this.running = false;

      if (this.mutationObserver) {
        this.mutationObserver.disconnect();
        this.mutationObserver = null;
      }
      if (this.intersectionObserver) {
        this.intersectionObserver.disconnect();
        this.intersectionObserver = null;
      }
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }

      document.removeEventListener("yt-navigate-finish", this.navigationHandler, true);
      document.removeEventListener("yt-page-data-updated", this.navigationHandler, true);
      root.removeEventListener("popstate", this.navigationHandler, true);
      document.removeEventListener("visibilitychange", this.visibilityHandler);

      document.removeEventListener("scroll", this.scrollHandler, true);
      document.removeEventListener("loadedmetadata", this.mediaHandler, true);
      document.removeEventListener("play", this.mediaHandler, true);
      root.removeEventListener("resize", this.scrollHandler);
      if (this.routeTimer) { root.clearInterval(this.routeTimer); this.routeTimer = null; }
      this.pendingCards.clear();
    }

    scheduleScan(delay) {
      if (!this.running) return;
      // Continuous YouTube mutations must not postpone the scan indefinitely.
      if (this.debounceTimer) return;
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.scan();
      }, typeof delay === "number" ? delay : this.scanDebounceMs);
    }

    scan() {
      if (!this.running) return;
      this.onScan();
      const cards = OF.extractor.findVideoCards(document);

      for (const card of cards) {
        const parsed = OF.extractor.getCardVideoId(card);
        if (!parsed || !parsed.videoId) continue;

        const knownId = card.dataset.ofVideoId;
        const previous = this.videoByCard.get(card);
        const fingerprint = OF.extractor.fingerprint ? OF.extractor.fingerprint(card) : null;
        const badgeScope = previous && previous.thumbnailElement;
        const detachedHost = badgeScope && !badgeScope.isConnected;
        const badges = [...card.querySelectorAll(".of-badge"), ...(badgeScope && badgeScope !== card ? badgeScope.querySelectorAll(".of-badge") : [])];
        const missingBadge = card.dataset.ofBadgeExpected === "1" && !badges.some((badge) => badge.isConnected && badge.dataset.ofVideoId === parsed.videoId);
        if (!missingBadge && !detachedHost && knownId === parsed.videoId && card.dataset.ofProcessed === "1" &&
            previous && (fingerprint !== null ? previous.fingerprint === fingerprint :
              previous.views !== null && previous.channel && previous.channel.url)) continue;

        if (knownId && knownId !== parsed.videoId) {
          for (const badge of card.querySelectorAll(".of-badge")) badge.remove();
          this.processedCards.delete(card);
          this.pendingCards.delete(card);
        }

        let video;
        try {
          video = OF.extractor.extractVideoCard(card);
        } catch (error) {
          continue;
        }
        if (!video || !video.videoId) continue;

        card.dataset.ofVideoId = video.videoId;
        card.dataset.ofProcessed = "1";
        video.fingerprint = fingerprint;
        this.processedCards.delete(card);
        this.videoByCard.set(card, video);
        this.pendingCards.add(card);

        if (this.intersectionObserver) {
          this.intersectionObserver.observe(card);
        } else {
          this.pendingCards.delete(card);
          if (!this.processedCards.has(card)) {
            this.processedCards.add(card);
            this.onVideo(video);
          }
        }
      }

      this.flushVisible();
    }

    flushVisible() {
      if (!this.pendingCards.size) return;
      for (const card of Array.from(this.pendingCards)) {
        if (!card.isConnected) {
          this.pendingCards.delete(card);
          if (this.intersectionObserver) this.intersectionObserver.unobserve(card);
          continue;
        }
        if (!this.intersectionObserver) continue;
        const rect = card.getBoundingClientRect();
        const inViewport =
          rect.bottom >= -320 &&
          rect.top <= (root.innerHeight || 0) + 320 &&
          rect.right >= 0 &&
          rect.left <= (root.innerWidth || 0);
        if (!inViewport) continue;

        const video = this.videoByCard.get(card);
        this.pendingCards.delete(card);
        if (!video || this.processedCards.has(card)) continue;
        this.processedCards.add(card);
        try {
          this.onVideo(video);
        } catch (error) {
          console.warn("[Outlier Finder] card processing failed", error);
        }
      }
    }

    rescan() {
      this.scheduleScan(40);
    }

    reset() {
      if (!this.running) return;
      this.processedCards = new WeakSet();
      this.pendingCards.clear();

      for (const card of OF.extractor.findVideoCards(document)) {
        const video = this.videoByCard.get(card);
        if (!video) continue;
        this.pendingCards.add(card);
        if (this.intersectionObserver) this.intersectionObserver.observe(card);
      }

      this.flushVisible();
      this.scheduleScan(80);
    }
  }

  OF.VideoObserver = VideoObserver;
})(typeof globalThis !== "undefined" ? globalThis : this);

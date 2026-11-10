(function (root) {
  "use strict";

  const OF = (root.OutlierFinder = root.OutlierFinder || {});
  const C = OF.calculator;

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function createEl(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  class BadgeManager {
    constructor(options) {
      this.options = options || {};
      this.tooltip = null;
      this.panelOverlay = null;
      this.activeTooltipBadge = null;
      this.boundHideTooltip = () => this.hideTooltip();
      root.addEventListener("scroll", this.boundHideTooltip, { capture: true, passive: true });
      root.addEventListener("resize", this.boundHideTooltip, { passive: true });
    }

    ensureHost(video) {
      let host = video.thumbnailElement || video.cardElement;
      if (!host) return null;
      // Some YouTube custom thumbnail elements use display: contents or
      // inline boxes; anchor the overlay to a container with its own box.
      while (host !== video.cardElement && host.parentElement &&
          ["contents", "inline"].includes(root.getComputedStyle(host).display)) {
        host = host.parentElement;
      }
      if (host.tagName === "A" && host.parentElement) {
        host = host.parentElement;
      }
      if (!host.classList.contains("of-thumb-host")) {
        host.classList.add("of-thumb-host");
        try {
          if (!root.getComputedStyle(host).position || root.getComputedStyle(host).position === "static") {
            host.style.position = "relative";
          }
        } catch (error) {
          host.style.position = "relative";
        }
      }
      return host;
    }

    getBadge(host) {
      if (!host) return null;
      const badges = host.querySelectorAll(":scope > .of-badge");
      return badges.length ? badges[badges.length - 1] : null;
    }

    removeBadge(video) {
      const host = video && this.ensureHost(video);
      if (!host) return;
      const badges = host.querySelectorAll(":scope > .of-badge");
      for (const badge of badges) badge.remove();
      if (this.activeTooltipBadge && !this.activeTooltipBadge.isConnected) {
        this.hideTooltip();
      }
    }

    render(video, payload) {
      if (!video) return;
      const settings = payload.settings || {};
      const host = this.ensureHost(video);
      if (!host) return;

      if (!payload.display || settings.badgeVisible === false) {
        this.removeBadge(video);
        return;
      }

      let badge = this.getBadge(host);
      if (badge && badge.dataset.ofVideoId !== video.videoId) {
        badge.remove();
        badge = null;
      }

      if (!badge) {
        badge = createEl("button", "of-badge");
        badge.type = "button";
        badge.dataset.ofVideoId = video.videoId;
        badge.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.openPanel(badge._ofVideo, badge._ofPayload);
        });
        badge.addEventListener("mouseenter", () => this.showTooltip(badge, badge._ofVideo, badge._ofPayload));
        badge.addEventListener("mouseleave", () => this.hideTooltip());
        badge.addEventListener("focus", () => this.showTooltip(badge, badge._ofVideo, badge._ofPayload));
        badge.addEventListener("blur", () => this.hideTooltip());
        host.appendChild(badge);
      }

      badge._ofVideo = video;
      badge._ofPayload = payload;
      badge.dataset.ofVideoId = video.videoId;
      badge.dataset.ofState = payload.state || "scored";
      badge.className = "of-badge";
      badge.removeAttribute("title");
      badge.innerHTML = "";

      if (payload.state === "loading") {
        badge.classList.add("of-badge--loading");
        badge.appendChild(createEl("span", "of-badge__pulse"));
        badge.appendChild(createEl("span", "of-badge__text", "SCANNING"));
        badge.setAttribute("aria-label", "Outlier Finder is scanning this video");
        return;
      }

      if (payload.state === "unavailable") {
        badge.classList.add("of-badge--unavailable");
        badge.appendChild(createEl("span", "of-badge__text", "SCORE N/A"));
        badge.setAttribute("aria-label", "Score unavailable: " + (payload.reason || "data unavailable"));
        badge.title = "Score unavailable: " + (payload.reason || "data unavailable");
        this.addGrowthBadge(badge, payload.growth);
        return;
      }

      const classification = payload.classification;
      if (!classification) {
        this.removeBadge(video);
        return;
      }

      badge.classList.add(payload.eligible ? classification.className : "of-badge--normal");
      badge.classList.add("of-badge--scored");

      const scoreEl = createEl("span", "of-badge__score", payload.scoreText || (Number.isFinite(payload.score) ? C.formatScore(payload.score) + "x" : "N/A"));
      const labelEl = createEl("span", "of-badge__label", payload.badgeLabel || (payload.eligible ? classification.badgeLabel : "SCORE"));
      badge.appendChild(scoreEl);
      badge.appendChild(labelEl);
      badge.setAttribute(
        "aria-label",
        (payload.metric === "likes" ? "Engagement" : classification.label) + ": " + (payload.scoreText || C.formatRatio(payload.score))
      );
      this.addGrowthBadge(badge, payload.growth);
    }

    addGrowthBadge(badge, growth) {
      if (!growth) return;
      const text = growth.state === "collecting" ? "GROWTH: COLLECTING" : (growth.state === "growing" ? "↑ " : "") + C.formatCount(Math.round(growth.viewsPerMinute * 10) / 10) + " views/min";
      const label = createEl("span", "of-badge__growth", text);
      badge.appendChild(label);
      badge.setAttribute("aria-label", (badge.getAttribute("aria-label") || "") + ". " + text);
    }

    showTooltip(badge, video, payload) {
      this.hideTooltip();
      if (!badge || !badge.isConnected) return;

      const tooltip = createEl("div", "of-tooltip");
      const channel = video.channel || {};
      const score = payload.score;
      const classification = payload.classification;

      const header = createEl("div", "of-tooltip__header");
      const title = createEl("div", "of-tooltip__title", video.title || "Untitled video");
      const subtitle = createEl("div", "of-tooltip__subtitle", channel.name || "Unknown channel");
      header.appendChild(title);
      header.appendChild(subtitle);
      tooltip.appendChild(header);

      const scoreRow = createEl("div", "of-tooltip__score");
      scoreRow.classList.add(classification ? classification.className : "of-badge--normal");
      scoreRow.appendChild(createEl("span", "of-tooltip__score-value", payload.scoreText || (Number.isFinite(score) ? C.formatScore(score) + "x" : "N/A")));
      scoreRow.appendChild(createEl("span", "of-tooltip__score-label", payload.metric === "likes" ? "Likes / followers" : classification ? classification.label : "Outlier score"));
      tooltip.appendChild(scoreRow);

      const grid = createEl("div", "of-tooltip__grid");
      this.addStat(grid, payload.metricLabel || "Views", payload.primaryText || payload.viewsText || C.formatCount(payload.views));
      this.addStat(grid, payload.audienceLabel || "Subscribers", payload.subscriberText || C.formatCount(payload.subscriberCount));
      this.addStat(grid, "Ratio", payload.scoreText || C.formatRatio(score));
      this.addStat(grid, "Published", video.publishedText || (video.ageDays !== null ? Math.round(video.ageDays) + " days ago" : "Unknown"));
      if (payload.viewsPerDay !== null && payload.viewsPerDay !== undefined) {
        this.addStat(grid, "Views / day", C.formatViewsPerDay(payload.viewsPerDay));
      }
      if (payload.growth) this.addStat(grid, "Observed view growth", payload.growth.state === "collecting" ? "Collecting data" : C.formatCount(Math.round(payload.growth.viewsPerMinute * 10) / 10) + " views/min");
      tooltip.appendChild(grid);

      if (payload.reason) tooltip.appendChild(createEl("div", "of-tooltip__note", payload.reason));
      if (payload.formulaNote) tooltip.appendChild(createEl("div", "of-tooltip__note", payload.formulaNote));
      if (payload.approximateSubscribers) {
        tooltip.appendChild(createEl("div", "of-tooltip__note", (payload.audienceLabel || "Subscriber") + " count is rounded — ratio is an estimate."));
      }

      tooltip.appendChild(createEl("div", "of-tooltip__hint", "Click badge for details"));

      document.body.appendChild(tooltip);
      this.tooltip = tooltip;
      this.activeTooltipBadge = badge;
      this.positionTooltip(badge, tooltip);
    }

    addStat(grid, label, value) {
      const cell = createEl("div", "of-tooltip__stat");
      cell.appendChild(createEl("span", "of-tooltip__stat-label", label));
      cell.appendChild(createEl("span", "of-tooltip__stat-value", value));
      grid.appendChild(cell);
    }

    positionTooltip(badge, tooltip) {
      const rect = badge.getBoundingClientRect();
      const margin = 8;
      const width = tooltip.offsetWidth || 250;
      const height = tooltip.offsetHeight || 180;

      let left = rect.left;
      let top = rect.bottom + margin;

      if (left + width > window.innerWidth - margin) {
        left = Math.max(margin, window.innerWidth - width - margin);
      }
      if (top + height > window.innerHeight - margin) {
        top = Math.max(margin, rect.top - height - margin);
      }

      tooltip.style.left = left + "px";
      tooltip.style.top = top + "px";
    }

    hideTooltip() {
      if (this.tooltip) {
        this.tooltip.remove();
        this.tooltip = null;
      }
      this.activeTooltipBadge = null;
    }

    openPanel(video, payload) {
      this.closePanel();
      this.hideTooltip();

      const channel = video.channel || {};
      const classification = payload.classification;
      const overlay = createEl("div", "of-panel-overlay");
      const panel = createEl("div", "of-panel");
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      panel.setAttribute("aria-label", "Outlier Finder video details");

      const close = createEl("button", "of-panel__close", "×");
      close.type = "button";
      close.setAttribute("aria-label", "Close");
      close.addEventListener("click", () => this.closePanel());

      const header = createEl("div", "of-panel__header");
      if (video.thumbnailUrl) {
        const image = createEl("img", "of-panel__thumb");
        image.src = video.thumbnailUrl;
        image.alt = "";
        image.loading = "lazy";
        header.appendChild(image);
      }
      const headerText = createEl("div", "of-panel__header-text");
      headerText.appendChild(createEl("div", "of-panel__title", video.title || "Untitled video"));
      headerText.appendChild(createEl("div", "of-panel__channel", channel.name || "Unknown channel"));
      header.appendChild(headerText);

      const scoreCard = createEl("div", "of-panel__score");
      if (classification) scoreCard.classList.add(classification.className);
      const scoreMain = createEl("div", "of-panel__score-main");
      scoreMain.appendChild(createEl("span", "of-panel__score-value", payload.scoreText || (Number.isFinite(payload.score) ? C.formatScore(payload.score) + "x" : "N/A")));
      scoreMain.appendChild(createEl("span", "of-panel__score-label", payload.metric === "likes" ? "Likes / followers" : classification ? classification.label : "Outlier score"));
      scoreCard.appendChild(scoreMain);
      if (payload.eligible) {
        scoreCard.appendChild(createEl("div", "of-panel__score-note", "Qualifies as an outlier"));
      } else {
        scoreCard.appendChild(createEl("div", "of-panel__score-note", payload.state === "unavailable" ? (payload.reason || "Data unavailable") : payload.state === "loading" ? "Retrieving subscriber data…" : "Below your current outlier thresholds"));
      }

      const grid = createEl("div", "of-panel__grid");
      this.addPanelStat(grid, payload.metricLabel || "Views", payload.primaryText || payload.viewsText || C.formatCount(payload.views));
      this.addPanelStat(grid, payload.audienceLabel || "Subscribers", payload.subscriberText || C.formatCount(payload.subscriberCount));
      this.addPanelStat(grid, payload.metric === "likes" ? "Engagement" : "Outlier score", payload.scoreText || C.formatRatio(payload.score));
      this.addPanelStat(grid, "Published", video.publishedText || (video.ageDays !== null ? Math.round(video.ageDays) + " days ago" : "Unknown"));
      this.addPanelStat(grid, "Video age", video.ageDays !== null && video.ageDays !== undefined ? Math.round(video.ageDays * 10) / 10 + " days" : "Unknown");
      if (payload.metric !== "likes") this.addPanelStat(grid, "Views / day", C.formatViewsPerDay(payload.viewsPerDay));

      if (payload.growth) {
        const growth = payload.growth;
        this.addPanelStat(grid, "Observed view growth", growth.state === "collecting" ? "Collecting data" : C.formatCount(Math.round(growth.viewsPerMinute * 10) / 10) + " views/min");
        if (growth.state !== "collecting") {
          this.addPanelStat(grid, "Views gained", "+" + C.formatCount(growth.deltaViews));
          this.addPanelStat(grid, "Measured interval", Math.round(growth.elapsedMinutes * 10) / 10 + " minutes");
          this.addPanelStat(grid, "View increase", growth.percentChange === null ? "No percentage baseline" : Math.round(growth.percentChange * 10) / 10 + "%");
        }
      }
      const note = createEl("div", "of-panel__note");
      note.textContent = payload.formulaNote || (payload.approximateSubscribers
        ? "YouTube rounds this channel's subscriber count, so the ratio is an estimate."
        : "Outlier score = video views ÷ channel subscribers. Thresholds are heuristic, not statistically validated benchmarks.");

      const actions = createEl("div", "of-panel__actions");
      const openLink = createEl("a", "of-panel__btn of-panel__btn--primary", "Open on " + (payload.platformLabel || "YouTube"));
      openLink.href = video.videoUrl;
      openLink.target = "_blank";
      openLink.rel = "noopener noreferrer";

      const saveButton = createEl("button", "of-panel__btn", "Save for later");
      saveButton.type = "button";
      const canSave = payload.state === "scored";
      saveButton.disabled = !canSave;
      saveButton.addEventListener("click", async () => {
        if (!canSave || !this.options.onToggleSave) return;
        saveButton.disabled = true;
        try {
          const saved = await this.options.onToggleSave(video, payload);
          saveButton.textContent = saved ? "Saved ✓" : "Save for later";
          saveButton.classList.toggle("of-panel__btn--saved", !!saved);
        } catch (error) {
          saveButton.textContent = "Save failed";
        } finally {
          saveButton.disabled = false;
        }
      });

      const closeButton = createEl("button", "of-panel__btn", "Close");
      closeButton.type = "button";
      closeButton.addEventListener("click", () => this.closePanel());

      if (payload.platformLabel && payload.state === "unavailable" && /followers|profile/i.test(payload.reason || "") && channel.url) {
        const profileLink = createEl("a", "of-panel__btn of-panel__btn--primary", "Open creator profile");
        profileLink.href = channel.url;
        profileLink.target = "_blank";
        profileLink.rel = "noopener noreferrer";
        actions.appendChild(profileLink);
      }
      actions.appendChild(openLink);
      actions.appendChild(saveButton);
      actions.appendChild(closeButton);

      panel.appendChild(close);
      panel.appendChild(header);
      panel.appendChild(scoreCard);
      panel.appendChild(grid);
      panel.appendChild(note);
      if (payload.growth) panel.appendChild(createEl("p", "of-panel__note", "Growth compares view counts observed at least one minute apart, within the past hour. Refresh or revisit posts for new readings. The extension does not poll X continuously; rounded counts can hide small changes."));
      if (this.options.onSetFollowers && payload.state === "unavailable" && /followers|profile/i.test(payload.reason || "") && channel.url) {
        const form = createEl("form", "of-panel__note");
        const label = createEl("label", "", "Follower count from the creator’s profile");
        const input = createEl("input", "of-panel__btn");
        input.type = "number"; input.min = "1"; input.max = "1000000000000"; input.step = "1"; input.required = true;
        input.setAttribute("aria-label", "Creator follower count");
        label.appendChild(input);
        const submit = createEl("button", "of-panel__btn", "Use follower count"); submit.type = "submit";
        const status = createEl("p", "", "Used locally as an estimate until a fresh profile count is available."); status.setAttribute("aria-live", "polite");
        form.append(label, submit, status);
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const count = Number(input.value);
          if (!input.value || !Number.isInteger(count) || count <= 0 || count > 1e12) { status.textContent = "Enter a whole follower count greater than zero."; return; }
          submit.disabled = true;
          try { await this.options.onSetFollowers(video, count); this.closePanel(); }
          catch (error) { status.textContent = "Could not save the count. Try again."; submit.disabled = false; }
        });
        panel.appendChild(form);
      }
      panel.appendChild(actions);
      overlay.appendChild(panel);

      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) this.closePanel();
      });
      this.escapeHandler = (event) => {
        if (event.key === "Escape") this.closePanel();
      };
      document.addEventListener("keydown", this.escapeHandler, true);

      document.body.appendChild(overlay);
      this.panelOverlay = overlay;

      if (canSave && this.options.onToggleSave) {
        Promise.resolve()
          .then(() => (this.options.isSaved ? this.options.isSaved(video.videoId) : false))
          .then((saved) => {
            if (saved && saveButton.isConnected) {
              saveButton.textContent = "Saved ✓";
              saveButton.classList.add("of-panel__btn--saved");
            }
          })
          .catch(() => {});
      }
    }

    addPanelStat(grid, label, value) {
      const cell = createEl("div", "of-panel__stat");
      cell.appendChild(createEl("span", "of-panel__stat-label", label));
      cell.appendChild(createEl("span", "of-panel__stat-value", value));
      grid.appendChild(cell);
    }

    closePanel() {
      if (this.escapeHandler) {
        document.removeEventListener("keydown", this.escapeHandler, true);
        this.escapeHandler = null;
      }
      if (this.panelOverlay) {
        this.panelOverlay.remove();
        this.panelOverlay = null;
      }
    }

    removeAll() {
      this.closePanel();
      this.hideTooltip();
      const badges = document.querySelectorAll(".of-badge");
      for (const badge of badges) badge.remove();
    }
  }

  OF.BadgeManager = BadgeManager;
})(typeof globalThis !== "undefined" ? globalThis : this);

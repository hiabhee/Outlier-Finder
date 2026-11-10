(function (root) {
  "use strict";

  const OF = (root.OutlierFinder = root.OutlierFinder || {});

  const CATEGORIES = Object.freeze({
    massive: {
      key: "massive",
      label: "Massive outlier",
      badgeLabel: "MEGA OUTLIER",
      className: "of-badge--massive",
      order: 5,
      settingKey: "showMassive"
    },
    strong: {
      key: "strong",
      label: "Strong outlier",
      badgeLabel: "MASSIVE",
      className: "of-badge--strong",
      order: 4,
      settingKey: "showStrong"
    },
    viral: {
      key: "viral",
      label: "Viral outlier",
      badgeLabel: "VIRAL",
      className: "of-badge--viral",
      order: 3,
      settingKey: "showViral"
    },
    potential: {
      key: "potential",
      label: "Potential outlier",
      badgeLabel: "OUTLIER",
      className: "of-badge--potential",
      order: 2,
      settingKey: "showPotential"
    },
    "above-average": {
      key: "above-average",
      label: "Above average",
      badgeLabel: "ABOVE AVG",
      className: "of-badge--above-average",
      order: 1,
      settingKey: "showAboveAverage"
    },
    underperforming: {
      key: "underperforming",
      label: "Underperforming",
      badgeLabel: "UNDERPERFORMING",
      className: "of-badge--normal",
      order: -1,
      settingKey: "showNormal"
    },
    normal: {
      key: "normal",
      label: "Normal",
      badgeLabel: "NORMAL",
      className: "of-badge--normal",
      order: 0,
      settingKey: "showNormal"
    }
  });

  const ORDERED_KEYS = ["massive", "strong", "viral", "potential", "above-average", "normal"];

  function categoryFromScore(score, thresholds) {
    if (!Number.isFinite(score)) return CATEGORIES.normal;
    if (score >= thresholds.massive) return CATEGORIES.massive;
    if (score >= thresholds.strong) return CATEGORIES.strong;
    if (score >= thresholds.viral) return CATEGORIES.viral;
    if (score >= thresholds.potential) return CATEGORIES.potential;
    if (score >= thresholds.aboveAverage) return CATEGORIES["above-average"];
    return score < 1 ? CATEGORIES.underperforming : CATEGORIES.normal;
  }

  function classifyOutlier(score, views, settings) {
    const options = settings || OF.settings.DEFAULTS;
    const thresholds = options.thresholds || OF.settings.DEFAULTS.thresholds;
    const minViews = Number.isFinite(options.minViews) ? options.minViews : OF.settings.DEFAULTS.minViews;
    const minScore = Number.isFinite(options.minScore) ? options.minScore : OF.settings.DEFAULTS.minScore;

    const numericScore = Number.isFinite(score) ? score : null;
    const numericViews = Number.isFinite(views) ? views : null;
    const category = categoryFromScore(numericScore, thresholds);

    const passesMinimums =
      numericScore !== null &&
      numericViews !== null &&
      numericViews >= minViews &&
      numericScore >= minScore;

    const settingKey = category.settingKey;
    const enabledForCategory = options[settingKey] !== false;

    return {
      category: category.key,
      label: category.label,
      badgeLabel: category.badgeLabel,
      className: category.className,
      order: category.order,
      qualifies: passesMinimums,
      enabled: enabledForCategory,
      shouldShow: passesMinimums && enabledForCategory
    };
  }

  function badgeText(score, classification) {
    const formatted = OF.calculator.formatScore(score);
    return formatted + "x " + classification.badgeLabel;
  }

  OF.classification = {
    CATEGORIES,
    ORDERED_KEYS,
    categoryFromScore,
    classifyOutlier,
    badgeText
  };
})(typeof globalThis !== "undefined" ? globalThis : this);

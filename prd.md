# Product Requirements Document (PRD)
# Outlier Finder — YouTube Viral Video Detector

**Product:** Outlier Finder  
**Platform:** Google Chrome Extension  
**Version:** 1.0 (MVP)  
**Document status:** Product specification  
**Primary approach:** Browser-side YouTube data extraction and scraping, with caching and optional fallback data sources.

---

# 1. Product Overview

## 1.1 What is Outlier Finder?

Outlier Finder is a Chrome extension that identifies unusually successful YouTube videos by comparing a video's view count against the subscriber count of its creator.

The extension operates directly on YouTube.

When a user opens their YouTube homepage, Outlier Finder automatically scans the videos displayed on the page, extracts relevant information, calculates an Outlier Score, and visually marks videos that are performing significantly better than the creator's subscriber base would suggest.

The primary objective is to discover:

- Small creators producing unexpectedly viral videos.
- Videos receiving significantly more views than their channel size suggests.
- Content topics and formats that outperform their creators' usual reach.
- Potential content opportunities and successful video ideas.

**Core product promise:**

Find the videos that are punching far above their creator's weight.

## 1.2 Problem Statement

When researching YouTube content ideas, creators often struggle to identify videos that have achieved exceptional performance.

A video with 500,000 views might seem successful, but that number alone doesn't tell us much.

Consider two examples:

- Creator A has 2 million subscribers and a video with 500,000 views.
- Creator B has 8,000 subscribers and a video with 500,000 views.

The second video is potentially a much more interesting content opportunity.

Currently, users must manually:
1. Open a video.
2. Visit its channel.
3. Find the subscriber count.
4. Compare the numbers.
5. Repeat this process across multiple videos.

Outlier Finder automates this entire process.

## 1.3 Target Audience

Primary users:
- YouTube creators.
- YouTube automation agencies.
- Content strategists.
- Video researchers.
- Faceless YouTube channel operators.
- Digital marketers.
- People researching profitable YouTube niches.

---

# 2. Product Goals

## Primary Goals

1. Automatically identify YouTube video outliers.
2. Display outlier scores directly on YouTube thumbnails.
3. Eliminate manual subscriber-to-view comparisons.
4. Make the extension work seamlessly while browsing YouTube.
5. Keep API costs at zero in the initial scraping-based implementation.
6. Provide a simple interface that does not interfere with the normal YouTube experience.

## Secondary Goals

1. Allow users to filter videos by outlier score.
2. Create a dashboard of detected outlier videos.
3. Save interesting videos for later research.
4. Identify channels repeatedly producing outlier videos.
5. Eventually compare video performance against a channel's historical performance.

## Non-Goals for MVP

The first version will NOT:
- Download YouTube videos.
- Generate video transcripts.
- Automatically create content.
- Analyze thumbnails using AI.
- Predict future video performance.
- Track every YouTube video on the platform.
- Require users to sign in to Outlier Finder.

---

# 3. Core Product Concept: Outlier Score

The most important feature is the Outlier Score.

## 3.1 Basic Formula

Outlier Score = Video Views / Channel Subscribers

Example:

| Metric | Value |
|---|---:|
| Channel subscribers | 10,000 |
| Video views | 500,000 |
| Outlier Score | 50x |

This means the video has accumulated views equal to 50 times the channel's subscriber count.

## 3.2 Outlier Classification

Initial classification thresholds:

| Score | Classification | Visual treatment |
|---|---|---|
| Below 1x | Underperforming | No badge |
| 1x–2x | Normal | No badge |
| 2x–5x | Above average | Subtle badge |
| 5x–10x | Potential outlier | Yellow badge |
| 10x–30x | Viral outlier | Green badge |
| 30x–50x | Strong outlier | Purple badge |
| 50x+ | Massive outlier | Highlight badge |

Thresholds must be configurable.

Important: These are heuristic classifications, not statistically validated performance benchmarks.

## 3.3 Minimum View Threshold

We must avoid classifying a video with very few views as viral simply because its channel has very few subscribers.

Introduce a minimum view threshold.

Default:
- Minimum views: 5,000.
- Minimum subscriber count: 100, if available.
- Minimum outlier score: 5x.

All three conditions must be satisfied for a video to receive a standard outlier badge.

Users can change these settings.

## 3.4 Additional Metrics

For every video, store:

- Video title.
- Video URL.
- Video ID.
- Thumbnail URL.
- Channel name.
- Channel ID.
- Subscriber count.
- View count.
- Outlier Score.
- Video publication date, if available.
- Video age in days.
- Data collection timestamp.

Future metrics:

**Views per day**

Views / Video Age in Days

**Views-to-subscriber ratio**

Views / Subscribers

**Channel performance ratio**

Video Views / Median Views of Recent Channel Videos

The third metric is particularly valuable because it identifies videos that outperform the creator's normal performance, not just their subscriber count.

---

# 4. User Experience and Interface

## 4.1 Primary Experience: YouTube Homepage

The user should not need to open the extension every time they visit YouTube.

Expected workflow:

1. User opens YouTube.
2. Outlier Finder activates automatically.
3. Extension detects visible video cards.
4. Video information is extracted.
5. Channel subscriber data is retrieved or loaded from cache.
6. Outlier Score is calculated.
7. A badge is injected into the corresponding video thumbnail.

The experience should feel native to YouTube.

## 4.2 Video Badge Design

Badges should appear on the video thumbnail, preferably in the top-left corner or another position that does not conflict with YouTube's existing UI.

Examples:

- `5.2x OUTLIER`
- `12x VIRAL`
- `34x MASSIVE`
- `78x MEGA OUTLIER`

The badge should be compact and readable.

When the user hovers over a badge, display a tooltip.

Example:

**OUTLIER: 42x**

- Views: 420K
- Subscribers: 10K
- Ratio: 42x
- Published: 4 days ago

Clicking the badge should open an expanded information panel.

## 4.3 Example Homepage Experience

The homepage might contain:

| Video | Views | Subscribers | Score | Status |
|---|---:|---:|---:|---|
| Video A | 420K | 10K | 42x | Massive |
| Video B | 90K | 80K | 1.1x | Normal |
| Video C | 1.2M | 40K | 30x | Strong |
| Video D | 600K | 5K | 120x | Massive |
| Video E | 20K | 15K | 1.3x | Normal |

Only qualifying videos receive badges.

## 4.4 Extension Popup

Clicking the Chrome extension icon should open a compact dashboard.

Dashboard sections:

**Overview**
- Videos scanned.
- Outliers discovered.
- Highest Outlier Score.
- Number of channels discovered.

**Recent Outliers**
- Video thumbnail.
- Video title.
- Channel name.
- Views.
- Subscribers.
- Outlier Score.
- Direct video link.

**Quick Filters**
- All.
- 5x+.
- 10x+.
- 30x+.
- 50x+.

**Settings**
- Enable/disable detection.
- Minimum view threshold.
- Minimum Outlier Score.
- Badge visibility.
- Cache duration.

---

# 5. Data Extraction and Scraping Strategy

This is the most important technical component.

The MVP should prioritize browser-visible YouTube information and avoid requiring a Google API key.

## 5.1 Extraction Strategy

The extension will use a combination of:

1. YouTube homepage DOM extraction.
2. Video-page information extraction when necessary.
3. Channel-page information extraction when necessary.
4. Local caching to avoid repeatedly requesting the same information.

The extension must not assume that every required field is available on the homepage.

### Video information

Extract from the homepage whenever available:

- Video ID.
- Video title.
- Channel name.
- Channel URL or channel ID.
- View count.
- Publication age.
- Thumbnail.

### Subscriber information

The homepage does not consistently expose exact subscriber counts.

Therefore:

1. Extract the channel ID.
2. Check the local cache.
3. If a valid cached subscriber count exists, reuse it.
4. If not, retrieve publicly displayed channel information through a permitted channel-page request.
5. Parse the subscriber count when available.
6. Store the result with its retrieval timestamp.
7. If subscriber information is unavailable, mark the video as pending or unavailable rather than inventing a score.

### Important technical constraint

YouTube's page structure changes frequently.

The scraper must:
- Support multiple DOM selectors where practical.
- Handle missing fields.
- Avoid depending on one fragile CSS selector.
- Revalidate extracted information.
- Handle dynamic page rendering.
- Avoid bypassing access controls, login restrictions, CAPTCHAs, or other technical protections.

The project must also undergo a YouTube Terms of Service and applicable policy review before distribution. Browser-side scraping is not automatically permitted just because information is publicly visible.

---

# 6. Complete Technical Architecture

## 6.1 Technology Stack

| Component | Technology |
|---|---|
| Extension framework | Chrome Manifest V3 |
| Programming language | JavaScript |
| UI | HTML + CSS |
| DOM extraction | Content Scripts |
| Background operations | Service Worker |
| Data storage | chrome.storage.local |
| Caching | Local storage |
| Video detection | MutationObserver |
| Calculations | JavaScript |
| Build system | None required initially |

No React or backend server is required for the MVP.

## 6.2 Project Folder Structure

```text
outlier-finder/
│
├── manifest.json
│
├── content/
│   ├── content.js
│   ├── observer.js
│   ├── videoExtractor.js
│   ├── badgeManager.js
│   └── styles.css
│
├── background/
│   ├── serviceWorker.js
│   ├── dataFetcher.js
│   └── cacheManager.js
│
├── core/
│   ├── outlierCalculator.js
│   ├── classification.js
│   └── dataValidator.js
│
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
│
├── options/
│   ├── options.html
│   ├── options.js
│   └── options.css
│
└── assets/
    └── icons/
```

## 6.3 Component Responsibilities

**content.js**

Main entry point for YouTube page integration.

Responsibilities:
- Initialize the extension.
- Detect the current YouTube page.
- Start video scanning.
- Coordinate extraction and badge rendering.

**observer.js**

Uses MutationObserver to detect dynamically loaded videos.

Responsibilities:
- Detect new video cards.
- Handle infinite scrolling.
- Avoid processing the same card repeatedly.
- Detect when cards disappear or are replaced.

**videoExtractor.js**

Responsibilities:
- Find video cards.
- Extract video IDs.
- Extract titles and channel information.
- Extract available view counts.
- Extract publication age.
- Validate extracted data.

**badgeManager.js**

Responsibilities:
- Inject badges.
- Update existing badges.
- Remove outdated badges.
- Avoid interfering with YouTube controls.
- Prevent duplicate badges.

**serviceWorker.js**

Responsibilities:
- Receive data requests.
- Coordinate background fetches.
- Manage message passing.
- Handle caching operations.

**dataFetcher.js**

Responsibilities:
- Retrieve missing channel information.
- Parse subscriber counts.
- Handle unavailable data.
- Apply request throttling.

**cacheManager.js**

Responsibilities:
- Store channel information.
- Store video information.
- Set expiration timestamps.
- Prevent repeated requests.

**outlierCalculator.js**

Responsibilities:
- Calculate the Outlier Score.
- Calculate secondary performance metrics.
- Validate calculation inputs.

**classification.js**

Responsibilities:
- Apply thresholds.
- Determine badge category.
- Return visual classification.

---

# 7. End-to-End Execution Workflow

This is how the product should behave from the moment a user opens YouTube.

## Step 1: Extension Initialization

User opens YouTube homepage.

The extension:
- Checks whether it is enabled.
- Detects the current page.
- Loads user settings.
- Initializes the video observer.
- Loads cached channel information.

## Step 2: Detect Video Cards

The extension scans visible YouTube video cards.

For every card:

- Find the video container.
- Extract video ID.
- Extract title.
- Extract channel ID.
- Extract view count.
- Extract publication age.
- Identify the thumbnail element.

Every video should have a unique internal identifier based on its YouTube video ID.

## Step 3: Validate Video Information

Before further processing, verify:

- Video ID is valid.
- View count is readable.
- Channel ID is available.
- The card represents an eligible video.

Exclude:
- Ads.
- Shorts in the initial MVP.
- Live streams in the initial MVP.
- Playlist-only cards.
- Cards without a valid video ID.

## Step 4: Retrieve Subscriber Information

For each channel:

Check local cache first.

If cached:
- Use cached subscriber count.
- Avoid another request until expiration.

If not cached:
- Retrieve the publicly available channel-page information through the approved extraction method.
- Parse subscriber count.
- Validate the result.
- Cache the result.

If subscriber count is hidden or unavailable:
- Do not calculate a misleading ratio.
- Show an optional `DATA UNAVAILABLE` indicator.

## Step 5: Calculate Outlier Score

Example:

```javascript
function calculateOutlierScore(views, subscribers) {
  if (!views || !subscribers || subscribers <= 0) {
    return null;
  }

  return views / subscribers;
}
```

The actual implementation should also validate numeric inputs and handle zero values.

## Step 6: Apply Classification

Example:

```javascript
function classifyOutlier(score, minViews, views) {
  if (score === null || views < minViews) {
    return "normal";
  }

  if (score >= 50) return "massive";
  if (score >= 30) return "strong";
  if (score >= 10) return "viral";
  if (score >= 5) return "potential";
  if (score >= 2) return "above-average";

  return "normal";
}
```

Thresholds must come from settings rather than being permanently hardcoded.

## Step 7: Render Badge

The badge manager receives:

- Video ID.
- Score.
- Classification.
- Relevant metrics.

It injects the appropriate badge into the thumbnail.

## Step 8: Continue Scanning

When the user scrolls:

- MutationObserver detects newly loaded cards.
- Only new video IDs are processed.
- Existing results are reused.
- New channel data is fetched only when required.

This process continues until the user leaves YouTube or disables the extension.

---

# 8. Performance and Caching Strategy

Performance is critical.

The extension must not slow down YouTube.

## Caching Rules

| Data | Suggested cache duration |
|---|---|
| Subscriber count | 24 hours |
| Video view count | 30–60 minutes |
| Video metadata | 24 hours |
| Failed retrieval | 15–30 minutes |

These are initial product defaults and should be configurable internally.

## Request Optimization

- Never fetch the same channel information multiple times simultaneously.
- Group pending requests by channel ID.
- Reuse cached results across different videos from the same channel.
- Limit concurrent requests.
- Avoid scanning the entire homepage repeatedly.
- Prioritize videos currently visible on screen.

## Loading States

Every card should support these states:

1. Not scanned.
2. Scanning.
3. Waiting for channel information.
4. Outlier detected.
5. Normal video.
6. Data unavailable.
7. Temporary extraction error.

Do not display a false outlier badge while data is loading.

---

# 9. Settings and Customization

The user should have control over the detection behavior.

Default settings:

| Setting | Default |
|---|---|
| Extension enabled | Yes |
| Minimum views | 5,000 |
| Minimum Outlier Score | 5x |
| Show normal videos | No |
| Show potential outliers | Yes |
| Show viral outliers | Yes |
| Show massive outliers | Yes |
| Scan Shorts | No |
| Scan live streams | No |
| Cache enabled | Yes |

Future settings:
- Minimum channel age.
- Minimum subscriber count.
- Maximum video age.
- Specific niche filters.
- Country and language filters.
- Views-per-day threshold.

---

# 10. Error Handling and Edge Cases

The extension must handle:

**Hidden subscriber counts**

Do not assume the subscriber count is zero. Mark the data unavailable.

**Rounded subscriber counts**

YouTube may display approximate subscriber counts. Label calculated ratios as estimates when appropriate.

**Video views unavailable**

Skip score calculation until valid data is available.

**Channel information unavailable**

Keep the video in an unscored state.

**Deleted or private videos**

Remove stale data when detected.

**YouTube DOM changes**

Use selector fallbacks and graceful failure.

**Infinite scrolling**

Process newly loaded videos without duplicating previous results.

**SPA navigation**

YouTube uses client-side navigation. Detect route changes and reinitialize scanning when appropriate.

**Duplicate videos**

Use video ID as the unique key.

**API or network failures**

Do not repeatedly retry failed requests. Apply backoff and temporary caching.

---

# 11. Privacy and Security

MVP should be privacy-first.

- No user account required.
- No collection of browsing history.
- No tracking of unrelated websites.
- No unnecessary analytics.
- No external backend required.
- Store settings and caches locally.
- Request only the Chrome permissions required for the extension's functionality.
- Do not collect personal account data.
- Do not expose YouTube session cookies or authentication tokens.
- Do not bypass YouTube's access controls.

Any future cloud synchronization or analytics must be separately disclosed and consent-based.

---

# 12. Development Roadmap

## Phase 1: Foundation

Deliverables:
- Chrome Manifest V3 setup.
- Extension installation.
- Content script injection.
- YouTube homepage detection.
- Video card extraction.

Acceptance criteria:
- Extension loads successfully.
- It detects standard homepage video cards.
- It extracts valid video IDs.
- It handles scrolling without duplicate processing.

## Phase 2: Data Extraction

Deliverables:
- View count extraction.
- Channel ID extraction.
- Subscriber information retrieval.
- Data validation.
- Cache implementation.

Acceptance criteria:
- Video data is correctly associated with its channel.
- Cached channel information is reused.
- Missing subscriber counts do not produce fake scores.
- Extraction failures are handled gracefully.

## Phase 3: Outlier Engine

Deliverables:
- Outlier calculation.
- Classification logic.
- Minimum view threshold.
- Configurable thresholds.

Acceptance criteria:
- Scores match manually calculated values.
- Invalid values are rejected.
- Thresholds work correctly.
- Normal videos are not incorrectly marked.

## Phase 4: YouTube UI Integration

Deliverables:
- Badge injection.
- Tooltip.
- Expanded information panel.
- Badge styling.
- Dynamic scrolling support.

Acceptance criteria:
- Badges appear on the correct video cards.
- No duplicate badges.
- YouTube's existing controls continue to work.
- Badges update when data becomes available.

## Phase 5: Extension Dashboard

Deliverables:
- Popup dashboard.
- Recent outliers.
- Filtering.
- Settings page.
- Enable/disable switch.

Acceptance criteria:
- Dashboard displays previously detected outliers.
- Filters work correctly.
- Settings persist after restarting Chrome.

## Phase 6: Testing and Release

Deliverables:
- Functional testing.
- Performance testing.
- Compatibility testing.
- Permission review.
- Documentation.
- Packaged extension.

Acceptance criteria:
- No major YouTube browsing interference.
- No repeated uncontrolled requests.
- No persistent console errors.
- Installation instructions are complete.
- Data extraction complies with applicable platform requirements.

---

# 13. MVP Success Metrics

We should measure product quality through:

| Metric | Initial target |
|---|---|
| Video card detection | 95%+ of eligible visible cards |
| Successful view extraction | 95%+ where visible |
| Subscriber data availability | Measure during testing |
| Duplicate badges | Zero |
| Duplicate concurrent channel fetches | Zero |
| Cache reuse | 80%+ on repeat channel lookups |
| Homepage usability | No noticeable browsing slowdown |

These are engineering targets, not guaranteed results.

---

# 14. Future Product Opportunities

Once the MVP works reliably, we can turn Outlier Finder into a more powerful YouTube research tool.

## Feature A: Channel Outlier History

Identify channels that consistently produce unusually successful videos.

## Feature B: Niche-Level Outlier Detection

Compare a video's performance with similar videos in the same niche.

For example:
- Finance.
- Technology.
- Education.
- Motivation.
- Documentary.
- Gaming.
- Business.

## Feature C: Historical Performance Comparison

Compare a video against the channel's previous 10–20 uploads.

This may be more informative than subscriber count alone.

## Feature D: Outlier Discovery Dashboard

Allow users to browse all discovered outliers, even after leaving YouTube.

## Feature E: Video Research Export

Export discovered videos to CSV with:
- Title.
- Channel.
- URL.
- Subscribers.
- Views.
- Outlier Score.
- Publication date.

## Feature F: AI Content Intelligence

Eventually, use AI to analyze:
- Why a video might have performed well.
- Its title structure.
- Topic selection.
- Thumbnail strategy.
- Content format.
- Potential content opportunities.

---

# 15. Final MVP Definition

The first release should be intentionally simple.

When someone opens YouTube:

1. Outlier Finder automatically starts.
2. It scans visible videos.
3. It extracts available video and channel data.
4. It retrieves missing subscriber information when possible.
5. It calculates the Outlier Score.
6. It displays badges on qualifying thumbnails.
7. It continues working while the user scrolls.
8. The extension popup shows discovered outliers.

**The MVP is successful when users can browse YouTube normally and immediately recognize videos that are outperforming their creators' subscriber base.**

The priority is reliable detection, not a large number of features.

---

# 16. Recommended Build Order

Build in this exact order:

1. Create the Chrome extension skeleton.
2. Make it detect YouTube video cards.
3. Extract video views, IDs and channel IDs.
4. Implement channel subscriber retrieval and caching.
5. Build the Outlier Score calculator.
6. Display badges on thumbnails.
7. Support infinite scrolling and SPA navigation.
8. Create the extension popup.
9. Add settings and filters.
10. Test on different YouTube homepage layouts.

**Important architectural decision:** Keep the extraction layer separate from the scoring engine. If YouTube changes its page structure, we should be able to update the scraper without rewriting the outlier detection system.

**Product philosophy:** Outlier Finder should be fast, lightweight, automatic, accurate about missing data, and invisible until it finds something interesting.

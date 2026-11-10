# Chrome Web Store submission

Publisher: hiabhee  
Support: jamdadeabhishek039@gmail.com

## Listing

Name: Outlier Finder

Summary: Compare public post views and likes with creator audience size on YouTube, X and Instagram.

Description: Outlier Finder adds public performance ratios to supported post cards. View-based scores compare views with subscribers or followers. Posts without public views can show a separately labelled likes/followers engagement percentage. Customize thresholds, inspect the calculation and save posts locally. Public metrics can be hidden or unavailable. X follower counts are read from matching public timeline response data where available, learned from displayed profiles, or entered explicitly as estimates. Ratios are heuristic research aids, not predictions.

Single purpose: calculate and display public post performance ratios relative to creator audience size.

## Permission and privacy explanations

- storage: preferences, cached public metadata, saved posts, recent detections and diagnostic counts stored locally.
- YouTube, X/Twitter and Instagram host access: read public post cards and retrieve corresponding public creator/post metadata. No other hosts are requested. On X, bundled MAIN-world code observes selected same-origin public timeline responses, extracts only post identifiers and author follower counts, and passes validated values to the isolated content script. It does not inspect credentials, messaging responses or send additional API requests.
- Remote executable code: none. All executable code is bundled.
- Data processed includes website content, public creator identifiers and public post/profile URLs. Complete dashboard disclosures consistently with the actual implementation and privacy policy; local processing does not remove the need to disclose it.

## Build and publication

Run `npm test` and `npm run package`. Upload `dist/outlier-finder-1.3.0.zip`; development files are excluded. The existing `outlier-finder/` directory is retained because Chrome currently loads it. It is generated and ignored by version control.

Host the contents of `dist/site/` on a public HTTPS static host. Use its real `/privacy.html` address as the store privacy URL and `/support.html` as the support URL. No public hosting or store submission has been performed by this build.

Before submitting:

- Confirm scores on live YouTube cards, X timeline/detail pages, Instagram feed/grid and scrolling Reels. Fixture tests do not establish live compatibility.
- Reload the extension and refresh existing platform tabs after updating.
- Capture actual product screenshots (1280×800 or 640×400), including unavailable-data handling. Do not invent screenshots or claim universal coverage.
- Review publisher identity, contact details, policy text and dashboard disclosures.
- Supply the published privacy URL and store screenshots; complete account registration, distribution and review submission in the publisher dashboard.

## Reviewer instructions

No extension account, payment or API key is required. Browse supported public posts in a normal platform session. Open a badge for its formula and source metrics. Refresh the X tab after installation to capture public timeline data automatically. If X omits a count and blocks signed-out profile requests: open the author profile/hovercard, then return to the post, or enter the follower count from that profile in the unavailable-score panel. This manual count is approximate and stored locally. Private/hidden metrics remain unavailable. Settings can pause all detection or individual platforms. Saved posts are local. Clear cache removes transient metadata; uninstall removes extension storage.

Official references: https://developer.chrome.com/docs/webstore/publish and https://developer.chrome.com/docs/webstore/cws-dashboard-privacy

## Observed X growth

Growth uses fresh view-count observations at least one minute apart, within a rolling one-hour window. Badges show views/min and details show the observed increase and interval. Initial observations show Collecting data. This is observed growth, not a prediction or continuous monitoring service. Refresh or revisit posts for fresh readings. Growth needs no follower denominator and can be available while the outlier ratio is N/A. Up to 500 local post histories are kept and Clear cache removes them.

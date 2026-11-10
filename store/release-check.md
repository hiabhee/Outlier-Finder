# Release check: 1.3.0

Local verification performed November 10, 2026. Re-run `npm run release` after any runtime changes; these results apply to the package identified below.

## Verified locally

- All 106 automated tests passed, including extraction, async updates, badge recovery, platform isolation, privacy boundaries and X badge placement regressions.
- Manifest V3, version consistency, bundled resource references, icon dimensions, JavaScript syntax and permission boundaries passed validation.
- The ZIP passed an independent archive integrity check. All 37 entries match the source files, generated unpacked build and legacy Chrome installation copy byte for byte.
- The archive has `manifest.json` at its root. Development dependencies, tests, scripts, store documents and Git files are excluded.
- Requested extension permission: `storage`. Host access is limited to the supported YouTube, X/Twitter and Instagram domains. No remote executable code is bundled or fetched.

Upload artifact: `dist/outlier-finder-1.3.0.zip`.

SHA-256: `47c9deadcef7897cd7814cd91d958daba5f9adbd9161ced0b4c80e637d95b738`.

## Remaining before store submission

- [ ] Reload the generated release in Chrome and perform a live check on YouTube cards, X timeline/detail pages, Instagram feed/profile grid and scrolling Reels. Include narrow windows, missing metrics and the latest X tag placement. Automated DOM fixtures do not verify browser rendering.
- [ ] Capture at least one actual product screenshot at 1280×800 or 640×400 for the listing. The existing 128×128 PNG icon is included in the ZIP.
- [ ] Host `dist/site/` publicly over HTTPS and verify the privacy and support URLs. No hosting URL has been configured or deployed by this release.
- [ ] Confirm the publisher identity and support address in `store/submission.md`, and complete the dashboard's privacy disclosures, distribution settings and reviewer instructions.
- [ ] If updating an already published item, confirm 1.3.0 exceeds the currently published version before uploading. The store's current version has not been checked.
- [ ] Upload the ZIP and submit through the publisher dashboard. No store upload or publication has been performed.

Official requirements: [publishing](https://developer.chrome.com/docs/webstore/publish), [listing images](https://developer.chrome.com/docs/webstore/images), and [local data handling disclosures](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).

# Outlier Finder

Outlier Finder is a Manifest V3 Chrome extension that compares public video and post counts with the creator's subscriber or follower count on YouTube, X and Instagram. View ratios are views divided by audience size. When a platform does not expose views, the extension can display likes divided by followers as a separately labelled engagement percentage.

X timeline data can provide audience counts without visiting each creator profile. X view growth appears after two observations at least one minute apart, within a rolling one-hour window. The extension does not poll X continuously. Scores and growth rates are heuristics, not predictions. Hidden, missing or private metrics remain unavailable.

## Development

Requirements: Node.js 22 or later and npm.

```sh
npm ci
npm test
npm run validate
npm run package
```

`npm run release` runs all tests, validates the extension package and builds the release. The build writes the Chrome upload ZIP and SHA-256 checksum to `dist/`, creates a local unpacked copy in `dist/unpacked/`, and copies the policy/support pages to `dist/site/`. The ignored `outlier-finder/` directory is kept current for the existing local Chrome installation.

Run `npm run release` before uploading. The Web Store submission checklist, proposed listing text and reviewer instructions are in [store/submission.md](store/submission.md). Host `dist/site/` on a public HTTPS website and enter its privacy URL in the Web Store dashboard. Live compatibility and real product screenshots must be checked before submission.

Publisher: hiabhee · Support: jamdadeabhishek039@gmail.com

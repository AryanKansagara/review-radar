# Review Radar

App Store review intelligence for indie iOS developers. Paste any App Store link and see the rating for every version, what changed after each release, and what people are complaining about.

**Live:** https://review-radar-xi.vercel.app

## The pain

Your rating drops after an update and App Store Connect shows a single number. Which release did it? Is the dip real or noise? What are people actually saying, in which country, and what should you fix first? Indie developers end up reading reviews one by one, every morning, in every storefront.

## Features

- **Live data, no key:** app search and lookup via the iTunes Search API. The latest reviews (up to 500 per country) come from Apple's public customer-reviews feed. You choose the countries; reviews are deduped by id across fetches. The fetcher follows the page count the feed reports, retries pages the feed drops, and tells an empty-feed outage apart from an app with no reviews.
- **Release impact:** mean rating and one-star share before and after every version. Intervals are bootstrap (means) and Wilson (shares). Small weekly builds are pooled into a baseline, and too-small samples say so.
- **Themes:** an editable taxonomy (crash, login, subscription/paywall, ads, sync, battery, UI change, missing feature, performance, bug after update), plus TF-IDF term clusters for what the rules miss. Built-in themes also match German, French, Spanish, Portuguese, Italian and Japanese phrases.
- **Signals:** emerging themes in the latest version, feature requests grouped by topic, a lexicon sentiment score that flags reviews whose text disagrees with their stars, and version × country heatmaps.
- **Actions:**
  - A what-to-fix-next ranking (mentions × stars lost).
  - Release-note drafts ("Fixed: …").
  - Reply drafts per review, checked against the 5,970 character limit and Apple's guidance.
  - A printable release health report.
  - CSV exports.
- **Competitors:** add rival apps to a project and compare themes side by side.
- **History:** every fetch or import is a snapshot. Compare any two and see new themes.
- **Import:** CSV/TSV, App Store Connect API JSON, saved feed pages, or scraper output (`app-store-scraper` CSV and JSON, Appfigures-style headers), with column mapping and a line-numbered validation report. Optional version history lists.
- **Local first:** projects live in IndexedDB. An optional account (email and password) syncs them across devices. Export or delete everything from the account menu.
- Two synthetic sample apps, clearly labelled.

## Run locally

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # engine tests (node --test)
npm run build
```

Cloud sync needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env`. Without them, everything else works locally.

## Tested against real data

- Live review feeds for five apps across US, GB, DE, FR and JP (4,520 reviews, 15 Nov 2026) and archived feed pages from 2024 to 2026 (Internet Archive).
- Public `app-store-scraper` CSV exports found on GitHub (five files, 241 reviews).
- Test fixtures copy those layouts; the review text in them is written for the tests.

## Known gaps

- The public feed only holds the 500 most recent written reviews per country and has occasional outages; older history needs an import.
- The feed has no release dates. Dates of past versions are inferred from the first review unless you paste a version list.
- Sentiment is English only. Themes cover seven languages; Korean, Dutch, Swedish and others need your own keywords.
- Reply drafts are copied by hand into App Store Connect; nothing is posted for you.

Built by Aryan Kansagara. Independent project, not affiliated with Apple Inc.

import { useEffect } from 'react'
import { RESPONSE_LIMIT, RESPONSE_RULES_DATE } from './engine/replies.ts'
import { Code, Link } from './ui.tsx'

const CSV = `date,rating,title,review,version,territory,nickname,id
2026-09-30,1,Crashes on launch,"Since the update it crashes immediately.",5.4,DEU,anna_k,14766651509
2026-10-02,5,Love it,"Best editor on iPhone.",5.4,USA,mkr,14766651510`

const VERSIONS = `version,date,notes
5.3,2026-08-12,Film presets
5.4,2026-09-30,Healing brush
5.4.1,2026-10-28,Fixes a crash on launch`

const API = `# App Store Connect API (needs your own API key; Review Radar never sees it)
curl -H "Authorization: Bearer $JWT" \\
  "https://api.appstoreconnect.apple.com/v1/apps/<APP_ID>/customerReviews?limit=200&sort=-createdDate" \\
  > reviews-page-1.json
# Follow links.next for more pages, then import the JSON files here.`

export default function Docs() {
  useEffect(() => { document.title = 'Docs · Review Radar' }, [])
  return (
    <section className="page narrow docs">
      <p className="eyebrow">Docs</p>
      <h1>How Review Radar works</h1>
      <p className="lede">Everything runs in your browser. Live data comes from two free, public Apple endpoints. Imports never leave the device unless you sign in to sync.</p>

      <nav className="toc card pad" aria-label="On this page">
        <a href="#live">Live data</a><a href="#import">Importing history</a><a href="#versions">Version lists</a><a href="#methods">Methods</a><a href="#replies">Replies</a><a href="#privacy">Storage and sync</a>
      </nav>

      <h2 id="live">Live data</h2>
      <ul>
        <li><b>App lookup and search:</b> <code>itunes.apple.com/lookup?id=…</code> and <code>/search?term=…&amp;entity=software</code>. They give the name, developer, current version, its release date and notes, and the all-time and current-version rating.</li>
        <li><b>Reviews:</b> the public customer reviews RSS feed in JSON, <code>itunes.apple.com/{'{country}'}/rss/customerreviews/page=1…10/id={'{id}'}/sortby=mostrecent/json</code>. Each page has up to 50 reviews, so 500 per country, newest first. Each review includes its id, rating, title, text, nickname, date and the app version it was written on.</li>
        <li>Both endpoints allow cross-origin requests, so no server or key is involved. Only written reviews appear in the feed; star-only ratings do not, which is why the App Store’s overall rating can differ from the average here.</li>
        <li><b>Paging:</b> page 1 of the feed states how many pages exist (its <code>rel="last"</code> link). Review Radar reads exactly that many. The feed sometimes drops a page and answers with fewer than 50 reviews in the middle of the list; such a page is requested once more under the feed’s second address (<code>…/id={'{id}'}/sortBy=mostRecent/page=N/json</code>) and never cuts the fetch short. A page that fails on both addresses ends that country, and the result says where it stopped.</li>
        <li><b>Feed outages:</b> now and then the feed answers every request with an empty list for some hours, for every app (seen on 13 November 2026; back to normal the next day). When all your countries come back empty for an app that has ratings, Review Radar says so, keeps your stored reviews and history as they are, and saves nothing. Try again later or import a file.</li>
        <li><b>Checked against real feeds:</b> the reader was run on live feeds for Duolingo, Strava, Notion, Finch and Medito (US, GB, DE, FR, JP; 4,520 reviews, 15 November 2026) and on archived feed pages from 2024 to 2026 in the Internet Archive. Version labels are normalised (<code>v3.73.55</code> is <code>3.73.55</code>), and podcast feeds, which carry no version, import as “unknown”.</li>
        <li>Fetch regularly (weekly is plenty for most indie apps). Every fetch merges by review id and saves a snapshot, so your history grows past the 500-review window.</li>
      </ul>

      <h2 id="import">Importing history</h2>
      <p>For reviews older than the feed keeps, import a file on a project’s <b>Data</b> tab. Accepted:</p>
      <ol>
        <li><b>CSV or TSV</b> with a header row. Columns are matched by name and you can remap them: <code>date</code> and <code>rating</code> and <code>review</code> are required; <code>title</code>, <code>version</code>, <code>territory</code>/<code>country</code>, <code>nickname</code> and <code>id</code> are optional. Territories can be two-letter storefront codes (<code>de</code>), three-letter codes (<code>DEU</code>) or locales (<code>de-DE</code>).</li>
        <li><b>App Store Connect API JSON:</b> responses from <code>GET /v1/apps/{'{id}'}/customerReviews</code>, one page or an array of pages. The API does not return the app version, so add a version list (below) to assign reviews to releases by date.</li>
        <li><b>Saved feed pages:</b> the JSON of the public reviews feed itself, one page or an array of pages, for example saved with <code>curl</code> or from a web archive. The storefront is read from the feed’s own address.</li>
        <li><b>Scraper and tool exports:</b> a JSON array of review objects, or CSV, as written by the <code>app-store-scraper</code> libraries (Python: <code>date, review, rating, isEdited, userName, title, developerResponse</code>; Node: <code>id, userName, version, score, title, text, updated</code>) and by review tools such as Appfigures (<code>stars</code>, <code>iso</code>). Headers in <code>snake_case</code>, <code>camelCase</code> or with spaces are matched the same way.</li>
        <li><b>Copying from App Store Connect:</b> App Store Connect → Apps → your app → Ratings and Reviews has no CSV export as of {RESPONSE_RULES_DATE}. Use the API, or a spreadsheet you already keep, saved as CSV.</li>
      </ol>
      <Code label="CSV" code={CSV} />
      <Code label="Shell" code={API} />
      <p>The validation report lists every problem with its line number. Timestamps without a time zone are read as UTC. Dates such as <code>10/03/2026</code> (or with dots or dashes) are month first, unless some row in the column has a day above 12, in which case the whole column is read day first and the report says so; version lists follow the same rule. Days that do not exist, unreadable dates and ratings that are not a whole number from 1 to 5 skip the row; unknown countries and empty text are warnings. Duplicate ids are skipped, and re-importing the same file adds nothing. Importing again with a corrected mapping updates the stored reviews; a column the new file lacks keeps its stored values. Rows without an id, or with one a spreadsheet rounded (<code>1.47667E+10</code>), are duplicates only when date, rating, title, text, nickname, country and version are all the same.</p>

      <h2 id="versions">Version lists</h2>
      <p>Optional but useful: one line per release, <code>version,date[,notes]</code>. App Store Connect → your app → App Store → version history has the dates. Listed dates replace dates inferred from the first review on that version. Reviews without a version of their own get the listed version that was out on their date, again each time the list changes.</p>
      <Code label="CSV" code={VERSIONS} />

      <h2 id="methods">Methods</h2>
      <ul>
        <li><b>Release impact:</b> each version is compared with the previous version that has reviews. The change in mean rating gets a 95% percentile bootstrap interval (800 resamples, fixed seed). The verdict is “worse” or “better” only when the interval excludes zero and both sides have at least 8 reviews. One-star shares use the Wilson score interval.</li>
        <li><b>Themes:</b> ten built-in themes (crash, login, subscription and paywall, ads, sync and data loss, battery, UI change, missing feature, performance, bug after update), each a list of phrases matched as whole words. Edit, disable or add rules per project. While a built-in theme is enabled it also matches a fixed list of German, French, Spanish, Portuguese, Italian and Japanese phrases (“stürzt ab”, “trop cher”, “anuncios”, “広告”), because storefront feeds are in the local language. Other languages need your own keywords. “Stars lost” is the average rating of reviews without the theme minus the average with it.</li>
        <li><b>Emerging themes:</b> share in the latest version against all earlier versions. Flagged with at least 3 mentions, at least 5 points of growth, and 1.5× the earlier share (or new), once the earlier versions hold at least 8 reviews.</li>
        <li><b>Term clusters:</b> unigrams and bigrams from 1 to 3 star reviews, scored by summed TF-IDF, grouped greedily so each review lands in one cluster. Common function words in English, German, French, Spanish, Portuguese and Italian and the app’s own name are left out. Catches complaints the rules miss.</li>
        <li><b>Feature requests:</b> sentences matching “please add”, “I wish”, “would be great if”, “bring back” and similar, grouped by their most shared term.</li>
        <li><b>What to fix next:</b> mentions × stars lost × (1 + 4 × growth in the latest version). Feature requests are listed separately.</li>
        <li><b>Sentiment:</b> a small lexicon in the AFINN style (integer word scores from −5 to +5, negation within two words of the same clause, normalised by √length). The word list was written for this project and is MIT licensed with the code; it is English only and scores other languages as neutral. It is a secondary signal used to spot reviews whose text disagrees with their stars.</li>
      </ul>

      <h2 id="replies">Replies</h2>
      <ul>
        <li>Drafts come from a template per theme, using the support email, signature and “fixed in” version from the Actions tab. Edit before posting.</li>
        <li>Post replies in App Store Connect → Ratings and Reviews, or with the API’s <code>customerReviewResponses</code>. Responses can be up to {RESPONSE_LIMIT.toLocaleString()} characters. Each review takes one response, which you can edit. Responses are public, and the reviewer is notified and can update their review.</li>
        <li>Drafts are checked for length, leftover placeholders, phone numbers, and wording that asks for a better rating, which Apple discourages.</li>
        <li className="muted">Limits and guidance as of {RESPONSE_RULES_DATE}; Apple can change them.</li>
      </ul>

      <h2 id="privacy">Storage and sync</h2>
      <ul>
        <li>Projects and reviews are stored in this browser (IndexedDB). Clearing site data removes them; export from the account menu first.</li>
        <li>An account is optional. When signed in, projects merge across devices by id, and the most recent edit wins. Rules, version lists, reply settings, replied marks and snapshots always sync. A review set over 1.5 MB stays on the device it was fetched on.</li>
        <li>The samples (Streakly and Lumen Darkroom) are synthetic. They are generated from a fixed seed, and the names are fictional.</li>
      </ul>
      <p><Link href="/app" className="btn primary">Open Review Radar</Link></p>
    </section>
  )
}

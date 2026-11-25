// Live App Store data. Both endpoints send Access-Control-Allow-Origin: *, so the browser calls them directly.
import { feedLastPage, normalizeLookup, normalizeRss } from './engine/reviews.ts'
import type { AppInfo, Review } from './engine/types.ts'

const BASE = 'https://itunes.apple.com'

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`App Store returned ${res.status}`)
  return res.json()
}

export async function lookupApp(id: string, country = 'us', signal?: AbortSignal): Promise<AppInfo | null> {
  return normalizeLookup(await getJson(`${BASE}/lookup?id=${encodeURIComponent(id)}&country=${country}&entity=software`, signal))
}

export async function searchApps(term: string, country = 'us', signal?: AbortSignal): Promise<AppInfo[]> {
  const j = await getJson(`${BASE}/search?term=${encodeURIComponent(term)}&entity=software&country=${country}&limit=8`, signal) as { results?: unknown[] }
  return (j.results ?? []).map(r => normalizeLookup({ results: [r] })).filter((a): a is AppInfo => !!a)
}

export interface FetchProgress { done: number; total: number; country: string; reviews: number; failed: string[] }

// Two spellings of the same feed. They are cached separately on Apple's CDN, so when one answers
// with an empty list during a feed outage the other sometimes still has the reviews.
const feedUrls = (c: string, appId: string, p: number) => [
  `${BASE}/${c}/rss/customerreviews/page=${p}/id=${appId}/sortby=mostrecent/json`,
  `${BASE}/${c}/rss/customerreviews/id=${appId}/sortBy=mostRecent/page=${p}/json`,
]

export interface FetchResult {
  reviews: Review[]
  /** Countries whose first page could not be loaded at all. */
  failed: string[]
  /** Countries where the feed answered but listed no reviews: either nobody has written one there, or the feed is having an outage. */
  empty: string[]
}

/**
 * Most recent reviews: up to `pages` x 50 per country (the feed stops at 10 pages, 500 reviews).
 * Countries run two at a time; within a country pages are sequential and follow the page count the feed reports.
 */
export async function fetchReviews(appId: string, countries: string[], pages: number, onProgress?: (p: FetchProgress) => void, signal?: AbortSignal, get: (url: string, signal?: AbortSignal) => Promise<unknown> = getJson): Promise<FetchResult> {
  const out: Review[] = []
  const failed: string[] = []
  const empty: string[] = []
  const total = countries.length * pages
  let done = 0
  const queue = [...countries]
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      // Page 1 says how many pages exist. A short or empty page before that is the feed dropping
      // a response, not the end of the reviews, so it is retried once and never ends the country.
      let last = pages, counted = 0, known = false
      for (let p = 1; p <= Math.min(pages, last); p++) {
        try {
          const [url, alt] = feedUrls(c, appId, p)
          let feed = await get(url, signal)
          let rs = normalizeRss(feed, appId, c)
          const setLast = (f: unknown, n: number) => { const l = feedLastPage(f); known = l !== null; last = l ?? (n < 50 ? 1 : pages) }
          if (p === 1) setLast(feed, rs.length)
          if (rs.length < 50 && (p === 1 || (known && p < last))) {
            const again = await get(alt, signal).catch(() => null)
            const rs2 = normalizeRss(again, appId, c)
            if (rs2.length > rs.length) { rs = rs2; feed = again; if (p === 1) setLast(feed, rs.length) }
          }
          if (p === 1 && !rs.length) empty.push(c)
          out.push(...rs)
          done++; counted++
          onProgress?.({ done, total, country: c, reviews: out.length, failed })
          // Without a page count from the feed, a short page is the only sign of the end.
          if ((!rs.length && p === 1) || (!known && rs.length < 50)) break
        } catch (e) {
          if (signal?.aborted) throw e
          // Page 1 failing means the country failed; later pages failing just ends that country.
          if (p === 1) failed.push(c)
          break
        }
      }
      // Pages that turned out not to exist still count towards the progress bar.
      done += pages - counted
      onProgress?.({ done, total, country: c, reviews: out.length, failed })
    }
  }
  await Promise.all([worker(), worker()])
  return { reviews: out, failed, empty }
}

/**
 * True when an empty answer is almost certainly the feed misbehaving rather than an app nobody reviews:
 * every country came back empty although the store reports ratings for the app.
 */
export const looksLikeOutage = (r: Pick<FetchResult, 'reviews' | 'empty'>, countries: string[], ratingCount: number | null) =>
  !r.reviews.length && r.empty.length === countries.length && countries.length > 0 && (ratingCount ?? 0) >= 50

export const OUTAGE_NOTE = 'Apple’s public review feed is answering with an empty list right now. It does this from time to time and usually recovers within hours.'

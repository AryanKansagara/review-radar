// Live App Store data. Both endpoints send Access-Control-Allow-Origin: *, so the browser calls them directly.
import { normalizeLookup, normalizeRss } from './engine/reviews.ts'
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

/**
 * Most recent reviews: up to `pages` x 50 per country (the feed stops at 10 pages, 500 reviews).
 * Countries run two at a time; within a country pages are sequential and stop at the first empty page.
 */
export async function fetchReviews(appId: string, countries: string[], pages: number, onProgress?: (p: FetchProgress) => void, signal?: AbortSignal): Promise<{ reviews: Review[]; failed: string[] }> {
  const out: Review[] = []
  const failed: string[] = []
  const total = countries.length * pages
  let done = 0
  const queue = [...countries]
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      for (let p = 1; p <= pages; p++) {
        try {
          const rs = normalizeRss(await getJson(`${BASE}/${c}/rss/customerreviews/page=${p}/id=${appId}/sortby=mostrecent/json`, signal), appId, c)
          out.push(...rs)
          done++
          onProgress?.({ done, total, country: c, reviews: out.length, failed })
          if (rs.length < 50) { done += pages - p; break }
        } catch (e) {
          if (signal?.aborted) throw e
          // Page 1 failing means the country failed; later pages failing just ends that country.
          if (p === 1) failed.push(c)
          done += pages - p + 1
          break
        }
      }
      onProgress?.({ done, total, country: c, reviews: out.length, failed })
    }
  }
  await Promise.all([worker(), worker()])
  return { reviews: out, failed }
}

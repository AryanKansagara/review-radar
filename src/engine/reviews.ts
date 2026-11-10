// Review normalisation: App Store links, RSS feed entries, dedupe, version ordering.
import type { AppInfo, Review, VersionInfo } from './types.ts'

/** Accepts an App Store URL, "id123", or a bare numeric id. Country defaults to us. */
export function parseAppRef(input: string): { id: string; country: string } | null {
  const t = input.trim()
  const m = t.match(/apps\.apple\.com\/([a-z]{2})\/app\/(?:[^/]+\/)?id(\d{5,})/i)
  if (m) return { id: m[2], country: m[1].toLowerCase() }
  const m2 = t.match(/(?:^|[/=])id(\d{5,})\b/i) ?? t.match(/^(\d{5,})$/)
  if (m2) return { id: m2[1], country: 'us' }
  return null
}

/** Numeric-aware version compare: 3.10 > 3.9, 3.2.1 > 3.2. */
export function cmpVersion(a: string, b: string): number {
  const pa = a.split(/[.\-\s]/), pb = b.split(/[.\-\s]/)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0', y = pb[i] ?? '0'
    const nx = Number(x), ny = Number(y)
    const d = Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x.localeCompare(y)
    if (d) return d
  }
  return 0
}

const lab = (o: unknown): string => (o && typeof o === 'object' && 'label' in o ? String((o as { label: unknown }).label ?? '') : '')

/** Converts one page of the public customer-reviews RSS JSON into reviews. Skips the app header entry older feeds include. */
export function normalizeRss(feed: unknown, appId: string, country: string): Review[] {
  const f = (feed as { feed?: { entry?: unknown } })?.feed
  if (!f) return []
  const entries = Array.isArray(f.entry) ? f.entry : f.entry ? [f.entry] : []
  const out: Review[] = []
  for (const e of entries as Record<string, unknown>[]) {
    const rating = Number(lab(e['im:rating']))
    if (!rating) continue
    const id = lab(e.id)
    out.push({
      id: id || hashId(`${lab(e.updated)}|${lab(e.title)}|${lab(e.content)}`),
      appId, country: country.toLowerCase(),
      rating: Math.min(5, Math.max(1, Math.round(rating))),
      version: lab(e['im:version']) || 'unknown',
      title: lab(e.title),
      body: lab(e.content),
      author: lab((e.author as Record<string, unknown> | undefined)?.name),
      date: new Date(lab(e.updated)).toISOString(),
      source: 'rss',
    })
  }
  return out
}

export function normalizeLookup(json: unknown): AppInfo | null {
  const r = (json as { results?: Record<string, unknown>[] })?.results?.[0]
  if (!r || !r.trackId) return null
  const n = (k: string) => (typeof r[k] === 'number' ? (r[k] as number) : null)
  return {
    id: String(r.trackId),
    name: String(r.trackName ?? ''),
    developer: String(r.artistName ?? r.sellerName ?? ''),
    icon: String(r.artworkUrl100 ?? r.artworkUrl60 ?? ''),
    genre: String(r.primaryGenreName ?? ''),
    version: String(r.version ?? ''),
    releaseNotes: String(r.releaseNotes ?? ''),
    currentVersionReleaseDate: String(r.currentVersionReleaseDate ?? ''),
    rating: n('averageUserRating'),
    ratingCount: n('userRatingCount'),
    currentVersionRating: n('averageUserRatingForCurrentVersion'),
    currentVersionRatingCount: n('userRatingCountForCurrentVersion'),
    url: String(r.trackViewUrl ?? ''),
  }
}

/** FNV-1a, enough to give imported reviews without ids a stable key. */
export function hashId(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return 'h' + (h >>> 0).toString(36)
}

/** Merges fetched reviews into the stored set. Same id: the newer edit wins (reviewers can update a review). */
export function mergeReviews(existing: Review[], incoming: Review[]): { reviews: Review[]; added: number; updated: number } {
  const map = new Map(existing.map(r => [key(r), r]))
  let added = 0, updated = 0
  for (const r of incoming) {
    const k = key(r)
    const old = map.get(k)
    if (!old) { map.set(k, r); added++ }
    else if (r.date > old.date || (r.date === old.date && (r.body !== old.body || r.rating !== old.rating))) { map.set(k, r); updated++ }
  }
  const reviews = [...map.values()].sort((a, b) => b.date.localeCompare(a.date))
  return { reviews, added, updated }
}
const key = (r: Review) => `${r.appId}|${r.id}`

/**
 * Version timeline: listed versions keep their dates; every other version seen in reviews gets
 * the date of its first review. Sorted by version number.
 */
export function buildVersions(reviews: Review[], listed: VersionInfo[] = []): VersionInfo[] {
  const map = new Map(listed.map(v => [v.version, v]))
  for (const r of reviews) {
    if (r.version === 'unknown') continue
    const d = r.date.slice(0, 10)
    const v = map.get(r.version)
    if (!v) map.set(r.version, { version: r.version, date: d, origin: 'inferred' })
    else if (v.origin === 'inferred' && d < v.date) v.date = d
  }
  return [...map.values()].sort((a, b) => cmpVersion(a.version, b.version))
}

export const COUNTRIES: [string, string][] = [
  ['us', 'United States'], ['gb', 'United Kingdom'], ['ca', 'Canada'], ['au', 'Australia'], ['in', 'India'],
  ['de', 'Germany'], ['fr', 'France'], ['es', 'Spain'], ['it', 'Italy'], ['nl', 'Netherlands'],
  ['br', 'Brazil'], ['mx', 'Mexico'], ['jp', 'Japan'], ['kr', 'South Korea'], ['se', 'Sweden'], ['ie', 'Ireland'], ['nz', 'New Zealand'], ['sg', 'Singapore'],
]
export const countryName = (c: string) => COUNTRIES.find(x => x[0] === c)?.[1] ?? c.toUpperCase()

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
  const pa = cleanVersion(a).split(/[.\-\s]/), pb = cleanVersion(b).split(/[.\-\s]/)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0', y = pb[i] ?? '0'
    const nx = Number(x), ny = Number(y)
    const d = Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x.localeCompare(y)
    if (d) return d
  }
  return 0
}

/** "v3.73.55" and " 3.73.55 " are the same release as "3.73.55"; the feed carries all three spellings. */
export const cleanVersion = (v: string) => v.trim().replace(/^v(?=\d)/i, '')

const lab = (o: unknown): string => (o && typeof o === 'object' && 'label' in o ? String((o as { label: unknown }).label ?? '') : '')

/** 1 to 5 from "5", "5.0", "5 stars" or "5★". Signs, fractions and anything else are not a rating: null. */
export const readRating = (v: unknown): number | null => {
  const m = (typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '').match(/^([1-5])(?:[.,]0+)?(?:\s*(?:stars?|[★⭐*]\uFE0F?))?$/i)
  return m ? +m[1] : null
}

/** Converts one page of the public customer-reviews RSS JSON into reviews. Skips the app header entry older feeds include. */
export function normalizeRss(feed: unknown, appId: string, country: string): Review[] {
  const f = (feed as { feed?: { entry?: unknown } })?.feed
  if (!f) return []
  const entries = Array.isArray(f.entry) ? f.entry : f.entry ? [f.entry] : []
  const out: Review[] = []
  for (const e of entries as (Record<string, unknown> | null)[]) {
    if (!e) continue
    const rating = readRating(lab(e['im:rating']))
    if (!rating) continue
    const id = lab(e.id)
    const date = new Date(lab(e.updated))
    if (isNaN(+date)) continue
    out.push({
      id: id || hashId(`${lab(e.updated)}|${lab(e.title)}|${lab(e.content)}`),
      appId, country: country.toLowerCase(),
      rating,
      version: cleanVersion(lab(e['im:version'])) || 'unknown',
      title: lab(e.title),
      body: lab(e.content),
      author: lab((e.author as Record<string, unknown> | undefined)?.name),
      date: date.toISOString(),
      source: 'rss',
    })
  }
  return out
}

/** How many pages the feed says exist (its rel="last" link), or null when the feed does not say. */
export function feedLastPage(feed: unknown): number | null {
  const links = (feed as { feed?: { link?: unknown } })?.feed?.link
  for (const l of Array.isArray(links) ? links : []) {
    const at = (l as { attributes?: { rel?: string; href?: string } })?.attributes
    const m = at?.rel === 'last' ? at.href?.match(/page=(\d+)/) : null
    if (m) return +m[1]
  }
  return null
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

/** Id for an imported row without one, from everything that tells two reviews apart. */
export const contentId = (s: string) => [s, '~' + s].map(x => 'h' + hashId(x).slice(1).padStart(7, '0')).join('')
const isContentId = (id: string) => /^h[0-9a-z]{7}h[0-9a-z]{7}$/.test(id)
/** A long id a spreadsheet has rounded, such as 1.47667E+10: many reviews can share it. */
export const isRoundedId = (id: string) => /^[+-]?\d+(?:[.,]\d+)?e[+-]\d+$/i.test(id)
/** Stored under an id that does not come from the store. Earlier versions hashed fewer fields and kept rounded ids. */
const isOwnId = (id: string) => isContentId(id) || isRoundedId(id) || /^h[0-9a-z]{1,7}$/.test(id)

const country = (r: Review) => r.countryAssumed ? '' : r.country
const version = (r: Review) => r.version === 'unknown' || r.versionInferred ? '' : r.version
const same = (a: string, b: string) => a === b
const fits = (a: string, b: string) => !a || !b || a === b
const agree = (a: Review, b: Review, eq: (x: string, y: string) => boolean) => eq(a.author, b.author) && eq(country(a), country(b)) && eq(version(a), version(b))

/**
 * Stored reviews that rows without an id stand for. Such rows match on what they say: same date, rating, title and text, and an author,
 * country and version that do not contradict. Each stored review is matched once, so two people who wrote the same words stay two.
 */
function matchByContent(stored: Map<string, Review>, incoming: Review[]): Map<Review, string> {
  const out = new Map<Review, string>()
  const rows = incoming.filter(r => isContentId(r.id) && !stored.has(key(r)))
  if (!rows.length) return out
  const taken = new Set(incoming.map(key))
  const content = (r: Review) => JSON.stringify([r.appId, r.date, r.rating, r.title, r.body])
  const by = new Map<string, Review[]>()
  for (const [k, r] of stored) if (isOwnId(r.id) && !taken.has(k)) by.set(content(r), [...(by.get(content(r)) ?? []), r])
  for (const eq of [same, fits]) for (const r of rows) {
    if (out.has(r)) continue
    const old = by.get(content(r))?.find(o => !taken.has(key(o)) && agree(o, r, eq))
    if (old) { taken.add(key(old)); out.set(r, key(old)) }
  }
  return out
}

/**
 * A stored review and another reading of it. A newer edit, or a file with the same date (a corrected mapping), replaces it;
 * an older one only fills what is not known. What the new reading does not say never erases what is stored.
 */
function combine(old: Review, r: Review): Review {
  const next = r.date >= old.date ? { ...r, id: old.id } : { ...old }
  const [first, second] = r.date >= old.date ? [r, old] : [old, r]
  next.title = first.title || second.title
  next.body = first.body || second.body
  next.author = first.author || second.author
  const from = version(first) ? first : version(second) ? second : old
  next.version = from.version
  if (from.versionInferred) next.versionInferred = true
  else delete next.versionInferred
  // A review belongs to one storefront: a fetch that meets it again in another never moves it.
  const c = r.source === 'import' ? [first, second] : [old, r]
  const known = c.find(country)
  next.country = (known ?? old).country
  if (known) delete next.countryAssumed
  else next.countryAssumed = true
  const changed = r.date > old.date || (['rating', 'title', 'body', 'author', 'version', 'versionInferred', 'country', 'countryAssumed'] as const).some(f => next[f] !== old[f])
  return changed ? next : old
}

/** Merges fetched or imported reviews into the stored set. Same id: the newer edit wins (reviewers can update a review). */
export function mergeReviews(existing: Review[], incoming: Review[]): { reviews: Review[]; added: number; updated: number } {
  const map = new Map(existing.map(r => [key(r), r]))
  const matched = matchByContent(map, incoming)
  let added = 0, updated = 0
  for (const r of incoming) {
    const k = matched.get(r) ?? key(r)
    const old = map.get(k)
    if (!old) { map.set(k, r); added++; continue }
    const next = combine(old, r)
    if (next !== old) { map.set(k, next); updated++ }
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

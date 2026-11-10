// Import: CSV/TSV or App Store Connect API JSON -> detected columns -> reviews + a validation report.
import { hashId } from './reviews.ts'
import type { Review, VersionInfo } from './types.ts'

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  const first = text.split('\n', 1)[0]
  const delim = (first.match(/\t/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? '\t' : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ','
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false }
      else cell += c
    } else if (c === '"') q = true
    else if (c === delim) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.map(r => r.map(c => c.trim())).filter(r => r.some(Boolean))
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map(r => r.map(v => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }).join(',')).join('\n') + '\n'
}

export type Field = 'id' | 'date' | 'rating' | 'title' | 'body' | 'version' | 'country' | 'author'
export const FIELDS: { f: Field; label: string; required?: boolean }[] = [
  { f: 'date', label: 'Date', required: true }, { f: 'rating', label: 'Rating (1-5)', required: true },
  { f: 'body', label: 'Review text', required: true }, { f: 'title', label: 'Title' }, { f: 'version', label: 'App version' },
  { f: 'country', label: 'Country / territory' }, { f: 'author', label: 'Reviewer nickname' }, { f: 'id', label: 'Review id' },
]

const ALIASES: Record<Field, RegExp> = {
  id: /^(review ?id|id|customer ?review ?id)$/i,
  date: /^(date|created ?date|review ?date|created|last ?modified|updated|submitted|time)/i,
  rating: /^(rating|stars?|score|star ?rating)$/i,
  title: /^(title|review ?title|subject|headline)$/i,
  body: /^(body|review|content|text|review ?text|comment|review ?body|description)$/i,
  version: /^(version|app ?version|build|version ?name)$/i,
  country: /^(country|territory|store|storefront|country ?code|region|locale)$/i,
  author: /^(author|reviewer|nickname|reviewer ?nickname|user ?name|name|user)$/i,
}

export type Mapping = Partial<Record<Field, number>>

export function detectMapping(header: string[]): Mapping {
  const m: Mapping = {}
  for (const { f } of FIELDS) {
    const i = header.findIndex((h, j) => ALIASES[f].test(h.trim()) && !Object.values(m).includes(j))
    if (i >= 0) m[f] = i
  }
  return m
}

export interface Issue { line: number; level: 'error' | 'warning'; message: string }
export interface ImportResult { reviews: Review[]; issues: Issue[]; skipped: number; format: string }

// Territory names in App Store Connect exports are three-letter codes; map the common ones to storefront codes.
const ISO3: Record<string, string> = { USA: 'us', GBR: 'gb', CAN: 'ca', AUS: 'au', IND: 'in', DEU: 'de', FRA: 'fr', ESP: 'es', ITA: 'it', NLD: 'nl', BRA: 'br', MEX: 'mx', JPN: 'jp', KOR: 'kr', SWE: 'se', IRL: 'ie', NZL: 'nz', SGP: 'sg', CHN: 'cn', TWN: 'tw', HKG: 'hk' }
export function toCountry(s: string | undefined): string | null {
  if (!s) return null
  const t = s.trim()
  if (/^[a-z]{2}$/i.test(t)) return t.toLowerCase()
  if (ISO3[t.toUpperCase()]) return ISO3[t.toUpperCase()]
  const loc = t.match(/^[a-z]{2}[-_]([a-z]{2})$/i)
  if (loc) return loc[1].toLowerCase()
  return null
}

/** ISO date from "2026-10-03", "2026-10-03T12:00:00Z", "10/03/2026", "3 Oct 2026". Day-first if the first part is > 12. */
export function toDate(s: string | undefined): string | null {
  if (!s) return null
  const t = s.trim()
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) { const d = new Date(t.length > 10 ? t : `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T00:00:00Z`); return isNaN(+d) ? null : d.toISOString() }
  m = t.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/)
  if (m) {
    let a = +m[1], b = +m[2]
    if (a > 12) [a, b] = [b, a]
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    const d = new Date(Date.UTC(y, a - 1, b))
    return a >= 1 && a <= 12 && b >= 1 && b <= 31 && !isNaN(+d) ? d.toISOString() : null
  }
  const d = new Date(t)
  return isNaN(+d) ? null : d.toISOString()
}

export function rowsToReviews(rows: string[][], map: Mapping, appId: string, defaultCountry = 'us'): ImportResult {
  const issues: Issue[] = []
  const reviews: Review[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const f of FIELDS) if (f.required && map[f.f] === undefined) issues.push({ line: 1, level: 'error', message: `No column mapped to ${f.label}.` })
  if (issues.length) return { reviews, issues, skipped: rows.length - 1, format: 'csv' }
  const get = (r: string[], f: Field) => map[f] === undefined ? '' : (r[map[f]!] ?? '').trim()
  rows.slice(1).forEach((r, i) => {
    const line = i + 2
    const date = toDate(get(r, 'date'))
    const rating = Number(get(r, 'rating').replace(/[^\d.]/g, ''))
    const body = get(r, 'body')
    if (!date) { issues.push({ line, level: 'error', message: `Date "${get(r, 'date')}" is not a date. Row skipped.` }); skipped++; return }
    if (!(rating >= 1 && rating <= 5)) { issues.push({ line, level: 'error', message: `Rating "${get(r, 'rating')}" is not 1 to 5. Row skipped.` }); skipped++; return }
    if (!body && !get(r, 'title')) { issues.push({ line, level: 'warning', message: 'Empty review text. Kept for rating statistics only.' }) }
    const cRaw = get(r, 'country')
    const country = toCountry(cRaw)
    if (cRaw && !country) issues.push({ line, level: 'warning', message: `Unknown country "${cRaw}", using ${defaultCountry.toUpperCase()}.` })
    const version = get(r, 'version') || 'unknown'
    const id = get(r, 'id') || hashId(`${date}|${rating}|${get(r, 'title')}|${body}`)
    if (seen.has(id)) { issues.push({ line, level: 'warning', message: 'Duplicate of an earlier row. Skipped.' }); skipped++; return }
    seen.add(id)
    reviews.push({ id, appId, country: country ?? defaultCountry, rating: Math.round(rating), version, title: get(r, 'title'), body, author: get(r, 'author'), date, source: 'import' })
  })
  if (reviews.length && reviews.every(r => r.version === 'unknown')) issues.push({ line: 1, level: 'warning', message: 'No version column. Release impact needs versions; add a version history list to assign reviews by date.' })
  return { reviews, issues, skipped, format: 'csv' }
}

/** App Store Connect API: GET /v1/apps/{id}/customerReviews JSON (one page or an array of pages). */
export function parseAscJson(text: string, appId: string): ImportResult | null {
  let j: unknown
  try { j = JSON.parse(text) } catch { return null }
  const pages = Array.isArray(j) ? j : [j]
  const data = pages.flatMap(p => (p as { data?: unknown[] })?.data ?? [])
  if (!data.length || (data[0] as { type?: string }).type !== 'customerReviews') return null
  const issues: Issue[] = []
  const reviews: Review[] = []
  data.forEach((d, i) => {
    const a = (d as { attributes?: Record<string, unknown> }).attributes ?? {}
    const date = toDate(String(a.createdDate ?? ''))
    const rating = Number(a.rating)
    if (!date || !(rating >= 1 && rating <= 5)) { issues.push({ line: i + 1, level: 'error', message: `Review ${i + 1} has no valid date or rating. Skipped.` }); return }
    reviews.push({ id: String((d as { id?: string }).id ?? hashId(JSON.stringify(a))), appId, country: toCountry(String(a.territory ?? '')) ?? 'us', rating, version: 'unknown', title: String(a.title ?? ''), body: String(a.body ?? ''), author: String(a.reviewerNickname ?? ''), date, source: 'import' })
  })
  issues.push({ line: 1, level: 'warning', message: 'The customerReviews API does not include the app version. Add a version history list so reviews are assigned to releases by date.' })
  return { reviews, issues, skipped: data.length - reviews.length, format: 'App Store Connect API JSON' }
}

/** Version history: "version,date[,notes]" per line, with or without a header. */
export function parseVersions(text: string): { versions: VersionInfo[]; issues: Issue[] } {
  const rows = parseCsv(text)
  const issues: Issue[] = []
  const versions: VersionInfo[] = []
  rows.forEach((r, i) => {
    if (i === 0 && /version/i.test(r[0] ?? '')) return
    const [v, d, ...notes] = r
    const date = toDate(d)
    if (!v || !date) { issues.push({ line: i + 1, level: 'error', message: `Expected "version,date", got "${r.join(',')}".` }); return }
    versions.push({ version: v.replace(/^v/i, ''), date: date.slice(0, 10), notes: notes.join(', ') || undefined, origin: 'listed' })
  })
  return { versions, issues }
}

/** Reviews without a version get the latest listed version released on or before their date. */
export function assignVersions(reviews: Review[], versions: VersionInfo[]): Review[] {
  const vs = [...versions].sort((a, b) => a.date.localeCompare(b.date))
  if (!vs.length) return reviews
  return reviews.map(r => {
    if (r.version !== 'unknown') return r
    const d = r.date.slice(0, 10)
    let v: VersionInfo | undefined
    for (const x of vs) if (x.date <= d) v = x
    return v ? { ...r, version: v.version } : r
  })
}

export function reviewsCsv(reviews: Review[], themesOf: (r: Review) => string[]): string {
  return toCsv([
    ['id', 'date', 'country', 'version', 'rating', 'title', 'review', 'author', 'themes', 'source'],
    ...reviews.map(r => [r.id, r.date.slice(0, 10), r.country, r.version, r.rating, r.title, r.body, r.author, themesOf(r).join('; '), r.source]),
  ])
}

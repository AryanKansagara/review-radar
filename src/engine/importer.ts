// Import: CSV/TSV or App Store Connect API JSON -> detected columns -> reviews + a validation report.
import { cleanVersion, hashId, normalizeRss } from './reviews.ts'
import type { Review, VersionInfo } from './types.ts'

export interface CsvText {
  rows: string[][]
  /** The line each row starts on, counting from 1. */
  lines: number[]
  /** Where a quoted cell was opened that the text never closes. Its row is cut off somewhere unknown and is left out. */
  openQuote: number | null
}

export function readCsv(text: string): CsvText {
  const out: CsvText = { rows: [], lines: [], openQuote: null }
  // `quoted`: the current cell began with a quote. Only then are quotes syntax; in a plain cell (My 6" screen) they are text.
  let row: string[] = [], cell = '', q = false, quoted = false, line = 1, start = 1, opened = 1
  const first = text.split('\n', 1)[0]
  const delim = (first.match(/\t/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? '\t' : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ','
  const endCell = () => { row.push(cell.trim()); cell = ''; quoted = false }
  const endRow = () => {
    endCell()
    if (row.some(Boolean)) { out.rows.push(row); out.lines.push(start) }
    row = []
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const newline = c === '\n' || (c === '\r' && text[i + 1] !== '\n')
    if (q) {
      if (newline) line++
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false }
      else cell += c
    } else if (c === '"' && (quoted || !cell.trim())) { q = quoted = true; opened = line }
    else if (c === delim) endCell()
    else if (newline) { endRow(); start = ++line }
    else if (c !== '\r') cell += c
  }
  if (q) out.openQuote = opened
  else if (cell || row.length) endRow()
  return out
}

export const parseCsv = (text: string): string[][] => readCsv(text).rows

const notClosed = (line: number): Issue => ({ line, level: 'error', message: 'The quote opened here is never closed, so this row and everything after it was not read. The file may be cut off.' })

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

// Tested against the headers of the App Store Connect API, the app-store-scraper libraries (Python and Node),
// Appfigures, AppFollow and Appbot exports. Headers are compared after headerKey().
const ALIASES: Record<Field, RegExp> = {
  id: /^(review ?id|id|customer ?review ?id)$/,
  date: /^(date|created ?date|review ?date|created|last ?modified|updated|submitted|submission ?date|time)/,
  rating: /^(rating|stars?|score|star ?rating|im rating)$/,
  title: /^(title|review ?title|subject|headline)$/,
  body: /^(body|review|content|text|review ?text|comment|review ?body|description)$/,
  version: /^(version|app ?version|build|version ?name|im version)$/,
  country: /^(country|territory|store|storefront|country ?code|region|locale|iso)$/,
  author: /^(author|reviewer|nickname|reviewer ?nickname|user ?name|name|user)$/,
}

/** "reviewerNickname", "review_id" and "Review-ID" all compare as lowercase words separated by spaces. */
export const headerKey = (h: string) => h.trim().replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-:.]+/g, ' ').replace(/\s+/g, ' ').toLowerCase()

export type Mapping = Partial<Record<Field, number>>

export function detectMapping(header: string[]): Mapping {
  const m: Mapping = {}
  for (const { f } of FIELDS) {
    const i = header.findIndex((h, j) => ALIASES[f].test(headerKey(h)) && !Object.values(m).includes(j))
    if (i >= 0) m[f] = i
  }
  return m
}

export interface Issue { line: number; level: 'error' | 'warning'; message: string }
export interface ImportResult { reviews: Review[]; issues: Issue[]; skipped: number; format: string }

// Every code in the App Store Connect API's TerritoryCode list (developer.apple.com/documentation/appstoreconnectapi/territorycode)
// followed by its two-letter storefront code: ISO 3166-1, plus Apple's own XKS for Kosovo.
const ISO3: Record<string, string> = Object.fromEntries((
  'ABWaw AFGaf AGOao AIAai ALBal ANDad ANTan AREae ARGar ARMam ASMas ATGag AUSau AUTat AZEaz BDIbi BELbe BENbj BESbq BFAbf BGDbd BGRbg BHRbh BHSbs BIHba BLRby BLZbz BMUbm ' +
  'BOLbo BRAbr BRBbb BRNbn BTNbt BWAbw CAFcf CANca CHEch CHLcl CHNcn CIVci CMRcm CODcd COGcg COKck COLco COMkm CPVcv CRIcr CUBcu CUWcw CXRcx CYMky CYPcy CZEcz DEUde DJIdj ' +
  'DMAdm DNKdk DOMdo DZAdz ECUec EGYeg ERIer ESPes ESTee ETHet FINfi FJIfj FLKfk FRAfr FROfo FSMfm GABga GBRgb GEOge GGYgg GHAgh GIBgi GINgn GLPgp GMBgm GNBgw GNQgq GRCgr ' +
  'GRDgd GRLgl GTMgt GUFgf GUMgu GUYgy HKGhk HNDhn HRVhr HTIht HUNhu IDNid IMNim INDin IRLie IRQiq ISLis ISRil ITAit JAMjm JEYje JORjo JPNjp KAZkz KENke KGZkg KHMkh KIRki ' +
  'KNAkn KORkr KWTkw LAOla LBNlb LBRlr LBYly LCAlc LIEli LKAlk LSOls LTUlt LUXlu LVAlv MACmo MARma MCOmc MDAmd MDGmg MDVmv MEXmx MHLmh MKDmk MLIml MLTmt MMRmm MNEme MNGmn ' +
  'MNPmp MOZmz MRTmr MSRms MTQmq MUSmu MWImw MYSmy MYTyt NAMna NCLnc NERne NFKnf NGAng NICni NIUnu NLDnl NORno NPLnp NRUnr NZLnz OMNom PAKpk PANpa PERpe PHLph PLWpw PNGpg ' +
  'POLpl PRIpr PRTpt PRYpy PSEps PYFpf QATqa REUre ROUro RUSru RWArw SAUsa SENsn SGPsg SHNsh SLBsb SLEsl SLVsv SMRsm SOMso SPMpm SRBrs SSDss STPst SURsr SVKsk SVNsi SWEse ' +
  'SWZsz SXMsx SYCsc TCAtc TCDtd TGOtg THAth TJKtj TKMtm TLStl TONto TTOtt TUNtn TURtr TUVtv TWNtw TZAtz UGAug UKRua UMIum URYuy USAus UZBuz VATva VCTvc VENve VGBvg VIRvi ' +
  'VNMvn VUTvu WLFwf WSMws XKSxk YEMye ZAFza ZMBzm ZWEzw'
).split(' ').map(x => [x.slice(0, 3), x.slice(3)]))
export function toCountry(s: string | undefined): string | null {
  if (!s) return null
  const t = s.trim()
  const two = (c: string) => c.toLowerCase() === 'uk' ? 'gb' : c.toLowerCase()
  if (/^[a-z]{2}$/i.test(t)) return two(t)
  const code = t.toUpperCase()
  if (Object.hasOwn(ISO3, code)) return ISO3[code]
  const loc = t.match(/^[a-z]{2}[-_]([a-z]{2})$/i)
  if (loc) return two(loc[1])
  return null
}

/**
 * ISO date from "2026-10-03", "2026-10-03 12:00:00", "2026-10-03T12:00:00Z", "10/03/2026", "3 Oct 2026" or a Unix timestamp.
 * Timestamps without a zone are read as UTC so the same file imports the same way on every device.
 * Slash dates are month first unless `dayFirst` is set or the first part is over 12.
 */
export function toDate(s: string | undefined, dayFirst = false): string | null {
  if (!s) return null
  const t = s.trim()
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i)
  if (m) {
    const [y, mo, da] = [+m[1], +m[2], +m[3]]
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return null
    const utc = Date.UTC(y, mo - 1, da, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
    const z = m[7] && m[7].toUpperCase() !== 'Z' ? m[7].match(/([+-])(\d{2}):?(\d{2})/)! : null
    const off = z ? (z[1] === '-' ? -1 : 1) * (+z[2] * 60 + +z[3]) * 6e4 : 0
    return new Date(utc - off).toISOString()
  }
  m = t.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/)
  if (m) {
    let a = +m[1], b = +m[2]
    if (dayFirst || a > 12) [a, b] = [b, a]
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    const d = new Date(Date.UTC(y, a - 1, b))
    return a >= 1 && a <= 12 && b >= 1 && b <= 31 && !isNaN(+d) ? d.toISOString() : null
  }
  if (/^\d{10}$/.test(t)) return new Date(+t * 1000).toISOString()
  if (/^\d{13}$/.test(t)) return new Date(+t).toISOString()
  if (/^\d+$/.test(t)) return null
  const d = new Date(/\d{4}/.test(t) && !/(Z|GMT|UTC|[+-]\d{2}:?\d{2})$/i.test(t) ? t + ' UTC' : t)
  return isNaN(+d) ? null : d.toISOString()
}

/** A slash-date column is day first when any row has a first part over 12 and no row has a second part over 12. */
export function isDayFirst(values: string[]): boolean {
  let first = false, second = false
  for (const v of values) {
    const m = v.trim().match(/^(\d{1,2})[/.](\d{1,2})[/.]\d{2,4}/)
    if (!m) continue
    if (+m[1] > 12) first = true
    if (+m[2] > 12) second = true
  }
  return first && !second
}

export function rowsToReviews(rows: string[][], map: Mapping, appId: string, defaultCountry = 'us', src: Partial<Pick<CsvText, 'lines' | 'openQuote'>> = {}): ImportResult {
  const issues: Issue[] = []
  const reviews: Review[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const f of FIELDS) if (f.required && map[f.f] === undefined) issues.push({ line: 1, level: 'error', message: `No column mapped to ${f.label}.` })
  if (issues.length) return { reviews, issues, skipped: rows.length - 1, format: 'csv' }
  const get = (r: string[], f: Field) => map[f] === undefined ? '' : (r[map[f]!] ?? '').trim()
  const dayFirst = isDayFirst(rows.slice(1).map(r => get(r, 'date')))
  if (dayFirst) issues.push({ line: 1, level: 'warning', message: 'Dates read as day/month/year, because some rows have a day above 12.' })
  rows.slice(1).forEach((r, i) => {
    const line = src.lines?.[i + 1] ?? i + 2
    // A comma in unquoted text moves every later cell one column on, so nothing after it can be trusted.
    if (r.slice(rows[0].length).some(Boolean)) { issues.push({ line, level: 'error', message: `${r.length} cells for ${rows[0].length} columns. Text that contains the separator must be in quotes. Row skipped.` }); skipped++; return }
    const date = toDate(get(r, 'date'), dayFirst)
    const rating = Number(get(r, 'rating').replace(',', '.').replace(/[^\d.]/g, ''))
    const body = get(r, 'body')
    if (!date) { issues.push({ line, level: 'error', message: `Date "${get(r, 'date')}" is not a date. Row skipped.` }); skipped++; return }
    if (!(rating >= 1 && rating <= 5)) { issues.push({ line, level: 'error', message: `Rating "${get(r, 'rating')}" is not 1 to 5. Row skipped.` }); skipped++; return }
    if (!body && !get(r, 'title')) { issues.push({ line, level: 'warning', message: 'Empty review text. Kept for rating statistics only.' }) }
    const cRaw = get(r, 'country')
    const country = toCountry(cRaw)
    if (cRaw && !country) issues.push({ line, level: 'warning', message: `Unknown country "${cRaw}", using ${defaultCountry.toUpperCase()}.` })
    const version = cleanVersion(get(r, 'version')) || 'unknown'
    const id = get(r, 'id') || hashId(`${date}|${rating}|${get(r, 'title')}|${body}`)
    if (seen.has(id)) { issues.push({ line, level: 'warning', message: 'Duplicate of an earlier row. Skipped.' }); skipped++; return }
    seen.add(id)
    if (Object.values(map).some(c => c >= r.length)) issues.push({ line, level: 'warning', message: `Only ${r.length} of ${rows[0].length} cells. Kept, but the row may be cut off.` })
    reviews.push({ id, appId, country: country ?? defaultCountry, rating: Math.round(rating), version, title: get(r, 'title'), body, author: get(r, 'author'), date, source: 'import' })
  })
  if (src.openQuote) { issues.push(notClosed(src.openQuote)); skipped++ }
  if (reviews.length && reviews.every(r => r.version === 'unknown')) issues.push({ line: 1, level: 'warning', message: 'No version column. Release impact needs versions; add a version history list to assign reviews by date.' })
  return { reviews, issues, skipped, format: 'csv' }
}

/** App Store Connect API: GET /v1/apps/{id}/customerReviews JSON (one page or an array of pages). */
export function parseAscJson(text: string, appId: string, defaultCountry = 'us'): ImportResult | null {
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
    const country = toCountry(String(a.territory ?? ''))
    if (!country) issues.push({ line: i + 1, level: 'warning', message: `Review ${i + 1}: ${a.territory ? `unknown territory "${a.territory}"` : 'no territory'}, using ${defaultCountry.toUpperCase()}.` })
    reviews.push({ id: String((d as { id?: string }).id ?? hashId(JSON.stringify(a))), appId, country: country ?? defaultCountry, rating, version: 'unknown', title: String(a.title ?? ''), body: String(a.body ?? ''), author: String(a.reviewerNickname ?? ''), date, source: 'import' })
  })
  issues.push({ line: 1, level: 'warning', message: 'The customerReviews API does not include the app version. Add a version history list so reviews are assigned to releases by date.' })
  return { reviews, issues, skipped: data.length - reviews.length, format: 'App Store Connect API JSON' }
}

/** Saved pages of the public customer-reviews feed (one page or an array of pages), e.g. from curl or a web archive. */
export function parseFeedJson(text: string, appId: string, defaultCountry = 'us'): ImportResult | null {
  let j: unknown
  try { j = JSON.parse(text) } catch { return null }
  const pages = (Array.isArray(j) ? j : [j]).filter(p => p && typeof p === 'object' && 'feed' in (p as object))
  if (!pages.length) return null
  const seen = new Set<string>()
  const reviews: Review[] = []
  let dupes = 0
  for (const p of pages) {
    // The storefront is part of the feed's own address: https://itunes.apple.com/gb/rss/customerreviews/...
    const self = JSON.stringify((p as { feed: { id?: unknown } }).feed.id ?? '')
    const country = self.match(/apple\.com\/([a-z]{2})\/rss\//i)?.[1].toLowerCase() ?? defaultCountry
    for (const r of normalizeRss(p, appId, country)) {
      if (seen.has(r.id)) { dupes++; continue }
      seen.add(r.id)
      reviews.push({ ...r, source: 'import' })
    }
  }
  const issues: Issue[] = []
  if (!reviews.length) issues.push({ line: 1, level: 'error', message: 'This feed page lists no reviews. Apple’s feed sometimes answers with an empty list; save the page again later.' })
  if (dupes) issues.push({ line: 1, level: 'warning', message: `${dupes} reviews appear on more than one page. Kept once.` })
  return { reviews, issues, skipped: dupes, format: 'App Store reviews feed JSON' }
}

/**
 * A JSON array of flat objects, such as the output of the app-store-scraper libraries
 * ([{ id, userName, version, score, title, text, updated }, ...]), as header + rows for the CSV path.
 */
export function jsonToRows(text: string): string[][] | null {
  let j: unknown
  try { j = JSON.parse(text) } catch { return null }
  if (!Array.isArray(j) || !j.length || !j.every(x => x && typeof x === 'object' && !Array.isArray(x))) return null
  const keys = [...new Set((j as Record<string, unknown>[]).flatMap(o => Object.keys(o)))]
  const cell = (v: unknown) => v === null || v === undefined ? '' : typeof v === 'object' ? '' : String(v)
  return [keys, ...(j as Record<string, unknown>[]).map(o => keys.map(k => cell(o[k])))]
}

/** Version history: "version,date[,notes]" per line, with or without a header. */
export function parseVersions(text: string): { versions: VersionInfo[]; issues: Issue[] } {
  const { rows, lines, openQuote } = readCsv(text)
  const issues: Issue[] = openQuote ? [notClosed(openQuote)] : []
  const versions: VersionInfo[] = []
  rows.forEach((r, i) => {
    if (i === 0 && /version/i.test(r[0] ?? '')) return
    const [v, d, ...notes] = r
    const date = toDate(d)
    if (!v || !date) { issues.push({ line: lines[i], level: 'error', message: `Expected "version,date", got "${r.join(',')}".` }); return }
    versions.push({ version: cleanVersion(v), date: date.slice(0, 10), notes: notes.join(', ') || undefined, origin: 'listed' })
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

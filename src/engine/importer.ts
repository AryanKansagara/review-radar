// Import: CSV/TSV or App Store Connect API JSON -> detected columns -> reviews + a validation report.
import { cleanVersion, contentId, hashId, isRoundedId, normalizeRss, readRating } from './reviews.ts'
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

/** Text a spreadsheet would run, or that starts with the quotes that mark such text (OWASP, CSV injection). */
const FORMULA = /^'*[=+\-@\t\r\n＝＋－＠]/
const guard = (s: string) => FORMULA.test(s) && !/^-\d+(?:\.\d+)?$/.test(s) ? `'${s}` : s

/** Cells that would start a formula are prefixed with '. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map(r => r.map(v => {
    const s = v === null || v === undefined ? '' : typeof v === 'number' ? String(v) : guard(v)
    return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
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

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
/** 1 to 12 for an English month name or its first letters ("Oct", "Sept"), else 0. */
const monthOf = (s: string) => s.length < 3 ? 0 : MONTHS.findIndex(m => m.startsWith(s.toLowerCase())) + 1
const US_ZONES: Record<string, number> = { est: -5, edt: -4, cst: -6, cdt: -5, mst: -7, mdt: -6, pst: -8, pdt: -7 }
const WEEKDAY = /^(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|rsday|urday)?\.?,?\s+/i

/** Whole seconds, as milliseconds, after midnight UTC for "5:30 PM", "12:00:00.123Z", "08:15:42 -07:00", "23:00 GMT+0200 (CEST)"; null when that is not a time. */
function timeOf(s: string): number | null {
  if (!s) return 0
  const m = s.match(/^(?:(\d{1,2})(?::(\d{2})(?::(\d{2})(?:[.,]\d+)?)?)?\s*([ap]\.?m\.?)?)?\s*(z|utc|gmt|[ecmp][sd]t)?\s*(?:([+-])(\d{1,2}):?(\d{2})?)?(?:\s*\([^()]*\))?$/i)
  if (!m) return null
  let h = +(m[1] ?? 0)
  const mi = +(m[2] ?? 0), sec = +(m[3] ?? 0)
  if (m[1] && !m[2] && !m[4]) return null
  if (m[4]) {
    if (h < 1 || h > 12) return null
    h = h % 12 + (/^p/i.test(m[4]) ? 12 : 0)
  }
  // 24:00 is the midnight that ends the day.
  if (mi > 59 || sec > 59 || h > 24 || (h === 24 && (mi || sec))) return null
  const off = m[6] ? (m[6] === '-' ? -1 : 1) * (+m[7] * 60 + +(m[8] ?? 0)) : (US_ZONES[(m[5] ?? '').toLowerCase()] ?? 0) * 60
  if (Math.abs(off) > 14 * 60 || +(m[8] ?? 0) > 59) return null
  return ((h * 60 + mi - off) * 60 + sec) * 1000
}

function iso(y: number, mo: number, d: number, ms: number | null): string | null {
  const day = new Date(Date.UTC(y, mo - 1, d))
  // Date.UTC rolls 30 February over into March, and reads years below 100 as 19xx.
  if (ms === null || day.getUTCFullYear() !== y || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) return null
  return new Date(+day + ms).toISOString()
}

/**
 * ISO date from "2026-10-03", "2026-10-03 12:00:00", "2026-10-03T12:00:00Z", "10/03/2026", "3 Oct 2026", "Oct 3, 2026 5:30 PM" or a Unix timestamp.
 * Anything else, and a day or time that does not exist, is null.
 * Timestamps without a zone are read as UTC so the same file imports the same way on every device.
 * 10/03/2026, 10.03.2026 and 10-03-2026 are month first unless `dayFirst` is set or the first part is over 12.
 */
export function toDate(s: string | undefined, dayFirst = false): string | null {
  if (!s) return null
  const t = s.trim().replace(WEEKDAY, '')
  if (/^\d{10}$/.test(t)) return new Date(+t * 1000).toISOString()
  if (/^\d{13}$/.test(t)) return new Date(+t).toISOString()
  let m = t.match(/^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})(?:(?:t|,?\s+)(?=\d)|\s*(?=z|[+-]\d|\s[a-z])|$)(.*)$/i)
  if (m) return iso(+m[1], +m[3], +m[4], timeOf(m[5].trim()))
  m = t.match(/^(\d{1,2})([-/.])(\d{1,2})\2(\d{4}|\d{2})(?:,?\s+(.*))?$/)
  if (m) {
    let a = +m[1], b = +m[3]
    if (dayFirst || a > 12) [a, b] = [b, a]
    const time = timeOf(m[5] ?? '')
    // Slash and dot dates have always been read as a whole day.
    return iso(m[4].length === 2 ? 2000 + +m[4] : +m[4], a, b, time === null || m[2] === '-' ? time : 0)
  }
  // With the month in letters: "3 Oct 2026", "3-Oct-26", "October 3rd, 2026 at 5:30 PM", "2026 Oct 3", "Sat Oct 03 12:00:00 2026".
  const w = t.replace(/^(\S+\s+\d{1,2})\s+(\d{1,2}:\S+)\s+(\d{4})$/, '$1 $3 $2')
  const d = w.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s,./-]*([a-z]+)[\s,./-]*(\d{4}|\d{2})(?![\d:])(.*)$/i)
  if (d) return lettered(d[3], d[2], d[1], d[4])
  const f = w.match(/^([a-z]+)[\s,./-]*(\d{1,2})(?:st|nd|rd|th)?[\s,./-]+(\d{4}|\d{2})(?![\d:])(.*)$/i)
  if (f) return lettered(f[3], f[1], f[2], f[4])
  const y = w.match(/^(\d{4})[\s,./-]*([a-z]+)[\s,./-]*(\d{1,2})(?![\d:])(.*)$/i)
  return y ? lettered(y[1], y[2], y[3], y[4]) : null
}
const lettered = (y: string, mo: string, d: string, rest: string) =>
  iso(y.length === 2 ? 2000 + +y : +y, monthOf(mo), +d, /^$|^[\s,]/.test(rest) ? timeOf(rest.replace(/^[\s,]+(?:at\s+)?/i, '')) : null)

/** A column of dates such as 03/10/2026 is day first when any row has a first part over 12 and no row has a second part over 12. */
export function isDayFirst(values: string[]): boolean {
  let first = false, second = false
  for (const v of values) {
    const m = v.trim().match(/^(\d{1,2})([-/.])(\d{1,2})\2(?:\d{4}|\d{2})(?!\d)/)
    if (!m) continue
    if (+m[1] > 12) first = true
    if (+m[3] > 12) second = true
  }
  return first && !second
}
const DAY_FIRST: Issue = { line: 1, level: 'warning', message: 'Dates read as day/month/year, because some rows have a day above 12.' }

export function rowsToReviews(rows: string[][], map: Mapping, appId: string, defaultCountry = 'us', src: Partial<Pick<CsvText, 'lines' | 'openQuote'>> = {}): ImportResult {
  const issues: Issue[] = []
  const reviews: Review[] = []
  const seen = new Set<string>()
  let skipped = 0, roundedAt = 0
  for (const f of FIELDS) if (f.required && map[f.f] === undefined) issues.push({ line: 1, level: 'error', message: `No column mapped to ${f.label}.` })
  if (issues.length) return { reviews, issues, skipped: rows.length - 1, format: 'csv' }
  // In our own export the ' in front of a formula was added by toCsv.
  const own = rows[0].join() === EXPORT_HEADER.join()
  const get = (r: string[], f: Field) => {
    const s = map[f] === undefined ? '' : (r[map[f]!] ?? '').trim()
    return (own && FORMULA.test(s) && s.startsWith("'") ? s.slice(1) : s).trim()
  }
  const dayFirst = isDayFirst(rows.slice(1).map(r => get(r, 'date')))
  if (dayFirst) issues.push(DAY_FIRST)
  rows.slice(1).forEach((r, i) => {
    const line = src.lines?.[i + 1] ?? i + 2
    // A comma in unquoted text moves every later cell one column on, so nothing after it can be trusted.
    if (r.slice(rows[0].length).some(Boolean)) { issues.push({ line, level: 'error', message: `${r.length} cells for ${rows[0].length} columns. Text that contains the separator must be in quotes. Row skipped.` }); skipped++; return }
    const date = toDate(get(r, 'date'), dayFirst)
    const rating = readRating(get(r, 'rating'))
    const body = get(r, 'body')
    if (!date) { issues.push({ line, level: 'error', message: `Date "${get(r, 'date')}" is not a date. Row skipped.` }); skipped++; return }
    if (!rating) { issues.push({ line, level: 'error', message: `Rating "${get(r, 'rating')}" is not ${/^[1-5][.,]\d+$/.test(get(r, 'rating')) ? 'a whole number of stars' : '1 to 5'}. Row skipped.` }); skipped++; return }
    if (!body && !get(r, 'title')) { issues.push({ line, level: 'warning', message: 'Empty review text. Kept for rating statistics only.' }) }
    const cRaw = get(r, 'country')
    const country = toCountry(cRaw)
    if (cRaw && !country) issues.push({ line, level: 'warning', message: `Unknown country "${cRaw}", using ${defaultCountry.toUpperCase()}.` })
    const version = cleanVersion(get(r, 'version')) || 'unknown'
    const rounded = isRoundedId(get(r, 'id'))
    if (rounded && !roundedAt) roundedAt = line
    const id = get(r, 'id') && !rounded ? get(r, 'id') : contentId(JSON.stringify([date, rating, get(r, 'title'), body, get(r, 'author'), country ?? '', version]))
    if (seen.has(id)) { issues.push({ line, level: 'warning', message: 'Duplicate of an earlier row. Skipped.' }); skipped++; return }
    seen.add(id)
    if (Object.values(map).some(c => c >= r.length)) issues.push({ line, level: 'warning', message: `Only ${r.length} of ${rows[0].length} cells. Kept, but the row may be cut off.` })
    reviews.push({ id, appId, country: country ?? defaultCountry, ...(country ? {} : { countryAssumed: true as const }), rating, version, title: get(r, 'title'), body, author: get(r, 'author'), date, source: 'import' })
  })
  if (src.openQuote) { issues.push(notClosed(src.openQuote)); skipped++ }
  if (roundedAt) issues.push({ line: roundedAt, level: 'warning', message: 'Ids such as 1.47667E+10 were rounded by a spreadsheet and are not used. Rows are told apart by their content instead.' })
  if (reviews.length && reviews.every(r => r.version === 'unknown')) issues.push({ line: 1, level: 'warning', message: 'No version column. Release impact needs versions; add a version history list to assign reviews by date.' })
  return { reviews, issues, skipped, format: 'csv' }
}

/** App Store Connect API: GET /v1/apps/{id}/customerReviews JSON (one page or an array of pages). */
export function parseAscJson(text: string, appId: string, defaultCountry = 'us'): ImportResult | null {
  let j: unknown
  try { j = JSON.parse(text) } catch { return null }
  const pages = Array.isArray(j) ? j : [j]
  const data = pages.flatMap(p => (p as { data?: unknown[] })?.data ?? [])
  if (!data.some(d => (d as { type?: string } | null)?.type === 'customerReviews')) return null
  const issues: Issue[] = []
  const reviews: Review[] = []
  data.forEach((d, i) => {
    const a = (d as { attributes?: Record<string, unknown> } | null)?.attributes ?? {}
    const date = toDate(String(a.createdDate ?? ''))
    const rating = readRating(a.rating)
    if (!date || !rating) { issues.push({ line: i + 1, level: 'error', message: `Review ${i + 1} has no valid date or rating. Skipped.` }); return }
    const country = toCountry(String(a.territory ?? ''))
    if (!country) issues.push({ line: i + 1, level: 'warning', message: `Review ${i + 1}: ${a.territory ? `unknown territory "${a.territory}"` : 'no territory'}, using ${defaultCountry.toUpperCase()}.` })
    reviews.push({ id: String((d as { id?: string }).id ?? hashId(JSON.stringify(a))), appId, country: country ?? defaultCountry, ...(country ? {} : { countryAssumed: true as const }), rating, version: 'unknown', title: String(a.title ?? ''), body: String(a.body ?? ''), author: String(a.reviewerNickname ?? ''), date, source: 'import' })
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
  const issues: Issue[] = []
  let dupes = 0, n = 0
  for (const p of pages) {
    // The storefront is part of the feed's own address: https://itunes.apple.com/gb/rss/customerreviews/...
    const self = JSON.stringify((p as { feed: { id?: unknown } | null }).feed?.id ?? '')
    const country = self.match(/apple\.com\/([a-z]{2})\/rss\//i)?.[1].toLowerCase()
    const entry = (p as { feed: { entry?: unknown } | null }).feed?.entry ?? []
    for (const e of Array.isArray(entry) ? entry : [entry]) {
      const line = ++n
      const [r] = normalizeRss({ feed: { entry: [e] } }, appId, country ?? defaultCountry)
      if (!r) {
        // Older feeds begin with an entry that describes the app.
        if (!e || typeof e !== 'object' || 'im:rating' in e || !('im:name' in e)) issues.push({ line, level: 'error', message: `Entry ${line} has no valid date or rating. Skipped.` })
        continue
      }
      if (seen.has(r.id)) { dupes++; continue }
      seen.add(r.id)
      reviews.push({ ...r, ...(country ? {} : { countryAssumed: true as const }), source: 'import' })
    }
  }
  const bad = issues.length
  if (!reviews.length) issues.push({ line: 1, level: 'error', message: bad ? 'This feed page lists no readable reviews.' : 'This feed page lists no reviews. Apple’s feed sometimes answers with an empty list; save the page again later.' })
  if (dupes) issues.push({ line: 1, level: 'warning', message: `${dupes} reviews appear on more than one page. Kept once.` })
  return { reviews, issues, skipped: dupes + bad, format: 'App Store reviews feed JSON' }
}

const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)

/**
 * A JSON array of flat objects, such as the output of the app-store-scraper libraries
 * ([{ id, userName, version, score, title, text, updated }, ...]), as header + rows for the CSV path.
 * Anything else in the array becomes an empty row, which is then reported on its line.
 */
export function jsonToRows(text: string): string[][] | null {
  let j: unknown
  try { j = JSON.parse(text) } catch { return null }
  if (!Array.isArray(j) || !j.length || !j.some(isObject)) return null
  const objects = j.map(x => isObject(x) ? x : {})
  const keys = [...new Set(objects.flatMap(o => Object.keys(o)))]
  const cell = (v: unknown) => v === null || v === undefined ? '' : typeof v === 'object' ? '' : String(v)
  return [keys, ...objects.map(o => keys.map(k => cell(o[k])))]
}

/** Version history: "version,date[,notes]" per line, with or without a header. */
export function parseVersions(text: string): { versions: VersionInfo[]; issues: Issue[] } {
  const { rows, lines, openQuote } = readCsv(text)
  const issues: Issue[] = openQuote ? [notClosed(openQuote)] : []
  const versions: VersionInfo[] = []
  const dayFirst = isDayFirst(rows.map(r => r[1] ?? ''))
  if (dayFirst) issues.push(DAY_FIRST)
  rows.forEach((r, i) => {
    if (i === 0 && /version/i.test(r[0] ?? '')) return
    const [v, d, ...notes] = r
    const date = toDate(d, dayFirst)
    if (!v || !date) { issues.push({ line: lines[i], level: 'error', message: `Expected "version,date", got "${r.join(',')}".` }); return }
    versions.push({ version: cleanVersion(v), date: date.slice(0, 10), notes: notes.join(', ') || undefined, origin: 'listed' })
  })
  return { versions, issues }
}

/**
 * Reviews of the app that came without a version get the latest listed version released on or before their date.
 * That is redone whenever the list changes; a version that came with the review is never touched.
 */
export function assignVersions(reviews: Review[], versions: VersionInfo[], appId: string): Review[] {
  const vs = [...versions].sort((a, b) => a.date.localeCompare(b.date))
  if (!vs.length) return reviews
  return reviews.map(r => {
    if (r.appId !== appId || (r.version !== 'unknown' && !r.versionInferred)) return r
    const d = r.date.slice(0, 10)
    const v = vs.findLast(x => x.date <= d)?.version ?? 'unknown'
    if (v === r.version) return r
    const { versionInferred: _, ...rest } = r
    return v === 'unknown' ? { ...rest, version: v } : { ...rest, version: v, versionInferred: true }
  })
}

const EXPORT_HEADER = ['id', 'date', 'country', 'version', 'rating', 'title', 'review', 'author', 'themes', 'source']

export function reviewsCsv(reviews: Review[], themesOf: (r: Review) => string[]): string {
  return toCsv([
    EXPORT_HEADER,
    ...reviews.map(r => [r.id, r.date.slice(0, 10), r.country, r.version, r.rating, r.title, r.body, r.author, themesOf(r).join('; '), r.source]),
  ])
}

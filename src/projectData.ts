import { useEffect, useMemo, useState } from 'react'
import { buildVersions, cleanVersion, cmpVersion, mergeReviews } from './engine/reviews.ts'
import { SAMPLES, sampleReviews } from './engine/sample.ts'
import { releaseImpact, seriesByVersion, summarize, versionByCountry, weekly } from './engine/stats.ts'
import { classify, clusters, emergingThemes, featureRequests, groupRequests, themeStats, whatToFix } from './engine/themes.ts'
import type { AppInfo, Review, VersionInfo } from './engine/types.ts'
import { fetchReviews, lookupApp, looksLikeOutage, type FetchProgress } from './live.ts'
import { blankProject, delData, getData, getDefaults, getProject, putData, saveProject, uuid, type Project, type Snapshot } from './store.ts'

const dataSubs = new Set<() => void>()
let dataTick = 0
export const bumpData = () => { dataTick++; dataSubs.forEach(f => f()) }

export async function getReviews(p: Project): Promise<Review[]> {
  if (p.sampleId) return sampleReviews(p.sampleId)
  // Reviews stored before version labels were normalised can still say "v3.2".
  return ((await getData(p.id)) ?? []).map(r => /^\s*v\d|\s$/i.test(r.version) ? { ...r, version: cleanVersion(r.version) } : r)
}

/** Reviews for a project, reloaded whenever data is written. null while loading. */
export function useReviews(p: Project | undefined): Review[] | null {
  const [state, setState] = useState<{ id: string; tick: number; reviews: Review[] } | null>(null)
  const [tick, setTick] = useState(dataTick)
  useEffect(() => { const f = () => setTick(dataTick); dataSubs.add(f); return () => { dataSubs.delete(f) } }, [])
  useEffect(() => {
    if (!p) return
    let live = true
    void getReviews(p).then(reviews => { if (live) setState({ id: p.id, tick, reviews }) })
    return () => { live = false }
  }, [p?.id, p?.sampleId, tick])
  return state && p && state.id === p.id ? state.reviews : null
}

export async function createSampleProject(sampleId: string): Promise<Project> {
  const s = SAMPLES.find(x => x.id === sampleId)!
  const p = blankProject(s.name, s.competitor ? [s.app, s.competitor] : [s.app])
  p.sampleId = sampleId
  p.countries = s.countries
  p.versions = { [s.app.id]: s.versions }
  p.reply = { ...p.reply, supportEmail: p.reply.supportEmail || 'support@example.com', fixedIn: s.id === 'photo' ? '5.4.1' : '3.3' }
  const reviews = sampleReviews(sampleId)
  p.lastFetch = Date.parse('2026-11-08T09:00:00Z')
  // Two snapshots so the compare view has something to show: before and after the latest release.
  const latest = s.versions[s.versions.length - 1]
  const prior = reviews.filter(r => r.date < latest.date)
  p.snapshots = [makeSnapshot(p, prior, `Before ${latest.version}`, Date.parse(latest.date) - 864e5), makeSnapshot(p, reviews, 'Latest fetch', p.lastFetch)]
  return saveProject(p)
}

export async function createAppProject(app: AppInfo, country: string): Promise<Project> {
  const d = getDefaults()
  const p = blankProject(app.name, [app])
  p.countries = [...new Set([country, ...d.countries])].slice(0, 6)
  p.versions = { [app.id]: lookupVersion(app) }
  return saveProject(p)
}

/** The lookup API only knows the current version; keep it as a listed version with its real date and notes. */
export const lookupVersion = (a: AppInfo): VersionInfo[] => a.version && a.currentVersionReleaseDate ? [{ version: a.version, date: a.currentVersionReleaseDate.slice(0, 10), notes: a.releaseNotes || undefined, origin: 'listed' }] : []

export function mergeVersions(a: VersionInfo[], b: VersionInfo[]): VersionInfo[] {
  const m = new Map(a.map(v => [v.version, v]))
  for (const v of b) m.set(v.version, { ...m.get(v.version), ...v })
  return [...m.values()].sort((x, y) => cmpVersion(x.version, y.version))
}

/**
 * Refreshes app metadata and pulls the latest reviews for every app in the project, then saves a snapshot.
 * A fetch takes a while, so nothing is saved from the state it started with: the result is merged into the project
 * and reviews as they are at the end. `deleted` means the project was removed meanwhile and nothing was saved.
 */
export async function runFetch(id: string, onProgress?: (label: string, p: FetchProgress) => void, signal?: AbortSignal) {
  const start = getProject(id)!
  const pages = getDefaults().pages
  let outage = false
  const failed: string[] = []
  const empty: string[] = []
  const incomplete: string[] = []
  const fetched = new Map<string, { app: AppInfo; reviews: Review[] }>()
  for (const a of start.apps.filter(isStoreApp)) {
    const own = a.id === start.apps[0].id
    const fresh = await lookupApp(a.id, start.countries[0], signal).catch(() => null)
    const app = fresh ?? a
    // Competitors get fewer pages to keep the fetch quick.
    const res = await fetchReviews(app.id, start.countries, own ? pages : Math.min(pages, 4), pr => onProgress?.(app.name, pr), signal)
    failed.push(...res.failed.map(c => `${app.name} (${c.toUpperCase()})`))
    incomplete.push(...res.incomplete.map(c => `${app.name} ${c}`))
    if (looksLikeOutage(res, start.countries, app.ratingCount)) { if (own) outage = true }
    else if (own) empty.push(...res.empty)
    fetched.set(a.id, { app, reviews: res.reviews })
  }
  const gone = { added: 0, updated: 0, total: 0, failed, empty, incomplete, outage, deleted: true }
  let cur = getProject(id)
  if (!cur) return gone
  const existing = await getReviews(cur)
  cur = getProject(id)
  if (!cur) return gone
  let all = existing, added = 0, updated = 0
  for (const a of cur.apps) {
    const f = fetched.get(a.id)
    if (!f) continue
    const m = mergeReviews(all, f.reviews)
    all = m.reviews
    added += m.added
    updated += m.updated
  }
  await putData(id, all)
  cur = getProject(id)
  if (!cur) { await delData(id); return gone }
  const versions = { ...cur.versions }
  for (const a of cur.apps) if (fetched.has(a.id)) versions[a.id] = mergeVersions(versions[a.id] ?? [], lookupVersion(fetched.get(a.id)!.app))
  // A fetch that brought nothing during a feed outage is not a fetch: keep the last good time and history.
  const p = { ...cur, versions, apps: cur.apps.map(a => fetched.get(a.id)?.app ?? a), lastFetch: outage && !added ? cur.lastFetch : Date.now() }
  // History only gets a new entry when the review set changed.
  if (added || updated || !p.snapshots.length && all.length) p.snapshots = [...p.snapshots, makeSnapshot(p, all, `Fetch ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`, Date.now())]
  await saveProject(p)
  bumpData()
  return { added, updated, total: all.length, failed, empty, incomplete, outage, deleted: false }
}

export function makeSnapshot(p: Project, reviews: Review[], label: string, at: number): Snapshot {
  const appId = p.apps[0]?.id ?? 'imported'
  const rs = reviews.filter(r => r.appId === appId)
  const versions = buildVersions(rs, p.versions[appId] ?? [])
  const s = summarize(rs)
  return {
    id: uuid(), label, createdAt: at, appId, latest: versions.length ? versions[versions.length - 1].version : null, n: s.n, mean: s.mean,
    themes: themeStats(rs, p.rules).map(t => ({ id: t.id, label: t.label, n: t.n, share: t.share })),
    versions: seriesByVersion(rs, versions).map(v => ({ version: v.version, n: v.n, mean: v.mean })),
  }
}

export interface Filters { countries: string[] }

/** Everything the views need for one app. */
export function analyze(p: Project | undefined, reviews: Review[] | null, appId?: string, countries?: string[]) {
  {
    if (!p || !reviews) return null
    const found = p.apps.find(a => a.id === appId) ?? p.apps[0]
    // Rebuilt rather than read, so it follows the project's name.
    const app = found && isStoreApp(found) ? found : importedApp(p)
    const appReviews = reviews.filter(r => r.appId === app.id)
    const rs = countries?.length ? appReviews.filter(r => countries.includes(r.country)) : appReviews
    const versions = buildVersions(appReviews, p.versions[app.id] ?? [])
    const series = seriesByVersion(rs, versions)
    const latest = series.length ? series[series.length - 1].version : null
    const themesOf = new Map(rs.map(r => [r, classify(r, p.rules)]))
    return {
      app, reviews: rs, allReviews: appReviews, versions, series, latest,
      summary: summarize(rs),
      impact: releaseImpact(rs, versions),
      byCountry: versionByCountry(appReviews),
      weekly: weekly(rs),
      themes: themeStats(rs, p.rules),
      themesOf: (r: Review) => themesOf.get(r) ?? classify(r, p.rules),
      emerging: latest ? emergingThemes(rs, p.rules, latest) : [],
      clusters: clusters(rs, 8, 3, app.name),
      requests: groupRequests(featureRequests(rs)),
      fix: whatToFix(rs, p.rules, latest),
    }
  }
}
/** Import-only projects have no App Store app; their reviews are stored under the id 'imported'. With competitors, this stands in as the first app. */
export const IMPORTED = 'imported'
export const isStoreApp = (a: AppInfo) => a.id !== IMPORTED
export const importedApp = (p: Project): AppInfo => ({ id: IMPORTED, name: p.name, developer: 'Imported reviews', icon: '', genre: '', version: '', releaseNotes: '', currentVersionReleaseDate: '', rating: null, ratingCount: null, currentVersionRating: null, currentVersionRatingCount: null, url: '' })

export type Analysis = NonNullable<ReturnType<typeof analyze>>

export function useAnalysis(p: Project | undefined, reviews: Review[] | null, appId?: string, countries?: string[]) {
  return useMemo(() => analyze(p, reviews, appId, countries), [p?.apps, p?.rules, p?.versions, reviews, appId, countries?.join()])
}

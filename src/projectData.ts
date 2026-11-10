import { useEffect, useMemo, useState } from 'react'
import { buildVersions, cmpVersion, mergeReviews } from './engine/reviews.ts'
import { SAMPLES, sampleReviews } from './engine/sample.ts'
import { releaseImpact, seriesByVersion, summarize, versionByCountry, weekly } from './engine/stats.ts'
import { classify, clusters, emergingThemes, featureRequests, groupRequests, themeStats, whatToFix } from './engine/themes.ts'
import type { AppInfo, Review, VersionInfo } from './engine/types.ts'
import { fetchReviews, lookupApp, type FetchProgress } from './live.ts'
import { blankProject, getData, getDefaults, getProject, putData, saveProject, uuid, type Project, type Snapshot } from './store.ts'

const dataSubs = new Set<() => void>()
let dataTick = 0
export const bumpData = () => { dataTick++; dataSubs.forEach(f => f()) }

export async function getReviews(p: Project): Promise<Review[]> {
  return p.sampleId ? sampleReviews(p.sampleId) : (await getData(p.id)) ?? []
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

/** Refreshes app metadata and pulls the latest reviews for every app in the project, then saves a snapshot. */
export async function runFetch(id: string, onProgress?: (label: string, p: FetchProgress) => void, signal?: AbortSignal) {
  let p = getProject(id)!
  const pages = getDefaults().pages
  const existing = await getReviews(p)
  let all = existing
  let added = 0
  const failed: string[] = []
  const apps: AppInfo[] = []
  for (const [i, a] of p.apps.entries()) {
    const fresh = await lookupApp(a.id, p.countries[0], signal).catch(() => null)
    const app = fresh ?? a
    apps.push(app)
    p = { ...p, versions: { ...p.versions, [app.id]: mergeVersions(p.versions[app.id] ?? [], lookupVersion(app)) } }
    // Competitors get fewer pages to keep the fetch quick.
    const res = await fetchReviews(app.id, p.countries, i === 0 ? pages : Math.min(pages, 4), pr => onProgress?.(app.name, pr), signal)
    failed.push(...res.failed.map(c => `${app.name} (${c.toUpperCase()})`))
    const m = mergeReviews(all, res.reviews)
    all = m.reviews
    added += m.added
  }
  await putData(id, all)
  p = { ...p, apps, lastFetch: Date.now() }
  p.snapshots = [...p.snapshots, makeSnapshot(p, all, `Fetch ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`, Date.now())]
  await saveProject(p)
  bumpData()
  return { added, total: all.length, failed }
}

export function makeSnapshot(p: Project, reviews: Review[], label: string, at: number): Snapshot {
  const app = p.apps[0]
  const rs = reviews.filter(r => r.appId === app?.id)
  const versions = buildVersions(rs, p.versions[app?.id] ?? [])
  const s = summarize(rs)
  return {
    id: uuid(), label, createdAt: at, appId: app?.id ?? '', latest: versions.length ? versions[versions.length - 1].version : null, n: s.n, mean: s.mean,
    themes: themeStats(rs, p.rules).map(t => ({ id: t.id, label: t.label, n: t.n, share: t.share })),
    versions: seriesByVersion(rs, versions).map(v => ({ version: v.version, n: v.n, mean: v.mean })),
  }
}

export interface Filters { countries: string[] }

/** Everything the views need for one app. */
export function analyze(p: Project | undefined, reviews: Review[] | null, appId?: string, countries?: string[]) {
  {
    if (!p || !reviews) return null
    const app = p.apps.find(a => a.id === appId) ?? p.apps[0]
    if (!app) return null
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
      clusters: clusters(rs),
      requests: groupRequests(featureRequests(rs)),
      fix: whatToFix(rs, p.rules, latest),
    }
  }
}
export type Analysis = NonNullable<ReturnType<typeof analyze>>

export function useAnalysis(p: Project | undefined, reviews: Review[] | null, appId?: string, countries?: string[]) {
  return useMemo(() => analyze(p, reviews, appId, countries), [p?.apps, p?.rules, p?.versions, reviews, appId, countries?.join()])
}

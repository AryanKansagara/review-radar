// Rating statistics: Wilson intervals, bootstrap intervals, series and release impact.
import { cmpVersion } from './reviews.ts'
import type { Review, VersionInfo } from './types.ts'

/** Wilson score interval for k successes out of n (95% by default). */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1]
  const p = k / n, z2 = z * z
  const c = (p + z2 / (2 * n)) / (1 + z2 / n)
  const h = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n)
  return [Math.max(0, c - h), Math.min(1, c + h)]
}

/** Small seeded PRNG so bootstrap results are reproducible between renders and in tests. */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const mean = (xs: number[]) => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN

/** Resampled mean of a 1-5 rating sample, using counts so it is O(n) per draw without copying. */
function resampleMean(counts: number[], n: number, r: () => number): number {
  // Inverse CDF draw over the 5 rating buckets.
  const cdf: number[] = []
  let acc = 0
  for (const c of counts) { acc += c / n; cdf.push(acc) }
  let s = 0
  for (let i = 0; i < n; i++) {
    const u = r()
    let k = 0
    while (k < 4 && u > cdf[k]) k++
    s += k + 1
  }
  return s / n
}

const ratingCounts = (rs: number[]) => { const c = [0, 0, 0, 0, 0]; for (const x of rs) c[x - 1]++; return c }

/** 95% percentile bootstrap interval for the mean rating. */
export function bootstrapMean(ratings: number[], iters = 800, seed = 7): [number, number] {
  const n = ratings.length
  if (n < 2) return [1, 5]
  const counts = ratingCounts(ratings), r = rng(seed)
  const ms = Array.from({ length: iters }, () => resampleMean(counts, n, r)).sort((a, b) => a - b)
  return [ms[Math.floor(iters * 0.025)], ms[Math.ceil(iters * 0.975) - 1]]
}

/** 95% bootstrap interval for mean(after) - mean(before). */
export function bootstrapDiff(before: number[], after: number[], iters = 800, seed = 11): [number, number] {
  if (before.length < 2 || after.length < 2) return [-4, 4]
  const cb = ratingCounts(before), ca = ratingCounts(after), r = rng(seed)
  const ds = Array.from({ length: iters }, () => resampleMean(ca, after.length, r) - resampleMean(cb, before.length, r)).sort((a, b) => a - b)
  return [ds[Math.floor(iters * 0.025)], ds[Math.ceil(iters * 0.975) - 1]]
}

export interface Group {
  n: number
  mean: number
  ci: [number, number]
  oneStar: number
  oneStarCi: [number, number]
  dist: number[]
}

export function summarize(reviews: Review[]): Group {
  const rs = reviews.map(r => r.rating)
  const ones = rs.filter(x => x === 1).length
  return { n: rs.length, mean: mean(rs), ci: bootstrapMean(rs), oneStar: rs.length ? ones / rs.length : 0, oneStarCi: wilson(ones, rs.length), dist: ratingCounts(rs) }
}

export interface VersionPoint extends Group { version: string; date: string }

/** Mean rating per version (only versions with reviews), in version order. */
export function seriesByVersion(reviews: Review[], versions: VersionInfo[]): VersionPoint[] {
  const by = groupBy(reviews, r => r.version)
  return versions.filter(v => by.has(v.version)).map(v => ({ version: v.version, date: v.date, ...summarize(by.get(v.version)!) }))
}

export interface CountryCell { version: string; country: string; n: number; mean: number }
export function versionByCountry(reviews: Review[]): CountryCell[] {
  const by = groupBy(reviews, r => `${r.version}|${r.country}`)
  return [...by].map(([k, rs]) => { const [version, country] = k.split('|'); return { version, country, n: rs.length, mean: mean(rs.map(r => r.rating)) } })
    .sort((a, b) => cmpVersion(a.version, b.version) || a.country.localeCompare(b.country))
}

/** Mean rating per ISO week (Monday start). */
export function weekly(reviews: Review[]): { week: string; n: number; mean: number }[] {
  const by = groupBy(reviews, r => weekStart(r.date))
  return [...by].map(([week, rs]) => ({ week, n: rs.length, mean: mean(rs.map(r => r.rating)) })).sort((a, b) => a.week.localeCompare(b.week))
}
export function weekStart(iso: string): string {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

export type Verdict = 'worse' | 'better' | 'no clear change' | 'too few reviews'
export interface Impact {
  version: string
  prev: string
  date: string
  before: Group
  after: Group
  diff: number
  diffCi: [number, number]
  oneStarDiff: number
  verdict: Verdict
}

export const MIN_N = 8

/** Reviews needed in the baseline before pooling stops; apps that ship weekly have few reviews per build. */
export const BASELINE_N = 30

/**
 * Each version against a baseline of the versions just before it: the previous version alone if it
 * has BASELINE_N reviews, otherwise pooled with earlier ones (up to 5 versions). Verdict only when the
 * 95% interval of the difference excludes zero and both sides have MIN_N reviews.
 */
export function releaseImpact(reviews: Review[], versions: VersionInfo[]): Impact[] {
  const by = groupBy(reviews, r => r.version)
  const vs = versions.filter(v => by.has(v.version))
  const out: Impact[] = []
  for (let i = 1; i < vs.length; i++) {
    const b: Review[] = []
    let j = i - 1
    for (; j >= 0 && j >= i - 5; j--) { b.push(...by.get(vs[j].version)!); if (b.length >= BASELINE_N) break }
    const first = Math.max(j, 0, i - 5)
    const prev = first === i - 1 ? vs[i - 1].version : `${vs[first].version}–${vs[i - 1].version}`
    const a = by.get(vs[i].version)!
    const before = summarize(b), after = summarize(a)
    const diffCi = bootstrapDiff(b.map(r => r.rating), a.map(r => r.rating))
    const verdict: Verdict = before.n < MIN_N || after.n < MIN_N ? 'too few reviews' : diffCi[1] < 0 ? 'worse' : diffCi[0] > 0 ? 'better' : 'no clear change'
    out.push({ version: vs[i].version, prev, date: vs[i].date, before, after, diff: after.mean - before.mean, diffCi, oneStarDiff: after.oneStar - before.oneStar, verdict })
  }
  return out
}

/** What the timeline draws: the latest `max` versions with at least `minN` reviews (all versions if none qualify). */
export function displaySeries<T extends { n: number }>(series: T[], max = 12, minN = 5): T[] {
  const ok = series.filter(s => s.n >= minN)
  return (ok.length ? ok : series).slice(-max)
}

export function groupBy<T>(xs: T[], f: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const x of xs) { const k = f(x); const l = m.get(k); if (l) l.push(x); else m.set(k, [x]) }
  return m
}

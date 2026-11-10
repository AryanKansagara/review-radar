// Theme extraction without paid APIs: a curated, user-editable taxonomy plus TF-IDF term clusters.
import { cmpVersion } from './reviews.ts'
import type { Review, ThemeRule } from './types.ts'

export const DEFAULT_RULES: ThemeRule[] = [
  { id: 'crash', label: 'Crashes', keywords: ['crash', 'crashes', 'crashing', 'crashed', 'force close', 'closes itself', 'quits', 'freezes', 'frozen', 'wont open', "won't open", 'will not open', 'not opening', 'black screen', 'white screen'] },
  { id: 'login', label: 'Login and account', keywords: ['login', 'log in', 'logged out', 'sign in', 'signin', 'password', 'account locked', 'verification code', '2fa', 'cant log', "can't log", 'locked out'] },
  { id: 'paywall', label: 'Subscription and paywall', keywords: ['subscription', 'subscribe', 'paywall', 'premium', 'paid', 'pay for', 'price', 'pricing', 'expensive', 'charged', 'refund', 'free trial', 'trial', 'money grab', 'cash grab', 'per month', 'per year', 'lifetime'] },
  { id: 'ads', label: 'Ads', keywords: ['ads', 'ad', 'advert', 'adverts', 'advertisement', 'advertisements', 'commercial', 'commercials', 'pop up', 'popup', 'pop-ups'] },
  { id: 'sync', label: 'Sync and data loss', keywords: ['sync', 'syncing', 'icloud', 'backup', 'restore', 'lost my data', 'lost all', 'data loss', 'disappeared', 'deleted my', 'gone', 'across devices'] },
  { id: 'battery', label: 'Battery and heat', keywords: ['battery', 'drain', 'drains', 'draining', 'overheat', 'overheating', 'hot', 'heats up'] },
  { id: 'ui', label: 'UI change', keywords: ['new design', 'redesign', 'new ui', 'new layout', 'new update', 'bring back', 'old version', 'old design', 'confusing', 'cluttered', 'interface', 'layout', 'harder to find', 'moved'] },
  { id: 'missing', label: 'Missing feature', keywords: ['please add', 'wish', 'would be great', 'would be nice', 'feature request', 'missing', 'no option', 'needs a', 'should have', 'dark mode', 'widget', 'apple watch', 'ipad version', 'export'] },
  { id: 'performance', label: 'Performance', keywords: ['slow', 'laggy', 'lag', 'lags', 'sluggish', 'loading', 'takes forever', 'spinning', 'unresponsive', 'stutter'] },
  { id: 'update-bug', label: 'Bug after update', keywords: ['since the update', 'since update', 'after the update', 'after update', 'after updating', 'latest update', 'last update', 'recent update', 'new version', 'this update', 'broke', 'broken', 'stopped working', 'no longer works', 'doesnt work anymore', "doesn't work anymore"] },
].map(r => ({ ...r, builtin: true, enabled: true }))

const STOP = new Set(('a an and are as at be been but by can could did do does dont doesnt for from get got had has have having he her his how i if im in into is it its ive just me more most my no not now of on once only or other our out over own same she should so some still such than that the their them then there these they this those to too very was way we were what when where which while who why will with would you your app apps really even also all any one get use using used much like ill youre theyre cant wont isnt wasnt didnt thing things every lot lots make made new time ever back give gave star stars review update version please thanks thank good great love bad').split(' '))

export function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !/^\d+$/.test(w))
}

const norm = (s: string) => ' ' + tokenize(s).join(' ') + ' '
const kwCache = new Map<string, string>()
const kw = (k: string) => { let v = kwCache.get(k); if (v === undefined) { v = ' ' + tokenize(k).join(' ') + ' '; kwCache.set(k, v) } return v }

/** Theme ids that match a review (title + body), in rule order. */
export function classify(r: Pick<Review, 'title' | 'body'>, rules: ThemeRule[]): string[] {
  const t = norm(`${r.title} ${r.body}`)
  return rules.filter(x => x.enabled && x.keywords.some(k => kw(k).trim() && t.includes(kw(k)))).map(x => x.id)
}

/** Which keywords matched, for explaining a classification in the UI. */
export function matchedKeywords(r: Pick<Review, 'title' | 'body'>, rule: ThemeRule): string[] {
  const t = norm(`${r.title} ${r.body}`)
  return rule.keywords.filter(k => kw(k).trim() && t.includes(kw(k)))
}

export interface ThemeStat {
  id: string
  label: string
  n: number
  share: number
  mean: number
  /** Mean rating of reviews without the theme minus mean with it: how many stars the theme costs. */
  impact: number
  examples: Review[]
}

export function themeStats(reviews: Review[], rules: ThemeRule[]): ThemeStat[] {
  const tagged = reviews.map(r => ({ r, t: classify(r, rules) }))
  return rules.filter(x => x.enabled).map(rule => {
    const inT = tagged.filter(x => x.t.includes(rule.id)).map(x => x.r)
    const outT = tagged.filter(x => !x.t.includes(rule.id)).map(x => x.r)
    const m = avg(inT.map(r => r.rating)), mo = avg(outT.map(r => r.rating))
    return {
      id: rule.id, label: rule.label, n: inT.length, share: reviews.length ? inT.length / reviews.length : 0,
      mean: m, impact: inT.length && outT.length ? mo - m : 0,
      examples: [...inT].sort((a, b) => a.rating - b.rating || b.body.length - a.body.length).slice(0, 3),
    }
  }).filter(s => s.n > 0).sort((a, b) => b.n - a.n)
}

const avg = (xs: number[]) => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0

export interface Emerging { id: string; label: string; latest: number; before: number; lift: number; n: number }

/**
 * Themes whose share in the latest version is well above their share across earlier versions.
 * Requires at least 3 mentions and a 1.5x lift (or new from zero).
 */
export function emergingThemes(reviews: Review[], rules: ThemeRule[], latest: string): Emerging[] {
  const now = reviews.filter(r => r.version === latest)
  const prev = reviews.filter(r => r.version !== latest && cmpVersion(r.version, latest) < 0)
  if (!now.length) return []
  const share = (rs: Review[], id: string) => rs.length ? rs.filter(r => classify(r, rules).includes(id)).length / rs.length : 0
  return rules.filter(x => x.enabled).map(rule => {
    const n = now.filter(r => classify(r, rules).includes(rule.id)).length
    const latestShare = n / now.length, before = share(prev, rule.id)
    return { id: rule.id, label: rule.label, latest: latestShare, before, lift: before ? latestShare / before : latestShare ? Infinity : 0, n }
  }).filter(e => e.n >= 3 && e.latest - e.before >= 0.05 && (e.before === 0 || e.lift >= 1.5)).sort((a, b) => (b.latest - b.before) - (a.latest - a.before))
}

// ---------- TF-IDF term clusters ----------

/** Unigrams and bigrams after stopword removal. */
export function terms(text: string): string[] {
  const w = tokenize(text).filter(x => !STOP.has(x))
  const out = [...w]
  for (let i = 0; i + 1 < w.length; i++) out.push(`${w[i]} ${w[i + 1]}`)
  return out
}

export interface Cluster { terms: string[]; n: number; mean: number; reviews: Review[] }

/**
 * Greedy clustering: score terms by TF-IDF summed over low-rated reviews, then group reviews
 * by their highest-scoring term. Terms already covered by an earlier cluster are skipped, and
 * each cluster label adds the strongest co-occurring terms.
 */
export function clusters(reviews: Review[], k = 8, maxRating = 3): Cluster[] {
  const docs = reviews.map(r => ({ r, t: new Set(terms(`${r.title} ${r.body}`)) }))
  const N = docs.length
  if (!N) return []
  const df = new Map<string, number>()
  for (const d of docs) for (const t of d.t) df.set(t, (df.get(t) ?? 0) + 1)
  const score = new Map<string, number>()
  for (const d of docs) {
    if (d.r.rating > maxRating) continue
    for (const t of d.t) {
      const f = df.get(t)!
      if (f < 2) continue
      // Bigrams carry more meaning per mention.
      score.set(t, (score.get(t) ?? 0) + Math.log(N / f) * (t.includes(' ') ? 1.6 : 1))
    }
  }
  const ranked = [...score].sort((a, b) => b[1] - a[1]).map(x => x[0])
  const used = new Set<Review>()
  const out: Cluster[] = []
  for (const t of ranked) {
    if (out.length >= k) break
    const members = docs.filter(d => d.t.has(t) && !used.has(d.r) && d.r.rating <= maxRating)
    if (members.length < 2) continue
    members.forEach(d => used.add(d.r))
    const co = new Map<string, number>()
    for (const d of members) for (const x of d.t) if (x !== t && !t.includes(x) && !x.includes(t)) co.set(x, (co.get(x) ?? 0) + 1)
    const extra = [...co].filter(x => x[1] >= Math.max(2, members.length * 0.3)).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0])
    out.push({ terms: [t, ...extra], n: members.length, mean: avg(members.map(d => d.r.rating)), reviews: members.map(d => d.r) })
  }
  return out
}

// ---------- Feature requests ----------

const REQ = /\b(?:please (?:add|bring back|make|let|allow|give|consider)|i wish|wish (?:it|there|you|they)|would (?:be|love) (?:great|nice|awesome|amazing|cool|helpful) if|would love (?:to see|it if|a|an)|it would be (?:great|nice|awesome|helpful)|feature request|can you (?:please )?add|could you (?:please )?add|needs? (?:an? |the )?option|should (?:have|add)|hoping for|bring back)\b[^.!?\n]*/i

export interface Request { text: string; review: Review }

/** Sentences that ask for something, from any rating. */
export function featureRequests(reviews: Review[]): Request[] {
  const out: Request[] = []
  for (const r of reviews) {
    for (const s of `${r.title}. ${r.body}`.split(/(?<=[.!?\n])\s+/)) {
      const m = s.match(REQ)
      if (m) { out.push({ text: s.trim().replace(/^\W+/, '').slice(0, 220), review: r }); break }
    }
  }
  return out
}

/** Groups requests by their most informative term so "dark mode" asked ten ways shows once. */
export function groupRequests(reqs: Request[]): { topic: string; n: number; examples: Request[] }[] {
  const by = new Map<string, Request[]>()
  const df = new Map<string, number>()
  const ts = reqs.map(q => terms(q.text).filter(t => !/^(add|wish|option|feature|request|bring|hoping|great|nice|able|love|see|would|could)$/.test(t)))
  for (const t of ts) for (const x of new Set(t)) df.set(x, (df.get(x) ?? 0) + 1)
  reqs.forEach((q, i) => {
    const best = [...new Set(ts[i])].sort((a, b) => (df.get(b)! + (b.includes(' ') ? 0.5 : 0)) - (df.get(a)! + (a.includes(' ') ? 0.5 : 0)))[0] ?? 'other'
    const topic = (df.get(best) ?? 0) >= 2 ? best : 'other'
    by.set(topic, [...(by.get(topic) ?? []), q])
  })
  return [...by].map(([topic, l]) => ({ topic, n: l.length, examples: l.slice(0, 4) })).sort((a, b) => (a.topic === 'other' ? 1 : 0) - (b.topic === 'other' ? 1 : 0) || b.n - a.n)
}

// ---------- What to fix next ----------

export interface FixItem { id: string; label: string; n: number; impact: number; score: number; trend: number; why: string }

/** Ranked by mentions x stars lost, boosted when the theme is growing in the latest version. */
export function whatToFix(reviews: Review[], rules: ThemeRule[], latest: string | null): FixItem[] {
  const stats = themeStats(reviews, rules)
  const emerging = latest ? emergingThemes(reviews, rules, latest) : []
  return stats.filter(s => s.impact > 0 && s.id !== 'missing').map(s => {
    const e = emerging.find(x => x.id === s.id)
    const trend = e ? e.latest - e.before : 0
    const score = s.n * s.impact * (1 + trend * 4)
    const why = `${s.n} reviews, ${s.impact.toFixed(1)} stars below the rest${e ? `, up ${Math.round(trend * 100)} points in ${latest}` : ''}`
    return { id: s.id, label: s.label, n: s.n, impact: s.impact, score, trend, why }
  }).sort((a, b) => b.score - a.score)
}

const FIXED: Record<string, string> = {
  crash: 'Fixed a crash some people saw when opening the app',
  login: 'Fixed an issue that could sign you out or block sign-in',
  paywall: 'Made plans and pricing clearer, and kept the core features free',
  ads: 'Reduced how often ads appear',
  sync: 'Improved sync reliability so your data stays up to date on every device',
  battery: 'Reduced battery use in the background',
  ui: 'Refined the new design based on your feedback',
  performance: 'Faster loading and smoother scrolling',
  'update-bug': 'Fixed issues introduced in the last update',
}

/** "Fixed: ..." lines for the themes the user marks as addressed. */
export function releaseNotes(items: { id: string; label: string }[], countries: string[] = []): string {
  const lines = items.map(i => `• ${FIXED[i.id] ?? `Fixed: ${i.label.toLowerCase()} issues reported in reviews`}`)
  if (!lines.length) return ''
  const where = countries.length === 1 ? ` in ${countries[0].toUpperCase()}` : ''
  return `What's new\n\n${lines.join('\n')}\n\nThank you for every review${where}. We read them all.`
}

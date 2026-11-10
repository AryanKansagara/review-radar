import { useEffect, useMemo, useRef, useState } from 'react'
import { buildVersions, parseAppRef } from './engine/reviews.ts'
import { SAMPLES, sampleReviews } from './engine/sample.ts'
import { displaySeries, releaseImpact, seriesByVersion } from './engine/stats.ts'
import { DEFAULT_RULES, themeStats } from './engine/themes.ts'
import type { AppInfo, Review } from './engine/types.ts'
import { fetchReviews, lookupApp, searchApps } from './live.ts'
import { createAppProject, createSampleProject } from './projectData.ts'
import { ThemeBubbles, Timeline } from './Charts.tsx'
import { fmtDate, fmtPct, go, Link, Stars, SyntheticBadge, toast } from './ui.tsx'

const EXAMPLES: [string, string][] = [['Duolingo', '570060128'], ['Strava', '426826309'], ['Notion', '1232780281'], ['Spotify', '324684580']]

interface HeroData { app: AppInfo; reviews: Review[]; synthetic: boolean; country: string }

function sampleHero(): HeroData {
  const s = SAMPLES[0]
  return { app: s.app, reviews: sampleReviews(s.id).filter(r => r.appId === s.app.id), synthetic: true, country: 'us' }
}

function HeroRadar() {
  const [data, setData] = useState<HeroData>(sampleHero)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const ctl = useRef<AbortController | null>(null)

  const versions = useMemo(() => buildVersions(data.reviews, data.synthetic ? SAMPLES[0].versions : []), [data])
  const series = useMemo(() => displaySeries(seriesByVersion(data.reviews, versions), 8), [data, versions])
  const impact = useMemo(() => releaseImpact(data.reviews, versions), [data, versions])
  // Default to the most recent release that hurt, else the latest.
  const worst = impact.filter(i => i.verdict === 'worse' && series.some(s => s.version === i.version)).pop()
  const active = sel && series.some(s => s.version === sel) ? sel : worst?.version ?? series[series.length - 1]?.version ?? null
  const point = series.find(s => s.version === active)
  const imp = impact.find(i => i.version === active)
  const themes = useMemo(() => themeStats(data.reviews.filter(r => r.version === active), DEFAULT_RULES), [data, active])

  const run = async (input: string) => {
    const t = input.trim()
    if (!t) return
    ctl.current?.abort()
    const c = new AbortController()
    ctl.current = c
    setErr(null)
    try {
      const ref = parseAppRef(t)
      setBusy('Looking up the app')
      const app = ref ? await lookupApp(ref.id, ref.country, c.signal) : (await searchApps(t, 'us', c.signal))[0] ?? null
      if (!app) throw new Error(ref ? 'No app with that id in this storefront.' : `No App Store app matches "${t}".`)
      const country = ref?.country ?? 'us'
      setBusy(`Reading recent ${app.name} reviews`)
      const cs = [...new Set([country, 'us', 'gb'])].slice(0, 2)
      const { reviews } = await fetchReviews(app.id, cs, 4, pr => setBusy(`Reading reviews · ${pr.reviews} so far`), c.signal)
      if (!reviews.length) throw new Error(`${app.name} has no recent written reviews in ${cs.join(', ').toUpperCase()}.`)
      setSel(null)
      setData({ app, reviews, synthetic: false, country })
    } catch (e) {
      if (c.signal.aborted) return
      setErr(`${e instanceof Error ? e.message : String(e)} Showing the synthetic sample instead.`)
      setData(sampleHero())
    } finally {
      if (!c.signal.aborted) setBusy(null)
    }
  }

  const open = async () => {
    if (data.synthetic) { const p = await createSampleProject('habit'); go(`/app/p/${p.id}`); return }
    const p = await createAppProject(data.app, data.country)
    toast(`Created a project for ${data.app.name}. Fetching every country you track.`)
    go(`/app/p/${p.id}/data?fetch=1`)
  }

  return (
    <div className="radar card">
      <form className="radar-form" onSubmit={e => { e.preventDefault(); void run(q) }}>
        <label htmlFor="hero-q" className="sr-only">App Store link, app id or app name</label>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input id="hero-q" value={q} onChange={e => setQ(e.target.value)} placeholder="Paste an App Store link, or type an app name" autoComplete="off" spellCheck={false} />
        <button className="btn primary sm" disabled={!!busy}>{busy ? 'Reading' : 'Analyse'}</button>
      </form>
      <div className="radar-examples">
        <span className="muted small">Try</span>
        {EXAMPLES.map(([n, id]) => <button key={id} type="button" className="chip-btn" onClick={() => { setQ(`https://apps.apple.com/us/app/id${id}`); void run(id) }}>{n}</button>)}
      </div>

      <div className="radar-head" aria-live="polite">
        {data.app.icon ? <img src={data.app.icon} alt="" width="44" height="44" className="app-icon" /> : <span className="app-icon ph" aria-hidden="true">{data.app.name[0]}</span>}
        <div className="grow">
          <div className="radar-title">{data.app.name} {data.synthetic && <SyntheticBadge />}</div>
          <div className="muted small">{data.app.developer} · {data.reviews.length} recent reviews{data.app.rating ? <> · <Stars value={data.app.rating} size={12} /> {data.app.rating.toFixed(1)} all time</> : null}</div>
        </div>
        {busy && <span className="spinner" role="status" aria-label={busy} />}
      </div>
      {busy && <p className="muted small radar-busy">{busy}</p>}
      {err && <p className="error small" role="alert">{err}</p>}

      <div className={`radar-body${busy ? ' dim' : ''}`}>
        <Timeline series={series} impact={impact} selected={active} onSelect={setSel} height={230} compact />
        <div className="radar-split">
          <div className="radar-stats">
            {point && <>
              <div className="eyebrow">Version {point.version}</div>
              <div className="big-num">{point.mean.toFixed(2)}<small>★</small></div>
              <div className="muted small">{point.n} reviews · since {fmtDate(point.date)}</div>
              {imp && <p className={`verdict-line ${imp.verdict.replace(/ /g, '-')}`}>
                {imp.verdict === 'worse' ? `Down ${Math.abs(imp.diff).toFixed(2)} stars vs ${imp.prev}` : imp.verdict === 'better' ? `Up ${imp.diff.toFixed(2)} stars vs ${imp.prev}` : imp.verdict === 'too few reviews' ? `Too few reviews to compare with ${imp.prev}` : `No clear change vs ${imp.prev}`}
                <span className="muted small"> 95% CI {imp.diffCi[0].toFixed(2)} to {imp.diffCi[1].toFixed(2)} · one-star {fmtPct(imp.before.oneStar)} → {fmtPct(imp.after.oneStar)}</span>
              </p>}
            </>}
          </div>
          <ThemeBubbles items={themes.filter(t => t.id !== 'missing').map(t => ({ id: t.id, label: t.label, n: t.n, mean: t.mean }))} width={330} height={190} />
        </div>
      </div>
      <div className="row between wrap gap-sm radar-foot">
        <span className="muted small">{data.synthetic ? 'Synthetic habit tracker. Paste any real app above for live data.' : `Live from the public App Store feed, ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.`}</span>
        <button type="button" className="btn ghost sm" onClick={() => void open()}>Open as a project →</button>
      </div>
    </div>
  )
}

const EVIDENCE = [
  ['r/appledevelopers', 'How is everyone actually tracking App Store reviews? Checking Connect by hand every morning is not a system.', 'One place that pulls every storefront, dedupes, and keeps history.'],
  ['r/appledevelopers', 'The App Store Connect analytics overview changed and now it makes no sense to me.', 'Rating by version, with intervals, so a dip reads as a fact or as noise.'],
  ['r/SaaS', 'Someone analysed 50,000 App Store reviews to find the most common complaints.', 'Theme extraction on your own reviews, free, in the browser.'],
  ['r/AppBusiness', 'One minor update and a reviewer basically killed the app.', 'Release impact flags the version that hurt, and what people said about it.'],
]

export function Landing() {
  useEffect(() => { document.title = 'Review Radar: what changed in your App Store reviews after each release' }, [])
  return (
    <>
      <section className="hero">
        <p className="eyebrow center">For indie iOS developers</p>
        <h1>Your rating dropped.<br /><span className="grad">Find out which release did it.</span></h1>
        <p className="lede center">Review Radar pulls any app’s public App Store reviews, shows the rating for every version with real confidence intervals, groups complaints into themes, and drafts the replies and release notes.</p>
        <div className="row gap center-x wrap hero-cta">
          <Link href="/app" className="btn primary lg">Open Review Radar</Link>
          <Link href="/docs" className="btn link lg">How it works ›</Link>
        </div>
        <HeroRadar />
      </section>

      <section className="band">
        <div className="container">
          <h2 className="center">Heard from developers</h2>
          <p className="muted center">Paraphrased from public threads.</p>
          <div className="evidence">
            {EVIDENCE.map(([src, quote, tie]) => (
              <figure key={quote} className="card ev">
                <figcaption className="muted small">{src}</figcaption>
                <blockquote>{quote}</blockquote>
                <p className="ev-tie">{tie}</p>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section className="container features">
        <h2 className="center">From “the rating dropped” to the fix, in one sitting.</h2>
        <div className="bento">
          <article className="tile t-wide"><h3>Release impact</h3><p>Mean rating and one-star share before and after every version, with bootstrap and Wilson 95% intervals. Small samples say “too few reviews” instead of guessing.</p></article>
          <article className="tile"><h3>Themes</h3><p>Crashes, paywall, login, sync, ads and six more, from a taxonomy you can edit. Plus TF-IDF clusters for what the taxonomy missed.</p></article>
          <article className="tile"><h3>Emerging</h3><p>A theme whose share jumps in the latest release is flagged before it costs you a star.</p></article>
          <article className="tile"><h3>What to fix next</h3><p>Ranked by mentions × stars lost, boosted when it is growing.</p></article>
          <article className="tile t-wide"><h3>Replies and release notes</h3><p>Drafts for each review by theme, checked against the 5,970 character limit and Apple’s guidance, ready to paste into App Store Connect. “Fixed:” lines for your next What’s New.</p></article>
          <article className="tile"><h3>Competitors</h3><p>Add rival apps to a project and compare themes side by side.</p></article>
          <article className="tile"><h3>History</h3><p>Every fetch is a snapshot. Compare any two and see which themes are new.</p></article>
          <article className="tile t-wide"><h3>Yours, local first</h3><p>No key, no account needed. Sign in only if you want sync across devices.</p></article>
        </div>
        <div className="row gap center-x wrap cta-end">
          <Link href="/app?sample=habit" className="btn primary">Try the sample</Link>
          <Link href="/app?import=1" className="btn ghost">Import your reviews</Link>
        </div>
      </section>
    </>
  )
}

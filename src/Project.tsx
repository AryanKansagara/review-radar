import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { countryName } from './engine/reviews.ts'
import { MIN_N } from './engine/stats.ts'
import type { AppInfo } from './engine/types.ts'
import { CountryHeat, Dist, ThemeBubbles, Timeline } from './Charts.tsx'
import { analyze, bumpData, getReviews, makeSnapshot, useAnalysis, useReviews, type Analysis } from './projectData.ts'
import { getProject, putData, saveProject, update, useProjects, type Project } from './store.ts'
import { deleteSnapshotCloud } from './sync.ts'
import { Empty, fmtDate, fmtPct, go, Link, NotFound, signed, Stars, SyntheticBadge, toast } from './ui.tsx'
import { AppPicker } from './Workspace.tsx'

const Insights = lazy(() => import('./Insights.tsx'))
const Data = lazy(() => import('./Data.tsx'))

const TABS = [['overview', 'Overview'], ['themes', 'Themes'], ['reviews', 'Reviews'], ['actions', 'Actions'], ['compare', 'Compare'], ['history', 'History'], ['data', 'Data']] as const


export default function ProjectView({ id, tab }: { id: string; tab: string }) {
  const list = useProjects()
  const p = list?.find(x => x.id === id)
  const reviews = useReviews(p)
  const [countries, setCountries] = useState<string[]>([])
  const a = useAnalysis(p, reviews, undefined, countries)
  useEffect(() => { if (p) document.title = `${p.name} · Review Radar` }, [p?.name])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest('input,textarea,select,[contenteditable]')) return
      const i = Number(e.key) - 1
      if (i >= 0 && i < TABS.length) go(`/app/p/${id}/${TABS[i][0]}`, { keepScroll: true })
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [id])

  if (list === null) return <div className="boot" role="status"><span className="spinner" /> Loading</div>
  if (!p) return <NotFound />
  if (tab === 'report') return null
  const app = p.apps[0]
  const usedCountries = reviews ? [...new Set(reviews.filter(r => r.appId === app?.id).map(r => r.country))] : []
  const noData = reviews !== null && !reviews.length

  return (
    <section className="page">
      <div className="proj-head">
        {app?.icon ? <img src={app.icon} alt="" width="64" height="64" className="app-icon lg" /> : <span className="app-icon ph lg" aria-hidden="true">{(app?.name ?? p.name)[0]}</span>}
        <div className="grow">
          <p className="eyebrow"><Link href="/app">Projects</Link></p>
          <h1 className="proj-title">
            <input aria-label="Project name" className="title-input" value={p.name} onChange={e => void update(p, { name: e.target.value })} onBlur={e => { if (!e.target.value.trim()) void update(p, { name: app?.name ?? 'Untitled' }) }} />
            {p.sampleId && <SyntheticBadge />}
          </h1>
          <p className="muted small">{app ? <>{app.developer} · {app.genre} · current v{app.version}{app.currentVersionReleaseDate ? ` (${fmtDate(app.currentVersionReleaseDate)})` : ''}{app.url && <> · <a href={app.url} target="_blank" rel="noreferrer">App Store ↗</a></>}</> : 'No app linked. Imported reviews only.'}</p>
        </div>
        <div className="row gap-sm wrap">
          {!p.sampleId && app && <Link href={`/app/p/${p.id}/data?fetch=1`} className="btn ghost sm">Fetch latest</Link>}
          <Link href={`/app/p/${p.id}/report`} className="btn primary sm">Release health report</Link>
        </div>
      </div>

      <nav className="tabs" aria-label="Project sections">
        {TABS.map(([t, l], i) => <Link key={t} href={`/app/p/${p.id}/${t}`} aria-current={tab === t ? 'page' : undefined} title={`Shortcut: ${i + 1}`}>{l}</Link>)}
      </nav>

      {usedCountries.length > 1 && ['overview', 'themes', 'reviews', 'actions'].includes(tab) && (
        <div className="country-filter" role="group" aria-label="Filter by country">
          <button type="button" className="chip-btn" aria-pressed={!countries.length} onClick={() => setCountries([])}>All countries</button>
          {usedCountries.sort().map(c => <button key={c} type="button" className="chip-btn" aria-pressed={countries.includes(c)} onClick={() => setCountries(countries.includes(c) ? countries.filter(x => x !== c) : [...countries, c])}>{countryName(c)}</button>)}
        </div>
      )}

      {p.dataMissing && <div className="banner warn">This project was synced from another device without its reviews (the set was over the sync size cap). Fetch again or import to rebuild it here.</div>}

      {reviews === null || (!a && !noData) ? <div className="boot" role="status"><span className="spinner" /> Reading reviews</div>
        : noData && tab !== 'data' && tab !== 'compare' ? (
          <Empty title="No reviews yet">
            <p className="muted">{app ? 'Fetch the latest public reviews, or import an export with older history.' : 'Import a CSV of reviews to get started.'}</p>
            <div className="row gap center-x"><Link href={`/app/p/${p.id}/data${app ? '?fetch=1' : '?import=1'}`} className="btn primary">{app ? 'Fetch reviews' : 'Import reviews'}</Link></div>
          </Empty>
        ) : (
          <Suspense fallback={<div className="boot"><span className="spinner" /></div>}>
            {tab === 'overview' && a && <Overview p={p} a={a} />}
            {(tab === 'themes' || tab === 'reviews' || tab === 'actions') && a && <Insights p={p} a={a} tab={tab} />}
            {tab === 'compare' && <Compare p={p} />}
            {tab === 'history' && <History p={p} />}
            {tab === 'data' && <Data p={p} />}
            {!TABS.some(t => t[0] === tab) && <NotFound />}
          </Suspense>
        )}
    </section>
  )
}

function verdictText(v: string) { return v === 'worse' ? 'Worse' : v === 'better' ? 'Better' : v === 'too few reviews' ? 'Too few' : 'No clear change' }

function Overview({ p, a }: { p: Project; a: Analysis }) {
  const [sel, setSel] = useState<string | null>(null)
  const worst = a.impact.filter(i => i.verdict === 'worse').sort((x, y) => x.diff - y.diff)[0]
  const active = sel && a.series.some(s => s.version === sel) ? sel : a.latest
  const point = a.series.find(s => s.version === active)
  const themes = a.themes.length ? themeStatsFor(a, active) : []
  const latestImp = a.impact.find(i => i.version === a.latest)
  return (
    <div className="stack-lg">
      {worst && <div className="banner bad"><strong>Version {worst.version} cost {Math.abs(worst.diff).toFixed(2)} stars</strong> against {worst.prev} (95% interval {worst.diffCi[0].toFixed(2)} to {worst.diffCi[1].toFixed(2)}). One-star share went {fmtPct(worst.before.oneStar)} → {fmtPct(worst.after.oneStar)}. <button type="button" className="linkish" onClick={() => setSel(worst.version)}>Show what people said</button></div>}
      {a.emerging[0] && <div className="banner warn"><strong>Emerging in {a.latest}:</strong> {a.emerging.slice(0, 3).map(e => `${e.label} (${fmtPct(e.before)} → ${fmtPct(e.latest)})`).join(', ')}. <Link href={`/app/p/${p.id}/themes`}>See themes</Link></div>}

      <div className="kpis">
        <div className="kpi"><span>Average of {a.summary.n.toLocaleString()} reviews</span><b>{a.summary.mean.toFixed(2)}</b><Stars value={a.summary.mean} /></div>
        <div className="kpi"><span>Latest version {a.latest ?? 'n/a'}</span><b>{point && active === a.latest ? point.mean.toFixed(2) : a.series[a.series.length - 1]?.mean.toFixed(2) ?? 'n/a'}</b>{latestImp && <small className={latestImp.verdict === 'worse' ? 'unfav-t' : latestImp.verdict === 'better' ? 'fav-t' : 'muted'}>{signed(latestImp.diff)} vs {latestImp.prev} · {verdictText(latestImp.verdict).toLowerCase()}</small>}</div>
        <div className="kpi"><span>One-star share</span><b>{fmtPct(a.summary.oneStar)}</b><small className="muted">95% CI {fmtPct(a.summary.oneStarCi[0])} to {fmtPct(a.summary.oneStarCi[1])}</small></div>
        <div className="kpi"><span>App Store (all ratings)</span><b>{a.app.rating ? a.app.rating.toFixed(1) : 'n/a'}</b><small className="muted">{a.app.ratingCount ? `${a.app.ratingCount.toLocaleString()} ratings` : 'Lookup data unavailable'}{a.app.currentVersionRating ? ` · current version ${a.app.currentVersionRating.toFixed(1)}` : ''}</small></div>
      </div>

      <div className="card pad">
        <div className="row between wrap gap-sm"><h2 className="h4">Rating by version</h2><span className="muted small">Dots sized by review count · band is the 95% bootstrap interval · click a version</span></div>
        <Timeline series={a.series} impact={a.impact} selected={active} onSelect={setSel} />
      </div>

      {point && (
        <div className="grid-2">
          <div className="card pad">
            <h2 className="h4">Version {point.version}</h2>
            <p className="muted small">{point.n} reviews since {fmtDate(point.date)} · {point.mean.toFixed(2)}★ (95% CI {point.ci[0].toFixed(2)} to {point.ci[1].toFixed(2)})</p>
            <Dist dist={point.dist} />
            {a.versions.find(v => v.version === point.version)?.notes && <p className="small notes"><b>Release notes:</b> {a.versions.find(v => v.version === point.version)!.notes}</p>}
          </div>
          <div className="card pad">
            <h2 className="h4">Themes in {point.version}</h2>
            <ThemeBubbles items={themes} width={460} height={250} onPick={() => go(`/app/p/${p.id}/themes`)} />
          </div>
        </div>
      )}

      <div className="card pad">
        <h2 className="h4">Release impact</h2>
        <p className="muted small">Each version against the previous one with reviews. A verdict needs the 95% interval of the difference to exclude zero, and at least {MIN_N} reviews on each side.</p>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th scope="col">Version</th><th scope="col">Released</th><th scope="col" className="num">Reviews</th><th scope="col" className="num">Mean</th><th scope="col" className="num">Change</th><th scope="col">95% CI of change</th><th scope="col" className="num">1★ share</th><th scope="col">Verdict</th></tr></thead>
            <tbody>
              {[...a.impact].reverse().map(i => (
                <tr key={i.version} className={i.version === active ? 'on' : ''} onClick={() => setSel(i.version)}>
                  <th scope="row">{i.version}</th><td>{fmtDate(i.date)}</td><td className="num">{i.after.n}</td><td className="num">{i.after.mean.toFixed(2)}</td>
                  <td className={`num ${i.verdict === 'worse' ? 'unfav-t' : i.verdict === 'better' ? 'fav-t' : ''}`}>{signed(i.diff)}</td>
                  <td className="mono small">{i.diffCi[0].toFixed(2)} to {i.diffCi[1].toFixed(2)}</td>
                  <td className="num">{fmtPct(i.before.oneStar)} → {fmtPct(i.after.oneStar)}</td>
                  <td><span className={`chip v-${i.verdict.replace(/ /g, '-')}`}>{verdictText(i.verdict)}</span></td>
                </tr>
              ))}
              {!a.impact.length && <tr><td colSpan={8} className="muted">Only one version has reviews so far. Release impact appears after the next update, or import older reviews.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {new Set(a.byCountry.map(c => c.country)).size > 1 && (
        <div className="card pad">
          <h2 className="h4">By country</h2>
          <p className="muted small">Average rating per version and storefront. A problem in one locale shows up as a single red row.</p>
          <CountryHeat cells={a.byCountry} versions={a.versions.map(v => v.version)} />
        </div>
      )}
    </div>
  )
}

function themeStatsFor(a: Analysis, version: string | null) {
  const rs = a.reviews.filter(r => r.version === version)
  const by = new Map<string, { id: string; label: string; n: number; sum: number }>()
  for (const r of rs) for (const t of a.themesOf(r)) {
    const label = a.themes.find(x => x.id === t)?.label ?? t
    const e = by.get(t) ?? { id: t, label, n: 0, sum: 0 }
    e.n++; e.sum += r.rating
    by.set(t, e)
  }
  return [...by.values()].map(e => ({ id: e.id, label: e.label, n: e.n, mean: e.sum / e.n }))
}

function Compare({ p }: { p: Project }) {
  const reviews = useReviews(p)
  const [adding, setAdding] = useState(false)
  return (
    <div className="stack-lg">
      <div className="row between wrap gap">
        <p className="muted">Compare your app with competitors on the same themes. Competitor reviews are fetched with fewer pages to stay quick.</p>
        <button type="button" className="btn primary sm" onClick={() => setAdding(true)} disabled={!!p.sampleId} title={p.sampleId ? 'Samples have a fixed competitor' : ''}>Add competitor</button>
      </div>
      {adding && <div className="card pad"><AppPicker onPick={async a => {
        if (p.apps.some(x => x.id === a.id)) { toast(`${a.name} is already in this project.`); return }
        await update(p, { apps: [...p.apps, a] })
        setAdding(false)
        toast(`Added ${a.name}. Fetch to pull its reviews.`, { action: { label: 'Fetch now', run: () => go(`/app/p/${p.id}/data?fetch=1`) } })
      }} autoFocus /></div>}
      {p.apps.length < 2 && <Empty title="No competitors yet"><p className="muted">Add the apps your users compare you with. Review Radar lines up their ratings and complaint themes next to yours.</p></Empty>}
      {p.apps.length >= 2 && reviews && <CompareTable p={p} apps={p.apps} />}
    </div>
  )
}

function CompareTable({ p, apps }: { p: Project; apps: AppInfo[] }) {
  const reviews = useReviews(p)
  const rows = useMemo(() => apps.map(app => ({ app, a: analyze(p, reviews, app.id) })), [apps, p.rules, p.versions, reviews])
  const themeIds = [...new Set(rows.flatMap(r => r.a?.themes.map(t => t.id) ?? []))]
  const label = (id: string) => p.rules.find(r => r.id === id)?.label ?? id
  return (
    <div className="card pad">
      <div className="table-wrap">
        <table className="data compare">
          <thead><tr><th scope="col">Theme share of reviews</th>{rows.map(({ app }, i) => <th key={app.id} scope="col" className="num">{app.name}{i === 0 && <small className="block muted">yours</small>}</th>)}</tr></thead>
          <tbody>
            <tr><th scope="row">Average rating</th>{rows.map(({ app, a }) => <td key={app.id} className="num"><b>{a?.summary.n ? a.summary.mean.toFixed(2) : 'n/a'}</b></td>)}</tr>
            <tr><th scope="row">Reviews analysed</th>{rows.map(({ app, a }) => <td key={app.id} className="num">{a?.summary.n ?? 0}</td>)}</tr>
            <tr><th scope="row">One-star share</th>{rows.map(({ app, a }) => <td key={app.id} className="num">{a?.summary.n ? fmtPct(a.summary.oneStar) : 'n/a'}</td>)}</tr>
            {themeIds.map(id => {
              const shares = rows.map(r => r.a?.themes.find(t => t.id === id)?.share ?? 0)
              const max = Math.max(...shares)
              return <tr key={id}><th scope="row">{label(id)}</th>{shares.map((s, i) => <td key={i} className={`num ${s === max && s > 0 && i === 0 ? 'unfav-t' : ''}`}><span className="share-bar" style={{ ['--w' as string]: `${max ? (s / max) * 100 : 0}%` }}>{fmtPct(s)}</span></td>)}</tr>
            })}
          </tbody>
        </table>
      </div>
      <div className="row gap-sm wrap compare-actions">
        {apps.slice(1).map(app => <button key={app.id} type="button" className="btn danger-ghost sm" disabled={!!p.sampleId} onClick={async () => {
          const prev = p.apps
          const rs = await getReviews(p)
          await update(p, { apps: p.apps.filter(x => x.id !== app.id) })
          if (!p.sampleId) { await putData(p.id, rs.filter(r => r.appId !== app.id)); bumpData() }
          toast(`Removed ${app.name}.`, { undo: async () => { await saveProject({ ...getProject(p.id)!, apps: prev }); if (!p.sampleId) { await putData(p.id, rs); bumpData() } } })
        }}>Remove {app.name}</button>)}
      </div>
    </div>
  )
}

function History({ p }: { p: Project }) {
  const snaps = [...p.snapshots].sort((x, y) => y.createdAt - x.createdAt)
  const [aId, setA] = useState<string | null>(null)
  const [bId, setB] = useState<string | null>(null)
  const A = snaps.find(s => s.id === (aId ?? snaps[1]?.id)), B = snaps.find(s => s.id === (bId ?? snaps[0]?.id))
  const snapNow = async () => {
    const rs = await getReviews(p)
    await update(p, { snapshots: [...p.snapshots, makeSnapshot(p, rs, `Manual ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, Date.now())] })
    toast('Snapshot saved.', { tone: 'ok' })
  }
  if (!snaps.length) return <Empty title="No snapshots yet"><p className="muted">Each fetch saves a snapshot automatically. You can also save one now.</p><button type="button" className="btn primary" onClick={() => void snapNow()}>Save a snapshot</button></Empty>
  const allThemes = [...new Set([...(A?.themes ?? []), ...(B?.themes ?? [])].map(t => t.id))]
  const newThemes = B && A ? B.themes.filter(t => !A.themes.some(x => x.id === t.id)) : []
  const newVersions = B && A ? B.versions.filter(v => !A.versions.some(x => x.version === v.version)) : []
  return (
    <div className="stack-lg">
      <div className="row between wrap gap">
        <div className="row gap wrap">
          <label className="field"><span>From</span><select value={A?.id ?? ''} onChange={e => setA(e.target.value)}>{snaps.map(s => <option key={s.id} value={s.id}>{s.label} · {fmtDate(new Date(s.createdAt).toISOString())}</option>)}</select></label>
          <label className="field"><span>To</span><select value={B?.id ?? ''} onChange={e => setB(e.target.value)}>{snaps.map(s => <option key={s.id} value={s.id}>{s.label} · {fmtDate(new Date(s.createdAt).toISOString())}</option>)}</select></label>
        </div>
        <button type="button" className="btn ghost sm" onClick={() => void snapNow()}>Save snapshot now</button>
      </div>
      {A && B && (
        <div className="grid-2">
          <div className="card pad">
            <h2 className="h4">What changed</h2>
            <ul className="changes">
              <li>Average rating <b>{A.mean.toFixed(2)} → {B.mean.toFixed(2)}</b> <span className={B.mean < A.mean ? 'unfav-t' : 'fav-t'}>({signed(B.mean - A.mean)})</span></li>
              <li>Reviews <b>{A.n} → {B.n}</b></li>
              <li>Latest version <b>{A.latest ?? 'n/a'} → {B.latest ?? 'n/a'}</b></li>
              {newVersions.map(v => <li key={v.version}>New version <b>{v.version}</b>: {v.n} reviews at {v.mean.toFixed(2)}★</li>)}
              {newThemes.length ? newThemes.map(t => <li key={t.id} className="unfav-t">New theme <b>{t.label}</b>: {t.n} reviews</li>) : <li className="muted">No new themes since the earlier snapshot.</li>}
            </ul>
          </div>
          <div className="card pad">
            <h2 className="h4">Theme share</h2>
            <div className="table-wrap"><table className="data">
              <thead><tr><th scope="col">Theme</th><th scope="col" className="num">{A.label}</th><th scope="col" className="num">{B.label}</th><th scope="col" className="num">Change</th></tr></thead>
              <tbody>{allThemes.map(id => {
                const x = A.themes.find(t => t.id === id), y = B.themes.find(t => t.id === id)
                const d = (y?.share ?? 0) - (x?.share ?? 0)
                return <tr key={id}><th scope="row">{(x ?? y)!.label}</th><td className="num">{fmtPct(x?.share ?? 0)}</td><td className="num">{fmtPct(y?.share ?? 0)}</td><td className={`num ${d > 0.02 ? 'unfav-t' : d < -0.02 ? 'fav-t' : 'muted'}`}>{d > 0 ? '+' : ''}{(d * 100).toFixed(0)} pts</td></tr>
              })}</tbody>
            </table></div>
          </div>
        </div>
      )}
      <div className="card pad">
        <h2 className="h4">All snapshots</h2>
        <ul className="snap-list">
          {snaps.map(s => (
            <li key={s.id}>
              <span className="grow"><b>{s.label}</b> <span className="muted small">{new Date(s.createdAt).toLocaleString()} · {s.n} reviews · {s.mean.toFixed(2)}★ · latest {s.latest ?? 'n/a'}</span></span>
              <button type="button" className="btn danger-ghost sm" onClick={async () => {
                const prev = p.snapshots
                await update(p, { snapshots: p.snapshots.filter(x => x.id !== s.id) })
                void deleteSnapshotCloud(s.id)
                toast(`Deleted snapshot ${s.label}.`, { undo: () => void saveProject({ ...getProject(p.id)!, snapshots: prev }) })
              }}>Delete</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

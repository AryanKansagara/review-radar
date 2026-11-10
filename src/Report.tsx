import { useEffect, useState } from 'react'
import { countryName } from './engine/reviews.ts'
import { displaySeries } from './engine/stats.ts'
import { releaseNotes } from './engine/themes.ts'
import { CountryHeat, Dist, Timeline } from './Charts.tsx'
import { useAnalysis, useReviews } from './projectData.ts'
import { useProjects } from './store.ts'
import { fmtDate, fmtPct, Link, NotFound, signed } from './ui.tsx'

export default function Report({ id }: { id: string }) {
  const list = useProjects()
  const p = list?.find(x => x.id === id)
  const reviews = useReviews(p)
  const a = useAnalysis(p, reviews)
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => { if (p) document.title = `Release health report · ${p.name}` }, [p?.name])
  if (list === null || (p && !a && reviews === null)) return <div className="boot" role="status"><span className="spinner" /> Preparing report</div>
  if (!p) return <NotFound />
  if (!a || !a.reviews.length) return <section className="page narrow"><h1>Nothing to report yet</h1><p className="muted">Fetch or import reviews first.</p><Link href={`/app/p/${p.id}/data`} className="btn primary">Go to data</Link></section>
  const v = version ?? a.latest
  const imp = a.impact.find(i => i.version === v)
  const point = a.series.find(s => s.version === v)
  const vr = a.reviews.filter(r => r.version === v)
  const vThemes = a.themes.map(t => ({ ...t, vn: vr.filter(r => a.themesOf(r).includes(t.id)).length })).filter(t => t.vn).sort((x, y) => y.vn - x.vn)
  const notes = releaseNotes(a.fix.filter(f => p.addressed.includes(f.id)))
  const worst = vr.filter(r => r.rating <= 2).sort((x, y) => y.body.length - x.body.length).slice(0, 4)
  return (
    <div className="report">
      <div className="report-bar no-print">
        <Link href={`/app/p/${p.id}`} className="btn ghost sm">← Back to project</Link>
        <label className="field inline"><span>Release</span><select value={v ?? ''} onChange={e => setVersion(e.target.value)}>{[...a.series].reverse().map(s => <option key={s.version}>{s.version}</option>)}</select></label>
        <button type="button" className="btn primary sm" onClick={() => print()}>Print or save as PDF</button>
      </div>
      <article className="sheet">
        <header className="sheet-head">
          <div><p className="eyebrow">Release health report</p><h1>{a.app.name} {v}</h1><p className="muted">{a.app.developer} · prepared {fmtDate(new Date().toISOString())} · {a.reviews.length.toLocaleString()} reviews across {new Set(a.reviews.map(r => r.country)).size} countries{p.sampleId ? ' · synthetic sample data' : ''}</p></div>
          <div className={`grade ${imp?.verdict.replace(/ /g, '-') ?? ''}`}>{point?.mean.toFixed(2) ?? 'n/a'}<small>★ in {v}</small></div>
        </header>
        <section className="sheet-sec">
          <h2>Summary</h2>
          <p>{imp ? <>Version <b>{v}</b> averages <b>{imp.after.mean.toFixed(2)}★</b> from {imp.after.n} reviews, {signed(imp.diff)} against {imp.prev} (95% interval {imp.diffCi[0].toFixed(2)} to {imp.diffCi[1].toFixed(2)}): <b>{imp.verdict}</b>. One-star share {fmtPct(imp.before.oneStar)} → {fmtPct(imp.after.oneStar)} (Wilson 95% {fmtPct(imp.after.oneStarCi[0])} to {fmtPct(imp.after.oneStarCi[1])}).</> : <>Version {v} averages {point?.mean.toFixed(2)}★ from {point?.n} reviews. No earlier version to compare.</>}</p>
          {a.emerging.length > 0 && v === a.latest && <p>Emerging in this release: {a.emerging.map(e => `${e.label} (${fmtPct(e.before)} → ${fmtPct(e.latest)})`).join(', ')}.</p>}
        </section>
        <section className="sheet-sec"><h2>Rating by version</h2><Timeline series={displaySeries(a.series)} impact={a.impact} selected={v} height={260} /></section>
        <div className="sheet-grid">
          <section className="sheet-sec"><h2>Ratings in {v}</h2>{point && <Dist dist={point.dist} />}</section>
          <section className="sheet-sec"><h2>Top themes in {v}</h2>
            <table className="data"><thead><tr><th>Theme</th><th className="num">Reviews</th><th className="num">Share</th></tr></thead>
              <tbody>{vThemes.slice(0, 7).map(t => <tr key={t.id}><td>{t.label}</td><td className="num">{t.vn}</td><td className="num">{fmtPct(t.vn / Math.max(1, vr.length))}</td></tr>)}</tbody></table>
          </section>
        </div>
        <section className="sheet-sec"><h2>What to fix next <span className="muted small">(all versions)</span></h2>
          <ol className="fix-print">{a.fix.slice(0, 5).map(f => <li key={f.id}><b>{f.label}</b>: {f.why}</li>)}</ol>
        </section>
        {worst.length > 0 && <section className="sheet-sec"><h2>In their words</h2>{worst.map(r => <blockquote key={r.id} className="quote"><b>{r.rating}★ {r.title}</b> {r.body} <span className="muted">· {countryName(r.country)}, {fmtDate(r.date)}</span></blockquote>)}</section>}
        {new Set(a.byCountry.map(c => c.country)).size > 1 && <section className="sheet-sec"><h2>By country</h2><CountryHeat cells={a.byCountry} versions={a.versions.map(x => x.version)} /></section>}
        {notes && <section className="sheet-sec"><h2>Proposed release notes</h2><pre className="notes-pre">{notes}</pre></section>}
        <footer className="sheet-foot muted small">Ratings from public App Store reviews with written text (the feed returns the 500 most recent per country). Intervals are 95% bootstrap (means) and Wilson (shares). Review Radar, an independent tool not affiliated with Apple.</footer>
      </article>
    </div>
  )
}

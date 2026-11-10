import { useEffect, useRef, useState } from 'react'
import { assignVersions, detectMapping, FIELDS, parseAscJson, parseCsv, parseVersions, rowsToReviews, type ImportResult, type Mapping } from './engine/importer.ts'
import { COUNTRIES, mergeReviews } from './engine/reviews.ts'
import type { VersionInfo } from './engine/types.ts'
import type { FetchProgress } from './live.ts'
import { bumpData, getReviews, makeSnapshot, mergeVersions, runFetch } from './projectData.ts'
import { getDefaults, getProject, putData, saveProject, update, uuid, type Project } from './store.ts'
import { RAW_SYNC_LIMIT } from './sync.ts'
import { fmtDate, Link, plural, toast } from './ui.tsx'

export default function Data({ p }: { p: Project }) {
  const [count, setCount] = useState<number | null>(null)
  const [size, setSize] = useState(0)
  useEffect(() => { void getReviews(p).then(rs => { setCount(rs.length); setSize(JSON.stringify(rs).length) }) }, [p.id, p.updatedAt])
  const q = new URLSearchParams(location.search)
  return (
    <div className="stack-lg">
      {p.apps[0] && !p.sampleId && <FetchPanel p={p} auto={q.get('fetch') === '1'} />}
      {p.sampleId && <div className="banner">This is a synthetic sample, rebuilt from a fixed seed on every device. <Link href="/app">Start a project for your own app</Link> to fetch live reviews.</div>}
      {!p.sampleId && <ImportPanel p={p} startOpen={q.get('import') === '1' || !p.apps.length} />}
      {!p.sampleId && <VersionsPanel p={p} />}
      <div className="card pad stack-sm">
        <h2 className="h4">Stored data</h2>
        <p className="small">{count === null ? 'Counting…' : `${plural(count, 'review')} on this device (${(size / 1e6).toFixed(2)} MB).`} {size > RAW_SYNC_LIMIT ? 'Over the 1.5 MB sync cap: when signed in, the project, rules, version lists and snapshots sync, but the reviews stay here.' : 'Within the sync cap: if you sign in, reviews sync too.'}</p>
        {p.imports.length > 0 && <ul className="small imports">{[...p.imports].reverse().map(i => <li key={i.id}>{fmtDate(new Date(i.at).toISOString())} · {i.kind === 'versions' ? 'Version list' : 'Reviews'} · {i.fileName} ({i.format}) · {i.rows} rows · {i.issues} issues</li>)}</ul>}
        {!p.sampleId && !!count && <button type="button" className="btn danger-ghost sm" onClick={async () => {
          const rs = await getReviews(p)
          await putData(p.id, [])
          await update(p, {})
          bumpData()
          toast(`Removed ${rs.length} reviews from this project.`, { undo: async () => { await putData(p.id, rs); await saveProject(getProject(p.id)!); bumpData() } })
        }}>Clear all reviews</button>}
      </div>
    </div>
  )
}

function FetchPanel({ p, auto }: { p: Project; auto: boolean }) {
  const [busy, setBusy] = useState(false)
  const [prog, setProg] = useState<{ label: string; p: FetchProgress } | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const ctl = useRef<AbortController | null>(null)
  const started = useRef(false)
  const run = async () => {
    const c = new AbortController()
    ctl.current = c
    setBusy(true); setResult(null)
    try {
      const r = await runFetch(p.id, (label, pr) => setProg({ label, p: pr }), c.signal)
      const msg = `Fetched ${plural(r.added, 'new review')} (${r.total.toLocaleString()} total).${r.failed.length ? ` No response for ${r.failed.join(', ')}.` : ''}`
      setResult(msg)
      toast(msg, { tone: r.failed.length ? undefined : 'ok' })
    } catch (e) {
      if (c.signal.aborted) { setResult('Fetch cancelled. Nothing was saved.'); return }
      const m = e instanceof Error ? e.message : String(e)
      setResult(`Fetch failed: ${/fetch|network|load failed/i.test(m) ? 'could not reach the App Store. Check your connection and try again.' : m}`)
    } finally { setBusy(false); setProg(null) }
  }
  useEffect(() => {
    if (auto && !started.current) { started.current = true; history.replaceState({}, '', location.pathname); void run() }
  }, [auto])
  const toggle = (c: string) => void update(p, { countries: p.countries.includes(c) ? p.countries.filter(x => x !== c) : [...p.countries, c] })
  const pct = prog ? Math.round((prog.p.done / Math.max(1, prog.p.total)) * 100) : 0
  return (
    <div className="card pad stack-sm">
      <div className="row between wrap gap-sm">
        <h2 className="h4">Fetch from the App Store</h2>
        {p.lastFetch && <span className="muted small">Last fetched {new Date(p.lastFetch).toLocaleString()}</span>}
      </div>
      <p className="muted small">Pulls the most recent public reviews (Apple’s feed returns up to 500 per country, newest first) for {p.apps.map(a => a.name).join(', ')}. New reviews are merged by id; nothing is ever duplicated. Up to {getDefaults().pages} pages per country (Settings).</p>
      <fieldset className="countries" disabled={busy}>
        <legend className="small muted">Countries</legend>
        {COUNTRIES.map(([c, n]) => <label key={c} className="chip-check"><input type="checkbox" checked={p.countries.includes(c)} onChange={() => toggle(c)} /> {n}</label>)}
      </fieldset>
      <div className="row gap-sm wrap">
        <button type="button" className="btn primary" disabled={busy || !p.countries.length} onClick={() => void run()}>{busy ? 'Fetching' : 'Fetch latest reviews'}</button>
        {busy && <button type="button" className="btn ghost" onClick={() => ctl.current?.abort()}>Cancel</button>}
      </div>
      {prog && <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Fetch progress"><i style={{ width: `${pct}%` }} /><span className="small">{prog.label} · {prog.p.country.toUpperCase()} · {prog.p.reviews} reviews</span></div>}
      {result && <p className="small" role="status">{result}</p>}
    </div>
  )
}

interface Pending { fileName: string; rows: string[][] | null; map: Mapping; result: ImportResult }

function ImportPanel({ p, startOpen }: { p: Project; startOpen: boolean }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [paste, setPaste] = useState('')
  const [drag, setDrag] = useState(false)
  const appId = p.apps[0]?.id ?? 'imported'
  const country = p.countries[0] ?? 'us'
  const load = (text: string, fileName: string) => {
    const asc = parseAscJson(text, appId)
    if (asc) { setPending({ fileName, rows: null, map: {}, result: asc }); return }
    const rows = parseCsv(text)
    if (rows.length < 2) { toast('That file has no data rows. Expected a header row then one review per row.', { tone: 'error' }); return }
    const map = detectMapping(rows[0])
    setPending({ fileName, rows, map, result: rowsToReviews(rows, map, appId, country) })
  }
  const remap = (f: keyof Mapping, i: number | undefined) => {
    if (!pending?.rows) return
    const map = { ...pending.map, [f]: i }
    if (i === undefined) delete map[f]
    setPending({ ...pending, map, result: rowsToReviews(pending.rows, map, appId, country) })
  }
  const commit = async () => {
    if (!pending) return
    const existing = await getReviews(p)
    const withVersions = assignVersions(pending.result.reviews, p.versions[appId] ?? [])
    const m = mergeReviews(existing, withVersions)
    await putData(p.id, m.reviews)
    const meta = { id: uuid(), kind: 'reviews' as const, fileName: pending.fileName, format: pending.result.format, rows: pending.result.reviews.length, issues: pending.result.issues.length, at: Date.now() }
    const cur = getProject(p.id)!
    await saveProject({ ...cur, imports: [...cur.imports, meta], snapshots: [...cur.snapshots, makeSnapshot(cur, m.reviews, `Import ${pending.fileName}`, Date.now())] })
    bumpData()
    toast(`Imported ${plural(m.added, 'new review')}${m.updated ? `, updated ${m.updated}` : ''}.`, { tone: 'ok' })
    setPending(null); setPaste('')
  }
  const errors = pending?.result.issues.filter(i => i.level === 'error') ?? []
  const blocking = !pending?.result.reviews.length
  return (
    <details className="card pad import" open={startOpen || !!pending}>
      <summary><h2 className="h4 inline">Import reviews</h2> <span className="muted small">CSV, TSV or App Store Connect API JSON. For history older than the feed’s 500 most recent.</span></summary>
      {!pending ? (
        <div className="stack-sm">
          <div className={`drop${drag ? ' on' : ''}`} onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
            onDrop={async e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) load(await f.text(), f.name) }}>
            <p><b>Drop a file here</b> or <label className="linkish file-label">choose one<input type="file" accept=".csv,.tsv,.txt,.json" className="sr-only" onChange={async e => { const f = e.target.files?.[0]; if (f) load(await f.text(), f.name); e.target.value = '' }} /></label></p>
            <p className="muted small">Columns are detected by name: date, rating, title, review, version, territory or country, nickname, id. <Link href="/docs#import">Export steps and formats</Link></p>
          </div>
          <label className="field"><span>Or paste</span><textarea rows={4} value={paste} onChange={e => setPaste(e.target.value)} placeholder={'date,rating,title,review,version,country\n2026-10-02,1,Crashes,Since the update it crashes on launch,5.4,de'} /></label>
          <button type="button" className="btn ghost sm" disabled={!paste.trim()} onClick={() => load(paste, 'pasted text')}>Check pasted data</button>
        </div>
      ) : (
        <div className="stack">
          <p className="small"><b>{pending.fileName}</b> · {pending.result.format}{pending.rows ? ` · ${pending.rows.length - 1} rows` : ''}</p>
          {pending.rows && (
            <div className="mapping">
              {FIELDS.map(({ f, label, required }) => (
                <label key={f} className="field"><span>{label}{required ? ' *' : ''}</span>
                  <select value={pending.map[f] ?? ''} onChange={e => remap(f, e.target.value === '' ? undefined : Number(e.target.value))}>
                    <option value="">Not in file</option>
                    {pending.rows![0].map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}
          <div className={`validation ${errors.length ? 'has-errors' : ''}`}>
            <p className="small"><b>{plural(pending.result.reviews.length, 'review')} ready</b>{pending.result.skipped ? `, ${pending.result.skipped} skipped` : ''} · {plural(errors.length, 'error')} · {plural(pending.result.issues.length - errors.length, 'warning')}</p>
            {pending.result.issues.length > 0 && (
              <div className="table-wrap issues"><table className="data">
                <thead><tr><th scope="col">Line</th><th scope="col">Level</th><th scope="col">Problem</th></tr></thead>
                <tbody>{pending.result.issues.slice(0, 60).map((i, k) => <tr key={k}><td className="mono">{i.line}</td><td><span className={`chip ${i.level === 'error' ? 'neg' : 'warn'}`}>{i.level}</span></td><td>{i.message}</td></tr>)}</tbody>
              </table>{pending.result.issues.length > 60 && <p className="muted small">and {pending.result.issues.length - 60} more</p>}</div>
            )}
          </div>
          {pending.result.reviews.length > 0 && (
            <div className="table-wrap"><table className="data preview">
              <caption className="muted small">Preview</caption>
              <thead><tr><th scope="col">Date</th><th scope="col">★</th><th scope="col">Version</th><th scope="col">Country</th><th scope="col">Review</th></tr></thead>
              <tbody>{pending.result.reviews.slice(0, 5).map(r => <tr key={r.id}><td>{r.date.slice(0, 10)}</td><td>{r.rating}</td><td>{r.version}</td><td>{r.country.toUpperCase()}</td><td>{(r.title ? r.title + '. ' : '') + r.body.slice(0, 90)}</td></tr>)}</tbody>
            </table></div>
          )}
          <div className="row gap-sm">
            <button type="button" className="btn primary" disabled={blocking} onClick={() => void commit()}>Import {plural(pending.result.reviews.length, 'review')}</button>
            <button type="button" className="btn ghost" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      )}
    </details>
  )
}

function VersionsPanel({ p }: { p: Project }) {
  const appId = p.apps[0]?.id ?? 'imported'
  const list: VersionInfo[] = p.versions[appId] ?? []
  const [text, setText] = useState('')
  const parsed = text.trim() ? parseVersions(text) : null
  const save = async () => {
    if (!parsed?.versions.length) return
    const versions = mergeVersions(list, parsed.versions)
    const rs = await getReviews(p)
    const assigned = assignVersions(rs, versions)
    const changed = assigned.filter((r, i) => r !== rs[i]).length
    if (changed) { await putData(p.id, assigned); bumpData() }
    const cur = getProject(p.id)!
    await saveProject({ ...cur, versions: { ...cur.versions, [appId]: versions }, imports: [...cur.imports, { id: uuid(), kind: 'versions', fileName: 'version list', format: 'csv', rows: parsed.versions.length, issues: parsed.issues.length, at: Date.now() }] })
    toast(`Saved ${plural(parsed.versions.length, 'version')}${changed ? `, assigned ${changed} reviews by date` : ''}.`, { tone: 'ok' })
    setText('')
  }
  return (
    <details className="card pad">
      <summary><h2 className="h4 inline">Version history</h2> <span className="muted small">{plural(list.length, 'listed version')}. Optional: gives releases exact dates and assigns imported reviews without a version.</span></summary>
      {list.length > 0 && <ul className="small versions">{list.map(v => <li key={v.version}><b>{v.version}</b> · {fmtDate(v.date)}{v.notes ? ` · ${v.notes.slice(0, 80)}` : ''}</li>)}</ul>}
      <label className="field"><span>Paste "version,date,notes" lines</span><textarea rows={4} value={text} onChange={e => setText(e.target.value)} placeholder={'version,date,notes\n3.1,2026-07-14,Streak freezes\n3.2,2026-08-25,New Premium plan'} /></label>
      {parsed && <p className="small">{plural(parsed.versions.length, 'version')} read{parsed.issues.length ? ` · ${parsed.issues.map(i => `line ${i.line}: ${i.message}`).join(' · ')}` : ''}</p>}
      <button type="button" className="btn ghost sm" disabled={!parsed?.versions.length} onClick={() => void save()}>Save version list</button>
    </details>
  )
}

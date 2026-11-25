import { useEffect, useRef, useState } from 'react'
import { parseAppRef } from './engine/reviews.ts'
import { SAMPLES } from './engine/sample.ts'
import type { AppInfo } from './engine/types.ts'
import { lookupApp, searchApps } from './live.ts'
import { createAppProject, createSampleProject } from './projectData.ts'
import { blankProject, deleteProject, saveProject, useProjects } from './store.ts'
import { Empty, fmtDate, go, Link, Modal, Stars, SyntheticBadge, toast } from './ui.tsx'

/** App search box: a link or id resolves through lookup, anything else searches the store. */
export function AppPicker({ onPick, country = 'us', autoFocus }: { onPick(a: AppInfo, country: string): void; country?: string; autoFocus?: boolean }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<AppInfo[]>([])
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle')
  const [msg, setMsg] = useState('')
  const ctl = useRef<AbortController | null>(null)
  useEffect(() => {
    const t = q.trim()
    if (t.length < 2) { setRes([]); setState('idle'); return }
    const timer = setTimeout(async () => {
      ctl.current?.abort()
      const c = new AbortController()
      ctl.current = c
      setState('busy')
      try {
        const ref = parseAppRef(t)
        const list = ref ? [await lookupApp(ref.id, ref.country, c.signal)].filter((a): a is AppInfo => !!a) : await searchApps(t, country, c.signal)
        if (c.signal.aborted) return
        setRes(list)
        setState('idle')
        setMsg(list.length ? '' : 'No apps found. Check the link, or try the exact App Store name.')
      } catch {
        if (c.signal.aborted) return
        setState('error')
        setMsg('Could not reach the App Store. Check your connection, or import a CSV instead.')
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [q, country])
  return (
    <div className="picker">
      <label className="field"><span>App Store link, app id or name</span>
        <input value={q} onChange={e => setQ(e.target.value)} autoFocus={autoFocus} placeholder="https://apps.apple.com/us/app/…/id123456789" spellCheck={false} />
      </label>
      {state === 'busy' && <p className="muted small" role="status"><span className="spinner" /> Searching the App Store</p>}
      {msg && state !== 'busy' && <p className={`small ${state === 'error' ? 'error' : 'muted'}`}>{msg}</p>}
      <ul className="picker-list">
        {res.map(a => (
          <li key={a.id}>
            <button type="button" className="picker-item" onClick={() => onPick(a, parseAppRef(q)?.country ?? country)}>
              {a.icon ? <img src={a.icon} alt="" width="40" height="40" className="app-icon" /> : <span className="app-icon ph">{a.name[0]}</span>}
              <span className="grow"><strong>{a.name}</strong><span className="muted small block">{a.developer} · v{a.version}{a.rating ? ` · ${a.rating.toFixed(1)}★ (${(a.ratingCount ?? 0).toLocaleString()})` : ''}</span></span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function Workspace() {
  const list = useProjects()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    if (q.get('import') === '1') { history.replaceState({}, '', '/app'); void importBlank() }
    const s = q.get('sample')
    if (s && SAMPLES.some(x => x.id === s)) void createSampleProject(s).then(p => go(`/app/p/${p.id}`, { replace: true }))
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !(e.target as HTMLElement).closest('input,textarea,select')) { e.preventDefault(); setOpen(true) } }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  const pick = async (a: AppInfo, country: string) => {
    const p = await createAppProject(a, country)
    setOpen(false)
    go(`/app/p/${p.id}/data?fetch=1`)
  }
  const importBlank = async () => {
    const p = await saveProject(blankProject('Imported reviews'))
    go(`/app/p/${p.id}/data?import=1`)
  }
  const sample = async (id: string) => { const p = await createSampleProject(id); go(`/app/p/${p.id}`) }

  if (list === null) return <div className="boot" role="status"><span className="spinner" /> Loading</div>
  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <p className="muted">One project per app you ship. Add competitors to compare. Every fetch is kept as a snapshot.</p>
        </div>
        <div className="row gap-sm wrap">
          <button type="button" className="btn ghost" onClick={() => void importBlank()}>Import CSV</button>
          <button type="button" className="btn primary" onClick={() => setOpen(true)} title="Shortcut: N">New project</button>
        </div>
      </div>

      {list.length === 0 ? (
        <Empty title="Track your first app" icon={<EmptyArt />}>
          <p className="muted">Paste your App Store link to pull its public reviews from every storefront you choose, or start with a synthetic app to see a rating drop explained.</p>
          <div className="row gap center-x wrap">
            <button type="button" className="btn primary" onClick={() => void sample('habit')}>Try the sample</button>
            <button type="button" className="btn ghost" onClick={() => setOpen(true)}>Add an app</button>
            <button type="button" className="btn link" onClick={() => void importBlank()}>Import your data</button>
          </div>
        </Empty>
      ) : (
        <div className="proj-grid">
          {list.map(p => {
            const a = p.apps[0]
            const last = p.snapshots[p.snapshots.length - 1]
            return (
              <article key={p.id} className="card proj">
                <Link href={`/app/p/${p.id}`} className="proj-link">
                  <div className="row gap-sm">
                    {a?.icon ? <img src={a.icon} alt="" width="48" height="48" className="app-icon" /> : <span className="app-icon ph lg">{(a?.name ?? p.name)[0]}</span>}
                    <div className="grow"><h3>{p.name} {p.sampleId && <SyntheticBadge />}</h3><p className="muted small">{a ? `${a.developer} · v${a.version}` : 'No app yet'}{p.apps.length > 1 ? ` · ${p.apps.length - 1} competitor${p.apps.length > 2 ? 's' : ''}` : ''}</p></div>
                  </div>
                  <div className="proj-meta">
                    {last ? <><span><Stars value={last.mean} size={12} /> {last.mean.toFixed(2)}</span><span>{last.n.toLocaleString()} reviews</span><span>latest {last.latest ?? 'n/a'}</span></> : <span>Not fetched yet</span>}
                    <span>{p.lastFetch ? `Updated ${fmtDate(new Date(p.lastFetch).toISOString())}` : ''}</span>
                  </div>
                </Link>
                <div className="row gap-sm proj-actions">
                  <Link href={`/app/p/${p.id}/themes`} className="btn ghost sm">Themes</Link>
                  <Link href={`/app/p/${p.id}/report`} className="btn ghost sm">Report</Link>
                  <button type="button" className="btn danger-ghost sm" onClick={async () => {
                    const undo = await deleteProject(p.id)
                    toast(`Deleted ${p.name}.`, { undo: () => void undo() })
                  }}>Delete</button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      <div className="samples">
        <h2 className="h4">Synthetic sample apps</h2>
        <div className="proj-grid">
          {SAMPLES.map(s => (
            <button key={s.id} type="button" className="card sample-card" onClick={() => void sample(s.id)}>
              <strong>{s.name}</strong> <SyntheticBadge />
              <span className="muted small">{s.blurb}</span>
            </button>
          ))}
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="New project">
        <AppPicker onPick={(a, c) => void pick(a, c)} autoFocus />
        <p className="muted small">Next, Review Radar fetches the most recent reviews (up to 500 per country) for the countries in Settings. No key or account needed.</p>
        <hr />
        <p className="small">Have an App Store Connect export or older history? <button type="button" className="linkish" onClick={() => { setOpen(false); void importBlank() }}>Import a CSV instead</button>.</p>
      </Modal>
    </section>
  )
}

const EmptyArt = () => (
  <svg className="empty-art" viewBox="0 0 140 80" aria-hidden="true">
    <path d="M10 22 L40 18 L70 20 L100 52 L130 44" className="ea-line" />
    {[[10, 22], [40, 18], [70, 20], [100, 52], [130, 44]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i === 3 ? 7 : 5} className={i === 3 ? 'ea-bad' : 'ea-dot'} />)}
  </svg>
)

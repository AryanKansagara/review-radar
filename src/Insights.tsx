import { useMemo, useState } from 'react'
import { countryName } from './engine/reviews.ts'
import { checkReply, draftReply, RESPONSE_LIMIT, RESPONSE_RULES_DATE } from './engine/replies.ts'
import { mismatch, sentiment } from './engine/sentiment.ts'
import { DEFAULT_RULES, matchedKeywords, releaseNotes } from './engine/themes.ts'
import { reviewsCsv, toCsv } from './engine/importer.ts'
import type { Review, ThemeRule } from './engine/types.ts'
import { ThemeBubbles } from './Charts.tsx'
import type { Analysis } from './projectData.ts'
import { getProject, saveProject, update, type Project } from './store.ts'
import { CopyButton, download, Empty, fmtDate, fmtPct, Link, plural, Stars, toast } from './ui.tsx'

export default function Insights({ p, a, tab }: { p: Project; a: Analysis; tab: string }) {
  if (tab === 'themes') return <Themes p={p} a={a} />
  if (tab === 'reviews') return <Reviews p={p} a={a} />
  return <Actions p={p} a={a} />
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'theme'

function Themes({ p, a }: { p: Project; a: Analysis }) {
  const [version, setVersion] = useState<string>('all')
  const [open, setOpen] = useState<string | null>(null)
  const rs = version === 'all' ? a.reviews : a.reviews.filter(r => r.version === version)
  const stats = useMemo(() => {
    const out = new Map<string, { n: number; sum: number }>()
    for (const r of rs) for (const t of a.themesOf(r)) { const e = out.get(t) ?? { n: 0, sum: 0 }; e.n++; e.sum += r.rating; out.set(t, e) }
    return a.themes.map(t => ({ ...t, vn: out.get(t.id)?.n ?? 0, vmean: out.get(t.id) ? out.get(t.id)!.sum / out.get(t.id)!.n : 0 })).filter(t => t.vn > 0).sort((x, y) => y.vn - x.vn)
  }, [rs, a])
  const openRule = p.rules.find(r => r.id === open)
  return (
    <div className="stack-lg">
      <div className="row between wrap gap">
        <label className="field inline"><span>Release</span>
          <select value={version} onChange={e => setVersion(e.target.value)}>
            <option value="all">All versions ({a.reviews.length})</option>
            {[...a.series].reverse().map(s => <option key={s.version} value={s.version}>{s.version} ({s.n})</option>)}
          </select>
        </label>
        <span className="muted small">{plural(rs.length, 'review')} · {fmtPct(rs.length ? rs.filter(r => a.themesOf(r).length).length / rs.length : 0)} matched at least one theme</span>
      </div>

      {a.emerging.length > 0 && (
        <div className="card pad emerging">
          <h2 className="h4">Emerging in {a.latest}</h2>
          <p className="muted small">Themes whose share of reviews jumped in the latest version compared with every earlier version.</p>
          <div className="emerge-list">
            {a.emerging.map(e => <div key={e.id} className="emerge"><b>{e.label}</b><span>{fmtPct(e.before)} → <strong>{fmtPct(e.latest)}</strong></span><small className="muted">{e.n} reviews{Number.isFinite(e.lift) ? ` · ${e.lift.toFixed(1)}×` : ' · new'}</small></div>)}
          </div>
        </div>
      )}

      <div className="grid-2">
        <div className="card pad"><h2 className="h4">Theme map</h2><p className="muted small">Size is mentions, colour is the average rating of those reviews.</p>
          <ThemeBubbles items={stats.map(t => ({ id: t.id, label: t.label, n: t.vn, mean: t.vmean }))} active={open} onPick={setOpen} width={460} height={280} />
        </div>
        <div className="card pad">
          <h2 className="h4">Themes</h2>
          <div className="table-wrap"><table className="data">
            <thead><tr><th scope="col">Theme</th><th scope="col" className="num">Reviews</th><th scope="col" className="num">Share</th><th scope="col" className="num">Avg ★</th><th scope="col" className="num" title="Average rating of other reviews minus this theme's">Stars lost</th></tr></thead>
            <tbody>{stats.map(t => (
              <tr key={t.id} className={open === t.id ? 'on' : ''} onClick={() => setOpen(open === t.id ? null : t.id)}>
                <th scope="row"><button type="button" className="linkish">{t.label}</button></th><td className="num">{t.vn}</td><td className="num">{fmtPct(rs.length ? t.vn / rs.length : 0)}</td><td className="num">{t.vmean.toFixed(1)}</td><td className="num">{t.impact > 0 ? t.impact.toFixed(1) : '·'}</td>
              </tr>
            ))}</tbody>
          </table></div>
          {!stats.length && <p className="muted">No theme matched. Add keywords below.</p>}
        </div>
      </div>

      {openRule && <ThemeDetail rule={openRule} reviews={rs.filter(r => a.themesOf(r).includes(openRule.id))} onClose={() => setOpen(null)} />}

      <div className="grid-2">
        <div className="card pad">
          <h2 className="h4">Term clusters</h2>
          <p className="muted small">TF-IDF over 1 to 3 star reviews: the words and phrases that set complaints apart, whether or not a rule covers them.</p>
          <ul className="clusters">
            {a.clusters.map(c => <li key={c.terms[0]}><span className="cl-terms">{c.terms.map(t => <span key={t} className="chip">{t}</span>)}</span><span className="muted small">{c.n} reviews · {c.mean.toFixed(1)}★</span><span className="small cl-ex">“{(c.reviews[0].title + '. ' + c.reviews[0].body).slice(0, 130)}”</span></li>)}
            {!a.clusters.length && <li className="muted">Not enough low-rated reviews to cluster.</li>}
          </ul>
        </div>
        <div className="card pad">
          <h2 className="h4">Feature requests</h2>
          <p className="muted small">Sentences with “please add”, “I wish”, “would be great if” and similar, grouped by topic.</p>
          <ul className="requests">
            {a.requests.slice(0, 8).map(g => <li key={g.topic}><div className="row between"><b>{g.topic}</b><span className="muted small">{plural(g.n, 'request')}</span></div>{g.examples.slice(0, 2).map((x, i) => <q key={i} className="small block">{x.text}</q>)}</li>)}
            {!a.requests.length && <li className="muted">No requests found.</li>}
          </ul>
        </div>
      </div>

      <RuleEditor p={p} />
    </div>
  )
}

function ThemeDetail({ rule, reviews, onClose }: { rule: ThemeRule; reviews: Review[]; onClose(): void }) {
  return (
    <div className="card pad">
      <div className="row between"><h2 className="h4">{rule.label} · {plural(reviews.length, 'review')}</h2><button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>×</button></div>
      <ul className="review-list compact">
        {reviews.slice(0, 12).map(r => <li key={r.id}><Stars value={r.rating} size={12} /> <b>{r.title}</b> <span className="muted small">{r.version} · {r.country.toUpperCase()} · {fmtDate(r.date)}</span><p className="small">{highlight(r.body, matchedKeywords(r, rule))}</p></li>)}
      </ul>
    </div>
  )
}

function highlight(text: string, words: string[]) {
  if (!words.length) return text
  const re = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig')
  return text.split(re).map((part, i) => i % 2 ? <mark key={i} className="hl">{part}</mark> : part)
}

function RuleEditor({ p }: { p: Project }) {
  const [label, setLabel] = useState('')
  const [kws, setKws] = useState('')
  const set = (rules: ThemeRule[]) => void update(p, { rules })
  return (
    <details className="card pad rules">
      <summary><h2 className="h4 inline">Theme rules</h2> <span className="muted small">{p.rules.filter(r => r.enabled).length} active · edit keywords, disable, or add your own</span></summary>
      <p className="muted small">A review joins a theme when any phrase appears as whole words in its title or text. Matching ignores case and punctuation.</p>
      <div className="rule-grid">
        {p.rules.map(r => (
          <div key={r.id} className={`rule${r.enabled ? '' : ' off'}`}>
            <div className="row between gap-sm">
              <label className="check-field"><input type="checkbox" checked={r.enabled} onChange={e => set(p.rules.map(x => x.id === r.id ? { ...x, enabled: e.target.checked } : x))} /> <b>{r.label}</b></label>
              {!r.builtin && <button type="button" className="btn danger-ghost sm" onClick={() => { const prev = p.rules; set(p.rules.filter(x => x.id !== r.id)); toast(`Removed ${r.label}.`, { undo: () => void saveProject({ ...getProject(p.id)!, rules: prev }) }) }}>Remove</button>}
            </div>
            <label className="sr-only" htmlFor={`kw-${r.id}`}>Keywords for {r.label}</label>
            <textarea id={`kw-${r.id}`} rows={2} defaultValue={r.keywords.join(', ')} onBlur={e => { const k = e.target.value.split(',').map(x => x.trim().toLowerCase()).filter(Boolean); if (k.join() !== r.keywords.join()) set(p.rules.map(x => x.id === r.id ? { ...x, keywords: k } : x)) }} />
          </div>
        ))}
      </div>
      <form className="row gap-sm wrap add-rule" onSubmit={e => {
        e.preventDefault()
        const k = kws.split(',').map(x => x.trim().toLowerCase()).filter(Boolean)
        if (!label.trim() || !k.length) { toast('Give the theme a name and at least one keyword.', { tone: 'error' }); return }
        let id = slug(label)
        while (p.rules.some(r => r.id === id)) id += '-2'
        set([...p.rules, { id, label: label.trim(), keywords: k, enabled: true }])
        setLabel(''); setKws('')
        toast(`Added theme ${label.trim()}.`, { tone: 'ok' })
      }}>
        <label className="field"><span>New theme</span><input value={label} onChange={e => setLabel(e.target.value)} placeholder="Apple Watch" /></label>
        <label className="field grow"><span>Keywords, comma separated</span><input value={kws} onChange={e => setKws(e.target.value)} placeholder="watch, complication, watchos" /></label>
        <button className="btn primary sm">Add theme</button>
        <button type="button" className="btn ghost sm" onClick={() => {
          const prev = p.rules
          set(DEFAULT_RULES.map(r => ({ ...r, keywords: [...r.keywords] })))
          toast('Theme rules restored to defaults.', { undo: () => void saveProject({ ...getProject(p.id)!, rules: prev }) })
        }}>Restore defaults</button>
      </form>
    </details>
  )
}

const PAGE = 40

function Reviews({ p, a }: { p: Project; a: Analysis }) {
  const [f, setF] = useState({ version: 'all', rating: 'all', theme: 'all', q: '', status: 'all' })
  const [page, setPage] = useState(1)
  const set = (patch: Partial<typeof f>) => { setF({ ...f, ...patch }); setPage(1) }
  const list = useMemo(() => a.reviews.filter(r =>
    (f.version === 'all' || r.version === f.version) &&
    (f.rating === 'all' || (f.rating === 'low' ? r.rating <= 2 : String(r.rating) === f.rating)) &&
    (f.theme === 'all' || (f.theme === 'none' ? !a.themesOf(r).length : a.themesOf(r).includes(f.theme))) &&
    (f.status === 'all' || (f.status === 'todo' ? !p.replied.includes(r.id) && r.rating <= 3 : f.status === 'replied' ? p.replied.includes(r.id) : mismatch(r.rating, sentiment(r.title + ' ' + r.body).comparative))) &&
    (!f.q || (r.title + ' ' + r.body + ' ' + r.author).toLowerCase().includes(f.q.toLowerCase()))
  ), [a, f, p.replied])
  return (
    <div className="stack">
      <div className="filters">
        <label className="field"><span>Search</span><input type="search" value={f.q} onChange={e => set({ q: e.target.value })} placeholder="Words in the review" /></label>
        <label className="field"><span>Version</span><select value={f.version} onChange={e => set({ version: e.target.value })}><option value="all">All</option>{[...a.series].reverse().map(s => <option key={s.version}>{s.version}</option>)}</select></label>
        <label className="field"><span>Rating</span><select value={f.rating} onChange={e => set({ rating: e.target.value })}><option value="all">All</option><option value="low">1 to 2 stars</option>{[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{n} star{n > 1 ? 's' : ''}</option>)}</select></label>
        <label className="field"><span>Theme</span><select value={f.theme} onChange={e => set({ theme: e.target.value })}><option value="all">All</option>{p.rules.filter(r => r.enabled).map(r => <option key={r.id} value={r.id}>{r.label}</option>)}<option value="none">No theme</option></select></label>
        <label className="field"><span>Status</span><select value={f.status} onChange={e => set({ status: e.target.value })}><option value="all">All</option><option value="todo">Needs a reply (1-3★)</option><option value="replied">Replied</option><option value="mismatch">Text disagrees with stars</option></select></label>
      </div>
      <div className="row between wrap gap-sm"><span className="muted small">{plural(list.length, 'review')}</span><button type="button" className="btn ghost sm" onClick={() => download(`${slug(p.name)}-reviews-filtered.csv`, reviewsCsv(list, a.themesOf))}>Export these as CSV</button></div>
      {!list.length ? <Empty title="No reviews match"><p className="muted">Clear a filter to see more.</p></Empty> : (
        <ul className="review-list">
          {list.slice(0, page * PAGE).map(r => <ReviewItem key={r.id + r.appId} r={r} p={p} a={a} />)}
        </ul>
      )}
      {list.length > page * PAGE && <button type="button" className="btn ghost block" onClick={() => setPage(page + 1)}>Show {Math.min(PAGE, list.length - page * PAGE)} more</button>}
    </div>
  )
}

function ReviewItem({ r, p, a }: { r: Review; p: Project; a: Analysis }) {
  const [open, setOpen] = useState(false)
  const themes = a.themesOf(r)
  const s = sentiment(`${r.title} ${r.body}`)
  const replied = p.replied.includes(r.id)
  const ctx = { appName: a.app.name, developer: a.app.developer, supportEmail: p.reply.supportEmail || 'support@yourapp.com', signature: p.reply.signature, fixedIn: p.reply.fixedIn || undefined }
  const [text, setText] = useState(() => draftReply(r, themes, ctx).text)
  const issues = checkReply(text)
  return (
    <li className={`review${replied ? ' replied' : ''}`}>
      <div className="rv-head">
        <Stars value={r.rating} />
        <b className="rv-title">{r.title || '(no title)'}</b>
        <span className="muted small">{r.author} · v{r.version} · {countryName(r.country)} · {fmtDate(r.date)}</span>
      </div>
      <p>{r.body}</p>
      <div className="row wrap gap-sm">
        {themes.map(t => <span key={t} className="chip theme">{p.rules.find(x => x.id === t)?.label ?? t}</span>)}
        <span className={`chip ${s.comparative > 0.15 ? 'pos' : s.comparative < -0.15 ? 'neg' : ''}`} title={s.hits.length ? `Words: ${s.hits.join(', ')}` : 'No lexicon words'}>sentiment {s.comparative > 0 ? '+' : ''}{s.comparative.toFixed(2)}</span>
        {mismatch(r.rating, s.comparative) && <span className="chip warn">text disagrees with stars</span>}
        <span className="grow" />
        <button type="button" className="btn ghost sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide reply' : replied ? 'Replied ✓' : 'Draft reply'}</button>
      </div>
      {open && (
        <div className="reply">
          <label className="sr-only" htmlFor={`reply-${r.id}`}>Reply to {r.author}</label>
          <textarea id={`reply-${r.id}`} rows={5} value={text} onChange={e => setText(e.target.value)} maxLength={RESPONSE_LIMIT} />
          <div className="row between wrap gap-sm">
            <span className={`small ${issues.length ? 'warn-t' : 'muted'}`}>{text.length.toLocaleString()} / {RESPONSE_LIMIT.toLocaleString()} characters{issues.length ? ` · ${issues.join(' · ')}` : ''}</span>
            <div className="row gap-sm">
              <button type="button" className="btn ghost sm" onClick={() => setText(draftReply(r, themes, ctx).text)}>Reset</button>
              <CopyButton text={text} />
              <button type="button" className="btn primary sm" onClick={() => {
                const next = replied ? p.replied.filter(x => x !== r.id) : [...p.replied, r.id]
                void update(p, { replied: next })
                if (!replied) toast('Marked as replied. Paste the reply in App Store Connect → Ratings and Reviews.', { tone: 'ok' })
              }}>{replied ? 'Mark not replied' : 'Mark replied'}</button>
            </div>
          </div>
        </div>
      )}
    </li>
  )
}

function Actions({ p, a }: { p: Project; a: Analysis }) {
  const notes = releaseNotes(a.fix.filter(f => p.addressed.includes(f.id)), [...new Set(a.reviews.filter(r => r.rating <= 2).map(r => r.country))].length === 1 ? [a.reviews[0].country] : [])
  const toggle = (id: string) => void update(p, { addressed: p.addressed.includes(id) ? p.addressed.filter(x => x !== id) : [...p.addressed, id] })
  const setReply = (patch: Partial<Project['reply']>) => void update(p, { reply: { ...p.reply, ...patch } })
  const todo = a.reviews.filter(r => r.rating <= 3 && !p.replied.includes(r.id)).length
  const themeCsv = () => toCsv([['theme', 'reviews', 'share', 'avg_rating', 'stars_lost'], ...a.themes.map(t => [t.label, t.n, t.share.toFixed(4), t.mean.toFixed(3), t.impact.toFixed(3)])])
  const impactCsv = () => toCsv([['version', 'released', 'previous', 'reviews_before', 'reviews_after', 'mean_before', 'mean_after', 'change', 'ci_low', 'ci_high', 'one_star_before', 'one_star_after', 'verdict'],
    ...a.impact.map(i => [i.version, i.date, i.prev, i.before.n, i.after.n, i.before.mean.toFixed(3), i.after.mean.toFixed(3), i.diff.toFixed(3), i.diffCi[0].toFixed(3), i.diffCi[1].toFixed(3), i.before.oneStar.toFixed(4), i.after.oneStar.toFixed(4), i.verdict])])
  return (
    <div className="stack-lg">
      <div className="grid-2">
        <div className="card pad">
          <h2 className="h4">What to fix next</h2>
          <p className="muted small">Ranked by mentions × stars lost, boosted when the theme grew in {a.latest ?? 'the latest version'}. Tick what the next release addresses.</p>
          <ol className="fix-list">
            {a.fix.map((f, i) => (
              <li key={f.id}>
                <label className="check-field"><input type="checkbox" checked={p.addressed.includes(f.id)} onChange={() => toggle(f.id)} /><span className="fix-rank">{i + 1}</span><b>{f.label}</b></label>
                <span className="muted small">{f.why}</span>
                <span className="fix-bar" style={{ ['--w' as string]: `${(f.score / a.fix[0].score) * 100}%` }} />
              </li>
            ))}
            {!a.fix.length && <li className="muted">No theme is pulling the rating down. Nice.</li>}
          </ol>
        </div>
        <div className="card pad stack-sm">
          <h2 className="h4">Release notes draft</h2>
          {notes ? <><pre className="notes-pre">{notes}</pre><div className="row gap-sm"><CopyButton text={notes} label="Copy release notes" /></div></> : <p className="muted">Tick the themes your next release fixes to draft “What’s New” lines.</p>}
          <hr />
          <h3 className="h5">Reply settings</h3>
          <div className="row gap wrap">
            <label className="field"><span>Support email</span><input type="email" value={p.reply.supportEmail} onChange={e => setReply({ supportEmail: e.target.value })} placeholder="support@yourapp.com" /></label>
            <label className="field"><span>Fixed in version</span><input className="short" value={p.reply.fixedIn} onChange={e => setReply({ fixedIn: e.target.value })} placeholder="3.3" /></label>
          </div>
          <label className="field"><span>Signature</span><input value={p.reply.signature} onChange={e => setReply({ signature: e.target.value })} placeholder={`The ${a.app.name} team`} /></label>
          <p className="muted small">{todo} reviews at 3 stars or below have no reply yet. <Link href={`/app/p/${p.id}/reviews`}>Draft replies</Link></p>
        </div>
      </div>

      <div className="card pad">
        <h2 className="h4">Replying in App Store Connect</h2>
        <ul className="small guide">
          <li>Paste replies in App Store Connect → your app → Ratings and Reviews, or post them with the App Store Connect API (<code>customerReviewResponses</code>).</li>
          <li>Up to {RESPONSE_LIMIT.toLocaleString()} characters. One response per review; you can edit it later and the latest version shows.</li>
          <li>Responses are public. The reviewer gets a notification and can update their review.</li>
          <li>Be specific and courteous, leave out personal data, and never offer anything for a better rating.</li>
          <li className="muted">Rules as of {RESPONSE_RULES_DATE}. Check Apple’s current guidance before relying on them.</li>
        </ul>
      </div>

      <div className="card pad">
        <h2 className="h4">Export</h2>
        <div className="row gap-sm wrap">
          <button type="button" className="btn ghost sm" onClick={() => download(`${slug(p.name)}-reviews.csv`, reviewsCsv(a.reviews, a.themesOf))}>All reviews with themes (CSV)</button>
          <button type="button" className="btn ghost sm" onClick={() => download(`${slug(p.name)}-themes.csv`, themeCsv())}>Theme summary (CSV)</button>
          <button type="button" className="btn ghost sm" onClick={() => download(`${slug(p.name)}-release-impact.csv`, impactCsv())}>Release impact (CSV)</button>
          <Link href={`/app/p/${p.id}/report`} className="btn primary sm">Printable release health report</Link>
        </div>
      </div>
    </div>
  )
}

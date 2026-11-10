import { useEffect, useMemo, useState } from 'react'
import type { Impact, VersionPoint } from './engine/stats.ts'
import { countryName } from './engine/reviews.ts'
import { fmtDate, fmtPct } from './ui.tsx'

/** Rating colour: red at 1 star, amber at 3, green at 5. */
export function ratingColor(m: number): string {
  const t = Math.max(0, Math.min(1, (m - 1) / 4))
  const hue = t < 0.5 ? 4 + t * 2 * 36 : 40 + (t - 0.5) * 2 * 95
  return `hsl(${hue.toFixed(0)} 78% ${t < 0.5 ? 52 : 42}%)`
}

/** True below 600px wide, so charts can draw with fewer, larger units on phones. */
export function useNarrow() {
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 600px)').matches)
  useEffect(() => {
    const m = matchMedia('(max-width: 600px)')
    const f = () => setNarrow(m.matches)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [])
  return narrow
}

export function Timeline({ series, impact = [], selected, onSelect, height = 300, compact }: { series: VersionPoint[]; impact?: Impact[]; selected?: string | null; onSelect?(v: string): void; height?: number; compact?: boolean }) {
  const narrow = useNarrow()
  const W = narrow ? 420 : 760, H = height, padL = 36, padR = 16, top = 22, chartH = H - (compact ? 64 : 130), barTop = top + chartH + 34
  const n = series.length
  const x = (i: number) => padL + (n <= 1 ? (W - padL - padR) / 2 : (i * (W - padL - padR)) / (n - 1))
  const lo = Math.max(1, Math.floor(Math.min(...series.map(s => s.ci[0]), 4) * 2) / 2 - 0.25)
  const y = (v: number) => top + ((5 - v) / (5 - lo)) * chartH
  const maxN = Math.max(...series.map(s => s.n), 1)
  const band = series.length > 1 ? `M${series.map((s, i) => `${x(i)},${y(s.ci[1])}`).join('L')}L${series.map((s, i) => `${x(i)},${y(s.ci[0])}`).reverse().join('L')}Z` : ''
  const line = series.map((s, i) => `${i ? 'L' : 'M'}${x(i)},${y(s.mean)}`).join('')
  const ticks = [5, 4, 3, 2, 1].filter(t => t >= lo)
  const label = (s: VersionPoint) => `Version ${s.version}, ${fmtDate(s.date)}: ${s.mean.toFixed(2)} stars from ${s.n} reviews, 95% interval ${s.ci[0].toFixed(2)} to ${s.ci[1].toFixed(2)}, ${fmtPct(s.oneStar)} one-star`
  if (!n) return <div className="chart-empty">No versioned reviews yet.</div>
  return (
    <svg className="timeline" viewBox={`0 0 ${W} ${compact ? top + chartH + 30 : H}`} role="group" aria-label="Average rating by app version with 95% intervals">
      {ticks.map(t => <g key={t}><line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="grid" /><text x={padL - 10} y={y(t) + 4} className="axis" textAnchor="end">{t}★</text></g>)}
      {band && <path d={band} className="band" />}
      <path d={line} className="line" />
      {series.map((s, i) => {
        const imp = impact.find(m => m.version === s.version)
        const r = 5 + 9 * Math.sqrt(s.n / maxN)
        const sel = s.version === selected
        const bh = s.oneStar * 46
        return (
          <g key={s.version} className={`pt${sel ? ' sel' : ''}${onSelect ? ' clickable' : ''}`} tabIndex={onSelect ? 0 : -1} role={onSelect ? 'button' : 'img'} aria-pressed={onSelect ? sel : undefined} aria-label={label(s)}
            onClick={() => onSelect?.(s.version)} onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && onSelect) { e.preventDefault(); onSelect(s.version) } }}>
            <title>{label(s)}</title>
            <rect x={x(i) - 22} y={top - 10} width="44" height={H - top} className="hit" />
            {sel && <line x1={x(i)} x2={x(i)} y1={top - 8} y2={top + chartH} className="sel-line" />}
            <circle cx={x(i)} cy={y(s.mean)} r={r} fill={ratingColor(s.mean)} className="dot" />
            {imp?.verdict === 'worse' && <text x={x(i)} y={y(s.ci[1]) - 10} textAnchor="middle" className="verdict worse">▼ {imp.diff.toFixed(2)}</text>}
            {imp?.verdict === 'better' && <text x={x(i)} y={y(s.ci[1]) - 10} textAnchor="middle" className="verdict better">▲ +{imp.diff.toFixed(2)}</text>}
            {(!narrow || n <= 6 || sel || (n - 1 - i) % 2 === 0) && <text x={x(i)} y={top + chartH + 20} textAnchor="middle" className={`vlabel${sel ? ' on' : ''}`}>{s.version}</text>}
            {!compact && <>
              <rect x={x(i) - 9} y={barTop + 46 - bh} width="18" height={Math.max(bh, 1)} rx="3" className="onebar" />
              {(!narrow || n <= 6 || (n - 1 - i) % 2 === 0) && <text x={x(i)} y={barTop + 60} textAnchor="middle" className="axis">{fmtPct(s.oneStar)}</text>}
            </>}
          </g>
        )
      })}
      {!compact && <text x={padL - 10} y={barTop + 30} className="axis" textAnchor="end">1★ %</text>}
    </svg>
  )
}

/** First word of the label, shrunk to fit the circle, and abbreviated if it still would not fit at 9px. */
function bubbleFont(label: string, r: number) {
  const w = label.split(' ')[0]
  const size = Math.min(15, (r * 1.8) / (w.length * 0.6))
  if (size >= 9) return { size, text: w }
  return { size: 9, text: w.slice(0, Math.max(2, Math.floor((r * 1.8) / (9 * 0.6)) - 1)) + '.' }
}

interface Bubble { id: string; label: string; n: number; mean: number }

/** Greedy circle packing along a spiral: big themes in the middle, no overlaps. */
export function packBubbles(items: Bubble[], W: number, H: number) {
  const max = Math.max(...items.map(i => i.n), 1)
  const scale = Math.min(W, H) / 4.6
  const placed: { b: Bubble; x: number; y: number; r: number }[] = []
  for (const b of [...items].sort((a, c) => c.n - a.n)) {
    const r = Math.max(26, scale * Math.sqrt(b.n / max))
    let t = 0, px = W / 2, py = H / 2
    for (; t < 600; t += 0.35) {
      px = W / 2 + Math.cos(t) * t * 3.2 * (W / H > 1.3 ? 1.5 : 1)
      py = H / 2 + Math.sin(t) * t * 3.2
      if (px - r < 2 || px + r > W - 2 || py - r < 2 || py + r > H - 2) continue
      if (placed.every(p => Math.hypot(p.x - px, p.y - py) >= p.r + r + 4)) break
    }
    if (t < 600) placed.push({ b, x: px, y: py, r })
  }
  return placed
}

export function ThemeBubbles({ items, onPick, active, width = 520, height = 300 }: { items: Bubble[]; onPick?(id: string): void; active?: string | null; width?: number; height?: number }) {
  const placed = useMemo(() => packBubbles(items.slice(0, 10), width, height), [items, width, height])
  if (!items.length) return <div className="chart-empty">No themes matched in this release. Mostly happy reviews, or try adding rules.</div>
  return (
    <svg className="bubbles" viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Review themes; size is mentions, colour is average rating">
      {placed.map(({ b, x, y, r }, i) => (
        <g key={b.id} className={`bub${active === b.id ? ' on' : ''}${onPick ? ' clickable' : ''}`} style={{ animationDelay: `${i * 50}ms` }} tabIndex={onPick ? 0 : -1} role={onPick ? 'button' : 'img'}
          aria-label={`${b.label}: ${b.n} reviews, average ${b.mean.toFixed(1)} stars`} onClick={() => onPick?.(b.id)} onKeyDown={e => { if (e.key === 'Enter' && onPick) onPick(b.id) }}>
          <title>{`${b.label}: ${b.n} reviews, ${b.mean.toFixed(1)}★`}</title>
          <circle cx={x} cy={y} r={r} fill={ratingColor(b.mean)} />
          <text x={x} y={y + (r > 44 ? -4 : 4)} textAnchor="middle" className="bub-l" style={{ fontSize: bubbleFont(b.label, r).size }}>{bubbleFont(b.label, r).text}</text>
          {r > 44 && <text x={x} y={y + 14} textAnchor="middle" className="bub-n">{b.n}</text>}
        </g>
      ))}
    </svg>
  )
}

export function Dist({ dist }: { dist: number[] }) {
  const n = dist.reduce((a, b) => a + b, 0) || 1
  return (
    <div className="dist" role="img" aria-label={`Rating distribution: ${[5, 4, 3, 2, 1].map(s => `${s} star ${fmtPct(dist[s - 1] / n)}`).join(', ')}`}>
      {[5, 4, 3, 2, 1].map(s => (
        <div key={s} className="dist-row"><span>{s}</span><div className="dist-track"><i style={{ width: `${(dist[s - 1] / n) * 100}%` }} className={`d${s}`} /></div><span className="muted">{fmtPct(dist[s - 1] / n)}</span></div>
      ))}
    </div>
  )
}

export function CountryHeat({ cells, versions }: { cells: { version: string; country: string; n: number; mean: number }[]; versions: string[] }) {
  const countries = [...new Set(cells.map(c => c.country))]
  const vs = versions.filter(v => cells.some(c => c.version === v)).slice(-8)
  if (!countries.length) return null
  return (
    <div className="table-wrap">
      <table className="heat">
        <caption className="sr-only">Average rating by version and country</caption>
        <thead><tr><th scope="col">Country</th>{vs.map(v => <th key={v} scope="col">{v}</th>)}</tr></thead>
        <tbody>
          {countries.map(c => (
            <tr key={c}>
              <th scope="row">{countryName(c)}</th>
              {vs.map(v => {
                const cell = cells.find(x => x.country === c && x.version === v)
                return <td key={v} style={cell && cell.n >= 3 ? { background: `color-mix(in srgb, ${ratingColor(cell.mean)} 26%, transparent)` } : undefined} title={cell ? `${cell.n} reviews` : 'No reviews'}>
                  {cell ? <><b>{cell.mean.toFixed(1)}</b><small>{cell.n}</small></> : <span className="muted">·</span>}
                </td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

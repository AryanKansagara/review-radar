import { useState } from 'react'
import { COUNTRIES } from './engine/reviews.ts'
import { getDefaults, resetDefaults, setDefaults, type Defaults } from './store.ts'
import { setTheme, toast, useDark } from './ui.tsx'
import { useSync } from './sync.ts'

export default function Settings() {
  const [d, setD] = useState<Defaults>(getDefaults)
  const dark = useDark()
  const s = useSync()
  const save = (patch: Partial<Defaults>) => { const n = { ...d, ...patch }; setD(n); setDefaults(n) }
  return (
    <section className="page narrow">
      <p className="eyebrow">Settings</p>
      <h1>Settings</h1>
      <div className="card pad stack">
        <h2 className="h4">Fetching</h2>
        <fieldset className="countries">
          <legend className="small muted">Default countries for new projects</legend>
          {COUNTRIES.map(([c, n]) => <label key={c} className="chip-check"><input type="checkbox" checked={d.countries.includes(c)} onChange={() => save({ countries: d.countries.includes(c) ? d.countries.filter(x => x !== c) : [...d.countries, c] })} /> {n}</label>)}
        </fieldset>
        <label className="field"><span>Pages per country (50 reviews each, max 10)</span><input type="number" min={1} max={10} value={d.pages} onChange={e => save({ pages: Math.min(10, Math.max(1, Math.round(+e.target.value || 1))) })} /></label>
      </div>
      <div className="card pad stack">
        <h2 className="h4">Reply defaults</h2>
        <label className="field"><span>Support email</span><input type="email" value={d.supportEmail} onChange={e => save({ supportEmail: e.target.value })} placeholder="support@yourapp.com" /></label>
        <label className="field"><span>Signature</span><input value={d.signature} onChange={e => save({ signature: e.target.value })} placeholder="Sam, developer of Streakly" /></label>
        <p className="muted small">Saved as you type. Existing projects keep their own settings (Actions tab).</p>
      </div>
      <div className="card pad stack">
        <h2 className="h4">Appearance</h2>
        <div className="seg" role="group" aria-label="Theme">
          <button type="button" aria-pressed={!dark} onClick={() => setTheme('light')}>Light</button>
          <button type="button" aria-pressed={dark} onClick={() => setTheme('dark')}>Dark</button>
        </div>
      </div>
      <div className="card pad stack">
        <h2 className="h4">Keyboard</h2>
        <ul className="small kbd-list"><li><kbd>N</kbd> new project (Projects page)</li><li><kbd>1</kbd> to <kbd>7</kbd> switch project tabs</li><li><kbd>⌘</kbd> <kbd>Z</kbd> undo the last delete</li><li><kbd>Esc</kbd> close dialogs and menus</li></ul>
      </div>
      <div className="card pad stack">
        <h2 className="h4">Sync</h2>
        <p className="muted small">{s.user ? `Signed in as ${s.user.email}. Use the account menu in the header to sync, export, or delete cloud data.` : 'Signed out. Everything is stored in this browser. Sign in from the account menu to sync across devices.'}</p>
        <button type="button" className="btn ghost sm" onClick={() => { const prev = d; resetDefaults(); setD(getDefaults()); toast('Defaults restored.', { undo: () => { setDefaults(prev); setD(prev) } }) }}>Restore default settings</button>
      </div>
    </section>
  )
}

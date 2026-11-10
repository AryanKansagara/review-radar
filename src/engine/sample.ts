// Two synthetic apps (fictional names, generated reviews). Deterministic, so they are rebuilt instead of stored.
import { rng } from './stats.ts'
import type { AppInfo, Review, VersionInfo } from './types.ts'

export interface Sample { id: string; name: string; blurb: string; app: AppInfo; competitor?: AppInfo; versions: VersionInfo[]; countries: string[] }

const PRAISE = [
  ['Changed my mornings', 'I have kept a 200 day streak with this. Simple, clean and it just works.'],
  ['Best habit app', 'Tried five others, this is the one that stuck. The widgets are great.'],
  ['Love it', 'Easy to use and beautiful. Reminders are perfectly timed.'],
  ['Exactly what I needed', 'No clutter, fast, and the stats keep me motivated. Highly recommend.'],
  ['Solid', 'Works well, syncs to my iPad without fuss. Thanks to the developer.'],
  ['Great app', 'Really helpful for building routines. Would be great if you added an Apple Watch complication.'],
  ['So good', 'Smooth and reliable. Please add a dark mode for the calendar view.'],
]
const MEH = [
  ['Decent', 'Does the job. I wish there was a way to export my history to CSV.'],
  ['Good but', 'Nice app, but the reminders sometimes fire late. Please add custom snooze times.'],
  ['Okay', 'Fine for basics. It would be nice if habits could repeat every other day.'],
]
const PAYWALL = [
  ['Paywall ruined it', 'After the update half the features I used for free are now behind a subscription. $39.99 per year for a habit tracker is a cash grab.'],
  ['Used to love this', 'Since the update you need premium for more than three habits. Uninstalling.'],
  ['Subscription now?', 'I paid for the lifetime unlock years ago and now it asks me to subscribe again. Please honor what I paid for.'],
  ['Greedy', 'The new paywall pops up every time I open the app. Money grab, plain and simple.'],
  ['Not worth the price', 'Premium is too expensive for what it is. Bring back the old free version.'],
  ['Disappointed', 'Streak history is now locked behind a paywall. Terrible move.'],
  ['Free trial trap', 'Free trial converted and I was charged without a clear warning. Want a refund.'],
]
const UI_CHANGE = [
  ['New design is confusing', 'The new layout moved the check-in button and it is harder to find everything. Bring back the old design.'],
  ['Cluttered', 'The redesign added upsell banners everywhere. The interface used to be clean.'],
]
const SYNC = [
  ['Sync broke', 'Since the update my habits do not sync between iPhone and iPad. Lost my data for last week.'],
]

const PHOTO_PRAISE = [
  ['Pro level editing', 'The curves and masking tools are fantastic. Best editor on iPhone.'],
  ['Beautiful app', 'Fast, intuitive, and the film presets are gorgeous.'],
  ['Worth it', 'Replaced Lightroom for me. Raw support is excellent.'],
  ['Great', 'Love the new healing brush. Please add batch export.'],
  ['Very good', 'Solid editor, would be great if it had a widget for recent edits.'],
]
const CRASH = [
  ['Crashes on launch', 'Since the update it crashes immediately when I open it. iPhone 13, iOS 26. Unusable.'],
  ['Stürzt ab / crashes', 'App crashes on startup after the latest update. Cannot open it at all.'],
  ['Won’t open', 'Black screen then it closes itself. Reinstalled twice, still crashing.'],
  ['Broken after update', 'Stopped working after updating. Crashes every time on launch.'],
  ['Please fix', 'Paid for pro and now it will not open. Crash on launch every time.'],
]
const PHOTO_MEH = [
  ['Slow export', 'Exports are slow and laggy on big raw files. Otherwise good.'],
  ['Battery', 'Drains battery quickly while editing and the phone gets hot.'],
]

function info(id: string, name: string, developer: string, genre: string, version: string, date: string, rating: number, notes: string): AppInfo {
  return { id, name, developer, icon: '', genre, version, releaseNotes: notes, currentVersionReleaseDate: date + 'T08:00:00Z', rating, ratingCount: 18400, currentVersionRating: null, currentVersionRatingCount: null, url: '' }
}

export const SAMPLES: Sample[] = [
  {
    id: 'habit', name: 'Streakly: Habit Tracker', blurb: 'Habit tracker. Rating falls from 4.7 to 3.9 after the v3.2 paywall change.',
    app: info('900000001', 'Streakly: Habit Tracker', 'Fernhill Apps (synthetic)', 'Health & Fitness', '3.3', '2026-10-20', 4.4, 'Clearer Premium screen and fixes for sync.'),
    competitor: info('900000003', 'Tally Habits', 'North Pier (synthetic)', 'Health & Fitness', '2.8', '2026-10-01', 4.6, 'Bug fixes.'),
    versions: [
      { version: '3.0', date: '2026-06-02', notes: 'New widgets', origin: 'listed' },
      { version: '3.1', date: '2026-07-14', notes: 'Streak freezes', origin: 'listed' },
      { version: '3.2', date: '2026-08-25', notes: 'Introducing Streakly Premium. New look.', origin: 'listed' },
      { version: '3.3', date: '2026-10-20', notes: 'Clearer Premium screen and sync fixes.', origin: 'listed' },
    ],
    countries: ['us', 'gb', 'ca', 'au'],
  },
  {
    id: 'photo', name: 'Lumen Darkroom', blurb: 'Photo editor. Version 5.4 crashes on launch, almost only in Germany.',
    app: info('900000002', 'Lumen Darkroom', 'Halide Bay Studio (synthetic)', 'Photo & Video', '5.4.1', '2026-10-28', 4.5, 'Fixes a crash on launch for some languages.'),
    versions: [
      { version: '5.2', date: '2026-07-01', origin: 'listed' },
      { version: '5.3', date: '2026-08-12', origin: 'listed' },
      { version: '5.4', date: '2026-09-30', notes: 'Healing brush, localisation updates', origin: 'listed' },
      { version: '5.4.1', date: '2026-10-28', notes: 'Fixes a crash on launch for some languages', origin: 'listed' },
    ],
    countries: ['us', 'de', 'gb', 'fr'],
  },
]

const NAMES = ['mkr', 'JoJo', 'sunny_days', 'Pat W', 'runner88', 'ellie', 'Ben', 'quietfox', 'Ana M', 'tomasz', 'Kiki', 'drew', 'mapleleaf', 'Lena', 'ozzie', 'Sam K']
const pick = <T,>(xs: T[], r: () => number) => xs[Math.floor(r() * xs.length)]

/** Builds the review set for a sample app. Each review lands within its version's window. */
export function sampleReviews(id: string): Review[] {
  const s = SAMPLES.find(x => x.id === id)
  if (!s) return []
  const r = rng(id === 'habit' ? 42 : 99)
  const out: Review[] = []
  const end = Date.parse('2026-11-08T00:00:00Z')
  s.versions.forEach((v, vi) => {
    const start = Date.parse(v.date + 'T09:00:00Z')
    const stop = vi + 1 < s.versions.length ? Date.parse(s.versions[vi + 1].date + 'T09:00:00Z') : end
    for (const country of s.countries) {
      const n = Math.round((country === 'us' ? 46 : 18) * (0.85 + r() * 0.3))
      for (let i = 0; i < n; i++) {
        let pool: string[][], rating: number
        const u = r()
        if (s.id === 'habit') {
          // 3.0/3.1 mean about 4.7; 3.2 drops to about 3.9; 3.3 recovers a little.
          const bad = v.version === '3.2' ? 0.25 : v.version === '3.3' ? 0.19 : 0.02
          if (u < bad) { pool = r() < 0.75 ? PAYWALL : r() < 0.7 ? UI_CHANGE : SYNC; rating = r() < 0.7 ? 1 : 2 }
          else if (u < bad + 0.1) { pool = MEH; rating = 3 + (r() < 0.4 ? 1 : 0) }
          else { pool = PRAISE; rating = r() < 0.92 ? 5 : 4 }
        } else {
          const crash = v.version === '5.4' ? (country === 'de' ? 0.62 : 0.04) : v.version === '5.4.1' && country === 'de' ? 0.08 : 0
          if (u < crash) { pool = CRASH; rating = r() < 0.85 ? 1 : 2 }
          else if (u < crash + 0.08) { pool = PHOTO_MEH; rating = 3 }
          else { pool = PHOTO_PRAISE; rating = r() < 0.8 ? 5 : 4 }
        }
        const [title, body] = pick(pool, r)
        const t = start + r() * (stop - start)
        out.push({ id: `s${s.app.id.slice(-1)}-${v.version}-${country}-${i}`, appId: s.app.id, country, rating, version: v.version, title, body, author: pick(NAMES, r), date: new Date(t).toISOString(), source: 'sample' })
      }
    }
  })
  if (s.competitor) {
    for (let i = 0; i < 120; i++) {
      const u = r()
      const [pool, rating] = u < 0.08 ? [MEH, 3] : u < 0.13 ? [[['Ads everywhere', 'Too many ads between check-ins. Pop up ads after every habit.']], 2] : [PRAISE, r() < 0.8 ? 5 : 4]
      const [title, body] = pick(pool as string[][], r)
      out.push({ id: `c3-${i}`, appId: s.competitor.id, country: 'us', rating: rating as number, version: r() < 0.5 ? '2.7' : '2.8', title, body, author: pick(NAMES, r), date: new Date(Date.parse('2026-08-01') + r() * 90 * 864e5).toISOString(), source: 'sample' })
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date))
}

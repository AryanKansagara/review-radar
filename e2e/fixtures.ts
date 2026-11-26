import { test as base, expect, type Locator, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

/** Web fonts in index.html: answered with an empty stylesheet. */
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com'])

export const test = base.extend<{ external: string[] }>({
  external: async ({}, use) => { await use([]) },

  // Only the app is reachable: any other host fails the test, and so does any uncaught page error.
  // Tests that need the App Store answer itunes.apple.com themselves with a page route (store()).
  context: async ({ context, baseURL, external }, use) => {
    const errors: string[] = []
    const origin = new URL(baseURL!).origin
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.origin === origin) return route.continue()
      if (FONT_HOSTS.has(url.host)) return route.fulfill({ status: 200, contentType: 'text/css', body: '' })
      external.push(url.host)
      return route.abort('blockedbyclient')
    })
    context.on('weberror', e => errors.push(String(e.error())))
    await use(context)
    expect(errors, 'uncaught page errors').toEqual([])
    expect(external, 'requests to hosts other than the app').toEqual([])
  },
})

export { expect }

// ---------- A stand-in for the App Store ----------

export interface FeedReview { id: string; rating: number; version?: string; title?: string; body?: string; date?: string }

/** One page of Apple's customer-reviews feed, in the layout the unit tests copy from real pages. */
export function feedPage(reviews: FeedReview[], last = 1, country = 'us') {
  return {
    feed: {
      id: { label: `https://itunes.apple.com/${country}/rss/customerreviews/id=123456789/sortby=mostrecent/json` },
      link: [{ attributes: { rel: 'last', href: `https://itunes.apple.com/${country}/rss/customerreviews/page=${last}/id=123456789/sortby=mostrecent/xml` } }],
      ...(reviews.length ? { entry: reviews.map(r => ({
        author: { name: { label: 'nick' } }, updated: { label: r.date ?? '2026-10-02T05:00:00-07:00' },
        'im:rating': { label: String(r.rating) }, 'im:version': { label: r.version ?? '2.0' },
        id: { label: r.id }, title: { label: r.title ?? 'Title' }, content: { label: r.body ?? 'Text' },
      })) } : {}),
    },
  }
}

export const APP = { trackId: 123456789, trackName: 'Pebble Notes', artistName: 'Test Maker', primaryGenreName: 'Productivity', version: '2.0', currentVersionReleaseDate: '2026-10-01T08:00:00Z', averageUserRating: 4.4, userRatingCount: 900 }
export const RIVAL = { ...APP, trackId: 987654321, trackName: 'Rival Notes', artistName: 'Other Maker' }

type Answer = unknown | { status: number }
/** Answers iTunes lookup, search and feed requests. `feed` gets the app id, country, page and how often that page was asked. */
export async function store(page: Page, feed: (q: { id: string; country: string; page: number; url: string }) => Answer | Promise<Answer>, apps: Record<string, unknown>[] = [APP]) {
  const asked: string[] = []
  await page.route('https://itunes.apple.com/**', async route => {
    const url = new URL(route.request().url())
    asked.push(url.pathname + url.search)
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
    if (url.pathname === '/lookup') return json({ results: apps.filter(a => String(a.trackId) === url.searchParams.get('id')) })
    if (url.pathname === '/search') {
      const term = url.searchParams.get('term')!.toLowerCase()
      return json({ results: apps.filter(a => String(a.trackName).toLowerCase().includes(term)) })
    }
    const m = url.pathname.match(/^\/([a-z]{2})\/rss\/customerreviews\//)!
    const a = await feed({ id: url.pathname.match(/id=(\d+)/)![1], country: m[1], page: +url.pathname.match(/page=(\d+)/)![1], url: url.pathname })
    if (a && typeof a === 'object' && 'status' in a) return route.fulfill({ status: (a as { status: number }).status, headers: { 'access-control-allow-origin': '*' }, body: 'error' })
    return json(a)
  })
  return asked
}

// ---------- Driving the app ----------

/** An import-only project, on its Data tab. Returns the project path. */
export async function importProject(page: Page): Promise<string> {
  await page.goto('/app')
  await page.getByRole('button', { name: 'Import CSV' }).click()
  await expect(page.getByText('Drop a file here')).toBeVisible()
  return new URL(page.url()).pathname.replace(/\/data$/, '')
}

/** A project for the stand-in app, on its Data tab with only the given countries ticked, not yet fetched. */
export async function appProject(page: Page, countries = ['United States']): Promise<string> {
  await page.goto('/settings')
  for (const c of ['United States', 'United Kingdom', 'Canada', 'Australia', 'Germany', 'France']) await page.getByLabel(c, { exact: true }).setChecked(countries.includes(c))
  await page.goto('/app')
  await page.getByRole('button', { name: 'New project' }).click()
  await page.getByLabel('App Store link, app id or name').fill('Pebble')
  await page.getByRole('button', { name: /Pebble Notes/ }).click()
  await expect(page.getByRole('heading', { name: 'Fetch from the App Store' })).toBeVisible()
  return new URL(page.url()).pathname.replace(/\/data$/, '')
}

export const tab = async (page: Page, name: 'Overview' | 'Themes' | 'Reviews' | 'Actions' | 'Compare' | 'History' | 'Data') => {
  const link = page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name })
  await link.click()
  await expect(link).toHaveAttribute('aria-current', 'page')
}

/** Hands a file to the import control. */
export async function upload(page: Page, name: string, data: string | Uint8Array) {
  await page.locator('details.import input[type=file]').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(data) })
}
export const ready = (page: Page) => page.locator('.validation > p')
export const issues = (page: Page) => page.locator('.validation tbody tr')

/** Uploads a file, expects `n` importable reviews, imports them and waits for the confirmation. */
export async function importFile(page: Page, name: string, data: string | Uint8Array, n: number) {
  await upload(page, name, data)
  await expect(ready(page)).toContainText(`${n} review${n === 1 ? '' : 's'} ready`)
  await page.getByRole('button', { name: /^Import \d+ reviews?$/ }).click()
  await expect(page.getByText('Drop a file here')).toBeVisible()
  await expect(page.locator('.imports li').filter({ hasText: name }).first()).toBeVisible()
}

/** Opens the version history panel and saves a list. */
export async function saveVersions(page: Page, text: string) {
  const panel = page.locator('details').filter({ has: page.getByRole('heading', { name: 'Version history' }) })
  if (!await panel.locator('textarea').isVisible()) await panel.locator('summary').click()
  await panel.locator('textarea').fill(text)
  await panel.getByRole('button', { name: 'Save version list' }).click()
  await expect(panel.locator('textarea')).toHaveValue('')
}

export const kpi = (page: Page, label: string | RegExp) => page.locator('.kpi').filter({ has: page.locator('> span', { hasText: label }) })
export const card = (page: Page, heading: string | RegExp) => page.locator('.card').filter({ has: page.getByRole('heading', { name: heading }) })
/** Cells of the table row whose header cell reads exactly `head`. */
export const row = (scope: Locator, head: string) => scope.locator('tbody tr').filter({ has: scope.page().getByRole('rowheader', { name: head, exact: true }) }).locator('td')

export async function download(page: Page, button: Locator): Promise<[string, string]> {
  const [d] = await Promise.all([page.waitForEvent('download'), button.click()])
  return [d.suggestedFilename(), await readFile(await d.path(), 'utf8')]
}

/** Reads CSV independently of the app's parser. */
export function readCsv(text: string): string[][] {
  const rows: string[][] = [[]]
  for (const m of text.matchAll(/("(?:[^"]|"")*"|[^,\r\n]*)(,|\r?\n|$)/g)) {
    if (m[0] === '' && m.index === text.length) break
    rows.at(-1)!.push(m[1].startsWith('"') ? m[1].slice(1, -1).replace(/""/g, '"') : m[1])
    if (m[2] !== ',') rows.push([])
  }
  return rows.filter(r => r.length)
}

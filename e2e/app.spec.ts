import { APP, appProject, card, download, expect, feedPage, importFile, importProject, kpi, readCsv, RIVAL, row, store, tab, test, type FeedReview } from './fixtures'

const reviews = (n: number, p: Partial<FeedReview> & { prefix?: string } = {}): FeedReview[] =>
  Array.from({ length: n }, (_, i) => ({ rating: 5, ...p, id: `${p.prefix ?? 'r'}${i}` }))

test.describe('landing', () => {
  test('the synthetic sample is drawn and opens as a project', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.radar-title')).toContainText('Streakly: Habit Tracker')
    await expect(page.locator('.radar .badge')).toHaveText('Synthetic')
    await expect(page.locator('.verdict-line')).toContainText('Down')
    await page.getByRole('button', { name: /^Version 3\.0/ }).click()
    await expect(page.locator('.radar-stats .eyebrow')).toHaveText('Version 3.0')
    await page.getByRole('button', { name: 'Open as a project' }).click()
    await expect(page.getByLabel('Project name')).toHaveValue('Streakly: Habit Tracker')
  })

  test('a live search replaces the sample, and a failed one says so and goes back to it', async ({ page }) => {
    await store(page, ({ page: p, country }) => feedPage(country === 'us' && p === 1 ? [...reviews(9), ...reviews(9, { prefix: 'o', version: '1.0', rating: 3 })] : [], 1, country))
    await page.goto('/')
    await page.getByLabel('App Store link, app id or app name').fill('https://apps.apple.com/us/app/pebble-notes/id123456789')
    await page.getByRole('button', { name: 'Analyse' }).click()
    await expect(page.locator('.radar-title')).toHaveText('Pebble Notes ')
    await expect(page.locator('.radar-head')).toContainText('18 recent reviews')
    await expect(page.locator('.verdict-line')).toContainText('Up 2.00 stars vs 1.0')
    await page.getByLabel('App Store link, app id or app name').fill('no such app')
    await page.getByRole('button', { name: 'Analyse' }).click()
    await expect(page.getByRole('alert')).toContainText('No App Store app matches "no such app". Showing the synthetic sample instead.')
    await expect(page.locator('.radar .badge')).toHaveText('Synthetic')
  })
})

test.describe('live fetch', () => {
  test('follows the page count per country, merges by id and keeps the result after a reload', async ({ page }) => {
    const asked = await store(page, ({ country, page: p }) => {
      if (country === 'gb') return feedPage(reviews(3, { prefix: 'gb', rating: 1 }), 1, 'gb')
      return feedPage(p === 1 ? reviews(50) : reviews(10, { prefix: 'p2', rating: 3 }), 2)
    })
    await appProject(page, ['United States', 'United Kingdom'])
    await expect(page.getByText('Fetched 63 new reviews (63 total).').first()).toBeVisible()
    expect(asked.filter(u => /\/us\/rss/.test(u)).length).toBe(2)
    await tab(page, 'Overview')
    // (50*5 + 10*3 + 3*1)/63 = 283/63 = 4.49
    await expect(kpi(page, 'Average of 63 reviews').locator('b')).toHaveText('4.49')
    await expect(kpi(page, 'App Store').locator('b')).toHaveText('4.4')
    await page.getByRole('button', { name: 'United Kingdom' }).click()
    await expect(kpi(page, 'Average of 3 reviews').locator('b')).toHaveText('1.00')
    await page.reload()
    await expect(kpi(page, 'Average of 63 reviews').locator('b')).toHaveText('4.49')
    await page.getByRole('link', { name: 'Fetch latest' }).click()
    await expect(page.getByText('Fetched 0 new reviews (63 total).').first()).toBeVisible()
    await tab(page, 'History')
    await expect(page.locator('.snap-list li')).toHaveCount(1)
  })

  test('a country that fails, an empty country and an outage are each named', async ({ page }) => {
    let outage = false
    await store(page, ({ country }) => outage ? feedPage([], 1, country) : country === 'gb' ? { status: 503 } : feedPage(country === 'us' ? reviews(5) : [], 1, country))
    await appProject(page, ['United States', 'United Kingdom', 'Germany'])
    await expect(page.locator('p[role=status]')).toHaveText('Fetched 5 new reviews (5 total). No response for Pebble Notes (GB). No written reviews in DE.')
    outage = true
    await page.getByRole('button', { name: 'Fetch latest reviews' }).click()
    await expect(page.locator('p[role=status]')).toContainText('Your 5 stored reviews are untouched.')
  })

  test('cancelling saves nothing', async ({ page }) => {
    let release = () => {}
    const wait = new Promise<void>(r => { release = r })
    await store(page, async ({ page: p }) => { if (p > 1) await wait; return feedPage(reviews(50, { prefix: 'p' + p }), 3) })
    await appProject(page)
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('p[role=status]')).toHaveText('Fetch cancelled. Nothing was saved.')
    release()
    await page.reload()
    await expect(page.getByText('0 reviews on this device')).toBeVisible()
  })

  test('competitors: add, fetch, compare, remove and undo', async ({ page }) => {
    await store(page, ({ id, country }) => feedPage(id === '987654321' ? [...reviews(3, { prefix: 'x', rating: 2, body: 'it crashes' }), ...reviews(1, { prefix: 'y' })] : reviews(4), 1, country), [APP, RIVAL])
    await appProject(page)
    await expect(page.getByText('Fetched 4 new reviews (4 total).').first()).toBeVisible()
    await tab(page, 'Compare')
    await page.getByRole('button', { name: 'Add competitor' }).click()
    await page.getByLabel('App Store link, app id or name').fill('rival')
    await page.getByRole('button', { name: /Rival Notes/ }).click()
    await page.getByRole('button', { name: 'Fetch now' }).click()
    await expect(page.getByText('Fetched 4 new reviews (8 total).').first()).toBeVisible()
    await tab(page, 'Compare')
    const t = page.locator('table.compare')
    // Rival: (3*2 + 5)/4 = 2.75, three of four mention crashes.
    await expect(row(t, 'Average rating')).toHaveText(['5.00', '2.75'])
    await expect(row(t, 'Crashes')).toHaveText(['0%', '75%'])
    await page.getByRole('button', { name: 'Remove Rival Notes' }).click()
    await expect(page.getByText('No competitors yet')).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(row(t, 'Average rating')).toHaveText(['5.00', '2.75'])
  })
})

test.describe('project', () => {
  const DATA = `date,rating,title,review,version,country,nickname,id
2026-10-02,1,Crashes,"Since the update, it crashes on ""launch""",5.4,de,anna,1
2026-10-03,5,Love it,Please add dark mode. Thanks,5.4,us,mkr,2
2026-10-04,2,Meh,I wish it had dark mode,5.3,us,bob,3`

  test('both samples open, every tab renders, and number keys switch tabs', async ({ page }) => {
    await page.goto('/app')
    await page.getByRole('button', { name: /^Lumen Darkroom/ }).click()
    await expect(page.locator('.banner.bad')).toContainText('cost')
    await expect(page.getByRole('heading', { name: 'By country' })).toBeVisible()
    await page.goto('/app?sample=habit')
    await expect(page.getByLabel('Project name')).toHaveValue('Streakly: Habit Tracker')
    for (const [key, text] of [['2', 'Theme map'], ['3', 'Export these as CSV'], ['4', 'What to fix next'], ['5', 'Average rating'], ['6', 'What changed'], ['7', 'synthetic sample'], ['1', 'Release impact']]) {
      await page.keyboard.press(key)
      await expect(page.getByText(text).first()).toBeVisible()
    }
  })

  test('reviews: filters, search, reply draft and its checks, replied mark after reload', async ({ page }) => {
    await importProject(page)
    await importFile(page, 'r.csv', DATA, 3)
    await tab(page, 'Reviews')
    await expect(page.locator('.review')).toHaveCount(3)
    await page.getByLabel('Rating').selectOption('low')
    await expect(page.locator('.review')).toHaveCount(2)
    await page.locator('.filters label').filter({ hasText: /^Theme/ }).locator('select').selectOption('crash')
    await expect(page.locator('.review')).toHaveCount(1)
    const [name, csv] = await download(page, page.getByRole('button', { name: 'Export these as CSV' }))
    expect(name).toBe('imported-reviews-reviews-filtered.csv')
    expect(readCsv(csv)[1]).toEqual(['1', '2026-10-02', 'de', '5.4', '1', 'Crashes', 'Since the update, it crashes on "launch"', 'anna', 'crash; update-bug', 'import'])
    await page.getByRole('button', { name: 'Draft reply' }).click()
    const box = page.getByLabel('Reply to anna')
    await expect(box).toHaveValue(/sorry Imported reviews crashed on you in version 5\.4/)
    await box.fill('TODO call 555-123-4567 and give 5 stars')
    await expect(page.locator('.reply')).toContainText('Contains a placeholder · Asks for a better rating, which Apple discourages · Looks like it contains a phone number')
    await page.getByRole('button', { name: 'Mark replied' }).click()
    await expect(page.getByRole('button', { name: 'Mark not replied' })).toBeVisible()
    await page.reload()
    await page.getByLabel('Status').selectOption('replied')
    await expect(page.locator('.review')).toHaveCount(1)
    await page.getByLabel('Search').fill('nothing like this')
    await expect(page.getByText('No reviews match')).toBeVisible()
  })

  test('themes: requests, a custom rule, and restoring the defaults', async ({ page }) => {
    await importProject(page)
    await importFile(page, 'r.csv', DATA, 3)
    await tab(page, 'Themes')
    await expect(page.locator('.requests li').first()).toContainText('dark mode')
    await expect(page.locator('.requests li').first()).toContainText('2 requests')
    await page.locator('details.rules summary').click()
    await page.getByLabel('New theme').fill('Thanks')
    await page.getByLabel('Keywords, comma separated').fill('thanks')
    await page.getByRole('button', { name: 'Add theme' }).click()
    await expect(row(card(page, /^Themes$/), 'Thanks')).toHaveText(['1', '33%', '5.0', '·'])
    await page.reload()
    await expect(row(card(page, /^Themes$/), 'Thanks')).toHaveText(['1', '33%', '5.0', '·'])
    await page.locator('details.rules summary').click()
    await page.getByRole('button', { name: 'Restore defaults' }).click()
    await expect(row(card(page, /^Themes$/), 'Thanks')).toHaveCount(0)
  })

  test('review text is shown as text, never as markup', async ({ page }) => {
    await importProject(page)
    await importFile(page, 'x.csv', 'date,rating,title,review,version,country,nickname\n2026-10-02,1,<img src=x onerror=alert(1)>,<script>throw 1</script> it crashes,"<b>9</b>",us,<i>n</i>', 1)
    for (const t of ['Overview', 'Themes', 'Reviews', 'Actions', 'History'] as const) await tab(page, t)
    await tab(page, 'Reviews')
    await expect(page.locator('.review')).toContainText('<script>throw 1</script> it crashes')
    await page.getByRole('link', { name: 'Release health report' }).first().click()
    await expect(page.locator('.sheet')).toContainText('<img src=x onerror=alert(1)>')
    await expect(page.locator('.sheet img, .sheet script, .sheet b:text-is("9")')).toHaveCount(0)
  })

  test('report: release choice, figures and themes', async ({ page }) => {
    await importProject(page)
    await importFile(page, 'r.csv', DATA, 3)
    await page.getByRole('link', { name: 'Release health report' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Imported reviews 5.4')
    await expect(page.locator('.grade')).toContainText('3.00')
    await expect(page.locator('.sheet')).toContainText('too few reviews')
    await page.getByLabel('Release').selectOption('5.3')
    await expect(page.locator('.grade')).toContainText('2.00')
    await page.goto('/app')
    await importProject(page)
    await page.getByRole('link', { name: 'Release health report' }).click()
    await expect(page.getByText('Nothing to report yet')).toBeVisible()
  })

  test('clear all reviews, delete project: both can be undone', async ({ page }) => {
    const path = await importProject(page)
    await importFile(page, 'r.csv', DATA, 3)
    await page.getByRole('button', { name: 'Clear all reviews' }).click()
    await expect(page.getByText('0 reviews on this device')).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByText('3 reviews on this device')).toBeVisible()
    await page.goto('/app')
    await page.getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByText('Track your first app')).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.locator('.proj')).toHaveCount(1)
    await page.goto(path + '/data')
    await expect(page.getByText('3 reviews on this device')).toBeVisible()
  })

  test('snapshots can be saved and deleted', async ({ page }) => {
    await importProject(page)
    await importFile(page, 'r.csv', DATA, 3)
    await tab(page, 'History')
    await page.getByRole('button', { name: 'Save snapshot now' }).click()
    await expect(page.locator('.snap-list li')).toHaveCount(2)
    await page.locator('.snap-list li').first().getByRole('button', { name: 'Delete' }).click()
    await expect(page.locator('.snap-list li')).toHaveCount(1)
  })
})

test('settings, theme, docs and unknown addresses', async ({ page }) => {
  await page.goto('/settings')
  await page.getByLabel('Support email').fill('help@example.com')
  await page.getByLabel('Germany').check()
  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await page.reload()
  await expect(page.getByLabel('Support email')).toHaveValue('help@example.com')
  await expect(page.getByLabel('Germany')).toBeChecked()
  await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'dark')
  await page.getByRole('button', { name: 'Restore default settings' }).click()
  await expect(page.getByLabel('Germany')).not.toBeChecked()
  await page.goto('/docs')
  await expect(page.getByRole('heading', { name: 'How Review Radar works' })).toBeVisible()
  for (const path of ['/nope', '/app/p/not-a-project']) {
    await page.goto(path)
    await expect(page.getByText('This page has no reviews yet')).toBeVisible()
  }
})

test('signed out: the account form is there and cloud sync makes no request', async ({ page }) => {
  await page.goto('/app')
  await page.getByRole('button', { name: 'Sign in to sync' }).click()
  await expect(page.getByRole('dialog', { name: 'Account' })).toContainText('Everything works signed out')
})

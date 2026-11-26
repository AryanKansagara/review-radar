import { card, download, expect, importFile, importProject, kpi, readCsv, row, saveVersions, tab, test } from './fixtures'

/*
 * Worked on paper. Version 1.0: eight 5-star and two 4-star reviews. Version 2.0: five 1-star ("crashes"),
 * three 2-star ("battery") and two 5-star reviews.
 *   1.0     (8*5 + 2*4)/10           = 48/10 = 4.80, no one-star
 *   2.0     (5*1 + 3*2 + 2*5)/10     = 21/10 = 2.10, five of ten one-star = 50%
 *   change  2.10 - 4.80              = -2.70
 *   all     69/20                    = 3.45, one-star 5/20 = 25%
 *   Wilson 95% for 5/20, z = 1.96, z^2 = 3.8416:
 *     centre (0.25 + 3.8416/40)/(1 + 3.8416/20) = 0.34604/1.19208 = 0.29028
 *     half   1.96*sqrt(0.25*0.75/20 + 3.8416/1600)/1.19208 = 1.96*0.10852/1.19208 = 0.17842
 *     -> 0.112 to 0.469
 *   Crashes: 5 reviews at 1.0; the other 15 average 64/15 = 4.267, so it costs 49/15 = 3.267 stars.
 *   Battery: 3 reviews at 2.0; the other 17 average 63/17 = 3.706, so it costs 29/17 = 1.706 stars.
 *   Fix score: crashes 5 * 49/15 * (1 + 4*0.5) = 49; battery 3 * 29/17 * (1 + 4*0.3) = 11.26, 23% of the first.
 */
const FIRST = ['date,rating,title,review,version,country,id',
  ...Array.from({ length: 8 }, (_, i) => `2026-08-0${i + 1},5,Lovely,Lovely notes,1.0,us,a${i}`),
  '2026-08-09,4,Nice,Nice notes,1.0,us,a8', '2026-08-10,4,Nice,Nice notes,1.0,gb,a9',
  ...Array.from({ length: 5 }, (_, i) => `2026-09-0${i + 1},1,Crash,It crashes,2.0,gb,b${i}`),
  ...Array.from({ length: 3 }, (_, i) => `2026-09-0${i + 6},2,Drain,My battery is empty,2.0,us,c${i}`),
  '2026-09-09,5,Lovely,Lovely notes,2.0,us,d0', '2026-09-10,5,Lovely,Lovely notes,2.0,us,d1'].join('\n')
/** Four more 5-star reviews on 2.1: 24 reviews, 89/24 = 3.708; crash share 5/24 = 20.8%. */
const SECOND = 'date,rating,title,review,version,country,id\n' + [1, 2, 3, 4].map(i => `2026-10-0${i},5,Lovely,Lovely notes,2.1,us,e${i}`).join('\n')

test.beforeEach(async ({ page }) => {
  await importProject(page)
  await importFile(page, 'first.csv', FIRST, 20)
  await tab(page, 'Overview')
})

test('overview: means, one-star share, Wilson interval and the verdict', async ({ page }) => {
  await expect(kpi(page, 'Average of 20 reviews').locator('b')).toHaveText('3.45')
  await expect(kpi(page, 'Latest version 2.0').locator('b')).toHaveText('2.10')
  await expect(kpi(page, 'Latest version 2.0').locator('small')).toHaveText('−2.70 vs 1.0 · worse')
  await expect(kpi(page, 'One-star share').locator('b')).toHaveText('25%')
  await expect(kpi(page, 'One-star share').locator('small')).toHaveText('95% CI 11% to 47%')
  await expect(page.locator('.banner.bad')).toContainText('Version 2.0 cost 2.70 stars against 1.0')
  const cells = row(card(page, 'Release impact'), '2.0')
  await expect(cells.nth(1)).toHaveText('10')
  await expect(cells.nth(2)).toHaveText('2.10')
  await expect(cells.nth(3)).toHaveText('−2.70')
  await expect(cells.nth(5)).toHaveText('0% → 50%')
  await expect(cells.nth(6)).toHaveText('Worse')
  // The bootstrap interval is random by design; it must bracket the hand-computed change and exclude zero.
  const [lo, hi] = (await cells.nth(4).innerText()).match(/-?\d+\.\d+/g)!.map(Number)
  expect(lo).toBeLessThan(-2.7)
  expect(hi).toBeGreaterThan(-2.7)
  expect(hi).toBeLessThan(0)
  await expect(page.getByRole('button', { name: /^Version 1\.0, Aug 1, 2026: 4\.80 stars from 10 reviews/ })).toBeVisible()
})

test('themes, what to fix and the CSV exports', async ({ page }) => {
  await tab(page, 'Themes')
  const themes = card(page, /^Themes$/)
  await expect(row(themes, 'Crashes')).toHaveText(['5', '25%', '1.0', '3.3'])
  await expect(row(themes, 'Battery and heat')).toHaveText(['3', '15%', '2.0', '1.7'])
  await expect(page.locator('.emerge').filter({ hasText: 'Crashes' })).toContainText('0% → 50%')
  await expect(page.locator('.emerge').filter({ hasText: 'Battery' })).toContainText('0% → 30%')

  await tab(page, 'Actions')
  await expect(page.locator('.fix-list li')).toHaveCount(2)
  await expect(page.locator('.fix-list li').nth(0)).toContainText('5 reviews, 3.3 stars below the rest, up 50 points in 2.0')
  await expect(page.locator('.fix-list li').nth(1)).toContainText('3 reviews, 1.7 stars below the rest, up 30 points in 2.0')
  const w = await page.locator('.fix-bar').nth(1).evaluate(e => parseFloat((e as HTMLElement).style.getPropertyValue('--w')))
  expect(w).toBeCloseTo(100 * (3 * 29 / 17 * 2.2) / 49, 6)

  const [tn, tc] = await download(page, page.getByRole('button', { name: 'Theme summary (CSV)' }))
  expect(tn).toBe('imported-reviews-themes.csv')
  expect(readCsv(tc)).toEqual([['theme', 'reviews', 'share', 'avg_rating', 'stars_lost'], ['Crashes', '5', '0.2500', '1.000', '3.267'], ['Battery and heat', '3', '0.1500', '2.000', '1.706']])
  const [, ic] = await download(page, page.getByRole('button', { name: 'Release impact (CSV)' }))
  const [head, only, ...rest] = readCsv(ic)
  expect(rest).toEqual([])
  const r = Object.fromEntries(head.map((h, i) => [h, only[i]]))
  expect(r).toMatchObject({ version: '2.0', released: '2026-09-01', previous: '1.0', reviews_before: '10', reviews_after: '10', mean_before: '4.800', mean_after: '2.100', change: '-2.700', one_star_before: '0.0000', one_star_after: '0.5000', verdict: 'worse' })
  const [, rc] = await download(page, page.getByRole('button', { name: 'All reviews with themes (CSV)' }))
  const all = readCsv(rc)
  expect(all.length).toBe(21)
  expect(all).toContainEqual(['c0', '2026-09-06', 'us', '2.0', '2', 'Drain', 'My battery is empty', '', 'battery', 'import'])

  await page.locator('.fix-list input').first().click()
  await expect(page.locator('.notes-pre')).toContainText('• Fixed a crash some people saw when opening the app')
})

test('a second import: pooled baseline, too few reviews, and the history compare', async ({ page }) => {
  await tab(page, 'Data')
  await importFile(page, 'second.csv', SECOND, 4)
  await tab(page, 'Overview')
  // 1.0 and 2.0 together hold 20 reviews at 3.45, short of 30, so both are the baseline: 5.00 - 3.45 = +1.55.
  await expect(kpi(page, 'Latest version 2.1').locator('small')).toHaveText('+1.55 vs 1.0–2.0 · too few')
  await expect(kpi(page, 'Average of 24 reviews').locator('b')).toHaveText('3.71')
  await tab(page, 'History')
  const changes = card(page, 'What changed')
  await expect(changes).toContainText('3.45 → 3.71')
  await expect(changes).toContainText('(+0.26)')
  await expect(changes).toContainText('Reviews 20 → 24')
  await expect(changes).toContainText('New version 2.1: 4 reviews at 5.00★')
  await expect(row(card(page, 'Theme share'), 'Crashes')).toHaveText(['25%', '21%', '-4 pts'])
})

test('a version list gives reviews without a version the release that was out on their date', async ({ page }) => {
  await importProject(page)
  await importFile(page, 'none.csv', 'date,rating,review\n2026-06-30,5,before\n2026-07-01,4,on the day\n2026-08-14,3,still\n2026-08-15,1,next', 4)
  await saveVersions(page, 'version,date,notes\n3.0,2026-07-01,First\n3.1,2026-08-15,"Second, with a comma"')
  await tab(page, 'Overview')
  // 3.0: 4 and 3 -> 3.50; 3.1: 1.00; the 30 June review is before every listed release and stays unassigned.
  await expect(page.getByRole('button', { name: /^Version 3\.0, Jul 1, 2026: 3\.50 stars from 2 reviews/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Version 3\.1, Aug 15, 2026: 1\.00 stars from 1 reviews/ })).toBeVisible()
  await expect(page.getByText('Second, with a comma')).toBeVisible()
  await tab(page, 'Reviews')
  await expect(page.locator('.review').filter({ hasText: 'before' })).toContainText('vunknown')
})

test('sentiment: hand-scored text', async ({ page }) => {
  await importProject(page)
  // love 4 over 2 words: 4/(5*sqrt 2) = 0.566. "not great": -3 over 2 words = -0.424, which disagrees with 5 stars.
  await importFile(page, 's.csv', 'date,rating,review\n2026-06-30,5,love it\n2026-07-01,5,not great', 2)
  await tab(page, 'Reviews')
  await expect(page.locator('.review').filter({ hasText: 'love it' })).toContainText('sentiment +0.57')
  const odd = page.locator('.review').filter({ hasText: 'not great' })
  await expect(odd).toContainText('sentiment -0.42')
  await expect(odd).toContainText('text disagrees with stars')
})

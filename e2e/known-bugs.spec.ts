// Each test states the right behaviour of an open issue and is expected to fail until that issue is fixed.
import { APP, appProject, card, download, expect, feedPage, importFile, importProject, issues, readCsv, ready, RIVAL, row, saveVersions, store, tab, test, upload, type FeedReview } from './fixtures'

const many = (n: number, p: Partial<FeedReview> = {}, prefix = 'r'): FeedReview[] => Array.from({ length: n }, (_, i) => ({ rating: 5, ...p, id: prefix + i }))

test.fail('#3 changes made while a fetch runs are kept', async ({ page }) => {
  let release = () => {}
  const wait = new Promise<void>(r => { release = r })
  let hold = true
  await store(page, async () => { if (hold) await wait; return feedPage(many(2)) })
  await appProject(page)
  await page.locator('details.import summary').click()
  await upload(page, 'own.csv', 'date,rating,review,version\n2026-09-01,1,mine,1.0')
  await page.getByRole('button', { name: 'Import 1 review' }).click()
  await expect(page.getByText('Imported 1 new review.')).toBeVisible()
  hold = false
  release()
  await expect(page.getByText('Fetched 2 new reviews').first()).toBeVisible()
  await expect(page.getByText('3 reviews on this device')).toBeVisible()
  await expect(page.locator('.imports li')).toHaveCount(1)
})

test.fail('#3 a project deleted while its fetch runs stays deleted', async ({ page }) => {
  let release = () => {}
  const wait = new Promise<void>(r => { release = r })
  await store(page, async () => { await wait; return feedPage(many(2)) })
  await appProject(page)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Projects' }).click()
  await page.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('Track your first app')).toBeVisible()
  const answered = page.waitForResponse(/itunes\.apple\.com.*rss/)
  release()
  await answered
  await page.waitForTimeout(1500)
  await expect(page.getByText('Track your first app')).toBeVisible()
})

test('#4 a quote inside an unquoted cell does not swallow the following rows', async ({ page }) => {
  await importProject(page)
  await upload(page, 'q.csv', 'date,rating,review,version\n2026-10-01,1,My 6" screen,5.4\n2026-10-02,2,Crash,5.4\n2026-10-03,3,Bad,5.4\n')
  await expect(ready(page)).toContainText('3 reviews ready')
})

test('#4 a file cut off inside a quoted cell is reported', async ({ page }) => {
  await importProject(page)
  await upload(page, 'q.csv', 'date,rating,version,review\n2026-10-01,1,5.4,fine\n2026-10-02,2,5.4,"cut off in the midd')
  await expect(ready(page)).toContainText('1 review ready')
  await expect(issues(page)).toContainText(/quote/i)
})

test('#4 a row with more cells than the header is not imported under the wrong columns', async ({ page }) => {
  await importProject(page)
  await upload(page, 'q.csv', 'date,rating,title,review,version,country\n2026-10-01,1,Crashes,Since the update, it crashes,5.4,de\n2026-10-02,2,Meh,Fine,5.4,de')
  await expect(ready(page)).toContainText('1 review ready, 1 skipped · 1 error')
})

test('#5 App Store Connect territories outside the 21 in the table are not counted as the US', async ({ page }) => {
  await importProject(page)
  const review = (id: string, territory: string) => ({ type: 'customerReviews', id, attributes: { rating: 1, title: 'T', body: 'B', reviewerNickname: 'n', createdDate: '2026-07-05T00:00:00Z', territory } })
  await upload(page, 'asc.json', JSON.stringify({ data: [review('a', 'CHE'), review('b', 'AUT'), review('c', 'POL')] }))
  await expect(page.locator('table.preview tbody td:nth-child(4)')).toHaveText(['CH', 'AT', 'PL'])
})

test.fail('#6 nothing is called emerging when there is no earlier version', async ({ page }) => {
  await importProject(page)
  await importFile(page, 'one.csv', 'date,rating,review,version\n' + Array.from({ length: 10 }, (_, i) => `2026-10-01,${i < 5 ? 1 : 5},${i < 5 ? 'It crashes' : 'Fine'} ${i},1.0`).join('\n'), 10)
  await tab(page, 'Actions')
  await expect(page.locator('.fix-list li').first()).toContainText('5 reviews, 4.0 stars below the rest')
  await expect(page.locator('.fix-list li').first()).not.toContainText('up 50 points')
})

test.fail('#2 typing at normal speed keeps every character', async ({ page }) => {
  await page.goto('/app?sample=habit')
  await tab(page, 'Actions')
  const box = page.getByLabel('Signature')
  await box.click()
  await page.keyboard.type('Sam, developer of Streakly')
  await expect(box).toHaveValue('Sam, developer of Streakly')
  const name = page.getByLabel('Project name')
  await name.click()
  await page.keyboard.press('Home')
  await page.keyboard.type('My own ')
  await expect(name).toHaveValue('My own Streakly: Habit Tracker')
})

test.fail('#8 a review that starts with a formula is exported as text', async ({ page }) => {
  await importProject(page)
  await importFile(page, 'f.csv', 'date,rating,title,review,version,nickname\n2026-10-01,1,+1,"=HYPERLINK(""https://example.com"",""x"")",1.0,@me\n2026-10-02,1,-,ok,1.0,n', 2)
  await tab(page, 'Actions')
  const [, csv] = await download(page, page.getByRole('button', { name: 'All reviews with themes (CSV)' }))
  for (const cell of readCsv(csv).flat()) expect(cell).not.toMatch(/^[=+@\t\r]|^-(?!\d)/)
})

test.fail('#9 dates: a day that does not exist and a day-first version list', async ({ page }) => {
  await importProject(page)
  await upload(page, 'd.csv', 'date,rating,review\n2026-02-30,5,a\n2026-10-03 25:99,5,b\n2026-10-03,5,c')
  await expect(ready(page)).toContainText('1 review ready, 2 skipped')
  await page.getByRole('button', { name: 'Cancel' }).click()
  const panel = page.locator('details').filter({ has: page.getByRole('heading', { name: 'Version history' }) })
  await saveVersions(page, 'version,date\n3.1,14/07/2026\n3.2,05/08/2026')
  await expect(panel.locator('.versions')).toContainText('Aug 5, 2026')
})

test.fail('#7 adding a competitor to imported reviews keeps them', async ({ page }) => {
  await store(page, () => feedPage(many(2)), [APP, RIVAL])
  await importProject(page)
  await importFile(page, 'own.csv', 'date,rating,review,version\n2026-09-01,1,mine,1.0\n2026-09-02,3,mine too,1.0', 2)
  await tab(page, 'Compare')
  await page.getByRole('button', { name: 'Add competitor' }).click()
  await page.getByLabel('App Store link, app id or name').fill('rival')
  await page.getByRole('button', { name: /Rival Notes/ }).click()
  await tab(page, 'Reviews')
  await expect(page.locator('.review')).toHaveCount(2)
})

for (const data of ['{"feed":null}', '{"data":[null]}', '{"feed":{"entry":[null]}}']) test.fail(`#10 odd JSON gets an answer: ${data}`, async ({ page }) => {
  await importProject(page)
  await upload(page, 'x.json', data)
  await expect(page.locator('.toast.error, .validation.has-errors').first()).toBeVisible()
})

test.fail('#11 a later page that fails is named', async ({ page }) => {
  await store(page, ({ page: p }) => p === 1 ? feedPage(many(50), 10) : { status: 503 })
  await appProject(page)
  await expect(page.locator('p[role=status]')).toContainText('Fetched 50 new reviews')
  await expect(page.locator('p[role=status]')).toContainText(/page 2|incomplete/i)
})

test.fail('#12 numbers and single letters in a keyword phrase have to match', async ({ page }) => {
  await importProject(page)
  await importFile(page, 'k.csv', 'date,rating,review,version\n2026-10-01,5,It has all one needs,1.0\n2026-10-02,2,bad on ios 17,1.0\n2026-10-03,2,bad on ios 18,1.0', 3)
  await tab(page, 'Themes')
  await page.locator('details.rules summary').click()
  await page.getByLabel('New theme').fill('New OS')
  await page.getByLabel('Keywords, comma separated').fill('ios 18')
  await page.getByRole('button', { name: 'Add theme' }).click()
  await expect(row(card(page, /^Themes$/), 'New OS').first()).toHaveText('1')
  await expect(row(card(page, /^Themes$/), 'Missing feature')).toHaveCount(0)
})

test.fail('#13 a longer version list reassigns reviews that were dated by the shorter one', async ({ page }) => {
  await importProject(page)
  await importFile(page, 'n.csv', 'date,rating,review\n2026-06-10,5,a\n2026-08-30,1,b', 2)
  await saveVersions(page, '3.0,2026-06-01')
  await saveVersions(page, '3.2,2026-08-25')
  await tab(page, 'Overview')
  await expect(row(card(page, 'Release impact'), '3.2').nth(2)).toHaveText('1.00')
})

test.fail('#14 a negative rating is not a rating', async ({ page }) => {
  await importProject(page)
  await upload(page, 'r.csv', 'date,rating,review\n2026-10-01,-3,a\n2026-10-01,5,b')
  await expect(ready(page)).toContainText('1 review ready, 1 skipped')
})

test.fail('#15 a negation stops at the end of its clause', async ({ page }) => {
  await importProject(page)
  await importFile(page, 's.csv', 'date,rating,review\n2026-10-01,5,No complaints. Amazing\n2026-10-02,5,The constructor is great', 2)
  await tab(page, 'Reviews')
  await expect(page.locator('.review').filter({ hasText: 'complaints' })).not.toContainText('text disagrees with stars')
  await expect(page.locator('.review').filter({ hasText: 'constructor' })).not.toContainText('NaN')
})

test.fail('#16 release notes thank the storefront the complaints came from', async ({ page }) => {
  await importProject(page)
  await importFile(page, 'c.csv', 'date,rating,review,version,country\n2026-10-01,1,it crashes,1.0,de\n2026-10-02,5,fine,1.0,us', 2)
  await tab(page, 'Actions')
  await page.locator('.fix-list input').first().click()
  await expect(page.locator('.notes-pre')).toContainText('Fixed a crash')
  await expect(page.locator('.notes-pre')).not.toContainText('review in US')
})

test.fail('#17 a signed-out user can export everything from the account menu', async ({ page }) => {
  await importProject(page)
  await page.getByRole('button', { name: 'Sign in to sync' }).click()
  await expect(page.getByRole('button', { name: 'Export all my data (JSON)' })).toBeVisible()
})

test.fail('#18 two people who wrote the same short review both count', async ({ page }) => {
  await importProject(page)
  await upload(page, 'd.csv', 'date,rating,review,nickname,country\n2026-10-01,5,Great,amy,us\n2026-10-01,5,Great,bob,gb')
  await expect(ready(page)).toContainText('2 reviews ready')
})

test.fail('#18 ids a spreadsheet rounded do not make different reviews duplicates', async ({ page }) => {
  await importProject(page)
  await upload(page, 'd.csv', 'id,date,rating,review\n1.47667E+10,2026-10-01,5,First\n1.47667E+10,2026-10-02,1,Second')
  await expect(ready(page)).toContainText('2 reviews ready')
})

test.fail('#19 importing again with the version column fixes the stored reviews', async ({ page }) => {
  await importProject(page)
  await importFile(page, 'one.csv', 'id,date,rating,review\n1,2026-10-01,5,a', 1)
  await importFile(page, 'two.csv', 'id,date,rating,review,version\n1,2026-10-01,5,a,3.2', 1)
  await tab(page, 'Reviews')
  await expect(page.locator('.review')).toContainText('v3.2')
})

test.fail('#20 a date-only import is shown on the day in the file', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, timezoneId: 'America/New_York' })
  const page = await context.newPage()
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }))
  await importProject(page)
  await importFile(page, 'd.csv', 'date,rating,review\n2026-10-01,5,fine', 1)
  await tab(page, 'Reviews')
  await expect(page.locator('.review')).toContainText('Oct 1, 2026')
  await context.close()
})

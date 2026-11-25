import { expect, feedPage, importFile, importProject, issues, ready, row, card, saveVersions, tab, test, upload } from './fixtures'

const CSV = 'date,rating,title,review,version,country\n2026-10-02,1,Crashes,It crashes,5.4,DEU\n2026-10-03,5,Great,Lovely,5.4,en-GB\n'

const preview = (page: import('@playwright/test').Page) => page.locator('table.preview tbody tr')

test.beforeEach(async ({ page }) => { await importProject(page) })

for (const [name, data] of [
  ['comma', CSV],
  ['tab', CSV.replaceAll(',', '\t')],
  ['semicolon', CSV.replaceAll(',', ';')],
  ['CRLF with a byte order mark', '\uFEFF' + CSV.replaceAll('\n', '\r\n')],
  ['bare carriage returns and no final newline', CSV.trim().replaceAll('\n', '\r')],
  ['no byte order mark, quoted header', CSV.replace('date,rating', '"date","rating"')],
  ['quoted cells', CSV.replace(/[^,\n]+/g, '"$&"')],
] as const) test(`CSV: ${name}`, async ({ page }) => {
  await upload(page, 'r.csv', data)
  await expect(ready(page)).toHaveText('2 reviews ready · 0 errors · 0 warnings')
  await expect(preview(page).nth(0).locator('td')).toHaveText(['2026-10-02', '1', '5.4', 'DE', 'Crashes. It crashes'])
  await expect(preview(page).nth(1).locator('td')).toHaveText(['2026-10-03', '5', '5.4', 'GB', 'Great. Lovely'])
})

test('pasted rows, quoted line breaks and doubled quotes', async ({ page }) => {
  await page.getByLabel('Or paste').fill('date,rating,review\n2026-10-02,1,"line one\nline ""two"", end"\n')
  await page.getByRole('button', { name: 'Check pasted data' }).click()
  await expect(preview(page).locator('td').nth(4)).toHaveText(/line one\s+line "two", end/)
})

test('bad rows are skipped with a reason each', async ({ page }) => {
  await upload(page, 'r.csv', `id,date,rating,review,version,country
1,never,5,a,1,us
2,2026-10-02,6,b,1,us
3,2026-10-02,,c,1,us
4,2026-10-02,5,,1,us
5,2026-10-02,5,d,1,Narnia
5,2026-10-02,5,e,1,us
`)
  await expect(ready(page)).toHaveText('2 reviews ready, 4 skipped · 3 errors · 3 warnings')
  await expect(issues(page).locator('td:nth-child(3)')).toHaveText([
    'Date "never" is not a date. Row skipped.', 'Rating "6" is not 1 to 5. Row skipped.', 'Rating "" is not 1 to 5. Row skipped.',
    'Empty review text. Kept for rating statistics only.', 'Unknown country "Narnia", using US.', 'Duplicate of an earlier row. Skipped.',
  ])
  await expect(issues(page).locator('td:nth-child(1)')).toHaveText(['2', '3', '4', '5', '6', '7'])
})

test('unknown headers block the import until the columns are mapped', async ({ page }) => {
  await upload(page, 'r.csv', 'when,points,words\n2026-10-02,4,fine\n')
  await expect(ready(page)).toContainText('0 reviews ready')
  await expect(issues(page)).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'Import 0 reviews' })).toBeDisabled()
  await page.getByLabel('Date *').selectOption('when')
  await page.getByLabel('Rating (1-5) *').selectOption('points')
  await page.getByLabel('Review text *').selectOption('words')
  await expect(ready(page)).toContainText('1 review ready')
  await page.getByRole('button', { name: 'Import 1 review' }).click()
  await expect(page.getByText('1 review on this device')).toBeVisible()
})

test('App Store Connect API JSON needs a version list and says so', async ({ page }) => {
  const review = (id: string, createdDate: string, rating: number) => ({ type: 'customerReviews', id, attributes: { rating, title: 'T', body: 'B', reviewerNickname: 'n', createdDate, territory: 'JPN' } })
  await upload(page, 'asc.json', JSON.stringify([{ data: [review('a', '2026-07-05T00:00:00-07:00', 2)] }, { data: [review('b', '2026-08-20T00:00:00-07:00', 4), review('c', 'bad', 4), review('d', '2026-08-20T00:00:00-07:00', 9)] }]))
  await expect(ready(page)).toHaveText('2 reviews ready, 2 skipped · 2 errors · 1 warning')
  await expect(preview(page).first().locator('td')).toHaveText(['2026-07-05', '2', 'unknown', 'JP', 'T. B'])
  await page.getByRole('button', { name: 'Import 2 reviews' }).click()
  await saveVersions(page, '3.0,2026-07-01\n3.1,2026-08-15')
  await tab(page, 'Overview')
  await expect(row(card(page, 'Release impact'), '3.1').nth(2)).toHaveText('4.00')
})

test('saved feed pages keep their storefront and drop repeats', async ({ page }) => {
  await upload(page, 'feed.json', JSON.stringify([feedPage([{ id: '1', rating: 5 }, { id: '2', rating: 1 }], 2, 'fr'), feedPage([{ id: '2', rating: 1 }, { id: '3', rating: 3, version: 'v1.9' }], 2, 'fr')]))
  await expect(ready(page)).toContainText('3 reviews ready')
  await expect(issues(page)).toContainText('1 reviews appear on more than one page. Kept once.')
  await expect(preview(page).nth(2).locator('td')).toHaveText(['2026-10-02', '3', '1.9', 'FR', 'Title. Text'])
})

test('an array of scraper objects, with a byte order mark', async ({ page }) => {
  await upload(page, 'node.json', '\uFEFF' + JSON.stringify([{ id: '9', userName: 'u', version: '2.1', score: 2, title: 'T', text: 'Slow', updated: '2026-10-02T05:00:00-07:00', url: 'x' }]))
  await expect(page.getByText('node.json · JSON array · 1 rows')).toBeVisible()
  await expect(preview(page).locator('td')).toHaveText(['2026-10-02', '2', '2.1', 'US', 'T. Slow'])
})

for (const [name, data, message] of [
  ['empty', '', 'That file has no data rows.'],
  ['whitespace', ' \n\n', 'That file has no data rows.'],
  ['header only', 'date,rating,review\n', 'That file has no data rows.'],
  ['truncated JSON', '[{"date":"2026-10-02","rating":5,"text":"x"', 'That JSON is not a format Review Radar reads.'],
  ['other JSON', '{"hello":1}', 'That JSON is not a format Review Radar reads.'],
  ['empty JSON list', '[]', 'That JSON is not a format Review Radar reads.'],
] as const) test(`wrong file: ${name}`, async ({ page }) => {
  await upload(page, 'bad', data)
  await expect(page.locator('.toast.error')).toContainText(message)
  await expect(page.getByText('Drop a file here')).toBeVisible()
  await expect(page.getByText('0 reviews on this device')).toBeVisible()
})

test('wrong file: an empty feed page and binary data import nothing', async ({ page }) => {
  await upload(page, 'feed.json', JSON.stringify(feedPage([])))
  await expect(issues(page)).toContainText('This feed page lists no reviews.')
  await expect(page.getByRole('button', { name: 'Import 0 reviews' })).toBeDisabled()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await upload(page, 'x.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72]))
  await expect(page.getByRole('button', { name: 'Import 0 reviews' })).toBeDisabled()
})

test('importing the same file twice adds nothing, and imports survive a reload', async ({ page }) => {
  await importFile(page, 'r.csv', CSV, 2)
  await importFile(page, 'r.csv', CSV, 2)
  await expect(page.getByText('Imported 0 new reviews.')).toBeVisible()
  await page.reload()
  await expect(page.getByText('2 reviews on this device')).toBeVisible()
  await expect(page.locator('.imports li')).toHaveCount(2)
})

test('version list: bad lines are named and good ones saved', async ({ page }) => {
  const panel = page.locator('details').filter({ has: page.getByRole('heading', { name: 'Version history' }) })
  await panel.locator('summary').click()
  await panel.locator('textarea').fill('version,date\n1.0,2026-01-02\n1.1,soon\n')
  await expect(panel).toContainText('1 version read · line 3: Expected "version,date", got "1.1,soon".')
  await saveVersions(page, 'version,date\n1.0,2026-01-02\nv1.10,2026-03-01\n1.9,2026-02-01')
  await expect(panel.locator('.versions b')).toHaveText(['1.0', '1.9', '1.10'])
})

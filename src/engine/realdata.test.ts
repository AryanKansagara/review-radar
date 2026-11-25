// Fixtures here copy the layout of real files: Apple's customer-reviews feed as served in 2024-2026,
// the App Store Connect API, and exports from the common scraper libraries and review tools.
// The review text itself is written for the tests.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildVersions, cleanVersion, cmpVersion, feedLastPage, normalizeRss } from './reviews.ts'
import { detectMapping, headerKey, isDayFirst, jsonToRows, parseAscJson, parseCsv, parseFeedJson, rowsToReviews, toDate } from './importer.ts'
import { classify, clusters, DEFAULT_RULES, matchedKeywords, tokenize } from './themes.ts'
import { groupBy, seriesByVersion, wilson } from './stats.ts'
import { SAMPLES, sampleReviews } from './sample.ts'
import { fetchReviews, looksLikeOutage } from '../live.ts'
import type { Review } from './types.ts'

const rv = (p: Partial<Review>): Review => ({ id: Math.random().toString(36), appId: '1', country: 'us', rating: 5, version: '1.0', title: '', body: '', author: '', date: '2026-01-01T00:00:00.000Z', source: 'import', ...p })

/** One feed entry with every key the real feed sends. */
const entry = (id: number, rating: number, version: string, title: string, content: string, updated = '2026-10-07T19:56:20-07:00') => ({
  author: { uri: { label: `https://itunes.apple.com/us/reviews/id${id}` }, name: { label: `nick${id}` }, label: '' },
  updated: { label: updated },
  'im:rating': { label: String(rating) },
  'im:version': { label: version },
  id: { label: String(id) },
  title: { label: title },
  content: { label: content, attributes: { type: 'text' } },
  link: { attributes: { rel: 'related', href: 'https://itunes.apple.com/us/review?id=1500780518&type=Purple%20Software' } },
  'im:voteSum': { label: '0' },
  'im:contentType': { attributes: { term: 'Application', label: 'Application' } },
  'im:voteCount': { label: '0' },
})

/** A feed page with the real envelope: author, rights, the six links and the self address as id. */
const page = (cc: string, appId: string, p: number, last: number | null, entries: unknown[]) => {
  const self = `https://itunes.apple.com/${cc}/rss/customerreviews/page=${p}/id=${appId}/sortby=mostrecent/json`
  const href = (n: number | null) => n ? `https://itunes.apple.com/${cc}/rss/customerreviews/page=${n}/id=${appId}/sortby=mostrecent/xml?urlDesc=/customerreviews/page=${p}/id=${appId}/sortby=mostrecent/json` : ''
  return { feed: {
    author: { name: { label: 'iTunes Store' }, uri: { label: 'http://www.apple.com/itunes/' } },
    ...(entries.length ? { entry: entries } : {}),
    updated: { label: '2026-11-12T21:41:11-07:00' }, rights: { label: 'Copyright 2008 Apple Inc.' }, title: { label: 'iTunes Store: Customer Reviews' }, icon: { label: 'http://itunes.apple.com/favicon.ico' },
    link: [
      { attributes: { rel: 'alternate', type: 'text/html', href: `https://music.apple.com/WebObjects/MZStore.woa/wa/viewGrouping?cc=${cc}&id=1` } },
      { attributes: { rel: 'self', href: self } },
      { attributes: { rel: 'first', href: href(last ? 1 : null) } }, { attributes: { rel: 'last', href: href(last) } },
      { attributes: { rel: 'previous', href: href(last && p > 1 ? p - 1 : null) } }, { attributes: { rel: 'next', href: href(last && p < last ? p + 1 : null) } },
    ],
    id: { label: self },
  } }
}
const full = (start: number, n = 50) => Array.from({ length: n }, (_, i) => entry(start + i, 1 + (i % 5), '3.2.1', 'Title', 'Text of the review'))

test('feed: real entry layout, "v" version labels, podcast feeds without versions, bad dates', () => {
  const out = normalizeRss(page('gb', '1500780518', 1, 4, [
    entry(11819896449, 5, '3.2.1', 'Great timer', 'I use it to track my streak'),
    entry(11792356568, 2, 'v3.73.55', 'Hm', 'Older build'),
    entry(14640466427, 5, '', 'Great podcast as always', 'Podcast feeds carry no version'),
    entry(1, 4, '3.2.1', 'No date', 'Dropped', 'not a date'),
  ]), '1500780518', 'gb')
  assert.equal(out.length, 3)
  assert.deepEqual(out.map(r => r.version), ['3.2.1', '3.73.55', 'unknown'])
  assert.equal(out[0].date, '2026-10-08T02:56:20.000Z')
  assert.equal(out[0].author, 'nick11819896449')
})

test('feed: page count comes from the rel="last" link and is absent during an outage', () => {
  assert.equal(feedLastPage(page('gb', '1', 1, 4, full(1))), 4)
  assert.equal(feedLastPage(page('us', '1', 1, 10, full(1))), 10)
  // The outage answer: HTTP 200, the envelope, no entries and empty link hrefs.
  assert.equal(feedLastPage(page('us', '1', 1, null, [])), null)
  assert.equal(feedLastPage({}), null)
})

test('fetch: a dropped page is retried on the other URL spelling and does not end the country', async () => {
  const calls: string[] = []
  const get = async (url: string) => {
    calls.push(url)
    const p = +url.match(/page=(\d+)/)![1]
    // Page 2 comes back empty on the first spelling only; page 3 is the real, short, last page.
    if (p === 2 && url.includes('sortby=mostrecent')) return page('us', '9', 2, null, [])
    return page('us', '9', p, 3, p === 3 ? full(900, 17) : full(p * 100))
  }
  const res = await fetchReviews('9', ['us'], 10, undefined, undefined, get)
  assert.equal(res.reviews.length, 117)
  assert.equal(new Set(res.reviews.map(r => r.id)).size, 117)
  assert.deepEqual([res.failed, res.empty], [[], []])
  // 3 pages + 1 retry: pages 4 to 10 are never requested.
  assert.equal(calls.length, 4)
})

test('fetch: an empty feed for an app with ratings is reported as an outage, not as "no reviews"', async () => {
  const progress: number[] = []
  const res = await fetchReviews('9', ['us', 'gb'], 4, p => progress.push(p.done / p.total), undefined, async url => page(url.includes('/gb/') ? 'gb' : 'us', '9', 1, null, []))
  assert.deepEqual(res.reviews, [])
  assert.deepEqual(res.empty.sort(), ['gb', 'us'])
  assert.equal(progress.at(-1), 1)
  assert.equal(looksLikeOutage(res, ['us', 'gb'], 5584845), true)
  // A new app with a handful of ratings can honestly have no written reviews.
  assert.equal(looksLikeOutage(res, ['us', 'gb'], 12), false)
  assert.equal(looksLikeOutage(res, ['us', 'gb'], null), false)
  // One country answering is not an outage.
  assert.equal(looksLikeOutage({ reviews: [], empty: ['gb'] }, ['us', 'gb'], 5000), false)
})

test('fetch: network errors mark the country failed; feeds without a page count stop at the first short page', async () => {
  const noLinks = (n: number) => ({ feed: { entry: full(1, n) } })
  let calls = 0
  const res = await fetchReviews('9', ['us', 'de'], 10, undefined, undefined, async url => {
    if (url.includes('/de/')) throw new Error('Failed to fetch')
    calls++
    return noLinks(url.includes('page=1/') || url.endsWith('page=1/json') ? 50 : 20)
  })
  assert.deepEqual(res.failed, ['de'])
  assert.equal(res.reviews.length, 70)
  assert.equal(calls, 2)
})

test('import: app-store-scraper (Python) CSV with an index column, multi-line text and a response dict', () => {
  const csv = `,date,developerResponse,review,rating,isEdited,title,userName
0,2020-09-10 04:44:14,"{'id': 19026103, 'body': ""Thanks, please reach out to us"", 'modified': '2020-11-10T20:34:42Z'}","Great content but 4 to 6 ads in a 6 minute video.

Please fix.",3,False,Great but...,Jess4821
1,2022-06-22 06:15:27,,Sehr gut,5,True,Top,tobi
`
  const rows = parseCsv(csv)
  const map = detectMapping(rows[0])
  assert.deepEqual(map, { date: 1, rating: 4, body: 3, title: 6, author: 7 })
  const res = rowsToReviews(rows, map, 'x')
  assert.equal(res.reviews.length, 2)
  // No zone in the file: read as UTC wherever the import runs.
  assert.equal(res.reviews[0].date, '2020-09-10T04:44:14.000Z')
  assert.match(res.reviews[0].body, /6 minute video\.\n\nPlease fix\./)
  assert.equal(res.reviews[0].author, 'Jess4821')
})

test('import: app-store-scraper (Node) JSON array maps score, text, userName, version and updated', () => {
  const json = JSON.stringify([
    { id: '13017797701', userName: 'Campeby', userUrl: 'https://itunes.apple.com/us/reviews/id187867581', version: 'v526.0.0', score: 1, title: 'Too many ads', text: 'Cannot see my friends anymore', url: 'https://itunes.apple.com/us/review?id=284882215', updated: '2025-08-14T22:31:12-07:00' },
    { id: '13017753734', userName: 'Jates', version: '526.0.0', score: 5, title: 'Fine', text: 'Works', updated: '2025-08-14T14:09:20-07:00', extra: { nested: true } },
  ])
  const rows = jsonToRows(json)!
  const res = rowsToReviews(rows, detectMapping(rows[0]), '284882215')
  assert.equal(res.reviews.length, 2)
  assert.deepEqual(res.reviews.map(r => [r.id, r.rating, r.version, r.author]), [['13017797701', 1, '526.0.0', 'Campeby'], ['13017753734', 5, '526.0.0', 'Jates']])
  assert.equal(res.reviews[0].date, '2025-08-15T05:31:12.000Z')
  assert.equal(jsonToRows('{"a":1}'), null)
  assert.equal(jsonToRows('[1,2]'), null)
  assert.equal(jsonToRows('date,rating'), null)
})

test('import: saved feed pages keep their storefront and are deduped across pages', () => {
  const p1 = page('gb', '1500780518', 1, 2, [entry(1, 5, '3.2.1', 'A', 'a'), entry(2, 1, '3.2.1', 'B', 'b')])
  const p2 = page('de', '1500780518', 1, 1, [entry(2, 1, '3.2.1', 'B', 'b'), entry(3, 4, '3.1.11', 'C', 'c')])
  const res = parseFeedJson(JSON.stringify([p1, p2]), '1500780518')!
  assert.equal(res.format, 'App Store reviews feed JSON')
  assert.deepEqual(res.reviews.map(r => [r.id, r.country, r.source]), [['1', 'gb', 'import'], ['2', 'gb', 'import'], ['3', 'de', 'import']])
  assert.equal(res.skipped, 1)
  const empty = parseFeedJson(JSON.stringify(page('us', '1', 1, null, [])), '1')!
  assert.equal(empty.reviews.length, 0)
  assert.equal(empty.issues[0].level, 'error')
  assert.equal(parseFeedJson('{"data":[]}', '1'), null)
})

test('import: App Store Connect API page with links, meta and included responses', () => {
  const json = JSON.stringify({
    data: [{ type: 'customerReviews', id: '00000028-2c2c-4e8a-8f6c-0b6b0a7e3d11', attributes: { rating: 2, title: 'Abo', body: 'Zu teuer', reviewerNickname: 'r.novak', createdDate: '2026-10-03T08:15:42-07:00', territory: 'DEU' }, relationships: { response: { links: { self: 'https://api.appstoreconnect.apple.com/v1/customerReviews/x/relationships/response' } } }, links: { self: 'https://api.appstoreconnect.apple.com/v1/customerReviews/x' } }],
    included: [{ type: 'customerReviewResponses', id: 'r1', attributes: { responseBody: 'Danke', state: 'PUBLISHED' } }],
    links: { self: 'https://api.appstoreconnect.apple.com/v1/apps/1/customerReviews?limit=200', next: 'https://api.appstoreconnect.apple.com/v1/apps/1/customerReviews?cursor=abc' },
    meta: { paging: { total: 812, limit: 200 } },
  })
  const res = parseAscJson(json, '1')!
  assert.equal(res.reviews.length, 1)
  assert.deepEqual([res.reviews[0].country, res.reviews[0].rating, res.reviews[0].date, res.reviews[0].author], ['de', 2, '2026-10-03T15:15:42.000Z', 'r.novak'])
})

test('import: review-tool headers in snake_case, camelCase and with spaces are all detected', () => {
  assert.equal(headerKey('reviewerNickname'), 'reviewer nickname')
  assert.equal(headerKey(' Review_ID '), 'review id')
  // Appfigures export
  assert.deepEqual(detectMapping(['id', 'date', 'author', 'title', 'review', 'original_title', 'original_review', 'stars', 'iso', 'version', 'product_name']), { date: 1, rating: 7, body: 4, title: 3, version: 9, country: 8, author: 2, id: 0 })
  // Spreadsheet-style and API-style names
  assert.deepEqual(detectMapping(['Review ID', 'Submission Date', 'Star Rating', 'Review Title', 'Review Text', 'App Version', 'Country Code', 'Reviewer Nickname']), { id: 0, date: 1, rating: 2, title: 3, body: 4, version: 5, country: 6, author: 7 })
  assert.deepEqual(detectMapping(['review_id', 'created_at', 'rating', 'review_title', 'review_body', 'app_version', 'storefront', 'user_name']), { id: 0, date: 1, rating: 2, title: 3, body: 4, version: 5, country: 6, author: 7 })
})

test('import dates: zone handling, Unix timestamps and day-first columns', () => {
  assert.equal(toDate('2023-10-13 01:01:23'), '2023-10-13T01:01:23.000Z')
  assert.equal(toDate('2023-10-13T01:01:23'), '2023-10-13T01:01:23.000Z')
  assert.equal(toDate('2026-10-03T08:15:42-07:00'), '2026-10-03T15:15:42.000Z')
  assert.equal(toDate('2026-10-03T08:15:42+0530'), '2026-10-03T02:45:42.000Z')
  assert.equal(toDate('2026-10-03'), '2026-10-03T00:00:00.000Z')
  assert.equal(toDate('1760000000'), '2025-10-09T08:53:20.000Z')
  assert.equal(toDate('1760000000000'), '2025-10-09T08:53:20.000Z')
  assert.equal(toDate('Oct 3, 2026'), '2026-10-03T00:00:00.000Z')
  assert.equal(toDate('2026-13-40'), null)
  assert.equal(toDate('5'), null)
  // 03/10 is 10 March in a US file and 3 October in a European one; the column decides, not the row.
  assert.equal(isDayFirst(['03/10/2026', '25/10/2026']), true)
  assert.equal(isDayFirst(['03/10/2026', '10/25/2026']), false)
  assert.equal(isDayFirst(['03/10/2026', '04/11/2026']), false)
  const res = rowsToReviews(parseCsv('date,rating,review\n03/10/2026,5,a\n25/10/2026,4,b\n'), { date: 0, rating: 1, body: 2 }, 'x')
  assert.deepEqual(res.reviews.map(r => r.date.slice(0, 10)), ['2026-10-03', '2026-10-25'])
  assert.ok(res.issues.some(i => /day\/month\/year/.test(i.message)))
})

test('versions: "v" prefixes and date-based version numbers order correctly', () => {
  assert.equal(cleanVersion(' v3.73.55 '), '3.73.55')
  assert.equal(cleanVersion('vision 2'), 'vision 2')
  assert.ok(cmpVersion('v3.73.55', '3.73.230') < 0)
  assert.equal(cmpVersion('v2.0', '2.0'), 0)
  assert.ok(cmpVersion('2611.11.0', '2609.27.0') > 0)
  assert.ok(cmpVersion('489.0.0', '488.0.10') > 0)
  const vs = buildVersions([rv({ version: '3.73.230' }), rv({ version: '3.73.55', date: '2025-03-01T00:00:00.000Z' }), rv({ version: '3.73.238' })])
  assert.deepEqual(vs.map(v => v.version), ['3.73.55', '3.73.230', '3.73.238'])
})

test('themes: built-in rules read German, French, Spanish, Portuguese, Italian and Japanese reviews', () => {
  const c = (title: string, body = '') => classify({ title, body }, DEFAULT_RULES)
  assert.deepEqual(c('Absturz', 'Seit dem Update stürzt die App beim Start ab.'), ['crash', 'update-bug'])
  assert.deepEqual(c('Trop cher', 'L’abonnement est devenu payant depuis la mise à jour'), ['paywall', 'update-bug'])
  assert.deepEqual(c('', 'Demasiados anuncios y ya no funciona'), ['ads', 'update-bug'])
  assert.deepEqual(c('', 'O app trava toda hora e a assinatura é cara'), ['crash', 'paywall'])
  assert.deepEqual(c('', 'Troppa pubblicità'), ['ads'])
  assert.deepEqual(c('広告が多すぎる', 'アップデート後に起動しない'), ['crash', 'ads', 'update-bug'])
  // Whole words still: "pub" is French for an ad, "public" and "publish" are not.
  assert.deepEqual(c('', 'I made my profile public and it will not publish'), [])
  assert.deepEqual(matchedKeywords({ title: '', body: 'Zu viel Werbung' }, DEFAULT_RULES.find(r => r.id === 'ads')!), ['werbung'])
  // Translations belong to the built-in rules only, and switch off with them.
  assert.deepEqual(classify({ title: '', body: 'Werbung' }, [{ id: 'ads', label: 'Ads', keywords: ['ads'], enabled: true }]), [])
  assert.deepEqual(classify({ title: '', body: 'Werbung' }, DEFAULT_RULES.map(r => ({ ...r, enabled: false }))), [])
})

test('clusters: accented words stay whole, and grammar words and the app name are not topics', () => {
  assert.deepEqual(tokenize('Ça plante, en français!'), ['ça', 'plante', 'en', 'français'])
  const german = ['Die App ist nicht mehr nutzbar und die Karte fehlt', 'Karte fehlt und die App ist langsam', 'Ich habe die Karte nicht mehr und es ist schade', 'Die Karte ist weg und Strava ist teuer']
  const rs = [...german.map(body => rv({ rating: 1, body: `Strava: ${body}` })), ...Array.from({ length: 8 }, () => rv({ rating: 5, body: 'Strava ist toll' }))]
  const cs = clusters(rs, 8, 3, 'Strava: Run, Bike, Walk')
  assert.match(cs[0].terms[0], /^karte/)
  const all = cs.flatMap(x => x.terms).join(' ').split(' ')
  for (const w of ['die', 'und', 'ist', 'nicht', 'strava']) assert.ok(!all.includes(w), `${w} in ${all}`)
})

test('wilson interval: hand-calculated values', () => {
  // p = 0.5, n = 10: centre 0.5, half-width 1.96 * sqrt(0.025 + 0.009604) / 1.38416 = 0.2634
  const [lo, hi] = wilson(5, 10)
  assert.ok(Math.abs(lo - 0.2366) < 5e-4 && Math.abs(hi - 0.7634) < 5e-4)
  // 0 of 10: the "rule of three"-like upper bound z^2 / (n + z^2) = 3.8416 / 13.8416
  const [l0, h0] = wilson(0, 10)
  assert.equal(l0, 0)
  assert.ok(Math.abs(h0 - 3.8416 / 13.8416) < 1e-9)
  const [l1, h1] = wilson(10, 10)
  assert.ok(Math.abs(l1 - (1 - 3.8416 / 13.8416)) < 1e-9 && h1 === 1)
})

test('samples: local-language reviews in local storefronts, ratings as published', () => {
  const photo = sampleReviews('photo')
  const de = photo.filter(r => r.country === 'de')
  assert.ok(de.filter(r => /[äöüß]|nicht|sehr|der|die/i.test(r.body)).length / de.length > 0.6)
  assert.ok(photo.filter(r => r.country === 'us').every(r => !/stürzt|plante/.test(r.body)))
  // Wording varies, so fewer than a third of the texts are exact repeats of the most common one.
  const habit = sampleReviews('habit').filter(r => r.appId === SAMPLES[0].app.id)
  const top = Math.max(...[...groupBy(habit, r => r.body).values()].map(l => l.length))
  assert.ok(top / habit.length < 0.1, String(top / habit.length))
  assert.ok(new Set(habit.map(r => r.author)).size > 60)
  const series = seriesByVersion(habit, SAMPLES[0].versions)
  const m = Object.fromEntries(series.map(s => [s.version, s.mean]))
  assert.ok(Math.abs(m['3.1'] - 4.7) < 0.15 && Math.abs(m['3.2'] - 3.9) < 0.2, JSON.stringify(m))
})

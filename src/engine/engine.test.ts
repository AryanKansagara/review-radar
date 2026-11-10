import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildVersions, cmpVersion, mergeReviews, normalizeLookup, normalizeRss, parseAppRef } from './reviews.ts'
import { bootstrapDiff, bootstrapMean, releaseImpact, seriesByVersion, versionByCountry, weekStart, wilson } from './stats.ts'
import { classify, clusters, DEFAULT_RULES, emergingThemes, featureRequests, groupRequests, releaseNotes, themeStats, whatToFix } from './themes.ts'
import { mismatch, sentiment } from './sentiment.ts'
import { checkReply, draftReply, RESPONSE_LIMIT } from './replies.ts'
import { assignVersions, detectMapping, parseAscJson, parseCsv, parseVersions, reviewsCsv, rowsToReviews, toCountry, toDate } from './importer.ts'
import { SAMPLES, sampleReviews } from './sample.ts'
import type { Review } from './types.ts'

const rv = (p: Partial<Review>): Review => ({ id: Math.random().toString(36), appId: '1', country: 'us', rating: 5, version: '1.0', title: '', body: '', author: '', date: '2026-01-01T00:00:00.000Z', source: 'import', ...p })
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

test('parseAppRef handles store links, id tokens and bare ids', () => {
  assert.deepEqual(parseAppRef('https://apps.apple.com/gb/app/facebook/id284882215?mt=8'), { id: '284882215', country: 'gb' })
  assert.deepEqual(parseAppRef('https://apps.apple.com/us/app/id389801252'), { id: '389801252', country: 'us' })
  assert.deepEqual(parseAppRef('id1465731090'), { id: '1465731090', country: 'us' })
  assert.deepEqual(parseAppRef('  284882215 '), { id: '284882215', country: 'us' })
  assert.equal(parseAppRef('instagram'), null)
})

test('cmpVersion is numeric-aware', () => {
  assert.ok(cmpVersion('3.10', '3.9') > 0)
  assert.ok(cmpVersion('3.2.1', '3.2') > 0)
  assert.equal(cmpVersion('3.2', '3.2.0'), 0)
  assert.deepEqual(['5.4.1', '5.10', '5.4', '5.2'].sort(cmpVersion), ['5.2', '5.4', '5.4.1', '5.10'])
})

test('normalizeRss reads entries, clamps ratings and skips the app header entry', () => {
  const feed = { feed: { entry: [
    { 'im:name': { label: 'Some App' } },
    { id: { label: '111' }, 'im:rating': { label: '1' }, 'im:version': { label: '2.0' }, title: { label: 'Bad' }, content: { label: 'Crashes' }, author: { name: { label: 'x' } }, updated: { label: '2026-11-08T10:08:56-07:00' } },
    { id: { label: '112' }, 'im:rating': { label: '5' }, title: { label: 'Good' }, content: { label: 'Nice' }, author: { name: { label: 'y' } }, updated: { label: '2026-11-07T10:00:00-07:00' } },
  ] } }
  const out = normalizeRss(feed, '9', 'GB')
  assert.equal(out.length, 2)
  assert.equal(out[0].id, '111')
  assert.equal(out[0].country, 'gb')
  assert.equal(out[0].date, '2026-11-08T17:08:56.000Z')
  assert.equal(out[1].version, 'unknown')
  assert.deepEqual(normalizeRss({ feed: {} }, '9', 'us'), [])
  // A single entry comes back as an object, not an array.
  assert.equal(normalizeRss({ feed: { entry: feed.feed.entry[1] } }, '9', 'us').length, 1)
})

test('normalizeLookup maps the iTunes lookup result', () => {
  const a = normalizeLookup({ resultCount: 1, results: [{ trackId: 5, trackName: 'X', artistName: 'Dev', version: '1.2', averageUserRating: 4.5, userRatingCount: 10, averageUserRatingForCurrentVersion: 4.1 }] })
  assert.equal(a?.id, '5')
  assert.equal(a?.currentVersionRating, 4.1)
  assert.equal(normalizeLookup({ resultCount: 0, results: [] }), null)
})

test('mergeReviews dedupes by id across fetches and keeps edited reviews', () => {
  const a = rv({ id: '1', rating: 2, date: '2026-01-01T00:00:00.000Z' })
  const b = rv({ id: '2' })
  const edited = rv({ id: '1', rating: 4, date: '2026-01-05T00:00:00.000Z' })
  const m = mergeReviews([a, b], [edited, rv({ id: '2' }), rv({ id: '3' })])
  assert.equal(m.reviews.length, 3)
  assert.equal(m.added, 1)
  assert.equal(m.updated, 1)
  assert.equal(m.reviews.find(r => r.id === '1')!.rating, 4)
  // Same id on a different app is a different review.
  assert.equal(mergeReviews([a], [rv({ id: '1', appId: '2' })]).added, 1)
})

test('buildVersions infers first-seen dates and keeps listed ones', () => {
  const vs = buildVersions([rv({ version: '1.1', date: '2026-02-03T00:00:00Z' }), rv({ version: '1.1', date: '2026-02-01T00:00:00Z' }), rv({ version: 'unknown' })], [{ version: '1.0', date: '2026-01-01', origin: 'listed' }])
  assert.deepEqual(vs.map(v => [v.version, v.date, v.origin]), [['1.0', '2026-01-01', 'listed'], ['1.1', '2026-02-01', 'inferred']])
})

test('wilson interval matches known values and stays inside 0..1', () => {
  const [lo, hi] = wilson(10, 100)
  assert.ok(Math.abs(lo - 0.0552) < 0.001 && Math.abs(hi - 0.1744) < 0.001)
  assert.deepEqual(wilson(0, 0), [0, 1])
  const [l0] = wilson(0, 20)
  assert.equal(l0, 0)
})

test('bootstrap mean interval contains the mean and is reproducible', () => {
  const xs = [5, 5, 4, 5, 1, 3, 5, 4, 5, 2, 5, 5, 4, 1, 5]
  const ci = bootstrapMean(xs)
  assert.ok(ci[0] <= mean(xs) && mean(xs) <= ci[1])
  assert.deepEqual(bootstrapMean(xs), ci)
  assert.ok(ci[1] - ci[0] < 2)
})

test('bootstrap difference detects a clear drop and not noise', () => {
  const good = Array(60).fill(0).map((_, i) => (i % 10 === 0 ? 3 : 5))
  const bad = Array(60).fill(0).map((_, i) => (i % 2 ? 1 : 4))
  assert.ok(bootstrapDiff(good, bad)[1] < 0)
  const ci = bootstrapDiff(good, good.slice().reverse())
  assert.ok(ci[0] < 0 && ci[1] > 0)
})

test('releaseImpact flags the habit sample paywall release as worse', () => {
  const s = SAMPLES[0]
  const reviews = sampleReviews('habit').filter(r => r.appId === s.app.id)
  const imp = releaseImpact(reviews, buildVersions(reviews, s.versions))
  const v32 = imp.find(i => i.version === '3.2')!
  assert.equal(v32.verdict, 'worse')
  assert.ok(v32.before.mean > 4.5, `before ${v32.before.mean}`)
  assert.ok(v32.after.mean < 4.1, `after ${v32.after.mean}`)
  assert.ok(v32.oneStarDiff > 0.08)
  assert.equal(imp.find(i => i.version === '3.1')!.verdict, 'no clear change')
})

test('releaseImpact reports too few reviews instead of a verdict', () => {
  const rs = [rv({ version: '1.0', rating: 5 }), rv({ version: '1.0', rating: 5 }), rv({ version: '1.1', rating: 1 })]
  const imp = releaseImpact(rs, buildVersions(rs))
  assert.equal(imp[0].verdict, 'too few reviews')
})

test('photo sample: crash share is concentrated in Germany on 5.4', () => {
  const reviews = sampleReviews('photo')
  const cells = versionByCountry(reviews).filter(c => c.version === '5.4')
  const de = cells.find(c => c.country === 'de')!, us = cells.find(c => c.country === 'us')!
  assert.ok(de.mean < 3 && us.mean > 4.3, `de ${de.mean} us ${us.mean}`)
  const de54 = reviews.filter(r => r.version === '5.4' && r.country === 'de')
  assert.equal(themeStats(de54, DEFAULT_RULES)[0].id, 'crash')
})

test('samples are deterministic', () => {
  assert.deepEqual(sampleReviews('habit').slice(0, 5), sampleReviews('habit').slice(0, 5))
  const habit = seriesByVersion(sampleReviews('habit').filter(r => r.appId === '900000001'), SAMPLES[0].versions)
  assert.ok(habit[0].mean >= 4.5 && habit[habit.length - 1].mean < 4.2)
})

test('classify uses whole words and phrases', () => {
  assert.deepEqual(classify({ title: 'Crashes', body: 'since the update it crashes' }, DEFAULT_RULES), ['crash', 'update-bug'])
  // "ad" must not match "add" or "loading" must not match ads.
  assert.deepEqual(classify({ title: '', body: 'please add a widget' }, DEFAULT_RULES).includes('ads'), false)
  assert.ok(classify({ title: '', body: 'Too many ads.' }, DEFAULT_RULES).includes('ads'))
  assert.ok(classify({ title: '', body: "Won't open anymore" }, DEFAULT_RULES).includes('crash'))
  const off = DEFAULT_RULES.map(r => r.id === 'crash' ? { ...r, enabled: false } : r)
  assert.ok(!classify({ title: '', body: 'crash' }, off).includes('crash'))
  const custom = [...DEFAULT_RULES, { id: 'watch', label: 'Watch app', keywords: ['complication'], enabled: true }]
  assert.ok(classify({ title: '', body: 'Needs a watch complication' }, custom).includes('watch'))
})

test('themeStats measures how many stars a theme costs', () => {
  const rs = [rv({ body: 'crash', rating: 1 }), rv({ body: 'crash again', rating: 2 }), rv({ body: 'lovely', rating: 5 }), rv({ body: 'nice', rating: 5 })]
  const s = themeStats(rs, DEFAULT_RULES).find(x => x.id === 'crash')!
  assert.equal(s.n, 2)
  assert.equal(s.share, 0.5)
  assert.equal(s.impact, 3.5)
})

test('emergingThemes finds the paywall spike in 3.2', () => {
  const reviews = sampleReviews('habit').filter(r => r.appId === '900000001' && r.version <= '3.2')
  const e = emergingThemes(reviews, DEFAULT_RULES, '3.2')
  assert.equal(e[0].id, 'paywall')
  assert.ok(e[0].latest > 0.15 && e[0].before < 0.03)
  assert.deepEqual(emergingThemes(reviews, DEFAULT_RULES, '9.9'), [])
})

test('TF-IDF clusters surface the complaint terms', () => {
  const reviews = sampleReviews('photo').filter(r => r.version === '5.4' && r.country === 'de')
  const cs = clusters(reviews)
  assert.ok(cs.length >= 1)
  assert.ok(cs.slice(0, 3).some(c => c.terms.some(t => /crash|launch|open/.test(t))), JSON.stringify(cs.map(c => c.terms)))
  assert.ok(cs.every(c => c.reviews.every(r => r.rating <= 3)))
})

test('feature requests are extracted and grouped by topic', () => {
  const rs = [rv({ body: 'Great app. Please add dark mode!' }), rv({ body: 'I wish there was a dark mode.' }), rv({ body: 'It would be great if it synced to my watch' }), rv({ body: 'Works fine.' })]
  const reqs = featureRequests(rs)
  assert.equal(reqs.length, 3)
  assert.equal(reqs[0].text, 'Please add dark mode!')
  const g = groupRequests(reqs)
  assert.equal(g[0].n, 2)
  assert.match(g[0].topic, /dark/)
})

test('whatToFix ranks paywall first for the habit sample and excludes requests', () => {
  const reviews = sampleReviews('habit').filter(r => r.appId === '900000001')
  const f = whatToFix(reviews, DEFAULT_RULES, '3.3')
  assert.equal(f[0].id, 'paywall')
  assert.ok(!f.some(x => x.id === 'missing'))
  assert.ok(f.every((x, i) => i === 0 || f[i - 1].score >= x.score))
})

test('releaseNotes writes Fixed lines', () => {
  const n = releaseNotes([{ id: 'crash', label: 'Crashes' }, { id: 'custom', label: 'Watch app' }], ['de'])
  assert.match(n, /crash some people saw/)
  assert.match(n, /Fixed: watch app issues/)
  assert.match(n, /in DE/)
  assert.equal(releaseNotes([]), '')
})

test('sentiment handles negation and normalises length', () => {
  assert.ok(sentiment('This app is amazing and I love it').score > 5)
  assert.ok(sentiment('not great, honestly').score < 0)
  assert.ok(sentiment('Crashes constantly, useless garbage').comparative < -0.4)
  assert.equal(sentiment('').comparative, 0)
  assert.ok(mismatch(5, -0.5) && mismatch(1, 0.4) && !mismatch(5, 0.5))
})

test('draftReply picks a theme template, signs it and stays within the limit', () => {
  const ctx = { appName: 'Lumen', developer: 'Dev', supportEmail: 'help@example.com', signature: 'Sam, Lumen developer', fixedIn: '5.4.1' }
  const d = draftReply(rv({ rating: 1, version: '5.4', body: 'crashes' }), ['crash'], ctx)
  assert.equal(d.theme, 'crash')
  assert.match(d.text, /version 5\.4\.1/)
  assert.match(d.text, /Sam, Lumen developer$/)
  assert.equal(draftReply(rv({ rating: 5 }), [], ctx).theme, 'positive')
  assert.equal(draftReply(rv({ rating: 2 }), ['unknown-theme'], ctx).theme, 'generic')
  assert.ok(d.text.length <= RESPONSE_LIMIT)
  assert.deepEqual(checkReply(d.text), [])
  assert.ok(checkReply('Please update your rating to 5 stars').length > 0)
  assert.ok(checkReply('x'.repeat(RESPONSE_LIMIT + 1))[0].startsWith('Over'))
})

test('import: CSV with quotes, detection and a validation report with line numbers', () => {
  const csv = 'Date,Rating,Title,Review,Version,Territory\n2026-10-01,5,Good,"Nice, really",3.1,USA\n10/02/2026,0,Bad,Broken,3.2,GBR\nnot a date,3,x,y,3.2,USA\n2026-10-03,2,,"Line one\nline two",3.2,Atlantis\n2026-10-01,5,Good,"Nice, really",3.1,USA\n'
  const rows = parseCsv(csv)
  assert.equal(rows.length, 6)
  const map = detectMapping(rows[0])
  assert.deepEqual(map, { date: 0, rating: 1, body: 3, title: 2, version: 4, country: 5 })
  const res = rowsToReviews(rows, map, 'a')
  assert.equal(res.reviews.length, 2)
  assert.equal(res.reviews[1].body, 'Line one\nline two')
  assert.equal(res.reviews[1].country, 'us')
  assert.deepEqual(res.issues.map(i => [i.line, i.level]), [[3, 'error'], [4, 'error'], [5, 'warning'], [6, 'warning']])
  assert.equal(res.skipped, 3)
  assert.equal(rowsToReviews([['a', 'b']], {}, 'a').issues[0].level, 'error')
})

test('import helpers: dates, countries, semicolons', () => {
  assert.equal(toDate('25/10/2026')?.slice(0, 10), '2026-10-25')
  assert.equal(toDate('2026-10-25')?.slice(0, 10), '2026-10-25')
  assert.equal(toDate('nope'), null)
  assert.equal(toCountry('DEU'), 'de')
  assert.equal(toCountry('en-GB'), 'gb')
  assert.equal(toCountry('Narnia'), null)
  assert.deepEqual(parseCsv('a;b\n1;2'), [['a', 'b'], ['1', '2']])
})

test('App Store Connect API JSON is parsed and needs a version list', () => {
  const j = JSON.stringify({ data: [{ type: 'customerReviews', id: 'r1', attributes: { rating: 2, title: 'Meh', body: 'Slow', reviewerNickname: 'n', createdDate: '2026-09-01T10:00:00-07:00', territory: 'CAN' } }] })
  const res = parseAscJson(j, 'a')!
  assert.equal(res.reviews[0].country, 'ca')
  assert.equal(res.reviews[0].version, 'unknown')
  assert.ok(res.issues.some(i => /version history/.test(i.message)))
  assert.equal(parseAscJson('{"data":[]}', 'a'), null)
  assert.equal(parseAscJson('not json', 'a'), null)
})

test('version list parsing and assignment by date', () => {
  const { versions, issues } = parseVersions('version,date,notes\nv1.0,2026-01-01,First\n1.1,2026-02-01\nbad\n')
  assert.equal(versions.length, 2)
  assert.equal(versions[0].version, '1.0')
  assert.equal(issues[0].line, 4)
  const out = assignVersions([rv({ version: 'unknown', date: '2026-01-15T00:00:00Z' }), rv({ version: 'unknown', date: '2026-03-01T00:00:00Z' }), rv({ version: 'unknown', date: '2025-12-01T00:00:00Z' }), rv({ version: '9' })], versions)
  assert.deepEqual(out.map(r => r.version), ['1.0', '1.1', 'unknown', '9'])
})

test('CSV export escapes and includes themes', () => {
  const csv = reviewsCsv([rv({ id: 'x', title: 'Hi, there', body: 'say "hi"' })], () => ['crash', 'ads'])
  assert.equal(csv.split('\n')[1], 'x,2026-01-01,us,1.0,5,"Hi, there","say ""hi""",,"crash; ads",import')
  assert.equal(weekStart('2026-11-08T12:00:00Z'), '2026-11-02')
})

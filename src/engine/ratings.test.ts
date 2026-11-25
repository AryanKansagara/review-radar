import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectMapping, parseAscJson, readCsv, rowsToReviews } from './importer.ts'
import { normalizeRss, readRating } from './reviews.ts'

test('ratings: whole numbers from 1 to 5, also written as stars', () => {
  for (const [s, want] of [['1', 1], ['5', 5], [' 4 ', 4], ['5.0', 5], ['5,00', 5], ['5 stars', 5], ['1 Star', 1], ['4★', 4], ['3 ⭐️', 3], [2, 2]] as const) assert.equal(readRating(s), want, String(s))
  for (const s of ['-3', '+3', '4.5', '4,5', '5.01', 'Rated 4', '4/5', '45', '0', '6', '', '3-', '#4', '$5', '1e0', '4 stars?', '2 of 5', 4.5, -3, NaN, true, null, undefined, [5]]) assert.equal(readRating(s), null, String(s))
})

test('ratings: every import names the rows it cannot read', () => {
  const csv = readCsv('date;rating;review\n2026-10-01;-3;a\n2026-10-01;4,5;b\n2026-10-01;5 stars;c\n2026-10-01;Rated 4;d\n')
  const r = rowsToReviews(csv.rows, detectMapping(csv.rows[0]), 'a', 'us', csv)
  assert.deepEqual(r.reviews.map(x => x.rating), [5])
  assert.deepEqual(r.issues.filter(i => i.level === 'error').map(i => `${i.line} ${i.message}`), ['2 Rating "-3" is not 1 to 5. Row skipped.', '3 Rating "4,5" is not a whole number of stars. Row skipped.', '5 Rating "Rated 4" is not 1 to 5. Row skipped.'])
  const asc = (rating: unknown) => parseAscJson(JSON.stringify({ data: [{ type: 'customerReviews', id: 'x', attributes: { rating, title: 'T', body: 'B', createdDate: '2026-10-01T00:00:00Z', territory: 'USA' } }] }), 'a')!
  assert.deepEqual([5, '5', 4.5, -3, true, null].map(x => asc(x).reviews.length), [1, 1, 0, 0, 0, 0])
  assert.equal(asc(4.5).issues[0].level, 'error')
  const feed = (label: string) => normalizeRss({ feed: { entry: [{ id: { label: '1' }, 'im:rating': { label }, updated: { label: '2026-10-01T00:00:00Z' } }] } }, 'a', 'us').length
  assert.deepEqual(['5', '4.5', '-3', '9', ''].map(feed), [1, 0, 0, 0, 0])
})

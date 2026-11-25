import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectMapping, jsonToRows, parseAscJson, parseFeedJson, rowsToReviews } from './importer.ts'

/** What the import panel does with a file: a result, or null for "not a format Review Radar reads". */
function load(v: unknown) {
  const text = JSON.stringify(v)
  const whole = parseAscJson(text, 'a') ?? parseFeedJson(text, 'a')
  if (whole) return whole
  const rows = jsonToRows(text)
  return rows && rowsToReviews(rows, detectMapping(rows[0]), 'a')
}
const asc = (id: string) => ({ type: 'customerReviews', id, attributes: { rating: 5, title: 'T', body: 'B', createdDate: '2026-10-01T00:00:00Z', territory: 'USA' } })
const entry = (id: string, rating = '5') => ({ id: { label: id }, 'im:rating': { label: rating }, updated: { label: '2026-10-01T00:00:00Z' }, title: { label: 'T' }, content: { label: 'B' } })
const flat = (id: string) => ({ id, date: '2026-10-01', score: 5, text: 'x' })

test('json: malformed files give a message or a blocked import, never an exception', () => {
  for (const v of [null, 1, 'x', [], [null], [[]], [1, 2], {}, { data: null }, { data: [null] }, { data: 'x' }, { data: {} }, { data: [1, [], {}] }, [{ data: [null] }, null],
    { feed: null }, { feed: 1 }, { feed: 'x' }, { feed: [] }, { feed: {} }, { feed: { entry: null } }, { feed: { entry: [null] } }, { feed: { entry: 'x' } }, { feed: { entry: [1, 'a', [], {}] } }, { feed: { entry: [{ author: null, 'im:rating': null, updated: null }] } }, { feed: { id: null, link: null, entry: [{ 'im:rating': { label: null } }] } }, [{ feed: null }, null],
    { data: [{ type: 'customerReviews' }] }, { data: [{ type: 'customerReviews', attributes: null }] }, { data: [{ type: 'customerReviews', attributes: 'x' }] }, [{}], [{ date: null }]]) {
    const r = load(v)
    if (r) { assert.equal(r.reviews.length, 0, JSON.stringify(v)); assert.ok(r.issues.some(i => i.level === 'error'), JSON.stringify(v)) }
  }
})

test('json: one bad entry among good ones is reported and the rest import', () => {
  for (const [v, bad] of [
    [{ data: [null, asc('1'), asc('2')] }, 1], [{ data: [asc('1'), { type: 'customerReviews', attributes: null }, asc('2')] }, 2], [[null, { data: [asc('1'), 5, asc('2')] }], 2],
    [{ feed: { entry: [entry('1'), null, entry('2')] } }, 2], [{ feed: { entry: [entry('1'), entry('x', '9'), entry('2')] } }, 2], [[{ feed: null }, { feed: { entry: [entry('1'), entry('2'), {}] } }], 3],
    [[flat('1'), null, flat('2')], 3], [[5, flat('1'), flat('2')], 2], [[flat('1'), [1], flat('2')], 3],
  ] as const) {
    const r = load(v)!
    assert.deepEqual(r.reviews.map(x => x.id), ['1', '2'], JSON.stringify(v))
    assert.equal(r.skipped, 1, JSON.stringify(v))
    assert.deepEqual(r.issues.filter(i => i.level === 'error').map(i => i.line), [bad], JSON.stringify(v))
  }
})

test('json: the app entry older feeds begin with is not an error', () => {
  const r = load({ feed: { entry: [{ 'im:name': { label: 'App' }, id: { label: 'app' } }, entry('1')] } })!
  assert.deepEqual([r.reviews.length, r.skipped, r.issues], [1, 0, []])
})

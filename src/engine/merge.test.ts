import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectMapping, readCsv, rowsToReviews } from './importer.ts'
import { hashId, mergeReviews } from './reviews.ts'
import type { Review } from './types.ts'

const file = (text: string, country = 'us') => { const csv = readCsv(text); return rowsToReviews(csv.rows, detectMapping(csv.rows[0]), 'a', country, csv) }
const read = (text: string, country = 'us') => file(text, country).reviews
const SAME = 'date,rating,review,nickname,country,version\n2026-10-01,5,Great,amy,us,1.0\n2026-10-01,5,Great,bob,us,1.0\n2026-10-01,5,Great,amy,gb,1.0\n2026-10-01,5,Great,amy,us,1.1\n'

test('import: rows that differ in author, country or version are kept, exact repeats are not', () => {
  const r = file(SAME + '2026-10-01,5,Great,amy,us,1.0\n')
  assert.equal(r.reviews.length, 4)
  assert.equal(new Set(r.reviews.map(x => x.id)).size, 4)
  assert.deepEqual(r.issues.map(i => i.message), ['Duplicate of an earlier row. Skipped.'])
})

test('import: ids in scientific notation are not ids', () => {
  for (const id of ['1.47667E+10', '1,47667E+10', '1e+21', '1.4e-5']) {
    const r = file(`id;date;rating;review\n${id};2026-10-01;5;First\n${id};2026-10-02;1;Second\n`)
    assert.equal(r.reviews.length, 2, id)
    assert.ok(r.issues.some(i => i.line === 2 && /rounded/.test(i.message)), id)
  }
  // Not rounded: a hexadecimal id can look similar.
  assert.deepEqual(read('id,date,rating,review\n12e5,2026-10-01,5,a\n14766651509,2026-10-01,5,a').map(x => x.id), ['12e5', '14766651509'])
})

test('merge: importing the same file again adds nothing', () => {
  for (const f of [SAME, 'date,rating,review\n2026-10-01,5,Great\n', 'id,date,rating,review\n1.4E+10,2026-10-01,5,a\n1.4E+10,2026-10-01,5,b\n']) {
    const once = mergeReviews([], read(f)).reviews
    const twice = mergeReviews(once, read(f))
    assert.deepEqual([twice.added, twice.updated, twice.reviews.length], [0, 0, once.length])
    // A country that was only the project's default says nothing about the review.
    assert.equal(mergeReviews(once, read(f, 'de')).added, 0)
  }
})

test('merge: a file imported before ids covered author, country and version adds only what was dropped then', () => {
  const [first] = read(SAME)
  const old: Review = { ...first, id: hashId('2026-10-01T00:00:00.000Z|5||Great') }
  const m = mergeReviews([old], read(SAME))
  assert.deepEqual([m.added, m.reviews.length], [3, 4])
  // The stored review keeps its id, so its replied mark stays with it.
  assert.ok(m.reviews.includes(old))
  const rounded: Review = { ...first, id: '1.47667E+10' }
  assert.equal(mergeReviews([rounded], read('id,date,rating,review,nickname,country,version\n1.47667E+10,2026-10-01,5,Great,amy,us,1.0')).added, 0)
})

test('merge: reviews by different people in different files both stay', () => {
  const amy = read('date,rating,review,nickname\n2026-10-01,5,Great,amy'), bob = read('date,rating,review,nickname\n2026-10-01,5,Great,bob')
  assert.equal(mergeReviews(amy, bob).added, 1)
  // One unnamed stored review cannot stand for both.
  assert.equal(mergeReviews(read('date,rating,review\n2026-10-01,5,Great'), [...amy, ...bob]).added, 1)
  // A store id is never matched by content.
  assert.equal(mergeReviews([{ ...amy[0], id: '14766651509' }], amy).added, 1)
})

const ID = 'id,date,rating,review'
const one = (head: string, row: string, country?: string) => read(`${head}\n${row}`, country)
const stored = (a: Review[], b: Review[]) => { const m = mergeReviews(a, b); return { ...m, r: m.reviews[0] } }

test('merge: importing again with a corrected mapping fixes the stored review', () => {
  const bare = one(ID, '1,2026-10-01,5,a')
  const full = one(ID + ',version,title,country,nickname', '1,2026-10-01,5,a,3.2,T,gb,amy')
  let m = stored(bare, full)
  assert.deepEqual([m.added, m.updated], [0, 1])
  assert.deepEqual([m.r.version, m.r.title, m.r.country, m.r.author, m.r.countryAssumed], ['3.2', 'T', 'gb', 'amy', undefined])
  // Never the reverse, even when the project's default country changed.
  m = stored(full, one(ID, '1,2026-10-01,5,a', 'de'))
  assert.deepEqual([m.added, m.updated, m.r], [0, 0, full[0]])
  m = stored(full, one(ID + ',version,title,country', '1,2026-10-01,5,a,3.3,Other,fr'))
  assert.deepEqual([m.updated, m.r.version, m.r.title, m.r.country, m.r.author], [1, '3.3', 'Other', 'fr', 'amy'])
})

test('merge: the same correction reaches reviews without ids, which keep the id they have', () => {
  const bare = one('date,rating,review', '2026-10-01,5,a')
  const m = stored(bare, one('date,rating,review,version,country,nickname', '2026-10-01,5,a,3.2,gb,amy'))
  assert.deepEqual([m.added, m.updated, m.r.id, m.r.version, m.r.country, m.r.author], [0, 1, bare[0].id, '3.2', 'gb', 'amy'])
})

test('merge: a later edit without a version keeps the known one, an older reading only fills gaps', () => {
  const known = one(ID + ',version', '1,2026-10-01,5,a,3.2')
  let m = stored(known, one(ID, '1,2026-10-05,2,b'))
  assert.deepEqual([m.updated, m.r.version, m.r.body, m.r.rating], [1, '3.2', 'b', 2])
  m = stored(one(ID, '1,2026-10-05,2,b'), known)
  assert.deepEqual([m.updated, m.r.version, m.r.body, m.r.rating, m.r.date.slice(0, 10)], [1, '3.2', 'b', 2, '2026-10-05'])
  m = stored(one(ID + ',version', '1,2026-10-05,2,b,3.3'), known)
  assert.deepEqual([m.updated, m.r.version], [0, '3.3'])
})

test('merge: a review the feed lists in two storefronts is not moved back and forth', () => {
  const gb: Review = { ...one(ID + ',country', '1,2026-10-01,5,a,gb')[0], source: 'rss' }
  const m = mergeReviews([gb], [gb, { ...gb, country: 'de' }])
  assert.deepEqual([m.updated, m.reviews[0].country], [0, 'gb'])
})

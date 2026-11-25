import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assignVersions, detectMapping, readCsv, rowsToReviews } from './importer.ts'
import { mergeReviews } from './reviews.ts'
import type { Review, VersionInfo } from './types.ts'

const read = (text: string) => { const csv = readCsv(text); return rowsToReviews(csv.rows, detectMapping(csv.rows[0]), 'a', 'us', csv).reviews }
const list = (...vs: [string, string][]): VersionInfo[] => vs.map(([version, date]) => ({ version, date, origin: 'listed' }))
const versions = (rs: Review[]) => rs.map(r => r.version)
const FILE = 'date,rating,review\n2026-06-10,5,a\n2026-08-30,1,b\n'
const short = list(['3.0', '2026-06-01']), long = list(['3.0', '2026-06-01'], ['3.2', '2026-08-25'])

test('versions: a longer or corrected list moves the reviews it dated', () => {
  const first = assignVersions(read(FILE), short, 'a')
  assert.deepEqual(versions(first), ['3.0', '3.0'])
  const second = assignVersions(first, long, 'a')
  assert.deepEqual(versions(second), ['3.0', '3.2'])
  assert.equal(second[0], first[0])
  // A corrected date can leave a review without a release again.
  const third = assignVersions(second, list(['3.0', '2026-07-01'], ['3.2', '2026-08-25']), 'a')
  assert.deepEqual(third.map(r => [r.version, r.versionInferred]), [['unknown', undefined], ['3.2', true]])
})

test('versions: one that came with the review stays, and so do other apps', () => {
  const own = read('date,rating,review,version\n2026-08-30,1,b,3.0\n')
  assert.deepEqual(assignVersions(own, long, 'a'), own)
  const rival = read(FILE).map(r => ({ ...r, appId: 'b' }))
  assert.deepEqual(assignVersions(rival, long, 'a'), rival)
})

test('versions: importing again keeps, replaces or corrects an inferred version', () => {
  const stored = assignVersions(read(FILE), short, 'a')
  const again = (text: string) => { const m = mergeReviews(stored, read(text)); return { ...m, reviews: assignVersions(m.reviews, long, 'a') } }
  let m = again(FILE)
  assert.deepEqual([m.added, m.updated, versions(m.reviews)], [0, 0, ['3.2', '3.0']])
  m = again('date,rating,review,version\n2026-06-10,5,a,3.0\n2026-08-30,1,b,3.1\n')
  assert.deepEqual([m.added, m.updated], [0, 2])
  assert.deepEqual(m.reviews.map(r => [r.version, r.versionInferred]), [['3.1', undefined], ['3.0', undefined]])
})

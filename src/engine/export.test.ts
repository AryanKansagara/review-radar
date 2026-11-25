import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectMapping, parseCsv, readCsv, reviewsCsv, rowsToReviews, toCsv } from './importer.ts'
import type { Review } from './types.ts'

const cell = (v: string | number) => toCsv([[v]]).slice(0, -1)

test('csv export: text a spreadsheet would run is prefixed, numbers are not', () => {
  for (const s of ['=1+1', '+1', '-', '-a', '-1+1', '--1', '@me', '＝1', "'=1", "''@x"]) assert.equal(cell(s), `'${s}`, s)
  assert.equal(cell('=HYPERLINK("https://example.com","x")'), `"'=HYPERLINK(""https://example.com"",""x"")"`)
  assert.equal(cell('\t=1'), "'\t=1")
  assert.equal(cell('\r=1'), `"'\r=1"`)
  for (const s of ['-2.700', '-5', '2.1', 'a=b', "it's", "'tis", '', ' x', 'NaN']) assert.equal(cell(s), s, s)
  for (const n of [-2.7, 1e21, -1e-9]) assert.equal(cell(n), String(n))
})

test('csv export: a carriage return is quoted and does not split the row', () => {
  assert.equal(cell('a\rb'), '"a\rb"')
  assert.deepEqual(parseCsv(toCsv([['a\rb', 'c'], ['d', 'e\r\nf']])), [['a\rb', 'c'], ['d', 'e\r\nf']])
})

test('csv export: importing it again gives the same reviews', () => {
  const texts = ['=HYPERLINK("https://example.com","x")', '+1', '-', '-5', '-5 stars', '@me', "'=1", "''+x", "'tis", "'-5", "'", 'a\rb', 'a\r\nb', '"quoted"', 'x;y,z', '＝1', '- one\n- two', "'\t=x"]
  const reviews: Review[] = texts.map((s, i) => ({ id: `r${i}`, appId: 'a', country: 'gb', rating: 3, version: '1.0', title: s, body: s, author: s, date: '2026-10-01T00:00:00.000Z', source: 'import' }))
  const csv = readCsv(reviewsCsv(reviews, () => ['crash']))
  const r = rowsToReviews(csv.rows, detectMapping(csv.rows[0]), 'a', 'us', csv)
  assert.deepEqual(r.issues, [])
  assert.deepEqual(r.reviews, reviews)
  // Whitespace around a text is not kept by any import.
  const tab = readCsv(reviewsCsv([{ ...reviews[0], body: '\t=1' }], () => []))
  assert.equal(rowsToReviews(tab.rows, detectMapping(tab.rows[0]), 'a', 'us', tab).reviews[0].body, '=1')
})

test('csv import: a quote in front of a formula in another file is text', () => {
  const csv = readCsv("date,rating,review\n2026-10-01,5,'=1")
  assert.equal(rowsToReviews(csv.rows, detectMapping(csv.rows[0]), 'a', 'us', csv).reviews[0].body, "'=1")
})

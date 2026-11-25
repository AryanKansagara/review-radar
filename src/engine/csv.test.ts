import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectMapping, parseCsv, parseVersions, readCsv, rowsToReviews } from './importer.ts'

const read = (text: string) => { const csv = readCsv(text); return rowsToReviews(csv.rows, detectMapping(csv.rows[0]), 'a', 'us', csv) }
const problems = (text: string) => read(text).issues.map(i => `${i.line} ${i.level}`)

test('csv: a quote inside a plain cell is text', () => {
  const r = read('date,rating,review,version\n2026-10-01,1,My 6" screen,5.4\n2026-10-02,2,"Say ""hi"", ok",5.4\n')
  assert.deepEqual(r.reviews.map(x => [x.body, x.version]), [['My 6" screen', '5.4'], ['Say "hi", ok', '5.4']])
  assert.deepEqual(r.issues, [])
})

test('csv: quoted cells read as before', () => {
  assert.deepEqual(parseCsv('a, "b,c" ,"d""e"\n"","x\ny",﻿"z"'), [['a', 'b,c', 'd"e'], ['', 'x\ny', 'z']])
  assert.deepEqual(parseCsv('"He said "wow", great",2'), [['He said wow, great', '2']])
  assert.deepEqual(parseCsv('﻿"a";b\r\n1;2\r\r3;4'), [['a', 'b'], ['1', '2'], ['3', '4']])
})

test('csv: an unclosed quote drops its row and is reported where it opened', () => {
  const r = read('date,rating,version,review\n2026-10-01,1,5.4,fine\n\n2026-10-02,2,5.4,"cut off\n2026-10-03,3,5.4,lost\n')
  assert.deepEqual(r.reviews.map(x => x.body), ['fine'])
  assert.equal(r.skipped, 1)
  assert.match(r.issues[0].message, /never closed/)
  assert.equal(r.issues[0].line, 4)
  assert.equal(readCsv('"date,rating\n1,2').rows.length, 0)
})

test('csv: extra cells skip the row, missing cells warn, empty extra cells are fine', () => {
  const head = 'date,rating,title,review,version\n'
  assert.deepEqual(problems(head + '2026-10-01,1,t,one, two,5.4'), ['2 error'])
  assert.deepEqual(problems(head + '2026-10-01,1,t,one,5.4,,'), [])
  assert.deepEqual(problems(head + '2026-10-02,1,t,ok,1\n2026-10-01,1,t,cut'), ['3 warning'])
  // Cells missing only from columns nobody mapped do not matter.
  assert.deepEqual(problems('date,rating,review,version,notes\n2026-10-01,1,one,5.4'), [])
})

test('csv: line numbers are lines of the file', () => {
  assert.deepEqual(problems('date,rating,review,version\r\n2026-10-01,1,"two\r\nlines",1\r\n\r\nbad,1,x,1\r\n'), ['5 error'])
  assert.deepEqual(parseVersions('version,date,notes\n1.0,2026-01-01,"a\nb"\n1.1,soon\n').issues.map(i => i.line), [4])
})

test('version lists: quotes in notes, and an unclosed one', () => {
  assert.equal(parseVersions('1.0,2026-01-01,24" screens\n1.1,2026-02-01').versions.length, 2)
  const cut = parseVersions('1.0,2026-01-01\n1.1,2026-02-01,"cut')
  assert.equal(cut.versions.length, 1)
  assert.equal(cut.issues[0].line, 2)
})

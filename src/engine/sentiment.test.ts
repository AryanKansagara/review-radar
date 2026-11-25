import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sentiment } from './sentiment.ts'

const hits = (s: string) => sentiment(s).hits.join(' / ')

test('sentiment: a negation ends with its clause', () => {
  for (const s of ['No complaints. Amazing', 'No complaints.Amazing', 'No, amazing', 'No complaints! Amazing', 'No bugs\nAmazing', 'No ads… amazing', 'No ads - amazing', 'No ads — amazing', 'No ads (amazing)', 'Why not? Amazing', 'No: amazing'])
    assert.ok(/(^| )amazing$/.test(hits(s)) && !/not amazing/.test(hits(s)), `${s}: ${hits(s)}`)
  assert.ok(Math.abs(sentiment('No complaints. Amazing').comparative - 5 / (5 * Math.sqrt(3))) < 1e-9)
  for (const s of ['not amazing', 'not so amazing', 'not "amazing"', 'isn’t amazing', 'not *that* amazing', 'not 3.2 amazing', 'never-amazing']) assert.equal(hits(s), 'not amazing', s)
  assert.equal(hits('It was not great, honestly bad'), 'not great / bad')
})

test('sentiment: object property names score 0', () => {
  for (const w of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) assert.deepEqual(sentiment(w), { score: 0, comparative: 0, hits: [] }, w)
  assert.equal(sentiment('The constructor is great').score, 3)
})

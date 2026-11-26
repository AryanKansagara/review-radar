import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseAscJson, toCountry } from './importer.ts'

test('territories: App Store Connect codes outside the largest storefronts', () => {
  // ISO 3166-1 pairs, and Apple's own code for Kosovo.
  for (const [three, two] of [['CHE', 'ch'], ['AUT', 'at'], ['POL', 'pl'], ['TUR', 'tr'], ['SAU', 'sa'], ['BEL', 'be'], ['ZAF', 'za'], ['USA', 'us'], ['GBR', 'gb'], ['ABW', 'aw'], ['ZWE', 'zw'], ['MNP', 'mp'], ['XKS', 'xk']]) assert.equal(toCountry(three), two)
  assert.equal(toCountry('che'), 'ch')
})

test('territories: UK is Great Britain; unknown codes stay unknown', () => {
  assert.deepEqual(['UK', 'uk', 'en-UK', 'en_GB', 'de-DE'].map(toCountry), ['gb', 'gb', 'gb', 'gb', 'de'])
  assert.deepEqual(['XXX', 'Narnia', '', 'constructor', undefined].map(toCountry), [null, null, null, null, null])
})

test('territories: an unreadable one in the JSON import is reported with the country used', () => {
  const review = (id: string, territory?: unknown) => ({ type: 'customerReviews', id, attributes: { rating: 1, body: 'b', createdDate: '2026-07-05T00:00:00Z', territory } })
  const r = parseAscJson(JSON.stringify({ data: [review('1', 'CHE'), review('2', 'QQQ'), review('3'), review('4', 5)] }), 'a', 'de')!
  assert.deepEqual(r.reviews.map(x => x.country), ['ch', 'de', 'de', 'de'])
  assert.deepEqual(r.issues.slice(0, -1).map(i => [i.level, i.message]), [
    ['warning', 'Review 2: unknown territory "QQQ", using DE.'],
    ['warning', 'Review 3: no territory, using DE.'],
    ['warning', 'Review 4: unknown territory "5", using DE.'],
  ])
})

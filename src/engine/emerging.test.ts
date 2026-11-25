import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_RULES, emergingThemes, whatToFix } from './themes.ts'
import type { Review } from './types.ts'

const some = (n: number, version: string, crashes: number): Review[] => Array.from({ length: n }, (_, i) => ({
  id: `${version}-${i}`, appId: 'a', country: 'us', rating: i < crashes ? 1 : 5, version, title: '', body: i < crashes ? 'It crashes' : 'Fine', author: '', date: '2026-10-01T00:00:00Z', source: 'import',
}))

test('emerging themes need 8 earlier reviews to compare with', () => {
  const now = some(10, '2.0', 5)
  for (const earlier of [0, 1, 7]) assert.deepEqual(emergingThemes([...now, ...some(earlier, '1.0', 0)], DEFAULT_RULES, '2.0'), [], `${earlier} earlier`)
  assert.deepEqual(emergingThemes([...now, ...some(8, '1.0', 0)], DEFAULT_RULES, '2.0').map(e => [e.id, e.before, e.latest]), [['crash', 0, 0.5]])
  // Newer versions and reviews without a version are not a baseline.
  assert.deepEqual(emergingThemes([...now, ...some(20, '3.0', 0), ...some(20, 'unknown', 0)], DEFAULT_RULES, '2.0'), [])
})

test('the fix ranking is not boosted without a baseline', () => {
  const [f] = whatToFix(some(10, '1.0', 5), DEFAULT_RULES, '1.0')
  assert.equal(f.trend, 0)
  assert.equal(f.score, 5 * 4)
  assert.equal(f.why, '5 reviews, 4.0 stars below the rest')
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classify, DEFAULT_RULES, matchedKeywords, terms, tokenize } from './themes.ts'

const matches = (keyword: string, body: string) => classify({ title: '', body }, [{ id: 'x', label: 'X', keywords: [keyword], enabled: true }]).length === 1

test('themes: a phrase matches all its words, numbers and single letters included', () => {
  for (const [k, yes, no] of [
    ['ios 18', ['bad on iOS 18', 'iOS-18!', 'ios 18.1'], ['bad on ios 17', 'ios', 'ios 180', 'iOS18']],
    ['error 500', ['Error 500.', 'error: 500'], ['error', 'error 404']],
    ['needs a', ['it needs a timer'], ['It has all one needs', 'needs an option']],
    ['a pagamento', ['tutto a pagamento'], ['il pagamento']],
    ['3.2', ['since 3.2 it is slow'], ['3.1', '3.20']],
    ['plan b', ['Plan B'], ['plan a']],
    ['can\'t log', ['I can’t log in'], ['log']],
  ] as const) {
    for (const s of yes) assert.ok(matches(k, s), `${k} in ${s}`)
    for (const s of no) assert.ok(!matches(k, s), `${k} not in ${s}`)
  }
  assert.ok(!matches('!!!', 'wow!!!'))
  assert.deepEqual(matchedKeywords({ title: '', body: 'It has all one needs' }, DEFAULT_RULES.find(r => r.id === 'missing')!), [])
})

test('themes: clustering still leaves out single letters and numbers', () => {
  assert.deepEqual(tokenize('Error 500 on a 12 pro, v 3.2'), ['error', 'on', 'pro'])
  assert.deepEqual(terms('error 500 crash'), ['error', 'crash', 'error crash'])
})

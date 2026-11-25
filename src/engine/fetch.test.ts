import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchReviews } from '../live.ts'

const page = (p: number, last: number | null, n = 50) => ({ feed: {
  ...(last ? { link: [{ attributes: { rel: 'last', href: `https://itunes.apple.com/us/rss/customerreviews/page=${last}/id=9/sortby=mostrecent/xml` } }] } : {}),
  ...(n ? { entry: Array.from({ length: n }, (_, i) => ({ id: { label: `${p}-${i}` }, 'im:rating': { label: '5' }, updated: { label: '2026-10-07T19:56:20-07:00' } })) } : {}),
} })
const num = (url: string) => +url.match(/page=(\d+)/)![1]
const run = async (get: (url: string) => unknown, pages = 10, signal?: AbortSignal) => {
  const calls: string[] = [], progress: number[] = []
  const res = await fetchReviews('9', ['us'], pages, p => progress.push(p.done / p.total), signal, async url => { calls.push(url); return get(url) })
  return { ...res, calls, progress: progress.at(-1) }
}
const down = () => { throw new Error('App Store returned 503') }

test('fetch: a failed page is tried once on the other address', async () => {
  for (const bad of [1, 2, 3]) {
    const r = await run(url => num(url) === bad && url.includes('sortby') ? down() : page(num(url), 3, num(url) === 3 ? 17 : 50))
    assert.deepEqual([r.reviews.length, r.failed, r.incomplete, r.calls.length], [117, [], [], 4], `page ${bad}`)
  }
})

test('fetch: a page that fails on both addresses is named', async () => {
  let r = await run(url => num(url) === 2 ? down() : page(num(url), 10))
  assert.deepEqual([r.reviews.length, r.failed, r.incomplete, r.calls.length, r.progress], [50, [], ['US (stopped at page 2 of 10)'], 3, 1])
  // Only as many pages as were asked for count.
  r = await run(url => num(url) === 3 ? down() : page(num(url), 10), 4)
  assert.deepEqual(r.incomplete, ['US (stopped at page 3 of 4)'])
  r = await run(url => num(url) === 2 ? down() : page(num(url), null))
  assert.deepEqual(r.incomplete, ['US (stopped at page 2)'])
  // An error followed by an empty answer is a failure, not an app without reviews.
  r = await run(url => url.includes('sortby') ? down() : page(1, null, 0))
  assert.deepEqual([r.failed, r.empty], [['us'], []])
  r = await run(down)
  assert.deepEqual([r.failed, r.incomplete, r.calls.length], [['us'], [], 2])
})

test('fetch: an empty page in the middle is named and the rest still read', async () => {
  const r = await run(url => page(num(url), 3, num(url) === 2 ? 0 : 50))
  assert.deepEqual([r.reviews.length, r.incomplete], [100, ['US (page 2 of 3 came back empty)']])
  // The last page may be empty: there is nothing after it to have lost.
  assert.deepEqual((await run(url => page(num(url), 3, num(url) === 3 ? 0 : 50))).incomplete, [])
})

test('fetch: cancelling is not retried or reported as a failure', async () => {
  const ctl = new AbortController()
  let calls = 0
  await assert.rejects(fetchReviews('9', ['us'], 10, undefined, ctl.signal, async url => {
    calls++
    if (num(url) === 2) { ctl.abort(); throw new Error('aborted') }
    return page(num(url), 10)
  }))
  assert.equal(calls, 2)
})

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { isDayFirst, parseVersions, toDate } from './importer.ts'

test('dates: impossible and partial ones are not dates', () => {
  for (const s of ['2026-02-30', '2026-02-29', '2026-04-31', '31/04/2026', '02/30/2026', '2026-10-03 25:99', '2026-10-03 24:01', '2026-10-03T12:60', '2026-10-03T12:00:00+99:00', '2026-10-03 13:00 PM', '30 Feb 2026', 'Feb 29, 2026',
    'garbage 2026', '5.4', '2026', '2026-10', '10/2026', 'Oct 2026', 'Oct 26', '3 Oct', '10/03/202', '10/03/2026 garbage', '2026-10-03 garbage', '3 Oct 2026 garbage', 'Octopus 3 2026', '10/03-2026', 'review 3 2026', '12:30', '2026-10-03 12', '3 Oct 12:00', 'Oct 3 12:00', 'x10/03/2026', '2026-10-03x', '1,5', '0/0/2026', '00-00-2026', '2024-W05', '-1'])
    assert.equal(toDate(s), null, s)
})

test('dates: documented and common forms read as before', () => {
  for (const [s, want] of [
    ['2026-10-03', '2026-10-03T00:00:00.000Z'], ['2026-1-3', '2026-01-03T00:00:00.000Z'], ['2024-02-29', '2024-02-29T00:00:00.000Z'], ['2026-10-03 12:00:00', '2026-10-03T12:00:00.000Z'], ['2026-10-03T12:00:00Z', '2026-10-03T12:00:00.000Z'],
    ['2026-10-03T23:30:00-07:00', '2026-10-04T06:30:00.000Z'], ['2026-10-03 12:00:00 +0000', '2026-10-03T12:00:00.000Z'], ['2026-10-03 12:00:00.123456+00:00', '2026-10-03T12:00:00.000Z'], ['2026-10-03 5 PM', '2026-10-03T17:00:00.000Z'], ['Sat 10/03/2026', '2026-10-03T00:00:00.000Z'], ['Oct/3/2026 12:00 GMT+2', '2026-10-03T10:00:00.000Z'], ['2026-10-03 12:00:00 UTC', '2026-10-03T12:00:00.000Z'],
    ['2026-10-03 05:30 PM', '2026-10-03T17:30:00.000Z'], ['2026-10-03Z', '2026-10-03T00:00:00.000Z'], ['2026-10-03+02:00', '2026-10-02T22:00:00.000Z'], ['2026/10/03', '2026-10-03T00:00:00.000Z'], ['2026/10/03 08:00', '2026-10-03T08:00:00.000Z'],
    ['10/03/2026', '2026-10-03T00:00:00.000Z'], ['10/03/26', '2026-10-03T00:00:00.000Z'], ['25.10.2026', '2026-10-25T00:00:00.000Z'], ['10/03/2026 5:30 PM', '2026-10-03T00:00:00.000Z'], ['10/03/2026, 17:30:00', '2026-10-03T00:00:00.000Z'],
    ['3 Oct 2026', '2026-10-03T00:00:00.000Z'], ['Oct 3, 2026', '2026-10-03T00:00:00.000Z'], ['October 3, 2026 5:30 PM', '2026-10-03T17:30:00.000Z'], ['Oct 3, 2026, 5:30:10 AM', '2026-10-03T05:30:10.000Z'], ['12:00 AM', null], ['Sat, 03 Oct 2026 12:00:00 GMT', '2026-10-03T12:00:00.000Z'],
    ['Saturday, October 3, 2026', '2026-10-03T00:00:00.000Z'], ['Sat Oct 03 2026 12:00:00 GMT+0200 (Central European Summer Time)', '2026-10-03T10:00:00.000Z'], ['Sat Oct  3 12:00:00 2026', '2026-10-03T12:00:00.000Z'], ['3-Oct-2026', '2026-10-03T00:00:00.000Z'], ['03-Oct-26', '2026-10-03T00:00:00.000Z'],
    ['Sept 3 2026', '2026-09-03T00:00:00.000Z'], ['October 3rd, 2026 at 5:30 PM', '2026-10-03T17:30:00.000Z'], ['3 Oct 2026 10:00 PST', '2026-10-03T18:00:00.000Z'], ['1760000000', '2025-10-09T08:53:20.000Z'], ['1760000000000', '2025-10-09T08:53:20.000Z'],
  ] as const) assert.equal(toDate(s), want, s)
})

test('dates: 10-03-2026 follows the month-first rule, in every time zone', () => {
  assert.equal(toDate('10-03-2026'), '2026-10-03T00:00:00.000Z')
  assert.equal(toDate('10-03-2026', true), '2026-03-10T00:00:00.000Z')
  assert.equal(isDayFirst(['03-10-2026', '25-10-2026']), true)
  const src = new URL('./importer.ts', import.meta.url).href
  for (const TZ of ['Pacific/Kiritimati', 'Asia/Tokyo', 'America/Los_Angeles']) {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', `import { toDate } from ${JSON.stringify(src)}; console.log(['10-03-2026', '3 Oct 26', 'Oct 3, 2026', '10-03-2026 08:00'].map(s => toDate(s)).join())`], { env: { ...process.env, TZ, NODE_NO_WARNINGS: '1' }, encoding: 'utf8' })
    assert.equal(out.trim(), '2026-10-03T00:00:00.000Z,2026-10-03T00:00:00.000Z,2026-10-03T00:00:00.000Z,2026-10-03T08:00:00.000Z', TZ)
  }
})

test('version lists: one day above 12 makes the whole list day first, and says so', () => {
  const r = parseVersions('version,date\n3.1,14/07/2026\n3.2,05/08/2026')
  assert.deepEqual(r.versions.map(v => v.date), ['2026-07-14', '2026-08-05'])
  assert.deepEqual(r.issues.map(i => i.level), ['warning'])
  assert.deepEqual(parseVersions('3.1,07/14/2026\n3.2,05/08/2026').versions.map(v => v.date), ['2026-07-14', '2026-05-08'])
})

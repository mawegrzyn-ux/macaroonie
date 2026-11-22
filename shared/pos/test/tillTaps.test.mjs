// Taps on till layout buttons (OUTSTANDING 44.8, migration 266): the
// till's queue (adding taps, taking off what was sent), what the API keeps
// of an upload, and the heat map's figures and colours.
// Run: node --test shared/pos/test/

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  tapCell, tapKey, addTaps, takeTaps, cleanTaps, heatOf, heatShare, heatColour, heatInk, TAP_ZONES, TAP_BATCH_MAX, TAP_COUNT_MAX,
} from '../tillTaps.js'

const LAYOUT = '0b6f5d1e-2f4a-4c1b-9a33-5b8e2f6c7d10'
const ANNA = '4c3b2a19-0f8e-4d7c-8b6a-594837261504'
const tap = (extra = {}) => ({ day: '2026-11-22', staff_id: ANNA, layout_id: LAYOUT, zone_id: 'dishes', zone_type: 'items', cell: 'dish-1', label: 'Pad Thai', n: 1, ...extra })

test('a cell is keyed as the designer keys it', () => {
  assert.equal(tapCell('s:abc'), 'abc', 'a category')
  assert.equal(tapCell('m:abc'), 'abc', 'a menu')
  assert.equal(tapCell('times'), 'times')
  assert.equal(tapCell('b1'), 'b1', 'a layout button')
  assert.equal(tapCell(null), '')
  assert.deepEqual(TAP_ZONES, ['categories', 'menus', 'items', 'category', 'buttons', 'popup'])
})

test('the till\'s queue adds taps per day, person, layout, zone and button, and takes off what was sent', () => {
  let q = addTaps({}, [tap()])
  q = addTaps(q, [tap()])
  q = addTaps(q, [tap({ staff_id: null })])
  q = addTaps(q, [tap({ day: '2026-11-23' })])
  assert.equal(Object.keys(q).length, 3)
  assert.equal(q[tapKey(tap())].n, 2)
  // Sent while one more was tapped: one stays.
  const sent = Object.values(q).map(r => ({ ...r }))
  q = addTaps(q, [tap()])
  q = takeTaps(q, sent)
  assert.deepEqual(Object.values(q).map(r => [r.day, r.n]), [['2026-11-22', 1]])
  assert.deepEqual(takeTaps(q, [{ ...tap(), n: 5 }]), {}, 'more sent than waiting empties it')
  assert.deepEqual(takeTaps({}, [tap()]), {}, 'nothing waiting stays nothing')
})

test('an upload keeps the right rows and leaves the rest out', () => {
  const rows = cleanTaps([
    tap({ cell: 's:sec-1', zone_type: 'categories', label: '  Mains  ' }),
    tap({ layout_id: 'not-a-uuid' }),
    tap({ day: '22/11/2026' }),
    tap({ zone_type: 'modifiers' }),
    tap({ staff_id: 'someone' }),
    tap({ n: 0 }),
    tap({ n: 1e9 }),
    tap({ zone_id: '' }),
    null,
  ])
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], { day: '2026-11-22', staff_id: ANNA, layout_id: LAYOUT, zone_id: 'dishes', zone_type: 'categories', cell: 'sec-1', label: 'Mains', n: 1 })
  assert.equal(rows[1].n, TAP_COUNT_MAX)
  assert.equal(cleanTaps(Array.from({ length: TAP_BATCH_MAX + 50 }, () => tap())).length, TAP_BATCH_MAX)
  assert.deepEqual(cleanTaps('nope'), [])
})

test('the heat map: taps per zone and button, the most, and colours from pale to deep', () => {
  const h = heatOf([
    { zone_id: 'dishes', cell: 'a', taps: 30 },
    { zone_id: 'dishes', cell: 'b', taps: 3 },
    { zone_id: 'buttons', cell: 'a', taps: 10 },
    { zone_id: 'dishes', cell: 'a', taps: 10 },
    { zone_id: 'dishes', cell: 'c', taps: 0 },
  ])
  assert.deepEqual(h.zones, { dishes: { a: 40, b: 3 }, buttons: { a: 10 } })
  assert.equal(h.max, 40)
  assert.equal(h.total, 53)
  assert.equal(heatShare(0, 40), 0)
  assert.equal(heatShare(40, 40), 1)
  assert.equal(heatShare(1, 1000), 0.08, 'a button tapped at all still shows')
  assert.equal(heatShare(5, 0), 0)
  assert.equal(heatColour(0), null)
  assert.equal(heatColour(1), 'hsl(0 95% 45%)')
  assert.equal(heatColour(0.08), 'hsl(51 95% 79%)')
  assert.equal(heatInk(1), '#ffffff')
  assert.equal(heatInk(0.2), '#111827')
})

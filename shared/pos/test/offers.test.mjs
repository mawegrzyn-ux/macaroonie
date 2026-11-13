// shared/pos/test/offers.test.mjs
//
// checkOffers() judges a check's promotions at the time it is given (test
// till sales on past days, api/src/services/tillSalesGen.js), else now.
// Run: node --test shared/pos/test/

import test from 'node:test'
import assert from 'node:assert/strict'
import { checkOffers } from '../offers.js'

// 10% off on weekday lunchtimes in the first week of October 2026.
const PROMO = {
  id: 'p-oct', name: 'October lunch', kind: 'basket', discount_type: 'percent', discount_value: 10, apply_mode: 'auto',
  schedule: { from: '2026-10-01', until: '2026-10-07', times: [{ days: [1, 2, 3, 4, 5], start: '12:00', end: '15:00' }] },
}
const config = { venue: { id: 'v1', timezone: 'Europe/London' }, items: {}, promotions: [PROMO] }
const check = () => ({
  id: 'c1', status: 'open', discounts: [], promotions: [], charges: [], payments: [],
  lines: [{ id: 'l1', item_id: 'i1', name: 'Curry', qty: 2, unit_price: 1000, status: 'sent', modifiers: [] }],
})
const off = r => (r?.payload.promotions || []).reduce((s, p) => s + Object.values(p.lines).reduce((t, x) => t + x, 0), 0)

test('checkOffers: a promotion is judged at the time given, in the venue\'s clock', () => {
  // Friday 2 October 2026 at 13:00 in London (12:00 UTC, summer time): on.
  const on = checkOffers(check(), config, { at: '2026-10-02T12:00:00Z' })
  assert.equal(on.changed, true)
  assert.deepEqual(on.payload.promotions.map(p => p.promotion_id), ['p-oct'])
  assert.equal(off(on), 200, '10% of £20')
  // 15:30 in London that day (14:30 UTC): after its hours.
  assert.equal(off(checkOffers(check(), config, { at: '2026-10-02T14:30:00Z' })), 0)
  // The Saturday: not one of its days. The Friday after: past its last day.
  assert.equal(off(checkOffers(check(), config, { at: '2026-10-03T12:00:00Z' })), 0)
  assert.equal(off(checkOffers(check(), config, { at: '2026-10-09T12:00:00Z' })), 0)
  // No time given: now (13 Nov 2026 or later), long after it ended.
  assert.equal(off(checkOffers(check(), config)), 0)
  // A check that had it, judged after it ended, loses it.
  const had = { ...check(), promotions: on.payload.promotions }
  const later = checkOffers(had, config, { at: '2026-10-09T12:00:00Z' })
  assert.equal(later.changed, true)
  assert.deepEqual(later.payload.promotions, [])
})

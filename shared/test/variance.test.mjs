// Variance (inventory phase 6a, docs/INVENTORY.md 8.1, migration 312):
// actual against theoretical for an item between two counts, the item rule
// and the venue band, key items between their counts, food cost actual and
// theoretical, which sales count as food, and the evidence explainVariance()
// words. Plus the property check of docs/INVENTORY.md 14: opening + received
// - closing equals theoretical + waste + variance (less what moved and was
// adjusted) for every item, over generated data.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  itemVariance, periodVariance, keyIntervals, itemFlag, isFoodSale, explainVariance, varianceSettings, settingsProblem,
  VARIANCE_DEFAULTS, EVIDENCE_KINDS,
} from '../variance.js'
import { costShare } from '../costing.js'
import { stockOnHand } from '../stock.js'

const T = h => new Date(Date.UTC(2026, 10, 1) + h * 3600000).toISOString()
const count = (h, qty) => ({ kind: 'count', at: T(h), qty_base: qty })
const move = (kind, h, qty, extra = {}) => ({ kind, at: T(h), qty_base: qty, ...extra })

// Chicken, in grams: counted 10 kg, 20 kg delivered, 2 kg in from another
// venue, 1 kg sent out (of which 0.2 kg lost in transit), 1.5 kg wasted (a
// till void 0.5 of it), sales took 22 kg, an adjustment found 0.3 kg, and
// the closing count found 6.5 kg.
const chicken = [
  count(0, 10000),
  move('delivery', 10, 20000),
  move('transfer_in', 20, 2000),
  move('transfer_out', 30, -800),
  move('lost_in_transit', 30, -200),
  move('waste', 40, -1000),
  move('waste', 41, -500),
  move('usage', 50, -12000),
  move('usage', 74, -10000),
  move('adjustment', 80, 300),
  count(168, 6500),
]

test('actual, theoretical, waste, variance and unexplained for an item between two counts', () => {
  const r = itemVariance({ moves: chicken, from: T(0), to: T(168), price: 0.006 })
  assert.equal(r.opening, 10000)
  assert.equal(r.received, 20000)
  assert.equal(r.transfers_in, 2000)
  assert.equal(r.transfers_out, 1000, 'what was sent, lost in transit included')
  assert.equal(r.lost_in_transit, 200)
  assert.equal(r.closing, 6500)
  // actual = 10000 + 20000 + 2000 - 1000 - 0 - 6500
  assert.equal(r.actual, 24500)
  assert.equal(r.theoretical, 22000)
  assert.equal(r.waste, 1500)
  assert.equal(r.adjusted, 300)
  assert.equal(r.variance, 2500)
  // explained = waste - adjusted (the adjustment found stock: a gain explained)
  assert.equal(r.explained, 1200)
  assert.equal(r.unexplained, 1300)
  assert.equal(r.unexplained_value, 7.8)
  assert.equal(r.variance_value, 15)
  assert.equal(r.actual_value, 147)
  assert.equal(r.unexplained_pct, 5.91)
  // The ledger expected 10000 + 20000 + 2000 - 1000 - 1500 - 22000 + 300 = 7800; the count found 6500.
  const expected = stockOnHand({ moves: chicken.slice(0, -1) }).on_hand
  assert.equal(expected - 6500, r.unexplained, 'unexplained is the closing count against the ledger')
})

test('a count at the very moment of a move has it inside: the window is (opening, closing]', () => {
  const r = itemVariance({ moves: [count(0, 100), move('delivery', 0, 50), move('delivery', 5, 10), count(5, 90)], from: T(0), to: T(5) })
  assert.equal(r.opening, 100, 'the delivery at the opening count is inside it')
  assert.equal(r.received, 10, 'the one at the closing count is inside the period')
  assert.equal(r.actual, 20)
})

test('not counted since: no actual, the rest runs to now; never in stock before: opening 0', () => {
  const r = itemVariance({ moves: [count(0, 5), move('usage', 3, -2)], from: T(0), to: null })
  assert.equal(r.counted, false)
  assert.equal(r.actual, null)
  assert.equal(r.unexplained, null)
  assert.equal(r.theoretical, 2)
  const fresh = itemVariance({ moves: [move('delivery', 2, 400), count(9, 100)], from: T(1), to: T(9) })
  assert.equal(fresh.opening, 0, 'nothing before the period: nothing was there')
  assert.equal(fresh.actual, 300)
  const unknown = itemVariance({ moves: [move('delivery', 0.5, 400), count(9, 100)], from: T(1), to: T(9) })
  assert.equal(unknown.opening, null, 'moves before but no count: not known')
  assert.equal(unknown.actual, null)
})

test('late sales that landed in the period add to theoretical, marked; a late move by time is left out', () => {
  const r = itemVariance({ moves: [count(0, 100), move('usage', 2, -30), move('usage', 3, -5, { late: true }), count(10, 60)], from: T(0), to: T(10), late: 4 })
  assert.equal(r.theoretical, 34)
  assert.equal(r.late, 4)
  assert.equal(r.actual, 40)
  assert.equal(r.variance, 6)
})

test('the item rule: over 3% and over £50 by default, either way; no price, no flag', () => {
  const s = VARIANCE_DEFAULTS
  assert.deepEqual(itemFlag({ unexplained: 10, unexplained_value: 60, theoretical: 100, counted: true }, s), { flagged: true, why: 'loss' })
  assert.equal(itemFlag({ unexplained: 2, unexplained_value: 60, theoretical: 100, counted: true }, s).flagged, false, '2% is inside')
  assert.equal(itemFlag({ unexplained: 10, unexplained_value: 40, theoretical: 100, counted: true }, s).flagged, false, '£40 is inside')
  assert.deepEqual(itemFlag({ unexplained: -10, unexplained_value: -60, theoretical: 100, counted: true }, s), { flagged: true, why: 'gain' })
  assert.equal(itemFlag({ unexplained: 5, unexplained_value: 51, theoretical: 0, counted: true }, s).flagged, true, 'no sales: any amount is all of it')
  assert.deepEqual(itemFlag({ unexplained: 10, unexplained_value: null, theoretical: 100, counted: true }, s), { flagged: false, why: 'no_price' })
  assert.deepEqual(itemFlag({ unexplained: null, counted: false }, s), { flagged: false, why: 'not_counted' })
  assert.equal(itemFlag({ unexplained: 10, unexplained_value: 60, theoretical: 100, counted: true }, { item_pct: 3, item_pounds: 100 }).flagged, false, 'the group\'s own band')
})

test('a period: ranked by pounds of unexplained loss, share of food sales, food cost actual and theoretical, the venue band', () => {
  const rows = [
    { item_id: 'a', name: 'Chicken', ...itemVariance({ moves: chicken, from: T(0), to: T(168), price: 0.006 }) },
    { item_id: 'b', name: 'Rice', ...itemVariance({ moves: [count(0, 5000), move('usage', 5, -3000), count(168, 2100)], from: T(0), to: T(168), price: 0.002 }) },
    { item_id: 'c', name: 'Cheese', ...itemVariance({ moves: [count(0, 1000), move('usage', 5, -500), count(168, 600)], from: T(0), to: T(168), price: 0.01 }) },
    { item_id: 'd', name: 'Nothing', ...itemVariance({ moves: [], from: T(0), to: T(168), price: 0.01 }) },
  ]
  const v = periodVariance({ items: rows, net_food_pence: 50000, settings: { band_pct: 1, item_pct: 3, item_pounds: 5 } })
  assert.deepEqual(v.rows.map(r => r.name), ['Chicken', 'Rice', 'Cheese'], 'biggest loss first, a gain last, a quiet item left out')
  assert.equal(v.rows[0].flagged, true)
  assert.equal(v.rows[2].unexplained, -100, 'cheese: 100 g more than expected')
  // Chicken's £7.80 of £500 food sales is 1.56 points.
  assert.equal(v.rows[0].share_pct, 1.56)
  assert.equal(v.totals.unexplained_value, round2(7.8 - 0.2 - 1), 'rice and cheese were found over')
  assert.equal(v.food_cost.actual_value, round2(147 + 5.8 + 4))
  assert.equal(v.food_cost.actual_pct, costShare(156.8, 50000))
  assert.equal(v.food_cost.theoretical_pct, costShare(132 + 6 + 5, 50000))
  assert.equal(v.food_cost.gap_pts, round2(v.food_cost.actual_pct - v.food_cost.theoretical_pct))
  assert.equal(v.band.unexplained_pct, 1.32)
  assert.equal(v.band.over, true, '1.32 points is over the 1 point band')
  const quiet = periodVariance({ items: rows, net_food_pence: 50000, settings: { band_pct: 2 } })
  assert.equal(quiet.band.over, false)
  assert.equal(periodVariance({ items: rows, net_food_pence: null }).food_cost.actual_pct, null, 'no sales known: no food cost %')
  assert.equal(v.food_cost.complete, true)
  assert.equal(v.food_cost.uncounted_used, 0)
})

test('food cost is over the same items on both sides: no actual or gap while an item sales used is not counted', () => {
  // The period running since the last full count: chicken key-counted since, rice used by sales and not counted.
  const rows = [
    { item_id: 'a', name: 'Chicken', ...itemVariance({ moves: chicken, from: T(0), to: null, price: 0.006 }) },
    { item_id: 'b', name: 'Rice', ...itemVariance({ moves: [count(0, 5000), move('usage', 5, -3000)], from: T(0), to: null, price: 0.002 }) },
  ]
  assert.equal(rows[1].actual, null, 'rice: no actual')
  const v = periodVariance({ items: rows, net_food_pence: 50000 })
  assert.equal(v.food_cost.complete, false)
  assert.equal(v.food_cost.uncounted_used, 1)
  assert.equal(v.food_cost.actual_value, null, 'the counted chicken alone is not the actual food cost')
  assert.equal(v.food_cost.actual_pct, null)
  assert.equal(v.food_cost.gap_pts, null, 'no gap between different sets of items')
  assert.equal(v.food_cost.theoretical_pct, costShare(132 + 6, 50000), 'theoretical over every item sales used')
  // An item nobody counted and sales didn't use is in neither side: the food cost stands.
  const shelf = { item_id: 'c', name: 'Napkins', ...itemVariance({ moves: [count(0, 300), move('delivery', 5, 200)], from: T(0), to: null, price: 0.01 }) }
  const withCount = [rows[0], { item_id: 'b', name: 'Rice', ...itemVariance({ moves: [count(0, 5000), move('usage', 5, -3000), count(100, 2000)], from: T(0), to: null, price: 0.002 }) }, shelf]
  const w = periodVariance({ items: withCount, net_food_pence: 50000 })
  assert.equal(shelf.actual, null)
  assert.equal(w.food_cost.complete, true)
  assert.equal(w.food_cost.actual_pct, costShare(147 + 6, 50000))
  assert.equal(w.food_cost.gap_pts, round2(w.food_cost.actual_pct - w.food_cost.theoretical_pct))
})

const round2 = n => Math.round(n * 100) / 100

test('costShare: pounds over pence as a percentage; nothing for no sales', () => {
  assert.equal(costShare(30, 10000), 30)
  assert.equal(costShare(1.234, 10000), 1.23)
  assert.equal(costShare(5, 0), null)
  assert.equal(costShare(null, 100), null)
})

test('key items between each pair of their counts: daily figures', () => {
  const moves = [count(0, 50), move('usage', 10, -20), count(24, 28), move('delivery', 30, 40), move('usage', 40, -25), count(48, 40)]
  const days = keyIntervals({ moves, from: T(0), to: T(48), price: 1 })
  assert.equal(days.length, 2)
  assert.equal(days[0].actual, 22)
  assert.equal(days[0].unexplained, 2)
  assert.equal(days[1].actual, 28)
  assert.equal(days[1].unexplained, 3)
  assert.equal(days[1].opening, 28, 'each day opens on the count before it')
})

test('food sales: food and drink and lines with no dish; never goods or services', () => {
  assert.equal(isFoodSale({ item_type: 'food' }), true)
  assert.equal(isFoodSale({ item_type: null, left_out: 'open' }), true, 'an open item typed in on the till')
  assert.equal(isFoodSale({ item_type: 'goods' }), false)
  assert.equal(isFoodSale({ item_type: 'service' }), false)
  assert.equal(isFoodSale({ item_type: 'food', left_out: 'service' }), false)
})

test('the band\'s settings: defaults, and what can\'t be saved', () => {
  assert.deepEqual(varianceSettings(null), { band_pct: 1, item_pct: 3, item_pounds: 50 })
  assert.deepEqual(varianceSettings({ variance_band_pct: 2, variance_item_pct: 5, variance_item_pounds: 25 }), { band_pct: 2, item_pct: 5, item_pounds: 25 })
  assert.equal(settingsProblem({ band_pct: 1, item_pct: 3, item_pounds: 50 }), null)
  assert.match(settingsProblem({ band_pct: 101, item_pct: 3, item_pounds: 50 }), /0 to 100/)
  assert.match(settingsProblem({ band_pct: 1, item_pct: 3, item_pounds: -1 }), /below 0/)
})

test('explain_variance: each piece of evidence with its fix, only what bears on the item', () => {
  const row = itemVariance({ moves: [count(0, 100), move('usage', 2, -150), move('waste', 3, -10), count(10, 0)], from: T(0), to: T(10), price: 0.5 })
  assert.equal(row.lowest.qty, -60, 'on hand went below zero')
  const ev = explainVariance({
    item: { name: 'Chicken thighs', base_unit: 'g' }, row, sees_values: true,
    uncosted: [{ name: 'Chicken wrap', qty: 12, why: 'No recipe linked' }],
    corrected: [{ label: 'PO-0012 from Brakes', received_at: T(1), changed_at: T(12) }],
    unit_changes: [{ name: 'tray', at: T(4) }],
    old_unit_deliveries: 1,
    waste: { entries: 1, voids: 0 },
    in_transit: [{ label: 'Transfer 4 to Leeds', qty_base: 500, direction: 'out' }],
    remakes: 2,
  })
  const kinds = ev.map(e => e.kind)
  assert.deepEqual(kinds, ['uncosted_dishes', 'corrected_deliveries', 'negative', 'unit_changed', 'old_unit_deliveries', 'waste', 'in_transit', 'remakes'])
  assert.match(ev[0].text, /Chicken wrap \(12 sold: No recipe linked\)/)
  assert.match(ev.find(e => e.kind === 'waste').text, /£5\.00/)
  for (const e of ev) {
    assert.ok(e.fix && EVIDENCE_KINDS[e.kind], e.kind + ' has a fix')
    assert.doesNotMatch(String(e.page || ''), /[0-9a-f]{8}-[0-9a-f]{4}/, 'no ids in a page')
  }
  const noValues = explainVariance({ item: { name: 'Chicken', base_unit: 'g' }, row, waste: { entries: 1 } })
  assert.doesNotMatch(noValues.find(e => e.kind === 'waste').text, /£/, 'no pounds without Costing view')
  const none = explainVariance({ item: { name: 'Rice', base_unit: 'g' }, row: itemVariance({ moves: [count(0, 10), count(5, 10)], from: T(0), to: T(5), price: 1 }) })
  assert.deepEqual(none, [], 'nothing to say')
  const unseen = explainVariance({ item: { name: 'Rice', base_unit: 'g' }, row: itemVariance({ moves: [count(0, 10), move('usage', 1, -2)], from: T(0) }) })
  assert.deepEqual(unseen.map(e => e.kind), ['not_counted'])
})

// docs/INVENTORY.md 14: opening + received - closing = theoretical + waste + variance for every item,
// with what moved between venues and adjustments on the left (a property check over generated data).
test('property: the figures add up for every item, and unexplained is the closing count against the ledger', () => {
  let seed = 42
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  const kinds = ['delivery', 'transfer_in', 'transfer_out', 'lost_in_transit', 'waste', 'usage', 'adjustment']
  for (let n = 0; n < 300; n++) {
    const moves = [count(0, Math.round(rand() * 5000))]
    for (let i = 0; i < 12; i++) {
      const kind = kinds[Math.floor(rand() * kinds.length)]
      const q = Math.round(rand() * 800) + 1
      const sign = ['delivery', 'transfer_in'].includes(kind) ? 1 : kind === 'adjustment' ? (rand() < 0.5 ? -1 : 1) : -1
      moves.push(move(kind, 1 + rand() * 100, sign * q))
    }
    if (rand() < 0.3) moves.push(count(50, Math.round(rand() * 3000)))
    moves.push(count(120, Math.round(rand() * 4000)))
    const r = itemVariance({ moves, from: T(0), to: T(120), price: 0.01 })
    const left = r.opening + r.received + r.transfers_in - r.transfers_out - r.closing
    assert.equal(Math.round((left - (r.theoretical + r.variance)) * 1e4), 0, 'actual = theoretical + variance')
    assert.equal(Math.round((r.variance - (r.waste - r.adjusted + r.unexplained)) * 1e4), 0, 'variance = waste - adjusted + unexplained')
    // With no count in between, unexplained is what the closing count found against the ledger.
    if (!moves.some(m => m.kind === 'count' && m.at === T(50))) {
      const expected = stockOnHand({ moves: moves.slice(0, -1) }).on_hand
      assert.equal(Math.round((expected - r.closing - r.unexplained) * 1e4), 0)
    }
  }
})

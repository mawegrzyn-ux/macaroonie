// What is stored beside a check for reports (checkBreakdowns(), migration
// 243) must add up to the till's own day figures (dayFigures()): a report
// that sums the stored rows shows what Till reports shows.
// Run: node --test shared/pos/test/

import test from 'node:test'
import assert from 'node:assert/strict'
import { checkTotals } from '../pricing.js'
import { checkBreakdowns, dayFigures, CHECK_BREAKDOWNS_V } from '../reports.js'

const uuid = () => globalThis.crypto.randomUUID()
const DAY = uuid()
const ANNA = uuid(), BEN = uuid()
let n = 0
const line = (name, price, extra = {}) => ({ id: 'l' + ++n, item_id: uuid(), section_id: null, name, qty: 1, unit_price: price, modifiers: [], combo: null, vat_rate: 20, status: 'sent', ...extra })
const check = (lines, extra = {}) => ({
  id: 'c' + ++n, day_id: DAY, number: n, mode: 'table', covers: 2, status: 'closed', server_id: ANNA,
  lines, discounts: [], promotions: [], charges: [], payments: [], refunds: [], ...extra,
})

function sample() {
  // 1. A comp on one line, 10% off the whole check, a service charge with VAT.
  const burger = line('Burger', 1000), cola = line('Cola', 300, { qty: 2, vat_rate: 0 })
  const a = check([burger, cola], {
    discounts: [
      { id: 'd1', scope: 'line', line_ids: [cola.id], comp: true, name: 'Spilled', reason: 'Dropped tray', by: ANNA, approved_by: BEN, at: '2026-11-12T12:00:00Z' },
      { id: 'd2', scope: 'check', type: 'percent', value: 10, name: 'Staff 10%', by: ANNA, at: '2026-11-12T12:01:00Z' },
    ],
    charges: [{ id: 'x1', name: 'Service charge', kind: 'percent', value: 12.5, optional: true, vat_rate: 20 }],
  })
  // 2. A meal deal, a promotion, a loyalty reward, a charge taken off, one waiting for guests.
  const wings = line('Wings', 800), fries = line('Fries', 350), tea = line('Tea', 250, { vat_rate: 0 })
  const b = check([wings, fries, tea], {
    promotions: [
      { promotion_id: uuid(), name: 'Wings meal', kind: 'combo', count: 1, lines: { [wings.id]: 100, [fries.id]: 50 } },
      { promotion_id: uuid(), name: 'Tea Tuesday', count: 1, lines: { [tea.id]: 50 } },
    ],
    discounts: [{ id: 'd3', scope: 'check', type: 'amount', value: 200, name: 'Free dessert', loyalty_redemption_id: uuid(), by: 'not-a-uuid', at: null }],
    charges: [
      { id: 'x2', name: 'Service charge', kind: 'percent', value: 12.5, optional: true, vat_rate: 20, removed: true, reason: 'Slow service', removed_by: ANNA, approved_by: BEN },
      { id: 'x3', name: 'Large party', kind: 'percent', value: 5, min_covers: 6, vat_rate: 0 },
      { id: 'x4', name: 'Cup deposit', kind: 'amount', value: 100, basis: 'dishes', per: 'dish', item_ids: [uuid()], vat_rate: 0 },
    ],
  })
  // 3. Still open: counts for nothing in the day's sales.
  const c = check([line('Soup', 500)], { status: 'open' })
  // 4. Cancelled, with what it was worth; an older one without a value.
  const d = check([line('Steak', 2200, { status: 'voided', voided: { at: '2026-11-12T13:00:00Z', day_id: DAY, by: ANNA, reason: 'Order cancelled', waste: true } })], {
    status: 'void', cancelled: { reason: 'Walked out', value: 2200, by: ANNA, approved_by: BEN, at: '2026-11-12T13:00:00Z', day_id: DAY },
  })
  const e = check([line('Pie', 700)], { status: 'void', cancelled: { reason: 'Old one', by: 'kiosk', at: null } })
  return [a, b, c, d, e]
}

test('the stored rows add up to the till\'s day figures', () => {
  const checks = sample()
  const day = dayFigures(checks, DAY)
  const closed = checks.filter(c => c.status === 'closed')
  const rows = closed.map(c => checkBreakdowns(c))

  // Discounts by kind and name, as the day report groups them.
  const sum = (list, f) => list.reduce((s, x) => s + f(x), 0)
  const all = rows.flatMap(r => r.discounts)
  assert.equal(sum(all, d => d.amount), day.sales.discounts)
  for (const d of day.discounts) {
    const kinds = d.promotion ? ['promotion', 'combo'] : d.comp ? ['comp'] : ['discount', 'reward']
    const mine = all.filter(x => kinds.includes(x.kind) && x.name === d.name)
    assert.equal(mine.length, d.count, d.name)
    assert.equal(sum(mine, x => x.amount), d.amount, d.name)
  }
  assert.deepEqual(all.map(d => d.kind).sort(), ['combo', 'comp', 'discount', 'promotion', 'reward'])

  // Charges: what they came to, and what was taken off.
  const charges = rows.flatMap(r => r.charges)
  assert.equal(sum(charges, x => x.amount), day.sales.service_charge)
  for (const x of day.charges) {
    const mine = charges.filter(y => y.name === x.name)
    assert.equal(mine.filter(y => y.amount > 0).length, x.count, x.name)
    assert.equal(sum(mine, y => y.amount), x.amount, x.name)
    assert.equal(mine.filter(y => y.removed && y.would_be > 0).length, x.removed, x.name)
    assert.equal(sum(mine.filter(y => y.removed), y => y.would_be), x.removed_value, x.name)
  }

  // VAT by rate, charges' VAT included.
  const vat = new Map()
  for (const v of rows.flatMap(r => r.vat)) {
    const row = vat.get(v.rate) || { rate: v.rate, net: 0, vat: 0, gross: 0 }
    row.net += v.net; row.vat += v.vat; row.gross += v.gross
    vat.set(v.rate, row)
  }
  assert.deepEqual([...vat.values()].sort((x, y) => x.rate - y.rate), day.vat)
  assert.equal(sum([...vat.values()], v => v.vat), day.sales.vat_total)
  assert.equal(sum([...vat.values()], v => v.gross), day.sales.total)

  // Cancelled orders and what each was worth.
  const cancelled = checks.map(c => checkBreakdowns(c).cancelled).filter(Boolean)
  assert.equal(cancelled.length, day.cancelled.count)
  assert.deepEqual(cancelled.map(c => c.value).sort((x, y) => x - y), day.cancelled.lines.map(l => l.value).sort((x, y) => x - y))
})

test('each row carries who, why and when, and nothing that would break a save', () => {
  const [a, b, , d, e] = sample()
  const A = checkBreakdowns(a)
  assert.deepEqual(A.discounts, [
    { idx: 0, kind: 'comp', name: 'Spilled', scope: 'line', amount: 600, reason: 'Dropped tray', applied_by: ANNA, approved_by: BEN, applied_at: '2026-11-12T12:00:00Z' },
    { idx: 1, kind: 'discount', name: 'Staff 10%', scope: 'check', amount: 100, reason: null, applied_by: ANNA, approved_by: null, applied_at: '2026-11-12T12:01:00Z' },
  ])
  assert.deepEqual(A.charges, [{ idx: 0, name: 'Service charge', kind: 'percent', optional: true, amount: 113, would_be: 113, removed: false, waiting: false, vat_rate: 20, remove_reason: null, removed_by: null, approved_by: null }])
  assert.equal(A.cancelled, null)

  const B = checkBreakdowns(b)
  // Promotions have nobody behind them; an id that isn't one is left out.
  assert.deepEqual(B.discounts.map(x => [x.kind, x.name, x.amount, x.applied_by]), [
    ['combo', 'Wings meal', 150, null], ['promotion', 'Tea Tuesday', 50, null], ['reward', 'Free dessert', 200, null],
  ])
  // Taken off: who and why. Waiting for more guests: kept, with what it would be.
  // The cup deposit counted nothing and would count nothing: not kept.
  assert.deepEqual(B.charges.map(x => [x.name, x.amount, x.would_be, x.removed, x.waiting, x.remove_reason, x.removed_by, x.approved_by]), [
    ['Service charge', 0, 125, true, false, 'Slow service', ANNA, BEN],
    ['Large party', 0, 50, false, true, null, null, null],
  ])
  assert.deepEqual(B.charges.map(x => x.idx), [0, 1])

  // A discount that comes to nothing isn't kept.
  const nothing = checkBreakdowns(check([line('Water', 0)], { discounts: [{ id: 'z', scope: 'check', type: 'percent', value: 50, name: 'Half' }] }))
  assert.deepEqual(nothing.discounts, [])
  assert.deepEqual(nothing.vat, [])

  assert.deepEqual(checkBreakdowns(d).cancelled, { at: '2026-11-12T13:00:00Z', reason: 'Walked out', value: 2200, by: ANNA, approved_by: BEN, day_id: DAY })
  // An older cancel: every line left on it, on the check's own day.
  assert.deepEqual(checkBreakdowns(e).cancelled, { at: null, reason: 'Old one', value: 700, by: null, approved_by: null, day_id: DAY })

  // The totals passed in are the ones used (saveCheck() has them already).
  const t = checkTotals(a)
  assert.deepEqual(checkBreakdowns(a, t), A)
  assert.equal(CHECK_BREAKDOWNS_V, 1)
  // A check with nothing on it.
  assert.deepEqual(checkBreakdowns({ id: 'x', lines: [] }), { discounts: [], charges: [], vat: [], cancelled: null })
})

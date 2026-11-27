// shared/stock.js (inventory phase 4a): on hand from moves, the running
// balance, counting in an item's own units and packs, the review of a
// count, the approval rule and the count day. Imports stock.js before
// procurement.js on purpose: the two load each other (procurement
// re-exports stockOnHand()), and either order must work.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  stockOnHand, runningBalance, countUnits, defaultCountUnit, unitChoice, entriesToBase, entriesText, countReview,
  notCounted, approvalProblem, countDueOn, signedBase, lineSaves, MAX_ENTRIES, MOVE_KINDS,
} from '../stock.js'
import { stockOnHand as reExported } from '../procurement.js'

const chicken = { name: 'Chicken', base_unit: 'g', units: [{ name: 'tray', base_qty: 2500 }, { name: 'KG', base_qty: 999 }] }
const packs = [
  { id: 'q1', pack_name: 'Case', pack_count: 4, pack_qty: 2.5, pack_unit: 'kg', pack_base_qty: 10000 },
  { id: 'q2', pack_name: 'case', pack_count: 4, pack_qty: 2.5, pack_unit: 'kg', pack_base_qty: 10000 },
  { id: 'q3', pack_name: 'Bag', pack_count: 1, pack_qty: 5, pack_unit: 'kg', pack_base_qty: 5000 },
]

test('one rule: procurement re-exports the stock rule', () => {
  assert.equal(reExported, stockOnHand)
  assert.deepEqual(Object.keys(MOVE_KINDS), ['count', 'delivery', 'adjustment', 'waste', 'transfer_out', 'transfer_in', 'lost_in_transit'], 'phase 4b added waste and transfers')
})

test('stockOnHand: the last count sets it, later moves add; a move at the count\'s moment is in the count; as at a moment', () => {
  const at = '2026-11-20T20:00:00Z'
  const moves = [
    { kind: 'delivery', qty_base: 4000, at },
    { kind: 'count', qty_base: 1000, at },
    { kind: 'count', qty_base: 999, at: '2026-11-19T20:00:00Z' },
    { kind: 'adjustment', qty_base: -250, at: '2026-11-21T08:00:00Z' },
    { kind: 'delivery', qty_base: 5000, at: '2026-11-22T08:00:00Z' },
  ]
  const r = stockOnHand({ moves })
  assert.deepEqual([r.on_hand, r.counted, r.counted_at, r.received_since, r.adjusted_since], [5750, 1000, at, 5000, -250])
  assert.deepEqual(r.since, { adjustment: -250, delivery: 5000 })
  assert.equal(r.sales_counted, false)
  assert.equal(stockOnHand({ moves, at: '2026-11-21T12:00:00Z' }).on_hand, 750)
  assert.equal(stockOnHand({ moves, at: '2026-11-20T10:00:00Z' }).on_hand, 999, 'before the later count, the earlier one')
  assert.equal(stockOnHand({ moves: [] }).on_hand, null)
  assert.equal(stockOnHand({ moves: moves.filter(m => m.kind !== 'count') }).received_since, 9000, 'never counted: everything received')
})

test('runningBalance: in time order, null before the first count, a count\'s change against the balance', () => {
  const rows = runningBalance([
    { kind: 'count', qty_base: 800, at: '2026-11-03T00:00:00Z' },
    { kind: 'delivery', qty_base: 500, at: '2026-11-01T00:00:00Z' },
    { kind: 'delivery', qty_base: 200, at: '2026-11-04T00:00:00Z' },
    { kind: 'count', qty_base: 900, at: '2026-11-05T00:00:00Z' },
  ])
  assert.deepEqual(rows.map(r => [r.kind, r.change, r.balance]), [['delivery', 500, null], ['count', null, 800], ['delivery', 200, 1000], ['count', -100, 900]])
})

test('countUnits: standard units of the item\'s kind, its own (not one named like a standard), its packs once each', () => {
  const units = countUnits(chicken, packs)
  assert.deepEqual(units.map(u => [u.key, u.base_qty, u.kind]), [
    ['g', 1, 'standard'], ['kg', 1000, 'standard'], ['tray', 2500, 'own'], ['pack:q1', 10000, 'pack'], ['pack:q3', 5000, 'pack'],
  ])
  assert.equal(defaultCountUnit(chicken, units), 'kg')
  assert.equal(defaultCountUnit({ ...chicken, count_unit: 'tray' }, units), 'tray')
  assert.deepEqual(countUnits({ base_unit: 'ml' }).map(u => u.key), ['ml', 'cl', 'l'])
  assert.deepEqual(countUnits({ base_unit: 'x' }), [])
})

test('unitChoice and entriesToBase: several units on a line, kept as typed, sizes from the choices only', () => {
  const units = countUnits(chicken, packs)
  assert.equal(unitChoice(units, 'Bags').key, 'pack:q3', 'a pack by its name, plural too')
  assert.equal(unitChoice(units, 'TRAY').key, 'tray')
  assert.equal(unitChoice(units, 'slice'), null)
  const r = entriesToBase([{ qty: 2, unit: 'case' }, { qty: 3, unit: 'tray' }, { qty: 400, unit: 'g' }, { qty: null, unit: 'kg' }], units, chicken)
  assert.equal(r.qty_base, 27900)
  assert.deepEqual(r.entries.map(e => [e.qty, e.unit, e.base_qty]), [[2, 'pack:q1', 10000], [3, 'tray', 2500], [400, 'g', 1]])
  assert.equal(entriesText(r.entries), '2 Case · 4 × 2.5 kg + 3 tray (2.5 kg) + 400 g')
  // A size the browser sends is never used: the item's own choices decide.
  assert.equal(entriesToBase([{ qty: 1, unit: 'tray', base_qty: 1 }], units, chicken).qty_base, 2500)
  assert.deepEqual(entriesToBase([], units, chicken), { qty_base: null, entries: [], problem: null })
  assert.match(entriesToBase([{ qty: 1, unit: 'each' }], units, chicken).problem, /Chicken has no size for an each/)
  assert.match(entriesToBase([{ qty: -1, unit: 'g' }], units, chicken).problem, /isn't a number/)
  assert.match(entriesToBase(Array.from({ length: MAX_ENTRIES + 1 }, () => ({ qty: 1, unit: 'g' })), units, chicken).problem, /at most/)
})

test('countReview: areas added per item, the difference and its value, gains and losses apart', () => {
  const r = countReview(
    [{ item_id: 'a', qty_base: 600 }, { item_id: 'a', qty_base: 600 }, { item_id: 'b', qty_base: 50 }, { item_id: 'c', qty_base: 5 }, { item_id: 'd', qty_base: 1 }],
    { expected: { a: 1000, b: 100, c: null, d: 2 }, cost: { a: 0.01, b: 0.1, c: 1 } })
  const of = Object.fromEntries(r.rows.map(x => [x.item_id, x]))
  assert.deepEqual([of.a.counted, of.a.diff, of.a.value], [1200, 200, 2])
  assert.deepEqual([of.b.diff, of.b.value], [-50, -5])
  assert.deepEqual([of.c.expected, of.c.diff, of.c.value], [null, null, null], 'never counted before: no difference')
  assert.deepEqual([of.d.diff, of.d.value], [-1, null], 'no cost: a difference with no value')
  assert.deepEqual(r.totals, { gain: 2, loss: -5, net: -3, valued: 2, unvalued: 1 })
})

test('notCounted, approvalProblem and countDueOn', () => {
  assert.deepEqual(notCounted(['a', 'b', 'b', 'c'], [{ item_id: 'b' }]), ['a', 'c'])
  assert.equal(approvalProblem({ status: 'draft' }, [], 'x', {}).code, 'not_submitted')
  assert.equal(approvalProblem({ status: 'approved' }, [], 'x', {}).code, 'not_submitted')
  const c = { status: 'submitted', submitted_by: 'Sam@x' }
  assert.equal(approvalProblem(c, [{ counted_by: 'sam@x' }], 'sam@x', { second_person_approves: false }), null, 'the setting off: anyone with Manage')
  assert.equal(approvalProblem(c, [{ counted_by: 'jo@x' }], 'SAM@X', { second_person_approves: true }).code, 'second_person', 'the submitter, in any case')
  assert.equal(approvalProblem(c, [{ counted_by: 'jo@x' }], 'jo@x', { second_person_approves: true }).code, 'second_person', 'a counter')
  assert.equal(approvalProblem(c, [{ counted_by: 'jo@x' }], 'max@x', { second_person_approves: true }), null)
  // Every form of the approver's name: a line kept under their sub still makes them a counter.
  assert.equal(approvalProblem(c, [{ counted_by: 'auth0|jo' }], ['jo@x', 'auth0|jo'], { second_person_approves: true }).code, 'second_person')
  assert.equal(approvalProblem(c, [{ counted_by: 'jo@x' }], ['max@x', 'auth0|max'], { second_person_approves: true }), null)
  assert.equal(approvalProblem(c, [{ counted_by: 'jo@x' }], [], { second_person_approves: true }), null, 'nobody named: nothing to compare')
  assert.equal(countDueOn({ count_weekday: 0 }, 0), true)
  assert.equal(countDueOn({ count_weekday: '3' }, 3), true)
  assert.equal(countDueOn({}, 3), false)
  assert.deepEqual([signedBase(2500, 'g'), signedBase(-500, 'g'), signedBase(0, 'each')], ['+2.5 kg', '-500 g', '0 each'])
})

test('lineSaves: a line goes a moment after it is typed; flush() waits for every save and says whether all saved', async () => {
  const timers = []
  const fake = { setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length - 1 }, clearTimer: i => { if (timers[i]) timers[i].fn = null } }
  const sent = []
  const answers = []
  const send = (key, body) => new Promise((resolve, reject) => { sent.push([key, body]); answers.push({ resolve, reject }) })
  const saves = lineSaves(send, { delay: 900, ...fake })
  saves.save('a|', { qty: 1 })
  saves.save('a|', { qty: 2 })
  assert.equal(sent.length, 0, 'nothing is sent while the line is being typed')
  assert.equal(timers.at(-1).ms, 900)
  // Submit: flush sends the waiting line at once and doesn't resolve before its answer.
  let done = null
  const flushed = saves.flush().then(v => { done = v })
  await new Promise(r => setTimeout(r, 0))
  assert.deepEqual(sent, [['a|', { qty: 2 }]], 'the last thing typed, once')
  assert.equal(done, null, 'still waiting for the line to save')
  answers[0].resolve()
  await flushed
  assert.equal(done, true)
  assert.ok(timers.every(t => t.fn === null), 'the line\'s wait was cleared, so it isn\'t sent twice')
  // A save already on its way is waited for too, and one that fails makes flush() false.
  saves.save('b|', { qty: 3 })
  timers.at(-1).fn()
  await new Promise(r => setTimeout(r, 0))
  assert.equal(sent.length, 2)
  const second = saves.flush()
  answers[1].reject(new Error('This count is waiting for approval: lines can\'t change'))
  assert.equal(await second, false, 'a line that didn\'t save stops the submit')
  assert.equal(saves.pending(), 0)
  assert.equal(await saves.flush(), true, 'nothing waiting: nothing to wait for')
})

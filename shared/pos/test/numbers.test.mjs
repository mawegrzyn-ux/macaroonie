// Per-device numbers (shared/pos/numbers.js): each till and kiosk numbers its
// own checks and counter orders, so nothing else has to hand them out.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultOrderRange, cleanOrderRange, rangesOverlap, freeOrderRange, cleanNumbers, mergeNumbers,
  nextNumbers, noteNumbers, numberText, CHECK_NO_MAX, ORDER_NO_MAX,
} from '../numbers.js'

test('order number ranges: a block of a hundred each, never overlapping', () => {
  assert.deepEqual(defaultOrderRange(0), { from: 1, to: 99 })
  assert.deepEqual(defaultOrderRange(1), { from: 100, to: 199 })
  assert.deepEqual(defaultOrderRange(4), { from: 400, to: 499 })
  assert.deepEqual(defaultOrderRange(500), { from: 9800, to: 9899 }, 'capped at the last block')
  assert.deepEqual(cleanOrderRange({ from: '5', to: 20 }), { from: 5, to: 20 })
  for (const bad of [null, {}, { from: 0, to: 9 }, { from: 10, to: 9 }, { from: 1, to: ORDER_NO_MAX + 1 }, { from: 1.5, to: 9 }]) {
    assert.equal(cleanOrderRange(bad), null, JSON.stringify(bad))
  }
  assert.ok(rangesOverlap({ from: 1, to: 99 }, { from: 99, to: 150 }))
  assert.ok(!rangesOverlap({ from: 1, to: 99 }, { from: 100, to: 199 }))
  assert.deepEqual(freeOrderRange([]), { from: 1, to: 99 })
  assert.deepEqual(freeOrderRange([{ from: 1, to: 99 }, { from: 200, to: 299 }]), { from: 100, to: 199 })
  assert.deepEqual(freeOrderRange([{ from: 1, to: 150 }]), { from: 200, to: 299 }, 'a block partly used is skipped')
})

test('next numbers: count up within the trading day, start again on the next', () => {
  let n = null
  const out = []
  for (let i = 0; i < 3; i++) {
    const r = nextNumbers(n, { date: '2026-10-30', counter: i !== 1, range: { from: 100, to: 102 } })
    n = r.numbers
    out.push([r.number, r.order_no])
  }
  assert.deepEqual(out, [[1, 100], [2, null], [3, 101]], 'a table check takes a check number only')
  // Round within the range: 102 is the last, then back to 100.
  let r = nextNumbers(n, { date: '2026-10-30', counter: true, range: { from: 100, to: 102 } })
  assert.equal(r.order_no, 102)
  r = nextNumbers(r.numbers, { date: '2026-10-30', counter: true, range: { from: 100, to: 102 } })
  assert.equal(r.order_no, 100)
  assert.equal(r.number, 5)
  // A range changed in Store tech: the next number comes from the new one.
  r = nextNumbers(r.numbers, { date: '2026-10-30', counter: true, range: { from: 300, to: 399 } })
  assert.equal(r.order_no, 300)
  // The next trading day starts again.
  r = nextNumbers(r.numbers, { date: '2026-10-31', counter: true, range: { from: 300, to: 399 } })
  assert.deepEqual([r.number, r.order_no], [1, 300])
  // No range set: the first block.
  assert.equal(nextNumbers(null, { date: '2026-10-31', counter: true }).order_no, 1)
  // The top check number goes round too.
  assert.equal(nextNumbers({ date: '2026-10-31', check: CHECK_NO_MAX, order: null }, { date: '2026-10-31' }).number, 1)
})

test('a device that lost its storage carries on from what the server saw', () => {
  assert.equal(cleanNumbers({ date: 'today', check: 3 }), null)
  assert.deepEqual(cleanNumbers({ date: '2026-10-30', check: -1, order: 0 }), { date: '2026-10-30', check: 0, order: null })
  const server = { date: '2026-10-30', check: 40, order: 152 }
  assert.deepEqual(mergeNumbers(null, server), server, 'wiped: the server\'s')
  assert.deepEqual(mergeNumbers({ date: '2026-10-30', check: 42, order: 154 }, server), { date: '2026-10-30', check: 42, order: 154 }, 'ahead of the server: its own')
  assert.deepEqual(mergeNumbers({ date: '2026-10-30', check: 12, order: null }, server), { date: '2026-10-30', check: 40, order: 152 })
  assert.deepEqual(mergeNumbers({ date: '2026-10-31', check: 2, order: 3 }, server), { date: '2026-10-31', check: 2, order: 3 }, 'a later day wins')
  assert.deepEqual(mergeNumbers({ date: '2026-10-29', check: 90, order: 9 }, server), server)
})

test('the sequencer keeps each device\'s highest numbers', () => {
  let all = noteNumbers({}, 'T1', '2026-10-30', { number: 3, order_no: 12 })
  all = noteNumbers(all, 'T2', '2026-10-30', { number: 1, order_no: 101 })
  all = noteNumbers(all, 'T1', '2026-10-30', { number: 2, order_no: null })
  assert.deepEqual(all, { T1: { date: '2026-10-30', check: 3, order: 12 }, T2: { date: '2026-10-30', check: 1, order: 101 } })
  const same = noteNumbers(all, 'T1', '2026-10-30', { number: 3, order_no: null })
  assert.equal(same, all, 'nothing new: the same map (nothing to save)')
  assert.equal(noteNumbers(all, 'T1', '2026-10-29', { number: 99, order_no: 1 }), all, 'an older day doesn\'t go back')
  assert.deepEqual(noteNumbers(all, 'T1', '2026-10-31', { number: 1, order_no: null }).T1, { date: '2026-10-31', check: 1, order: null })
})

test('a check\'s number in words', () => {
  assert.equal(numberText({ number: 47, number_code: 'T2' }), 'T2-47')
  assert.equal(numberText({ number: 47 }), '47')
  assert.equal(numberText({}), null)
})

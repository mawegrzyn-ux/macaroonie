// The till's own settings and what they follow (shared/pos/tillSettings.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { counterTill, leaveUnsent } from '../tillSettings.js'

const till = settings => ({ device: { settings } })

test('leaving an order with items not sent asks by default (migration 295)', () => {
  assert.equal(leaveUnsent(till({ mode: 'table' })), 'ask', 'nothing set: asks')
  assert.equal(leaveUnsent(till({ mode: 'table', leave_unsent: 'ask' })), 'ask')
  assert.equal(leaveUnsent(till({ mode: 'table', leave_unsent: 'leave' })), 'leave', 'only leave leaves')
  assert.equal(leaveUnsent(till({ mode: 'table', leave_unsent: 'bogus' })), 'ask', 'anything else asks')
  assert.equal(leaveUnsent({}), 'ask', 'no config: a table-service till')
  assert.equal(leaveUnsent(till({ mode: 'counter', leave_unsent: 'ask' })), 'leave', 'counter tills never ask')
  assert.equal(counterTill(till({ mode: 'counter' })), true)
  assert.equal(counterTill(till({})), false)
})

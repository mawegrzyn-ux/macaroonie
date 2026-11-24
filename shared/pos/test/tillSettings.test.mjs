// The till's own settings and what they follow (shared/pos/tillSettings.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { counterTill, leaveUnsent, receiptModeOf, orderPromptOf, tillStream, streamReceiptMode, streamOrderPrompt } from '../tillSettings.js'

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

test('a till "as the revenue stream" takes the receipt and the order prompt from the stream (migration 296)', () => {
  const streams = [
    { id: 'bar', receipt_mode: 'never', order_prompt: 'two' },
    { id: 'rest', receipt_mode: 'always', order_prompt: 'one' },
  ]
  const cfg = settings => ({ device: { settings }, revenue_streams: streams })
  // The check's stream first, else the till's own stream, else the first.
  assert.equal(receiptModeOf(cfg({ revenue_stream_id: 'bar' }), 'rest'), 'always', 'the check\'s stream')
  assert.equal(receiptModeOf(cfg({ revenue_stream_id: 'bar' })), 'never', 'no check: the till\'s stream')
  assert.equal(receiptModeOf(cfg({ revenue_stream_id: 'gone' })), 'never', 'a stream not there: the first')
  assert.equal(orderPromptOf(cfg({ revenue_stream_id: 'rest' }), 'bar'), 'two')
  assert.equal(orderPromptOf(cfg({ revenue_stream_id: 'rest' })), 'one')
  // 'stream' (or absent, or an old 'venue') follows the stream; a till's own choice wins.
  assert.equal(receiptModeOf(cfg({ receipt_mode: 'stream' }), 'rest'), 'always')
  assert.equal(receiptModeOf(cfg({ receipt_mode: 'venue' }), 'rest'), 'always')
  assert.equal(receiptModeOf(cfg({ receipt_mode: 'ask' }), 'rest'), 'ask', 'the till\'s own')
  assert.equal(orderPromptOf(cfg({ order_prompt: 'one' }), 'bar'), 'one', 'the till\'s own')
  assert.equal(orderPromptOf(cfg({ order_prompt: 'stream' }), 'bar'), 'two')
  // Defaults: a stream without them, no streams at all.
  assert.equal(streamReceiptMode({}), 'ask')
  assert.equal(streamReceiptMode({ receipt_mode: 'sometimes' }), 'ask')
  assert.equal(streamOrderPrompt(null), 'one')
  assert.equal(receiptModeOf({}), 'ask')
  assert.equal(orderPromptOf({}), 'one')
  assert.equal(tillStream({ revenue_streams: [] }), null)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEVICE_ONLINE_MS, SCREEN_ONLINE_MS, seenState, deviceOnline, boardSummary } from '../techBoard.js'

test('online: seen within the cut-off; never seen or not linked is neither', () => {
  const now = Date.parse('2026-11-22T12:00:00Z')
  const ago = ms => new Date(now - ms).toISOString()
  assert.equal(seenState(ago(60_000), DEVICE_ONLINE_MS, { now }), 'online')
  assert.equal(seenState(ago(DEVICE_ONLINE_MS + 1), DEVICE_ONLINE_MS, { now }), 'offline')
  assert.equal(seenState(null, DEVICE_ONLINE_MS, { now }), 'never')
  assert.equal(seenState(ago(1000), DEVICE_ONLINE_MS, { linked: false, now }), 'never', 'not linked')
  assert.equal(seenState(ago(149_000), SCREEN_ONLINE_MS, { now }), 'online')
  assert.equal(seenState(ago(151_000), SCREEN_ONLINE_MS, { now }), 'offline', 'screens have the shorter cut-off')
  assert.equal(deviceOnline({ paired: true, last_seen_at: ago(1000) }, now), true)
  assert.equal(deviceOnline({ paired: false, last_seen_at: ago(1000) }, now), false)
  assert.equal(deviceOnline({ secret_hash: 'x', last_seen_at: ago(1000) }, now), true, 'a raw row: linked by its secret')
})

test('the summary: what is fine, what needs someone (worst first); nothing to judge is left out', () => {
  const s = boardSummary([
    { kind: 'till', name: 'Till 2', tone: 'ok' }, { kind: 'till', name: 'Till 1', tone: 'bad' },
    { kind: 'printer', name: 'Bar', tone: 'warn' }, { kind: 'printer', name: 'Kitchen', tone: 'bad' },
    { kind: 'card', name: 'Card', tone: 'muted' },
  ])
  assert.deepEqual([s.total, s.good], [4, 1])
  assert.deepEqual(s.needs.map(n => n.name), ['Kitchen', 'Till 1', 'Bar'])
  assert.deepEqual(boardSummary([]), { total: 0, good: 0, needs: [] })
})

// How often devices ask for changes (shared/pos/pullTimes.js, migration 216).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PULL_TIMES, PULL_PRESETS, PULL_DEFAULTS, pullTimes, pullMs, presetOf, asksPerHour, pullText, cleanPull } from '../pullTimes.js'

test('defaults, limits and off', () => {
  assert.deepEqual(pullTimes({}), { content: 180, live: 30, screen: 60, board: 15 })
  assert.deepEqual(pullTimes(null), PULL_DEFAULTS)
  // From a pos_settings row (columns) or a config's pull (keys).
  assert.deepEqual(pullTimes({ pull_content_secs: 600, pull_live_secs: 0, pull_screen_secs: 300, pull_board_secs: 30 }), { content: 600, live: 0, screen: 300, board: 30 })
  assert.deepEqual(pullTimes({ content: 20, live: 5000, screen: 0, board: 2 }), { content: 60, live: 600, screen: 30, board: 5 }, 'clamped; only live can be off')
  assert.equal(pullTimes({ content: 'x' }).content, 180, 'not a number: the default')
  const live = PULL_TIMES.find(d => d.key === 'live')
  assert.equal(cleanPull(live, 0), 0)
  assert.equal(cleanPull(live, -5), 0)
  assert.equal(cleanPull(PULL_TIMES[0], 0), 60, 'the whole config is never off')
})

test('device waits in ms, off as null', () => {
  assert.deepEqual(pullMs({ content: 600, live: 0, screen: 60, board: 15 }), { content: 600000, live: null, screen: 60000, board: 15000 })
  assert.deepEqual(pullMs(undefined), { content: 180000, live: 30000, screen: 60000, board: 15000 })
})

test('presets fit the limits and are recognised', () => {
  for (const p of PULL_PRESETS) {
    assert.deepEqual(pullTimes(p.values), p.values, p.key + ' within the limits')
    assert.equal(presetOf(p.values), p.key)
  }
  assert.equal(presetOf({}), 'standard', 'the defaults are the standard preset')
  assert.equal(presetOf({ content: 240 }), null)
})

test('asks an hour and words', () => {
  const std = PULL_PRESETS[0].values
  assert.equal(asksPerHour(std, 'terminal'), 20 + 120)
  assert.equal(asksPerHour(std, 'kds'), 20)
  assert.equal(asksPerHour(std, 'screen'), 60)
  assert.equal(asksPerHour(std, 'board'), 60 + 240)
  assert.equal(asksPerHour({ live: 0 }, 'kiosk'), 20, 'off adds nothing')
  assert.equal(pullText(0), 'Off')
  assert.equal(pullText(30), '30 seconds')
  assert.equal(pullText(180), '3 minutes')
  assert.equal(pullText(3600), '1 hour')
  assert.equal(pullText(5400), '1 hour 30 minutes')
})

// Platform alerts (the follow-up to OUTSTANDING 45): the rule for when the
// platform admins are emailed (down two checks running, slow for 30 minutes,
// back up after either; each once a spell), the email's words, and the last
// alert on the Platform page's status.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import IORedis from 'ioredis'
import { nextAlert, alertHtml, FRESH, DOWN_AFTER, SLOW_AFTER_MS } from '../src/services/platformAlerts.js'
import { platformStatus } from '../src/services/platformStatus.js'
import { env } from '../src/config/env.js'

const redis = new IORedis(env.REDIS_URL)
after(async () => { await redis.del('mac:status:alert:last'); redis.disconnect() })

/** Runs checks [state, minutes] through the rule; returns what was sent. */
function run(checks) {
  let mem = { ...FRESH }
  const sent = []
  const t0 = Date.parse('2026-11-22T12:00:00Z')
  for (const [state, mins] of checks) {
    const r = nextAlert(mem, { state, reasons: [state + ' reason'], at: t0 + mins * 60_000 })
    mem = r.mem
    if (r.send) sent.push(r.send.kind + '@' + mins)
  }
  return sent
}

test('down is told after two checks running, once, and up after it', () => {
  assert.equal(DOWN_AFTER, 2)
  assert.deepEqual(run([['up', 0], ['down', 1], ['up', 2]]), [], 'one bad check is a blip')
  assert.deepEqual(run([['down', 0], ['down', 1], ['down', 2], ['down', 3], ['up', 4]]), ['down@1', 'up@4'])
  // Down, then slow, then up: told down and back up only.
  assert.deepEqual(run([['down', 0], ['down', 1], ['degraded', 2], ['degraded', 60], ['up', 61]]), ['down@1', 'up@61'])
})

test('slow is told after 30 minutes of it, once; a short spell says nothing', () => {
  assert.equal(SLOW_AFTER_MS, 30 * 60_000)
  assert.deepEqual(run([['degraded', 0], ['degraded', 29], ['up', 30]]), [])
  assert.deepEqual(run([['degraded', 0], ['degraded', 15], ['degraded', 30], ['degraded', 45], ['up', 50]]), ['degraded@30', 'up@50'])
  // Slow, then down: the slow alert, then the down one.
  assert.deepEqual(run([['degraded', 0], ['degraded', 30], ['down', 31], ['down', 32], ['up', 40]]), ['degraded@30', 'down@32', 'up@40'])
  assert.deepEqual(run([['up', 0], ['up', 1]]), [], 'all well: nothing')
})

test('the email says what is wrong, escaped, with the Platform page', () => {
  const html = alertHtml({ kind: 'down', reasons: ['The database can\'t be reached <now>.'] }, new Date('2026-11-22T12:05:00Z'))
  assert.match(html, /Macaroonie is down/)
  assert.match(html, /Tills keep trading offline/)
  assert.match(html, /can't be reached &lt;now&gt;\./)
  assert.match(html, /2026-11-22 12:05 UTC/)
  assert.match(html, /\/platform"/)
  assert.match(alertHtml({ kind: 'up', reasons: [] }), /back up/)
})

test('the Platform page\'s status carries the last alert sent', async () => {
  await redis.set('mac:status:alert:last', JSON.stringify({ kind: 'down', at: '2026-11-22T12:05:00.000Z', to: 1, of: 1 }))
  const s = await platformStatus()
  assert.deepEqual(s.alert, { kind: 'down', at: '2026-11-22T12:05:00.000Z', to: 1, of: 1 })
})

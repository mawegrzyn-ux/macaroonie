// Whether the platform is up (services/platformStatus.js): the Platform
// page's Status (platform admins only, everything), the one light a venue's
// Tech board shows (anyone signed in, the state only), and the rules that
// turn the checks into up, degraded or down.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, PLATFORM } from './support/seed.mjs'
import { stateOf, JOBS, startProcessBeat, platformStatus } from '../src/services/platformStatus.js'

let ids
before(async () => { ids = await resetAndSeed() })
after(closeApp)

test('the rules: down without the database, degraded for Redis, a late job or a full disk', () => {
  const okDb = { ok: true }, okRedis = { ok: true }
  assert.deepEqual(stateOf({ db: okDb, redis: okRedis, jobs: [], machine: { disk: { free_pct: 40 } } }), { state: 'up', reasons: [] })
  assert.equal(stateOf({ db: { ok: false }, redis: okRedis }).state, 'down')
  assert.equal(stateOf({ db: { ok: false }, redis: { ok: false } }).state, 'down', 'the database decides first')
  const r = stateOf({ db: okDb, redis: { ok: false } })
  assert.equal(r.state, 'degraded')
  assert.match(r.reasons[0], /Redis/)
  const late = stateOf({ db: okDb, redis: okRedis, jobs: [{ label: 'Task notices', late: true }, { label: 'Emails', late: false }] })
  assert.deepEqual(late, { state: 'degraded', reasons: ['Task notices hasn\'t run for a while.'] })
  assert.match(stateOf({ db: okDb, redis: okRedis, machine: { disk: { free_pct: 6 } } }).reasons[0], /94% full/)
  assert.ok(JOBS.every(j => j.every == null || j.every >= 60_000), 'every repeating job is listed with its interval')
})

test('the Status: platform admins only, every part there', async () => {
  const stop = startProcessBeat()
  try {
    assert.equal((await as(A.owner, ids.a).get('/api/platform/status')).status, 403)
    assert.equal((await as(null, null).get('/api/platform/status')).status, 401)
    await new Promise(r => setTimeout(r, 300))
    const s = await ok(as(PLATFORM, null).get('/api/platform/status'))
    assert.ok(['up', 'degraded', 'down'].includes(s.state))
    assert.equal(s.database.ok, true)
    assert.equal(typeof s.database.size_mb, 'number')
    assert.equal(s.redis.ok, true, 'the tests run with Redis')
    assert.ok(s.processes.some(p => p.pid === process.pid), 'this process\'s heartbeat')
    assert.equal(s.jobs.length, JOBS.length)
    assert.ok(s.jobs.every(j => j.counts && typeof j.counts.failed === 'number'))
    assert.ok(s.machine.cpus > 0)
    assert.equal(s.state, (await platformStatus()).state)
  } finally { stop() }
})

test('the light: anyone signed in, the state and when only', async () => {
  const light = await ok(as(A.viewer, ids.a).get('/api/status/light'))
  assert.deepEqual(Object.keys(light).sort(), ['checked_at', 'state'])
  assert.ok(['up', 'degraded', 'down'].includes(light.state))
  assert.equal((await as(null, null).get('/api/status/light')).status, 401)
})

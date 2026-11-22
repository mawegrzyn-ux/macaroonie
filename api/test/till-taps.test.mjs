// Taps on till layout buttons (migration 266, OUTSTANDING 44.8): a till
// sends its counts (POST /pos-api/till-taps), they add up per day, till,
// person and button, rows naming another venue's person or a layout that
// isn't the tenant's are left out, old rows go; the designer's heat map
// (GET /api/pos/till-layouts/:id/taps) and who sees taps by person; the
// report builder's Till buttons tapped and the activity starters.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'

let ids, owner, V, layout, till, till2, kds, staff, setupOnly
const SETUP_ONLY = 'a-setup-only'

async function device(d, method, url, body) {
  const app = await getApp()
  const res = await app.inject({
    method, url,
    headers: {
      authorization: `Device ${d.device_id}.${d.secret}`,
      [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    payload: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return { status: res.statusCode, json: res.json() }
}

const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
const tap = (extra = {}) => ({ day: today(), staff_id: staff, layout_id: layout.id, zone_id: 'dishes', zone_type: 'items', cell: 'dish-a', label: 'Pad Thai', n: 1, ...extra })

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  staff = filled.ids.staff
  layout = await ok(owner.post('/api/pos/till-layouts', { name: 'Taps layout', template: 'quick' }))
  till = await linkDevice(owner, V, { kind: 'terminal', name: 'Taps till' })
  till2 = await linkDevice(owner, V, { kind: 'terminal', name: 'Taps till 2' })
  kds = await linkDevice(owner, V, { kind: 'kds', name: 'Taps screen' })
  // Store tech view, no Till reports.
  const role = await ok(owner.post('/api/access/roles', { key: 'tech_only', label: 'Tech only', permissions: { pos_setup: 'view' } }))
  await sql`INSERT INTO users (tenant_id, email, role, auth0_user_id, custom_role_id)
            VALUES (${ids.a}, ${SETUP_ONLY + '@test.local'}, 'operator', ${SETUP_ONLY}, ${role.id})`
  setupOnly = as(SETUP_ONLY, ids.a)
})
after(closeApp)

test('a till\'s taps add up per day, till, person and button; what isn\'t right is left out', async () => {
  const first = await device(till, 'POST', '/pos-api/till-taps', {
    taps: [
      tap({ n: 3 }),
      tap({ n: 2, staff_id: null }),
      tap({ cell: 's:sec-1', zone_id: 'cats', zone_type: 'categories', label: 'Mains', n: 4 }),
      tap({ layout_id: crypto.randomUUID() }),
      tap({ staff_id: crypto.randomUUID() }),
      tap({ zone_type: 'modifiers' }),
    ],
  })
  assert.equal(first.status, 200)
  assert.equal(first.json.kept, 3)
  // Sent again: added to the day's.
  assert.equal((await device(till, 'POST', '/pos-api/till-taps', { taps: [tap({ n: 5, label: 'Pad Thai (large)' })] })).json.kept, 1)
  assert.equal((await device(till2, 'POST', '/pos-api/till-taps', { taps: [tap({ n: 1 }), tap({ cell: 'b1', zone_id: 'buttons', zone_type: 'buttons', label: 'Exact cash', n: 2 })] })).json.kept, 2)
  const rows = await sql`SELECT device_id, staff_id, zone_id, cell, label, taps FROM pos_till_taps WHERE tenant_id = ${ids.a} AND layout_id = ${layout.id} ORDER BY taps DESC, cell`
  assert.deepEqual(rows.map(r => [r.device_id === till.id ? 'till' : 'till2', r.staff_id ? 'staff' : 'nobody', r.cell, r.taps]), [
    ['till', 'staff', 'dish-a', 8],
    ['till', 'staff', 'sec-1', 4],
    ['till2', 'staff', 'b1', 2],
    ['till', 'nobody', 'dish-a', 2],
    ['till2', 'staff', 'dish-a', 1],
  ])
  assert.equal(rows[0].label, 'Pad Thai (large)', 'the latest words are kept')

  const refused = await device(kds, 'POST', '/pos-api/till-taps', { taps: [tap()] })
  assert.equal(refused.status, 403, 'a kitchen screen counts no taps')
  // A row past the 90 days goes when the venue's tills send theirs.
  await sql`INSERT INTO pos_till_taps (tenant_id, venue_id, device_id, staff_id, layout_id, zone_id, zone_type, cell, day, taps)
            VALUES (${ids.a}, ${V}, ${till.id}, NULL, ${layout.id}, 'dishes', 'items', 'old', ${daysAgo(120)}, 9)`
  assert.equal((await device(till, 'POST', '/pos-api/till-taps', { taps: [tap({ day: daysAgo(100) }), tap({ n: 0 })] })).json.kept, 0, 'a day past the 90 days isn\'t kept')
  assert.equal((await device(till, 'POST', '/pos-api/till-taps', { taps: [tap({ cell: 'dish-b' })] })).json.kept, 1)
  assert.equal((await sql`SELECT count(*)::int AS n FROM pos_till_taps WHERE cell = 'old'`)[0].n, 0)
})

test('the heat map: per zone and button, the most tapped, by till, and by person only for Till reports', async () => {
  const all = await ok(owner.get(`/api/pos/till-layouts/${layout.id}/taps?days=7`))
  assert.equal(all.days, 7)
  assert.deepEqual(all.zones, { dishes: { 'dish-a': 11, 'dish-b': 1 }, cats: { 'sec-1': 4 }, buttons: { b1: 2 } })
  assert.equal(all.max, 11)
  assert.equal(all.total, 18)
  assert.deepEqual(all.top.slice(0, 2).map(t => [t.cell, t.label, t.taps]), [['dish-a', 'Pad Thai', 11], ['sec-1', 'Mains', 4]], 'the words last sent, whichever till')
  assert.deepEqual(all.tills.map(t => [t.name, t.taps]), [['Taps till', 15], ['Taps till 2', 3]])
  assert.equal(all.people.length, 1)
  assert.equal(all.people[0].taps, 16)

  const oneTill = await ok(owner.get(`/api/pos/till-layouts/${layout.id}/taps?device_id=${till2.id}`))
  assert.equal(oneTill.total, 3)
  const onePerson = await ok(owner.get(`/api/pos/till-layouts/${layout.id}/taps?staff_id=${staff}`))
  assert.equal(onePerson.total, 16)

  // Store tech view without Till reports: the buttons and tills, never people.
  const tech = await ok(setupOnly.get(`/api/pos/till-layouts/${layout.id}/taps`))
  assert.equal(tech.total, 18)
  assert.equal(tech.people, null)
  assert.equal((await setupOnly.get(`/api/pos/till-layouts/${layout.id}/taps?staff_id=${staff}`)).status, 403)
  // Another tenant's layout isn't there.
  assert.equal((await as(B.owner, ids.b).get(`/api/pos/till-layouts/${layout.id}/taps`)).status, 404)
  assert.equal((await owner.get(`/api/pos/till-layouts/${layout.id}/taps?days=400`)).status, 400)
})

test('the report builder: Till buttons tapped, and the people and tills starters', async () => {
  const ref = key => 'starter:' + key
  const period = { from: daysAgo(6), to: today() }
  const buttons = await ok(owner.post(`/api/reports/${ref('till_buttons_tapped')}/run`, { params: { period } }))
  const flat = JSON.stringify(buttons)
  assert.ok(flat.includes('Pad Thai (large)') && flat.includes('Taps layout'), 'the buttons by layout')
  for (const key of ['till_activity_by_person', 'till_activity_by_till', 'kitchen_screen_taps']) {
    const r = await owner.post(`/api/reports/${ref(key)}/run`, { params: { period } })
    assert.equal(r.status, 200, key + ': ' + r.body)
  }
  // Till reports is needed for the taps subject (people's figures).
  const tech = await setupOnly.post(`/api/reports/${ref('till_buttons_tapped')}/run`, { params: { period } })
  assert.notEqual(tech.status, 200)
})

// The order's allergy flag (shared/pos/allergy.js) through the cloud's
// sequencer: check.allergy_set from a till, kept on the check, on the
// kitchen order (kds_orders) and the kitchen printer's ticket, an ALLERGY
// UPDATE ticket when it changes after printing, refusals, and the till
// config carrying the tags the till offers.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { ulid } from '../../shared/pos/ids.js'
import { toText } from '../../shared/pos/tickets.js'

let ids, owner, V, dish, till, staffId, net, box, tags

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
  let json = null
  try { json = res.json() } catch { json = null }
  return { status: res.statusCode, json, body: res.body }
}
const ev = (type, payload, extra = {}) => ({ id: ulid(), type, payload, client_at: new Date().toISOString(), staff_id: staffId, ...extra })
async function send(events) {
  const r = await device(till, 'POST', '/pos-api/events', { events })
  assert.equal(r.status, 200, r.body)
  return r.json.results
}
const line = () => ({ id: ulid(), item_id: dish.id, section_id: dish.section_id, name: dish.name, qty: 1, unit_price: 1000, modifiers: [], vat_rate: 20 })
const jobs = checkId => sql`SELECT kind, ops, printer_id FROM pos_print_jobs WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND check_id = ${checkId} ORDER BY created_at, kind`

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  const menu = await ok(owner.get('/api/menus/' + filled.ids.menu))
  dish = { ...menu.sections[0].items[0], section_id: menu.sections[0].id }
  staffId = filled.ids.staff
  const role = await ok(owner.post('/api/pos/roles', { name: 'Zqa Server', permissions: {} }))
  await ok(owner.put(`/api/pos/venues/${V}/staff/${staffId}/pos`, { pos_role_id: role.id, pin: '4826' }))
  till = await linkDevice(owner, V, { kind: 'terminal', name: 'Zqa Till' })
  // Every dish prints at the grill printer straight from Orders in.
  net = await ok(owner.post(`/api/pos/venues/${V}/printers`, { name: 'Zqa Grill printer', host: '10.0.0.21', port: 9100, columns: 42 }))
  box = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Zqa Grill tickets', kind: 'printer', settings: { printer_id: net.id } }))
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  const flow = setup.kds_flows.find(f => f.id === setup.kds_active_flow_id)
  await ok(owner.put(`/api/pos/kds-flows/${flow.id}`, { links: [{ from: null, to: box.id, targets: [] }], layout: {} }))
  const cfg = await device(till, 'GET', '/pos-api/config')
  assert.equal(cfg.status, 200, cfg.body)
  tags = cfg.json.dietary_tags
})
after(closeApp)

test('the till offers the menu\'s allergens and diets; a flag is kept on the check, the kitchen order and the ticket', async () => {
  const allergens = tags.filter(t => t.kind === 'allergen')
  assert.ok(allergens.length >= 14, 'the standard allergens reach the till')
  const milk = allergens.find(t => /milk/i.test(t.label))
  const nuts = allergens.find(t => /peanut/i.test(t.label))
  const flag = { allergens: [{ code: milk.code, name: milk.label }, { code: nuts.code, name: nuts.label }], diets: [], note: 'Zqa coeliac' }
  const check = ulid()
  const l = line()
  const r = await send([
    ev('check.opened', { mode: 'tab', tab_name: 'Zqa Sam', number: 801 }, { check_id: check }),
    ev('line.added', { line: l }, { check_id: check }),
    // Sent untidy (a tag twice, spaces round the note): kept tidy.
    ev('check.allergy_set', { allergy: { ...flag, allergens: [...flag.allergens, flag.allergens[0]], note: '  Zqa coeliac  ' } }, { check_id: check }),
    ev('lines.sent', { send_id: ulid(), line_ids: [l.id], held_course_ids: [] }, { check_id: check }),
  ])
  assert.ok(r.every(x => x.ok), JSON.stringify(r))
  const [row] = await sql`SELECT state FROM pos_checks WHERE id = ${check} AND tenant_id = ${ids.a}`
  assert.deepEqual(row.state.allergy, { ...flag, note: 'Zqa coeliac' })
  const [ko] = await sql`SELECT state FROM kds_orders WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND check_id = ${check}`
  const text = milk.label + ', ' + nuts.label + ' · Zqa coeliac'
  assert.equal(ko.state.allergy, text)
  let printed = await jobs(check)
  assert.equal(printed.length, 1)
  assert.equal(printed[0].kind, 'kitchen')
  assert.match(toText(printed[0].ops), new RegExp('ALLERGY: ' + text.toUpperCase()))

  // Changed after printing: the kitchen order follows and the printer gets an update.
  const r2 = await send([ev('check.allergy_set', { allergy: { allergens: [{ code: nuts.code, name: nuts.label }], diets: [], note: null } }, { check_id: check })])
  assert.ok(r2[0].ok, JSON.stringify(r2))
  const [ko2] = await sql`SELECT state FROM kds_orders WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND check_id = ${check}`
  assert.equal(ko2.state.allergy, nuts.label)
  printed = await jobs(check)
  assert.equal(printed.length, 2)
  const update = printed.find(j => j.kind === 'allergy')
  assert.ok(update, 'an allergy update job')
  assert.equal(update.printer_id, net.id)
  assert.match(toText(update.ops), new RegExp('ALLERGY: ' + nuts.label.toUpperCase()))

  // The kitchen screen's sync carries it too.
  const ks = await device(till, 'GET', '/pos-api/sync?since=0')
  assert.equal(ks.status, 200, ks.body)
})

test('refused: a flag in the wrong shape, and on a closed check', async () => {
  const check = ulid()
  await send([ev('check.opened', { mode: 'tab', tab_name: 'Zqa Kim', number: 802 }, { check_id: check })])
  for (const bad of [{}, { allergy: 'nuts' }, { allergy: { allergens: [{ code: 'x' }] } }, { allergy: { note: 'x'.repeat(301) } }]) {
    const [r] = await send([ev('check.allergy_set', bad, { check_id: check })])
    assert.equal(r.ok, false, JSON.stringify(bad))
  }
  const [closed] = await send([ev('check.closed', {}, { check_id: check })])
  assert.ok(closed.ok, JSON.stringify(closed))
  const [r] = await send([ev('check.allergy_set', { allergy: { note: 'Zqa late' } }, { check_id: check })])
  assert.equal(r.ok, false)
  const [row] = await sql`SELECT state FROM pos_checks WHERE id = ${check} AND tenant_id = ${ids.a}`
  assert.equal(row.state.allergy, null)
})

// The till's receipt choice and "needs a manager every time" switches
// (migration 224), and Cancel order, through the real settings routes and
// the cloud's sequencer: the venue's switches reach the tills in their config
// and the sequencer refuses what they refuse (shared/pos/checks.js).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { ulid } from '../../shared/pos/ids.js'

let ids, owner, viewer, V, leadId, bossId, till, dish

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
const ev = (type, payload, extra = {}) => ({ id: ulid(), type, payload, client_at: new Date().toISOString(), staff_id: leadId, ...extra })
async function send(events) {
  const r = await device(till, 'POST', '/pos-api/events', { events })
  assert.equal(r.status, 200, r.body)
  return r.json.results
}
const line = () => ({ id: ulid(), item_id: dish.id, section_id: dish.section_id, name: dish.name, qty: 1, unit_price: 1200, modifiers: [], vat_rate: 20 })

/** An open table check with one dish sent and one not. */
async function openCheck() {
  const check = ulid()
  const sent = line()
  const fresh = line()
  const res = await send([
    ev('check.opened', { mode: 'table', number: Math.floor(Math.random() * 9000) + 1 }, { check_id: check }),
    ev('line.added', { line: sent }, { check_id: check }),
    ev('lines.sent', { send_id: ulid(), line_ids: [sent.id] }, { check_id: check }),
    ev('line.added', { line: fresh }, { check_id: check }),
  ])
  assert.ok(res.every(r => r.ok), JSON.stringify(res))
  return { check, sent, fresh }
}

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc' })
  owner = as(A.owner, ids.a)
  viewer = as(A.viewer, ids.a)
  V = filled.ids.venue
  const menu = await ok(owner.get('/api/menus/' + filled.ids.menu))
  dish = { ...menu.sections[0].items[0], section_id: menu.sections[0].id }
  // A shift lead whose role voids but can't approve, and a manager.
  const lead = await ok(owner.post('/api/pos/roles', { name: 'Zqa Lead', permissions: { void: true } }))
  const boss = await ok(owner.post('/api/pos/roles', { name: 'Zqa Manager', permissions: { void: true, refund: true, manager: true } }))
  leadId = filled.ids.staff
  bossId = filled.ids.staff2
  await ok(owner.put(`/api/pos/venues/${V}/staff/${leadId}/pos`, { pos_role_id: lead.id, pin: '2580' }))
  await ok(owner.put(`/api/pos/venues/${V}/staff/${bossId}/pos`, { pos_role_id: boss.id, pin: '1397' }))
  till = await linkDevice(owner, V, { kind: 'terminal', name: 'Zqa Till' })
})
after(closeApp)

test('the receipt choice and the switches: saved per venue, cleaned, refused for viewers and other groups', async () => {
  const setup = await ok(owner.get('/api/pos/venues/' + V + '/setup'))
  assert.equal(setup.settings.receipt_mode, 'ask')
  assert.deepEqual(setup.settings.approvals, { delete_unsent: false, void_sent: false, cancel_order: false, refund: false, remove_charge: false, custom_discount: false })
  const saved = await ok(owner.patch(`/api/pos/venues/${V}/settings`, { receipt_mode: 'always', approvals: { void_sent: true } }))
  assert.equal(saved.receipt_mode, 'always')
  assert.deepEqual(saved.approvals, { delete_unsent: false, void_sent: true, cancel_order: false, refund: false, remove_charge: false, custom_discount: false })
  // Left out of a later save, both stay.
  const again = await ok(owner.patch(`/api/pos/venues/${V}/settings`, { tips_enabled: true }))
  assert.equal(again.receipt_mode, 'always')
  assert.equal(again.approvals.void_sent, true)
  assert.equal((await owner.patch(`/api/pos/venues/${V}/settings`, { receipt_mode: 'sometimes' })).status, 400)
  assert.equal((await owner.patch(`/api/pos/venues/${V}/settings`, { approvals: { everything: true } })).status, 400)
  assert.equal((await viewer.patch(`/api/pos/venues/${V}/settings`, { receipt_mode: 'never' })).status, 403)
  assert.equal((await as(B.owner, ids.b).patch(`/api/pos/venues/${V}/settings`, { receipt_mode: 'never' })).status, 404)
  const [row] = await sql`SELECT receipt_mode, approvals FROM pos_settings WHERE venue_id = ${V}`
  assert.equal(row.receipt_mode, 'always')
  assert.deepEqual(row.approvals, { delete_unsent: false, void_sent: true, cancel_order: false, refund: false, remove_charge: false, custom_discount: false })
})

test('a till has its own receipt choice; both reach the till in its config', async () => {
  const d = await ok(owner.patch('/api/pos/devices/' + till.id, { settings: { mode: 'table', receipt_mode: 'never' } }))
  assert.equal(d.settings.receipt_mode, 'never')
  assert.equal((await owner.patch('/api/pos/devices/' + till.id, { settings: { mode: 'table', receipt_mode: 'bogus' } })).status, 400)
  const cfg = await device(till, 'GET', '/pos-api/config')
  assert.equal(cfg.status, 200, cfg.body)
  assert.equal(cfg.json.device.settings.receipt_mode, 'never')
  assert.equal(cfg.json.settings.receipt_mode, 'always')
  assert.equal(cfg.json.settings.approvals.void_sent, true)
  await ok(owner.patch('/api/pos/devices/' + till.id, { settings: { mode: 'table', receipt_mode: 'venue' } }))
})

test('the sequencer: voiding a sent item needs a manager while the switch is on', async () => {
  const { check, sent } = await openCheck()
  const refused = await send([ev('line.voided', { line_id: sent.id, reason: 'Wrong item' }, { check_id: check })])
  assert.equal(refused[0].ok, false)
  assert.equal(refused[0].code, 'manager')
  const okd = await send([ev('line.voided', { line_id: sent.id, reason: 'Wrong item' }, { check_id: check, approved_by: bossId })])
  assert.ok(okd[0].ok, JSON.stringify(okd))
  // Switched off, the lead's own role is enough.
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { approvals: { void_sent: false } }))
  const other = await openCheck()
  const free = await send([ev('line.voided', { line_id: other.sent.id, reason: 'Wrong item' }, { check_id: other.check })])
  assert.ok(free[0].ok, JSON.stringify(free))
})

test('Cancel order: the batch voids, deletes and closes the check as cancelled, in the day report', async () => {
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { approvals: { cancel_order: true, delete_unsent: true } }))
  const { check, sent, fresh } = await openCheck()
  const batch = by => [
    ev('line.voided', { line_id: sent.id, reason: 'Guest left', waste: true, cancel: true }, { check_id: check, ...by }),
    ev('line.deleted', { line_id: fresh.id, cancel: true }, { check_id: check, ...by }),
    ev('check.closed', { cancel_reason: 'Guest left' }, { check_id: check, ...by }),
  ]
  // Without a manager the delete is refused (and the cancel after it).
  const refused = await send(batch({}))
  assert.equal(refused[0].ok, true)
  assert.equal(refused[1].code, 'manager')
  assert.equal(refused[2].ok, false)
  const [still] = await sql`SELECT status FROM pos_checks WHERE id = ${check}`
  assert.equal(still.status, 'open')
  // With the manager's PIN on each: done (the void went through already).
  const done = await send([
    ev('line.deleted', { line_id: fresh.id, cancel: true }, { check_id: check, approved_by: bossId }),
    ev('check.closed', { cancel_reason: 'Guest left' }, { check_id: check, approved_by: bossId }),
  ])
  assert.ok(done.every(r => r.ok), JSON.stringify(done))
  const [row] = await sql`SELECT status, total, state FROM pos_checks WHERE id = ${check}`
  assert.equal(row.status, 'void')
  assert.equal(Number(row.total), 0)
  assert.equal(row.state.cancelled.reason, 'Guest left')
  assert.equal(row.state.cancelled.approved_by, bossId)
  // Worth both dishes: the one voided in the first try and the one deleted now.
  assert.equal(row.state.cancelled.value, 2400)
  const report = await device(till, 'GET', '/pos-api/reports/day')
  assert.equal(report.status, 200, report.body)
  const c = report.json.figures.cancelled
  assert.ok(c.count >= 1)
  assert.ok(c.lines.some(l => l.check_id === check && l.reason === 'Guest left' && l.value === 2400))
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { approvals: { cancel_order: false, delete_unsent: false } }))
})

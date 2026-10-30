// Hub-first locations (migration 218, docs/POS.md section 11): the venue hub
// keeps a copy of the venue (shared/pos/mirror.js), decides the venue
// network's events over it, sends them up and follows the cloud's log. Here
// the real mirror is driven against the API:
//   - devices get the hub's address and their own key in their config (not
//     with hub first off, not before the hub said where it is); the hub gets
//     their keys' sha256, the sequencer's context without PIN hashes, and
//     whether it is the hub devices use
//   - the hub's copy starts from the cloud, its events go up in its order and
//     are decided again (each for its device, at the hub's time), tickets the
//     hub printed are kept printed, and the copy follows the cloud back
//   - a change made straight in the cloud meanwhile: the copy rebases, and a
//     hub change that no longer applies is refused there and in the cloud
//   - the internet down: the hub closes the day and opens the next; the cloud
//     takes it all in order
//   - only a hub uses these routes, only for its own location's devices,
//     with the device rules of POST /events
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { sha256 } from '../src/services/posSvc.js'
import { ulid } from '../../shared/pos/ids.js'
import { createMirror } from '../../shared/pos/mirror.js'
import { checkTotals } from '../../shared/pos/pricing.js'

let ids, owner, V, staffId, dish
let till, till2, kds, kiosk, hub, hub2, otherHub, otherTill
let ctx, mirror

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

const report = (h, addresses, port = 9181) => device(h, 'POST', '/pos-api/hub/status', {
  app_version: 'test', printers: [], info: { hostname: 'hub', addresses, status_port: 9180, lan_port: port },
})

const event = (d, type, payload, checkId, staff = staffId, at = new Date()) => ({
  id: ulid(), venue_id: V, device_id: d.id, staff_id: staff, check_id: checkId, type, payload, client_at: at.toISOString(),
})
const line = (qty = 1, price = 1250) => ({ id: ulid(), item_id: dish.id, section_id: dish.section_id, name: dish.name, qty, unit_price: price, modifiers: [], vat_rate: 20 })

/** The hub follows the cloud until it has nothing new. */
async function follow() {
  let refused = []
  for (let i = 0; i < 5; i++) {
    const r = await device(hub, 'GET', '/pos-api/hub/sync?since=' + mirror.cloudSeq)
    assert.equal(r.status, 200, r.body)
    refused = refused.concat(await mirror.applyCloud(r.json))
    if (!r.json.events?.length && !r.json.reset) break
  }
  return refused
}

/** The hub sends what it has (events, then its refusals). */
async function upload() {
  const events = mirror.toSend()
  const out = mirror.refusalsOut()
  if (!events.length && !out.list.length) return { results: [] }
  const r = await device(hub, 'POST', '/pos-api/hub/events', { events, rejections: out.list })
  assert.equal(r.status, 200, r.body)
  out.drop()
  await mirror.confirm(r.json.results)
  return r.json
}

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  staffId = filled.ids.staff
  const role = await ok(owner.post('/api/pos/roles', { name: 'Hqf Manager', permissions: { close_day: true, void: true, refund: true } }))
  await ok(owner.put(`/api/pos/venues/${V}/staff/${staffId}/pos`, { pos_role_id: role.id, pin: '4826' }))
  ;[dish] = await sql`SELECT id, section_id, name FROM menu_items WHERE tenant_id = ${ids.a} AND kind <> 'combo' ORDER BY name LIMIT 1`
  till = await linkDevice(owner, V, { kind: 'terminal', name: 'Hqf Front till', settings: { mode: 'counter' } })
  till2 = await linkDevice(owner, V, { kind: 'terminal', name: 'Hqf Bar till', settings: { mode: 'counter' } })
  kds = await linkDevice(owner, V, { kind: 'kds', name: 'Hqf Kitchen' })
  kiosk = await linkDevice(owner, V, { kind: 'kiosk', name: 'Hqf Kiosk' })
  hub = await linkDevice(owner, V, { kind: 'hub', name: 'Hqf Hub' })
  // The other group's hub and till.
  const theirs = await fillTenant(B.owner, ids.b, { mark: 'Hqb', slug: 'hqb-site' })
  assert.deepEqual(theirs.failed, [], 'fixtures B')
  const bOwner = as(B.owner, ids.b)
  otherHub = await linkDevice(bOwner, theirs.ids.venue, { kind: 'hub', name: 'Hqb Hub' })
  otherTill = await linkDevice(bOwner, theirs.ids.venue, { kind: 'terminal', name: 'Hqb Till' })
  await report(otherHub, ['10.9.9.9'])
})
after(closeApp)

test('devices get the venue hub\'s address and their own key; the hub gets their keys\' sha256; hub first off: none', async () => {
  assert.equal((await device(till, 'GET', '/pos-api/config')).json.hub, null, 'the hub hasn\'t said where it is yet')
  await report(hub, ['192.168.1.20', 'fe80::1'])
  const cfg = (await device(till, 'GET', '/pos-api/config')).json
  assert.equal(cfg.hub.id, hub.id)
  assert.deepEqual(cfg.hub.urls, ['http://192.168.1.20:9181'], 'IPv4 addresses with the LAN port')
  assert.match(cfg.hub.lan_key, /^[A-Za-z0-9_-]{40,}$/)
  const again = (await device(till, 'GET', '/pos-api/config?version=' + encodeURIComponent(cfg.version))).json
  assert.equal(again.unchanged, true)
  assert.deepEqual(again.hub, cfg.hub, 'an unchanged config carries it too')
  const kc = (await device(kds, 'GET', '/pos-api/config')).json
  assert.equal(kc.hub.id, hub.id)
  assert.notEqual(kc.hub.lan_key, cfg.hub.lan_key, 'each device its own key')
  assert.equal((await device(kiosk, 'GET', '/pos-api/config')).json.hub.id, hub.id)
  assert.equal((await device(hub, 'GET', '/pos-api/config')).json.hub, undefined, 'not for the hub itself')
  assert.equal((await device(otherTill, 'GET', '/pos-api/config')).json.hub.id, otherHub.id, 'the other group\'s till: their hub')

  const res = await device(hub, 'GET', '/pos-api/hub/context')
  assert.equal(res.status, 200, res.body)
  ctx = res.json
  assert.equal(ctx.primary, true)
  assert.equal(ctx.hub_first, true)
  assert.equal(ctx.venue_id, V)
  const mine = ctx.devices.find(x => x.id === till.id)
  assert.equal(mine.key_hash, sha256(cfg.hub.lan_key), 'the hub can check the till\'s key, not make it')
  assert.ok(!JSON.stringify(ctx).includes(cfg.hub.lan_key))
  assert.ok(ctx.devices.some(x => x.id === kiosk.id && x.kind === 'kiosk'))
  assert.ok(!ctx.devices.some(x => x.id === hub.id || x.id === otherTill.id))
  assert.ok(ctx.context.staffById[staffId], 'the staff the sequencer knows')
  assert.ok(Object.values(ctx.context.staffById).every(s => !('pin_hash' in s)), 'without PIN hashes')
  assert.ok(!JSON.stringify(ctx).includes((await sql`SELECT pos_pin_hash FROM cash_staff WHERE id = ${staffId}`)[0].pos_pin_hash))
  assert.equal((await device(hub, 'GET', '/pos-api/hub/context?version=' + ctx.version)).json.unchanged, true)

  // A second hub linked later prints but isn't the one devices use.
  hub2 = await linkDevice(owner, V, { kind: 'hub', name: 'Hqf Spare hub' })
  await report(hub2, ['192.168.1.21'])
  assert.equal((await device(hub2, 'GET', '/pos-api/hub/context')).json.primary, false)
  assert.equal((await device(till, 'GET', '/pos-api/config')).json.hub.id, hub.id)

  // Hub first switched off: devices go straight to the cloud; the hub hears it.
  assert.equal((await as(A.viewer, ids.a).patch(`/api/pos/venues/${V}/settings`, { hub_first: false })).status, 403)
  const off = await ok(owner.patch(`/api/pos/venues/${V}/settings`, { hub_first: false }))
  assert.equal(off.hub_first, false)
  assert.equal((await device(till, 'GET', '/pos-api/config')).json.hub, null)
  const offCtx = (await device(hub, 'GET', '/pos-api/hub/context?version=' + ctx.version)).json
  assert.equal(offCtx.unchanged, undefined, 'a new version')
  assert.equal(offCtx.hub_first, false)
  assert.equal((await ok(owner.patch(`/api/pos/venues/${V}/settings`, { hub_first: true }))).hub_first, true)
  ctx = (await device(hub, 'GET', '/pos-api/hub/context')).json

  // Paired again: a new key (the old one stops opening the hub).
  const moved = await linkDevice(owner, V, { kind: 'terminal', deviceId: till2.id })
  const fresh = (await device(moved, 'GET', '/pos-api/config')).json.hub.lan_key
  const ctx2 = (await device(hub, 'GET', '/pos-api/hub/context')).json
  assert.equal(ctx2.devices.find(x => x.id === till2.id).key_hash, sha256(fresh))
  till2 = moved

  // Only a hub asks for these.
  for (const [m, u] of [['GET', '/pos-api/hub/context'], ['GET', '/pos-api/hub/sync'], ['POST', '/pos-api/hub/events']]) {
    assert.equal((await device(till, m, u, m === 'POST' ? { events: [] } : undefined)).status, 403, u)
    assert.equal((await device(kiosk, m, u, m === 'POST' ? { events: [] } : undefined)).status, 403, u + ' (kiosk)')
  }
})

test('the hub\'s copy starts from the cloud; its events go up, are decided again, and its tickets stay printed', async () => {
  mirror = createMirror({ hubId: hub.id, context: ctx.context })
  await mirror.ready
  await follow()
  assert.equal(mirror.status().pending, 0)
  const before = mirror.cloudSeq

  // Two tills at the venue, through the hub: a counter order sent to the kitchen and paid.
  const c1 = ulid()
  const l1 = line(2)
  const hubEvents = [
    event(till, 'check.opened', { mode: 'counter', number: 1, order_no: till.device.settings.order_numbers.from }, c1),
    event(till, 'line.added', { line: l1 }, c1),
    event(till, 'lines.sent', { send_id: ulid(), line_ids: [l1.id] }, c1),
    event(till, 'payment.added', { payment: { id: ulid(), tender: 'cash', amount: 2500, tendered: 3000 } }, c1),
    event(till, 'check.closed', {}, c1),
  ]
  let jobs = 0
  for (const e of hubEvents) {
    const r = await mirror.submit(e)
    assert.ok(r.ok, e.type + ': ' + r.error)
    jobs += r.jobs?.length || 0
  }
  assert.ok(jobs > 0, 'the kitchen printer box printed at the venue')
  const local = mirror.sync({ source: mirror.source, since: 0 }).checks.find(c => c.id === c1)
  assert.equal(local.status, 'closed')
  assert.equal(local.number_code, till.device.short_code)
  assert.equal(mirror.status().to_send, 5)
  assert.ok(mirror.kitchenOrders().some(o => o.check_id === c1), 'the kitchen screens on the venue network see it')

  const up = await upload()
  assert.ok(up.results.every(r => r.ok), JSON.stringify(up.results))
  assert.equal(up.results.length, 5)
  const rows = await sql`SELECT id, hub_id, device_id FROM pos_events WHERE tenant_id = ${ids.a} AND check_id = ${c1} ORDER BY seq`
  assert.deepEqual(rows.map(r => r.id), hubEvents.map(e => e.id), 'in the hub\'s order')
  assert.ok(rows.every(r => r.hub_id === hub.id && r.device_id === till.id), 'each for its device, decided first by the hub')
  const [check] = await sql`SELECT status, total, number, number_code, order_no FROM pos_checks WHERE id = ${c1}`
  assert.deepEqual({ ...check, total: Number(check.total) }, { status: 'closed', total: 2500, number: 1, number_code: till.device.short_code, order_no: till.device.settings.order_numbers.from })
  const printed = await sql`SELECT status, claimed_by FROM pos_print_jobs WHERE tenant_id = ${ids.a} AND check_id = ${c1}`
  assert.ok(printed.length > 0)
  assert.ok(printed.every(j => j.status === 'printed' && j.claimed_by === hub.id), 'kept printed, never collected again: ' + JSON.stringify(printed))

  // Still pending until the cloud's own log brings them back.
  assert.equal(mirror.status().pending, 5)
  assert.equal(mirror.status().to_send, 0)
  await follow()
  assert.equal(mirror.status().pending, 0)
  assert.ok(mirror.cloudSeq >= before + 5)
  const synced = mirror.sync({ source: mirror.source, since: 0 }).checks.find(c => c.id === c1)
  assert.equal(checkTotals(synced).total, 2500, 'the cloud\'s copy now')
  assert.equal(synced.last_event_id, hubEvents.at(-1).id)

  // Sent again (a device that didn't hear back): the first answer, nothing twice.
  const twice = await device(hub, 'POST', '/pos-api/hub/events', { events: hubEvents.map(e => ({ ...e, hub_printed: true })) })
  assert.ok(twice.json.results.every(r => r.ok && r.duplicate))
  assert.equal((await sql`SELECT count(*)::int AS n FROM pos_events WHERE check_id = ${c1}`)[0].n, 5)

  // A check made straight in the cloud (a till on 4G): its tickets wait for the hub to collect.
  const c2 = ulid()
  const l2 = line(1)
  const direct = await device(till2, 'POST', '/pos-api/events', { events: [
    event(till2, 'check.opened', { mode: 'counter', number: 1, order_no: till2.device.settings.order_numbers.from }, c2),
    event(till2, 'line.added', { line: l2 }, c2),
    event(till2, 'lines.sent', { send_id: ulid(), line_ids: [l2.id] }, c2),
  ] })
  assert.ok(direct.json.results.every(r => r.ok), direct.body)
  const queued = await sql`SELECT status FROM pos_print_jobs WHERE tenant_id = ${ids.a} AND check_id = ${c2}`
  assert.ok(queued.length && queued.every(j => j.status === 'queued'))
  await follow()
  assert.equal(mirror.sync({ source: mirror.source, since: 0 }).checks.find(c => c.id === c2)?.status, 'open', 'the copy has it')
})

test('a change made straight in the cloud meanwhile: the copy rebases, and a hub change that no longer applies is refused by both', async () => {
  const c2 = mirror.sync({ source: mirror.source, since: 0 }).checks.find(c => c.status === 'open' && c.number_code === till2.device.short_code).id
  // At the venue, through the hub: another dish on the open check.
  const extra = event(till, 'line.added', { line: line(1, 400) }, c2)
  assert.ok((await mirror.submit(extra)).ok)
  // Meanwhile the bar till, straight to the cloud, takes payment and closes it.
  const total = Number((await sql`SELECT total FROM pos_checks WHERE id = ${c2}`)[0].total)
  const paid = await device(till2, 'POST', '/pos-api/events', { events: [
    event(till2, 'payment.added', { payment: { id: ulid(), tender: 'card_external', amount: total } }, c2),
    event(till2, 'check.closed', {}, c2),
  ] })
  assert.ok(paid.json.results.every(r => r.ok), paid.body)
  // The hub follows first: its dish no longer goes on a closed check.
  const refused = await follow()
  assert.equal(refused.length, 1)
  assert.equal(refused[0].event.id, extra.id)
  assert.equal(mirror.status().pending, 0)
  assert.equal(mirror.status().conflicts.at(-1).id, extra.id)
  assert.equal(mirror.sync({ source: mirror.source, since: 0 }).checks.find(c => c.id === c2).status, 'closed')
  // Its refusal goes up for the managers' Refused changes list.
  await upload()
  const [rej] = await sql`SELECT hub_id, device_id, code FROM pos_event_rejections WHERE id = ${extra.id}`
  assert.deepEqual(rej && { ...rej }, { hub_id: hub.id, device_id: till.id, code: rej?.code })
  assert.ok(rej.code)

  // The other way round: the hub sends before it follows; the cloud refuses.
  const c3 = ulid()
  const l3 = line(1, 900)
  for (const e of [event(till2, 'check.opened', { mode: 'counter', number: 2, order_no: till2.device.settings.order_numbers.from + 1 }, c3), event(till2, 'line.added', { line: l3 }, c3)]) {
    assert.ok((await device(till2, 'POST', '/pos-api/events', { events: [e] })).json.results[0].ok)
  }
  await follow()
  const late = event(till, 'line.deleted', { line_id: l3.id }, c3)
  assert.ok((await mirror.submit(late)).ok)
  assert.ok((await device(till2, 'POST', '/pos-api/events', { events: [
    event(till2, 'payment.added', { payment: { id: ulid(), tender: 'cash', amount: 900, tendered: 900 } }, c3),
    event(till2, 'check.closed', {}, c3),
  ] })).json.results.every(r => r.ok))
  const up = await upload()
  assert.equal(up.results[0].ok, false, 'the cloud decides it again: the check is closed')
  assert.equal(mirror.status().pending, 0)
  assert.equal(mirror.status().conflicts.at(-1).by, 'cloud')
  await follow()
  assert.equal(mirror.sync({ source: mirror.source, since: 0 }).checks.find(c => c.id === c3).status, 'closed')
})

test('the internet down: the hub closes the day and opens the next; the cloud takes it all in order', async () => {
  await follow()
  const cloudDay = (await sql`SELECT id FROM pos_days WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND closed_at IS NULL`)[0]?.id
  assert.ok(cloudDay)
  // Close any check the fixtures left open, through the hub, offline.
  for (const c of mirror.sync({ source: mirror.source, since: 0 }).checks.filter(x => x.status === 'open')) {
    const owed = checkTotals(c).balance
    if (owed > 0) assert.ok((await mirror.submit(event(till, 'payment.added', { payment: { id: ulid(), tender: 'cash', amount: owed, tendered: owed } }, c.id))).ok)
    const r = await mirror.submit(event(till, 'check.closed', {}, c.id))
    assert.ok(r.ok, r.error)
  }
  const c4 = ulid()
  const l4 = line(1, 1100)
  for (const e of [
    event(till, 'check.opened', { mode: 'counter', number: 3, order_no: till.device.settings.order_numbers.from + 1 }, c4),
    event(till, 'line.added', { line: l4 }, c4),
    event(till, 'payment.added', { payment: { id: ulid(), tender: 'cash', amount: 1100, tendered: 2000 } }, c4),
    event(till, 'check.closed', {}, c4),
  ]) assert.ok((await mirror.submit(e)).ok, e.type)
  const z = await mirror.submit({ ...event(till, 'day.closed', { declared_cash: 5000 }, null), check_id: undefined })
  assert.ok(z.ok, z.error)
  assert.equal(mirror.status().day, null, 'closed at the venue')
  assert.equal(mirror.dayReport().day, null)
  // Next morning, still offline: a new day of the hub's own.
  const c5 = ulid()
  const r5 = await mirror.submit(event(till, 'check.opened', { mode: 'counter', number: 1, order_no: till.device.settings.order_numbers.from + 2 }, c5))
  assert.ok(r5.ok, r5.error)
  assert.match(mirror.status().day.id, /^hub-day-/)

  // The line comes back: everything goes up, the cloud closes its day and opens the next.
  const up = await upload()
  assert.ok(up.results.every(r => r.ok), JSON.stringify(up.results.filter(r => !r.ok)))
  const [closed] = await sql`SELECT closed_at, z_number, declared_cash FROM pos_days WHERE id = ${cloudDay}`
  assert.ok(closed.closed_at, 'the Z closed the cloud\'s day')
  assert.equal(Number(closed.declared_cash), 5000)
  const [open] = await sql`SELECT id FROM pos_days WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND closed_at IS NULL`
  assert.ok(open && open.id !== cloudDay, 'and a new one for the next check')
  assert.equal((await sql`SELECT day_id FROM pos_checks WHERE id = ${c5}`)[0].day_id, open.id)
  await follow()
  assert.equal(mirror.status().pending, 0)
  assert.equal(mirror.status().day.id, open.id, 'the cloud\'s day now')
  const checks = mirror.sync({ source: mirror.source, since: 0 }).checks
  assert.ok(checks.some(c => c.id === c5 && c.day_id === open.id))
  assert.ok(!checks.some(c => c.id === c4), 'yesterday\'s closed checks drop out of the copy')
})

test('hub uploads: only its own location\'s devices, the device rules of POST /events, card payments need the cloud', async () => {
  const c = ulid()
  const res = await device(hub, 'POST', '/pos-api/hub/events', { events: [
    event(otherTill, 'check.opened', { mode: 'counter', number: 9 }, c),
    { ...event(till, 'check.opened', { mode: 'counter', number: 9, order_no: till.device.settings.order_numbers.from + 9 }, ulid()), staff_id: kiosk.id },
    { ...event(till, 'kitchen.order_in', { order: {} }, null), staff_id: null },
    event(kiosk, 'drawer.opened', {}, null, kiosk.id),
  ], rejections: [{ event: event(otherTill, 'line.added', {}, c), error: 'x', code: 'x' }] })
  assert.equal(res.status, 200, res.body)
  assert.deepEqual(res.json.results.map(r => r.code), ['device', 'kiosk', 'invalid', 'kiosk'])
  assert.equal((await sql`SELECT count(*)::int AS n FROM pos_event_rejections WHERE device_id = ${otherTill.id}`)[0].n, 0, 'another group\'s device: nothing stored')
  // The other group's hub can't send for this location's tills.
  const theirs = await device(otherHub, 'POST', '/pos-api/hub/events', { events: [event(till, 'check.opened', { mode: 'counter', number: 9 }, ulid())] })
  assert.equal(theirs.status, 404, 'our venue id: not theirs')
  const { venue_id, ...noVenue } = event(till, 'check.opened', { mode: 'counter', number: 9 }, ulid())
  assert.equal(venue_id, V)
  const theirs2 = await device(otherHub, 'POST', '/pos-api/hub/events', { events: [noVenue] })
  assert.equal(theirs2.status, 200, theirs2.body)
  assert.equal(theirs2.json.results[0].code, 'device', 'our till: not one of their location\'s')
  assert.equal((await sql`SELECT count(*)::int AS n FROM pos_events WHERE id = ${noVenue.id}`)[0].n, 0)
  const bSync = (await device(otherHub, 'GET', '/pos-api/hub/sync?since=0')).json
  assert.ok(!JSON.stringify(bSync).includes(till.id), 'their copy holds nothing of ours')

  // A card machine payment needs the cloud: the hub passes it through.
  const open = mirror.sync({ source: mirror.source, since: 0 }).checks.find(x => x.status === 'open')
  assert.equal(mirror.needsCloud(event(till, 'payment.added', { payment: { id: ulid(), tender: 'card_integrated', amount: 100, card_payment_id: '00000000-0000-4000-8000-000000000001' } }, open.id)), true)
  assert.equal(mirror.needsCloud(event(till, 'payment.added', { payment: { id: ulid(), tender: 'cash', amount: 100 } }, open.id)), false)
  // A hub time in the future counts as now.
  const ahead = event(till, 'line.added', { line: line(1, 100) }, open.id)
  const sent = await device(hub, 'POST', '/pos-api/hub/events', { events: [{ ...ahead, hub_at: new Date(Date.now() + 3600_000).toISOString() }] })
  assert.ok(sent.json.results[0].ok, sent.body)
})

test('devices moving between the hub and the cloud start their cursor again', async () => {
  const at = (await device(till, 'GET', '/pos-api/sync?since=0')).json
  assert.equal(at.source, 'cloud')
  const same = (await device(till, 'GET', '/pos-api/sync?since=' + at.seq + '&source=cloud')).json
  assert.equal(same.reset, undefined)
  const moved = (await device(till, 'GET', '/pos-api/sync?since=' + at.seq + '&source=' + encodeURIComponent(mirror.source))).json
  assert.equal(moved.reset, true, 'a cursor from the hub means nothing here')
  const k = (await device(kds, 'GET', '/pos-api/kitchen/sync?since=5&source=' + encodeURIComponent(mirror.source))).json
  assert.equal(k.reset, true)
  assert.equal(k.source, 'cloud')
  // And the hub's view says where it came from.
  const h = mirror.sync({ since: mirror.rev, source: 'cloud' })
  assert.equal(h.reset, true)
  assert.equal(h.source, 'hub:' + hub.id)
})

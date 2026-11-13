// Two trading days sold on a linked till, through the real device routes
// and the cloud's sequencer, for the report tests:
//
//   Day 1 (closed with a Z report, a pound short)
//     A  table of 2, eat in   1200 + 2 x 500, 10% off, 10% service, card + 2.00 tip   (the server)
//     B  take-out tab         1200 + 800 at no VAT, cash                              (the manager)
//     C  table of 4, eat in   2 x 1200 + 500 voided, service taken off, cash 10.00 + 1.00 tip, card the rest
//     D  counter order        called off: 500 sent (voided), 1200 not sent
//     F  take-out tab         500 comped (nothing to pay)
//   Day 2 (still open; the same date)
//     a 3.00 cash refund on B
//     G  table of 3, eat in   3 x 500, 10% service, cash
//     E  table of 2, eat in   1200, still open                                        (the manager)
//
// sellTwoDays() returns the ids and each day's own figures as the till
// reports them (GET /pos-api/reports/day: dayFigures() in shared/pos/reports.js).
import assert from 'node:assert/strict'
import { getApp, sql, ok } from './app.mjs'
import { linkDevice } from './devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../../src/middleware/auth.js'
import { ulid } from '../../../shared/pos/ids.js'
import { checkTotals } from '../../../shared/pos/pricing.js'
import { chargesWhere } from '../../../shared/pos/charges.js'

/** A call as a linked device. */
export async function device(d, method, url, body) {
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

/**
 * Sells the two days at the fixtures' venue. `owner` is the owner's client
 * (as(A.owner, tenantId)), `filled` what fillTenant() returned.
 */
export async function sellTwoDays({ owner, tenantId, filled, mark = 'Zrp' }) {
  const V = filled.ids.venue
  const leadId = filled.ids.staff
  const bossId = filled.ids.staff2
  let number = 0

  const menu = await ok(owner.get('/api/menus/' + filled.ids.menu))
  const dishes = menu.sections.flatMap(s => s.items.map(i => ({ ...i, section_id: s.id, section_name: s.name })))
  // Three dishes with names of their own (the till's report is by dish, a report's by name).
  const byName = [...new Map(dishes.map(d => [d.name, d])).values()]
  assert.ok(byName.length >= 3, 'the fixtures\' menu has three dishes')
  const [d1, d2, d3] = byName

  // A server whose role gives discounts only, and a manager who approves the rest.
  const server = await ok(owner.post('/api/pos/roles', { name: mark + ' Server', permissions: { discount_max_pct: 100 } }))
  const boss = await ok(owner.post('/api/pos/roles', {
    name: mark + ' Manager',
    permissions: { void: true, refund: true, comp: true, discount_max_pct: 100, reopen: true, close_day: true, manager: true },
  }))
  await ok(owner.put(`/api/pos/venues/${V}/staff/${leadId}/pos`, { pos_role_id: server.id, pin: '2591' }))
  await ok(owner.put(`/api/pos/venues/${V}/staff/${bossId}/pos`, { pos_role_id: boss.id, pin: '1386' }))
  const till = await linkDevice(owner, V, { kind: 'terminal', name: mark + ' Till' })

  const types = await ok(owner.get('/api/order-types'))
  const eatIn = types.find(t => t.name === 'Eat in')
  const takeOut = types.find(t => t.name === 'Take out')
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  const stream = setup.revenue_streams.find(r => r.is_active)

  // A service charge on eat-in checks of the till's stream.
  const serviceName = mark + ' Service'
  const service = await ok(owner.post('/api/pos/charges', { name: serviceName, kind: 'percent', value: 10, optional: true }))
  await ok(owner.put(`/api/pos/venues/${V}/charge-rules`, { rules: [{ charge_id: service.id, revenue_stream_id: stream.id, order_type_id: eatIn.id }] }))
  const cfg = await device(till, 'GET', '/pos-api/config')
  assert.equal(cfg.status, 200, cfg.body)
  const charges = chargesWhere(cfg.json.settings.charges, { streamId: stream.id, typeId: eatIn.id }, V, cfg.json.tax_rates)
  const serviceOn = charges.find(x => x.name === serviceName)
  assert.ok(serviceOn, 'the service charge is on eat-in checks')

  const ev = (type, payload, extra = {}) => ({ id: ulid(), type, payload, client_at: new Date().toISOString(), staff_id: leadId, ...extra })
  async function send(events) {
    const r = await device(till, 'POST', '/pos-api/events', { events })
    assert.equal(r.status, 200, r.body)
    assert.ok(r.json.results.every(x => x.ok), JSON.stringify(r.json.results.filter(x => !x.ok)) + ' ' + events.map(e => e.type).join(','))
    return r.json.results
  }
  const line = (d, qty = 1, price = 1200, vat = 20) => ({ id: ulid(), item_id: d.id, section_id: d.section_id, name: d.name, qty, unit_price: price, modifiers: [], vat_rate: vat })
  const opened = (payload, extra) => ev('check.opened', { number: ++number, revenue_stream_id: stream.id, ...payload }, extra)
  async function totalsOf(checkId) {
    const [row] = await sql`SELECT state FROM pos_checks WHERE id = ${checkId}`
    return checkTotals(row.state)
  }
  // Pay what is left on a check (or `amount` of it).
  async function pay(checkId, tender, { amount, tip = 0, by = leadId } = {}) {
    const t = await totalsOf(checkId)
    const pays = amount ?? t.balance
    assert.ok(pays > 0, 'something to pay')
    await send([ev('payment.added', {
      payment: { id: ulid(), tender, amount: pays, ...(tip ? { tip } : {}), ...(tender === 'cash' ? { tendered: pays + 500 } : {}) },
    }, { check_id: checkId, staff_id: by })])
    return pays
  }
  const close = (checkId, by = leadId) => send([ev('check.closed', {}, { check_id: checkId, staff_id: by })])
  const checks = {}

  // ── Day 1 ──
  const a = checks.a = ulid()
  const a1 = line(d1), a2 = line(d2, 2, 500)
  await send([
    opened({ mode: 'table', covers: 2, order_type_id: eatIn.id, charges }, { check_id: a }),
    ev('line.added', { line: a1 }, { check_id: a }),
    ev('line.added', { line: a2 }, { check_id: a }),
    ev('lines.sent', { send_id: ulid(), line_ids: [a1.id, a2.id] }, { check_id: a }),
    ev('discount.applied', { discount: { id: ulid(), scope: 'check', type: 'percent', value: 10, name: mark + ' Regular' } }, { check_id: a }),
  ])
  await pay(a, 'card_external', { tip: 200 })
  await close(a)

  const b = checks.b = ulid()
  await send([
    opened({ mode: 'tab', tab_name: mark + ' Sam', covers: 1, order_type_id: takeOut.id, charges: [] }, { check_id: b, staff_id: bossId }),
    ev('line.added', { line: line(d1) }, { check_id: b, staff_id: bossId }),
    ev('line.added', { line: line(d3, 1, 800, 0) }, { check_id: b, staff_id: bossId }),
  ])
  await pay(b, 'cash', { by: bossId })
  await close(b, bossId)

  const c = checks.c = ulid()
  const c1 = line(d1, 2), c2 = line(d2, 1, 500)
  await send([
    opened({ mode: 'table', covers: 4, order_type_id: eatIn.id, charges }, { check_id: c }),
    ev('line.added', { line: c1 }, { check_id: c }),
    ev('line.added', { line: c2 }, { check_id: c }),
    ev('lines.sent', { send_id: ulid(), line_ids: [c1.id, c2.id] }, { check_id: c }),
    ev('line.voided', { line_id: c2.id, reason: 'Dropped', waste: true }, { check_id: c, approved_by: bossId }),
    ev('charge.removed', { charge_id: serviceOn.id, reason: 'Guest asked' }, { check_id: c }),
  ])
  await pay(c, 'cash', { amount: 1000, tip: 100 })
  await pay(c, 'card_external')
  await close(c)

  const d = checks.d = ulid()
  const dSent = line(d2, 1, 500), dNew = line(d1)
  await send([
    opened({ mode: 'counter', order_no: 101, order_type_id: takeOut.id, charges: [] }, { check_id: d }),
    ev('line.added', { line: dSent }, { check_id: d }),
    ev('lines.sent', { send_id: ulid(), line_ids: [dSent.id] }, { check_id: d }),
    ev('line.added', { line: dNew }, { check_id: d }),
    ev('line.voided', { line_id: dSent.id, reason: 'Customer left', cancel: true }, { check_id: d, approved_by: bossId }),
    ev('line.deleted', { line_id: dNew.id, cancel: true }, { check_id: d }),
    ev('check.closed', { cancel_reason: 'Customer left' }, { check_id: d }),
  ])

  const f = checks.f = ulid()
  const fLine = line(d2, 1, 500)
  await send([
    opened({ mode: 'tab', tab_name: mark + ' Bday', covers: 1, order_type_id: takeOut.id, charges: [] }, { check_id: f }),
    ev('line.added', { line: fLine }, { check_id: f }),
    ev('discount.applied', { discount: { id: ulid(), scope: 'line', line_ids: [fLine.id], comp: true, reason: 'Birthday', name: 'Comp' } }, { check_id: f, approved_by: bossId }),
  ])
  await close(f)

  // The Z report: a pound short.
  const cashDay1 = (await totalsOf(b)).paid + 1000 + 100
  await send([ev('day.closed', { declared_cash: cashDay1 - 100, notes: mark + ' close' }, { staff_id: bossId })])

  // ── Day 2: a second trading day opens with the next event ──
  await send([ev('refund.added', { refund: { id: ulid(), tender: 'cash', amount: 300, reason: 'Cold' } }, { check_id: b, staff_id: bossId })])
  const g = checks.g = ulid()
  await send([
    opened({ mode: 'table', covers: 3, order_type_id: eatIn.id, charges }, { check_id: g }),
    ev('line.added', { line: line(d2, 3, 500) }, { check_id: g }),
  ])
  await pay(g, 'cash')
  await close(g)
  const e = checks.e = ulid()
  await send([
    opened({ mode: 'table', covers: 2, order_type_id: eatIn.id, charges }, { check_id: e, staff_id: bossId }),
    ev('line.added', { line: line(d1) }, { check_id: e, staff_id: bossId }),
  ])

  const dayRows = await sql`SELECT id FROM pos_days WHERE venue_id = ${V} ORDER BY opened_at`
  assert.equal(dayRows.length, 2, 'two trading days')
  const [day1, day2] = dayRows.map(r => r.id)
  const r1 = await device(till, 'GET', '/pos-api/reports/day?day_id=' + day1)
  const r2 = await device(till, 'GET', '/pos-api/reports/day')
  assert.equal(r1.status, 200, r1.body)
  assert.equal(r2.status, 200, r2.body)
  assert.equal(r2.json.id, day2)

  const names = { types: {}, streams: {}, staff: {} }
  for (const t of await sql`SELECT id, name FROM order_types WHERE tenant_id = ${tenantId}`) names.types[t.id] = t.name
  for (const s of await sql`SELECT id, name FROM pos_revenue_streams WHERE tenant_id = ${tenantId}`) names.streams[s.id] = s.name
  for (const s of await sql`SELECT id, name FROM cash_staff WHERE tenant_id = ${tenantId}`) names.staff[s.id] = s.name

  return {
    V, till, leadId, bossId, d1, d2, d3, stream, eatIn, takeOut, checks, serviceName,
    day1, day2, f1: r1.json.figures, f2: r2.json.figures, date: r1.json.business_date, names,
    lead: names.staff[leadId], boss: names.staff[bossId],
  }
}

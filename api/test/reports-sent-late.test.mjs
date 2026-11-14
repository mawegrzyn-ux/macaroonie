// Orders sent late (migration 247, report builder phase 3b). Checked here:
//   - a supplier order is judged when it first goes to the supplier: marked
//     sent by hand (now, or at an earlier time) or emailed, by the one rule,
//     deadlinePassed() in shared/procurement.js: late from the cutoff minute
//     on the deadline day, or from the day after it when the supplier has no
//     cutoff; deadline_at is that moment;
//   - a failed email judges nothing; a resend (emailed again, or sent again
//     after a split) keeps the first judgement; the part split off is judged
//     at its own first send; a delivery booked in without an order never is;
//   - orders sent before migration 247 are judged by backfillSentLate()
//     (run when the API starts), except ones changed after sending, which
//     don't know when they first went;
//   - the H&S test data's purchase orders go in against their deadline and
//     are judged as real ones are;
//   - the Orders sent late starter's figures are the orders' own, its rows
//     behind Sent late are the late orders, a role with only Purchasing runs
//     it, and another group sees none of it;
//   - every judgement agrees with its own two times.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { as, ok, closeApp, sql } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { runner, rowsOf } from './support/reports.mjs'
import { STARTERS } from '../src/reports/starters/index.js'
import { addDays, nowAt } from '../../shared/procurement.js'
import { zonedToUtc } from '../src/services/orderSvc.js'
import { backfillSentLate } from '../src/services/purchasingSvc.js'

const TZ = 'Europe/London'
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
const CHECK = { packaging_ok: true, damage_ok: true, quality_ok: true, accepted: true }
const realFetch = globalThis.fetch

let ids, owner, V, run, runB
let cutoff, farm, mail, cutoffItem, farmItem, farmQuote, mailItem
let failMail = false, mailsSent = 0
const made = {}

const today = () => nowAt(TZ).date
const day = n => addDays(today(), n)
let ahead = 2
/** A day the suppliers take that no other order in this file is for. */
const nextDay = () => day(++ahead)
/** A wall time at the venue as an instant. */
const at = (d, hhmm, seconds = 0) => new Date(zonedToUtc(d, hhmm, TZ).getTime() + seconds * 1000)
const ms = v => (v == null ? null : new Date(v).getTime())

const newItem = name => ok(owner.post('/api/inventory/items', { name, base_unit: 'g' }), name)
const quotesOf = async (it, body) => (await ok(owner.post(`/api/inventory/items/${it.id}/quotes`, body), it.name + ' price')).quotes
const listOf = (name, items) => ok(owner.post('/api/purchasing/lists', { name, venue_ids: [V], item_ids: items.map(i => i.id) }), name)

/** A purchase order for one item from one supplier, placed for a day. */
async function placed(item, supplierId, date, qty = 1) {
  const list = await listOf('Late list ' + Math.random().toString(36).slice(2, 8), [item])
  const o = await ok(owner.post('/api/purchasing/orders', { venue_id: V, list_id: list.id }), 'draft')
  await ok(owner.put(`/api/purchasing/orders/${o.id}/lines`, { lines: [{ item_id: item.id, qty }] }), 'lines')
  return (await ok(owner.post(`/api/purchasing/orders/${o.id}/submit`, { suppliers: { [supplierId]: { delivery_date: date } } }), 'placed')).purchase_orders[0]
}
/** Moves an order to another day (a past one, say), made long enough ago for an earlier send time. */
const setDay = (po, date) => sql`
  UPDATE purchase_orders SET delivery_date = ${date}::date, created_at = now() - interval '13 days' WHERE id = ${po.id}
`
const markSent = (po, when) => ok(owner.post(`/api/purchasing/pos/${po.id}/mark-sent`, {
  via: 'phone', ...(when ? { sent_at: when.toISOString() } : {}),
}), 'marked sent')
const judged = async id => (await sql`
  SELECT status, sent_at, first_sent_at, deadline_at, sent_late, amended_at, no_order, created_at, delivery_date::text AS day
    FROM purchase_orders WHERE id = ${id}
`)[0]
const byKey = res => res.rows.map(r => Object.fromEntries(res.columns.map((c, i) => [c.key, r.cells[i]])))
const starterSpec = key => STARTERS.find(s => s.key === key).spec

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  V = filled.ids.venue
  owner = as(A.owner, ids.a)
  run = runner(ids.a)
  runB = runner(ids.b)

  // A cutoff at 14:00 the day before; a farm with no cutoff (the whole day
  // before); a supplier that takes orders by email. Every day a delivery day.
  cutoff = await ok(owner.post('/api/suppliers', { name: 'Late Test Cutoff Foods', send_method: 'print', lead_days: 1, cutoff_time: '14:00', delivery_days: ALL_DAYS }), 'cutoff')
  farm = await ok(owner.post('/api/suppliers', { name: 'Late Test Farm', send_method: 'print', lead_days: 1, delivery_days: ALL_DAYS }), 'farm')
  mail = await ok(owner.post('/api/suppliers', { name: 'Late Test Mail Supplies', send_method: 'email', email: 'orders@late-mail.example', lead_days: 1, delivery_days: ALL_DAYS }), 'mail')
  cutoffItem = await newItem('Late test oil')
  await quotesOf(cutoffItem, { supplier_id: cutoff.id, pack_name: 'Case', pack_qty: 1, pack_unit: 'kg', price: 20 })
  farmItem = await newItem('Late test eggs')
  ;[farmQuote] = await quotesOf(farmItem, { supplier_id: farm.id, pack_name: 'Tray', pack_qty: 1, pack_unit: 'kg', price: 6 })
  mailItem = await newItem('Late test flour')
  await quotesOf(mailItem, { supplier_id: mail.id, pack_name: 'Sack', pack_qty: 16, pack_unit: 'kg', price: 14 })

  // The venue emails through SendGrid (a stand-in: nothing leaves this process).
  await ok(owner.post(`/api/email-templates/settings/${V}`, { email_provider: 'sendgrid', provider_api_key: 'SG.late-test', from_name: 'Ware', from_email: 'orders@ware.example' }))
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.sendgrid.com/')) {
      if (failMail) return new Response('{"errors":[{"message":"Mail is down"}]}', { status: 400 })
      mailsSent++
      return new Response('', { status: 202, headers: { 'x-message-id': 'sg' + mailsSent } })
    }
    return realFetch(url, opts)
  }
})
after(async () => { globalThis.fetch = realFetch; await closeApp() })

test('marked sent: on time before the cutoff, late from the cutoff minute (or from the day after without one), judged at the time it went', async () => {
  // Due five days ago: the deadline was 14:00 the day before.
  const due = day(-5), deadlineDay = day(-6), deadline = at(deadlineDay, '14:00')
  made.early = await placed(cutoffItem, cutoff.id, nextDay())
  made.atCutoff = await placed(cutoffItem, cutoff.id, nextDay())
  made.hourLate = await placed(cutoffItem, cutoff.id, nextDay())
  for (const po of [made.early, made.atCutoff, made.hourLate]) await setDay(po, due)
  // Before anything goes, nothing is judged.
  assert.deepEqual(Object.values(await judged(made.early.id)).slice(2, 5), [null, null, null])
  const sends = [[made.early, at(deadlineDay, '13:59', 30), false], [made.atCutoff, deadline, true], [made.hourLate, at(deadlineDay, '15:00'), true]]
  for (const [po, when] of sends) await markSent(po, when)
  for (const [po, when, late] of sends) {
    const r = await judged(po.id)
    assert.equal(r.sent_late, late, `${when.toISOString()}: late ${late}`)
    assert.equal(ms(r.deadline_at), ms(deadline), 'the cutoff on the deadline day')
    assert.equal(ms(r.first_sent_at), ms(when), 'when it went, not when it was marked')
    assert.equal(ms(r.sent_at), ms(when))
  }

  // Sent now for a day ahead: on time, its deadline the cutoff the day before.
  made.ahead = await placed(cutoffItem, cutoff.id, nextDay())
  await markSent(made.ahead)
  const a = await judged(made.ahead.id)
  assert.equal(a.sent_late, false)
  assert.equal(ms(a.deadline_at), ms(at(addDays(a.day, -1), '14:00')))

  // No cutoff: the whole day before counts; late from midnight.
  const farmDue = day(-4)
  made.farmOk = await placed(farmItem, farm.id, nextDay())
  made.farmLate = await placed(farmItem, farm.id, nextDay())
  for (const po of [made.farmOk, made.farmLate]) await setDay(po, farmDue)
  await markSent(made.farmOk, at(day(-5), '23:30'))
  await markSent(made.farmLate, at(farmDue, '00:10'))
  const ok1 = await judged(made.farmOk.id), late1 = await judged(made.farmLate.id)
  assert.equal(ok1.sent_late, false, 'the evening before is on time')
  assert.equal(late1.sent_late, true, 'ten past midnight on the day is late')
  for (const r of [ok1, late1]) assert.equal(ms(r.deadline_at), ms(at(farmDue, '00:00')), 'the start of the day after the deadline day')
  assert.equal((ms(late1.first_sent_at) - ms(late1.deadline_at)) / 1000, 600)
})

test('emailed: judged when it goes, not when the email fails; emailing it again keeps the first judgement', async () => {
  // Placing emails it: with the mail down it waits to be sent, unjudged.
  failMail = true
  const po = await placed(mailItem, mail.id, nextDay())
  let r = await judged(po.id)
  assert.equal(r.status, 'to_send')
  assert.deepEqual([r.first_sent_at, r.deadline_at, r.sent_late], [null, null, null])
  assert.equal((await owner.post(`/api/purchasing/pos/${po.id}/send`)).status, 422, 'Email again: still down')
  assert.equal((await judged(po.id)).sent_late, null, 'a failed email judges nothing')

  failMail = false
  await ok(owner.post(`/api/purchasing/pos/${po.id}/send`), 'emailed')
  r = await judged(po.id)
  assert.equal(r.status, 'sent')
  assert.equal(r.sent_late, false)
  assert.equal(ms(r.first_sent_at), ms(r.sent_at))
  assert.equal(ms(r.deadline_at), ms(at(r.day, '00:00')), 'no cutoff, a day\'s notice: late from the start of its day')

  // Its day put back in the past, then emailed again: the first send stands.
  await sql`UPDATE purchase_orders SET delivery_date = ${day(-3)}::date WHERE id = ${po.id}`
  await ok(owner.post(`/api/purchasing/pos/${po.id}/send`), 'emailed again')
  const again = await judged(po.id)
  assert.equal(again.sent_late, false)
  assert.equal(ms(again.first_sent_at), ms(r.first_sent_at))
  assert.equal(ms(again.deadline_at), ms(r.deadline_at))
  assert.ok(ms(again.sent_at) >= ms(r.sent_at), 'the last send moves on')

  // First emailed after its deadline: late.
  failMail = true
  const lateOne = await placed(mailItem, mail.id, nextDay())
  failMail = false
  await sql`UPDATE purchase_orders SET delivery_date = ${day(-1)}::date WHERE id = ${lateOne.id}`
  await ok(owner.post(`/api/purchasing/pos/${lateOne.id}/send`), 'emailed late')
  const l = await judged(lateOne.id)
  assert.equal(l.sent_late, true)
  assert.equal(ms(l.deadline_at), ms(at(day(-1), '00:00')))

  // Placed with the mail working: emailed and judged as it is placed.
  const before = mailsSent
  const straight = await placed(mailItem, mail.id, nextDay())
  const s = await judged(straight.id)
  assert.equal(mailsSent, before + 1)
  assert.equal(s.status, 'sent')
  assert.equal(s.sent_late, false)
  assert.ok(s.first_sent_at)
})

test('a split: the order the supplier had keeps its judgement when it goes again; the part split off is judged at its own first send', async () => {
  const po = await placed(cutoffItem, cutoff.id, nextDay(), 2)
  await markSent(po)
  const first = await judged(po.id)
  assert.equal(first.sent_late, false)
  const d = await ok(owner.get(`/api/purchasing/pos/${po.id}`))
  const split = await ok(owner.post(`/api/purchasing/pos/${po.id}/split`, { lines: [{ id: d.lines[0].id, qty: 1 }], delivery_date: nextDay() }), 'split')
  const amended = await judged(po.id)
  assert.equal(amended.status, 'to_send', 'back to To send, amended')
  assert.ok(amended.amended_at)
  assert.deepEqual([amended.sent_late, ms(amended.first_sent_at), ms(amended.deadline_at)], [false, ms(first.first_sent_at), ms(first.deadline_at)])
  const part = split.new_po
  assert.deepEqual(Object.values(await judged(part.id)).slice(2, 5), [null, null, null], 'the part split off hasn\'t gone yet')

  // Both now for a day whose deadline has passed.
  await sql`UPDATE purchase_orders SET delivery_date = ${day(-2)}::date WHERE id = ANY(${[po.id, part.id]}::uuid[])`
  await markSent(po)
  const resent = await judged(po.id)
  assert.equal(resent.sent_late, false, 'the first judgement stays')
  assert.equal(ms(resent.first_sent_at), ms(first.first_sent_at))
  assert.equal(ms(resent.deadline_at), ms(first.deadline_at))
  assert.ok(ms(resent.sent_at) > ms(first.first_sent_at))
  await markSent(part)
  const p = await judged(part.id)
  assert.equal(p.sent_late, true, 'judged at its own first send')
  assert.equal(ms(p.deadline_at), ms(at(day(-3), '14:00')))
  made.split = po
  made.splitPart = part
})

test('a delivery booked in without an order is never sent, so never judged', async () => {
  await ok(owner.put('/api/purchasing/settings', { receive_without_order: 'anyone' }), 'setting')
  const po = await ok(owner.post(`/api/purchasing/venues/${V}/deliveries`, {
    supplier_id: farm.id, lines: [{ item_id: farmItem.id, quote_id: farmQuote.id, received_qty: 1 }], check: CHECK,
  }), 'booked in')
  const r = await judged(po.id)
  assert.equal(r.no_order, true)
  assert.deepEqual([r.first_sent_at, r.deadline_at, r.sent_late], [null, null, null])
  // Even with a send time from somewhere, the backfill leaves it alone.
  await sql`UPDATE purchase_orders SET first_sent_at = now() WHERE id = ${po.id}`
  await backfillSentLate(null)
  assert.equal((await judged(po.id)).sent_late, null)
  await sql`UPDATE purchase_orders SET first_sent_at = NULL WHERE id = ${po.id}`
  made.noOrder = po
})

test('orders sent before migration 247: judged by the backfill, except ones changed after sending', async () => {
  // Orders judged above put back as the migration left them: the first send known, not judged.
  const back = [made.early, made.hourLate, made.farmOk, made.farmLate]
  const was = new Map((await sql`
    SELECT id, deadline_at, sent_late FROM purchase_orders WHERE id = ANY(${back.map(p => p.id)}::uuid[])
  `).map(r => [r.id, r]))
  await sql`UPDATE purchase_orders SET deadline_at = NULL, sent_late = NULL WHERE id = ANY(${back.map(p => p.id)}::uuid[])`

  // One sent once before the migration (late by two and a half hours), one changed after it went.
  const once = await placed(cutoffItem, cutoff.id, nextDay())
  await setDay(once, day(-5))
  await markSent(once, at(day(-6), '16:30'))
  const changed = await placed(cutoffItem, cutoff.id, nextDay())
  await markSent(changed)
  await sql`UPDATE purchase_orders SET first_sent_at = NULL, deadline_at = NULL, sent_late = NULL WHERE id = ${once.id}`
  await sql`
    UPDATE purchase_orders SET first_sent_at = NULL, deadline_at = NULL, sent_late = NULL, amended_at = now(), status = 'to_send'
     WHERE id = ${changed.id}`

  // The migration again (it only adds what is missing): the last send is the first, unless changed since.
  await sql.unsafe(readFileSync(new URL('../../migrations/247_po_sent_late.sql', import.meta.url), 'utf8'))
  const o = await judged(once.id)
  assert.equal(ms(o.first_sent_at), ms(o.sent_at))
  assert.equal((await judged(changed.id)).first_sent_at, null, 'its first send isn\'t known')

  const n = await backfillSentLate(null)
  assert.ok(n >= back.length + 1, `judged ${n}`)
  for (const po of back) {
    const r = await judged(po.id)
    assert.equal(r.sent_late, was.get(po.id).sent_late)
    assert.equal(ms(r.deadline_at), ms(was.get(po.id).deadline_at))
  }
  const j = await judged(once.id)
  assert.equal(j.sent_late, true)
  assert.equal(ms(j.deadline_at), ms(at(day(-6), '14:00')))
  assert.equal((ms(j.first_sent_at) - ms(j.deadline_at)) / 1000, 9000)
  assert.equal((await judged(changed.id)).sent_late, null)
  // Sent again: still not judged, since when it first went isn't known.
  await markSent(changed)
  const c = await judged(changed.id)
  assert.deepEqual([c.first_sent_at, c.deadline_at, c.sent_late], [null, null, null])
  assert.equal(await backfillSentLate(null), 0, 'nothing left to judge')
  made.once = once
})

test('the H&S test data\'s orders go in against their deadline and are judged as real ones are', async () => {
  const gen = await ok(owner.post('/api/suppliers', { name: 'Late Test Generated', send_method: 'print', lead_days: 2, cutoff_time: '11:00', delivery_days: ALL_DAYS }), 'supplier')
  const item = await newItem('Late test generated rice')
  await quotesOf(item, { supplier_id: gen.id, pack_name: 'Bag', pack_qty: 5, pack_unit: 'kg', price: 9 })
  await listOf('Late test generated list', [item])
  const from = day(-28), to = day(-22)
  const res = await ok(owner.post(`/api/venues/${V}/test-data/hs/generate`, { date_from: from, date_to: to, kinds: ['orders'], skip_closed: false }), 'generated')
  assert.ok(res.orders >= 7, JSON.stringify(res))
  const rows = await sql`
    SELECT delivery_date::text AS day, sent_at, first_sent_at, deadline_at, sent_late, created_at
      FROM purchase_orders
     WHERE tenant_id = ${ids.a} AND supplier_id = ${gen.id} AND is_generated
     ORDER BY delivery_date`
  assert.deepEqual(rows.map(r => r.day), Array.from({ length: 7 }, (_, i) => addDays(from, i)), 'one a day')
  for (const r of rows) {
    const deadline = at(addDays(r.day, -2), '11:00')
    assert.equal(ms(r.deadline_at), ms(deadline), r.day + ': two days\' notice by 11:00')
    assert.equal(ms(r.first_sent_at), ms(r.sent_at))
    assert.equal(r.sent_late, ms(r.first_sent_at) >= ms(deadline), r.day)
    const off = (ms(r.sent_at) - ms(deadline)) / 60_000
    assert.ok(off >= -360 && off <= 120, `${r.day}: ${off} minutes from the deadline`)
    assert.ok(ms(r.created_at) < ms(r.sent_at), 'made before it went')
  }
})

test('the Orders sent late starter: the orders\' own figures, the late ones behind Sent late, Purchasing alone, nobody else\'s', async () => {
  const period = { from: day(-15), to: day(40) }
  const spec = starterSpec('purchasing_orders_sent_late')
  const res = await run(spec, { period, venues: [V] })
  const rows = rowsOf(res)
  const truth = await sql`
    SELECT s.name, count(*) FILTER (WHERE po.sent_late IS NOT NULL)::int AS sent,
           count(*) FILTER (WHERE po.sent_late)::int AS late,
           (avg(EXTRACT(EPOCH FROM po.first_sent_at - po.deadline_at)) FILTER (WHERE po.sent_late))::float8 AS late_by
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id AND s.tenant_id = po.tenant_id
     WHERE po.tenant_id = ${ids.a} AND po.venue_id = ${V} AND po.status <> 'cancelled'
       AND po.delivery_date BETWEEN ${period.from}::date AND ${period.to}::date
     GROUP BY s.name`
  assert.deepEqual(rows.map(r => r['supplier.name']).sort(), truth.map(t => t.name).sort())
  for (const t of truth) {
    const r = rows.find(x => x['supplier.name'] === t.name)
    assert.equal(r.sent_orders, t.sent, t.name + ' sent')
    assert.equal(r.sent_late_count, t.late, t.name + ' late')
    if (t.sent) assert.ok(Math.abs(r.late_rate - t.late / t.sent) < 1e-6, t.name + ' rate')
    else assert.equal(r.late_rate, null, t.name + ' rate')
    if (t.late) assert.ok(Math.abs(r.average_late_by - t.late_by) < 1e-3, t.name + ' lateness')
    else assert.equal(r.average_late_by, null, t.name + ' lateness')
  }
  // Late first: the sort is the most orders sent late.
  const late = rows.map(r => r.sent_late_count)
  assert.deepEqual(late, [...late].sort((a, b) => b - a))
  // The farm, by hand: two sent, one ten minutes late.
  const f = rows.find(r => r['supplier.name'] === farm.name)
  assert.deepEqual([f.sent_orders, f.sent_late_count, f.late_rate, f.average_late_by], [2, 1, 0.5, 600])
  const c = rows.find(r => r['supplier.name'] === cutoff.name)
  assert.ok(c.sent_late_count >= 4, 'at the cutoff, an hour after, the split part, sent before 247')

  // Behind the farm's Sent late: its one late order, with both times and how late.
  const params = { period, venues: [V] }
  const at0 = [{ field: 'supplier.name', value: farm.name }]
  const behind = await ok(owner.post('/api/reports/starter:purchasing_orders_sent_late/run', { params, drill: [{ at: at0, to: 'rows', value: 'sent_late_count' }] }))
  assert.equal(behind.kind, 'list')
  const list = byKey(behind)
  assert.equal(list.length, 1)
  const lateFarm = await judged(made.farmLate.id)
  assert.equal(list[0].late_by, 600)
  assert.equal(list[0].deadline_at, `${lateFarm.day}T00:00:00`)
  assert.equal(list[0].first_sent_at, `${lateFarm.day}T00:10:00`)
  assert.equal(list[0].sent_via, 'phone')
  assert.ok(behind.meta.notes.some(n => /count towards Sent late/.test(n)), JSON.stringify(behind.meta.notes))
  // Behind Orders sent: both. The row itself lists what its figures count, and every
  // one of them counts orders that went, so the delivery booked in without an order isn't there.
  const sent = byKey(await ok(owner.post('/api/reports/starter:purchasing_orders_sent_late/run', { params, drill: [{ at: at0, to: 'rows', value: 'sent_orders' }] })))
  assert.equal(sent.length, 2)
  assert.deepEqual(sent.map(r => r.late_by).sort(), [600, null].sort())
  const all = await ok(owner.post('/api/reports/starter:purchasing_orders_sent_late/run', { params, drill: [{ at: at0, to: 'rows' }] }))
  assert.deepEqual(byKey(all).map(r => r.number).sort(), sent.map(r => r.number).sort())
  const noOrderNumber = 'PO-' + String((await sql`SELECT number FROM purchase_orders WHERE id = ${made.noOrder.id}`)[0].number).padStart(5, '0')
  assert.ok(!byKey(all).some(r => r.number === noOrderNumber), 'not the delivery booked in without an order')

  // A role with only Purchasing: every figure, nothing left out.
  const theirs = await run(spec, { period, venues: [V] }, { levels: { purchasing: 'view' } })
  assert.deepEqual(rowsOf(theirs), rows)
  assert.deepEqual(theirs.meta.notes, res.meta.notes)
  // Another group: none of A's orders, even when it names A's venue.
  assert.equal(rowsOf(await runB(spec, { period })).length, 0)
  assert.equal(rowsOf(await runB(spec, { period, venues: [V] })).length, 0)
})

test('every judgement agrees with its own two times, and only orders that went are judged', async () => {
  const [bad] = await sql`
    SELECT count(*) FILTER (WHERE sent_late IS NOT NULL AND (first_sent_at IS NULL OR deadline_at IS NULL OR sent_late <> (first_sent_at >= deadline_at)))::int AS wrong,
           count(*) FILTER (WHERE no_order AND (sent_late IS NOT NULL OR first_sent_at IS NOT NULL))::int AS no_order,
           count(*) FILTER (WHERE sent_late IS NOT NULL)::int AS judged
      FROM purchase_orders`
  assert.equal(bad.wrong, 0)
  assert.equal(bad.no_order, 0)
  assert.ok(bad.judged >= 15, `judged ${bad.judged}`)
})

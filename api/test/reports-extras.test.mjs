// The report builder's subjects phase 3d added for the till, online ordering
// and bookings (docs/REPORTS.md 20) against the app's own pages for the same
// rows:
//
//   till activity        a check's history in Till reports (GET /api/pos/checks/:id)
//   changes refused      Till reports' Conflicts list (GET .../conflicts)
//   card payments        Store tech → Card machines, Payments (GET .../card-payments)
//   print jobs           Store tech → Printers, Tickets (GET .../print-jobs)
//   online order history the order's window on Online orders (GET /api/orders/:id)
//   sold out now         what the tills read (GET /pos-api/live)
//   promotions           the Promotions page (GET /api/promotions)
//   emails sent          Emails → Sent emails (GET /api/email-templates/log)
//   Store tech lists     table combinations, devices, card machines, printers
//
// The till's own changes come from sellTwoDays() (the real device routes);
// refused changes, card machine payments, print jobs, promotions used and
// emails are written here by SQL, as nothing in the API makes them at a
// chosen status. Tenant B's rows sit beside them and must never show.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { sellTwoDays, device } from './support/tillDays.mjs'
import { runner, rowsOf, totalsRow, p, measures, refused, LEVELS } from './support/reports.mjs'
import { ulid } from '../../shared/pos/ids.js'
import { todayIn } from '../../shared/reports/period.js'

const ALL = LEVELS

let ids, owner, V, VB, run, sold, today, yesterday, filled

const period = (from, to = from) => ({ field: 'date', op: 'in_period', value: { from, to } })
const here = () => ({ field: 'venue', op: 'in', value: [V] })
const go = (spec, levels = ALL) => run(spec, undefined, { levels })
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400_000).toISOString().slice(0, 10)
const sorted = list => [...list].sort()
const count = (list, f) => list.filter(f).length
/** A list result's rows as objects by column key, with the row's id and what it opens. */
const listRows = res => res.rows.filter(r => r.kind === 'row').map(r => ({
  ...Object.fromEntries(res.columns.map((c, i) => [c.key, r.cells[i]])),
  _id: r.id, _open: r.open || null,
}))
const seconds = (from, to) => (Date.parse(to) - Date.parse(from)) / 1000

before(async () => {
  ids = await resetAndSeed()
  filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  const other = await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc' })
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  VB = other.ids.venue
  run = runner(ids.a)
  sold = await sellTwoDays({ owner, tenantId: ids.a, filled })
  const [{ timezone }] = await sql`SELECT timezone FROM venues WHERE id = ${V}`
  today = todayIn(timezone || 'Europe/London')
  yesterday = addDays(today, -1)
})
after(closeApp)

// ── Till activity ──────────────────────────────────────────────────────

test('till activity is each check\'s own history, change by change, by whom and on which till', async () => {
  const [tillRow] = await sql`SELECT name FROM pos_devices WHERE id = ${sold.till.device_id}`
  const res = await go({
    subject: 'till.activity', kind: 'list',
    rows: ['type', 'staff.name', 'approved_by.name', 'device.name'],
    filters: [period(sold.date), here()],
  })
  const rows = listRows(res)
  let onChecks = 0
  for (const [name, checkId] of Object.entries(sold.checks)) {
    const page = await ok(owner.get('/api/pos/checks/' + checkId))
    // The page also lists lines moved or merged in from other checks; the
    // test days have none, so its history is the check's own changes.
    const events = page.events.filter(e => !e.type.startsWith('kitchen.'))
    assert.ok(events.length > 0, 'check ' + name + ' has a history')
    const mine = rows.filter(r => r._open?.id === checkId)
    assert.deepEqual(
      sorted(mine.map(r => [r.type, r['staff.name'], r['approved_by.name']].join('|'))),
      sorted(events.map(e => [e.type, e.staff_name ?? null, e.approver_name ?? null].join('|'))),
      'check ' + name)
    // Every change came from the till, named as Store tech names it.
    assert.ok(events.every(e => e.device_id === sold.till.device_id), 'the page: the till')
    assert.ok(mine.every(r => r['device.name'] === tillRow.name), 'the report: the till by name')
    assert.ok(mine.every(r => r._open.venue === V), 'a change opens its check at its venue')
    onChecks += events.length
  }
  // The rest belong to no check: the day closed with its Z report.
  const loose = rows.filter(r => !r._open)
  assert.deepEqual(loose.map(r => r.type), ['day.closed'])
  assert.equal(rows.length, onChecks + loose.length)

  const sum = await go({ subject: 'till.activity', values: measures(['changes', 'checks', 'approvals', 'sent_late']), filters: [period(sold.date), here()] })
  const t = rowsOf(sum)[0]
  assert.equal(t.changes, rows.length)
  assert.equal(t.checks, Object.keys(sold.checks).length)
  // A void on C and on D, and the comp on F: each with the manager's PIN.
  assert.equal(t.approvals, 3)
  assert.equal(t.sent_late, 0)
  // By change: the words come from the catalogue, every type the till sends has them.
  const byType = await go({ subject: 'till.activity', rows: ['type'], values: measures(['changes']), filters: [period(sold.date), here()] })
  const opened = rowsOf(byType).find(r => r.type === 'check.opened')
  assert.equal(opened.changes, Object.keys(sold.checks).length)
  assert.equal(byType.columns[0].labels['check.opened'], 'Order opened')

  // Kitchen taps are the kitchen's subjects, never the till's.
  await sql`INSERT INTO pos_events (id, tenant_id, venue_id, seq, check_id, device_id, type, payload, client_at, day_id)
            SELECT ${ulid()}, tenant_id, venue_id, seq + 1000, NULL, device_id, 'kitchen.bumped', '{}'::jsonb, now(), day_id
              FROM pos_events WHERE tenant_id = ${ids.a} AND venue_id = ${V} ORDER BY seq DESC LIMIT 1`
  const again = await go({ subject: 'till.activity', values: measures(['changes']), filters: [period(sold.date), here()] })
  assert.equal(rowsOf(again)[0].changes, rows.length)
})

// ── Changes refused ────────────────────────────────────────────────────

test('changes refused are Till reports\' Conflicts list, sorted out or not, kitchen taps left out', async () => {
  const refuse = (type, o = {}) => sql`
    INSERT INTO pos_event_rejections (id, tenant_id, venue_id, check_id, device_id, staff_id, type, payload, client_at,
                                      error, code, created_at, resolved_at, resolved_by, resolution)
    VALUES (${ulid()}, ${o.tenant ?? ids.a}, ${o.venue ?? V}, ${o.check ?? null}, ${o.device ?? null}, ${o.staff ?? null},
            ${type}, ${sql.json({})}, now(), ${o.error ?? 'That check was closed on another till'}, ${o.code ?? 'closed'}, now(),
            ${o.sorted ? new Date() : null}, ${o.sorted ? 'owner' : null}, ${o.sorted ? 'Taken again' : null})`
  await refuse('line.added', { check: sold.checks.a, device: sold.till.device_id, staff: sold.leadId })
  await refuse('payment.added', { check: sold.checks.b, device: sold.till.device_id, staff: sold.bossId, sorted: true })
  await refuse('discount.applied', { code: 'manager', error: 'A manager has to approve this' })
  // The kitchen's and another group's.
  await refuse('kitchen.bumped', { check: sold.checks.c })
  await refuse('line.added', { tenant: ids.b, venue: VB })

  const all = await ok(owner.get(`/api/pos/venues/${V}/conflicts?all=1`))
  const open = await ok(owner.get(`/api/pos/venues/${V}/conflicts`))
  assert.equal(all.length, 3)
  assert.equal(open.length, 2)

  const sum = await go({ subject: 'till.refusals', values: measures(['refusals', 'not_sorted', 'checks']), filters: [here()] })
  const t = rowsOf(sum)[0]
  assert.equal(t.refusals, all.length)
  assert.equal(t.not_sorted, open.length)
  assert.equal(t.checks, new Set(all.map(r => r.check_id).filter(Boolean)).size)

  const list = listRows(await go({ subject: 'till.refusals', kind: 'list', rows: ['type', 'reason', 'code', 'sorted', 'staff.name', 'check.number'], filters: [here()] }))
  assert.deepEqual(sorted(list.map(r => r.type + '|' + r.reason + '|' + r.sorted)),
    sorted(all.map(r => r.type + '|' + r.error + '|' + (r.resolved_at != null))))
  // A refused change opens its check, as the Conflicts list links it.
  const onA = list.find(r => r.type === 'line.added')
  assert.equal(onA['staff.name'], sold.lead)
  assert.equal(onA._open.id, sold.checks.a)
  assert.equal(list.find(r => r.type === 'discount.applied')._open, null)
})

// ── Card machine payments ──────────────────────────────────────────────

test('card machine payments are Store tech\'s payments list: approved, declined, not on a bill, refunds', async () => {
  const [reader] = await sql`SELECT id, name, provider FROM pos_card_readers WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND removed_at IS NULL ORDER BY created_at LIMIT 1`
  const [theirReader] = await sql`SELECT id FROM pos_card_readers WHERE tenant_id = ${ids.b} AND venue_id = ${VB} AND removed_at IS NULL LIMIT 1`
  assert.ok(reader && theirReader, 'the fixtures\' card machines')
  const at = new Date(Date.now() - 5 * 60_000)
  const pay = async o => {
    const [row] = await sql`
      INSERT INTO pos_card_payments (tenant_id, venue_id, reader_id, provider, kind, sale_id, amount, tip, status,
                                     used_event_id, device_id, created_at, finished_at)
      VALUES (${o.tenant ?? ids.a}, ${o.venue ?? V}, ${o.reader ?? reader.id}, ${reader.provider}, ${o.kind ?? 'sale'}, ${o.sale ?? null},
              ${o.amount}, ${o.tip ?? 0}, ${o.status}, ${o.used ?? null}, ${o.device ?? sold.till.device_id}, ${at},
              ${o.took == null ? null : new Date(at.getTime() + o.took * 1000)})
      RETURNING id`
    return row.id
  }
  const first = await pay({ amount: 1200, tip: 200, status: 'approved', used: 'E-' + ulid(), took: 20 })
  await pay({ amount: 800, status: 'approved', took: 30 })
  await pay({ amount: 500, status: 'declined', took: 10 })
  await pay({ amount: 700, status: 'cancelled', took: 5 })
  await pay({ amount: 300, status: 'pending' })
  await pay({ kind: 'refund', sale: first, amount: 400, status: 'approved', took: 15 })
  await pay({ amount: 900, status: 'failed', took: 8 })
  await pay({ tenant: ids.b, venue: VB, reader: theirReader.id, amount: 5000, status: 'approved', device: null, took: 3 })

  const page = await ok(owner.get(`/api/pos/venues/${V}/card-payments?days=7`))
  assert.equal(page.length, 7)
  const approved = page.filter(r => r.status === 'approved')
  const sum = await go({
    subject: 'till.card_payments',
    values: measures(['attempts', 'approved', 'declined', 'not_finished', 'approval_rate', 'taken', 'tips', 'refunds', 'not_on_bill', 'average_time']),
    filters: [period(yesterday, today), here()],
  })
  const t = rowsOf(sum)[0]
  assert.equal(t.attempts, page.length)
  assert.equal(t.approved, approved.length)
  assert.equal(t.declined, count(page, r => r.status === 'declined'))
  assert.equal(t.not_finished, count(page, r => r.status === 'cancelled' || r.status === 'failed'))
  assert.ok(Math.abs(t.approval_rate - approved.length / page.length) < 1e-6)
  assert.equal(p(t.taken), approved.filter(r => r.kind === 'sale').reduce((s, r) => s + r.amount, 0))
  assert.equal(p(t.tips), approved.filter(r => r.kind === 'sale').reduce((s, r) => s + r.tip, 0))
  assert.equal(p(t.refunds), approved.filter(r => r.kind === 'refund').reduce((s, r) => s + r.amount, 0))
  // The page's own flag for money taken that no check shows.
  assert.equal(t.not_on_bill, count(page, r => r.not_on_check))
  assert.equal(t.not_on_bill, 1)
  const done = page.filter(r => r.finished_at)
  const avg = done.reduce((s, r) => s + seconds(r.created_at, r.finished_at), 0) / done.length
  assert.ok(Math.abs(t.average_time - avg) < 0.01, t.average_time + ' against ' + avg)

  // By status, row for row, and on a bill or not.
  const byStatus = rowsOf(await go({ subject: 'till.card_payments', rows: ['status'], values: measures(['attempts']), filters: [here()] }))
  for (const s of ['approved', 'declined', 'cancelled', 'pending', 'failed']) {
    assert.equal(byStatus.find(r => r.status === s)?.attempts ?? 0, count(page, r => r.status === s), s)
  }
  const list = listRows(await go({ subject: 'till.card_payments', kind: 'list', rows: ['kind', 'status', 'amount', 'on_bill', 'reader.name', 'device.name'], filters: [here()] }))
  assert.deepEqual(sorted(list.map(r => [r.kind, r.status, p(r.amount), r.on_bill].join('|'))),
    sorted(page.map(r => [r.kind, r.status, r.amount, r.on_check].join('|'))))
  assert.ok(list.every(r => r['reader.name'] === reader.name))
})

// ── Print jobs ─────────────────────────────────────────────────────────

test('print jobs are the Printers page\'s tickets: printed, failed, waiting and how long they waited', async () => {
  const [printer] = await sql`SELECT id, name FROM pos_printers WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND is_active ORDER BY name LIMIT 1`
  const [theirs] = await sql`SELECT id FROM pos_printers WHERE tenant_id = ${ids.b} AND venue_id = ${VB} LIMIT 1`
  assert.ok(printer && theirs, 'the fixtures\' printers')
  const job = (o) => {
    const made = new Date(Date.now() - (o.ago ?? 60) * 1000)
    return sql`
      INSERT INTO pos_print_jobs (tenant_id, venue_id, printer_id, kind, title, ops, status, attempts, error, created_at, printed_at)
      VALUES (${o.tenant ?? ids.a}, ${o.venue ?? V}, ${o.printer ?? printer.id}, ${o.kind ?? 'kitchen'}, ${o.title ?? 'Table 4'},
              ${sql.json([{ text: 'x' }])}, ${o.status}, ${o.tries ?? 0}, ${o.error ?? null}, ${made},
              ${o.waited == null ? null : new Date(made.getTime() + o.waited * 1000)})`
  }
  await job({ status: 'queued', ago: 30 })
  await job({ status: 'printed', ago: 600, waited: 30, tries: 1 })
  await job({ status: 'printed', kind: 'receipt', ago: 300, waited: 4, tries: 1 })
  await job({ status: 'failed', ago: 120, tries: 3, error: 'Out of paper' })
  await job({ tenant: ids.b, venue: VB, printer: theirs.id, status: 'failed' })

  const page = await ok(owner.get(`/api/pos/venues/${V}/print-jobs`))
  assert.ok(page.length >= 4 && page.length < 200, 'the page lists every job here')
  const sum = await go({ subject: 'till.print_jobs', values: measures(['jobs', 'printed', 'failed', 'waiting', 'average_wait']), filters: [here()] })
  const t = rowsOf(sum)[0]
  assert.equal(t.jobs, page.length)
  assert.equal(t.printed, count(page, r => r.status === 'printed'))
  assert.equal(t.failed, count(page, r => r.status === 'failed'))
  assert.equal(t.waiting, count(page, r => r.status === 'queued' || r.status === 'printing'))
  const printed = page.filter(r => r.status === 'printed' && r.printed_at)
  const avg = printed.reduce((s, r) => s + seconds(r.created_at, r.printed_at), 0) / printed.length
  assert.ok(Math.abs(t.average_wait - avg) < 0.01, t.average_wait + ' against ' + avg)

  const byPrinter = rowsOf(await go({ subject: 'till.print_jobs', rows: ['printer.name', 'status'], values: measures(['jobs']), filters: [here()] }))
  for (const r of byPrinter) {
    assert.equal(r.jobs, count(page, j => (j.printer_name ?? null) === r['printer.name'] && j.status === r.status), r['printer.name'] + ' ' + r.status)
  }
  const failed = listRows(await go({ subject: 'till.print_jobs', kind: 'list', rows: ['status', 'error', 'tries'], filters: [here(), { field: 'status', op: 'is', value: 'failed' }] }))
  assert.deepEqual(sorted(failed.map(r => r.error + '|' + r.tries)), sorted(page.filter(r => r.status === 'failed').map(r => r.error + '|' + r.attempts)))
})

// ── Online order history ───────────────────────────────────────────────

test('online order history is the order\'s own history, status by status, by staff or the guest', async () => {
  const id = filled.ids.order
  await ok(owner.post(`/api/orders/${id}/status`, { to: 'accepted', prep_minutes: 15 }))
  await ok(owner.post(`/api/orders/${id}/promised`, { promised_at: new Date(Date.now() + 40 * 60_000).toISOString() }))
  await ok(owner.post(`/api/orders/${id}/status`, { to: 'ready' }))
  await ok(owner.post(`/api/orders/${id}/status`, { to: 'completed' }))
  // A change the guest made, and one by the system, as the order's history keeps them.
  await sql`INSERT INTO order_events (order_id, tenant_id, type, detail, actor) VALUES (${id}, ${ids.a}, 'note', '{}'::jsonb, 'guest'), (${id}, ${ids.a}, 'payment', '{}'::jsonb, 'system')`
  const order = await ok(owner.get('/api/orders/' + id))
  assert.ok(order.events.length >= 5)

  const res = await go({ subject: 'online.order_events', kind: 'list', rows: ['type', 'from_status', 'to_status', 'by'], filters: [period(order.service_date), here()] })
  const mine = listRows(res).filter(r => r._open?.id === id)
  const by = a => (a === 'guest' || a === 'system') ? a[0].toUpperCase() + a.slice(1) : a
  assert.deepEqual(
    sorted(mine.map(r => [r.type, r.from_status, r.to_status, r.by].join('|'))),
    sorted(order.events.map(e => [e.type, e.from_status ?? null, e.to_status ?? null, by(e.actor)].join('|'))))
  const sum = rowsOf(await go({ subject: 'online.order_events', values: measures(['changes', 'orders', 'by_staff']), filters: [period(order.service_date), here()] }))[0]
  assert.equal(sum.changes, mine.length)
  assert.equal(sum.orders, 1)
  assert.equal(sum.by_staff, count(order.events, e => e.actor !== 'guest' && e.actor !== 'system'))
  // Status changes only: accepted, ready, collected.
  const moves = rowsOf(await go({ subject: 'online.order_events', rows: ['to_status'], values: measures(['changes']), filters: [period(order.service_date), here(), { field: 'type', op: 'is', value: 'status' }] }))
  assert.deepEqual(sorted(moves.map(r => r.to_status)), ['accepted', 'completed', 'ready'])
})

// ── Sold out now ───────────────────────────────────────────────────────

test('dishes sold out now are what the tills are told: until tonight, until put back, never one that has ended', async () => {
  // The fixtures' dish is sold out for today; another until put back, a third one ended an hour ago.
  await ok(owner.put(`/api/orders/availability/${V}/${sold.d2.id}`, { sold_out: 'indefinite' }))
  await sql`DELETE FROM ordering_item_availability WHERE venue_id = ${V} AND item_id = ${sold.d3.id}`
  await sql`INSERT INTO ordering_item_availability (venue_id, item_id, tenant_id, sold_out_until) VALUES (${V}, ${sold.d3.id}, ${ids.a}, now() - interval '1 hour')`
  const live = await device(sold.till, 'GET', '/pos-api/live')
  assert.equal(live.status, 200, live.body)
  const told = live.json.sold_out
  assert.ok(told.length >= 2)
  assert.ok(!told.some(r => r.item_id === sold.d3.id), 'ended: not sold out any more')

  const list = listRows(await go({ subject: 'online.sold_out', kind: 'list', rows: ['item.name', 'until_put_back'], filters: [here()] }))
  assert.deepEqual(sorted(list.map(r => r._id.split(':')[1])), sorted(told.map(r => r.item_id)))
  for (const r of told) {
    const row = list.find(x => x._id === V + ':' + r.item_id)
    assert.equal(row.until_put_back, r.until == null, r.item_id)
  }
  const t = rowsOf(await go({ subject: 'online.sold_out', values: measures(['dishes']), filters: [here()] }))[0]
  assert.equal(t.dishes, told.length)
})

// ── Promotions ─────────────────────────────────────────────────────────

test('promotions used are the Promotions page\'s uses, counting only orders that are sales', async () => {
  const list = await ok(owner.get('/api/promotions'))
  const promo = list.find(x => x.name.endsWith(' 10% off'))
  assert.ok(promo, 'the fixtures\' promotion')
  let n = 800
  const used = async (status, discount) => {
    const [o] = await sql`
      INSERT INTO orders (tenant_id, venue_id, service_date, order_number, promised_at, guest_name, guest_email, subtotal_pence, total_pence, payment_method, status)
      VALUES (${ids.a}, ${V}, ${today}, ${++n}, now(), 'Promo guest', 'promo@zrp.test', 2000, 2000 - ${discount}, 'pay_at_venue', ${status}) RETURNING id`
    await sql`INSERT INTO order_promotions (order_id, tenant_id, promotion_id, name, discount_pence) VALUES (${o.id}, ${ids.a}, ${promo.id}, ${promo.name}, ${discount})`
  }
  await used('placed', 200)
  await used('completed', 150)
  await used('cancelled', 300)
  await used('pending_payment', 120)

  const page = (await ok(owner.get('/api/promotions'))).find(x => x.id === promo.id)
  // The page counts an order waiting for its payment; a report counts sales only.
  assert.equal(page.uses, 3)
  const res = rowsOf(await go({ subject: 'online.promotions', rows: ['promotion.name'], values: measures(['times_used', 'discount_given']) }))
  const row = res.find(r => r['promotion.name'] === promo.name)
  assert.equal(row.times_used, page.uses - 1)
  assert.equal(p(row.discount_given), page.discount_given_pence - 120)
  // The promotion as set up is behind the Promotions page's own module.
  const noPromotions = { ...ALL, promotions: 'none' }
  const r = await refused(go({ subject: 'online.promotions', rows: ['promotion.name'], values: measures(['times_used']) }, noPromotions))
  assert.equal(r.status, 403)
  const byName = rowsOf(await go({ subject: 'online.promotions', rows: ['name'], values: measures(['times_used']) }, noPromotions))
  assert.equal(byName.find(x => x.name === promo.name).times_used, 2)

  // The promotions as set up: the page's list.
  const all = await ok(owner.get('/api/promotions'))
  const set = listRows(await go({ subject: 'online.promotion_list', kind: 'list', rows: ['name', 'kind', 'applied', 'active'] }))
  assert.deepEqual(sorted(set.map(x => x.name + '|' + x.kind + '|' + x.applied + '|' + x.active)),
    sorted(all.map(x => x.name + '|' + x.kind + '|' + x.apply_mode + '|' + x.is_active)))
  const t = rowsOf(await go({ subject: 'online.promotion_list', values: measures(['promotions']) }))[0]
  assert.equal(t.promotions, count(all, x => x.is_active))
})

// ── Emails sent ────────────────────────────────────────────────────────

test('emails sent are the Sent emails list: bookings, orders and test emails, sent or failed', async () => {
  const [booking] = await sql`SELECT id FROM bookings WHERE tenant_id = ${ids.a} AND venue_id = ${V} ORDER BY created_at LIMIT 1`
  assert.ok(booking, 'a booking at the venue')
  const email = (o) => sql`
    INSERT INTO email_log (tenant_id, booking_id, order_id, template_type, recipient, subject, provider, status, error, sent_at)
    VALUES (${o.tenant ?? ids.a}, ${o.booking ?? null}, ${o.order ?? null}, ${o.type}, ${o.to ?? 'guest@zrp.test'}, ${o.subject ?? 'Your booking'},
            'smtp', ${o.status}, ${o.error ?? null}, ${o.status === 'sent' ? new Date() : null})`
  await email({ type: 'confirmation', booking: booking.id, status: 'sent' })
  await email({ type: 'reminder', booking: booking.id, status: 'failed', error: 'Mailbox full' })
  await email({ type: 'order_confirmation', order: filled.ids.order, status: 'sent', subject: 'Your order' })
  await email({ type: 'confirmation_test', status: 'sent', subject: 'Test' })
  await email({ type: 'ai_access_code', status: 'bounced', subject: 'Your code' })
  await email({ tenant: ids.b, type: 'confirmation', status: 'sent' })

  const page = await ok(owner.get('/api/email-templates/log?limit=200'))
  assert.ok(page.length >= 5 && page.length < 200)
  const byStatus = rowsOf(await go({ subject: 'bookings.emails', rows: ['status'], values: measures(['emails']) }))
  for (const s of ['sent', 'failed', 'bounced', 'queued']) {
    assert.equal(byStatus.find(r => r.status === s)?.emails ?? 0, count(page, r => r.status === s), s)
  }
  const sum = rowsOf(await go({ subject: 'bookings.emails', values: measures(['emails', 'sent', 'failed']) }))[0]
  assert.equal(sum.emails, page.length)
  assert.equal(sum.failed, count(page, r => r.status === 'failed' || r.status === 'bounced'))
  // Test emails, whatever kind they tested, are one kind.
  const byType = rowsOf(await go({ subject: 'bookings.emails', rows: ['type'], values: measures(['emails']) }))
  assert.equal(byType.find(r => r.type === 'test').emails, count(page, r => r.template_type.endsWith('_test')))
  assert.equal(byType.find(r => r.type === 'order_confirmation').emails, count(page, r => r.template_type === 'order_confirmation'))

  // At the venue: a booking's and an order's emails; a test email belongs to no venue.
  const atVenue = await sql`
    SELECT e.id FROM email_log e
      LEFT JOIN bookings b ON b.id = e.booking_id LEFT JOIN orders o ON o.id = e.order_id
     WHERE e.tenant_id = ${ids.a} AND COALESCE(b.venue_id, o.venue_id) = ${V}`
  const here1 = rowsOf(await go({ subject: 'bookings.emails', values: measures(['emails']), filters: [here()] }))[0]
  assert.equal(here1.emails, atVenue.length)
  // Someone who sees emails but not online orders still gets each email's venue.
  const emailsOnly = { email_templates: 'view', bookings: 'view' }
  const theirs = rowsOf(await go({ subject: 'bookings.emails', values: measures(['emails']), filters: [here()] }, emailsOnly))[0]
  assert.equal(theirs.emails, atVenue.length)
  // ...but can't follow an email to its online order.
  const r = await refused(go({ subject: 'bookings.emails', rows: ['order.number'], values: measures(['emails']) }, emailsOnly))
  assert.equal(r.status, 403)
})

// ── Store tech lists ───────────────────────────────────────────────────

test('table combinations, devices, card machines and printers are Store tech\'s own lists', async () => {
  const combos = await ok(owner.get(`/api/venues/${V}/combinations`))
  const comboRows = listRows(await go({ subject: 'bookings.combinations', kind: 'list', rows: ['name', 'min_covers', 'max_covers', 'active'], filters: [here()] }))
  assert.ok(combos.length >= 1)
  assert.deepEqual(sorted(comboRows.map(r => [r.name, r.min_covers, r.max_covers].join('|'))),
    sorted(combos.map(c => [c.name, c.min_covers, c.max_covers].join('|'))))
  assert.equal(rowsOf(await go({ subject: 'bookings.combinations', values: measures(['combinations']), filters: [here()] }))[0].combinations,
    count(combos, c => c.is_active !== false))

  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  const devices = listRows(await go({ subject: 'till.devices', kind: 'list', rows: ['name', 'kind', 'removed'], filters: [here()] }))
  assert.deepEqual(sorted(devices.map(r => r.name + '|' + r.kind + '|' + r.removed)),
    sorted(setup.devices.map(d => d.name + '|' + d.kind + '|' + (d.revoked_at != null))))
  const dt = rowsOf(await go({ subject: 'till.devices', values: measures(['devices', 'removed_devices']), filters: [here()] }))[0]
  assert.equal(dt.devices, count(setup.devices, d => d.revoked_at == null))
  assert.equal(dt.removed_devices, count(setup.devices, d => d.revoked_at != null))
  const byKind = rowsOf(await go({ subject: 'till.devices', rows: ['kind'], values: measures(['devices']), filters: [here()] }))
  assert.equal(byKind.find(r => r.kind === 'terminal').devices, count(setup.devices, d => d.kind === 'terminal' && d.revoked_at == null))

  const readersPage = await ok(owner.get(`/api/pos/venues/${V}/card-readers`))
  const readers = Array.isArray(readersPage) ? readersPage : readersPage.readers
  const readerRows = listRows(await go({ subject: 'till.card_readers', kind: 'list', rows: ['name', 'provider', 'removed'], filters: [here(), { field: 'removed', op: 'is', value: false }] }))
  assert.deepEqual(sorted(readerRows.map(r => r.name + '|' + r.provider)), sorted(readers.map(r => r.name + '|' + r.provider)))
  assert.equal(rowsOf(await go({ subject: 'till.card_readers', values: measures(['machines']), filters: [here()] }))[0].machines, readers.length)

  const printers = listRows(await go({ subject: 'till.printers', kind: 'list', rows: ['name', 'kind', 'connection', 'active'], filters: [here()] }))
  assert.deepEqual(sorted(printers.map(r => [r.name, r.kind, r.connection, r.active].join('|'))),
    sorted(setup.printers.map(x => [x.name, x.kind, x.connection, x.is_active].join('|'))))
  assert.equal(rowsOf(await go({ subject: 'till.printers', values: measures(['printers']), filters: [here()] }))[0].printers,
    count(setup.printers, x => x.is_active))
})

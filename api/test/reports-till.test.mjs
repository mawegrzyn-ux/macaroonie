// The report builder's till figures against the till's own day report
// (docs/REPORTS.md 5.4, 19). Two trading days are sold on a linked till
// through the real device routes and the cloud's sequencer: checks with a
// discount, a comp, a charge kept and one taken off, a void, a cancelled
// order, cash and card payments with tips, a refund on the next day and an
// open check. Every till measure in the catalogue must then equal
// dayFigures() (shared/pos/reports.js) for the same day, to the penny.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { sellTwoDays } from './support/tillDays.mjs'
import { runner, rowsOf, totalsRow, p, measures } from './support/reports.mjs'

let run, f1, f2, names, d2, lead, boss

/** Rows of the closed first day, or of the second (still open). */
const onDay = (closed, link = 'day') => ({ field: link ? link + '.closed' : 'closed', op: 'is', value: closed })
const days = () => [[true, f1, 'day 1'], [false, f2, 'day 2']]

before(async () => {
  const ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc' })
  ;({ f1, f2, names, d2, lead, boss } = await sellTwoDays({ owner: as(A.owner, ids.a), tenantId: ids.a, filled }))
  run = runner(ids.a)
})
after(closeApp)

test('the till\'s own figures are what the test set out to sell', () => {
  // Day 1: A 2200 less 10%, B 2000, C 2400 after the void, F 500 comped.
  assert.deepEqual(f1.counts, { closed: 4, open: 0, void: 1, merged: 0 })
  assert.equal(f1.sales.gross, 2200 + 2000 + 2400 + 500)
  assert.equal(f1.sales.discounts, 220 + 500)
  assert.equal(f1.sales.net, 1980 + 2000 + 2400)
  assert.equal(f1.sales.service_charge, 198)
  assert.equal(f1.covers, 8)
  assert.equal(f1.voids.count, 2, 'the dropped dish and the cancelled order\'s sent dish')
  assert.equal(f1.cancelled.count, 1)
  assert.equal(f1.cancelled.lines[0].value, 500 + 1200)
  assert.equal(f1.tips, 300)
  assert.equal(f1.refunds.count, 0)
  assert.equal(f1.cash_expected, 2000 + 1000 + 100)
  // Day 2: G 1500 with its service charge, the refund, and E still open.
  assert.deepEqual(f2.counts, { closed: 1, open: 1, void: 0, merged: 0 })
  assert.equal(f2.sales.net, 1500)
  assert.equal(f2.sales.service_charge, 150)
  assert.equal(f2.refunds.amount, 300)
  assert.equal(f2.cash_expected, 1650 - 300)
})

test('sales: checks, guests, gross, discounts, net, charges, total, VAT, averages', async () => {
  for (const [closed, f, what] of days()) {
    const res = await run({
      subject: 'till.checks',
      values: measures(['checks', 'guests', 'gross_sales', 'discounts', 'net_sales', 'charges', 'total_sales', 'vat_total', 'average_check', 'per_guest', 'open_checks']),
      filters: [onDay(closed)],
    })
    assert.equal(res.kind, 'summary')
    const [r] = rowsOf(res)
    assert.equal(r.checks, f.counts.closed, what)
    assert.equal(r.guests, f.covers, what)
    assert.equal(p(r.gross_sales), f.sales.gross, what)
    assert.equal(p(r.discounts), f.sales.discounts, what)
    assert.equal(p(r.net_sales), f.sales.net, what)
    assert.equal(p(r.charges), f.sales.service_charge, what)
    assert.equal(p(r.total_sales), f.sales.total, what)
    assert.equal(p(r.vat_total), f.sales.vat_total, what)
    assert.ok(Math.abs(r.average_check * 100 - f.sales.total / f.counts.closed) < 1e-6, what + ' average check')
    assert.ok(Math.abs(r.per_guest * 100 - f.sales.total / f.covers) < 1e-6, what + ' per guest')
    assert.equal(r.open_checks, f.counts.open, what)
  }
})

test('sales by order type and by server, with the totals row', async () => {
  for (const [closed, f, what] of days()) {
    const byType = await run({
      subject: 'till.checks', rows: ['order_type.name'],
      values: measures(['checks', 'net_sales', 'total_sales']),
      filters: [onDay(closed), { field: 'status', op: 'is', value: 'closed' }],
    })
    const got = Object.fromEntries(rowsOf(byType).map(r => [r['order_type.name'], [r.checks, p(r.net_sales), p(r.total_sales)]]))
    const want = Object.fromEntries(f.order_types.map(t => [names.types[t.id], [t.checks, t.net, t.total]]))
    assert.deepEqual(got, want, what)
    const tot = totalsRow(byType)
    assert.equal(tot.checks, f.counts.closed, what)
    assert.equal(p(tot.total_sales), f.sales.total, what)

    const byServer = await run({
      subject: 'till.checks', rows: ['server.name'],
      values: measures(['checks', 'guests', 'net_sales', 'total_sales']),
      filters: [onDay(closed), { field: 'status', op: 'is', value: 'closed' }],
    })
    const gotS = Object.fromEntries(rowsOf(byServer).map(r => [r['server.name'], [r.checks, r.guests, p(r.net_sales), p(r.total_sales)]]))
    const wantS = Object.fromEntries(f.staff.filter(s => s.checks).map(s => [names.staff[s.id], [s.checks, s.covers, s.net, s.total]]))
    assert.deepEqual(gotS, wantS, what)

    // Tips go to whoever took the payment.
    const tips = await run({ subject: 'till.payments', rows: ['staff.name'], values: measures(['tips']), filters: [onDay(closed)] })
    const gotT = Object.fromEntries(rowsOf(tips).filter(r => r.tips).map(r => [r['staff.name'], p(r.tips)]))
    const wantT = Object.fromEntries(f.staff.filter(s => s.tips).map(s => [names.staff[s.id], s.tips]))
    assert.deepEqual(gotT, wantT, what)
  }
})

test('dishes sold: by dish and by revenue stream', async () => {
  for (const [closed, f, what] of days()) {
    const byDish = await run({ subject: 'till.lines', rows: ['name'], values: measures(['qty_sold', 'net_sales']), filters: [onDay(closed)] })
    const got = Object.fromEntries(rowsOf(byDish).filter(r => r.qty_sold).map(r => [r.name, [r.qty_sold, p(r.net_sales)]]))
    const want = Object.fromEntries(f.items.map(i => [i.name, [i.qty, i.net]]))
    assert.deepEqual(got, want, what)

    const byStream = await run({
      subject: 'till.lines', rows: ['stream.name'],
      values: measures(['qty_sold', 'gross_sales', 'discounts', 'net_sales', 'vat_total']), filters: [onDay(closed)],
    })
    const gotS = Object.fromEntries(rowsOf(byStream).filter(r => r.qty_sold).map(r => [r['stream.name'], [r.qty_sold, p(r.gross_sales), p(r.discounts), p(r.net_sales), p(r.vat_total)]]))
    const wantS = Object.fromEntries(f.revenue_streams.map(s => [names.streams[s.id], [s.items, s.gross, s.discount, s.net, s.vat]]))
    assert.deepEqual(gotS, wantS, what)
  }
})

test('payments by tender, tips, refunds and takings, each on the day it was taken', async () => {
  for (const [closed, f, what] of days()) {
    const res = await run({
      subject: 'till.payments', rows: ['tender'],
      values: measures(['payments', 'taken', 'tips', 'refunds', 'refunded', 'net_taken', 'takings']), filters: [onDay(closed)],
    })
    const got = Object.fromEntries(rowsOf(res).map(r => [r.tender, [r.payments, p(r.taken), p(r.tips), p(r.refunded), p(r.net_taken)]]))
    const want = Object.fromEntries(f.tenders.map(t => [t.tender, [t.count, t.amount, t.tips, t.refunds, t.net]]))
    assert.deepEqual(got, want, what)
    const tot = totalsRow(res)
    assert.equal(p(tot.takings), f.takings, what)
    assert.equal(p(tot.tips), f.tips, what)
    assert.equal(tot.refunds, f.refunds.count, what)
    assert.equal(p(tot.refunded), f.refunds.amount, what)
    // The tender column shows its name, in the till's own order of tenders.
    const col = res.columns.find(c => c.key === 'tender')
    assert.equal(col.labels.card_external, 'Card')
  }
  // The refund sits on day 2 though its check is day 1's.
  const refund = await run({ subject: 'till.payments', kind: 'list', rows: ['kind', 'tender', 'amount', 'reason', 'check.number', 'staff.name', 'day.z_number'], filters: [{ field: 'kind', op: 'is', value: 'refund' }] })
  assert.equal(refund.rows.length, 1)
  const [r] = rowsOf(refund)
  assert.deepEqual([r.kind, r.tender, r.amount, r.reason, r['staff.name'], r['day.z_number']], ['refund', 'cash', 3, 'Cold', boss, null])
})

test('voids and cancelled orders, by who and why', async () => {
  for (const [closed, f, what] of days()) {
    const [v] = rowsOf(await run({ subject: 'till.voids', values: measures(['voids', 'qty_voided', 'value_voided']), filters: [onDay(closed, 'void_day')] }))
    assert.deepEqual([v.voids, v.qty_voided, p(v.value_voided)], [f.voids.count, f.voids.qty, f.voids.value], what)
    const [c] = rowsOf(await run({ subject: 'till.cancelled', values: measures(['cancelled', 'value_cancelled']), filters: [onDay(closed, 'cancel_day')] }))
    assert.deepEqual([c.cancelled, p(c.value_cancelled)], [f.cancelled.count, f.cancelled.lines.reduce((s, x) => s + x.value, 0)], what)
  }
  const list = await run({ subject: 'till.voids', kind: 'list', rows: ['name', 'qty', 'value', 'reason', 'wasted', 'voided_by.name', 'approved_by.name'], sort: [{ by: 'reason', dir: 'asc' }] })
  assert.deepEqual(rowsOf(list).map(r => [r.name, r.qty, r.value, r.reason, r.wasted, r['voided_by.name'], r['approved_by.name']]), [
    [d2.name, 1, 5, 'Customer left', true, lead, boss],
    [d2.name, 1, 5, 'Dropped', true, lead, boss],
  ])
  assert.deepEqual(list.totals.cells.slice(1, 3), [2, 10], 'a list adds up its adding columns')
  const gone = await run({ subject: 'till.cancelled', kind: 'list', rows: ['mode', 'order_no', 'value', 'reason', 'cancelled_by.name'] })
  assert.deepEqual(rowsOf(gone).map(r => [r.mode, r.order_no, r.value, r.reason, r['cancelled_by.name']]), [['counter', 101, 17, 'Customer left', lead]])
})

test('discounts and comps, charges kept and taken off, VAT by rate', async () => {
  for (const [closed, f, what] of days()) {
    const disc = await run({ subject: 'till.discounts', rows: ['kind', 'name'], values: measures(['times_given', 'amount_given']), filters: [onDay(closed)] })
    const got = rowsOf(disc).map(r => [r.name, r.kind === 'comp', r.times_given, p(r.amount_given)]).sort()
    const want = f.discounts.map(d => [d.name, d.comp, d.count, d.amount]).sort()
    assert.deepEqual(got, want, what)

    const ch = await run({ subject: 'till.charges', rows: ['name'], values: measures(['times_charged', 'amount_charged', 'times_removed', 'amount_removed']), filters: [onDay(closed)] })
    const gotC = rowsOf(ch).map(r => [r.name, r.times_charged, p(r.amount_charged), r.times_removed, p(r.amount_removed)]).sort()
    const wantC = f.charges.map(x => [x.name, x.count, x.amount, x.removed, x.removed_value]).sort()
    assert.deepEqual(gotC, wantC, what)

    const vat = await run({ subject: 'till.vat', rows: ['rate'], values: measures(['net_of_vat', 'vat_total', 'with_vat']), filters: [onDay(closed)], sort: [{ by: 'rate', dir: 'asc' }] })
    const gotV = rowsOf(vat).map(r => [Math.round(r.rate * 10000) / 100, p(r.net_of_vat), p(r.vat_total), p(r.with_vat)])
    const wantV = f.vat.map(v => [Number(v.rate), v.net, v.vat, v.gross])
    assert.deepEqual(gotV, wantV, what)
  }
  // Who gave the comp and who approved it.
  const comp = await run({ subject: 'till.discounts', kind: 'list', rows: ['kind', 'name', 'amount', 'reason', 'scope', 'applied_by.name', 'approved_by.name'], filters: [{ field: 'kind', op: 'is', value: 'comp' }] })
  assert.deepEqual(rowsOf(comp).map(r => Object.values(r)), [['comp', 'Comp', 5, 'Birthday', 'line', lead, boss]])
  const off = await run({ subject: 'till.charges', kind: 'list', rows: ['name', 'amount', 'would_be', 'removed', 'remove_reason', 'removed_by.name'], filters: [{ field: 'removed', op: 'is', value: true }] })
  assert.deepEqual(rowsOf(off).map(r => Object.values(r)), [['Zrp Service', 0, 2.4, true, 'Guest asked', lead]])
})

test('trading days: cash counted against cash expected', async () => {
  const res = await run({ subject: 'till.days', kind: 'list', rows: ['z_number', 'closed', 'cash_expected', 'cash_counted', 'cash_difference', 'notes', 'closed_by.name'], sort: [{ by: 'opened_at', dir: 'asc' }] })
  const rows = rowsOf(res)
  assert.equal(rows.length, 2)
  assert.deepEqual(Object.values(rows[0]), [1, true, f1.cash_expected / 100, f1.cash_expected / 100 - 1, -1, 'Zrp close', boss])
  assert.deepEqual(Object.values(rows[1]), [null, false, null, null, null, null, null])
  const [m] = rowsOf(await run({ subject: 'till.days', values: measures(['days', 'days_closed', 'counted_total', 'expected_total', 'difference_total']) }))
  assert.deepEqual([m.days, m.days_closed, p(m.counted_total), p(m.expected_total), p(m.difference_total)], [2, 1, f1.cash_expected - 100, f1.cash_expected, -100])
})

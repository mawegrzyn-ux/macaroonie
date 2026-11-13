// The report builder's online figures against the app's own (docs/REPORTS.md
// 5.4, 19): the Online orders page's Transactions list (onlineTransactions()
// in services/onlineSalesSvc.js) and its Report tab (GET /api/orders/report).
//
// Two sets of orders: three fixed days of the group's own orders and
// GloriaFood orders (support/onlineDays.mjs: tenders, a refund, a cancelled
// order, a GloriaFood test order, an order on the trading day before), and
// real orders placed through the ordering page's API for tomorrow, with the
// discount the group's automatic promotion gives them. Every online measure
// must equal the app's figure for the same days.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { sellOnline, placeOrders, D1, D2, D3 } from './support/onlineDays.mjs'
import { runner, rowsOf, totalsRow, p, measures, refused, LEVELS } from './support/reports.mjs'

let ids, owner, V, run, real, REAL
const FIXED = { from: D1, to: D3 }

const period = r => ({ field: 'date', op: 'in_period', value: { from: r.from, to: r.to } })
const here = () => ({ field: 'venue', op: 'in', value: [V] })
const COUNTED = { field: 'counted', op: 'is', value: true }
const ORDER_COUNTED = { field: 'order.counted', op: 'is', value: true }
const ranges = () => [[FIXED, 'the three fixed days'], [REAL, 'the real orders\' day']]

const transactions = (r, q = '') => ok(owner.get(`/api/orders/transactions?venue_id=${V}&from=${r.from}&to=${r.to}${q}`))
const pageReport = r => ok(owner.get(`/api/orders/report?venue_id=${V}&from=${r.from}&to=${r.to}`))
// The report catalogue names a tender without the list's "other:" mark.
const tenderOf = key => String(key).replace(/^other:/, '')
// A starter run through the routes, as the Reports page runs it.
const starter = (key, r, who = owner, more = {}) => who.post(`/api/reports/${encodeURIComponent('starter:' + key)}/run`, { params: { period: { from: r.from, to: r.to }, venues: [V] }, fresh: true, ...more })

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc' })
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  const sold = await sellOnline({ owner, tenantId: ids.a, venueId: V })
  // Two more payments, as a busy day leaves them: a second, smaller cash
  // payment on the test card order (given back since) and a card try that
  // failed on the order nobody marked paid. The biggest payment that went
  // through names how an order was paid.
  await sql`
    INSERT INTO order_payments (order_id, tenant_id, gateway, gateway_ref, amount_pence, refunded_pence, status)
    VALUES (${sold.own.demo}, ${ids.a}, 'cash', NULL, 200, 200, 'refunded'),
           (${sold.own.unpaid}, ${ids.a}, 'demo', 'demo_failed', 800, 0, 'failed')`

  // Real orders: one collected and paid in cash, one accepted, paid by card
  // and part refunded, one cancelled, one left as placed.
  real = await placeOrders({ venueId: V, n: 4, qty: [2, 1, 3, 1] })
  const status = (o, to, extra = {}) => ok(owner.post(`/api/orders/${o.id}/status`, { to, ...extra }), 'status ' + to)
  for (const to of ['accepted', 'ready', 'completed']) await status(real[0], to, { prep_minutes: 10 })
  await ok(owner.post(`/api/orders/${real[0].id}/mark-paid`, { method: 'cash' }))
  await status(real[1], 'accepted', { prep_minutes: 15 })
  await ok(owner.post(`/api/orders/${real[1].id}/mark-paid`, { method: 'card_terminal' }))
  await ok(owner.post(`/api/orders/${real[1].id}/refund`, { amount_pence: 100, reason: 'Late' }))
  await status(real[2], 'cancelled', { reason: 'Closed early' })
  REAL = { from: real[0].date, to: real[0].date }
  run = runner(ids.a)
})
after(closeApp)

test('online.sales is the Transactions list: the same orders, each on its day with its tender and money', async () => {
  for (const [r, what] of ranges()) {
    const list = await transactions(r)
    const res = await run({
      subject: 'online.sales', kind: 'list',
      rows: ['source', 'number', 'date', 'tender', 'counted', 'status', 'total', 'refunded', 'net', 'fees', 'tax', 'tip', 'discount'],
      filters: [period(r), here()],
    })
    const mine = Object.fromEntries(rowsOf(res).map(x => [x.source + ':' + x.number, x]))
    const theirs = Object.fromEntries(list.rows.map(x => [x.source + ':' + x.number, x]))
    assert.deepEqual(Object.keys(mine).sort(), Object.keys(theirs).sort(), what + ': the same orders')
    assert.ok(list.rows.length >= 4, what + ': there are orders to compare')
    for (const [k, t] of Object.entries(theirs)) {
      const m = mine[k]
      assert.deepEqual(
        [m.date, m.tender, m.counted, m.status, p(m.total), p(m.refunded), p(m.net), p(m.fees), p(m.tax), p(m.tip), p(m.discount)],
        [t.date, tenderOf(t.tender), t.counted, t.status, t.total_pence, t.refunded_pence, t.net_pence, t.fees_pence, t.tax_pence, t.tip_pence, t.discount_pence],
        what + ': ' + k)
    }
    assert.equal(res.totals.count, list.rows.length)
  }
  // What the fixed days are known to hold (support/onlineDays.mjs).
  const res = await run({ subject: 'online.sales', kind: 'list', rows: ['source', 'number', 'date', 'tender', 'net'], filters: [period(FIXED), here()] })
  const by = Object.fromEntries(rowsOf(res).map(x => [x.source + ':' + x.number, x]))
  assert.deepEqual([by['web:102'].tender, p(by['web:102'].net)], ['card_counter', 2000])
  assert.deepEqual([by['web:105'].tender, p(by['web:105'].net)], ['unpaid', 0], 'a cancelled order nets nothing')
  assert.equal(by['gloriafood:9007'].date, D1, '02:00 belongs to the trading day before (the day starts at 04:00)')
  assert.equal(by['gloriafood:8001'].tender, 'Card (G-Pay / via Browser)', 'a payment only the export names is kept as written')
  assert.equal(by['web:106'], undefined, 'an order still unpaid online is never listed')
  assert.equal(by['web:103'].tender, 'test', 'the bigger of an order\'s two payments names how it was paid')
  assert.equal(by['web:104'].tender, 'unpaid', 'a payment that failed is no payment')
  // A choice the catalogue doesn't know is shown as it is, the others by their names.
  const tender = res.columns.find(c => c.key === 'tender')
  assert.equal(tender.labels.card_counter, 'Card at the counter')
})

test('online.sales totals: orders, sales, refunds, net, tips, discounts, fees and tax, by tender and by source', async () => {
  for (const [r, what] of ranges()) {
    const list = await transactions(r)
    const t = list.totals
    const res = await run({
      subject: 'online.sales',
      values: measures(['orders', 'not_counted', 'sales', 'refunded_total', 'net_sales', 'tips', 'discounts', 'fees_total', 'tax_total', 'average_order']),
      filters: [period(r), here()],
    })
    const [m] = rowsOf(res)
    assert.deepEqual(
      [m.orders, m.not_counted, p(m.sales), p(m.refunded_total), p(m.net_sales), p(m.tips), p(m.discounts), p(m.fees_total), p(m.tax_total), p(m.average_order)],
      [t.orders, t.not_counted, t.sales_pence, t.refunded_pence, t.net_pence, t.tip_pence, t.discount_pence, t.fees_pence, t.tax_pence, t.average_pence],
      what)

    const byTender = await run({
      subject: 'online.sales', rows: ['tender'], values: measures(['orders', 'sales', 'refunded_total', 'net_sales']),
      filters: [period(r), here(), COUNTED], sort: [{ by: 'net_sales', dir: 'desc' }],
    })
    assert.deepEqual(
      Object.fromEntries(rowsOf(byTender).map(x => [x.tender, [x.orders, p(x.sales), p(x.refunded_total), p(x.net_sales)]])),
      Object.fromEntries(list.by_tender.map(x => [tenderOf(x.key), [x.orders, x.sales_pence, x.refunded_pence, x.net_pence]])),
      what + ': by tender')
    const tot = totalsRow(byTender)
    assert.deepEqual([tot.orders, p(tot.net_sales)], [t.orders, t.net_pence], what + ': the tenders add up to the total')

    // Tender down, source across: the list's own split of each tender.
    const cross = await run({
      subject: 'online.sales', kind: 'matrix', rows: ['tender'], columns: ['source'], values: measures(['orders', 'net_sales']),
      filters: [period(r), here(), COUNTED],
    })
    const col = (measure, source) => cross.columns.findIndex(c => c.key.startsWith(measure + '|') && c.group === source)
    for (const x of list.by_tender) {
      const row = cross.rows.find(y => y.cells[0] === tenderOf(x.key))
      assert.ok(row, what + ': ' + x.key)
      for (const [source, label] of [['web', 'Online ordering'], ['gloriafood', 'GloriaFood']]) {
        if (col('orders', label) < 0) { assert.equal(x[source].orders, 0, what + ': no ' + label + ' orders at all'); continue }
        assert.deepEqual([row.cells[col('orders', label)] || 0, p(row.cells[col('net_sales', label)] || 0)], [x[source].orders, x[source].net_pence], what + ': ' + x.key + ' from ' + label)
      }
    }
  }
  const list = await transactions(FIXED)
  assert.deepEqual([list.totals.orders, list.totals.not_counted, list.totals.net_pence], [10, 3, 5700 + 9450 - 400], 'the fixed days as the Transactions test knows them')
})

test('online.sales filters are the list\'s filters: one source, one tender, counted only', async () => {
  const one = async (filter, q) => {
    const list = await transactions(FIXED, q)
    const res = await run({ subject: 'online.sales', values: measures(['orders', 'not_counted', 'net_sales']), filters: [period(FIXED), here(), filter] })
    const [m] = rowsOf(res)
    assert.deepEqual([m.orders, m.not_counted, p(m.net_sales)], [list.totals.orders, list.totals.not_counted, list.totals.net_pence], q)
    return m
  }
  assert.equal(p((await one({ field: 'source', op: 'is', value: 'gloriafood' }, '&source=gloriafood')).net_sales), 9450)
  assert.equal(p((await one({ field: 'tender', op: 'is', value: 'cash' }, '&tender=cash')).net_sales), 3250)
  assert.equal((await one(COUNTED, '&counted=1')).not_counted, 0)
  await one({ field: 'tender', op: 'is', value: 'Card (G-Pay / via Browser)' }, '&tender=' + encodeURIComponent('other:Card (G-Pay / via Browser)'))
})

test('online.orders against the Online orders report: totals, each day, each status', async () => {
  for (const [r, what] of ranges()) {
    const rep = await pageReport(r)
    const t = rep.totals
    const values = measures(['orders', 'sales', 'tips', 'discounts', 'vat_total', 'refunded_total', 'platform_fees', 'average_order', 'net_sales'])
    const res = await run({ subject: 'online.orders', values, filters: [period(r), here()] })
    const [m] = rowsOf(res)
    assert.ok(t.orders >= 3, what + ': there are orders to compare')
    assert.deepEqual(
      [m.orders, p(m.sales), p(m.tips), p(m.discounts), p(m.vat_total), p(m.refunded_total), p(m.platform_fees), p(m.average_order), p(m.net_sales)],
      [t.orders, t.total_pence, t.tip_pence, t.discount_pence, t.vat_pence, t.refunded_pence, t.platform_fee_pence, t.average_pence, t.total_pence - t.refunded_pence],
      what)

    const byDay = await run({ subject: 'online.orders', rows: ['date'], values, filters: [period(r), here(), COUNTED], sort: [{ by: 'date', dir: 'asc' }] })
    assert.deepEqual(
      rowsOf(byDay).map(x => [x.date, x.orders, p(x.sales), p(x.tips), p(x.discounts), p(x.vat_total), p(x.refunded_total), p(x.platform_fees)]),
      rep.days.map(d => [d.date, d.orders, d.total_pence, d.tip_pence, d.discount_pence, d.vat_pence, d.refunded_pence, d.platform_fee_pence]),
      what + ': day by day')

    // Each status, counted or not. Unpaid and expired checkouts aren't orders to the report.
    const byStatus = await run({ subject: 'online.orders', rows: ['status'], values: [{ key: 'n', agg: 'count' }], filters: [period(r), here()] })
    const theirs = { ...rep.statuses }
    delete theirs.pending_payment
    delete theirs.expired
    assert.deepEqual(Object.fromEntries(rowsOf(byStatus).map(x => [x.status, x.n])), theirs, what + ': by status')

    // Orders refunded: the ones that count and gave money back, as the Transactions list shows them.
    const back = rowsOf(await run({ subject: 'online.orders', values: measures(['refunded_orders', 'orders']), filters: [period(r), here()] }))[0]
    const gaveBack = (await transactions(r)).rows.filter(x => x.source === 'web' && x.counted && x.refunded_pence > 0)
    assert.deepEqual([back.refunded_orders, gaveBack.length], [1, 1], what + ': one order was refunded')
    assert.ok(back.orders > back.refunded_orders, what + ': most orders weren\'t')
  }
  const fixed = await pageReport(FIXED)
  assert.deepEqual([fixed.totals.orders, fixed.totals.total_pence, fixed.totals.refunded_pence, fixed.statuses.pending_payment], [4, 5700, 400, 1])
})

test('online.items against the report\'s top dishes; online.promotions against its promotions', async () => {
  for (const [r, what] of ranges()) {
    const rep = await pageReport(r)
    const dishes = await run({
      subject: 'online.items', rows: ['name'], values: measures(['qty_sold', 'gross_sales']),
      filters: [period(r), here(), ORDER_COUNTED], sort: [{ by: 'qty_sold', dir: 'desc' }, { by: 'gross_sales', dir: 'desc' }],
    })
    assert.ok(rep.top_items.length >= 1, what + ': there are dishes to compare')
    assert.deepEqual(
      Object.fromEntries(rowsOf(dishes).map(x => [x.name, [x.qty_sold, p(x.gross_sales)]])),
      Object.fromEntries(rep.top_items.map(x => [x.name, [x.qty, x.total_pence]])),
      what + ': dishes')
    assert.deepEqual(rowsOf(dishes).map(x => x.qty_sold), rep.top_items.map(x => x.qty), what + ': most sold first')

    const promos = await run({
      subject: 'online.promotions', rows: ['name'], values: measures(['times_used', 'discount_given', 'orders']),
      filters: [period(r), here(), ORDER_COUNTED],
    })
    assert.deepEqual(
      Object.fromEntries(rowsOf(promos).map(x => [x.name, [x.times_used, p(x.discount_given)]])),
      Object.fromEntries(rep.promotions.map(x => [x.name, [x.orders, x.discount_pence]])),
      what + ': promotions')
    // A discount on the dishes and on the promotions is the orders' discount.
    const orders = rowsOf(await run({ subject: 'online.orders', values: measures(['discounts']), filters: [period(r), here()] }))[0]
    const lineDiscounts = rowsOf(await run({ subject: 'online.items', values: measures(['discounts']), filters: [period(r), here()] }))[0]
    assert.equal(p(lineDiscounts.discounts || 0), p(orders.discounts || 0), what + ': line discounts add up to the orders\' discounts')

    // The figures leave out rejected and cancelled orders by themselves, with no filter asked for.
    const sum = (rows, k) => rows.reduce((n, x) => n + p(x[k] || 0), 0)
    const all = rowsOf(await run({ subject: 'online.items', values: measures(['qty_sold', 'gross_sales', 'discounts', 'net_sales', 'orders']), filters: [period(r), here()] }))[0]
    assert.deepEqual([all.qty_sold, p(all.gross_sales)], [rowsOf(dishes).reduce((n, x) => n + x.qty_sold, 0), sum(rowsOf(dishes), 'gross_sales')], what + ': dishes, no filter')
    assert.equal(p(all.net_sales), p(all.gross_sales) - p(all.discounts || 0), what + ': net sales are what the discounts left')
    assert.equal(all.orders, rep.totals.orders, what + ': an order with two dishes is one order')
    const everyPromo = rowsOf(await run({ subject: 'online.promotions', values: measures(['times_used', 'discount_given']), filters: [period(r), here()] }))[0] || {}
    assert.deepEqual([everyPromo.times_used || 0, p(everyPromo.discount_given || 0)], [rowsOf(promos).reduce((n, x) => n + x.times_used, 0), sum(rowsOf(promos), 'discount_given')], what + ': promotions, no filter')
  }
  // The real orders used the group's promotion; the fixed days have none.
  const used = await pageReport(REAL)
  assert.ok(used.promotions.length >= 1 && used.totals.discount_pence > 0, 'the real orders carry a promotion')
  const [onCancelled] = await sql`SELECT count(*)::int AS n FROM order_promotions WHERE order_id = ${real[2].id}`
  assert.ok(onCancelled.n >= 1, 'the cancelled order had it too, and isn\'t counted above')
  const realDishes = rowsOf(await run({ subject: 'online.items', values: measures(['gross_sales', 'net_sales']), filters: [period(REAL), here()] }))[0]
  assert.ok(p(realDishes.net_sales) < p(realDishes.gross_sales), 'the promotion came off the dishes')
  // The fixed days' dishes (support/onlineDays.mjs): the cancelled order's Pad Thai isn't counted.
  const fixed = Object.fromEntries((await pageReport(FIXED)).top_items.map(x => [x.name, [x.qty, x.total_pence]]))
  assert.deepEqual(fixed, { 'Pad Thai': [3, 2700], 'Spring Rolls': [3, 1500], 'Green Curry': [1, 600], 'Tom Yum': [1, 800] })
})

test('the online starter reports, run as the Reports page runs them', async () => {
  const rep = await pageReport(FIXED)
  const list = await transactions(FIXED)

  // Orders and sales by day and channel: a pair of columns for the website.
  const byDay = await ok(starter('online_by_day_channel', FIXED))
  assert.equal(byDay.kind, 'matrix')
  assert.deepEqual(byDay.columns.map(c => [c.key, c.group || null, c.label]), [
    ['date', null, 'Day'],
    ['orders|0', 'The website', 'Orders'], ['sales|0', 'The website', 'Sales'],
    ['orders|total', 'Total', 'Orders'], ['sales|total', 'Total', 'Sales'],
  ])
  assert.deepEqual(byDay.rows.map(x => [x.cells[0], x.cells[1], p(x.cells[2])]), rep.days.map(d => [d.date, d.orders, d.total_pence]))
  assert.deepEqual([byDay.totals.cells[3], p(byDay.totals.cells[4])], [rep.totals.orders, rep.totals.total_pence])
  assert.equal(byDay.meta.period.text, '7 to 9 Sep 2026')
  // The orders behind one figure are the ones it counted: the second day's cancelled order isn't among them.
  const behind = await ok(starter('online_by_day_channel', FIXED, owner, { drill: [{ at: [{ field: 'date', value: D2 }, { field: 'channel', value: 'web' }], to: 'rows' }] }))
  assert.equal(behind.kind, 'list')
  assert.deepEqual(behind.rows.map(x => x.cells[behind.columns.findIndex(c => c.key === 'number')]), ['102'])

  // Top dishes: most sold first, with what the discounts left.
  const top = await ok(starter('online_top_dishes', FIXED))
  assert.deepEqual(top.rows.map(x => [x.cells[0], x.cells[1], p(x.cells[2])]).sort(), rep.top_items.map(x => [x.name, x.qty, x.total_pence]).sort())
  assert.deepEqual(top.rows.map(x => x.cells[1]), rep.top_items.map(x => x.qty))
  assert.deepEqual(top.columns.map(c => c.label), ['Dish', 'Quantity sold', 'Sales before discounts', 'Discounts', 'Net sales', 'Orders'])
  const padThai = top.rows.find(x => x.cells[0] === 'Pad Thai')
  assert.equal(padThai.cells[5], 2, 'Pad Thai was on two orders that count')

  // Promotions: the real orders' day. Three of the four orders count.
  const realDay = await pageReport(REAL)
  const promos = await ok(starter('online_promotions', REAL))
  assert.deepEqual(promos.columns.map(c => c.label), ['Promotion', 'Kind', 'Code used', 'Times used', 'Orders', 'Discount given'])
  assert.deepEqual(promos.rows.map(x => [x.cells[0], x.cells[1], x.cells[3], x.cells[4], p(x.cells[5])]),
    realDay.promotions.map(x => [x.name, 'promotion', x.orders, x.orders, x.discount_pence]))
  assert.deepEqual([promos.rows[0].cells[3], p(promos.totals.cells[5])], [3, realDay.totals.discount_pence])

  // Times: order 103 was accepted after 4 minutes and ready 16 minutes later.
  const times = await ok(starter('online_times', FIXED))
  assert.deepEqual(times.columns.map(c => [c.label, c.type]), [['Day', 'date'], ['Orders', 'number'], ['Average placed to accepted', 'duration'], ['Average accepted to ready', 'duration']])
  assert.deepEqual(times.rows.map(x => x.cells), [[D1, 1, null, null], [D2, 1, null, null], [D3, 2, 240, 960]])

  // Refunds: every order with money back, on either set of days.
  const refunds = await ok(starter('online_refunds', FIXED))
  assert.equal(refunds.kind, 'list')
  assert.deepEqual(refunds.rows.map(x => x.cells.slice(0, 2)), [[D2, '102']])
  const idx = k => refunds.columns.findIndex(c => c.key === k)
  assert.deepEqual([p(refunds.rows[0].cells[idx('total')]), p(refunds.rows[0].cells[idx('refunded')]), p(refunds.rows[0].cells[idx('net')])], [2400, 400, 2000])
  const realRefunds = await ok(starter('online_refunds', REAL))
  assert.deepEqual(realRefunds.rows.map(x => [x.cells[1], p(x.cells[idx('refunded')])]), [[String(real[1].number), 100]])

  // GloriaFood beside your own ordering: one week, a pair of columns each.
  const sources = await ok(starter('online_sources', FIXED))
  assert.deepEqual(sources.rows.length, 1)
  const of = (measure, group) => sources.rows[0].cells[sources.columns.findIndex(c => c.key.startsWith(measure + '|') && c.group === group)]
  const src = Object.fromEntries(list.by_source.map(x => [x.label, x]))
  for (const label of ['Online ordering', 'GloriaFood']) {
    assert.deepEqual([of('orders', label), p(of('sales', label))], [src[label].orders, src[label].sales_pence], label)
  }
  assert.equal(sources.rows[0].cells[0], D1, 'the week is named by its Monday')
})

test('who sees them: Online orders access, and each group its own orders only', async () => {
  const spec = { subject: 'online.sales', rows: ['source'], values: measures(['orders', 'net_sales']), filters: [period(FIXED)] }
  // No Online orders access: the report is refused, for every online subject.
  for (const subject of ['online.sales', 'online.orders', 'online.items', 'online.promotions']) {
    const no = await refused(run({ subject, values: measures(['orders']) }, null, { levels: { ...LEVELS, web_orders: 'none' } }))
    assert.equal(no.status, 403, subject)
  }
  // Through the routes too: a role without it is told what the starter needs.
  const roles = await ok(owner.get('/api/access/roles'))
  const viewer = (roles.roles || roles).find(x => x.key === 'viewer')
  await ok(owner.patch('/api/access/roles/' + viewer.id, { permissions: { ...(viewer.permissions || {}), reports: 'view', web_orders: 'none' } }))
  const v = as(A.viewer, ids.a)
  const listed = (await ok(v.get('/api/reports'))).starters.find(x => x.id === 'starter:online_sources')
  assert.deepEqual([listed.runs, listed.needs], [false, 'Online orders'])
  assert.equal((await starter('online_sources', FIXED, v)).status, 403)

  // Another group: none of these orders, whatever it asks for.
  const theirs = runner(ids.b)
  assert.deepEqual(rowsOf(await theirs(spec)), [], 'nothing on those days')
  const every = await theirs({ subject: 'online.sales', kind: 'list', rows: ['source', 'number'] })
  assert.ok(!rowsOf(every).some(x => x.source === 'gloriafood'), 'no GloriaFood orders of the first group')
  const [own] = await sql`SELECT count(*)::int AS n FROM orders WHERE tenant_id = ${ids.b} AND status NOT IN ('pending_payment', 'expired')`
  assert.equal(rowsOf(every).length, own.n, 'only its own orders')
  // Asked for the first group's venue by name: it isn't theirs.
  const asked = await as(B.owner, ids.b).post('/api/reports/preview', { spec: { ...spec, filters: [{ field: 'venue', op: 'in', value: [V] }] } })
  assert.equal(asked.status, 404)
})

// Sales from other tills, phase 4 (docs/SALES_IMPORT.md 3.5, 6): the
// readers. Against the stand-in Loyverse (support/fake-loyverse.mjs, synced
// by the cash fixture, with its item mapping rules) and our own till's two
// trading days (support/tillDays.mjs) at the same venue:
//   - dayFiguresFromStored() gives what summing the receipts live gave
//     (the old summariseReceipts(), kept below as the reference);
//   - Cash Recon's Loyverse fill reads the stored receipts (no /receipts
//     call), equals the live figures, refuses a day that hasn't synced and
//     fills a covered day with no sales;
//   - the "Sales, every till" subjects add our till and Loyverse with the
//     right source, mapped parts adding up to the receipt, unmapped lines by
//     name, refunds counted apart, and the mapping coverage figure;
//   - Today's glance and Pepper's till_day read the stored sales;
//   - another tenant and the permissions.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { makeReceipts, ITEMS, sharedFakeLoyverse } from './support/fake-loyverse.mjs'

const { as, getApp, sql, ok, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { fillTenant } = await import('./support/fixtures.mjs')
const { sellTwoDays } = await import('./support/tillDays.mjs')
const { runner, rowsOf, totalsRow, p, measures } = await import('./support/reports.mjs')
const { normalise } = await import('../src/services/connectors/loyverse.js')
const { makeContext } = await import('../src/ai/context.js')
const { audienceTools, parseInput } = await import('../src/ai/tools/index.js')
const { dayFiguresFromStored, toPence } = await import('../../shared/externalSales.js')
const { businessDate } = await import('../../shared/pos/reports.js')
const { todayIn } = await import('../../shared/reports/period.js')
const { COVERAGE_DECIDED } = await import('../../shared/itemMapping.js')

// ── The live rule before phase 4 (shared/loyverse.js summariseReceipts(),
// removed): the reference the stored figures are held to. ──────────────
function summariseReceipts(receipts, itemCategory = null) {
  const day = {
    sales: 0, refund_receipts: 0, gross_sales: 0, net_sales: 0, refunds: 0, discounts: 0, taxes: 0,
    tips: 0, surcharges: 0, total_collected: 0, items: {}, categories: {}, payment_types: {},
  }
  for (const r of receipts || []) {
    if (r.cancelled_at) continue
    const refund = r.receipt_type === 'REFUND'
    if (refund) day.refund_receipts++
    else day.sales++
    const sign = refund ? -1 : 1
    const amt = v => sign * Math.abs(toPence(v))
    day.discounts += amt(r.total_discount)
    day.taxes += amt(r.total_tax)
    day.tips += amt(r.tip)
    day.surcharges += amt(r.surcharge)
    day.total_collected += amt(r.total_money)
    for (const l of r.line_items || []) {
      const gross = Math.abs(toPence(l.gross_total_money))
      if (refund) day.refunds += gross
      else day.gross_sales += gross
      const after = l.total_money != null ? Math.abs(toPence(l.total_money)) : Math.max(0, gross - Math.abs(toPence(l.total_discount)))
      if (l.item_id) {
        const it = day.items[l.item_id] || (day.items[l.item_id] = { name: l.item_name || '', amount: 0 })
        it.amount += sign * after
        if (itemCategory) {
          const cat = itemCategory[l.item_id]
          if (cat) day.categories[cat] = (day.categories[cat] || 0) + sign * after
        }
      }
    }
    for (const pay of r.payments || []) {
      if (!pay.payment_type_id) continue
      const pt = day.payment_types[pay.payment_type_id] || (day.payment_types[pay.payment_type_id] = { name: pay.name || '', amount: 0 })
      pt.amount += amt(pay.money_amount)
    }
  }
  day.net_sales = day.gross_sales - day.refunds - day.discounts
  return day
}

/** A receipt as stored: normalise() and the cancelled flag saveSale() keeps. */
function stored(r) {
  const n = normalise({ external_id: String(r.receipt_number), payload: r }, { timezone: 'Europe/London', day_starts_at: '04:00' })
  return { ...n.check, cancelled: !!n.check.cancelled_at, lines: n.lines, payments: n.payments }
}

const CATEGORIES = Object.fromEntries(ITEMS.map(i => [i.id, i.category_id]))
const quiet = { info() {}, warn() {}, error() {}, debug() {} }
const LONDON = 'Europe/London'

let ids, owner, viewer, other, V, filled, fake, run, dates, tz

const period = (from, to) => ({ field: 'date', op: 'in_period', value: { from, to } })
const here = () => ({ field: 'venue', op: 'in', value: [V] })
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }

async function tillDay(input) {
  const app = await getApp()
  const sub = A.owner
  const ctx = makeContext({
    app, channel: 'staff_chat', tenantId: ids.a, log: quiet,
    auth: { authorization: 'Bearer test:' + sub }, principal: { sub, email: sub + '@test.local' }, actor: sub + '@test.local',
  })
  const t = audienceTools('staff').find(x => x.name === 'till_day')
  return t.run(ctx, parseInput(t, input))
}

before(async () => {
  ids = await resetAndSeed()
  filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  const b = await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc' })
  assert.deepEqual(b.failed, [], 'fixtures of the other tenant')
  owner = as(A.owner, ids.a)
  viewer = as(A.viewer, ids.a)
  other = as(B.owner, ids.b)
  V = filled.ids.venue
  await sellTwoDays({ owner, tenantId: ids.a, filled })
  fake = await sharedFakeLoyverse()
  run = runner(ids.a)
  ;[{ timezone: tz }] = await sql`SELECT timezone FROM venues WHERE id = ${V}`
  // The stand-in's recent days (its month-old receipt is the history's).
  dates = (await sql`SELECT DISTINCT business_date::text AS d FROM ext_checks WHERE venue_id = ${V} AND business_date > current_date - 10 ORDER BY 1`).map(r => r.d)
  assert.ok(dates.length >= 2, 'the stand-in\'s receipts are stored on several days')
})
after(closeApp)

// ── 47.4a: Cash Recon from stored checks ─────────────────────────────────

test('the stored figure rule gives what the receipts gave live, refunds, cancellations and categories too', () => {
  const now = Date.parse('2026-11-20T15:00:00Z')
  const receipts = makeReceipts(now).filter(r => r.store_id === 'st1')
  receipts.find(r => r.receipt_number === '1-1004').cancelled_at = new Date(now).toISOString()
  for (const cats of [null, CATEGORIES]) {
    assert.deepEqual(dayFiguresFromStored(receipts.map(stored), cats), summariseReceipts(receipts, cats))
  }
  // Day by day, as the fill groups them.
  const byDay = new Map()
  for (const r of receipts) {
    const d = businessDate(r.receipt_date || r.created_at, LONDON, '04:00')
    byDay.set(d, [...(byDay.get(d) || []), r])
  }
  assert.ok(byDay.size >= 2)
  for (const [d, list] of byDay) assert.deepEqual(dayFiguresFromStored(list.map(stored), CATEGORIES), summariseReceipts(list, CATEGORIES), d)
  const all = dayFiguresFromStored(receipts.map(stored))
  assert.equal(all.refund_receipts, 1)
  assert.ok(all.refunds > 0 && all.net_sales === all.gross_sales - all.refunds - all.discounts)
})

test('the fill window reads the stored receipts, never Loyverse, and equals the live figures', async () => {
  const receiptsCalls = () => fake.calls.filter(c => c.path === '/receipts').length
  const before = receiptsCalls()
  const res = await ok(owner.post(`/api/loyverse/venues/${V}/preview`, { from: dates[0], to: dates[dates.length - 1] }))
  assert.equal(receiptsCalls(), before, 'no live read of Loyverse')
  const [link] = await sql`SELECT day_starts_at FROM pos_connection_venues WHERE venue_id = ${V}`
  const live = new Map()
  for (const r of fake.receipts.filter(r => r.store_id === 'st1')) {
    const d = businessDate(r.receipt_date || r.created_at, tz, link.day_starts_at)
    live.set(d, [...(live.get(d) || []), r])
  }
  const pounds = v => Math.round(v) / 100
  for (const date of dates) {
    const want = summariseReceipts(live.get(date) || [])
    const day = res.days.find(d => d.date === date)
    assert.equal(day.synced, true, date)
    assert.equal(day.sales, want.sales, date)
    assert.equal(day.refund_receipts, want.refund_receipts, date)
    for (const k of ['gross_sales', 'refunds', 'discounts', 'net_sales', 'taxes', 'tips', 'surcharges', 'total_collected']) {
      assert.equal(day.totals[k], pounds(want[k]), date + ' ' + k)
    }
    for (const [id, pt] of Object.entries(want.payment_types)) assert.equal(day.payments.find(x => x.id === id)?.amount, pounds(pt.amount), date + ' ' + pt.name)
  }
  assert.ok(res.synced_to, 'the sync mark is shown')
})

test('a mapped field fills from the stored receipts; a day not synced yet is refused, not filled with zeros', async () => {
  const C = `/api/venues/${V}/cash-recon`
  const inc = await ok(owner.post(C + '/config/income-sources', { name: 'Zqx Loyverse sales', type: 'pos', vat_rate: 20, vat_inclusive: true }))
  const chan = await ok(owner.post(C + '/config/payment-channels', { name: 'Zqx Loyverse card', type: 'card' }))
  await ok(owner.put(`/api/loyverse/venues/${V}/mappings`, { mappings: {
    income: { [inc.id]: [{ sign: 1, kind: 'net_sales' }] },
    takings: { [chan.id]: [{ sign: 1, kind: 'payment_type', ref: 'pt-card', label: 'Card' }] },
    sc: {},
  } }))
  const date = dates.find(d => d !== dates[0]) || dates[0]
  const preview = await ok(owner.post(`/api/loyverse/venues/${V}/preview`, { from: date, to: date }))
  const want = preview.days[0]
  const applied = await ok(owner.post(`/api/loyverse/venues/${V}/apply`, { dates: [date] }))
  assert.deepEqual(applied.filled, [date])
  const [row] = await sql`
    SELECT SUM(i.gross_amount)::float8 AS amount FROM cash_income_entries i JOIN cash_daily_reports r ON r.id = i.report_id
     WHERE r.venue_id = ${V} AND r.report_date = ${date} AND i.source_id = ${inc.id}`
  assert.equal(row.amount, want.totals.net_sales)

  // Tomorrow (venue time): nothing stored, the sync hasn't passed its end.
  const tomorrow = addDays(todayIn(tz), 1)
  const ahead = await ok(owner.post(`/api/loyverse/venues/${V}/preview`, { from: tomorrow, to: tomorrow }))
  assert.equal(ahead.days[0].synced, false)
  const refused = await owner.post(`/api/loyverse/venues/${V}/apply`, { dates: [tomorrow] })
  assert.equal(refused.status, 422, refused.body)
  assert.match(refused.json?.error, /hasn't synced this day yet/)
  const [none] = await sql`SELECT count(*)::int AS n FROM cash_daily_reports WHERE venue_id = ${V} AND report_date = ${tomorrow}`
  assert.equal(none.n, 0, 'no zeros written')
  // With another day, it is skipped and the other filled.
  const both = await ok(owner.post(`/api/loyverse/venues/${V}/apply`, { dates: [date, tomorrow] }))
  assert.deepEqual(both.filled, [date])
  assert.deepEqual(both.skipped, [{ date: tomorrow, reason: 'not_synced' }])

  // A quiet day the sync has passed (history done) is covered: it fills (zeros are real).
  const quietDay = addDays(dates[0], -3)
  const q = await ok(owner.post(`/api/loyverse/venues/${V}/preview`, { from: quietDay, to: quietDay }))
  assert.equal(q.days[0].synced, true)
  assert.equal(q.days[0].sales, 0)

  // Sync now from the fill window: Cash Recon use, marks the connection.
  const s = await ok(owner.post(`/api/loyverse/venues/${V}/sync`, {}))
  assert.equal(s.ok, true)
  const [conn] = await sql`SELECT sync_requested_at FROM pos_connections WHERE id = ${s.connection_id}`
  assert.ok(conn.sync_requested_at)
  assert.equal((await viewer.post(`/api/loyverse/venues/${V}/sync`, {})).status, 403, 'view only can\'t ask for a sync')
})

test('a late receipt fills the day again from what is stored, without asking Loyverse', async () => {
  const date = dates[dates.length - 1]
  const [c] = await sql`SELECT id, total_pence FROM ext_checks WHERE venue_id = ${V} AND business_date = ${date} AND kind = 'sale' AND NOT cancelled LIMIT 1`
  const first = await ok(owner.post(`/api/loyverse/venues/${V}/preview`, { from: date, to: date }))
  // A receipt that came in late, as a sync would store it (a copy of one with a new number).
  const [made] = await sql`
    INSERT INTO ext_checks (tenant_id, connection_id, venue_id, external_id, number, kind, business_date, gross_pence, discount_pence, total_pence)
    SELECT tenant_id, connection_id, venue_id, external_id || '-late', number, kind, business_date, gross_pence, discount_pence, total_pence
      FROM ext_checks WHERE id = ${c.id} RETURNING id`
  await sql`
    INSERT INTO ext_check_lines (tenant_id, check_id, line_no, line_kind, item_ref, name, qty, gross_pence, discount_pence, net_pence)
    SELECT tenant_id, ${made.id}, line_no, line_kind, item_ref, name, qty, gross_pence, discount_pence, net_pence
      FROM ext_check_lines WHERE check_id = ${c.id} AND line_kind = 'item'`
  const calls = fake.calls.filter(x => x.path === '/receipts').length
  const again = await ok(owner.post(`/api/loyverse/venues/${V}/preview`, { from: date, to: date }))
  assert.equal(fake.calls.filter(x => x.path === '/receipts').length, calls)
  assert.equal(again.days[0].sales, first.days[0].sales + 1)
  assert.equal(p(again.days[0].totals.total_collected), p(first.days[0].totals.total_collected) + c.total_pence)
  await sql`DELETE FROM ext_checks WHERE id = ${made.id}`
})

// ── 47.4b: the "every till" subjects ─────────────────────────────────────

const FROM = () => addDays(todayIn(tz), -45)
const TO = () => addDays(todayIn(tz), 1)
const bySource = rows => Object.fromEntries(rows.map(r => [r.source, r]))
const only = res => rowsOf(res)[0]

test('checks: our till and Loyverse each with its source; our till\'s figures equal till.checks', async () => {
  const filters = [period(FROM(), TO()), here()]
  const ms = ['checks', 'gross_sales', 'discounts', 'net_sales', 'total_sales', 'tips_total', 'refunds', 'refunded']
  const res = await run({ subject: 'sales.checks', rows: [{ field: 'source' }], values: measures(ms), filters })
  const rows = bySource(rowsOf(res))
  assert.deepEqual(Object.keys(rows).sort(), ['loyverse', 'macaroonie'])
  const ours = only(await run({ subject: 'till.checks', values: measures(['checks', 'gross_sales', 'discounts', 'net_sales', 'total_sales']), filters }))
  for (const k of ['checks', 'gross_sales', 'discounts', 'net_sales', 'total_sales']) assert.equal(rows.macaroonie[k], ours[k], 'our till: ' + k)
  assert.equal(rows.macaroonie.refunds ?? 0, 0)

  const [lv] = await sql`
    SELECT count(*) FILTER (WHERE kind = 'sale' AND NOT cancelled)::int AS checks,
           COALESCE(sum(gross_pence - discount_pence) FILTER (WHERE kind = 'sale' AND NOT cancelled), 0)::int AS net,
           COALESCE(sum(tip_pence) FILTER (WHERE kind = 'sale' AND NOT cancelled), 0)::int AS tips,
           count(*) FILTER (WHERE kind = 'refund' AND NOT cancelled)::int AS refunds,
           COALESCE(sum(abs(total_pence)) FILTER (WHERE kind = 'refund' AND NOT cancelled), 0)::int AS refunded
      FROM ext_checks WHERE venue_id = ${V}`
  assert.equal(rows.loyverse.checks, lv.checks)
  assert.equal(p(rows.loyverse.net_sales), lv.net)
  assert.equal(p(rows.loyverse.tips_total), lv.tips)
  assert.equal(rows.loyverse.refunds, lv.refunds)
  assert.ok(lv.refunds >= 1, 'the stand-in\'s refund')
  assert.equal(p(rows.loyverse.refunded), lv.refunded)
  // The total is the two together.
  assert.equal(p(totalsRow(res).net_sales), p(rows.macaroonie.net_sales) + lv.net)
})

test('dishes: mapped parts add up to the receipt, unmapped lines by name, refunds apart, our till as till.lines', async () => {
  const filters = [period(FROM(), TO()), here()]
  const res = await run({ subject: 'sales.dishes', rows: [{ field: 'source' }], values: measures(['qty_sold', 'net_sales', 'refunded']), filters })
  const rows = bySource(rowsOf(res))
  const ours = only(await run({ subject: 'till.lines', values: measures(['qty_sold', 'net_sales']), filters }))
  assert.equal(rows.macaroonie.net_sales, ours.net_sales)
  assert.equal(rows.macaroonie.qty_sold, ours.qty_sold)

  const [lv] = await sql`
    SELECT COALESCE(sum(l.net_pence) FILTER (WHERE c.kind = 'sale' AND NOT c.cancelled AND l.map_state IS DISTINCT FROM 'ignored'), 0)::int AS net,
           COALESCE(sum(abs(l.net_pence)) FILTER (WHERE c.kind = 'refund' AND NOT c.cancelled AND l.map_state IS DISTINCT FROM 'ignored'), 0)::int AS refunded
      FROM ext_check_lines l JOIN ext_checks c ON c.id = l.check_id
     WHERE c.venue_id = ${V} AND l.line_kind = 'item'`
  assert.equal(p(rows.loyverse.net_sales), lv.net, 'every item line\'s net, once')
  assert.equal(p(rows.loyverse.refunded), lv.refunded)

  // The parts of each mapped line add up to it.
  const parts = await sql`
    SELECT l.net_pence, sum(x.net_pence)::int AS parts FROM ext_line_parts x JOIN ext_check_lines l ON l.id = x.line_id
      JOIN ext_checks c ON c.id = l.check_id WHERE c.venue_id = ${V} GROUP BY l.id, l.net_pence`
  assert.ok(parts.length > 0, 'the fixture\'s rule mapped the coffee')
  for (const r of parts) assert.equal(r.parts, r.net_pence)

  // By dish: the coffee as our dish, the croissant (no rule) by its name as sold.
  const [dish] = await sql`SELECT mi.name FROM ext_map_rules r JOIN menu_items mi ON mi.id = r.target_item_id WHERE r.item_ref = 'it-coffee' AND r.venue_id = ${V}`
  const names = rowsOf(await run({ subject: 'sales.dishes', rows: [{ field: 'name' }], values: measures(['net_sales']),
    filters: [...filters, { field: 'source', op: 'in', value: ['loyverse'] }] })).map(r => r.name)
  assert.ok(names.includes(dish.name), names.join(', '))
  assert.ok(names.includes('Croissant'), names.join(', '))
  assert.ok(!names.includes('Flat white · Large / Oat'), 'a mapped line shows as our dish')
})

test('mapping coverage: mapped, kept and bucket value over the item value, ignored left out', async () => {
  const filters = [period(FROM(), TO()), here()]
  const t = only(await run({ subject: 'sales.dishes', values: measures(['mapping_coverage', 'mapped_value', 'other_till_sales']), filters }))
  const [lv] = await sql`
    SELECT COALESCE(sum(l.net_pence) FILTER (WHERE l.map_state = ANY(${COVERAGE_DECIDED})), 0)::int AS decided,
           COALESCE(sum(l.net_pence) FILTER (WHERE l.map_state IS DISTINCT FROM 'ignored'), 0)::int AS base
      FROM ext_check_lines l JOIN ext_checks c ON c.id = l.check_id
     WHERE c.venue_id = ${V} AND l.line_kind = 'item' AND c.kind = 'sale' AND NOT c.cancelled`
  assert.equal(p(t.mapped_value), lv.decided)
  assert.equal(p(t.other_till_sales), lv.base)
  assert.ok(lv.decided > 0 && lv.decided < lv.base, 'some mapped, some not')
  assert.ok(Math.abs(Number(t.mapping_coverage) - lv.decided / lv.base) < 0.0005)
  // The Item mapping page's own figure, over its 30 days, agrees with the subject's over the same days.
  const page = await ok(owner.get(`/api/integrations/mapping/${filled.ids.posConnection || (await sql`SELECT connection_id FROM pos_connection_venues WHERE venue_id = ${V}`)[0].connection_id}/coverage?venue_id=${V}`))
  const t30 = only(await run({ subject: 'sales.dishes', values: measures(['mapping_coverage']), filters: [period(addDays(todayIn('UTC'), -30), todayIn('UTC')), here()] }))
  const pagePercent = page.all?.percent ?? page.coverage?.all?.percent
  if (pagePercent != null) assert.ok(Math.abs(Number(t30.mapping_coverage) * 100 - pagePercent) < 0.06, t30.mapping_coverage + ' vs ' + pagePercent)
})

test('the every-till starters: by till, by day, our dishes from the mapping, sections, payments and the items still to map', async () => {
  const { STARTERS } = await import('../src/reports/starters/index.js')
  const get = key => {
    const s = STARTERS.find(x => x.key === key)
    assert.ok(s, key + ' is a starter')
    return s
  }
  const given = { period: { from: FROM(), to: TO() }, venues: [V] }
  // By till: our till and Loyverse, adding up to the two together (the subject's own figures, as above).
  const byTill = await run(get('till_every_sales_by_till').spec, given)
  const tills = bySource(rowsOf(byTill))
  assert.deepEqual(Object.keys(tills).sort(), ['loyverse', 'macaroonie'])
  const same = bySource(rowsOf(await run({ subject: 'sales.checks', rows: [{ field: 'source' }], values: measures(['net_sales']), filters: [period(FROM(), TO()), here()] })))
  for (const k of ['loyverse', 'macaroonie']) assert.equal(tills[k].net_sales, same[k].net_sales, k)
  // By day: every day the stand-in sold on is a row.
  const byDay = rowsOf(await run(get('till_every_sales_by_day').spec, given)).map(r => r.date)
  for (const d of dates) assert.ok(byDay.includes(d), d + ' in ' + byDay.join(', '))
  // Dishes: the mapped coffee as our dish, the croissant (no rule) by its name as sold.
  const [dish] = await sql`SELECT mi.name FROM ext_map_rules r JOIN menu_items mi ON mi.id = r.target_item_id WHERE r.item_ref = 'it-coffee' AND r.venue_id = ${V}`
  const names = rowsOf(await run(get('till_every_dishes_sold').spec, given)).map(r => r.name)
  assert.ok(names.includes(dish.name) && names.includes('Croissant'), names.join(', '))
  assert.ok(rowsOf(await run(get('till_every_sales_by_section').spec, given)).length >= 1)
  const tenders = rowsOf(await run(get('till_every_payments_by_tender').spec, given))
  assert.ok(tenders.length >= 1 && tenders.every(t => t.tender), JSON.stringify(tenders))
  // Items still to map: the croissant, never the mapped coffee.
  const toMap = rowsOf(await run(get('till_items_to_map').spec, given)).map(r => r.sold_as)
  assert.ok(toMap.includes('Croissant'), toMap.join(', '))
  assert.ok(!toMap.some(n => /flat white/i.test(n || '')), 'the mapped coffee is placed: ' + toMap.join(', '))
})

test('payments: our till as till.payments; Loyverse tips sit on the biggest payment and takings add up', async () => {
  const filters = [period(FROM(), TO()), here()]
  const ms = ['payments', 'taken', 'tips', 'refunded', 'takings']
  const rows = bySource(rowsOf(await run({ subject: 'sales.tenders', rows: [{ field: 'source' }], values: measures(ms), filters })))
  const ours = only(await run({ subject: 'till.payments', values: measures(ms), filters }))
  for (const k of ms) assert.equal(rows.macaroonie[k], ours[k], 'our till: ' + k)
  const [lv] = await sql`
    SELECT COALESCE(sum(x.amount_pence) FILTER (WHERE c.kind = 'sale' AND NOT c.cancelled), 0)::int AS paid,
           COALESCE(sum(abs(x.amount_pence)) FILTER (WHERE c.kind = 'refund' AND NOT c.cancelled), 0)::int AS refunded,
           (SELECT COALESCE(sum(tip_pence), 0)::int FROM ext_checks WHERE venue_id = ${V} AND kind = 'sale' AND NOT cancelled
               AND EXISTS (SELECT 1 FROM ext_check_payments y WHERE y.check_id = ext_checks.id)) AS tips
      FROM ext_check_payments x JOIN ext_checks c ON c.id = x.check_id WHERE c.venue_id = ${V}`
  assert.equal(p(rows.loyverse.tips), lv.tips)
  assert.ok(lv.tips > 0, 'the stand-in\'s tip')
  assert.equal(p(rows.loyverse.taken) + p(rows.loyverse.tips), lv.paid)
  assert.equal(p(rows.loyverse.refunded), lv.refunded)
  assert.equal(p(rows.loyverse.takings), lv.paid - lv.refunded)
})

test('the subjects need the till reports module, and another tenant sees none of these rows', async () => {
  const levels = { pos_reports: 'none', venues: 'view' }
  await assert.rejects(run({ subject: 'sales.checks', values: measures(['checks']) }, undefined, { levels }))
  const theirs = runner(ids.b)
  const res = await theirs({ subject: 'sales.dishes', values: measures(['net_sales']), filters: [period(FROM(), TO()), { field: 'venue', op: 'in', value: [V] }] }).catch(e => e)
  if (!(res instanceof Error)) assert.ok(!Number(only(res)?.net_sales), 'nothing of tenant A')
  assert.ok([403, 404].includes((await other.get(`/api/integrations/venues/${V}/day?date=${dates[0]}`)).status))
})

// ── 47.4c: Today and Pepper ──────────────────────────────────────────────

test('the stored day route, Today\'s glance and till_day for a Loyverse day', async () => {
  const date = dates[dates.length - 1]
  const day = await ok(owner.get(`/api/integrations/venues/${V}/day?date=${date}`))
  assert.equal(day.linked, true)
  assert.equal(day.label, 'Loyverse')
  assert.equal(day.synced, true)
  const preview = await ok(owner.post(`/api/loyverse/venues/${V}/preview`, { from: date, to: date }))
  assert.equal(day.figures.net_sales, p(preview.days[0].totals.net_sales), 'the same figures as the fill')
  assert.ok(day.payments.length && day.items.length)
  // Till reports view: an operator has it, a viewer doesn't (and their Today shows no sales).
  assert.equal((await as(A.operator, ids.a).get(`/api/integrations/venues/${V}/day?date=${date}`)).status, 200)
  assert.equal((await viewer.get(`/api/integrations/venues/${V}/day?date=${date}`)).status, 403)
  assert.equal((await ok(viewer.get(`/api/ops/today?venue_id=${V}&date=${date}`))).summary.sales, undefined)

  // Today on that day: the glance's sales by till.
  const feed = await ok(owner.get(`/api/ops/today?venue_id=${V}&date=${date}`))
  const lv = feed.summary.sales.sources.find(s => s.key === 'loyverse')
  assert.equal(lv.label, 'Loyverse')
  assert.equal(lv.net_pence, day.figures.net_sales)
  assert.equal(feed.summary.sales.total_pence, feed.summary.sales.sources.reduce((n, s) => n + s.net_pence, 0))

  // till_day: our till has no day on that date, so Loyverse answers, named.
  const td = await tillDay({ venue: V, date })
  assert.match(td.source, /^Loyverse \(stored sales/)
  assert.ok(td.sales.net && td.takings.length)
  // Our till's own day: its figures, with Loyverse's beside them.
  const ours = await tillDay({ venue: V })
  assert.ok(ours.state, 'our till\'s day')
  assert.match(ours.other_till.source, /^Loyverse/)
})

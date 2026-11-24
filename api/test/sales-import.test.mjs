// Sales from other tills, phase 1 (docs/SALES_IMPORT.md, migrations 288 to
// 290), against a stand-in Loyverse (support/fake-loyverse.mjs): connecting
// registers a webhook; linking a venue starts its history import, which pages
// and resumes; the catch-up picks up a changed receipt; the webhook only
// queues a sync (a bad token is refused, its body never read); money in pence
// is what Loyverse sent; modifiers sit under their item; a refund links to
// its sale; a cancellation is flagged; no customer name, email or phone is
// stored anywhere; another tenant's connection is refused; the Integrations
// routes' permissions.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startFakeLoyverse, TOKEN } from './support/fake-loyverse.mjs'

const fake = await startFakeLoyverse()
const { as, getApp, sql, ok, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { env } = await import('../src/config/env.js')
const { timing } = await import('../src/services/connectors/loyverse.js')
const svc = await import('../src/services/salesImportSvc.js')
const { businessDate } = await import('../../shared/pos/reports.js')

env.LOYVERSE_API_URL = fake.url
timing.paceMs = 0
timing.backoffMs = 1

let ids, owner, operator, viewer, other, V, BV, conn, hookUrl

const check = async n => (await sql`SELECT * FROM ext_checks WHERE connection_id = ${conn.id} AND external_id = ${n}`)[0]
const integrations = c => ok(c.get('/api/integrations/connections')).then(r => r.connections)

before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  viewer = as(A.viewer, ids.a)
  operator = as(A.operator, ids.a)
  other = as(B.owner, ids.b)
  V  = (await ok(owner.post('/api/venues', { name: 'Zqx Ware', slug: 'zqx-ware-si', timezone: 'Europe/London' }))).id
  BV = (await ok(other.post('/api/venues', { name: 'Wvb Ware', slug: 'wvb-ware-si', timezone: 'Europe/London' }))).id
})
after(async () => { await closeApp(); await fake.close() })

test('connecting: token sealed and never returned, a webhook registered with Loyverse', async () => {
  const made = await ok(owner.post('/api/loyverse/connections', { name: 'Zqx Coffee', access_token: TOKEN }))
  conn = made
  assert.equal(JSON.stringify(made).includes(TOKEN), false)
  assert.equal(made.webhook.registered, true)
  assert.match(made.webhook.url, /\/webhooks\/loyverse\/[A-Za-z0-9_-]{30,}$/)
  hookUrl = made.webhook.url
  assert.equal(fake.webhooks.length, 1)
  assert.equal(fake.webhooks[0].type, 'receipts.update')
  assert.equal(fake.webhooks[0].url, hookUrl)
  const [row] = await sql`SELECT system, status, webhook_token_hash, webhook_id FROM pos_connections WHERE id = ${conn.id}`
  assert.equal(row.system, 'loyverse')
  assert.equal(row.webhook_id, 'wh-1')
  assert.equal(row.webhook_token_hash.length, 64)
  assert.equal(hookUrl.includes(row.webhook_token_hash), false, 'only the hash is stored')
})

test('linking a venue starts its 13-month history; the import pages, survives a 429 and resumes', async () => {
  await ok(owner.put(`/api/loyverse/venues/${V}/link`, { connection_id: conn.id, store_id: 'st1', day_starts_at: '04:00' }))
  let [c] = (await integrations(owner))
  assert.equal(c.venues.length, 1)
  assert.equal(c.venues[0].history.started, true)
  assert.equal(c.venues[0].history.progress, 0)
  const [link] = await sql`SELECT history_from, history_to FROM pos_connection_venues WHERE venue_id = ${V}`
  const months = (link.history_to - link.history_from) / (30.44 * 86400_000)
  assert.ok(months > 12.9 && months < 13.1, '13 months back: ' + months)

  // One history page, then stop: the catch-up has the recent receipts, the history isn't done.
  fake.limitNext(2)
  const first = await svc.syncConnection(ids.a, conn.id, { historyPages: 1 })
  assert.equal(first.error, undefined, first.error)
  assert.equal(first.more, true)
  assert.ok(first.catalog > 0)
  let [v] = await sql`SELECT history_next_from, history_cursor, history_done_at, history_count FROM pos_connection_venues WHERE venue_id = ${V}`
  assert.equal(v.history_done_at, null)
  assert.ok(v.history_next_from > link.history_from, 'moved on a window')
  assert.ok(await check('1-1001'), 'the catch-up stored a recent sale')
  assert.equal(await check('1-0900'), undefined, 'the month-old sale waits for the history')

  // A second run finishes it (several receipt pages: PAGE is 3).
  const second = await svc.syncConnection(ids.a, conn.id)
  assert.equal(second.error, undefined, second.error)
  assert.equal(second.more, false)
  ;[v] = await sql`SELECT history_done_at, history_count, history_cursor FROM pos_connection_venues WHERE venue_id = ${V}`
  assert.ok(v.history_done_at)
  assert.equal(v.history_cursor, null)
  assert.ok(await check('1-0900'), 'the month-old sale is in')
  const pages = fake.calls.filter(x => x.path === '/receipts' && x.query.cursor)
  assert.ok(pages.length >= 1, 'read a second page by cursor')
  assert.ok(fake.calls.some(x => x.path === '/receipts' && x.query.created_at_min && x.query.store_id === 'st1'), 'history by created time and store')

  ;[c] = await integrations(owner)
  assert.equal(c.venues[0].history.progress, 1)
  assert.equal(c.venues[0].checks, 6, 'the six st1 receipts')
  assert.equal(c.late, false)
  assert.equal(c.catalog.variant, 3)
  assert.equal(c.catalog.modifier_option, 2)
  assert.equal(c.catalog.dining_option, undefined, 'a list Loyverse doesn\'t have is skipped')

  // Stored once each: running again changes nothing.
  const n = (await sql`SELECT count(*)::int AS n FROM ext_checks WHERE connection_id = ${conn.id}`)[0].n
  await svc.syncConnection(ids.a, conn.id)
  assert.equal((await sql`SELECT count(*)::int AS n FROM ext_checks WHERE connection_id = ${conn.id}`)[0].n, n)
})

test('money in pence as Loyverse sent it; modifiers under their item; taxes, discounts, tips, payments', async () => {
  const c = await check('1-1001')
  assert.deepEqual(
    { kind: c.kind, gross: c.gross_pence, discount: c.discount_pence, tax: c.tax_pence, tip: c.tip_pence, total: c.total_pence, charge: c.charge_pence, customer: c.customer_ref, type: c.order_type },
    { kind: 'sale', gross: 740, discount: 74, tax: 111, tip: 100, total: 666, charge: 0, customer: 'cust-77', type: 'Eat in' })
  const lines = await sql`SELECT * FROM ext_check_lines WHERE check_id = ${c.id} ORDER BY line_no`
  assert.equal(lines.length, 2)
  const [item, mod] = lines
  assert.deepEqual(
    { kind: item.line_kind, name: item.name, variant: item.variant_name, qty: Number(item.qty), unit: item.unit_price_pence, gross: item.gross_pence, disc: item.discount_pence, tax: item.tax_pence, net: item.net_pence, cost: item.cost_pence, sku: item.sku, ref: item.variant_ref, note: item.note },
    { kind: 'item', name: 'Flat white', variant: 'Large / Oat', qty: 2, unit: 320, gross: 740, disc: 74, tax: 111, net: 666, cost: 120, sku: 'FW-L-O', ref: 'var-lrg-oat', note: 'extra hot' })
  assert.deepEqual(
    { kind: mod.line_kind, parent: mod.parent_line_id, name: mod.name, group: mod.group_name, option: mod.option_ref, unit: mod.unit_price_pence, net: mod.net_pence },
    { kind: 'modifier', parent: item.id, name: 'Extra shot', group: 'Extras', option: 'opt-shot', unit: 50, net: 100 })
  assert.equal(item.item_id, null, 'mapping is phase 2')
  const [pay] = await sql`SELECT * FROM ext_check_payments WHERE check_id = ${c.id}`
  assert.deepEqual({ name: pay.name, amount: pay.amount_pence, brand: pay.card_brand, ref: pay.payment_type_ref }, { name: 'Card', amount: 766, brand: 'VISA', ref: 'pt-card' })
  const disc = await sql`SELECT line_id, amount_pence, percentage::float8 AS pct FROM ext_check_discounts WHERE check_id = ${c.id} ORDER BY line_id NULLS FIRST`
  assert.deepEqual(disc.map(d => [d.line_id, d.amount_pence, d.pct]), [[null, 74, 10], [item.id, 74, 10]])
  const taxes = await sql`SELECT line_id, type, amount_pence FROM ext_check_taxes WHERE check_id = ${c.id} ORDER BY line_id NULLS FIRST`
  assert.deepEqual(taxes.map(t => [t.line_id, t.type, t.amount_pence]), [[null, 'INCLUDED', 111], [item.id, 'INCLUDED', 111]])

  const added = await check('1-1002')
  assert.deepEqual({ tax: added.tax_pence, charge: added.charge_pence, total: added.total_pence }, { tax: 13, charge: 20, total: 283 })
  const [t] = await sql`SELECT type, amount_pence FROM ext_check_taxes WHERE check_id = ${added.id} AND line_id IS NULL`
  assert.deepEqual([t.type, t.amount_pence], ['ADDED', 13])
})

test('a refund links to its sale; trading day by receipt date and day start; other stores kept raw only', async () => {
  const sale = await check('1-1001')
  const refund = await check('1-1003')
  assert.equal(refund.kind, 'refund')
  assert.equal(refund.refund_for_ref, '1-1001')
  assert.equal(refund.refund_for_id, sale.id)
  assert.equal(refund.total_pence, 333)

  const late = await check('1-1005')
  const doc = fake.receipts.find(r => r.receipt_number === '1-1005')
  const [{ d }] = await sql`SELECT business_date::text AS d FROM ext_checks WHERE id = ${late.id}`
  assert.equal(d, businessDate(doc.receipt_date, 'Europe/London', '04:00'), 'placed by receipt_date')
  assert.notEqual(d, businessDate(doc.created_at, 'Europe/London', '04:00'))

  assert.equal(await check('2-2001'), undefined, 'st2 is linked to no venue')
  const [raw] = await sql`SELECT kind FROM ext_documents WHERE connection_id = ${conn.id} AND external_id = '2-2001'`
  assert.equal(raw.kind, 'sale')
})

test('the catch-up picks up a changed receipt: a cancellation is flagged', async () => {
  const before = await check('1-1004')
  assert.equal(before.cancelled, false)
  const r = fake.receipts.find(x => x.receipt_number === '1-1004')
  const now = new Date().toISOString()
  r.cancelled_at = now
  r.updated_at = now
  const out = await svc.syncConnection(ids.a, conn.id)
  assert.equal(out.error, undefined, out.error)
  const after = await check('1-1004')
  assert.equal(after.cancelled, true)
  assert.ok(after.cancelled_at)
  assert.equal(after.id, before.id, 'the same check, normalised again')
  const catchUp = fake.calls.filter(x => x.path === '/receipts' && x.query.updated_at_min).at(-1)
  assert.ok(catchUp, 'read by updated time')
})

test('the webhook: a bad token is refused; a good one only asks for a sync and never reads its body', async () => {
  const app = await getApp()
  const path = new URL(hookUrl).pathname
  const bad = await app.inject({ method: 'POST', url: '/webhooks/loyverse/' + 'x'.repeat(32), payload: {} })
  assert.equal(bad.status ?? bad.statusCode, 404)
  const wrongLength = await app.inject({ method: 'POST', url: path.slice(0, -1), payload: {} })
  assert.equal(wrongLength.statusCode, 404)

  await sql`UPDATE pos_connections SET sync_requested_at = NULL WHERE id = ${conn.id}`
  const callsBefore = fake.calls.length
  const forged = { merchant_id: 'm-1', type: 'receipts.update', receipts: [{ receipt_number: '9-9999', store_id: 'st1', total_money: 1000, line_items: [] }] }
  const good = await app.inject({ method: 'POST', url: path, payload: forged })
  assert.equal(good.statusCode, 200)
  assert.equal(fake.calls.length, callsBefore, 'nothing fetched in the request')
  assert.equal(await check('9-9999'), undefined, 'the body is never stored')
  const [row] = await sql`SELECT sync_requested_at, webhook_last_at FROM pos_connections WHERE id = ${conn.id}`
  assert.ok(row.sync_requested_at && row.webhook_last_at)
  // The sweep picks the request up and syncs.
  await sql`UPDATE pos_connections SET last_sync_at = now() - interval '1 minute' WHERE id = ${conn.id}`
  assert.equal(await svc.sweepDue(), 1)
  assert.equal(await check('9-9999'), undefined)

  // A new address replaces the old one (and its registration).
  const again = await ok(owner.post(`/api/integrations/connections/${conn.id}/webhook`, {}))
  assert.equal(again.registered, true)
  assert.equal(fake.webhooks.length, 1)
  assert.equal(fake.webhooks[0].id, 'wh-2')
  const stale = await app.inject({ method: 'POST', url: path, payload: {} })
  assert.equal(stale.statusCode, 404)
  hookUrl = again.url
})

test('no customer name, email or phone is stored anywhere, raw or normalised', async () => {
  const tables = ['ext_documents', 'ext_checks', 'ext_check_lines', 'ext_check_payments', 'ext_check_discounts', 'ext_check_taxes', 'ext_catalog']
  for (const t of tables) {
    const rows = await sql.unsafe(`SELECT row_to_json(x)::text AS j FROM "${t}" x WHERE tenant_id = $1`, [ids.a])
    assert.ok(rows.length, t + ' has rows')
    for (const r of rows) assert.doesNotMatch(r.j, /Bloggs|jo@example|sam@example|07700|BLOGGS/, t)
  }
  const [raw] = await sql`SELECT payload FROM ext_documents WHERE connection_id = ${conn.id} AND external_id = '1-1001'`
  assert.equal(raw.payload.customer_id, 'cust-77', 'the customer id is kept')
  assert.equal(raw.payload.order, undefined)
  assert.deepEqual(raw.payload.payments[0].payment_details, { card_company: 'VISA' })
})

test('Sync now queues and marks; pausing stops the sweep', async () => {
  await sql`UPDATE pos_connections SET sync_requested_at = NULL WHERE id = ${conn.id}`
  assert.deepEqual(await ok(owner.post(`/api/integrations/connections/${conn.id}/sync`, {})), { queued: true })
  const [row] = await sql`SELECT sync_requested_at FROM pos_connections WHERE id = ${conn.id}`
  assert.ok(row.sync_requested_at)
  const paused = await ok(owner.patch(`/api/integrations/connections/${conn.id}`, { status: 'paused' }))
  assert.equal(paused.connections[0].status, 'paused')
  assert.equal((await owner.post(`/api/integrations/connections/${conn.id}/sync`, {})).status, 422)
  assert.deepEqual(await svc.syncConnection(ids.a, conn.id), { skipped: 'busy or paused' })
  await ok(owner.patch(`/api/integrations/connections/${conn.id}`, { status: 'active' }))
  // Fetch history again starts it over.
  await ok(owner.post(`/api/integrations/connections/${conn.id}/venues/${V}/history`, {}))
  const [v] = await sql`SELECT history_done_at, history_count FROM pos_connection_venues WHERE venue_id = ${V}`
  assert.deepEqual([v.history_done_at, v.history_count], [null, 0])
})

test('another tenant\'s connection is refused everywhere; permissions', async () => {
  assert.deepEqual(await integrations(other), [])
  for (const [method, url, body] of [
    ['post', `/api/integrations/connections/${conn.id}/sync`, {}],
    ['post', `/api/integrations/connections/${conn.id}/webhook`, {}],
    ['patch', `/api/integrations/connections/${conn.id}`, { status: 'paused' }],
    ['post', `/api/integrations/connections/${conn.id}/venues/${BV}/history`, {}],
    ['put', `/api/loyverse/venues/${BV}/link`, { connection_id: conn.id, store_id: 'st1', day_starts_at: '00:00' }],
  ]) {
    const r = await other[method](url, body)
    assert.equal(r.status, 404, method + ' ' + url)
  }
  const mine = await other.post(`/api/integrations/connections/${conn.id}/venues/${V}/history`, {})
  assert.ok([403, 404].includes(mine.status), 'A\'s venue as B: ' + mine.status)
  const [row] = await sql`SELECT status FROM pos_connections WHERE id = ${conn.id}`
  assert.equal(row.status, 'active')

  // Cash reconciliation view reads, manage syncs; the setup (webhook, pause,
  // mapping) is owner or admin too. Viewers have no Cash reconciliation.
  assert.equal((await viewer.get('/api/integrations/connections')).status, 403)
  const seen = await integrations(operator)
  assert.equal(seen.length, 1)
  assert.equal(JSON.stringify(seen).includes(TOKEN), false)
  assert.deepEqual(await ok(operator.post(`/api/integrations/connections/${conn.id}/sync`, {})), { queued: true })
  assert.equal((await operator.post(`/api/integrations/connections/${conn.id}/webhook`, {})).status, 403)
  assert.equal((await operator.patch(`/api/integrations/connections/${conn.id}`, { status: 'paused' })).status, 403)
  assert.equal((await operator.put(`/api/loyverse/venues/${V}/mappings`, { mappings: { income: {}, takings: {}, sc: {} } })).status, 403)
  assert.equal((await viewer.post(`/api/integrations/connections/${conn.id}/sync`, {})).status, 403)
})

test('the mapping route keeps the store link, and the store link keeps the mapping', async () => {
  const cfg = await ok(owner.get(`/api/venues/${V}/cash-recon/config`))
  const income = cfg.income_sources?.[0]
  if (!income) return
  await ok(owner.put(`/api/loyverse/venues/${V}/mappings`, { mappings: { income: { [income.id]: [{ sign: 1, kind: 'net_sales' }] }, takings: {}, sc: {} } }))
  await ok(owner.put(`/api/loyverse/venues/${V}/link`, { connection_id: conn.id, store_id: 'st1', day_starts_at: '05:00' }))
  const { link } = await ok(owner.get(`/api/loyverse/venues/${V}/link`))
  assert.equal(link.day_starts_at, '05:00')
  assert.equal(link.store_id, 'st1')
  assert.deepEqual(link.mappings.income[income.id], [{ sign: 1, kind: 'net_sales' }])
})

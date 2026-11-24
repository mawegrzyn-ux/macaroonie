// Sales from other tills, phase 5: Square (docs/SALES_IMPORT.md 5,
// migration 294), against a stand-in Square (support/fake-square.mjs).
// Connecting by token (sandbox chosen per connection; token and signature
// key sealed, never returned); locations and a venue link; the catalogue
// with variations under their item and modifiers under their list; orders
// paged by cursor, history and catch-up, a 429 waited out; money exactly as
// Square sent it (already pence); modifiers under their item; a return
// linked to its order; a cancelled order flagged; no personal data stored;
// the webhook's token and Square's signature; OAuth's state refused when
// changed or for another tenant or person, ObtainToken, the refresh before
// expiry and the revoke on disconnect; mapping a variation; the every-till
// subjects with Source = Square; Cash Recon not offered for Square.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import {
  startFakeSquare, TOKEN, MERCHANT, OAUTH_MERCHANT, APP_ID, APP_SECRET, SIGNATURE_KEY,
} from './support/fake-square.mjs'

const fake = await startFakeSquare()
const { as, getApp, sql, ok, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { env } = await import('../src/config/env.js')
const square = await import('../src/services/connectors/square.js')
const svc = await import('../src/services/salesImportSvc.js')
const mapping = await import('../src/services/itemMappingSvc.js')
const { unseal, isSealed } = await import('../src/services/vault.js')
const { runner, rowsOf, measures } = await import('./support/reports.mjs')
const { businessDate } = await import('../../shared/pos/reports.js')
const { todayIn } = await import('../../shared/reports/period.js')
const { linkedSources } = await import('../src/services/reconRetrieve.js')
const { withTenant } = await import('../src/config/db.js')

square.BASE_URLS.production = fake.url
square.BASE_URLS.sandbox = fake.url + '/sandbox'
square.timing.paceMs = 0
square.timing.backoffMs = 1

let ids, owner, admin, operator, other, V, BV, conn, hookUrl

const check = async id => (await sql`SELECT * FROM ext_checks WHERE connection_id = ${conn.id} AND external_id = ${id}`)[0]
const integrations = c => ok(c.get('/api/integrations/connections')).then(r => r.connections)
const sign = (url, body, key) => createHmac('sha256', key).update(url + body).digest('base64')

before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  admin = as(A.admin, ids.a)
  operator = as(A.operator, ids.a)
  other = as(B.owner, ids.b)
  V  = (await ok(owner.post('/api/venues', { name: 'Zqx Square', slug: 'zqx-square-sq', timezone: 'Europe/London' }))).id
  BV = (await ok(other.post('/api/venues', { name: 'Wvb Square', slug: 'wvb-square-sq', timezone: 'Europe/London' }))).id
})
after(async () => {
  env.SQUARE_APPLICATION_ID = undefined
  env.SQUARE_APPLICATION_SECRET = undefined
  await closeApp(); await fake.close()
})

test('Sign in with Square is off without the two env vars', async () => {
  env.SQUARE_APPLICATION_ID = undefined
  env.SQUARE_APPLICATION_SECRET = undefined
  assert.deepEqual(await ok(owner.get('/api/square/oauth')), { available: false })
  assert.equal((await owner.post('/api/square/oauth/start', { name: 'X' })).status, 422)
})

test('connecting by token: checked with Square (sandbox), sealed, a signed webhook subscription', async () => {
  assert.equal((await owner.post('/api/square/connections', { name: 'Bad', access_token: 'not-a-real-token', environment: 'sandbox' })).status, 422)
  const made = await ok(owner.post('/api/square/connections', { name: 'Zqx Square', access_token: TOKEN, environment: 'sandbox' }))
  conn = made
  assert.equal(JSON.stringify(made).includes(TOKEN), false)
  assert.equal(made.environment, 'sandbox')
  assert.equal(made.webhook.registered, true)
  assert.equal(made.webhook.signed, true)
  assert.match(made.webhook.url, /\/webhooks\/square\/[A-Za-z0-9_-]{30,}$/)
  hookUrl = made.webhook.url
  assert.ok(fake.calls.filter(c => c.path === '/v2/merchants/me').every(c => c.env === 'sandbox'), 'the sandbox host')
  assert.ok(fake.calls.every(c => c.path.startsWith('/oauth2') || c.version === square.SQUARE_VERSION))
  const [sub] = fake.subscriptions
  assert.deepEqual(sub.event_types, ['order.created', 'order.updated', 'catalog.version.updated'])
  assert.equal(sub.notification_url, hookUrl)
  const [row] = await sql`SELECT system, environment, auth_kind, merchant_id, access_token, webhook_signature_key, webhook_signature_hint FROM pos_connections WHERE id = ${conn.id}`
  assert.deepEqual([row.system, row.environment, row.auth_kind, row.merchant_id], ['square', 'sandbox', 'token', MERCHANT])
  assert.ok(isSealed(row.access_token) || row.access_token !== TOKEN || !process.env.SECRETS_KEY)
  assert.equal(unseal(row.webhook_signature_key), sub.signature_key)
  assert.equal(row.webhook_signature_hint, sub.signature_key.slice(-4))
  const listed = await integrations(owner)
  assert.equal(JSON.stringify(listed).includes(sub.signature_key), false, 'the signature key is never returned')
  assert.equal(JSON.stringify(listed).includes(TOKEN), false)
  assert.equal(listed[0].system_label, 'Square')
  assert.equal(listed[0].webhook.signed, true)
  // The same merchant again by token is refused.
  assert.equal((await owner.post('/api/square/connections', { name: 'Again', access_token: TOKEN, environment: 'sandbox' })).status, 409)
})

test('locations and a venue link; another tenant\'s venue or connection refused', async () => {
  const { locations } = await ok(owner.get(`/api/integrations/connections/${conn.id}/locations`))
  assert.deepEqual(locations.map(l => l.id), ['L1', 'L2'], 'the inactive location is left out')
  assert.equal((await owner.put(`/api/integrations/connections/${conn.id}/venues/${V}`, { location_id: 'L9' })).status, 422)
  assert.equal((await owner.put(`/api/integrations/connections/${conn.id}/venues/${BV}`, { location_id: 'L1' })).status, 404)
  assert.equal((await other.put(`/api/integrations/connections/${conn.id}/venues/${BV}`, { location_id: 'L1' })).status, 404)
  assert.equal((await other.get(`/api/integrations/connections/${conn.id}/locations`)).status, 404)
  assert.equal((await operator.put(`/api/integrations/connections/${conn.id}/venues/${V}`, { location_id: 'L1' })).status, 403)
  const r = await ok(owner.put(`/api/integrations/connections/${conn.id}/venues/${V}`, { location_id: 'L1', day_starts_at: '04:00' }))
  const v = r.connections[0].venues[0]
  assert.deepEqual([v.venue_id, v.store_id, v.store_name, v.day_starts_at, v.history.started], [V, 'L1', 'Zqx High St', '04:00', true])
})

test('the sync: catalogue, history by created time and catch-up by updated time, paged, through a 429', async () => {
  fake.limitNext(2)
  const first = await svc.syncConnection(ids.a, conn.id, { historyPages: 1 })
  assert.equal(first.error, undefined, first.error)
  assert.equal(first.more, true)
  assert.ok(await check('ORD-1'), 'the catch-up stored a recent order')
  const second = await svc.syncConnection(ids.a, conn.id)
  assert.equal(second.error, undefined, second.error)
  assert.equal(second.more, false)
  for (const id of ['ORD-H0', 'ORD-H1', 'ORD-H2']) assert.ok(await check(id), id + ' from the history')
  assert.equal(await check('ORD-6'), undefined, 'an open order isn\'t read')
  const searches = fake.calls.filter(c => c.path === '/v2/orders/search')
  assert.ok(searches.every(c => c.env === 'sandbox'))
  assert.ok(searches.some(c => c.body.cursor), 'read a second page by cursor')
  assert.ok(searches.some(c => c.body.query.filter.date_time_filter.created_at && c.body.query.sort.sort_field === 'CREATED_AT'), 'history by created time')
  assert.ok(searches.some(c => c.body.query.filter.date_time_filter.updated_at && c.body.query.sort.sort_field === 'UPDATED_AT'), 'catch-up by updated time')
  assert.ok(searches.every(c => c.body.location_ids.length === 1 && c.body.location_ids[0] === 'L1'), 'only the linked location')
  assert.ok(searches.every(c => c.body.query.filter.state_filter.states.join() === 'COMPLETED,CANCELED'))

  // The catalogue: variations under their item, modifiers under their list.
  const cat = await sql`SELECT kind, external_id, parent_ref, name, sku, price_pence, category_ref, attrs FROM ext_catalog WHERE connection_id = ${conn.id} ORDER BY kind, external_id`
  const by = Object.fromEntries(cat.map(r => [r.kind + ':' + r.external_id, r]))
  assert.deepEqual(['it-bagel', 'it-latte'], cat.filter(r => r.kind === 'item').map(r => r.external_id))
  assert.deepEqual([by['variant:var-latte-lrg'].parent_ref, by['variant:var-latte-lrg'].name, by['variant:var-latte-lrg'].sku, by['variant:var-latte-lrg'].price_pence], ['it-latte', 'Large', 'LAT-L', 350])
  assert.equal(by['variant:var-latte-lrg'].attrs.stores[0].price_pence, 360)
  assert.equal(by['item:it-latte'].attrs.option1_name, 'Variation', 'named variations are one axis')
  assert.equal(by['item:it-bagel'].attrs.option1_name, null)
  assert.equal(by['item:it-latte'].category_ref, 'cat-coffee')
  assert.deepEqual(by['item:it-latte'].attrs.modifier_ids, ['ml-milk'])
  assert.deepEqual([by['modifier_option:mod-oat'].parent_ref, by['modifier_option:mod-oat'].price_pence], ['ml-milk', 40])
  assert.equal(by['modifier:ml-milk'].name, 'Milk')
  assert.deepEqual([by['tax:tax-vat'].attrs.type, by['tax:tax-vat'].attrs.rate], ['INCLUDED', 20])
  assert.equal(by['store:L1'].name, 'Zqx High St')

  // Running again stores nothing twice.
  const n = (await sql`SELECT count(*)::int AS n FROM ext_checks WHERE connection_id = ${conn.id}`)[0].n
  await svc.syncConnection(ids.a, conn.id)
  assert.equal((await sql`SELECT count(*)::int AS n FROM ext_checks WHERE connection_id = ${conn.id}`)[0].n, n)
})

test('money exactly as Square sent it (already pence); modifiers under their item; taxes, discounts, charges, tenders', async () => {
  const c = await check('ORD-1')
  assert.deepEqual(
    { kind: c.kind, number: c.number, gross: c.gross_pence, discount: c.discount_pence, tax: c.tax_pence, tip: c.tip_pence, charge: c.charge_pence, total: c.total_pence, customer: c.customer_ref, type: c.order_type, source: c.source, location: c.location_ref },
    { kind: 'sale', number: 'R-1001', gross: 780, discount: 78, tax: 117, tip: 100, charge: 50, total: 752, customer: 'cust-9', type: 'PICKUP', source: 'Square Point of Sale', location: 'L1' })
  const [{ d }] = await sql`SELECT business_date::text AS d FROM ext_checks WHERE id = ${c.id}`
  const order = fake.orders.find(o => o.id === 'ORD-1')
  assert.equal(d, businessDate(order.closed_at, 'Europe/London', '04:00'), 'trading day by the venue\'s day start')
  const lines = await sql`SELECT * FROM ext_check_lines WHERE check_id = ${c.id} ORDER BY line_no`
  assert.deepEqual(lines.map(l => l.line_kind), ['item', 'modifier', 'charge'])
  const [item, mod, charge] = lines
  assert.deepEqual(
    { item: item.item_ref, variant: item.variant_ref, name: item.name, vname: item.variant_name, sku: item.sku, qty: Number(item.qty), unit: item.unit_price_pence, gross: item.gross_pence, disc: item.discount_pence, tax: item.tax_pence, net: item.net_pence, note: item.note },
    { item: 'it-latte', variant: 'var-latte-lrg', name: 'Latte', vname: 'Large', sku: 'LAT-L', qty: 2, unit: 350, gross: 780, disc: 78, tax: 117, net: 702, note: 'extra hot' })
  assert.deepEqual(
    { parent: mod.parent_line_id, name: mod.name, group: mod.group_name, option: mod.option_ref, qty: Number(mod.qty), unit: mod.unit_price_pence, net: mod.net_pence },
    { parent: item.id, name: 'Oat milk', group: 'Milk', option: 'mod-oat', qty: 2, unit: 40, net: 80 })
  assert.deepEqual([charge.parent_line_id, charge.name, charge.net_pence], [null, 'Service', 50])
  const [pay] = await sql`SELECT * FROM ext_check_payments WHERE check_id = ${c.id}`
  assert.deepEqual({ name: pay.name, ref: pay.payment_type_ref, amount: pay.amount_pence, brand: pay.card_brand }, { name: 'Card', ref: 'CARD', amount: 852, brand: 'VISA' })
  const taxes = await sql`SELECT line_id, type, rate::float8 AS rate, amount_pence FROM ext_check_taxes WHERE check_id = ${c.id} ORDER BY line_id NULLS FIRST`
  assert.deepEqual(taxes.map(t => [t.line_id, t.type, t.rate, t.amount_pence]), [[null, 'INCLUDED', 20, 117], [item.id, 'INCLUDED', 20, 117]])
  const disc = await sql`SELECT line_id, discount_ref, amount_pence FROM ext_check_discounts WHERE check_id = ${c.id} ORDER BY line_id NULLS FIRST`
  assert.deepEqual(disc.map(x => [x.line_id, x.discount_ref, x.amount_pence]), [[null, 'disc-staff', 78], [item.id, 'disc-staff', 78]])

  const cash = await check('ORD-2')
  assert.deepEqual([cash.total_pence, cash.tax_pence, cash.gross_pence], [1999, 333, 1999], 'odd pence kept, nothing divided')
  const [cp] = await sql`SELECT name, amount_pence FROM ext_check_payments WHERE check_id = ${cash.id}`
  assert.deepEqual([cp.name, cp.amount_pence], ['Cash', 1999])
})

test('a return is a refund check linked to its order; a cancelled order is flagged; another location raw only', async () => {
  const sale = await check('ORD-1')
  const refund = await check('ORD-3')
  assert.deepEqual([refund.kind, refund.refund_for_ref, refund.refund_for_id, refund.total_pence, refund.tax_pence, refund.discount_pence, refund.gross_pence],
    ['refund', 'ORD-1', sale.id, 351, 58, 39, 390])
  const rl = await sql`SELECT line_kind, variant_ref, item_ref, net_pence FROM ext_check_lines WHERE check_id = ${refund.id} ORDER BY line_no`
  assert.deepEqual(rl.map(l => [l.line_kind, l.variant_ref, l.item_ref, l.net_pence]), [['item', 'var-latte-lrg', 'it-latte', 351], ['modifier', null, null, 40]])
  const [rp] = await sql`SELECT name, amount_pence FROM ext_check_payments WHERE check_id = ${refund.id}`
  assert.deepEqual([rp.name, rp.amount_pence], ['Refund', 351])

  const cancelled = await check('ORD-4')
  assert.equal(cancelled.cancelled, true)
  assert.ok(cancelled.cancelled_at)
  assert.equal(await check('ORD-5'), undefined, 'L2 is linked to no venue')

  // The catch-up picks up a change.
  const o = fake.orders.find(x => x.id === 'ORD-2')
  o.updated_at = new Date(Date.now() - 1000).toISOString()
  o.reference_id = 'R-CHANGED'
  const synced = await svc.syncConnection(ids.a, conn.id)
  assert.equal(synced.error ?? synced.skipped, undefined, JSON.stringify(synced))
  assert.equal((await check('ORD-2')).number, 'R-CHANGED')
})

test('no customer name, email, phone or card number is stored anywhere, raw or normalised', async () => {
  const tables = ['ext_documents', 'ext_checks', 'ext_check_lines', 'ext_check_payments', 'ext_check_discounts', 'ext_check_taxes', 'ext_catalog']
  for (const t of tables) {
    const rows = await sql.unsafe(`SELECT row_to_json(x)::text AS j FROM "${t}" x WHERE tenant_id = $1`, [ids.a])
    assert.ok(rows.length, t + ' has rows')
    for (const r of rows) assert.doesNotMatch(r.j, /Bloggs|BLOGGS|jo@example|owner@example|07700|4242|fp-1|1 High St/, t)
  }
  const [raw] = await sql`SELECT payload FROM ext_documents WHERE connection_id = ${conn.id} AND kind = 'sale' AND external_id = 'ORD-1'`
  assert.equal(raw.payload.customer_id, 'cust-9', 'the customer id is kept')
  assert.equal(raw.payload.ticket_name, undefined)
  assert.deepEqual(raw.payload.fulfillments, [{ uid: 'f1', type: 'PICKUP', state: 'COMPLETED' }])
  assert.deepEqual(raw.payload.tenders[0].card_details, { status: 'CAPTURED', entry_method: 'CONTACTLESS', card: { card_brand: 'VISA' } })
})

test('the webhook: the token, then Square\'s signature over the address and raw body; the body is never stored', async () => {
  const app = await getApp()
  const path = new URL(hookUrl).pathname
  const key = unseal((await sql`SELECT webhook_signature_key FROM pos_connections WHERE id = ${conn.id}`)[0].webhook_signature_key)
  const url = svc.webhookUrl('square', path.split('/').pop())
  assert.equal(url, hookUrl)
  const body = JSON.stringify({ merchant_id: MERCHANT, type: 'order.updated', event_id: 'ev-1',
    data: { type: 'order', id: 'ORD-FORGED', object: { order_updated: { order_id: 'ORD-FORGED', location_id: 'L1', state: 'COMPLETED' } } } })
  const post = (u, payload, sig) => app.inject({ method: 'POST', url: u, payload, headers: { 'content-type': 'application/json', ...(sig ? { 'x-square-hmacsha256-signature': sig } : {}) } })

  assert.equal((await post('/webhooks/square/' + 'x'.repeat(32), body, sign(url, body, key))).statusCode, 404, 'unknown token')
  assert.equal((await post(path, body, null)).statusCode, 404, 'no signature')
  assert.equal((await post(path, body, sign(url, body, 'wrong-key-123'))).statusCode, 404, 'wrong key')
  assert.equal((await post(path, body + ' ', sign(url, body, key))).statusCode, 404, 'body changed after signing')
  assert.equal((await post('/webhooks/loyverse/' + path.split('/').pop(), body, sign(url, body, key))).statusCode, 404, 'another system\'s address')

  await sql`UPDATE pos_connections SET sync_requested_at = NULL WHERE id = ${conn.id}`
  const before = fake.calls.length
  const good = await post(path, body, sign(url, body, key))
  assert.equal(good.statusCode, 200)
  assert.equal(fake.calls.length, before, 'nothing fetched in the request')
  const [row] = await sql`SELECT sync_requested_at, webhook_last_at FROM pos_connections WHERE id = ${conn.id}`
  assert.ok(row.sync_requested_at && row.webhook_last_at)
  assert.equal(await check('ORD-FORGED'), undefined)

  // A key pasted from Square's dashboard replaces it; cleared, the token alone is checked.
  await ok(owner.patch(`/api/square/connections/${conn.id}`, { signature_key: 'pasted-key-from-square' }))
  assert.equal((await post(path, body, sign(url, body, key))).statusCode, 404)
  assert.equal((await post(path, body, sign(url, body, 'pasted-key-from-square'))).statusCode, 200)
  await ok(owner.patch(`/api/square/connections/${conn.id}`, { signature_key: null }))
  assert.equal((await post(path, body, null)).statusCode, 200)
  assert.equal((await other.patch(`/api/square/connections/${conn.id}`, { signature_key: 'x'.repeat(10) })).status, 404)

  // A new address: the old subscription deleted, a new one with a new key.
  const again = await ok(owner.post(`/api/integrations/connections/${conn.id}/webhook`, {}))
  assert.deepEqual([again.registered, again.signed], [true, true])
  assert.equal(fake.subscriptions.length, 1)
  assert.equal(fake.subscriptions[0].id, 'sub-2')
  assert.equal((await post(path, body, null)).statusCode, 404, 'the old address is gone')
  hookUrl = again.url
})

test('mapping a variation: the Item mapping page shows Square\'s catalogue; a variant rule maps its lines', async () => {
  const view = await ok(owner.get(`/api/integrations/mapping/${conn.id}?venue_id=${V}`))
  const latte = view.items.find(i => i.ref === 'it-latte')
  assert.ok(latte, 'the latte is on the page')
  assert.deepEqual(latte.variants.map(v => v.ref).sort(), ['var-latte-lrg', 'var-latte-reg'])
  assert.deepEqual(latte.axes, ['Variation'])

  const menu = await ok(owner.post('/api/menus', { name: 'Square cafe', slug: 'square-cafe-sq' }))
  const full = await ok(owner.get(`/api/menus/${menu.id}`))
  await ok(owner.patch(`/api/menus/${menu.id}`, { ...full, sections: [{ title: 'Coffee', items: [{ name: 'Large latte', price_pence: 350, is_orderable: true }] }] }))
  const dish = (await ok(owner.get(`/api/menus/${menu.id}`))).sections[0].items[0].id
  await ok(owner.post(`/api/integrations/mapping/${conn.id}/rules`, { kind: 'exact', variant_ref: 'var-latte-lrg', target_item_id: dish }))
  await mapping.remapConnection(ids.a, conn.id)
  const [l] = await sql`
    SELECT l.map_state, l.item_id, l.allocated_net_pence, l.net_pence FROM ext_check_lines l JOIN ext_checks c ON c.id = l.check_id
     WHERE c.connection_id = ${conn.id} AND c.external_id = 'ORD-1' AND l.line_kind = 'item'`
  assert.deepEqual([l.map_state, l.item_id, l.allocated_net_pence], ['mapped', dish, l.net_pence])
  const [reg] = await sql`
    SELECT l.map_state FROM ext_check_lines l JOIN ext_checks c ON c.id = l.check_id
     WHERE c.connection_id = ${conn.id} AND c.external_id = 'ORD-H0' AND l.line_kind = 'item'`
  assert.equal(reg.map_state, 'unmapped', 'the other variation is not')
})

test('every-till subjects show Source = Square; Cash Recon is not offered for a Square venue', async () => {
  const run = runner(ids.a)
  const from = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10)
  const to = todayIn('Europe/London')
  const filters = [{ field: 'date', op: 'in_period', value: { from, to } }, { field: 'venue', op: 'in', value: [V] }]
  const checks = rowsOf(await run({ subject: 'sales.checks', rows: [{ field: 'source' }], values: measures(['checks', 'refunds']), filters }))
  const sq = checks.find(r => r.source === 'square')
  assert.ok(sq, 'a Square row: ' + JSON.stringify(checks))
  assert.equal(sq.checks, 5, 'ORD-1, ORD-2 and the three old ones (the cancelled one left out)')
  assert.equal(sq.refunds, 1)
  const dishes = rowsOf(await run({ subject: 'sales.dishes', rows: [{ field: 'source' }], values: measures(['qty_sold']), filters }))
  assert.ok(dishes.some(r => r.source === 'square'))
  const tenders = rowsOf(await run({ subject: 'sales.tenders', rows: [{ field: 'source' }, { field: 'tender' }], values: measures(['taken']), filters }))
    .filter(r => r.source === 'square')
  assert.ok(tenders.length, 'Square tenders')

  // Pepper's till_day and Today read the stored day under Square's name.
  const date = (await sql`SELECT business_date::text AS d FROM ext_checks WHERE connection_id = ${conn.id} AND external_id = 'ORD-1'`)[0].d
  const day = await ok(owner.get(`/api/integrations/venues/${V}/day?date=${date}`))
  assert.deepEqual([day.linked, day.system, day.label], [true, 'square', 'Square'])

  // Cash Recon's fill is Loyverse's: a Square venue isn't offered it.
  assert.equal((await owner.post(`/api/loyverse/venues/${V}/preview`, { from: date, to: date })).status, 422)
  const sources = await withTenant(ids.a, tx => linkedSources(tx, ids.a, V))
  assert.deepEqual(sources, [])
  const links = await ok(owner.get(`/api/venues/${V}/cash-recon/links`))
  assert.equal(JSON.stringify(links).includes('Fill from Loyverse'), false)
})

test('OAuth: the state is tied to the tenant and person; ObtainToken; refresh before expiry; revoke on disconnect', async () => {
  env.SQUARE_APPLICATION_ID = APP_ID
  env.SQUARE_APPLICATION_SECRET = APP_SECRET
  const cfg = await ok(owner.get('/api/square/oauth'))
  assert.equal(cfg.available, true)
  assert.equal(cfg.environment, 'sandbox', 'a sandbox app id')
  assert.match(cfg.redirect_url, /\/api\/square\/oauth\/callback$/)

  const { url } = await ok(owner.post('/api/square/oauth/start', { name: 'Zqx OAuth' }))
  const u = new URL(url)
  assert.equal(u.origin + u.pathname, fake.url + '/sandbox/oauth2/authorize')
  assert.equal(u.searchParams.get('client_id'), APP_ID)
  assert.equal(u.searchParams.get('redirect_uri'), cfg.redirect_url)
  assert.equal(u.searchParams.get('scope'), square.OAUTH_SCOPES.join(' '))
  const state = u.searchParams.get('state')
  assert.equal(state.includes(APP_SECRET), false)

  // Square's redirect lands on the API, signed in or not, and only renames
  // the values onto the Integrations page (Auth0 would take ?code=&state=).
  const app = await getApp()
  const back = await app.inject({ method: 'GET', url: '/api/square/oauth/callback?code=good-code&state=' + encodeURIComponent(state) + '&response_type=code' })
  assert.equal(back.statusCode, 302)
  const to = new URL(back.headers.location, 'http://x')
  assert.equal(to.pathname, '/integrations')
  assert.deepEqual([to.searchParams.get('square_code'), to.searchParams.get('square_state'), to.searchParams.has('code')], ['good-code', state, false])
  const denied = await app.inject({ method: 'GET', url: '/api/square/oauth/callback?error=access_denied&error_description=user%20denied%3Cscript%3E' })
  const dto = new URL(denied.headers.location, 'http://x')
  assert.deepEqual([dto.pathname, dto.searchParams.get('square_error'), dto.searchParams.get('square_error_description')], ['/integrations', 'access_denied', 'user deniedscript'])
  const odd = await app.inject({ method: 'GET', url: '/api/square/oauth/callback?code=' + encodeURIComponent('a"><b') + '&state=x' })
  assert.equal(new URL(odd.headers.location, 'http://x').searchParams.get('square_error'), 'no_code')

  const calls = () => fake.calls.filter(c => c.path === '/oauth2/token').length
  const tokenCalls = calls()
  // Changed, for another tenant, by another person, or not signed by us: refused before Square is asked.
  const [body, mac] = state.split('.')
  const tampered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), t: ids.b })).toString('base64url') + '.' + mac
  assert.equal((await owner.post('/api/square/oauth/finish', { code: 'good-code', state: tampered })).status, 403)
  assert.equal((await owner.post('/api/square/oauth/finish', { code: 'good-code', state: state.slice(0, -2) + 'xx' })).status, 403)
  const { url: bUrl } = await ok(other.post('/api/square/oauth/start', { name: 'B' }))
  const bState = new URL(bUrl).searchParams.get('state')
  assert.equal((await owner.post('/api/square/oauth/finish', { code: 'good-code', state: bState })).status, 403, 'another tenant\'s state')
  assert.equal((await admin.post('/api/square/oauth/finish', { code: 'good-code', state })).status, 403, 'another person\'s state')
  const old = square.signState({ tenantId: ids.a, userSub: A.owner, name: 'Old' }, square.oauthConfig(), Date.now() - 60 * 60_000)
  assert.equal((await owner.post('/api/square/oauth/finish', { code: 'good-code', state: old })).status, 403, 'an expired state')
  assert.equal(calls(), tokenCalls, 'Square never asked')
  assert.equal((await operator.post('/api/square/oauth/start', {})).status, 403)

  const made = await ok(owner.post('/api/square/oauth/finish', { code: 'good-code', state }))
  assert.deepEqual([made.auth_kind, made.environment, made.merchant_id, made.name], ['oauth', 'sandbox', OAUTH_MERCHANT, 'Zqx OAuth'])
  assert.equal(made.webhook.registered, false, 'an OAuth token may not make subscriptions: the address is pasted')
  assert.ok(made.webhook.url)
  assert.equal(JSON.stringify(made).includes('sq-oauth-'), false)
  const [row] = await sql`SELECT access_token, refresh_token, token_expires_at FROM pos_connections WHERE id = ${made.id}`
  assert.match(unseal(row.access_token), /^sq-oauth-access-/)
  assert.match(unseal(row.refresh_token), /^sq-oauth-refresh-/)
  assert.ok(row.token_expires_at > new Date(Date.now() + 29 * 86400_000))

  // Refreshed before it runs out, in the sync.
  await sql`UPDATE pos_connections SET token_expires_at = now() + interval '1 day' WHERE id = ${made.id}`
  const before = unseal(row.access_token)
  const r = await svc.syncConnection(ids.a, made.id)
  assert.equal(r.error, undefined, r.error)
  const [after] = await sql`SELECT access_token, token_expires_at FROM pos_connections WHERE id = ${made.id}`
  assert.notEqual(unseal(after.access_token), before)
  assert.ok(after.token_expires_at > new Date(Date.now() + 29 * 86400_000))
  assert.ok(fake.calls.some(c => c.path === '/oauth2/token' && c.body.grant_type === 'refresh_token'))
  // Not refreshed again while it has long to run.
  const refreshes = fake.calls.filter(c => c.body?.grant_type === 'refresh_token').length
  await sql`UPDATE pos_connections SET last_sync_at = NULL WHERE id = ${made.id}`
  await svc.syncConnection(ids.a, made.id)
  assert.equal(fake.calls.filter(c => c.body?.grant_type === 'refresh_token').length, refreshes)

  // Disconnecting gives the grant back.
  assert.equal((await other.delete(`/api/integrations/connections/${made.id}`)).status, 404)
  await ok(owner.delete(`/api/integrations/connections/${made.id}`))
  assert.deepEqual(fake.revoked, [unseal(after.access_token)])
  assert.equal((await sql`SELECT count(*)::int AS n FROM pos_connections WHERE id = ${made.id}`)[0].n, 0)
})

test('disconnecting a token connection removes its webhook subscription and its sales; rename and unlink', async () => {
  const renamed = await ok(owner.patch(`/api/integrations/connections/${conn.id}`, { name: 'Zqx Square renamed' }))
  assert.equal(renamed.connections.find(c => c.id === conn.id).name, 'Zqx Square renamed')
  assert.equal((await other.delete(`/api/integrations/connections/${conn.id}/venues/${V}`)).status, 404)
  await ok(owner.delete(`/api/integrations/connections/${conn.id}/venues/${V}`))
  assert.equal((await sql`SELECT count(*)::int AS n FROM pos_connection_venues WHERE connection_id = ${conn.id}`)[0].n, 0)
  assert.ok((await sql`SELECT count(*)::int AS n FROM ext_checks WHERE connection_id = ${conn.id}`)[0].n > 0, 'the sales kept stay')
  await ok(owner.delete(`/api/integrations/connections/${conn.id}`))
  assert.equal(fake.subscriptions.length, 0)
  assert.deepEqual(fake.revoked.length, 1, 'a pasted token is not revoked')
  assert.equal((await sql`SELECT count(*)::int AS n FROM ext_checks WHERE connection_id = ${conn.id}`)[0].n, 0)
})

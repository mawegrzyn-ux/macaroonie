// Receipts on the guest's phone (migration 209): a kiosk asks for the receipt
// of an order it placed and gets its page's link (made once per order), the
// page shows the receipt in the kiosk receipt design (a bill until a counter
// order is paid), an email goes through the location's provider without the
// address being kept; other devices, other kiosks, other tenants, bad tokens
// and too many emails are refused; old receipts are cleared.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { cleanUpReceipts, MAX_EMAILS } from '../src/services/receiptSvc.js'
import { kioskOrder, normaliseDesign } from '../../shared/kiosk.js'
import { ulid } from '../../shared/pos/ids.js'
import { posChoices } from '../../shared/pos/pricing.js'
import { env } from '../src/config/env.js'

let ids, owner, mine, kiosk, kiosk2, till, kioskB, config, paidCheck, counterCheck
const sent = []
const realFetch = globalThis.fetch

async function device(d, method, url, body) {
  const app = await getApp()
  const res = await app.inject({
    method, url,
    headers: {
      ...(d ? { authorization: `Device ${d.device_id}.${d.secret}` } : {}),
      [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    payload: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = res.json() } catch { json = null }
  return { status: res.statusCode, json, body: res.body, headers: res.headers }
}

async function page(url, host = 'kiosk.' + env.PUBLIC_ROOT_DOMAIN) {
  const app = await getApp()
  const res = await app.inject({ method: 'GET', url, headers: { host, 'x-forwarded-proto': 'https' } })
  return { status: res.statusCode, body: res.body, headers: res.headers }
}

/** An order as the kiosk places it (shared kioskOrder()), paid by card or to pay at the counter. */
async function placeOrder(d, { card }) {
  // The first dish that orders, with the fewest choices a guest must make.
  let dish = null
  let r = null
  for (const it of Object.values(config.items)) {
    if (it.kind === 'combo') continue
    const choices = {}
    for (const c of it.pos_choices || posChoices(it, config.groups || {})) if (c.min > 0) choices[c.key] = c.options.slice(0, c.min).map(o => o.id)
    r = kioskOrder(config, [{ key: 'a', item_id: it.id, selection: { choices }, qty: 2 }], {
      device: { id: d.device_id, venue_id: mine.ids.venue }, checkId: ulid(), newId: ulid,
      order_type_id: config.order_types[0]?.id || null, tent: '12', provisional_no: 'KS-0001',
      payment: card ? { ref: 'TEST-1', label: 'Test card' } : null, send: false,
    })
    if (r.ok && r.totals.total > 0) { dish = it; break }
  }
  assert.ok(dish, 'a dish the kiosk can order as it is: ' + r?.error)
  const res = await device(d, 'POST', '/pos-api/events', { events: r.events })
  assert.equal(res.status, 200, JSON.stringify(res.json))
  assert.ok(res.json.results.every(x => x.ok), JSON.stringify(res.json.results))
  return { id: r.check.id, dish, total: r.totals.total }
}

before(async () => {
  ids = await resetAndSeed()
  mine = await fillTenant(A.owner, ids.a)
  assert.deepEqual(mine.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  kiosk = await linkDevice(owner, mine.ids.venue, { kind: 'kiosk', name: 'Receipt kiosk' })
  kiosk2 = await linkDevice(owner, mine.ids.venue, { kind: 'kiosk', name: 'Other kiosk' })
  till = await linkDevice(owner, mine.ids.venue, { kind: 'terminal', name: 'Receipt till' })
  const bOwner = as(B.owner, ids.b)
  const venueB = await ok(bOwner.post('/api/venues', { name: 'Elsewhere', slug: 'elsewhere-receipts', timezone: 'Europe/London' }))
  kioskB = await linkDevice(bOwner, venueB.id, { kind: 'kiosk', name: 'Their kiosk' })
  const cfg = await device(kiosk, 'GET', '/pos-api/config')
  assert.equal(cfg.status, 200, JSON.stringify(cfg.json))
  config = { ...cfg.json, design: normaliseDesign(cfg.json.design) }
  // The location sends email through SendGrid (a stand-in: nothing leaves this process).
  await ok(owner.post(`/api/email-templates/settings/${mine.ids.venue}`, { email_provider: 'sendgrid', provider_api_key: 'SG.kiosk-test', from_name: 'Ware kitchen', from_email: 'hello@ware.example' }))
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.sendgrid.com/')) {
      const body = JSON.parse(opts.body)
      if (body.personalizations[0].to[0].email === 'bounce@fail.example') return new Response('{"errors":[{"message":"Bad address"}]}', { status: 400 })
      sent.push({ auth: opts.headers.Authorization, body })
      return new Response('', { status: 202, headers: { 'x-message-id': 'sg' + sent.length } })
    }
    return realFetch(url, opts)
  }
  paidCheck = await placeOrder(kiosk, { card: true })
  counterCheck = await placeOrder(kiosk, { card: false })
})
after(async () => { globalThis.fetch = realFetch; await closeApp() })

let link

test('a kiosk gets its order\'s receipt link: made once, the same link however often it asks', async () => {
  const first = await device(kiosk, 'POST', '/pos-api/kiosk/receipts', { check_id: paidCheck.id })
  assert.equal(first.status, 200, JSON.stringify(first.json))
  assert.match(first.json.url, new RegExp('^' + env.PUBLIC_SITE_SCHEME + '://kiosk\\.' + env.PUBLIC_ROOT_DOMAIN.replace(/\./g, '\\.') + '/receipt/[A-Za-z0-9_-]{32}$'))
  assert.equal(first.json.sent_to, null)
  const again = await device(kiosk, 'POST', '/pos-api/kiosk/receipts', { check_id: paidCheck.id })
  assert.equal(again.json.url, first.json.url)
  link = new URL(first.json.url)
  const rows = await sql`SELECT * FROM pos_receipts WHERE tenant_id = ${ids.a}`
  assert.equal(rows.length, 1)
  assert.equal(rows[0].check_id, paidCheck.id)
  assert.equal(rows[0].device_id, kiosk.device_id)
  assert.equal(rows[0].emails, 0)
})

test('the receipt page: the order as the kiosk receipt prints it, never cached or indexed, counted', async () => {
  const r = await page(link.pathname)
  assert.equal(r.status, 200, r.body)
  assert.match(r.headers['content-type'], /text\/html/)
  assert.equal(r.headers['cache-control'], 'no-store')
  assert.equal(r.headers['referrer-policy'], 'no-referrer')
  assert.match(r.headers['x-robots-tag'], /noindex/)
  assert.match(r.headers['content-security-policy'], /default-src 'none'/)
  assert.ok(r.body.includes(paidCheck.dish.name.toUpperCase()) || r.body.includes(paidCheck.dish.name), 'the dish is on it')
  assert.ok(r.body.includes('£' + (paidCheck.total / 100).toFixed(2)), 'the total is on it')
  assert.ok(!r.body.includes('Not paid yet'), 'a paid order is a receipt')
  const [row] = await sql`SELECT views, last_viewed_at FROM pos_receipts WHERE tenant_id = ${ids.a}`
  assert.equal(row.views, 1)
  assert.ok(row.last_viewed_at)
  // Only on the device addresses; bad and unknown tokens get the same page that says so.
  assert.equal((await page(link.pathname, 'office.' + env.PUBLIC_ROOT_DOMAIN)).status, 404)
  assert.equal((await page(link.pathname, 'pos.' + env.PUBLIC_ROOT_DOMAIN)).status, 200)
  assert.equal((await page('/receipt/' + 'x'.repeat(32))).status, 404)
  assert.equal((await page('/receipt/short')).status, 404)
  assert.equal((await page("/receipt/' OR 1=1 --")).status, 404)
})

test('an order paid at the counter: its page is the bill until it is paid; its receipt can\'t be emailed yet', async () => {
  const r = await device(kiosk, 'POST', '/pos-api/kiosk/receipts', { check_id: counterCheck.id })
  assert.equal(r.status, 200)
  const p = await page(new URL(r.json.url).pathname)
  assert.equal(p.status, 200)
  assert.ok(p.body.includes('Not paid yet'))
  const mail = await device(kiosk, 'POST', '/pos-api/kiosk/receipts', { check_id: counterCheck.id, email: 'sam@example.com' })
  assert.equal(mail.status, 422)
  assert.equal(sent.length, 0)
})

test('emailing a receipt: through the location\'s provider, the address never kept, a few times an order at most', async () => {
  const r = await device(kiosk, 'POST', '/pos-api/kiosk/receipts', { check_id: paidCheck.id, email: '  Sam.Lee@Example.com ' })
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.equal(r.json.sent_to, 'S***@Example.com')
  assert.equal(r.json.url, link.href, 'the same page as the QR code')
  assert.equal(sent.length, 1)
  const mail = sent[0]
  assert.equal(mail.auth, 'Bearer SG.kiosk-test', 'the location\'s own key')
  assert.equal(mail.body.personalizations[0].to[0].email, 'Sam.Lee@Example.com')
  assert.deepEqual(mail.body.from, { email: 'hello@ware.example', name: 'Ware kitchen' })
  assert.match(mail.body.subject, /^Your receipt from /)
  const html = mail.body.content[0].value
  assert.ok(html.includes(link.href), 'with the link to the page')
  assert.ok(html.includes('£' + (paidCheck.total / 100).toFixed(2)), 'the total')
  // Nothing of the address but its first letter and domain is stored, anywhere.
  const [row] = await sql`SELECT * FROM pos_receipts WHERE tenant_id = ${ids.a} AND check_id = ${paidCheck.id}`
  assert.equal(row.emails, 1)
  assert.equal(row.email_hint, 'S***@Example.com')
  assert.ok(row.emailed_at)
  assert.ok(!JSON.stringify(row).toLowerCase().includes('sam.lee'))
  const logged = await sql`SELECT count(*)::int AS n FROM email_log WHERE tenant_id = ${ids.a} AND lower(recipient) LIKE '%sam.lee%'`.catch(() => [{ n: 0 }])
  assert.equal(logged[0].n, 0)
  // Not an address; the provider refusing: the kiosk is told, and it counts.
  assert.equal((await device(kiosk, 'POST', '/pos-api/kiosk/receipts', { check_id: paidCheck.id, email: 'sam@' })).status, 400)
  const bounced = await device(kiosk, 'POST', '/pos-api/kiosk/receipts', { check_id: paidCheck.id, email: 'bounce@fail.example' })
  assert.equal(bounced.status, 422)
  assert.match(bounced.json.error, /couldn't be sent/)
  // Up to MAX_EMAILS sends an order, then refused (a kiosk can't be used to send mail).
  for (let i = 2; i < MAX_EMAILS; i++) assert.equal((await device(kiosk, 'POST', '/pos-api/kiosk/receipts', { check_id: paidCheck.id, email: 'more' + i + '@example.com' })).status, 200)
  const over = await device(kiosk, 'POST', '/pos-api/kiosk/receipts', { check_id: paidCheck.id, email: 'again@example.com' })
  assert.equal(over.status, 429)
  assert.equal(sent.length, MAX_EMAILS - 1, 'the bounced one and the refused one weren\'t sent')
})

test('refusals: another kiosk\'s order, a till, another tenant\'s kiosk, no pairing, an unknown order', async () => {
  const body = { check_id: paidCheck.id }
  const other = await device(kiosk2, 'POST', '/pos-api/kiosk/receipts', body)
  assert.equal(other.status, 404, 'another kiosk at the venue didn\'t take that order')
  assert.equal((await device(till, 'POST', '/pos-api/kiosk/receipts', body)).status, 403)
  assert.equal((await device(kioskB, 'POST', '/pos-api/kiosk/receipts', body)).status, 404)
  assert.equal((await device(null, 'POST', '/pos-api/kiosk/receipts', body)).status, 401)
  assert.equal((await device(kiosk, 'POST', '/pos-api/kiosk/receipts', { check_id: ulid() })).status, 404)
  assert.equal((await device(kiosk, 'POST', '/pos-api/kiosk/receipts', {})).status, 400)
  const rows = await sql`SELECT count(*)::int AS n FROM pos_receipts`
  assert.equal(rows[0].n, 2, 'nothing made for the refusals')
})

test('a design\'s done screen settings survive saving; another tenant\'s order type is dropped', async () => {
  const types = await ok(owner.get('/api/order-types'))
  const mineType = (types.order_types || types)[0].id
  const theirs = '99999999-9999-4999-8999-999999999999'
  const saved = await ok(owner.post('/api/pos/kiosk-designs', { name: 'Done screen', settings: { done: {
    main: 'tent', lines: ['number', 'name'], message: 'Grab a tent', receipt_qr: true, receipt_email: true,
    types: [{ order_type_id: mineType, main: 'name', lines: [], message: 'Collect at the window' }, { order_type_id: theirs, main: 'number' }],
  } } }))
  assert.deepEqual(saved.settings.done, {
    main: 'tent', lines: ['number', 'name'], message: 'Grab a tent', receipt_qr: true, receipt_email: true,
    types: [{ order_type_id: mineType, main: 'name', lines: [], message: 'Collect at the window' }],
  })
})

test('old receipts are cleared after 400 days', async () => {
  await sql`UPDATE pos_receipts SET created_at = now() - interval '401 days' WHERE tenant_id = ${ids.a} AND check_id = ${counterCheck.id}`
  const old = (await sql`SELECT token FROM pos_receipts WHERE check_id = ${counterCheck.id}`)[0].token
  assert.equal((await page('/receipt/' + old)).status, 404, 'an expired page shows nothing even before the clean-up')
  const r = await cleanUpReceipts()
  assert.equal(r.removed, 1)
  assert.equal((await sql`SELECT count(*)::int AS n FROM pos_receipts`)[0].n, 1)
})

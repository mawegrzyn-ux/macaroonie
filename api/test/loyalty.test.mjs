// Loyalty (migration 211): the programme and its switches, rewards and stamp
// cards (another tenant's dishes dropped), the web app's emailed code
// sign-in and join (welcome points), a till earning points and stamps when a
// check closes and spending a reward the server reserved (used once, put back
// when its discount comes off, refunds taking points back), a kiosk finding
// a member by card only and seeing a first name, online orders spending a
// reward and earning when completed, staff adjustments and gifts, export and
// erasure, and other tenants, viewers and signed-out guests refused.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { ulid } from '../../shared/pos/ids.js'
import { tillDiscount, parseCardCode, normaliseReward } from '../../shared/loyalty.js'
import { checkTotals } from '../../shared/pos/pricing.js'
import { settleCheck, settleOrder, sweepLoyalty } from '../src/services/loyaltySvc.js'

let ids, owner, mine, till, kiosk, staffId, dish, menuDish2
const sent = []
const realFetch = globalThis.fetch
const SLUG = 'zqx-site'

async function call(method, url, { body, headers = {} } = {}) {
  const app = await getApp()
  const res = await app.inject({
    method, url,
    headers: { [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    payload: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = res.json() } catch { json = null }
  return { status: res.statusCode, json, body: res.body, headers: res.headers, raw: res.rawPayload }
}
const device = (d, method, url, body) => call(method, url, { body, headers: { authorization: `Device ${d.device_id}.${d.secret}` } })
const guest = (session, method, path, body) => call(method, '/loyalty-api/t/' + SLUG + path, { body, headers: session ? { authorization: 'Loyalty ' + session } : {} })

async function lastCode(email) {
  const end = Date.now() + 4000
  while (Date.now() < end) {
    const m = [...sent].reverse().find(x => x.body.personalizations[0].to[0].email === email)
    if (m) return /(\d{6})/.exec(m.body.content[0].value.replace(/<[^>]+>/g, ' '))?.[1]
    await new Promise(r => setTimeout(r, 30))
  }
  return null
}

/** Join through the web app: code, verify, join. */
async function joinByWeb(email, name, { marketing = false } = {}) {
  assert.equal((await guest(null, 'POST', '/code', { email })).status, 200)
  const code = await lastCode(email)
  assert.ok(code, 'a code was emailed')
  const v = await guest(null, 'POST', '/verify', { email, code })
  assert.equal(v.status, 200, JSON.stringify(v.json))
  assert.ok(v.json.join_ticket, 'not a member yet: a join ticket')
  const j = await guest(null, 'POST', '/join', { join_ticket: v.json.join_ticket, email, name, agreed: true, marketing })
  assert.equal(j.status, 201, JSON.stringify(j.json))
  return j.json
}

async function tillDoes(checkId, events) {
  const res = await device(till, 'POST', '/pos-api/events', { events: events.map(([type, payload]) => ({
    id: ulid(), type, payload, check_id: checkId, staff_id: staffId, client_at: new Date().toISOString(),
  })) })
  assert.equal(res.status, 200, JSON.stringify(res.json))
  return res.json
}
const allOk = r => assert.ok(r.results.every(x => x.ok), JSON.stringify(r.results))
const line = (item, qty = 1, price = 1250) => ({ id: ulid(), item_id: item.id, section_id: item.section_id, name: item.name, qty, unit_price: price, modifiers: [], vat_rate: 20 })
const memberRow = id => sql`SELECT * FROM loyalty_members WHERE id = ${id}`.then(r => r[0])
const redemption = id => sql`SELECT * FROM loyalty_redemptions WHERE id = ${id}`.then(r => r[0])

before(async () => {
  ids = await resetAndSeed()
  mine = await fillTenant(A.owner, ids.a)
  assert.deepEqual(mine.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  await ok(as(B.owner, ids.b).patch('/api/website/tenant-site', { subdomain_slug: 'bqx-site' }))
  till = await linkDevice(owner, mine.ids.venue, { kind: 'terminal', name: 'Loyalty till' })
  kiosk = await linkDevice(owner, mine.ids.venue, { kind: 'kiosk', name: 'Loyalty kiosk' })
  staffId = mine.ids.staff
  const role = await ok(owner.post('/api/pos/roles', { name: 'Loyalty server', permissions: { refund: true, void: true } }))
  await ok(owner.put(`/api/pos/venues/${mine.ids.venue}/staff/${staffId}/pos`, { pos_role_id: role.id, pin: '5937' }))
  const items = await sql`SELECT id, section_id, name FROM menu_items WHERE tenant_id = ${ids.a} AND kind <> 'combo' ORDER BY name`
  dish = items[0]
  menuDish2 = items[1] || items[0]
  await ok(owner.post(`/api/email-templates/settings/${mine.ids.venue}`, { email_provider: 'sendgrid', provider_api_key: 'SG.loyalty-test', from_name: 'Ware', from_email: 'hello@ware.example' }))
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.sendgrid.com/')) {
      sent.push({ body: JSON.parse(opts.body) })
      return new Response('', { status: 202, headers: { 'x-message-id': 'sg' + sent.length } })
    }
    return realFetch(url, opts)
  }
})
after(async () => { globalThis.fetch = realFetch; await closeApp() })

let points100, freeDish, card

test('the programme: off at first, switched on with its settings; who may see and change it', async () => {
  const first = await ok(owner.get('/api/loyalty/programme'))
  assert.equal(first.programme.enabled, false)
  assert.equal((await guest(null, 'GET', '')).status, 404, 'closed while off')
  const put = await ok(owner.put('/api/loyalty/programme', { enabled: true, settings: {
    name: 'Zqx Club', points: { per_pound: 10, welcome: 50 },
    features: { points: true, stamps: true, rewards: true, web_app: true, network: true },
    venue_ids: [mine.ids.venue, '00000000-0000-4000-8000-000000000000'],
  } }))
  assert.equal(put.enabled, true)
  assert.equal(put.settings.features.network, false, 'the Macaroonie-wide programme isn\'t open yet')
  assert.deepEqual(put.settings.venue_ids, [mine.ids.venue], 'unknown venue ids dropped')
  // Every venue takes part again.
  await ok(owner.put('/api/loyalty/programme', { enabled: true, settings: { ...put.settings, venue_ids: null } }))
  assert.equal((await as(A.viewer, ids.a).get('/api/loyalty/programme')).status, 403)
  assert.equal((await as(A.operator, ids.a).get('/api/loyalty/programme')).status, 200)
  assert.equal((await as(A.operator, ids.a).put('/api/loyalty/programme', { enabled: false, settings: {} })).status, 403)
  const b = await ok(as(B.owner, ids.b).get('/api/loyalty/programme'))
  assert.equal(b.programme.enabled, false, 'tenant B has its own programme')
})

test('rewards and stamp cards: another tenant\'s dishes are dropped; a used reward can\'t be deleted', async () => {
  const otherDish = (await sql`SELECT id FROM menu_items WHERE tenant_id = ${ids.b} LIMIT 1`)[0]
  points100 = await ok(owner.post('/api/loyalty/rewards', { name: '£3 off', kind: 'amount_off', value: 300, points_cost: 100 }))
  assert.equal(points100.points_cost, 100)
  freeDish = await ok(owner.post('/api/loyalty/rewards', { name: 'Free dish', kind: 'free_item', item_ids: [dish.id, ...(otherDish ? [otherDish.id] : [])] }))
  assert.deepEqual(freeDish.item_ids, [dish.id])
  card = await ok(owner.post('/api/loyalty/stamp-cards', { name: 'Dish card', stamps_needed: 3, reward_id: freeDish.id, earn: { per: 'item', item_ids: [dish.id] } }))
  assert.equal(card.reward_id, freeDish.id)
  const bReward = await ok(as(B.owner, ids.b).post('/api/loyalty/rewards', { name: 'Theirs', kind: 'percent_off', value: 10 }))
  const sneaky = await ok(owner.post('/api/loyalty/stamp-cards', { name: 'Sneaky', reward_id: bReward.id, earn: { per: 'visit' } }))
  assert.equal(sneaky.reward_id, null, 'another tenant\'s reward isn\'t taken')
  await ok(owner.delete('/api/loyalty/stamp-cards/' + sneaky.id))
  const blocked = await owner.delete('/api/loyalty/rewards/' + freeDish.id)
  assert.equal(blocked.status, 409, 'a stamp card gives it')
  assert.equal((await as(B.owner, ids.b).put('/api/loyalty/rewards/' + points100.id, { name: 'x' })).status, 404)
})

let sam, samSession
test('the web app: a code by email, join with consent, welcome points; signing in again', async () => {
  const info = await guest(null, 'GET', '')
  assert.equal(info.status, 200)
  assert.equal(info.json.name, 'Zqx Club')
  assert.equal(info.json.rewards.length, 1, 'only rewards on offer for points are listed')
  assert.equal(info.json.stamp_cards[0].stamps_needed, 3)
  const bad = await guest(null, 'POST', '/code', { email: 'not-an-email' })
  assert.equal(bad.status, 400)
  const wrong = await guest(null, 'POST', '/verify', { email: 'sam@zqx.test', code: '000000' })
  assert.equal(wrong.status, 422)
  const noAgree = await guest(null, 'POST', '/join', { join_ticket: 'x', email: 'sam@zqx.test', name: 'Sam', agreed: false })
  assert.equal(noAgree.status, 400)
  const joined = await joinByWeb('sam@zqx.test', 'Sam Lee', { marketing: true })
  samSession = joined.session
  sam = joined.member
  assert.equal(sam.points, 50, 'welcome points')
  assert.match(sam.member_no, /^\d{9}$/)
  assert.deepEqual(parseCardCode(sam.card_code), { token: sam.card_code.slice(4) })
  const row = await memberRow(sam.id)
  assert.equal(row.marketing_opt_in, true)
  assert.match(row.consent.terms.text, /loyalty programme/)
  assert.ok(row.customer_id, 'linked to a customer')
  assert.equal(row.email_hash.length, 64)
  // Signing in again: no join, a session.
  assert.equal((await guest(null, 'POST', '/code', { email: 'Sam@ZQX.test' })).status, 200)
  sent.length = 0
  await guest(null, 'POST', '/code', { email: 'sam@zqx.test' })
  const code = await lastCode('sam@zqx.test')
  const again = await guest(null, 'POST', '/verify', { email: 'sam@zqx.test', code })
  assert.ok(again.json.session && !again.json.join_ticket)
  const me = await guest(again.json.session, 'GET', '/me')
  assert.equal(me.json.points, 50)
  assert.equal(me.json.history[0].kind, 'welcome')
  assert.equal((await guest('ls_' + 'x'.repeat(32), 'GET', '/me')).status, 401)
  // Another tenant's slug doesn't know the session.
  const other = await call('GET', '/loyalty-api/t/bqx-site/me', { headers: { authorization: 'Loyalty ' + samSession } })
  assert.equal(other.status, 404, 'B\'s loyalty is off')
})

test('the till: find a member by card, earn on a closed check, stamps fill a card and give its reward', async () => {
  const look = await device(till, 'POST', '/pos-api/loyalty/lookup', { code: sam.card_code })
  assert.equal(look.status, 200, JSON.stringify(look.json))
  assert.equal(look.json.members[0].id, sam.id)
  assert.equal(look.json.members[0].email, 'sam@zqx.test', 'staff see the email')
  const search = await device(till, 'POST', '/pos-api/loyalty/lookup', { q: 'sam@zqx.test' })
  assert.equal(search.json.members[0].id, sam.id)
  const cfg = await device(till, 'GET', '/pos-api/config')
  assert.equal(cfg.json.loyalty.name, 'Zqx Club')
  assert.equal(cfg.json.loyalty.earn, true)

  const id = ulid()
  const l = line(dish, 3, 1000)
  allOk(await tillDoes(id, [
    ['check.opened', { mode: 'counter' }],
    ['line.added', { line: l }],
    ['check.member_set', { member: { id: sam.id, no: sam.member_no, name: sam.name } }],
    ['payment.added', { payment: { id: ulid(), tender: 'cash', amount: 3000, tendered: 3000 } }],
    ['check.closed', {}],
  ]))
  await settleCheck(ids.a, mine.ids.venue, id)
  let m = await memberRow(sam.id)
  assert.equal(m.points, 50 + 300, '£30 at 10 points a pound')
  assert.equal(m.visits, 1)
  // 3 dishes = a full card: a free dish reward, the card back to 0.
  const held = await sql`SELECT * FROM loyalty_member_rewards WHERE member_id = ${sam.id}`
  assert.equal(held.length, 1)
  assert.equal(held[0].reward_id, freeDish.id)
  // Settling again changes nothing.
  await settleCheck(ids.a, mine.ids.venue, id)
  assert.equal((await memberRow(sam.id)).points, 350)
  assert.equal((await sql`SELECT count(*)::int AS n FROM loyalty_member_rewards WHERE member_id = ${sam.id}`)[0].n, 1)
  // A refund takes points back.
  allOk(await tillDoes(id, [['refund.added', { refund: { id: ulid(), tender: 'cash', amount: 1000, reason: 'Cold' } }]]))
  await settleCheck(ids.a, mine.ids.venue, id)
  m = await memberRow(sam.id)
  assert.equal(m.points, 350 - 100)
})

test('the till spends a reward: reserved, used once, put back when its discount comes off', async () => {
  const id = ulid()
  const l = line(dish, 2, 900)
  allOk(await tillDoes(id, [
    ['check.opened', { mode: 'counter' }],
    ['line.added', { line: l }],
    ['check.member_set', { member: { id: sam.id, no: sam.member_no, name: sam.name } }],
  ]))
  const before = (await memberRow(sam.id)).points
  const res = await device(till, 'POST', '/pos-api/loyalty/redemptions', { member_id: sam.id, reward_id: points100.id, check_id: id, staff_id: staffId })
  assert.equal(res.status, 201, JSON.stringify(res.json))
  assert.equal(res.json.points, before - 100, 'points taken when reserved')
  const red = res.json.redemption
  // The discount the till makes from the reward (shared tillDiscount()).
  const check = { lines: [{ ...l, status: 'new' }] }
  const made = tillDiscount(normaliseReward(res.json.reward), check, checkTotals(check))
  assert.ok(made.ok)
  const discount = { id: ulid(), ...made.discount, loyalty_redemption_id: red.id }
  // Too much is refused by the sequencer.
  const greedy = await tillDoes(id, [['discount.applied', { discount: { ...discount, id: ulid(), value: 500 } }]])
  assert.equal(greedy.results[0].ok, false)
  assert.match(greedy.results[0].error, /at most £3.00/)
  allOk(await tillDoes(id, [['discount.applied', { discount }]]))
  assert.equal((await redemption(red.id)).status, 'used')
  // A second check can't use it.
  const other = ulid()
  const twice = await tillDoes(other, [
    ['check.opened', { mode: 'counter' }], ['line.added', { line: line(dish) }],
    ['check.member_set', { member: { id: sam.id, no: sam.member_no, name: sam.name } }],
    ['discount.applied', { discount: { ...discount, id: ulid() } }],
  ])
  assert.equal(twice.results[3].ok, false)
  assert.match(twice.results[3].error, /already been used/)
  // Taken off the check: put back, points returned.
  allOk(await tillDoes(id, [['discount.removed', { discount_id: discount.id }]]))
  await settleCheck(ids.a, mine.ids.venue, id)
  assert.equal((await redemption(red.id)).status, 'released')
  assert.equal((await memberRow(sam.id)).points, before)
  // The held free dish: on a line, at most the dish's price.
  const me = await device(till, 'POST', '/pos-api/loyalty/lookup', { code: sam.card_code })
  const freeOne = me.json.members[0].rewards.find(r => r.member_reward_id)
  assert.ok(freeOne, 'the free dish from the stamp card')
  const r2 = await device(till, 'POST', '/pos-api/loyalty/redemptions', { member_id: sam.id, member_reward_id: freeOne.member_reward_id, check_id: id })
  assert.equal(r2.status, 201, JSON.stringify(r2.json))
  const free = tillDiscount(normaliseReward(r2.json.reward), check, checkTotals(check))
  assert.deepEqual(free.discount.line_ids, [l.id])
  allOk(await tillDoes(id, [['discount.applied', { discount: { id: ulid(), ...free.discount, loyalty_redemption_id: r2.json.redemption.id } }]]))
  assert.equal((await sql`SELECT status FROM loyalty_member_rewards WHERE id = ${freeOne.member_reward_id}`)[0].status, 'used')
  // Not enough points: refused, nothing taken.
  await sql`UPDATE loyalty_members SET points = 10 WHERE id = ${sam.id}`
  const poor = await device(till, 'POST', '/pos-api/loyalty/redemptions', { member_id: sam.id, reward_id: points100.id, check_id: other })
  assert.equal(poor.status, 409)
  assert.equal((await memberRow(sam.id)).points, 10)
  await sql`UPDATE loyalty_members SET points = 500 WHERE id = ${sam.id}`
  // An unused reservation is put back by the sweep once its time is up.
  const r3 = await device(till, 'POST', '/pos-api/loyalty/redemptions', { member_id: sam.id, reward_id: points100.id, check_id: ulid() })
  assert.equal((await memberRow(sam.id)).points, 400)
  await sql`UPDATE loyalty_redemptions SET expires_at = now() - interval '1 minute' WHERE id = ${r3.json.redemption.id}`
  await sweepLoyalty()
  assert.equal((await redemption(r3.json.redemption.id)).status, 'released')
  assert.equal((await memberRow(sam.id)).points, 500)
})

test('a kiosk finds members by their card only and sees a first name, no email', async () => {
  const byQ = await device(kiosk, 'POST', '/pos-api/loyalty/lookup', { q: 'sam@zqx.test' })
  assert.equal(byQ.status, 403)
  const byCard = await device(kiosk, 'POST', '/pos-api/loyalty/lookup', { code: sam.card_code })
  assert.equal(byCard.status, 200, JSON.stringify(byCard.json))
  assert.equal(byCard.json.members[0].name, 'Sam')
  assert.equal(byCard.json.members[0].email, undefined)
  assert.equal((await device(kiosk, 'POST', '/pos-api/loyalty/members', { name: 'X', email: 'x@x.test', agreed: true })).status, 403)
  const cfg = await device(kiosk, 'GET', '/pos-api/config')
  assert.equal(cfg.json.loyalty.redeem, true)
})

test('online: a quote with a reward, an order spending it, points when completed, given back when cancelled', async () => {
  const venue = mine.ids.venue
  const slots = await call('GET', `/order-api/venues/${venue}/slots?date=` + new Date(Date.now() + 86400_000).toISOString().slice(0, 10))
  const at = (slots.json?.slots || []).find(s => s.available)?.at
  assert.ok(at, 'a collection slot tomorrow: ' + JSON.stringify(slots.json).slice(0, 200))
  // A dish online ordering sells with no choices to make.
  const menu = await call('GET', `/order-api/venues/${venue}`)
  const plain = menu.json.menus.flatMap(m => m.sections.flatMap(s => s.items)).find(it => !it.sold_out && it.kind !== 'combo')
  assert.ok(plain, 'a dish to order')
  const choices = Object.fromEntries((plain.choices || []).filter(c => c.min > 0).map(c => [c.key, c.options.slice(0, c.min).map(o => o.id)]))
  const lines = [{ item_id: plain.id, qty: 2, choices }]
  const before = (await memberRow(sam.id)).points
  const quote = await call('POST', `/order-api/venues/${venue}/quote`, { body: { lines, loyalty: { session: samSession, rewards: [{ reward_id: points100.id }] } } })
  assert.equal(quote.status, 200, JSON.stringify(quote.json))
  assert.ok(quote.json.rewards?.length, JSON.stringify(quote.json).slice(0, 600))
  assert.equal(quote.json.rewards[0].discount_pence, 300)
  assert.equal(quote.json.loyalty_error, null)
  const signedOut = await call('POST', `/order-api/venues/${venue}/quote`, { body: { lines, loyalty: { session: 'ls_' + 'y'.repeat(32), rewards: [] } } })
  assert.equal(signedOut.json.loyalty_error.code, 'loyalty_signed_out')
  const body = {
    lines, when: at, customer: { name: 'Sam Lee', email: 'sam@zqx.test', phone: '07700900333' }, data_consent: true,
    payment_method: 'pay_at_venue', loyalty: { session: samSession, rewards: [{ reward_id: points100.id }] },
  }
  const placed = await call('POST', `/order-api/venues/${venue}/orders`, { body })
  assert.equal(placed.status, 201, JSON.stringify(placed.json))
  const [order] = await sql`SELECT * FROM orders WHERE public_token = ${placed.json.token}`
  assert.equal(order.loyalty_member_id, sam.id)
  const [red] = await sql`SELECT * FROM loyalty_redemptions WHERE order_id = ${order.id}`
  assert.equal(red.discount_pence, 300)
  assert.equal((await memberRow(sam.id)).points, before - 100)
  await settleOrder(ids.a, order.id)
  assert.equal((await redemption(red.id)).status, 'used', 'the order is placed')
  // Completed: points for what was paid for the dishes.
  for (const to of ['accepted', 'ready', 'completed']) await ok(owner.post(`/api/orders/${order.id}/status`, { to, prep_minutes: 10 }), 'status ' + to)
  await settleOrder(ids.a, order.id)
  const [o2] = await sql`SELECT subtotal_pence, discount_pence FROM orders WHERE id = ${order.id}`
  const earned = Math.floor((o2.subtotal_pence - o2.discount_pence) * 10 / 100)
  assert.equal((await memberRow(sam.id)).points, before - 100 + earned)
  // A second order cancelled: its reward comes back.
  const placed2 = await call('POST', `/order-api/venues/${venue}/orders`, { body })
  assert.equal(placed2.status, 201, JSON.stringify(placed2.json))
  const [order2] = await sql`SELECT id FROM orders WHERE public_token = ${placed2.json.token}`
  const mid = (await memberRow(sam.id)).points
  await ok(owner.post(`/api/orders/${order2.id}/status`, { to: 'cancelled', reason: 'Closed early' }))
  await settleOrder(ids.a, order2.id)
  assert.equal((await memberRow(sam.id)).points, mid + 100)
})

test('staff: the members list, adjust points, give a reward, a new card, export; viewers and other tenants refused', async () => {
  const list = await ok(owner.get('/api/loyalty/members?q=sam'))
  assert.equal(list.total, 1)
  assert.equal(list.members[0].id, sam.id)
  const detail = await ok(owner.get('/api/loyalty/members/' + sam.id))
  assert.ok(detail.ledger.length > 3)
  const p0 = detail.member.points
  const adj = await ok(owner.post(`/api/loyalty/members/${sam.id}/adjust`, { points: 25, note: 'Sorry for the wait' }))
  assert.equal(adj.points, p0 + 25)
  assert.equal((await owner.post(`/api/loyalty/members/${sam.id}/adjust`, { points: -1_000_000, note: 'x' })).status, 422)
  const gift = await owner.post(`/api/loyalty/members/${sam.id}/rewards`, { reward_id: freeDish.id, note: 'Birthday' })
  assert.equal(gift.status, 201)
  const oldCode = sam.card_code
  await ok(owner.post(`/api/loyalty/members/${sam.id}/new-card`, {}))
  assert.equal((await device(till, 'POST', '/pos-api/loyalty/lookup', { code: oldCode })).json.members.length, 0, 'the old card stops working')
  const csv = await owner.get('/api/loyalty/members.csv')
  assert.equal(csv.status, 200)
  assert.match(csv.body, /sam@zqx\.test/)
  assert.equal((await as(A.operator, ids.a).get('/api/loyalty/members.csv')).status, 403, 'operators view, not export')
  assert.equal((await as(A.viewer, ids.a).get('/api/loyalty/members')).status, 403)
  assert.equal((await as(B.owner, ids.b).get('/api/loyalty/members/' + sam.id)).status, 404)
  assert.equal((await as(B.owner, ids.b).post(`/api/loyalty/members/${sam.id}/adjust`, { points: 5, note: 'x' })).status, 404)
  const exp = await owner.get(`/api/loyalty/members/${sam.id}/export`)
  assert.equal(exp.status, 200)
  assert.equal(JSON.parse(exp.body).member.email, 'sam@zqx.test')
  // Another tenant's device can't take Sam's rewards out.
  const bOwner = as(B.owner, ids.b)
  const venueB = await ok(bOwner.post('/api/venues', { name: 'Elsewhere', slug: 'elsewhere-loyalty', timezone: 'Europe/London' }))
  const tillB = await linkDevice(bOwner, venueB.id, { kind: 'terminal', name: 'Their till' })
  const theirs = await device(tillB, 'POST', '/pos-api/loyalty/redemptions', { member_id: sam.id, reward_id: points100.id, check_id: ulid() })
  assert.ok([404, 422].includes(theirs.status), String(theirs.status))
})

test('GDPR: the guest downloads their data and deletes their account; staff erase; the card stops', async () => {
  const exp = await guest(samSession, 'GET', '/me/export')
  assert.equal(exp.status, 200)
  assert.equal(exp.json.member.name, 'Sam Lee')
  assert.ok(exp.json.points_history.length)
  const noConfirm = await guest(samSession, 'POST', '/me/delete', { confirm: 'yes' })
  assert.equal(noConfirm.status, 400)
  const del = await guest(samSession, 'POST', '/me/delete', { confirm: 'DELETE' })
  assert.equal(del.status, 200)
  const m = await memberRow(sam.id)
  assert.equal(m.status, 'erased')
  assert.equal(m.email, null)
  assert.equal(m.name, null)
  assert.equal(m.email_hash, null)
  assert.equal((await guest(samSession, 'GET', '/me')).status, 401, 'signed out')
  assert.equal((await sql`SELECT count(*)::int AS n FROM loyalty_sessions WHERE member_id = ${sam.id}`)[0].n, 0)
  assert.ok((await sql`SELECT count(*)::int AS n FROM loyalty_ledger WHERE member_id = ${sam.id}`)[0].n > 0, 'the numbers stay')
  // The same email can join again as a new member.
  const back = await joinByWeb('sam@zqx.test', 'Sam Again')
  assert.notEqual(back.member.id, sam.id)
  // Staff erase needs owner / admin and the typed word.
  assert.equal((await as(A.operator, ids.a).post(`/api/loyalty/members/${back.member.id}/erase`, { confirm: 'ERASE' })).status, 403)
  assert.equal((await owner.post(`/api/loyalty/members/${back.member.id}/erase`, { confirm: 'no' })).status, 400)
  await ok(owner.post(`/api/loyalty/members/${back.member.id}/erase`, { confirm: 'ERASE' }))
  assert.equal((await memberRow(back.member.id)).status, 'erased')
  // Anonymising the customer erases their membership too.
  const third = await joinByWeb('pat@zqx.test', 'Pat')
  const row = await memberRow(third.member.id)
  assert.equal((await owner.post(`/api/customers/${row.customer_id}/anonymise`, {})).status, 204)
  assert.equal((await memberRow(third.member.id)).status, 'erased')
})

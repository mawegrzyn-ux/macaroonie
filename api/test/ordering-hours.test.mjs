// Online ordering hours extended for today (migration 223): the board's clock
// button takes orders later than usual, or back to the usual hours. The rule
// (dayWindows / extensionFor / todayHours in services/orderSvc.js) against a
// fixed clock, then the route against the real one: the board shows it, the
// guest page offers the later times and takes an order in them, refusals,
// another day's extension ignored, roles and another tenant.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { dayWindows, extensionFor, todayHours, localParts } from '../src/services/orderSvc.js'

let ids, owner, W, venue
const LONDON = { timezone: 'Europe/London' }
const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  W = filled.ids.venue
  ;[venue] = await sql`SELECT id, timezone FROM venues WHERE id = ${W}`
  await ok(owner.patch('/api/website/tenant-site', { is_published: true }))
})
after(() => closeApp())

test('the rule: the last window closes later today only; a closed day opens from when it was set', () => {
  // Friday 30 Oct 2026, 20:00 in London (GMT).
  const now = new Date('2026-10-30T20:00:00Z')
  const settings = { hours: [{ day: 5, windows: [{ open: '17:00', close: '21:30' }, { open: '12:00:00', close: '14:30' }] }] }
  assert.deepEqual(dayWindows(settings, '2026-10-30'), [{ open: '12:00', close: '14:30' }, { open: '17:00', close: '21:30' }], 'sorted, HH:MM')

  const ext = extensionFor(settings, LONDON, '22:30', { now, by: 'sam@zqx.test' })
  assert.deepEqual({ date: ext.date, until: ext.until, open: ext.open, by: ext.by }, { date: '2026-10-30', until: '22:30', open: null, by: 'sam@zqx.test' })
  const longer = { ...settings, hours_extension: ext }
  assert.deepEqual(dayWindows(longer, '2026-10-30').at(-1), { open: '17:00', close: '22:30' }, 'the last window closes later')
  assert.deepEqual(dayWindows(longer, '2026-10-30')[0], { open: '12:00', close: '14:30' }, 'earlier windows unchanged')
  assert.deepEqual(dayWindows(longer, '2026-11-06'), [{ open: '12:00', close: '14:30' }, { open: '17:00', close: '21:30' }], 'next Friday keeps the usual close: the extension is for one date')

  const t = todayHours(longer, LONDON, now)
  assert.equal(t.date, '2026-10-30'); assert.equal(t.now, '20:00')
  assert.equal(t.usual.at(-1).close, '21:30'); assert.equal(t.windows.at(-1).close, '22:30'); assert.equal(t.extended.until, '22:30')
  assert.equal(todayHours(longer, LONDON, new Date('2026-10-31T10:00:00Z')).extended, null, 'the next day: not extended')

  const refuse = (until, status, re) => assert.throws(() => extensionFor(settings, LONDON, until, { now }), e => e.statusCode === status && re.test(e.message), until)
  refuse('21:30', 422, /already runs until 21:30/)
  refuse('21:00', 422, /already runs until 21:30/)
  refuse('19:59', 422, /later than now \(20:00\)/)
  refuse('24:00', 400, /up to 23:59/)
  refuse('9:30', 400, /up to 23:59/)
  assert.equal(extensionFor(settings, LONDON, null, { now }), null, 'null puts the usual hours back')

  // A day with no ordering hours: open from when it was set (to 5 minutes).
  const closed = { hours: [{ day: 5, windows: [] }] }
  const opened = extensionFor(closed, LONDON, '22:00', { now: new Date('2026-10-30T19:03:00Z') })
  assert.equal(opened.open, '19:00')
  assert.deepEqual(dayWindows({ ...closed, hours_extension: opened }, '2026-10-30'), [{ open: '19:00', close: '22:00' }])
  // A stored value in the wrong shape is ignored, never trusted.
  assert.deepEqual(dayWindows({ ...settings, hours_extension: { date: '2026-10-30', until: '25:99' } }, '2026-10-30').at(-1).close, '21:30')
  assert.deepEqual(dayWindows({ ...closed, hours_extension: { date: '2026-10-30', until: '22:00', open: 'soon' } }, '2026-10-30'), [])
})

test('the route: the board shows it, guests can order later, back to the usual hours', async (t) => {
  const { date: today, minutes: nowM, dow } = localParts(new Date(), venue.timezone)
  if (nowM < 10 || nowM > 23 * 60 + 15) return t.skip('too close to midnight for the live clock')
  const settings = await ok(owner.get(`/api/orders/settings/${W}`))
  // Today the usual hours ended at 00:05; every other day as before.
  const hours = [0, 1, 2, 3, 4, 5, 6].map(day => ({ day, windows: day === dow ? [{ open: '00:00', close: '00:05' }] : [{ open: '11:00', close: '22:00' }] }))
  const body = { ...settings.settings, hours }
  for (const k of ['venue_id', 'exists', 'tenant_id', 'created_at', 'updated_at', 'hours_extension', 'id']) delete body[k]
  await ok(owner.put(`/api/orders/settings/${W}`, body), 'settings')

  const board = await ok(owner.get(`/api/orders?venue_id=${W}`))
  assert.deepEqual(board.ordering.hours_today.usual, [{ open: '00:00', close: '00:05' }])
  assert.equal(board.ordering.hours_today.extended, null)
  const before = await ok(as(null, null).get(`/order-api/venues/${W}/slots?date=${today}`))
  assert.equal(before.slots.some(s => s.available), false, 'nothing to order today before')

  const r = await owner.post(`/api/orders/hours/${W}`, { until: '23:59' })
  assert.equal(r.status, 200, r.body)
  assert.equal(r.json.extended.until, '23:59')
  assert.match(r.json.extended.by || '', /@/, 'who set it: their login email')
  assert.deepEqual(r.json.windows, [{ open: '00:00', close: '23:59' }])
  const [row] = await sql`SELECT hours_extension FROM ordering_settings WHERE venue_id = ${W}`
  assert.equal(row.hours_extension.date, today)
  assert.equal((await ok(owner.get(`/api/orders?venue_id=${W}`))).ordering.hours_today.extended.until, '23:59', 'on the board')

  const after = await ok(as(null, null).get(`/order-api/venues/${W}/slots?date=${today}`))
  const slot = after.slots.find(s => s.available)
  assert.ok(slot, 'a later time today to order for')
  // An order for that time goes through.
  const menu = await ok(as(null, null).get(`/order-api/venues/${W}`))
  const dish = menu.menus.flatMap(m => m.sections.flatMap(s => s.items)).find(it => !it.sold_out && it.kind !== 'combo')
  const choices = Object.fromEntries((dish.choices || []).filter(c => c.min > 0).map(c => [c.key, c.options.slice(0, c.min).map(o => o.id)]))
  const placed = await as(null, null).post(`/order-api/venues/${W}/orders`, {
    lines: [{ item_id: dish.id, qty: 1, choices }], when: slot.at, data_consent: true, payment_method: 'pay_at_venue',
    customer: { name: 'Late Larry', email: 'larry@zqx.test', phone: '07700900222' },
  })
  assert.equal(placed.status, 201, placed.body)

  // Refusals: not later than the usual close, not a time, nobody else's venue, View only.
  const early = await owner.post(`/api/orders/hours/${W}`, { until: '00:05' })
  assert.equal(early.status, 422); assert.match(early.json.error, /already runs until 00:05|later than now/)
  assert.equal((await owner.post(`/api/orders/hours/${W}`, { until: 'late' })).status, 400)
  assert.equal((await as(A.viewer, ids.a).post(`/api/orders/hours/${W}`, { until: '23:59' })).status, 403, 'View only')
  assert.equal((await as(B.owner, ids.b).post(`/api/orders/hours/${W}`, { until: '23:59' })).status, 404, 'another group')
  assert.equal((await ok(owner.get(`/api/orders?venue_id=${W}`))).ordering.hours_today.extended.until, '23:59', 'unchanged by the refusals')

  // Back to the usual hours.
  const back = await ok(owner.post(`/api/orders/hours/${W}`, { until: null }))
  assert.equal(back.extended, null)
  assert.deepEqual(back.windows, [{ open: '00:00', close: '00:05' }])
  const gone = await ok(as(null, null).get(`/order-api/venues/${W}/slots?date=${today}`))
  assert.equal(gone.slots.some(s => s.available), false, 'the later times are gone')

  // Yesterday's extension doesn't count today; saving Ordering setup keeps today's.
  const yesterday = new Date(Date.parse(today + 'T12:00:00Z') - 86400_000).toISOString().slice(0, 10)
  await sql`UPDATE ordering_settings SET hours_extension = ${sql.json({ date: yesterday, until: '23:59', open: null })} WHERE venue_id = ${W}`
  assert.equal((await ok(owner.get(`/api/orders?venue_id=${W}`))).ordering.hours_today.extended, null)
  assert.equal((await ok(as(null, null).get(`/order-api/venues/${W}/slots?date=${today}`))).slots.some(s => s.available), false)
  await ok(owner.post(`/api/orders/hours/${W}`, { until: hhmm(Math.min(23 * 60 + 59, nowM + 60)) }))
  await ok(owner.put(`/api/orders/settings/${W}`, body), 'settings saved again')
  assert.ok((await ok(owner.get(`/api/orders?venue_id=${W}`))).ordering.hours_today.extended, 'Ordering setup keeps the extension')
})

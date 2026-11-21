// One Retrieve for every linked till system, Retrieve without the preview,
// and the scheduled fill (migration 260, OUTSTANDING 44 item 6): the routes,
// a fill remembering what it wrote (cash_fill_values), the scheduled fill
// keeping a figure changed by hand and skipping a submitted day, running once
// a venue-day, and its settings.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, closeApp, sql } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { sweepAutoFill, autoFillDates } from '../src/services/reconRetrieve.js'
import { changedByHand } from '../src/services/reconFill.js'

let ids, owner, operator, viewer, other, V, C, income, channel
const quiet = { info() {}, warn() {}, error() {}, debug() {} }
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date())
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
let orderNo = 990000

async function order(date, pence) {
  await sql`
    INSERT INTO gloriafood_orders (tenant_id, venue_id, gf_order_id, status, source, payment, total_pence, subtotal_pence,
                                   fulfill_at, accepted_at, items, payload, received_via)
    VALUES (${ids.a}, ${V}, ${++orderNo}, 'accepted', 'website', 'CARD', ${pence}, ${pence},
            ${date + 'T12:00:00Z'}, ${date + 'T11:00:00Z'}, '[]'::jsonb, '{}'::jsonb, 'push')`
}
const day = date => ok(owner.get(`${C}/daily/${date}`))
const incomeOf = r => Number(r.income_entries?.find(e => e.source_id === income.id)?.gross_amount ?? NaN)

before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  other = as(B.owner, ids.b)
  V = (await ok(owner.post('/api/venues', { name: 'Ware', slug: 'ware-rt', timezone: 'Europe/London' }))).id
  C = `/api/venues/${V}/cash-recon`
  income = await ok(owner.post(`${C}/config/income-sources`, { name: 'Online food' }))
  channel = await ok(owner.post(`${C}/config/payment-channels`, { name: 'Online card' }))
})
after(closeApp)

test('changedByHand: empty and zero are not hand figures; a figure differing from the last fill is', () => {
  assert.equal(changedByHand(null, null), false)
  assert.equal(changedByHand(0, null), false, 'the day view saves untouched fields as 0')
  assert.equal(changedByHand(12.5, null), true, 'typed before any fill')
  assert.equal(changedByHand(12.5, 12.5), false, 'what the fill wrote')
  assert.equal(changedByHand(12.5, 10), true, 'changed since')
})

test('Retrieve: nothing linked says so; linked systems listed; Cash Recon needed', async () => {
  const none = await ok(owner.get(`${C}/retrieve`))
  assert.deepEqual(none.sources, [])
  assert.equal((await operator.post(`${C}/retrieve`, { dates: [today] })).status, 422)
  await ok(owner.put(`/api/gloriafood/venues/${V}/link`, {
    method: 'push',
    mappings: {
      income: { [income.id]: [{ sign: 1, kind: 'subtotal' }] },
      takings: { [channel.id]: [{ sign: 1, kind: 'payment', ref: 'CARD' }] },
    },
  }), 'GloriaFood link')
  const linked = await ok(owner.get(`${C}/retrieve`))
  assert.deepEqual(linked.sources, [{ key: 'gloriafood', label: 'GloriaFood' }])
  assert.equal(linked.skip_preview, false)
  assert.equal(linked.auto_fill, false)
  assert.equal(linked.auto_fill_at, '06:00')
  assert.equal((await viewer.get(`${C}/retrieve`)).status, 403, 'no Cash Recon: refused')
  assert.equal((await viewer.post(`${C}/retrieve`, { dates: [today] })).status, 403)
  assert.equal((await other.get(`${C}/retrieve`)).status, 404, 'another tenant')
})

test('Retrieve fills every linked system and remembers what it wrote', async () => {
  const d1 = addDays(today, -1)
  await order(d1, 2500)
  const res = await ok(operator.post(`${C}/retrieve`, { dates: [d1] }))
  assert.equal(res.sources.length, 1)
  assert.deepEqual(res.sources[0].filled, [d1])
  assert.equal(incomeOf(await day(d1)), 25)
  const [kept] = await sql`SELECT amount::float8 AS amount, source FROM cash_fill_values f
                            JOIN cash_daily_reports r ON r.id = f.report_id
                           WHERE r.venue_id = ${V} AND r.report_date = ${d1} AND f.field_id = ${income.id}`
  assert.deepEqual(kept, { amount: 25, source: 'gloriafood' })
})

test('Retrieve over several days leaves out days with no sales and days still to come', async () => {
  const res = await ok(operator.post(`${C}/retrieve`, { dates: [addDays(today, -6), addDays(today, -5), addDays(today, 1)] }))
  const s = res.sources[0]
  assert.deepEqual(s.filled, [])
  assert.deepEqual(s.skipped.map(x => x.reason).sort(), ['no_sales', 'no_sales', 'not_yet'])
  assert.equal(await ok(owner.get(`${C}/daily/${addDays(today, 1)}`)), null, 'no report made for tomorrow')
})

test('the settings: skip the preview, the scheduled fill and its time; owner / admin only', async () => {
  assert.equal((await operator.patch(`${C}/settings`, { auto_fill: true })).status, 403)
  assert.equal((await owner.patch(`${C}/settings`, { auto_fill_at: '25:00' })).status, 400)
  const row = await ok(owner.patch(`${C}/settings`, { retrieve_skip_preview: true, auto_fill: true, auto_fill_at: '05:30' }))
  assert.equal(row.retrieve_skip_preview, true)
  assert.equal(row.auto_fill, true)
  const cfg = await ok(owner.get(`${C}/config`))
  assert.equal(cfg.venue_settings.auto_fill_at, '05:30')
  assert.equal(cfg.venue_settings.retrieve_skip_preview, true)
  assert.equal(cfg.venue_settings.submit_mode, 'daily', 'the others kept')
})

test('the scheduled fill: the day just ended and two before, hand figures kept, submitted days left, once a day', async () => {
  const [d3, d2, d1] = autoFillDates(today)
  assert.deepEqual([d3, d2, d1], [addDays(today, -3), addDays(today, -2), addDays(today, -1)])
  await order(d2, 4000)
  await order(d3, 1000)
  // d1 was filled with 25 above; its orders grow to 31.
  await order(d1, 600)
  // Someone types over d1's takings by hand after the fill.
  const before = await day(d1)
  await ok(owner.put(`${C}/daily/${d1}`, {
    income: [{ source_id: income.id, gross_amount: 25 }],
    takings: [{ channel_id: channel.id, amount: 99 }],
  }))
  // d3 is submitted.
  await ok(owner.put(`${C}/daily/${d3}`, { income: [{ source_id: income.id, gross_amount: 1 }] }))
  await ok(owner.post(`${C}/daily/${d3}/submit`, {}))
  assert.ok(before)

  // Before the time: nothing runs.
  const early = new Date(today + 'T04:00:00Z')
  assert.equal(await sweepAutoFill(quiet, { at: early }), 0)
  const at = new Date(today + 'T06:00:00Z')
  assert.equal(await sweepAutoFill(quiet, { at }), 1, 'runs once its time has come')
  assert.equal(await sweepAutoFill(quiet, { at }), 0, 'once a day')

  const r1 = await day(d1)
  assert.equal(incomeOf(r1), 31, 'the field the last fill wrote is filled again')
  assert.equal(Number(r1.takings_entries.find(e => e.channel_id === channel.id).amount), 99, 'the hand figure is kept')
  assert.equal(incomeOf(await day(d2)), 40, 'an empty day is filled')
  assert.equal(incomeOf(await day(d3)), 1, 'a submitted day is left as it is')

  const status = await ok(owner.get(`${C}/retrieve`))
  assert.ok(status.last_auto_fill?.at, 'when it ran')
  assert.equal(status.last_auto_fill.error, null)
  const src = status.last_auto_fill.result.sources[0]
  assert.deepEqual(src.filled, [d2, d1])
  assert.deepEqual(src.skipped, [{ date: d3, reason: 'submitted' }])
  assert.deepEqual(src.kept.map(k => [k.date, k.group, k.name]), [[d1, 'takings', 'Online card']])

  // A new time runs again today once it has come.
  await ok(owner.patch(`${C}/settings`, { auto_fill_at: '07:00' }))
  assert.equal(await sweepAutoFill(quiet, { at }), 0, 'not before 07:00')
  assert.equal(await sweepAutoFill(quiet, { at: new Date(today + 'T07:05:00Z') }), 1)
  await ok(owner.patch(`${C}/settings`, { auto_fill: false }))
  assert.equal(await sweepAutoFill(quiet, { at: new Date(today + 'T23:00:00Z') }), 0, 'off')
})

// The receipt when a check is paid and how the till asks for a new order's
// order type, name and tent number (migrations 224 and 226): per revenue
// stream since migration 296 (they were venue settings), with a till's own
// choice; both reach the till in its config (shared/pos/tillSettings.js
// receiptModeOf() / orderPromptOf() decide on the till).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { receiptModeOf, orderPromptOf } from '../../shared/pos/tillSettings.js'

let ids, owner, viewer, V, till

async function config(d) {
  const app = await getApp()
  const res = await app.inject({
    method: 'GET', url: '/pos-api/config',
    headers: { authorization: `Device ${d.device_id}.${d.secret}`, [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET },
  })
  assert.equal(res.statusCode, 200, res.body)
  return res.json()
}

const streamBody = s => ({
  name: s.name, menu_ids: s.menu_ids, colour: s.colour, is_active: s.is_active, default_order_type_id: s.default_order_type_id,
  order_types: s.order_types, covers: s.covers, courses: s.courses, seats: s.seats, receipt_mode: s.receipt_mode, order_prompt: s.order_prompt,
})

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc' })
  owner = as(A.owner, ids.a)
  viewer = as(A.viewer, ids.a)
  V = filled.ids.venue
  till = await linkDevice(owner, V, { kind: 'terminal', name: 'Zqp Till' })
})
after(closeApp)

test('a stream\'s receipt and order prompt: ask and one screen until changed, saved, refused when wrong', async () => {
  const setup = await ok(owner.get('/api/pos/venues/' + V + '/setup'))
  assert.equal(setup.settings.receipt_mode, undefined, 'not a venue setting any more')
  assert.equal(setup.settings.order_prompt, undefined, 'not a venue setting any more')
  const s = setup.revenue_streams[0]
  assert.deepEqual([s.receipt_mode, s.order_prompt], ['ask', 'one'])
  const made = await ok(owner.post(`/api/pos/venues/${V}/revenue-streams`, { name: 'Zqp Kiosk', receipt_mode: 'never', order_prompt: 'two' }))
  assert.deepEqual([made.receipt_mode, made.order_prompt], ['never', 'two'])
  const saved = await ok(owner.patch('/api/pos/revenue-streams/' + s.id, { ...streamBody(s), receipt_mode: 'always', order_prompt: 'two' }))
  assert.deepEqual([saved.receipt_mode, saved.order_prompt], ['always', 'two'])
  assert.equal((await owner.patch('/api/pos/revenue-streams/' + s.id, { ...streamBody(s), receipt_mode: 'sometimes' })).status, 400)
  assert.equal((await owner.patch('/api/pos/revenue-streams/' + s.id, { ...streamBody(s), order_prompt: 'three' })).status, 400)
  assert.equal((await viewer.patch('/api/pos/revenue-streams/' + s.id, { ...streamBody(s), receipt_mode: 'never' })).status, 403)
  assert.equal((await as(B.owner, ids.b).patch('/api/pos/revenue-streams/' + s.id, { ...streamBody(s), receipt_mode: 'never' })).status, 404)
  const [row] = await sql`SELECT receipt_mode, order_prompt FROM pos_revenue_streams WHERE id = ${s.id}`
  assert.deepEqual([row.receipt_mode, row.order_prompt], ['always', 'two'])
  // The venue's settings no longer take them (left out quietly, nothing stored).
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { tips_enabled: true, receipt_mode: 'never', order_prompt: 'one' }))
  const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'pos_settings' AND column_name IN ('receipt_mode', 'order_prompt')`
  assert.equal(cols.length, 0, 'the venue columns are gone')
  // The streams reach the till.
  const cfg = await config(till)
  const inCfg = cfg.revenue_streams.find(x => x.id === s.id)
  assert.deepEqual([inCfg.receipt_mode, inCfg.order_prompt], ['always', 'two'])
})

test('a till "as the revenue stream" follows the check\'s stream; its own choice wins', async () => {
  const setup = await ok(owner.get('/api/pos/venues/' + V + '/setup'))
  const [first, kiosk] = [setup.revenue_streams[0], setup.revenue_streams.find(x => x.name === 'Zqp Kiosk')]
  const d = await ok(owner.patch('/api/pos/devices/' + till.id, { settings: { mode: 'counter', revenue_stream_id: first.id, receipt_mode: 'stream', order_prompt: 'stream' } }))
  assert.deepEqual([d.settings.receipt_mode, d.settings.order_prompt], ['stream', 'stream'])
  assert.equal((await owner.patch('/api/pos/devices/' + till.id, { settings: { mode: 'counter', order_prompt: 'venue' } })).status, 400, 'venue is gone')
  assert.equal((await owner.patch('/api/pos/devices/' + till.id, { settings: { mode: 'counter', receipt_mode: 'bogus' } })).status, 400)
  let cfg = await config(till)
  assert.equal(receiptModeOf(cfg), 'always', 'no check: the till\'s own stream')
  assert.equal(receiptModeOf(cfg, kiosk.id), 'never', 'a check moved to the kiosk stream')
  assert.equal(orderPromptOf(cfg, kiosk.id), 'two')
  await ok(owner.patch('/api/pos/devices/' + till.id, { settings: { mode: 'counter', revenue_stream_id: first.id, receipt_mode: 'ask', order_prompt: 'one' } }))
  cfg = await config(till)
  assert.deepEqual([cfg.device.settings.receipt_mode, cfg.device.settings.order_prompt], ['ask', 'one'])
  assert.equal(receiptModeOf(cfg, kiosk.id), 'ask', 'the till\'s own')
  assert.equal(orderPromptOf(cfg, kiosk.id), 'one', 'the till\'s own')
  assert.equal((await as(B.owner, ids.b).patch('/api/pos/devices/' + till.id, { settings: { mode: 'counter', order_prompt: 'two' } })).status, 404)
})

test('migration 296 copies each venue\'s values onto its streams and moves tills from venue to stream', async () => {
  // Put the venue columns back as they were before the migration, with values.
  await sql`ALTER TABLE pos_settings ADD COLUMN receipt_mode text NOT NULL DEFAULT 'ask'`
  await sql`ALTER TABLE pos_settings ADD COLUMN order_prompt text NOT NULL DEFAULT 'one'`
  await sql`UPDATE pos_settings SET receipt_mode = 'never', order_prompt = 'two' WHERE venue_id = ${V}`
  await sql`UPDATE pos_revenue_streams SET receipt_mode = 'ask', order_prompt = 'one' WHERE venue_id = ${V}`
  await sql`UPDATE pos_devices SET settings = settings || '{"receipt_mode": "venue", "order_prompt": "venue"}'::jsonb WHERE id = ${till.id}`
  const others = await sql`SELECT id, receipt_mode, order_prompt FROM pos_revenue_streams WHERE venue_id <> ${V} ORDER BY id`
  await sql.unsafe(readFileSync(new URL('../../migrations/296_till_stream_receipt_prompt.sql', import.meta.url), 'utf8'))
  const streams = await sql`SELECT receipt_mode, order_prompt FROM pos_revenue_streams WHERE venue_id = ${V}`
  assert.ok(streams.length >= 2)
  for (const s of streams) assert.deepEqual([s.receipt_mode, s.order_prompt], ['never', 'two'], 'the venue\'s values')
  assert.deepEqual(await sql`SELECT id, receipt_mode, order_prompt FROM pos_revenue_streams WHERE venue_id <> ${V} ORDER BY id`, others, 'other venues keep their own')
  const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'pos_settings' AND column_name IN ('receipt_mode', 'order_prompt')`
  assert.equal(cols.length, 0, 'the venue columns are dropped')
  const [d] = await sql`SELECT settings FROM pos_devices WHERE id = ${till.id}`
  assert.deepEqual([d.settings.receipt_mode, d.settings.order_prompt], ['stream', 'stream'])
})

test('migration 295 makes every till ask before leaving with items not sent', async () => {
  await sql`UPDATE pos_devices SET settings = settings || '{"leave_unsent": "leave"}'::jsonb WHERE id = ${till.id}`
  await sql.unsafe(readFileSync(new URL('../../migrations/295_till_leave_unsent_ask.sql', import.meta.url), 'utf8'))
  const [d] = await sql`SELECT settings FROM pos_devices WHERE id = ${till.id}`
  assert.equal(d.settings.leave_unsent, 'ask')
  const kds = await sql`SELECT count(*)::int AS n FROM pos_devices WHERE kind <> 'terminal' AND settings ? 'leave_unsent'`
  assert.equal(kds[0].n, 0, 'only tills')
})

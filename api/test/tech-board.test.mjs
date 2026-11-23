// A venue's Tech board (routes/techBoard.js, migration 263): its kit with
// the last thing each did, read from what is stored; Store tech or Screens
// view; another group's venue refused; the menu link before Tills.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { as, ok, sql, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { sellTwoDays } from './support/tillDays.mjs'

let ids, owner, V, filled
before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  await sellTwoDays({ owner, tenantId: ids.a, filled })
  V = filled.ids.venue
})
after(closeApp)

test('the board: kit, states to judge by, the last thing each did', async () => {
  const b = await ok(owner.get('/api/tech-board/venues/' + V))
  assert.deepEqual(b.can, { kit: true, screens: true })
  // The till the test sales were rung up on (it calls the till API); the fixtures' own till never has.
  const till = b.devices.find(d => d.kind === 'terminal' && d.name === 'Zrp Till')
  assert.ok(till?.paired, 'the linked till')
  const quiet = b.devices.find(d => d.kind === 'terminal' && d.paired && d.id !== till.id)
  if (quiet) assert.equal(quiet.last_action, null, 'a till that has done nothing yet')
  assert.ok(till.last_seen_at, 'when it was last heard from')
  assert.equal(till.last_action?.what, 'event', 'its last activity, from its events')
  assert.ok(Date.parse(till.last_action.at) > Date.now() - 3600_000)
  assert.ok(!b.devices.some(d => d.revoked_at), 'removed kit left out')
  const kitchen = b.printers.find(p => /Kitchen/.test(p.name))
  assert.ok(kitchen, 'the printers')
  assert.deepEqual(Object.keys(kitchen.jobs).sort(), ['failed', 'waiting'])
  assert.ok(b.card_readers.length >= 1, 'the card machines')
  assert.ok(Array.isArray(b.screens))

  // A failed ticket shows on its printer; an old heartbeat is the device's last seen.
  await sql`INSERT INTO pos_print_jobs (tenant_id, venue_id, printer_id, kind, ops, status, error)
            VALUES (${ids.a}, ${V}, ${kitchen.id}, 'kitchen', '[]'::jsonb, 'failed', 'Paper jam')`
  await sql`UPDATE pos_devices SET last_seen_at = now() - interval '1 hour' WHERE id = ${till.id}`
  const b2 = await ok(owner.get('/api/tech-board/venues/' + V))
  const k2 = b2.printers.find(p => p.id === kitchen.id)
  assert.equal(k2.jobs.failed, (kitchen.jobs.failed || 0) + 1)
  assert.deepEqual([k2.last_job.status, k2.last_job.error], ['failed', 'Paper jam'])
  assert.ok(Date.parse(b2.devices.find(d => d.id === till.id).last_seen_at) < Date.now() - 50 * 60_000)
})

test('guards: another group\'s venue, no sign-in', async () => {
  assert.equal((await as(B.owner, ids.b).get('/api/tech-board/venues/' + V)).status, 404)
  assert.equal((await as(null, null).get('/api/tech-board/venues/' + V)).status, 401)
  assert.equal((await owner.get('/api/tech-board/venues/not-a-venue')).status, 404)
})

// Migration 263 as written, less the launcher column migration 274 dropped.
const SQL_263 = fs.readFileSync(new URL('../../migrations/263_tech_board_menu.sql', import.meta.url), 'utf8')
  .replace(', show_in_launcher)', ')').replace("'{}'::uuid[]), false", "'{}'::uuid[])")

test('migration 263 puts the link just before Tills, where it was missing', async () => {
  await sql`DELETE FROM nav_items WHERE tenant_id = ${ids.a} AND route = '/pos/board'`
  const [tills] = await sql`SELECT parent_id, sort_order FROM nav_items WHERE tenant_id = ${ids.a} AND route = '/pos/tills'`
  await sql.unsafe(SQL_263)
  const [board] = await sql`SELECT parent_id, sort_order, module FROM nav_items WHERE tenant_id = ${ids.a} AND route = '/pos/board'`
  const [after] = await sql`SELECT sort_order FROM nav_items WHERE tenant_id = ${ids.a} AND route = '/pos/tills'`
  assert.deepEqual([board.parent_id, board.sort_order, board.module], [tills.parent_id, tills.sort_order, 'pos_setup'])
  assert.equal(after.sort_order, tills.sort_order + 1, 'Tills moves down one')
  await sql.unsafe(SQL_263)
  assert.equal((await sql`SELECT 1 FROM nav_items WHERE tenant_id = ${ids.a} AND route = '/pos/board'`).length, 1, 'run again: no second link')
})

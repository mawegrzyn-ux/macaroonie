// Pins on Home (migration 272): each person's own, kept on the server, saved
// as a whole list; only pages of the person's own menu, a venue and a tab only
// where the page's address accepts them, a venue only of the group's own.
import test from 'node:test'
import assert from 'node:assert/strict'
import { as, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'

let ids, venueA, venueB
test.before(async () => {
  ids = await resetAndSeed()
  venueA = await ok(as(A.owner, ids.a).post('/api/venues', { name: 'Pin Ware', slug: 'pin-ware', timezone: 'Europe/London' }))
  venueB = await ok(as(B.owner, ids.b).post('/api/venues', { name: 'Pin Elsewhere', slug: 'pin-elsewhere', timezone: 'Europe/London' }))
})
test.after(closeApp)

test('a new person has no pins; the list is saved whole, in order, and read back the same', async () => {
  const owner = as(A.owner, ids.a)
  assert.deepEqual(await ok(owner.get('/api/pins')), { pins: [], max: 12 })
  const saved = await ok(owner.put('/api/pins', { pins: [
    { path: '/rota', venue_id: venueA.id, label: '  Ware   rota ' },
    { path: '/food-safety', venue_id: venueA.id, tab: 'Holds' },
    { path: '/bookings' },
  ] }))
  assert.deepEqual(saved.pins, [
    { path: '/rota', venue_id: venueA.id, tab: null, label: 'Ware rota' },
    { path: '/food-safety', venue_id: venueA.id, tab: 'holds', label: null },
    { path: '/bookings', venue_id: null, tab: null, label: null },
  ])
  assert.deepEqual((await ok(owner.get('/api/pins'))).pins, saved.pins)
  // Reordered: the whole list again.
  const moved = await ok(owner.put('/api/pins', { pins: [saved.pins[2], saved.pins[0], saved.pins[1]] }))
  assert.deepEqual(moved.pins.map(p => p.path), ['/bookings', '/rota', '/food-safety'])
  const rows = await sql`SELECT path, sort_order FROM home_pins WHERE tenant_id = ${ids.a} AND user_sub = ${A.owner} ORDER BY sort_order`
  assert.deepEqual(rows.map(r => [r.path, r.sort_order]), [['/bookings', 0], ['/rota', 1], ['/food-safety', 2]])
})

test('pins are each person\'s own', async () => {
  assert.deepEqual((await ok(as(A.operator, ids.a).get('/api/pins'))).pins, [])
  await ok(as(A.operator, ids.a).put('/api/pins', { pins: [{ path: '/timeline' }] }))
  assert.equal((await ok(as(A.owner, ids.a).get('/api/pins'))).pins.length, 3, 'the owner\'s are untouched')
  assert.deepEqual((await ok(as(B.owner, ids.b).get('/api/pins'))).pins, [], 'nothing from another group')
})

test('what the page doesn\'t accept is dropped; a page twice at the same place is kept once', async () => {
  const owner = as(A.owner, ids.a)
  const out = await ok(owner.put('/api/pins', { pins: [
    { path: '/menus', venue_id: venueA.id, tab: 'week' },
    { path: '/food-safety', venue_id: venueA.id, tab: 'nonsense' },
    { path: '/rota', venue_id: venueA.id },
    { path: '/rota', venue_id: venueA.id, label: 'again' },
    { path: '/rota', label: '' },
  ] }))
  assert.deepEqual(out.pins, [
    { path: '/menus', venue_id: null, tab: null, label: null },
    { path: '/food-safety', venue_id: venueA.id, tab: null, label: null },
    { path: '/rota', venue_id: venueA.id, tab: null, label: null },
    { path: '/rota', venue_id: null, tab: null, label: null },
  ])
})

test('refused: a page not in the person\'s menu, another group\'s venue, more than 12, a bad shape', async () => {
  const owner = as(A.owner, ids.a)
  const before = (await ok(owner.get('/api/pins'))).pins
  assert.equal((await owner.put('/api/pins', { pins: [{ path: '/nowhere' }] })).status, 400)
  assert.equal((await owner.put('/api/pins', { pins: [{ path: '/rota', venue_id: venueB.id }] })).status, 404)
  assert.equal((await owner.put('/api/pins', { pins: Array.from({ length: 13 }, () => ({ path: '/rota' })) })).status, 400)
  assert.equal((await owner.put('/api/pins', { pins: [{ path: '/rota', venue_id: 'x' }] })).status, 400)
  assert.equal((await owner.put('/api/pins', {})).status, 400)
  assert.deepEqual((await ok(owner.get('/api/pins'))).pins, before, 'nothing changed')
  // A viewer can't pin a page their role can't open (Team is for owners and admins).
  assert.equal((await as(A.viewer, ids.a).put('/api/pins', { pins: [{ path: '/team' }] })).status, 400)
  assert.equal((await as(null, null).get('/api/pins')).status, 401)
})

test('a pin whose page leaves the person\'s menu is not sent; a deleted venue leaves the page', async () => {
  const op = as(A.operator, ids.a)
  await ok(op.put('/api/pins', { pins: [{ path: '/timeline' }, { path: '/rota', venue_id: venueA.id }] }))
  await sql`UPDATE nav_items SET is_active = false WHERE tenant_id = ${ids.a} AND route = '/timeline'`
  assert.deepEqual((await ok(op.get('/api/pins'))).pins.map(p => p.path), ['/rota'])
  await sql`UPDATE nav_items SET is_active = true WHERE tenant_id = ${ids.a} AND route = '/timeline'`
  assert.deepEqual((await ok(op.get('/api/pins'))).pins.map(p => p.path), ['/timeline', '/rota'], 'back with the link')
  await sql`UPDATE home_pins SET venue_id = NULL WHERE tenant_id = ${ids.a} AND venue_id = ${venueA.id}`
  assert.equal((await ok(op.get('/api/pins'))).pins[1].venue_id, null)
})

// Launcher mode is gone (migration 274): no tiles or style on /api/me, no style switch.
test('no launcher: /api/me has no launcher tiles or style, and there is no style switch', async () => {
  const me = await ok(as(A.owner, ids.a).get('/api/me'))
  assert.equal(me.launcher_tiles, undefined)
  assert.equal(me.current_tenant.nav_style, undefined)
  assert.equal((await as(A.owner, ids.a).patch('/api/nav/style', { nav_style: 'launcher' })).status, 404)
})

// Migration 274 on real rows: a group in launcher mode gives each member with
// no pins its tiles as pins (in the tiles' order, each page once, at most 12),
// then the launcher columns go. The test database has 274 applied, so the
// columns are put back for the run. Read straight from the table: the API's
// connections hold plans for nav_items' columns, which the run changes twice.
test('migration 274: launcher tiles become pins, then launcher mode goes', async () => {
  const fs = await import('node:fs')
  const SQL_274 = fs.readFileSync(new URL('../../migrations/274_shell_launcher_retired.sql', import.meta.url), 'utf8')
  const pinsOf = async (t, sub) => (await sql`SELECT path FROM home_pins WHERE tenant_id = ${t} AND user_sub = ${sub} ORDER BY sort_order`).map(r => r.path)
  const ownerBefore = await pinsOf(ids.a, A.owner)
  await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS nav_style text NOT NULL DEFAULT 'sidebar'`
  await sql`ALTER TABLE nav_items ADD COLUMN IF NOT EXISTS show_in_launcher boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS launcher_sort_order int NOT NULL DEFAULT 0`
  await sql`UPDATE tenants SET nav_style = 'launcher' WHERE id = ${ids.a}`
  await sql`DELETE FROM home_pins WHERE tenant_id = ${ids.a} AND user_sub <> ${A.owner}`
  const tile = (route, n) => sql`UPDATE nav_items SET show_in_launcher = true, launcher_sort_order = ${n} WHERE tenant_id = ${ids.a} AND route = ${route}`
  await tile('/timeline', 2); await tile('/rota', 1); await tile('/bookings', 3)
  // Tenant B stays on the sidebar: its flagged link isn't pinned.
  await sql`UPDATE nav_items SET show_in_launcher = true WHERE tenant_id = ${ids.b} AND route = '/rota'`

  await sql.unsafe(SQL_274)

  assert.deepEqual(await pinsOf(ids.a, A.operator), ['/rota', '/timeline', '/bookings'], 'the tiles, in their order')
  assert.deepEqual(await pinsOf(ids.a, A.viewer), ['/rota', '/timeline', '/bookings'], 'every member with a login (the API shows each only what their menu holds)')
  assert.deepEqual(await pinsOf(ids.a, A.owner), ownerBefore, 'someone with pins keeps their own')
  assert.deepEqual(await pinsOf(ids.b, B.owner), [], 'a group on the sidebar gets none')
  const cols = await sql`SELECT table_name, column_name FROM information_schema.columns
                          WHERE (table_name = 'tenants' AND column_name = 'nav_style')
                             OR (table_name = 'nav_items' AND column_name IN ('show_in_launcher', 'launcher_sort_order'))`
  assert.equal(cols.length, 0, 'the launcher columns are gone')
})

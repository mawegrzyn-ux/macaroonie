// The Allergen lookup without Menus access (migration 258, OUTSTANDING 44
// item 1): a role with the `allergens` module and no Menus reads the live
// allergens of a published menu, but not the draft; a role with neither is
// refused; the Overview tile and the dashboard widget follow the module, and
// Pepper's find_dishes answers from live menus for it.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, closeApp, sql } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { menuSaveBody } from '../src/routes/menus.js'
import { toolAllowed, audienceTools } from '../src/ai/tools/index.js'
import { WIDGET_MODULE } from '../src/routes/hsDashboards.js'
import { TILE_MODULE } from '../src/routes/dashboardTiles.js'

const HOST = 'a-host'
const NONE = 'a-nobody'
let ids, owner, host, nobody, other, menu

before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  other = as(B.owner, ids.b)
  // A Host: answers allergy questions, has no Menus.
  const hostRole = await ok(owner.post('/api/access/roles', {
    key: 'host', label: 'Host', permissions: { allergens: 'view', menus: 'none', bookings: 'manage' },
  }), 'host role')
  const noneRole = await ok(owner.post('/api/access/roles', {
    key: 'runner', label: 'Runner', permissions: { allergens: 'none', menus: 'none' },
  }), 'runner role')
  await sql`INSERT INTO users (tenant_id, email, role, auth0_user_id, custom_role_id)
            VALUES (${ids.a}, ${HOST + '@test.local'}, 'operator', ${HOST}, ${hostRole.id}),
                   (${ids.a}, ${NONE + '@test.local'}, 'operator', ${NONE}, ${noneRole.id})`
  host = as(HOST, ids.a)
  nobody = as(NONE, ids.a)

  const m = await ok(owner.post('/api/menus', { name: 'Lunch', slug: 'lunch-al' }))
  const full = await ok(owner.get(`/api/menus/${m.id}`))
  await ok(owner.patch(`/api/menus/${m.id}`, {
    ...menuSaveBody(full),
    sections: [{ title: 'Mains', items: [{ name: 'Pad Thai', price_pence: 1000 }, { name: 'Jasmine Rice', price_pence: 300 }] }],
  }))
  menu = await ok(owner.get(`/api/menus/${m.id}`))
  const matrix = await ok(owner.get(`/api/menus/${m.id}/allergens`))
  const peanuts = matrix.tags.find(t => t.standard_key === 'peanuts')
  const pad = menu.sections[0].items.find(i => i.name === 'Pad Thai')
  await ok(owner.put(`/api/menus/${m.id}/allergens`, { items: [{ item_id: pad.id, levels: { [peanuts.id]: 'contains' } }] }))
  await ok(owner.post(`/api/menus/${m.id}/publish`, {}))
})
after(closeApp)

test('the lookup reads live allergens with the Allergen lookup alone; the draft needs Menus', async () => {
  const live = await ok(host.get(`/api/menus/${menu.id}/allergens?version=live`), 'live lookup')
  const pad = live.sections.flatMap(s => s.items).find(i => i.name === 'Pad Thai')
  assert.equal(Object.values(pad.levels)[0], 'contains', 'the live allergen is there')

  const draft = await host.get(`/api/menus/${menu.id}/allergens`)
  assert.equal(draft.status, 403, 'the draft is the matrix: Menus only')

  const none = await nobody.get(`/api/menus/${menu.id}/allergens?version=live`)
  assert.equal(none.status, 403, 'neither module: refused')

  // The owner still reads both; another tenant can't read this menu.
  await ok(owner.get(`/api/menus/${menu.id}/allergens`))
  const cross = await other.get(`/api/menus/${menu.id}/allergens?version=live`)
  assert.equal(cross.status, 404, 'another tenant gets nothing')
})

test('the matrix save stays Menus manage', async () => {
  const res = await host.put(`/api/menus/${menu.id}/allergens`, { items: [] })
  assert.equal(res.status, 403)
})

test('/me: the module, the menu link and the Overview tile follow Allergen lookup', async () => {
  await ok(owner.post('/api/dashboard-tiles', { tile_type: 'allergen_lookup' }), 'tile')
  const hostMe = await ok(host.get('/api/me'))
  assert.equal(hostMe.permissions.allergens, 'view')
  assert.ok(hostMe.dashboard_tiles.some(t => t.tile_type === 'allergen_lookup'), 'the tile for the host')
  const nobodyMe = await ok(nobody.get('/api/me'))
  assert.ok(!nobodyMe.dashboard_tiles.some(t => t.tile_type === 'allergen_lookup'), 'no tile without the module')
  const links = []
  const walk = list => { for (const n of list || []) { if (n.route) links.push(n.route); walk(n.children) } }
  walk(hostMe.nav_tree)
  assert.ok(links.includes('/allergens'), 'the Allergens link for the host')
  assert.ok(!links.includes('/menus/allergens'), 'not the matrix')
  const nobodyLinks = []
  const walk2 = list => { for (const n of list || []) { if (n.route) nobodyLinks.push(n.route); walk2(n.children) } }
  walk2(nobodyMe.nav_tree)
  assert.ok(!nobodyLinks.includes('/allergens'), 'no link without the module')
  // The built-in roles have it by default.
  const viewerMe = await ok(as(A.viewer, ids.a).get('/api/me'))
  assert.equal(viewerMe.permissions.allergens, 'view')
})

test('the dashboard widget and the tile are gated by the Allergen lookup', () => {
  assert.equal(WIDGET_MODULE.allergen_lookup, 'allergens')
  assert.equal(TILE_MODULE.allergen_lookup, 'allergens')
})

test('Pepper: find_dishes is listed and answers from live menus with the Allergen lookup alone', async () => {
  const find = audienceTools('staff').find(t => t.name === 'find_dishes')
  assert.ok(toolAllowed(find, { allergens: 'view', menus: 'none' }), 'listed with the lookup')
  assert.ok(toolAllowed(find, { menus: 'view' }), 'listed with Menus')
  assert.ok(!toolAllowed(find, { allergens: 'none', menus: 'none' }), 'not with neither')
  const getMenu = audienceTools('staff').find(t => t.name === 'get_menu')
  assert.ok(!toolAllowed(getMenu, { allergens: 'view', menus: 'none' }), 'other menu tools still need Menus')
})

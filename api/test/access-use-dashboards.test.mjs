// Two access changes (migration 229): a Use level between View and Manage on
// checklists, food safety logs and the H&S action log (the everyday work
// without the setup), and dashboards hidden from roles (hidden_role_ids, like
// menu links and Overview tiles).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, closeApp, sql } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { toolAllowed, audienceTools } from '../src/ai/tools/index.js'
import { levelsOf, workLevel, resolvePermission, permissionAtLeast } from '../src/config/modules.js'

const SUP = 'a-supervisor'
let ids, owner, viewer, sup, V, roles, supRole

before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  viewer = as(A.viewer, ids.a)
  const venue = await ok(owner.post('/api/venues', { name: 'Ware', slug: 'thai-ware', timezone: 'Europe/London' }), 'venue')
  V = venue.id
  roles = await ok(owner.get('/api/access/roles'), 'roles')
  // A Supervisor: completes checklists and logs checks, sets nothing up.
  supRole = await ok(owner.post('/api/access/roles', {
    key: 'supervisor', label: 'Supervisor',
    permissions: { checklists: 'use', food_safety: 'use', hs_action_log: 'use', hs_dashboard: 'view' },
  }), 'supervisor role')
  await sql`INSERT INTO users (tenant_id, email, role, auth0_user_id, custom_role_id)
            VALUES (${ids.a}, ${SUP + '@test.local'}, 'operator', ${SUP}, ${supRole.id})`
  sup = as(SUP, ids.a)
})
after(closeApp)

const role = key => roles.find(r => r.key === key)

test('the levels: Use only where a module offers it, ranked between View and Manage', async () => {
  assert.deepEqual(levelsOf('checklists'), ['none', 'view', 'use', 'manage'])
  assert.deepEqual(levelsOf('food_safety'), ['none', 'view', 'use', 'manage'])
  assert.deepEqual(levelsOf('hs_action_log'), ['none', 'view', 'use', 'manage'])
  assert.deepEqual(levelsOf('cash_recon'), ['none', 'view', 'manage'])
  assert.equal(workLevel('checklists'), 'use')
  assert.equal(workLevel('cash_recon'), 'manage')
  assert.ok(permissionAtLeast('use', 'view') && permissionAtLeast('manage', 'use') && !permissionAtLeast('view', 'use') && !permissionAtLeast('use', 'manage'))
  assert.ok(!permissionAtLeast(undefined, 'view') && !permissionAtLeast('nonsense', 'view'), 'an unknown level passes nothing')
  // A 'use' stored where it isn't offered counts as view, never more.
  assert.equal(resolvePermission('cash_recon', { cash_recon: 'use' }, null), 'view')
  assert.equal(resolvePermission('checklists', { checklists: 'use' }, null), 'use')

  const mods = await ok(owner.get('/api/access/modules'))
  assert.deepEqual(mods.find(m => m.key === 'checklists').levels, ['none', 'view', 'use', 'manage'])
  assert.deepEqual(mods.find(m => m.key === 'cash_recon').levels, ['none', 'view', 'manage'])
  assert.match(mods.find(m => m.key === 'food_safety').use, /Log and correct/)

  // The role routes refuse Use where it isn't offered.
  const bad = await owner.post('/api/access/roles', { key: 'cashier', label: 'Cashier', permissions: { cash_recon: 'use' } })
  assert.equal(bad.status, 400)
  assert.match(bad.json.error, /Cash reconciliation has no use level/)
  const bad2 = await owner.patch(`/api/access/roles/${supRole.id}`, { permissions: { checklists: 'use', menus: 'use' } })
  assert.equal(bad2.status, 400)
  const fine = await owner.patch(`/api/access/roles/${role('viewer').id}`, { permissions: { ...role('viewer').permissions, checklists: 'view' } })
  assert.equal(fine.status, 200, 'the built-in roles still save')

  const me = await ok(sup.get('/api/me'))
  assert.equal(me.permissions.checklists, 'use')
  assert.equal(me.permissions.food_safety, 'use')
  assert.equal(me.permissions.hs_dashboard, 'view')
  assert.equal(me.permissions.cash_recon, 'none')
})

test('Use ticks checklists, logs and corrects checks and adds actions; the setup and deleting need Manage', async () => {
  const tpl = await ok(owner.post('/api/checklists/templates', { venue_id: V, name: 'Opening', frequency: 'daily' }))
  const item = await ok(owner.post(`/api/checklists/templates/${tpl.id}/items`, { label: 'Lights on' }))
  const fridge = await ok(owner.post('/api/food-safety/equipment', { venue_id: V, name: 'Walk-in', equipment_type: 'fridge', min_temp_c: 0, max_temp_c: 5 }))
  const time = await ok(owner.post('/api/food-safety/capture-times', { venue_id: V, label: 'Morning', time_of_day: '09:00' }))
  const date = '2026-10-31'

  // Checklists: tick yes, build no.
  const ticked = await sup.put('/api/checklists/instance', { template_id: tpl.id, date, items: [{ template_item_id: item.id, checked: true }], notes: 'All good' })
  assert.equal(ticked.status, 200, 'Use ticks a checklist: ' + ticked.body)
  assert.equal(ticked.json.status, 'completed')
  const build = await sup.post('/api/checklists/templates', { venue_id: V, name: 'Closing', frequency: 'daily' })
  assert.equal(build.status, 403)
  assert.equal(build.json.error, 'Your role can use Checklists but not change how it is set up.')
  const view = await viewer.put('/api/checklists/instance', { template_id: tpl.id, date, items: [{ template_item_id: item.id, checked: false }] })
  assert.equal(view.status, 403, 'View still only looks')
  assert.equal(view.json.error, 'Your role can view Checklists but not change it.')

  // Food safety: log and correct yes; set up and delete no.
  const log = await sup.post('/api/food-safety/temp-logs', { venue_id: V, equipment_id: fridge.id, capture_time_id: time.id, log_date: date, temperature_c: 8 })
  assert.equal(log.status, 200, 'Use logs a fridge reading: ' + log.body)
  const fix = await sup.patch(`/api/food-safety/temp-logs/${log.json.id}`, { corrective_action: 'Moved stock, door shut' })
  assert.equal(fix.status, 200, 'and adds the corrective action')
  const setup = await sup.post('/api/food-safety/equipment', { venue_id: V, name: 'Freezer', equipment_type: 'freezer', min_temp_c: -25, max_temp_c: -18 })
  assert.equal(setup.status, 403, 'no equipment setup')
  const cook = await sup.post('/api/food-safety/cooking', { venue_id: V, check_date: date, dish_name: 'Chicken curry', core_temp_c: 79 })
  assert.equal(cook.status, 200, 'Use logs a cooking check: ' + cook.body)
  assert.equal((await sup.patch(`/api/food-safety/cooking/${cook.json.id}`, { core_temp_c: 81 })).status, 200, 'and corrects it')
  assert.equal((await sup.delete(`/api/food-safety/cooking/${cook.json.id}`)).status, 403, 'but can\'t delete it')
  assert.equal((await owner.delete(`/api/food-safety/cooking/${cook.json.id}`)).status, 200, 'Manage deletes it')

  // Action log: add, change, tick off; delete and categories need Manage.
  const entry = await sup.post('/api/hs-action-log/entries', { venue_id: V, task: 'Fix the door', priority: 'medium' })
  assert.equal(entry.status, 200, 'Use adds an action: ' + entry.body)
  assert.equal((await sup.patch(`/api/hs-action-log/entries/${entry.json.id}`, { notes: 'Called the joiner' })).status, 200)
  assert.equal((await sup.patch(`/api/hs-action-log/entries/${entry.json.id}/complete`, { is_completed: true })).status, 200)
  assert.equal((await sup.delete(`/api/hs-action-log/entries/${entry.json.id}`)).status, 403)
  assert.equal((await sup.post('/api/hs-action-log/categories', { name: 'Pest control' })).status, 403)
  assert.equal((await viewer.post('/api/hs-action-log/entries', { venue_id: V, task: 'Nope' })).status, 403)

  // Today: the supervisor can do the checks there; the viewer only looks.
  await ok(owner.post('/api/food-safety/capture-times', { venue_id: V, label: 'Evening', time_of_day: '18:00' }))
  await ok(owner.post('/api/checklists/templates', { venue_id: V, name: 'Closing down', frequency: 'daily' })).then(t =>
    ok(owner.post(`/api/checklists/templates/${t.id}/items`, { label: 'Fryers off' })))
  await ok(sup.post('/api/hs-action-log/entries', { venue_id: V, task: 'Descale the dishwasher', priority: 'high', due_date: date }))
  const feed = await ok(sup.get(`/api/ops/today?venue_id=${V}&date=${date}&time=08:30`))
  const kinds = feed.tasks.map(t => t.kind)
  for (const k of ['fridge_check', 'checklist', 'hs_action']) assert.ok(kinds.includes(k), k + ' in the feed: ' + kinds.join(', '))
  assert.ok(feed.tasks.every(t => t.can_act === true), 'every task the supervisor sees can be done: ' + JSON.stringify(feed.tasks.map(t => [t.kind, t.can_act])))
  assert.deepEqual(feed.not_included, ['cash', 'online_orders', 'purchasing'], 'areas without access left out')
  const vfeed = await ok(viewer.get(`/api/ops/today?venue_id=${V}&date=${date}&time=08:30`))
  const vtasks = vfeed.tasks.filter(t => ['fridge_check', 'checklist', 'hs_action'].includes(t.kind))
  assert.ok(vtasks.length >= 3 && vtasks.every(t => t.can_act === false), 'View sees them, can\'t do them')
})

test('Pepper: the H&S change tools need Use, the connector lists them for Use', () => {
  const staff = audienceTools('staff')
  const hsChange = staff.filter(t => t.section === 'hs' && t.confirm)
  assert.ok(hsChange.length >= 8)
  assert.ok(hsChange.every(t => t.needs === 'use'), 'every H&S change tool says it needs Use')
  const useLevels = { checklists: 'use', food_safety: 'use', hs_action_log: 'use' }
  const viewLevels = { checklists: 'view', food_safety: 'view', hs_action_log: 'view' }
  assert.ok(hsChange.every(t => toolAllowed(t, useLevels)), 'listed for Use')
  assert.ok(hsChange.every(t => !toolAllowed(t, viewLevels)), 'not for View')
  const cashChange = staff.find(t => t.section === 'cash' && t.confirm)
  assert.ok(!toolAllowed(cashChange, { cash_recon: 'use' }), 'a stored use elsewhere doesn\'t open change tools')
  assert.ok(toolAllowed(cashChange, { cash_recon: 'manage' }))
})

test('dashboards: hidden from roles, every dashboard while editing the layout', async () => {
  const kitchen = await ok(owner.post('/api/hs-dashboards/dashboards', { venue_id: V, name: 'Kitchen' }))
  const managers = await ok(owner.post('/api/hs-dashboards/dashboards', { venue_id: V, name: 'Managers', hidden_role_ids: [role('viewer').id, supRole.id] }))
  assert.deepEqual([...managers.hidden_role_ids].sort(), [role('viewer').id, supRole.id].sort(), 'made hidden from two roles')
  const w = await ok(owner.post(`/api/hs-dashboards/dashboards/${managers.id}/widgets`, { widget_type: 'temp_checks' }))
  assert.ok(w.id)

  const names = list => list.map(d => d.name).sort()
  // The viewer (hs_dashboard view) and the supervisor (custom role) don't see it.
  assert.deepEqual(names(await ok(viewer.get(`/api/hs-dashboards/dashboards?venue_id=${V}`))), ['Kitchen'])
  assert.deepEqual(names(await ok(sup.get(`/api/hs-dashboards/dashboards?venue_id=${V}`))), ['Kitchen'], 'hidden by the custom role')
  assert.deepEqual(names(await ok(viewer.get(`/api/hs-dashboards/dashboards?venue_id=${V}&all=1`))), ['Kitchen'], 'all=1 needs Manage')
  assert.equal((await viewer.get(`/api/hs-dashboards/dashboards/${managers.id}/widgets`)).status, 404, 'its widgets aren\'t there for them')
  assert.equal((await viewer.get(`/api/hs-dashboards/dashboards/${kitchen.id}/widgets`)).status, 200)
  // The owner sees both.
  assert.deepEqual(names(await ok(owner.get(`/api/hs-dashboards/dashboards?venue_id=${V}`))), ['Kitchen', 'Managers'])

  // Hidden from the owner's own role: gone from the everyday list, there while editing.
  await ok(owner.patch(`/api/hs-dashboards/dashboards/${kitchen.id}`, { hidden_role_ids: [role('owner').id] }))
  assert.deepEqual(names(await ok(owner.get(`/api/hs-dashboards/dashboards?venue_id=${V}`))), ['Managers'])
  assert.deepEqual(names(await ok(owner.get(`/api/hs-dashboards/dashboards?venue_id=${V}&all=1`))), ['Kitchen', 'Managers'])
  assert.equal((await owner.get(`/api/hs-dashboards/dashboards/${kitchen.id}/widgets`)).status, 200, 'a manager still opens it')
  // Everyone again.
  const back = await ok(owner.patch(`/api/hs-dashboards/dashboards/${kitchen.id}`, { hidden_role_ids: [] }))
  assert.deepEqual(back.hidden_role_ids, [])

  // Only the tenant's own roles.
  const otherRoles = await ok(as(B.owner, ids.b).get('/api/access/roles'))
  const foreign = await owner.patch(`/api/hs-dashboards/dashboards/${kitchen.id}`, { hidden_role_ids: [otherRoles[0].id] })
  assert.equal(foreign.status, 400)
  assert.equal((await owner.patch(`/api/hs-dashboards/dashboards/${kitchen.id}`, { hidden_role_ids: ['00000000-0000-4000-8000-000000000000'] })).status, 400)
  assert.equal((await owner.post('/api/hs-dashboards/dashboards', { venue_id: V, name: 'X', hidden_role_ids: [otherRoles[0].id] })).status, 400)
  // Changing who sees it is a layout change: Manage only.
  assert.equal((await viewer.patch(`/api/hs-dashboards/dashboards/${kitchen.id}`, { hidden_role_ids: [] })).status, 403)
  // Another tenant can't touch it.
  assert.equal((await as(B.owner, ids.b).patch(`/api/hs-dashboards/dashboards/${kitchen.id}`, { hidden_role_ids: [] })).status, 404)

  // The other kinds of dashboard work the same way.
  const cash = await ok(owner.post('/api/custom-dashboards/dashboards', { venue_id: V, name: 'Mine', hidden_role_ids: [role('viewer').id] }))
  assert.deepEqual(names(await ok(viewer.get(`/api/custom-dashboards/dashboards?venue_id=${V}`))), [], 'a blank dashboard hidden from the viewer')
  assert.ok(cash.id)
})

test('menu links and Overview tiles only take the tenant\'s own roles', async () => {
  const otherRoles = await ok(as(B.owner, ids.b).get('/api/access/roles'))
  const link = await ok(owner.post('/api/nav/items', { label: 'Rota', route: '/rota', parent_id: null }))
  assert.equal((await owner.patch(`/api/nav/items/${link.id}`, { hidden_role_ids: [otherRoles[0].id] })).status, 400)
  assert.equal((await owner.post('/api/nav/items', { label: 'X', route: '/rota', hidden_role_ids: [otherRoles[0].id] })).status, 400)
  const okLink = await ok(owner.patch(`/api/nav/items/${link.id}`, { hidden_role_ids: [role('viewer').id, role('viewer').id] }))
  assert.deepEqual(okLink.hidden_role_ids, [role('viewer').id], 'duplicates dropped')
  // A parent from another tenant is refused too.
  const otherLink = await ok(as(B.owner, ids.b).post('/api/nav/items', { label: 'Theirs', route: '/rota', parent_id: null }))
  assert.equal((await owner.patch(`/api/nav/items/${link.id}`, { parent_id: otherLink.id })).status, 404)

  const tiles = await ok(owner.get('/api/dashboard-tiles'))
  assert.ok(tiles.length)
  assert.equal((await owner.patch(`/api/dashboard-tiles/${tiles[0].id}`, { hidden_role_ids: [otherRoles[0].id] })).status, 400)
  const tile = await ok(owner.patch(`/api/dashboard-tiles/${tiles[0].id}`, { hidden_role_ids: [role('viewer').id] }))
  assert.deepEqual(tile.hidden_role_ids, [role('viewer').id])
})

// Copy an option group (Menus > Variant groups > Copy): every setting and
// option comes over under new ids, placed just after the original, named
// "<name> (copy)", not attached to any dish; translations of the options and
// the scale words follow the new ids; an option that asks the group itself
// asks the copy. Another tenant's group, a viewer and an operator (Menus view
// by default) are refused.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'

let ids, owner

before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
})
after(closeApp)

test('a copy has every setting and option, new ids, its place after the original', async () => {
  const first = await ok(owner.post('/api/menus/variant-groups', { name: 'Size', sort_order: 0, options: [{ label: 'Small', price_pence: 0 }] }))
  const heat = await ok(owner.post('/api/menus/variant-groups', {
    name: 'Heat', sort_order: 1, price_mode: 'extra', min_select: 0, max_select: 3, pos_prefixes: true,
    allow_repeat: true, on_request: true, kiosk_display: 'slider', scale_low: 'Mild', scale_high: 'Fiery', kiosk_split: true,
    options: [
      { label: 'Lemon pepper', price_pence: 0, image_url: '/uploads/lemon.jpg', description: 'Zesty', level: 1 },
      { label: 'Atomic', price_pence: 50, image_url: '/uploads/atomic.jpg', description: 'Very hot', level: 5 },
    ],
  }))
  const last = await ok(owner.post('/api/menus/variant-groups', { name: 'Dip', sort_order: 2, options: [{ label: 'Ranch', price_pence: 80 }] }))
  // An option that opens the group itself (set in the database: the editor
  // refuses a group asking itself, but older rows may hold one).
  await sql`UPDATE menu_variant_options SET child_group_id = ${heat.id} WHERE id = ${heat.options[1].id}`
  await sql`UPDATE menu_variant_options SET child_group_id = ${first.id} WHERE id = ${heat.options[0].id}`
  await sql`INSERT INTO menu_translations (tenant_id, lang, key, text) VALUES
    (${ids.a}, 'es', ${'option:' + heat.options[0].id + ':label'}, 'Pimienta limón'),
    (${ids.a}, 'es', ${'option:' + heat.options[1].id + ':description'}, 'Muy picante'),
    (${ids.a}, 'es', ${'group:' + heat.id + ':scale_low'}, 'Suave'),
    (${ids.a}, 'es', ${'group:' + heat.id + ':name'}, 'Picante')`

  const copy = await ok(owner.post(`/api/menus/variant-groups/${heat.id}/copy`, {}))
  assert.notEqual(copy.id, heat.id)
  assert.equal(copy.name, 'Heat (copy)')
  for (const k of ['price_mode', 'min_select', 'max_select', 'pos_prefixes', 'allow_repeat', 'on_request', 'kiosk_display', 'scale_low', 'scale_high', 'kiosk_split']) {
    assert.deepEqual(copy[k], heat[k], k)
  }
  assert.equal(copy.options.length, 2)
  const norm = o => ({ label: o.label, price_pence: o.price_pence, image_url: o.image_url, description: o.description, level: o.level, sort_order: o.sort_order })
  assert.deepEqual(copy.options.map(norm), heat.options.map(norm))
  assert.ok(copy.options.every(o => !heat.options.some(h => h.id === o.id)), 'options have new ids')
  assert.equal(copy.options[0].child_group_id, first.id, 'asks the same other group')
  assert.equal(copy.options[1].child_group_id, copy.id, 'an option asking the group itself asks the copy')

  const list = await ok(owner.get('/api/menus/variant-groups'))
  assert.deepEqual(list.map(g => g.name), ['Size', 'Heat', 'Heat (copy)', 'Dip'], 'just after the original')
  assert.equal(list.find(g => g.id === last.id).sort_order, 3)

  const tr = await sql`SELECT key, text FROM menu_translations WHERE tenant_id = ${ids.a} AND lang = 'es' ORDER BY key`
  const byKey = Object.fromEntries(tr.map(r => [r.key, r.text]))
  assert.equal(byKey['option:' + copy.options[0].id + ':label'], 'Pimienta limón')
  assert.equal(byKey['option:' + copy.options[1].id + ':description'], 'Muy picante')
  assert.equal(byKey['group:' + copy.id + ':scale_low'], 'Suave')
  assert.ok(!byKey['group:' + copy.id + ':name'], 'the name is new, its translation is not copied')

  // The original is untouched and the copy is on no dish.
  const [orig] = await sql`SELECT name, sort_order FROM menu_variant_groups WHERE id = ${heat.id}`
  assert.deepEqual({ ...orig }, { name: 'Heat', sort_order: 1 })
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM menu_item_variant_groups WHERE group_id = ${copy.id}`
  assert.equal(n, 0)

  // The copy saves like any group (the editor opens it straight away).
  const renamed = await ok(owner.patch(`/api/menus/variant-groups/${copy.id}`, {
    ...copy, name: 'Heat for wings', options: copy.options.map(o => ({ ...o })),
  }))
  assert.equal(renamed.name, 'Heat for wings')
  assert.equal(renamed.options.length, 2)
})

test('another tenant, a viewer and a missing group are refused', async () => {
  const g = await ok(owner.post('/api/menus/variant-groups', { name: 'Sauce', options: [{ label: 'Ranch', price_pence: 0 }] }))
  const before = await sql`SELECT count(*)::int AS n FROM menu_variant_groups`

  const other = await as(B.owner, ids.b).post(`/api/menus/variant-groups/${g.id}/copy`, {})
  assert.equal(other.status, 404, 'another tenant: ' + other.status)
  const viewer = await as(A.viewer, ids.a).post(`/api/menus/variant-groups/${g.id}/copy`, {})
  assert.equal(viewer.status, 403, 'viewer: ' + viewer.status)
  const operator = await as(A.operator, ids.a).post(`/api/menus/variant-groups/${g.id}/copy`, {})
  assert.equal(operator.status, 403, 'operator (Menus view by default): ' + operator.status)
  const missing = await owner.post('/api/menus/variant-groups/00000000-0000-4000-8000-000000000000/copy', {})
  assert.equal(missing.status, 404)

  const after = await sql`SELECT count(*)::int AS n FROM menu_variant_groups`
  assert.equal(after[0].n, before[0].n, 'nothing was copied')
})

// The order of a menu's sections, dishes, a dish's own options, its option
// groups and the footer notes is the order they are sent in when a save
// leaves their positions out (upsertMenuTree numbers them by their place),
// and dishes sharing a position come back by name, then id: never in the
// random order Postgres hands them over. (Positions defaulting to 0 left
// dishes in random order and made a kiosk test fail one CI run in three,
// Oct 2026.)
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID as u } from 'node:crypto'
import { as, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A } from './support/seed.mjs'
import { withTenant } from '../src/config/db.js'
import { loadMenuVersion } from '../src/services/menuReleases.js'
import { menuSaveBody } from '../src/routes/menus.js'

let ids, owner, menu, groups

before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  menu = await ok(owner.post('/api/menus', { name: 'Order test', slug: 'order-test' }))
  groups = {}
  for (const name of ['Sauce', 'Size', 'Extras']) {
    groups[name] = await ok(owner.post('/api/menus/variant-groups', { name, options: [{ label: name + ' one', price_pence: 0 }] }))
  }
})
after(closeApp)

// Not alphabetical, so neither the name nor chance puts them in this order.
const SECTIONS = ['Mains', 'Desserts', 'Starters']
const DISHES = ['Zucchini fritters', 'Apple pie', 'Mango sorbet', 'Beef rendang', 'Yellow curry', 'Chicken satay', 'Pad see ew', 'Duck pancakes']
const SIZES = ['Large', 'Small', 'Medium']
const GROUPS = ['Size', 'Sauce', 'Extras']
const NOTES = ['Ask us', 'Allergies', 'Vegan']

test('positions left out: sections, dishes, options, groups and notes keep the order sent', async () => {
  const full = await ok(owner.get(`/api/menus/${menu.id}`))
  await ok(owner.patch(`/api/menus/${menu.id}`, {
    ...full,
    callouts: NOTES.map(title => ({ kind: 'custom', title, body: title })),
    sections: SECTIONS.map((title, si) => ({
      title,
      items: si > 0 ? [{ name: title + ' dish', price_pence: 500 }] : DISHES.map((name, i) => ({
        name, price_pence: 900 + i,
        ...(i === 0 ? {
          variants: SIZES.map((label, vi) => ({ label, price_pence: 900 + vi })),
          variant_groups: GROUPS.map(g => ({ group_id: groups[g].id })),
        } : {}),
      })),
    })),
  }))

  const saved = await ok(owner.get(`/api/menus/${menu.id}`))
  assert.deepEqual(saved.sections.map(s => s.title), SECTIONS)
  assert.deepEqual(saved.sections[0].items.map(i => i.name), DISHES)
  assert.deepEqual(saved.sections[0].items.map(i => i.sort_order), DISHES.map((_, i) => i))
  const first = saved.sections[0].items[0]
  assert.deepEqual(first.variants.map(v => v.label), SIZES)
  assert.deepEqual(first.variant_groups.map(g => g.name), GROUPS)
  assert.deepEqual(saved.callouts.map(c => c.title), NOTES)

  // The published copy keeps it.
  await ok(owner.post(`/api/menus/${menu.id}/publish`, {}))
  const live = await withTenant(ids.a, tx => loadMenuVersion(tx, menu.id, ids.a))
  assert.deepEqual(live.sections.map(s => s.title), SECTIONS)
  assert.deepEqual(live.sections[0].items.map(i => i.name), DISHES)
})

test('dishes sharing a position come back by name, every time', async () => {
  const body = menuSaveBody(await ok(owner.get(`/api/menus/${menu.id}`)))
  const fruit = ['Pear', 'Banana', 'Cherry', 'Fig', 'Apricot', 'Date']
  body.sections[1].items = fruit.map(name => ({ id: u(), name, price_pence: 300, sort_order: 5 }))
  await ok(owner.patch(`/api/menus/${menu.id}`, body))
  for (let n = 0; n < 3; n++) {
    const again = await ok(owner.get(`/api/menus/${menu.id}`))
    assert.deepEqual(again.sections[1].items.map(i => i.name), [...fruit].sort())
  }
  // Positions sent are kept as sent: the other sections didn't move.
  const after = await ok(owner.get(`/api/menus/${menu.id}`))
  assert.deepEqual(after.sections.map(s => s.title), SECTIONS)
  assert.deepEqual(after.sections[0].items.map(i => i.name), DISHES)
})

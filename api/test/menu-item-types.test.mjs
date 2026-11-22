// Menus as catalogues, step 1 (migration 267, docs/CATALOGUE.md): a menu,
// section and dish say what they sell, the whole-tree save keeps it, a copy
// and Pepper's save body keep it, the publish diff names it, and a food menu
// published before types existed still reads as in step with its draft.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, closeApp, sql } from './support/app.mjs'
import { resetAndSeed, A } from './support/seed.mjs'
import { withTenant } from '../src/config/db.js'
import { loadMenuVersion } from '../src/services/menuReleases.js'
import { menuSaveBody } from '../src/routes/menus.js'
import { itemType } from '../../shared/catalogue.js'

let ids, owner, menu

before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  menu = await ok(owner.post('/api/menus', { name: 'Shop', slug: 'shop', item_type: 'goods' }))
})
after(closeApp)

test('a new menu is food unless it says; the type is checked', async () => {
  const plain = await ok(owner.post('/api/menus', { name: 'Lunch', slug: 'lunch' }))
  assert.equal((await ok(owner.get(`/api/menus/${plain.id}`))).item_type, 'food')
  assert.equal(menu.item_type, 'goods')
  const bad = await owner.post('/api/menus', { name: 'Odd', slug: 'odd', item_type: 'drink' })
  assert.equal(bad.status, 400)
})

test('sections and dishes keep their own type or follow the level above', async () => {
  const full = await ok(owner.get(`/api/menus/${menu.id}`))
  await ok(owner.patch(`/api/menus/${menu.id}`, {
    ...menuSaveBody(full),
    sections: [
      { title: 'Merch', items: [{ name: 'Mug', price_pence: 900 }, { name: 'Sauce bottle', price_pence: 500, item_type: 'food' }] },
      { title: 'Classes', item_type: 'service', items: [{ name: 'Cookery class', price_pence: 4500 }] },
    ],
  }))
  const saved = await ok(owner.get(`/api/menus/${menu.id}`))
  const [merch, classes] = saved.sections
  assert.equal(saved.item_type, 'goods')
  assert.equal(merch.item_type, null)
  assert.equal(classes.item_type, 'service')
  assert.deepEqual(merch.items.map(i => i.item_type), [null, 'food'])
  assert.deepEqual(merch.items.map(i => itemType(i, merch, saved)), ['goods', 'food'])
  assert.equal(itemType(classes.items[0], classes, saved), 'service')

  // A bad type on a dish is refused, not stored.
  const body = menuSaveBody(saved)
  body.sections[0].items[0].item_type = 'gift'
  assert.equal((await owner.patch(`/api/menus/${menu.id}`, body)).status, 400)

  // Pepper's save body (and /duplicate) carries every type, so a save of it changes nothing.
  await ok(owner.patch(`/api/menus/${menu.id}`, menuSaveBody(saved)))
  const again = await ok(owner.get(`/api/menus/${menu.id}`))
  assert.deepEqual(again.sections.map(s => s.item_type), [null, 'service'])
  assert.deepEqual(again.sections[0].items.map(i => i.item_type), [null, 'food'])
  const copy = await ok(owner.post(`/api/menus/${menu.id}/duplicate`, {}))
  const copied = await ok(owner.get(`/api/menus/${copy.id}`))
  assert.equal(copied.item_type, 'goods')
  assert.equal(copied.sections[1].item_type, 'service')
  assert.equal(copied.sections[0].items[1].item_type, 'food')
})

test('the release carries the types, and the diff names a change of type', async () => {
  await ok(owner.post(`/api/menus/${menu.id}/publish`, {}))
  const live = await withTenant(ids.a, tx => loadMenuVersion(tx, menu.id, ids.a))
  assert.equal(live.item_type, 'goods')
  assert.equal(live.sections[1].item_type, 'service')
  assert.equal(itemType(live.sections[0].items[0], live.sections[0], live), 'goods')

  const body = menuSaveBody(await ok(owner.get(`/api/menus/${menu.id}`)))
  body.sections[1].item_type = null
  body.sections[0].items[0].item_type = 'service'
  await ok(owner.patch(`/api/menus/${menu.id}`, body))
  const status = await ok(owner.get(`/api/menus/${menu.id}/publish`))
  assert.equal(status.in_sync, false)
  const text = status.changes.map(c => c.text).join(' | ')
  assert.match(text, /type/i, text)
})

test('a food menu published before types existed is still in step with its draft', async () => {
  const lunch = await ok(owner.post('/api/menus', { name: 'Dinner', slug: 'dinner' }))
  const full = await ok(owner.get(`/api/menus/${lunch.id}`))
  await ok(owner.patch(`/api/menus/${lunch.id}`, { ...menuSaveBody(full), sections: [{ title: 'Mains', items: [{ name: 'Green curry', price_pence: 1200 }] }] }))
  await ok(owner.post(`/api/menus/${lunch.id}/publish`, {}))
  // Take the type out of the stored release, as a release made before migration 267 has none.
  await sql`
    UPDATE menu_releases SET snapshot = snapshot - 'item_type'
     WHERE menu_id = ${lunch.id} AND tenant_id = ${ids.a}`
  const status = await ok(owner.get(`/api/menus/${lunch.id}/publish`))
  assert.equal(status.in_sync, true, JSON.stringify(status.changes))
  const live = await withTenant(ids.a, tx => loadMenuVersion(tx, lunch.id, ids.a))
  assert.equal(itemType(live.sections[0].items[0], live.sections[0], live), 'food')
})

// Step 2 (docs/CATALOGUE.md 4.6): the allergen surfaces leave retail goods and
// services out. The draft keeps their tags; guests and devices never see them.
test('the allergen matrix, the lookup and what guests are served leave non-food out', async () => {
  const { loadMenuVersions } = await import('../src/services/menuReleases.js')
  const tags = await ok(owner.get('/api/menus/dietary/all'))
  const milk = tags.find(t => t.standard_key === 'milk') || tags.find(t => t.kind === 'allergen')
  assert.ok(milk, 'the seed has an allergen tag')
  const cafe = await ok(owner.post('/api/menus', { name: 'Cafe', slug: 'cafe' }))
  const full = await ok(owner.get(`/api/menus/${cafe.id}`))
  await ok(owner.patch(`/api/menus/${cafe.id}`, {
    ...menuSaveBody(full),
    sections: [{ title: 'Counter', items: [
      { name: 'Latte', price_pence: 350, dietary: [milk.code], calories: 120 },
      { name: 'Milk jug', price_pence: 800, item_type: 'goods', dietary: [milk.code], calories: 9 },
    ] }],
  }))
  // The draft keeps the jug's tag (switching back loses nothing) ...
  const draft = await ok(owner.get(`/api/menus/${cafe.id}`))
  assert.deepEqual(draft.sections[0].items[1].dietary, [milk.code])
  // ... but the allergen matrix leaves it out, draft and live.
  const matrix = await ok(owner.get(`/api/menus/${cafe.id}/allergens`))
  assert.deepEqual(matrix.sections[0].items.map(i => i.name), ['Latte'])
  await ok(owner.post(`/api/menus/${cafe.id}/publish`, {}))
  const lookup = await ok(owner.get(`/api/menus/${cafe.id}/allergens?version=live`))
  assert.deepEqual(lookup.sections[0].items.map(i => i.name), ['Latte'])

  // What tills, kiosks, the website and ordering read: resolved, the jug with no allergens or calories.
  const [live] = await withTenant(ids.a, tx => loadMenuVersions(tx, ids.a, { menuIds: [cafe.id] }))
  const [latte, jug] = live.sections[0].items
  assert.deepEqual([latte.item_type, latte.dietary, latte.calories], ['food', [milk.code], 120])
  assert.deepEqual([jug.item_type, jug.dietary, jug.allergen_levels, jug.calories], ['goods', [], {}, null])

  // The publish diff still sees the draft and the release as the same.
  const status = await ok(owner.get(`/api/menus/${cafe.id}/publish`))
  assert.equal(status.in_sync, true, JSON.stringify(status.changes))
})

// Step 4 (migration 268): product codes and barcodes on a dish and on its
// options, checked on save, kept by Pepper's save body, in the release, and
// sent to the till for a scan.
test('codes: saved, checked, kept and published', async () => {
  const size = await ok(owner.post('/api/menus/variant-groups', { name: 'Shirt size', options: [{ label: 'Small', price_pence: 0 }, { label: 'Large', price_pence: 0 }] }))
  const groups = await ok(owner.get('/api/menus/variant-groups'))
  const lib = (groups.groups || groups).find(g => g.id === size.id)
  const large = lib.options.find(o => o.label === 'Large')
  const shop = await ok(owner.post('/api/menus', { name: 'Merch', slug: 'merch', item_type: 'goods' }))
  const base = menuSaveBody(await ok(owner.get(`/api/menus/${shop.id}`)))
  const shirt = { name: 'T-shirt', price_pence: 1500, sku: 'TEE', barcode: '5000112637922',
    variant_groups: [{ group_id: size.id }], option_codes: [{ option_id: large.id, barcode: '96385074' }] }
  await ok(owner.patch(`/api/menus/${shop.id}`, { ...base, sections: [{ title: 'Clothes', items: [shirt] }] }))
  const saved = await ok(owner.get(`/api/menus/${shop.id}`))
  const it = saved.sections[0].items[0]
  assert.deepEqual([it.sku, it.barcode], ['TEE', '5000112637922'])
  assert.deepEqual(it.option_codes, [{ option_id: large.id, sku: null, barcode: '96385074' }])

  // A wrong check digit, and a code used twice, are refused with a reason.
  const bad = menuSaveBody(saved)
  bad.sections[0].items[0].barcode = '5000112637923'
  const r1 = await owner.patch(`/api/menus/${shop.id}`, bad)
  assert.equal(r1.status, 422)
  assert.match(r1.json.error, /check digit/)
  const twice = menuSaveBody(saved)
  twice.sections[0].items.push({ name: 'Mug', price_pence: 800, sku: 'tee' })
  const r2 = await owner.patch(`/api/menus/${shop.id}`, twice)
  assert.equal(r2.status, 422)
  assert.match(r2.json.error, /product code/i)

  // Pepper's save body keeps every code; a save of it changes nothing.
  await ok(owner.patch(`/api/menus/${shop.id}`, menuSaveBody(saved)))
  const again = (await ok(owner.get(`/api/menus/${shop.id}`))).sections[0].items[0]
  assert.deepEqual([again.sku, again.barcode, again.option_codes], [it.sku, it.barcode, it.option_codes])

  // Published, and what the till reads has them.
  await ok(owner.post(`/api/menus/${shop.id}/publish`, {}))
  const { loadMenuVersions } = await import('../src/services/menuReleases.js')
  const [live] = await withTenant(ids.a, tx => loadMenuVersions(tx, ids.a, { menuIds: [shop.id] }))
  assert.deepEqual(live.sections[0].items[0].option_codes, it.option_codes)
  assert.equal(live.sections[0].items[0].barcode, '5000112637922')

})

// Step 5 (migration 269): what the group calls its menus.
test('the group\'s word: from the menus\' types, or the setting; the main menu follows', async () => {
  const navLabels = async () => {
    const me = await ok(owner.get('/api/me'))
    const out = []
    const walk = list => { for (const n of list || []) { if (n.route === '/menus' || (n.kind === 'section' && /menus|catalogues/i.test(n.label))) out.push(n.label); walk(n.children) } }
    walk(me.nav_tree)
    return out
  }
  // This tenant now has food and retail menus.
  const auto = await ok(owner.get('/api/menus/word'))
  assert.deepEqual([auto.word, auto.setting], ['Menus & catalogues', null])
  const before = await navLabels()
  assert.ok(before.length, 'the standard menu has the Menus link')
  assert.ok(before.every(l => l === 'Menus & catalogues'), JSON.stringify(before))
  // Fixed by the group; anything else is refused.
  assert.equal((await ok(owner.put('/api/menus/word', { setting: 'catalogues' }))).word, 'Catalogues')
  assert.ok((await navLabels()).every(l => l === 'Catalogues'))
  assert.equal((await owner.put('/api/menus/word', { setting: 'shops' })).status, 400)
  assert.equal((await ok(owner.put('/api/menus/word', { setting: null }))).word, 'Menus & catalogues')
  // The menu list carries each menu's type (Pepper's list_menus says Menu or Catalogue from it).
  const list = await ok(owner.get('/api/menus'))
  assert.ok(list.some(m => m.item_type === 'goods'))
})

// Step 6: reports group dishes (and through them, sales lines) by type, and
// show their codes.
test('reports: a dish\'s type, resolved like the menus', async () => {
  const { runner, rowsOf } = await import('./support/reports.mjs')
  const run = runner(ids.a)
  const res = await run({ subject: 'menu.dishes', kind: 'list', rows: ['name', 'type', 'section.menu.sells'] })
  const rows = rowsOf(res)
  // The Shop menu was copied in an earlier test, so names come twice: check pairs.
  const has = (name, type) => rows.some(r => r.name === name && r.type === type)
  // The T-shirt is goods from its menu; the Sauce bottle overrides to food; the Mug was set to a
  // service and the class follows its menu (its section's own type cleared); the copy keeps the old.
  assert.ok(has('T-shirt', 'goods'))
  assert.ok(has('Sauce bottle', 'food'))
  assert.ok(has('Mug', 'service') && has('Cookery class', 'goods'))
  assert.ok(has('Cookery class', 'service'), 'the copy, made before the change')
  assert.ok(has('Latte', 'food') && has('Milk jug', 'goods'))
  const shirt = rows.find(r => r.name === 'T-shirt')
  assert.equal(shirt['section.menu.sells'], 'goods')
  // Grouped: how many dishes of each type.
  const grouped = rowsOf(await run({ subject: 'menu.dishes', rows: ['type'], values: [{ measure: 'dishes' }] }))
  assert.ok(grouped.some(r => r.type === 'goods' && Number(r.dishes) >= 2), JSON.stringify(grouped))
  // Sales lines reach it through their dish.
  const { CATALOGUE } = await import('../src/reports/catalogue/index.js')
  assert.equal(CATALOGUE.subjects['till.lines'].links.item.subject ?? CATALOGUE.subjects['till.lines'].links.item.to, 'menu.dishes')
})

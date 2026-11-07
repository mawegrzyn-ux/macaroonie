// Publishing allergens and dietary tags only (the allergen matrix's Save with
// "Publish allergen changes to all menus", and its Publish allergen changes
// button): every menu's live version gets the draft's dish tags, nothing
// else the drafts change goes live (prices, names, new dishes), menus never
// published are left alone, and a scheduled publish gets the new tags so it
// can't bring the old ones back when it goes live.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, closeApp, sql } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { withTenant } from '../src/config/db.js'
import { loadMenuVersion } from '../src/services/menuReleases.js'
import { menuSaveBody } from '../src/routes/menus.js'

let ids, owner, viewer, other, lunch, dinner, brunch, tag

before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  viewer = as(A.viewer, ids.a)
  other = as(B.owner, ids.b)
  const make = async (name, slug, dishes) => {
    const m = await ok(owner.post('/api/menus', { name, slug }))
    const full = await ok(owner.get(`/api/menus/${m.id}`))
    await ok(owner.patch(`/api/menus/${m.id}`, {
      ...menuSaveBody(full),
      sections: [{ title: 'Mains', items: dishes.map(([n, p]) => ({ name: n, price_pence: p })) }],
    }))
    return ok(owner.get(`/api/menus/${m.id}`))
  }
  lunch = await make('Lunch', 'lunch-ap', [['Pad Thai', 1000], ['Green Curry', 1100]])
  dinner = await make('Dinner', 'dinner-ap', [['Massaman', 1400]])
  brunch = await make('Brunch', 'brunch-ap', [['Eggs', 800]])
  // Never published and no tags: not worth a mention.
  await make('Specials', 'specials-ap', [['Soup', 600]])
  await ok(owner.post(`/api/menus/${lunch.id}/publish`, {}))
  await ok(owner.post(`/api/menus/${dinner.id}/publish`, {}))
  // Tag ids by standard allergen key (the 14 every tenant gets).
  const matrix = await ok(owner.get(`/api/menus/${lunch.id}/allergens`))
  tag = Object.fromEntries(matrix.tags.filter(t => t.standard_key).map(t => [t.standard_key, t]))
  assert.ok(tag.milk && tag.gluten && tag.sesame && tag.eggs, 'standard allergens seeded')
})
after(closeApp)

const live = id => withTenant(ids.a, tx => loadMenuVersion(tx, id, ids.a))
const dish = (menu, name) => menu.sections.flatMap(s => s.items).find(i => i.name === name)
const releases = id => sql`
  SELECT id, goes_live_at, note, published_by, cancelled_at, cancelled_by, snapshot
    FROM menu_releases WHERE menu_id = ${id} ORDER BY created_at, goes_live_at`

test('save with publish: every menu gets its allergens live, nothing else goes live', async () => {
  const pad = dish(lunch, 'Pad Thai')
  const curry = dish(lunch, 'Green Curry')
  // Other changes waiting on Lunch: a new price, a new name, a new dish.
  const body = menuSaveBody(await ok(owner.get(`/api/menus/${lunch.id}`)))
  body.sections[0].items[0].price_pence = 1250
  body.sections[0].items[1].name = 'Green Curry (hot)'
  body.sections[0].items.push({ name: 'Sesame Prawn Toast', price_pence: 700 })
  await ok(owner.patch(`/api/menus/${lunch.id}`, body))
  const toast = dish(await ok(owner.get(`/api/menus/${lunch.id}`)), 'Sesame Prawn Toast')

  // Dinner's allergens saved earlier without publishing.
  const massaman = dish(dinner, 'Massaman')
  await ok(owner.put(`/api/menus/${dinner.id}/allergens`, { items: [{ item_id: massaman.id, levels: { [tag.peanuts?.id || tag.milk.id]: 'contains' } }] }))
  // Brunch was never published: its tags can't go live.
  const eggs = dish(brunch, 'Eggs')
  await ok(owner.put(`/api/menus/${brunch.id}/allergens`, { items: [{ item_id: eggs.id, levels: { [tag.eggs.id]: 'contains' } }] }))

  const pending = await ok(owner.get('/api/menus/allergens/unpublished'))
  assert.deepEqual(pending.menus.map(m => m.name), ['Dinner'])
  assert.deepEqual(pending.unpublished.map(m => m.name), ['Brunch'])

  const res = await ok(owner.put(`/api/menus/${lunch.id}/allergens`, {
    publish: true,
    items: [
      { item_id: pad.id, levels: { [tag.milk.id]: 'contains', [tag.gluten.id]: 'may_contain' } },
      { item_id: curry.id, levels: { [tag.sesame.id]: 'removable' } },
      { item_id: toast.id, levels: { [tag.sesame.id]: 'contains' } },
    ],
  }))
  // The matrix comes back as before, with what was published.
  assert.ok(Array.isArray(res.sections) && Array.isArray(res.tags))
  const byName = Object.fromEntries(res.published.menus.map(m => [m.name, m]))
  assert.deepEqual(Object.keys(byName).sort(), ['Dinner', 'Lunch'])
  assert.deepEqual(byName.Lunch.dishes.sort(), ['Green Curry', 'Pad Thai'])
  assert.deepEqual(byName.Dinner.dishes, ['Massaman'])
  assert.deepEqual(res.published.unpublished.map(m => m.name), ['Brunch'])
  assert.deepEqual(res.published.live_menu_ids.sort(), [lunch.id, dinner.id].sort())

  // Lunch live: the tags, and nothing else of the draft.
  const l = await live(lunch.id)
  const livePad = dish(l, 'Pad Thai')
  assert.deepEqual([...livePad.dietary].sort(), [tag.gluten.code, tag.milk.code].sort())
  assert.deepEqual(livePad.allergen_levels, { [tag.gluten.code]: 'may_contain' })
  assert.equal(livePad.price_pence, 1000, 'the new price stays in the draft')
  const liveCurry = dish(l, 'Green Curry')
  assert.ok(liveCurry, 'the old name is still live')
  assert.deepEqual(liveCurry.allergen_levels, { [tag.sesame.code]: 'removable' })
  assert.equal(dish(l, 'Sesame Prawn Toast'), undefined, 'a dish only in the draft stays unpublished')
  assert.equal(dish(l, 'Green Curry (hot)'), undefined)

  // Dinner live has its earlier saved allergen.
  const d = await live(dinner.id)
  assert.equal(dish(d, 'Massaman').dietary.length, 1)
  // Brunch still has no live version.
  assert.equal(await live(brunch.id), null)

  // The draft's other changes are still waiting, the allergens aren't.
  const status = await ok(owner.get(`/api/menus/${lunch.id}/publish`))
  assert.equal(status.in_sync, false)
  const lines = status.changes.map(c => c.text).join(' | ')
  assert.match(lines, /Pad Thai: £10\.00 → £12\.50/)
  assert.match(lines, /Renamed: Green Curry → Green Curry \(hot\)/)
  assert.match(lines, /Added Sesame Prawn Toast/)
  assert.doesNotMatch(lines, /allergen/i)
  const dinnerStatus = await ok(owner.get(`/api/menus/${dinner.id}/publish`))
  assert.equal(dinnerStatus.in_sync, true, 'Dinner had only allergen changes')

  // The release says what it was, and who; and what is stored (other API
  // processes read it from the table, not this one's cache) is the same.
  const rows = await releases(lunch.id)
  const last = rows.at(-1)
  assert.equal(last.note, 'Allergens and dietary tags only')
  assert.ok(last.published_by, 'who published is kept')
  const stored = last.snapshot.sections.flatMap(s => s.items)
  assert.deepEqual(stored.map(i => i.name), ['Pad Thai', 'Green Curry'])
  assert.equal(stored[0].price_pence, 1000)
  assert.deepEqual(stored[0].allergen_levels, { [tag.gluten.code]: 'may_contain' })

  // Nothing left to publish.
  const after = await ok(owner.get('/api/menus/allergens/unpublished'))
  assert.deepEqual(after.menus, [])
})

test('a scheduled publish gets the new tags at the same time, the old one is cancelled', async () => {
  const at = new Date(Date.now() + 86_400_000).toISOString()
  // Schedules the draft (the new price, name and dish) for tomorrow.
  const sched = await ok(owner.post(`/api/menus/${lunch.id}/publish`, { at, note: 'Spring prices' }))
  const pad = dish(await ok(owner.get(`/api/menus/${lunch.id}`)), 'Pad Thai')
  // Then an allergen change, saved without publishing.
  await ok(owner.put(`/api/menus/${lunch.id}/allergens`, {
    items: [{ item_id: pad.id, levels: { [tag.milk.id]: 'contains', [tag.gluten.id]: 'may_contain', [tag.eggs.id]: 'contains' } }],
  }))
  const pending = await ok(owner.get('/api/menus/allergens/unpublished'))
  assert.deepEqual(pending.menus, [{ menu_id: lunch.id, name: 'Lunch', dishes: ['Pad Thai'], scheduled: 1 }])

  const res = await ok(owner.post('/api/menus/allergens/publish', {}))
  assert.deepEqual(res.menus, [{ menu_id: lunch.id, name: 'Lunch', dishes: ['Pad Thai'], scheduled: 1 }])

  const l = await live(lunch.id)
  assert.ok(dish(l, 'Pad Thai').dietary.includes(tag.eggs.code), 'live now has the egg')
  assert.equal(dish(l, 'Pad Thai').price_pence, 1000)

  const rows = await releases(lunch.id)
  const old = rows.find(r => r.id === sched.release.id)
  assert.ok(old.cancelled_at, 'the old scheduled publish is cancelled')
  const copy = rows.find(r => !r.cancelled_at && new Date(r.goes_live_at) > new Date())
  assert.ok(copy, 'a scheduled copy')
  assert.equal(new Date(copy.goes_live_at).toISOString(), new Date(old.goes_live_at).toISOString())
  assert.equal(copy.note, 'Spring prices (allergens updated)')
  const copyPad = copy.snapshot.sections.flatMap(s => s.items).find(i => i.id === pad.id)
  assert.ok(copyPad.dietary.includes(tag.eggs.code), 'the copy has the egg')
  assert.equal(copyPad.price_pence, 1250, 'and keeps what was scheduled')
  assert.ok(copy.snapshot.sections.flatMap(s => s.items).some(i => i.name === 'Sesame Prawn Toast'))

  // The publish window lists one scheduled publish, the copy.
  const status = await ok(owner.get(`/api/menus/${lunch.id}/publish`))
  assert.deepEqual(status.scheduled.map(s => s.id), [copy.id])
})

test('nothing to publish makes no release', async () => {
  const before = (await releases(lunch.id)).length
  const res = await ok(owner.post('/api/menus/allergens/publish', {}))
  assert.deepEqual(res.menus, [])
  assert.deepEqual(res.live_menu_ids, [])
  assert.equal((await releases(lunch.id)).length, before)
  // Save with publish and no dish changed: nothing published either.
  const res2 = await ok(owner.put(`/api/menus/${dinner.id}/allergens`, { publish: true, items: [] }))
  assert.deepEqual(res2.published.menus, [])
})

test('who may publish, and only their own menus', async () => {
  const pad = dish(await ok(owner.get(`/api/menus/${lunch.id}`)), 'Pad Thai')
  // A viewer can see what is waiting but can't publish or save.
  assert.equal((await viewer.get('/api/menus/allergens/unpublished')).status, 200)
  assert.equal((await viewer.post('/api/menus/allergens/publish', {})).status, 403)
  assert.equal((await viewer.put(`/api/menus/${lunch.id}/allergens`, { publish: true, items: [] })).status, 403)

  // Another group's publish doesn't touch these menus, and can't see them.
  await ok(owner.put(`/api/menus/${lunch.id}/allergens`, { items: [{ item_id: pad.id, levels: { [tag.milk.id]: 'contains' } }] }))
  const theirs = await ok(other.get('/api/menus/allergens/unpublished'))
  assert.ok(!theirs.menus.some(m => m.menu_id === lunch.id))
  assert.ok(!theirs.unpublished.some(m => m.menu_id === brunch.id))
  const before = (await releases(lunch.id)).length
  const res = await ok(other.post('/api/menus/allergens/publish', {}))
  assert.ok(!res.menus.some(m => m.menu_id === lunch.id))
  assert.equal((await releases(lunch.id)).length, before)
  assert.equal((await other.put(`/api/menus/${lunch.id}/allergens`, { publish: true, items: [] })).status, 404)
  const l = await live(lunch.id)
  assert.ok(dish(l, 'Pad Thai').dietary.includes(tag.eggs.code), 'live unchanged by the other group')

  // Bad body.
  assert.equal((await owner.put(`/api/menus/${lunch.id}/allergens`, { publish: 'yes', items: [] })).status, 400)
})

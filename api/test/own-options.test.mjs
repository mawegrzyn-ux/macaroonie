// A dish's own options (menu_item_variants: options added to one dish
// directly, not from an option group) through menu saves. The Menus page
// sent none on every save until Oct 2026, which deleted them and, with
// them, any meal deal rule on them (a combo choice's groups.variants: the
// server keeps a deal's changes only for groups its dishes have). It now
// sends them back, and can turn them into an option group, moving the deal's
// rule to the group with shared/combos.js moveDealGroup().
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID as u } from 'node:crypto'
import { as, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A } from './support/seed.mjs'
import { withTenant } from '../src/config/db.js'
import { loadMenuVersion } from '../src/services/menuReleases.js'
import { menuSaveBody } from '../src/routes/menus.js'
import { moveDealGroup } from '../../shared/combos.js'
import { itemChoices } from '../../shared/orderPricing.js'

let ids, owner, menu
const CURRY = u(), DEAL = u(), STEP = u(), CHOICE = u()
const OWN = [['Chicken', 1200], ['Beef', 1350], ['Prawn', 1450]]
const findItem = (m, id) => m.sections.flatMap(s => s.items).find(i => i.id === id)

before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  menu = await ok(owner.post('/api/menus', { name: 'Own options', slug: 'own-options' }))
  const full = await ok(owner.get(`/api/menus/${menu.id}`))
  await ok(owner.patch(`/api/menus/${menu.id}`, {
    ...full,
    sections: [{
      id: u(), title: 'Curries',
      items: [
        { id: CURRY, name: 'Green curry', price_pence: 1200, variants: OWN.map(([label, price_pence]) => ({ label, price_pence })) },
        { id: DEAL, name: 'Curry deal', kind: 'combo', price_pence: 1500, combo: { mode: 'manual', steps: [{
          id: STEP, name: 'Curry', min: 1, max: 1,
          options: [{ id: CHOICE, type: 'item', item_id: CURRY, groups: { variants: { use: 'only', option_ids: ['v:Chicken', 'v:Beef'] } } }],
        }] } },
      ],
    }],
  }))
})
after(closeApp)

test('own options and a deal\'s rule on them survive a save that sends them back', async () => {
  const saved = await ok(owner.get(`/api/menus/${menu.id}`))
  assert.deepEqual(findItem(saved, CURRY).variants.map(v => [v.label, v.price_pence]), OWN)
  assert.deepEqual(findItem(saved, DEAL).combo.steps[0].options[0].groups, { variants: { use: 'only', option_ids: ['v:Chicken', 'v:Beef'] } })

  // Published, then saved again as they came back (what the Menus page sends
  // now): unchanged, and nothing new to publish (the options get new ids).
  await ok(owner.post(`/api/menus/${menu.id}/publish`, {}))
  await ok(owner.patch(`/api/menus/${menu.id}`, menuSaveBody(saved)))
  const again = await ok(owner.get(`/api/menus/${menu.id}`))
  assert.deepEqual(findItem(again, CURRY).variants.map(v => [v.label, v.price_pence]), OWN)
  assert.notDeepEqual(findItem(again, CURRY).variants.map(v => v.id), findItem(saved, CURRY).variants.map(v => v.id))
  assert.deepEqual(findItem(again, DEAL).combo.steps[0].options[0].groups, findItem(saved, DEAL).combo.steps[0].options[0].groups)
  const status = await ok(owner.get(`/api/menus/${menu.id}/publish`))
  assert.equal(status.in_sync, true, JSON.stringify(status.changes))

  // Saved with none (what the page used to send): the options go, and the
  // deal's rule with them.
  const body = menuSaveBody(again)
  for (const s of body.sections) for (const it of s.items) it.variants = []
  await ok(owner.patch(`/api/menus/${menu.id}`, body))
  const wiped = await ok(owner.get(`/api/menus/${menu.id}`))
  assert.deepEqual(findItem(wiped, CURRY).variants, [])
  assert.equal(findItem(wiped, DEAL).combo.steps[0].options[0].groups, undefined)
})

test('own options turned into an option group: first among the dish\'s groups, the deal\'s rule follows, guests still see Choose', async () => {
  // Back to the start: own options and the deal's rule.
  const cur = menuSaveBody(await ok(owner.get(`/api/menus/${menu.id}`)))
  const curry = cur.sections[0].items.find(i => i.id === CURRY)
  curry.variants = OWN.map(([label, price_pence], i) => ({ label, price_pence, sort_order: i }))
  const sauce = await ok(owner.post('/api/menus/variant-groups', { name: 'Sauce', price_mode: 'extra', min_select: 0, max_select: 1, options: [{ label: 'Extra sauce', price_pence: 50 }] }))
  curry.variant_groups = [{ group_id: sauce.id, overrides: [] }]
  cur.sections[0].items.find(i => i.id === DEAL).combo.steps[0].options[0].groups = { variants: { use: 'only', option_ids: ['v:Chicken', 'v:Beef'] } }
  await ok(owner.patch(`/api/menus/${menu.id}`, cur))

  // What the page does: make the group (same options, same way of asking),
  // then save the dish with it first and the deal's rule moved.
  const group = await ok(owner.post('/api/menus/variant-groups', {
    name: 'Chicken / Beef / Prawn', display_name: 'Choose', price_mode: 'base', min_select: 1, max_select: 1,
    options: OWN.map(([label, price_pence], sort_order) => ({ label, price_pence, sort_order })),
  }))
  const optionIds = Object.fromEntries(group.options.map(o => ['v:' + o.label, o.id]))
  const body = menuSaveBody(await ok(owner.get(`/api/menus/${menu.id}`)))
  const dish = body.sections[0].items.find(i => i.id === CURRY)
  dish.variants = []
  dish.variant_groups = [{ group_id: group.id, overrides: [] }, ...dish.variant_groups]
  const choice = body.sections[0].items.find(i => i.id === DEAL).combo.steps[0].options[0]
  choice.groups = moveDealGroup(choice.groups, 'variants', group.id, optionIds)
  await ok(owner.patch(`/api/menus/${menu.id}`, body))

  const saved = await ok(owner.get(`/api/menus/${menu.id}`))
  const c = findItem(saved, CURRY)
  assert.deepEqual(c.variants, [])
  assert.deepEqual(c.variant_groups.map(g => g.group_id), [group.id, sauce.id])
  assert.deepEqual(findItem(saved, DEAL).combo.steps[0].options[0].groups,
    { [group.id]: { use: 'only', option_ids: [optionIds['v:Chicken'], optionIds['v:Beef']] } })

  // Guests: the same question as before, under the same heading.
  await ok(owner.post(`/api/menus/${menu.id}/publish`, {}))
  const live = await withTenant(ids.a, tx => loadMenuVersion(tx, menu.id, ids.a))
  const asked = itemChoices(findItem(live, CURRY))
  assert.equal(asked[0].name, 'Choose')
  assert.deepEqual(asked[0].options.map(o => [o.label, o.price_pence]), OWN)
  assert.deepEqual([asked[0].min, asked[0].max, asked[0].mode], [1, 1, 'base'])
})

// Options in a meal deal (shared/combos.js dealChoices()): a dish or section
// choice in a combo step can leave one of its dishes' option groups out,
// offer only some options, ask another group from the library instead, and
// change how many. Saving keeps only changes to groups the dishes have, with
// the tenant's own groups and options, and only when set (nothing to publish
// after a plain save); the kiosk's config and the online ordering page get
// what they need, and pricing on both refuses what the deal doesn't offer.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID as u } from 'node:crypto'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { menuSaveBody } from '../src/routes/menus.js'
import { priceItem } from '../../shared/pos/pricing.js'
import { comboCtx } from '../../shared/pos/offers.js'

let ids, owner, theirs, mine, design, M, V
const G = {}      // the tenant's option groups by name
const O = {}      // their options by label
const D = { wings: u(), tenders: u(), fries: u(), meal: u(), wingsSec: u(), sidesSec: u(), dealsSec: u() }
const S = { main: u(), side: u(), extra: u() }
const P = { wings: u(), anyWings: u(), fries: u(), friesTheirs: u(), friesSame: u(), corn: u() }

/** A request with no login (internal header only, to stay out of the rate limit). */
async function pub(method, url, body) {
  const app = await getApp()
  const res = await app.inject({
    method, url,
    headers: { [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    payload: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return { status: res.statusCode, json: (() => { try { return res.json() } catch { return null } })(), body: res.body }
}

async function kioskConfig() {
  const link = await ok(owner.post(`/api/pos/kiosk-designs/${design.id}/preview`, { venue_id: V }))
  const res = await pub('GET', '/pos-api/kiosk-preview?token=' + encodeURIComponent(link.token))
  assert.equal(res.status, 200, res.body)
  return res.json
}

const comboRow = async () => (await sql`SELECT combo FROM menu_items WHERE id = ${D.meal} AND tenant_id = ${ids.a}`)[0].combo
const optionsOf = combo => Object.fromEntries(combo.steps.flatMap(s => s.options).map(o => [o.id, o]))

before(async () => {
  ids = await resetAndSeed()
  mine = await fillTenant(A.owner, ids.a)
  assert.deepEqual(mine.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  theirs = as(B.owner, ids.b)
  design = (await ok(owner.get('/api/pos/kiosk-designs')))[0]
  M = mine.ids.menu
  V = mine.ids.venue
  const make = async (name, extra, options) => {
    const g = await ok(owner.post('/api/menus/variant-groups', { name, ...extra, options }))
    G[name] = g.id
    for (const o of g.options) O[name + ':' + o.label] = o.id
  }
  await make('Flavour', { price_mode: 'base', min_select: 1, max_select: 1 },
    ['Lemon', 'BBQ', 'Hot', 'Garlic'].map(label => ({ label, price_pence: 0 })))
  await make('Dip', { price_mode: 'extra', min_select: 0, max_select: 2, allow_repeat: true },
    [{ label: 'Ranch', price_pence: 50 }, { label: 'Blue', price_pence: 60 }])
  await make('Sauce', { price_mode: 'extra', min_select: 0, max_select: 1 },
    [{ label: 'Mayo', price_pence: 50 }, { label: 'Ketchup', price_pence: 30 }])
  await make('Meal sauce', { price_mode: 'extra', min_select: 1, max_select: 1 },
    [{ label: 'Ketchup', price_pence: 0 }, { label: 'Mayo', price_pence: 20 }])
})
after(closeApp)

test('saving keeps changes to groups the dishes have, with the tenant\'s own groups and options, only when set', async () => {
  const bGroup = await ok(theirs.post('/api/menus/variant-groups', { name: 'Theirs', options: [{ label: 'X', price_pence: 0 }] }))
  const body = menuSaveBody(await ok(owner.get(`/api/menus/${M}`)))
  const dish = (id, name, groups) => ({ id, name, price_pence: 999, is_orderable: true, variant_groups: groups.map(g => ({ group_id: G[g] })) })
  body.sections.push(
    { id: D.wingsSec, title: 'Wings', items: [dish(D.wings, 'Wings', ['Flavour', 'Dip']), dish(D.tenders, 'Tenders', ['Flavour'])] },
    { id: D.sidesSec, title: 'Sides', items: [dish(D.fries, 'Fries', ['Sauce'])] },
    { id: D.dealsSec, title: 'Deals', items: [{ id: D.meal, name: 'Wing meal', kind: 'combo', price_pence: 1500, is_orderable: true, combo: { mode: 'manual', steps: [
      { id: S.main, name: 'Main', min: 1, max: 1, options: [
        // Three of the four flavours (and ids that aren't the group's), up to
        // two; no dip question; changes to groups wings don't have.
        { id: P.wings, type: 'item', item_id: D.wings, groups: {
          [G.Flavour]: { use: 'only', option_ids: [O['Flavour:Lemon'], O['Flavour:Hot'], O['Flavour:Garlic'], bGroup.options[0].id, 'nonsense'], max: 2 },
          [G.Dip]: { use: 'off' },
          [G.Sauce]: { use: 'off' },
          [bGroup.id]: { use: 'off' },
        } },
        // Any dish of the Wings section: BBQ only; Dip offers only another
        // tenant's option, so it is left out.
        { id: P.anyWings, type: 'section', section_id: D.wingsSec, groups: {
          [G.Flavour]: { use: 'only', option_ids: [O['Flavour:BBQ']] },
          [G.Dip]: { use: 'only', option_ids: [bGroup.options[0].id] },
        } },
      ] },
      { id: S.side, name: 'Side', min: 1, max: 1, options: [
        { id: P.fries, type: 'item', item_id: D.fries, groups: { [G.Sauce]: { use: 'swap', group_id: G['Meal sauce'] } } },
      ] },
      { id: S.extra, name: 'Extra side', min: 0, max: 1, options: [
        { id: P.friesTheirs, type: 'item', item_id: D.fries, groups: { [G.Sauce]: { use: 'swap', group_id: bGroup.id } } },
        { id: P.friesSame, type: 'item', item_id: D.fries, groups: { [G.Sauce]: { use: 'all' } } },
        { id: P.corn, type: 'custom', label: 'Corn', groups: { [G.Sauce]: { use: 'off' } } },
      ] },
    ] } }] },
  )
  await ok(owner.patch(`/api/menus/${M}`, body))
  let opts = optionsOf(await comboRow())
  assert.deepEqual(opts[P.wings].groups, {
    [G.Flavour]: { use: 'only', option_ids: [O['Flavour:Lemon'], O['Flavour:Hot'], O['Flavour:Garlic']], max: 2 },
    [G.Dip]: { use: 'off' },
  })
  assert.deepEqual(opts[P.anyWings].groups, { [G.Flavour]: { use: 'only', option_ids: [O['Flavour:BBQ']] }, [G.Dip]: { use: 'off' } })
  assert.deepEqual(opts[P.fries].groups, { [G.Sauce]: { use: 'swap', group_id: G['Meal sauce'] } })
  for (const id of [P.friesTheirs, P.friesSame, P.corn]) assert.ok(!('groups' in opts[id]), 'stored without groups: ' + JSON.stringify(opts[id]))
  assert.ok(!JSON.stringify(await comboRow()).includes(bGroup.id), 'nothing of the other tenant\'s')

  // Published, then a plain save: nothing to publish.
  await ok(owner.post(`/api/menus/${M}/publish`, {}))
  await ok(owner.patch(`/api/menus/${M}`, menuSaveBody(await ok(owner.get(`/api/menus/${M}`)))))
  const status = await ok(owner.get(`/api/menus/${M}/publish`))
  assert.equal((status.changes || []).length, 0, 'no changes after a plain save: ' + JSON.stringify(status.changes))

  // The menu's copy keeps them (groups are the tenant's library: no remap).
  const copy = await ok(owner.post(`/api/menus/${M}/duplicate`, {}))
  const copied = (await ok(owner.get(`/api/menus/${copy.id}`))).sections.flatMap(s => s.items).find(i => i.name === 'Wing meal')
  const cs = copied.combo.steps[0].options.find(o => o.type === 'item')
  assert.deepEqual(cs.groups[G.Dip], { use: 'off' })
  assert.notEqual(cs.item_id, D.wings, 'pointing at the copy\'s own wings')
  await ok(owner.delete(`/api/menus/${copy.id}`))

  // A View user can't change them; the other tenant can't touch the menu.
  assert.equal((await as(A.viewer, ids.a).patch(`/api/menus/${M}`, body)).status, 403)
  assert.equal((await theirs.patch(`/api/menus/${M}`, body)).status, 404)
})

test('a group taken off the dish takes the deal\'s change for it with it on the next save', async () => {
  const body = menuSaveBody(await ok(owner.get(`/api/menus/${M}`)))
  const wings = body.sections.flatMap(s => s.items).find(i => i.id === D.wings)
  wings.variant_groups = wings.variant_groups.filter(g => g.group_id !== G.Dip)
  await ok(owner.patch(`/api/menus/${M}`, body))
  const opts = optionsOf(await comboRow())
  assert.deepEqual(Object.keys(opts[P.wings].groups), [G.Flavour])
  assert.deepEqual(Object.keys(opts[P.anyWings].groups), [G.Flavour], 'no dish of the section has Dip now')
  // Put it back for the rest.
  const again = menuSaveBody(await ok(owner.get(`/api/menus/${M}`)))
  again.sections.flatMap(s => s.items).find(i => i.id === D.wings).variant_groups.push({ group_id: G.Dip, overrides: [] })
  const meal = again.sections.flatMap(s => s.items).find(i => i.id === D.meal)
  meal.combo.steps[0].options[0].groups[G.Dip] = { use: 'off' }
  await ok(owner.patch(`/api/menus/${M}`, again))
  await ok(owner.post(`/api/menus/${M}/publish`, {}))
  assert.deepEqual(optionsOf(await comboRow())[P.wings].groups[G.Dip], { use: 'off' })
})

test('kiosk: the config carries the deal and the group it asks instead; pricing follows the deal', async () => {
  const cfg = await kioskConfig()
  const meal = cfg.items[D.meal]
  assert.ok(meal, 'the meal deal is on the kiosk')
  assert.deepEqual(meal.combo.steps[1].options[0].groups, { [G.Sauce]: { use: 'swap', group_id: G['Meal sauce'] } })
  assert.ok(cfg.groups[G['Meal sauce']], 'the library has the group the deal asks')
  const ctx = comboCtx(cfg)
  const sel = (wings, fries) => ({ choices: {}, combo: {
    [S.main]: [{ option_id: P.wings, item_id: D.wings, choices: wings }],
    [S.side]: [{ option_id: P.fries, item_id: D.fries, choices: fries }],
  } })
  const good = priceItem(meal, sel({ [G.Flavour]: [{ id: O['Flavour:Lemon'] }, { id: O['Flavour:Hot'] }] }, { [G['Meal sauce']]: [{ id: O['Meal sauce:Mayo'] }] }), ctx)
  assert.equal(good.ok, true, good.error)
  assert.deepEqual(good.combo.map(p => p.modifiers.map(m => m.label)), [['Lemon', 'Hot'], ['Mayo']])
  assert.equal(good.combo[1].extras, 20)
  const bbq = priceItem(meal, sel({ [G.Flavour]: [{ id: O['Flavour:BBQ'] }] }, { [G['Meal sauce']]: [{ id: O['Meal sauce:Ketchup'] }] }), ctx)
  assert.match(bbq.error || '', /no longer available/)
  const dip = priceItem(meal, sel({ [G.Flavour]: [{ id: O['Flavour:Lemon'] }], [G.Dip]: [{ id: O['Dip:Ranch'] }] }, { [G['Meal sauce']]: [{ id: O['Meal sauce:Ketchup'] }] }), ctx)
  assert.equal(dip.ok, true, dip.error)
  assert.equal(dip.combo[0].extras, 0, 'a dip the deal doesn\'t ask isn\'t charged')
})

test('online: the ordering page gets the group the deal asks instead; a quote refuses what the deal doesn\'t offer', async () => {
  const menu = await pub('GET', `/order-api/venues/${V}`)
  assert.equal(menu.status, 200, menu.body)
  const meal = menu.json.menus.flatMap(m => m.sections).flatMap(s => s.items).find(i => i.id === D.meal)
  assert.ok(meal, 'the meal deal is on the ordering page')
  assert.deepEqual(meal.deal_groups[G['Meal sauce']].options.map(o => [o.label, o.price_pence]), [['Ketchup', 0], ['Mayo', 20]])
  assert.equal(meal.deal_groups[G['Meal sauce']].min, 1)
  assert.ok(!('variant_groups' in meal), 'prepared choices only')
  const line = (wings, fries) => ({ item_id: D.meal, qty: 1, choices: {}, combo: {
    [S.main]: [{ option_id: P.wings, item_id: D.wings, choices: wings }],
    [S.side]: [{ option_id: P.fries, item_id: D.fries, choices: fries }],
  } })
  const quote = async l => (await pub('POST', `/order-api/venues/${V}/quote`, { lines: [l] })).json
  const good = await quote(line({ [G.Flavour]: [O['Flavour:Lemon'], O['Flavour:Hot']] }, { [G['Meal sauce']]: [O['Meal sauce:Mayo']] }))
  assert.deepEqual(good.errors, [])
  assert.equal(good.lines[0].unit_pence, 1520)
  assert.deepEqual(good.lines[0].parts[1].options.map(o => [o.group, o.label]), [['Meal sauce', 'Mayo']])
  assert.match((await quote(line({ [G.Flavour]: [O['Flavour:BBQ']] }, { [G['Meal sauce']]: [O['Meal sauce:Ketchup']] }))).errors[0]?.error || '', /no longer available/)
  assert.match((await quote(line({ [G.Flavour]: [O['Flavour:Lemon']] }, { [G.Sauce]: [O['Sauce:Mayo']] }))).errors[0]?.error || '', /meal sauce/i,
    'the fries\' own sauce isn\'t asked; the meal sauce is needed')
  const dip = await quote(line({ [G.Flavour]: [O['Flavour:Lemon']], [G.Dip]: [O['Dip:Ranch']] }, { [G['Meal sauce']]: [O['Meal sauce:Ketchup']] }))
  assert.deepEqual(dip.errors, [])
  assert.equal(dip.lines[0].unit_pence, 1500)
})

test('another tenant\'s groups and options never land in a deal', async () => {
  const bg = await ok(theirs.post('/api/menus/variant-groups', { name: 'Their size', options: [{ label: 'S', price_pence: 0 }, { label: 'L', price_pence: 100 }] }))
  const m = await ok(theirs.post('/api/menus', { name: 'Their menu', slug: 'their-menu-deal' }))
  const dishId = u(), mealId = u(), stepId = u(), o1 = u(), o2 = u()
  const body = menuSaveBody(await ok(theirs.get(`/api/menus/${m.id}`)))
  body.sections = [{ id: u(), title: 'Mains', items: [
    { id: dishId, name: 'Curry', price_pence: 900, variant_groups: [{ group_id: bg.id }] },
    { id: mealId, name: 'Their deal', kind: 'combo', price_pence: 1200, combo: { mode: 'manual', steps: [{ id: stepId, name: 'Main', min: 1, max: 1, options: [
      { id: o1, type: 'item', item_id: dishId, groups: { [bg.id]: { use: 'swap', group_id: G['Meal sauce'] }, [G.Flavour]: { use: 'off' } } },
      { id: o2, type: 'item', item_id: dishId, groups: { [bg.id]: { use: 'only', option_ids: [O['Flavour:Lemon']] } } },
    ] }] } },
  ] }]
  await ok(theirs.patch(`/api/menus/${m.id}`, body))
  const [row] = await sql`SELECT combo FROM menu_items WHERE id = ${mealId} AND tenant_id = ${ids.b}`
  const opts = optionsOf(row.combo)
  assert.ok(!('groups' in opts[o1]), 'a swap to another tenant\'s group and their group\'s key are dropped')
  assert.deepEqual(opts[o2].groups, { [bg.id]: { use: 'off' } }, 'only another tenant\'s option: nothing offered')
  const text = JSON.stringify(row.combo)
  for (const id of [G['Meal sauce'], G.Flavour, O['Flavour:Lemon']]) assert.ok(!text.includes(id))
})

test('the deal\'s own extra charges: kept for the options it asks, charged on the kiosk and online', async () => {
  const bGroup = await ok(theirs.post('/api/menus/variant-groups', { name: 'Theirs 2', options: [{ label: 'X', price_pence: 0 }] }))
  const body = menuSaveBody(await ok(owner.get(`/api/menus/${M}`)))
  const meal = body.sections.flatMap(s => s.items).find(i => i.id === D.meal)
  const opt = id => meal.combo.steps.flatMap(s => s.options).find(o => o.id === id)
  // Hot 50p in the deal; BBQ isn't one of the deal's flavours, so no price for it.
  opt(P.wings).groups[G.Flavour] = { ...opt(P.wings).groups[G.Flavour], prices: { [O['Flavour:Hot']]: 50, [O['Flavour:BBQ']]: 40, [bGroup.options[0].id]: 10 } }
  // The meal's mayo free; the fries' own sauce options aren't the group the deal asks.
  opt(P.fries).groups[G.Sauce] = { ...opt(P.fries).groups[G.Sauce], prices: { [O['Meal sauce:Mayo']]: 0, [O['Sauce:Mayo']]: 99 } }
  // Only prices for options the group doesn't have: nothing left to keep.
  opt(P.friesSame).groups = { [G.Sauce]: { use: 'all', prices: { [O['Dip:Ranch']]: 25 } } }
  await ok(owner.patch(`/api/menus/${M}`, body))
  const opts = optionsOf(await comboRow())
  assert.deepEqual(opts[P.wings].groups[G.Flavour].prices, { [O['Flavour:Hot']]: 50 })
  assert.deepEqual(opts[P.fries].groups[G.Sauce], { use: 'swap', group_id: G['Meal sauce'], prices: { [O['Meal sauce:Mayo']]: 0 } })
  assert.ok(!('groups' in opts[P.friesSame]), JSON.stringify(opts[P.friesSame]))

  // Refused: a price that isn't whole pence in range.
  const bad = menuSaveBody(await ok(owner.get(`/api/menus/${M}`)))
  bad.sections.flatMap(s => s.items).find(i => i.id === D.meal).combo.steps[0].options[0].groups[G.Flavour].prices = { [O['Flavour:Hot']]: -5 }
  assert.equal((await owner.patch(`/api/menus/${M}`, bad)).status, 400)

  // Published, then a plain save: nothing to publish.
  await ok(owner.post(`/api/menus/${M}/publish`, {}))
  await ok(owner.patch(`/api/menus/${M}`, menuSaveBody(await ok(owner.get(`/api/menus/${M}`)))))
  assert.equal(((await ok(owner.get(`/api/menus/${M}/publish`))).changes || []).length, 0)

  // Kiosk (the till's engine): Hot costs 50p in the deal, the meal's mayo nothing.
  const cfg = await kioskConfig()
  const ctx = comboCtx(cfg)
  const sel = (flav, sauce) => ({ choices: {}, combo: {
    [S.main]: [{ option_id: P.wings, item_id: D.wings, choices: { [G.Flavour]: flav.map(id => ({ id })) } }],
    [S.side]: [{ option_id: P.fries, item_id: D.fries, choices: { [G['Meal sauce']]: sauce.map(id => ({ id })) } }],
  } })
  const hot = priceItem(cfg.items[D.meal], sel([O['Flavour:Hot']], [O['Meal sauce:Mayo']]), ctx)
  assert.equal(hot.ok, true, hot.error)
  assert.deepEqual(hot.combo.map(p => [p.extras, p.modifiers.map(m => [m.label, m.price])]), [[50, [['Hot', 50]]], [0, [['Mayo', 0]]]])

  // Online: the same charge in the quote.
  const line = (flav, sauce) => ({ item_id: D.meal, qty: 1, choices: {}, combo: {
    [S.main]: [{ option_id: P.wings, item_id: D.wings, choices: { [G.Flavour]: flav } }],
    [S.side]: [{ option_id: P.fries, item_id: D.fries, choices: { [G['Meal sauce']]: sauce } }],
  } })
  const q = async l => (await pub('POST', `/order-api/venues/${V}/quote`, { lines: [l] })).json
  const a = await q(line([O['Flavour:Hot'], O['Flavour:Lemon']], [O['Meal sauce:Mayo']]))
  assert.deepEqual(a.errors, [])
  assert.equal(a.lines[0].unit_pence, 1550, '£15 + Hot 50p, the meal\'s mayo free')
  assert.deepEqual(a.lines[0].parts[0].options.map(o => [o.label, o.price_pence]), [['Hot', 50], ['Lemon', 0]])
  assert.equal((await q(line([O['Flavour:Lemon']], [O['Meal sauce:Ketchup']]))).lines[0].unit_pence, 1500)
})

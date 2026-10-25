// Kiosk design options (Store tech > Kiosks > a design): the split photo
// switch on option groups (migration 185) and combo steps (stored only when
// on, so a menu saved without touching it has nothing new to publish), the
// layout options round trip, and a saved design keeps only the tenant's own
// sections, dishes and order types.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID as u } from 'node:crypto'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { menuSaveBody } from '../src/routes/menus.js'

let ids, owner, mine, theirs, design

async function preview(token) {
  const app = await getApp()
  const res = await app.inject({
    method: 'GET', url: '/pos-api/kiosk-preview?token=' + encodeURIComponent(token),
    headers: { [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET },
  })
  return { status: res.statusCode, json: res.json() }
}

before(async () => {
  ids = await resetAndSeed()
  mine = await fillTenant(A.owner, ids.a)
  assert.deepEqual(mine.failed, [], 'fixtures')
  theirs = await fillTenant(B.owner, ids.b, { mark: 'Yyb', slug: 'yyb' })
  assert.deepEqual(theirs.failed, [], 'fixtures B')
  owner = as(A.owner, ids.a)
  design = (await ok(owner.get('/api/pos/kiosk-designs')))[0]
})
after(closeApp)

test('an option group\'s picks on the photo (split / corner / off) save and reach the kiosk', async () => {
  const g = await ok(owner.post('/api/menus/variant-groups', {
    name: 'Flavour', kiosk_pick_photo: 'split',
    options: [{ label: 'Lemon', price_pence: 0, image_url: '/uploads/lemon.jpg' }, { label: 'Hot', price_pence: 0, image_url: '/uploads/hot.jpg' }],
  }))
  assert.equal(g.kiosk_pick_photo, 'split')
  const dip = await ok(owner.post('/api/menus/variant-groups', { name: 'Dip', kiosk_pick_photo: 'corner', options: [{ label: 'Ranch', price_pence: 0, image_url: '/uploads/ranch.png' }] }))
  assert.equal(dip.kiosk_pick_photo, 'corner')
  const plain = await ok(owner.post('/api/menus/variant-groups', { name: 'Sauce', options: [{ label: 'Ranch', price_pence: 0 }] }))
  assert.equal(plain.kiosk_pick_photo, null, 'off unless asked for')
  assert.equal((await owner.post('/api/menus/variant-groups', { name: 'Bad', kiosk_pick_photo: 'stack', options: [] })).status, 400)
  const off = await ok(owner.patch(`/api/menus/variant-groups/${g.id}`, { name: 'Flavour', options: g.options.map(o => ({ ...o })) }))
  assert.equal(off.kiosk_pick_photo, null, 'a save without it turns it off (the editor always sends it)')
  await ok(owner.patch(`/api/menus/variant-groups/${g.id}`, { name: 'Flavour', kiosk_pick_photo: 'split', options: g.options.map(o => ({ ...o })) }))
  const listed = (await ok(owner.get('/api/menus/variant-groups'))).find(x => x.id === g.id)
  assert.equal(listed.kiosk_pick_photo, 'split')
  const link = await ok(owner.post(`/api/pos/kiosk-designs/${design.id}/preview`, { venue_id: mine.ids.venue }))
  const cfg = await preview(link.token)
  assert.equal(cfg.status, 200)
  assert.equal(cfg.json.groups[g.id].kiosk_pick_photo, 'split')
  assert.equal(cfg.json.groups[dip.id].kiosk_pick_photo, 'corner')
  assert.equal(cfg.json.groups[plain.id].kiosk_pick_photo, null)
})

test('a combo step\'s picks on the photo are stored only when set, and nothing else reads as changed', async () => {
  const M = mine.ids.menu
  const full = await ok(owner.get(`/api/menus/${M}`))
  const dishes = full.sections[0].items
  const MAIN = u(), DRINK = u()
  const body = menuSaveBody(full)
  body.sections.push({ id: u(), title: 'Meals', items: [{
    id: u(), name: 'Noodle meal', kind: 'combo', price_pence: 1500, is_orderable: true,
    combo: { mode: 'manual', steps: [
      { id: MAIN, name: 'Your noodles', min: 1, max: 1, pick_photo: 'split', options: dishes.map(it => ({ id: u(), type: 'item', item_id: it.id })) },
      { id: DRINK, name: 'Your drink', min: 1, max: 1, pick_photo: null, options: [{ id: u(), type: 'custom', label: 'Cola', image_url: '/uploads/cola.jpg' }] },
    ] },
  }] })
  await ok(owner.patch(`/api/menus/${M}`, body))
  const [row] = await sql`SELECT combo FROM menu_items WHERE tenant_id = ${ids.a} AND name = 'Noodle meal'`
  const byId = Object.fromEntries(row.combo.steps.map(s => [s.id, s]))
  assert.equal(byId[MAIN].pick_photo, 'split')
  assert.ok(!('pick_photo' in byId[DRINK]) && !('split' in byId[DRINK]), 'off is left out of the stored step')
  await ok(owner.post(`/api/menus/${M}/publish`, {}))
  // Saving the menu as loaded changes nothing to publish.
  await ok(owner.patch(`/api/menus/${M}`, menuSaveBody(await ok(owner.get(`/api/menus/${M}`)))))
  const status = await ok(owner.get(`/api/menus/${M}/publish`))
  assert.equal((status.changes || []).length, 0, 'no changes after a plain save: ' + JSON.stringify(status.changes))
  // The kiosk gets the step's switch from the live menu.
  const link = await ok(owner.post(`/api/pos/kiosk-designs/${design.id}/preview`, { venue_id: mine.ids.venue }))
  const cfg = (await preview(link.token)).json
  const meal = Object.values(cfg.items).find(it => it.name === 'Noodle meal')
  assert.ok(meal, 'the combo is on the kiosk')
  assert.equal(meal.combo.steps.find(s => s.id === MAIN).pick_photo, 'split')
})

test('corner pictures: a size per option group and combo step (migration 205)', async () => {
  const opts = [{ label: 'Ranch', price_pence: 0, image_url: '/uploads/ranch.png' }]
  const dip = await ok(owner.post('/api/menus/variant-groups', { name: 'Corner dip', kiosk_pick_photo: 'corner', kiosk_pick_scale: 40, options: opts }))
  assert.equal(dip.kiosk_pick_scale, 40)
  for (const bad of [5, 71, 25.5, '30']) {
    assert.equal((await owner.post('/api/menus/variant-groups', { name: 'Bad size', kiosk_pick_photo: 'corner', kiosk_pick_scale: bad, options: [] })).status, 400, String(bad))
  }
  const split = await ok(owner.post('/api/menus/variant-groups', { name: 'Split size', kiosk_pick_photo: 'split', kiosk_pick_scale: 40, options: opts }))
  assert.equal(split.kiosk_pick_scale, null, 'a size is kept only for the corner')
  const auto = await ok(owner.post('/api/menus/variant-groups', { name: 'Auto dip', kiosk_pick_photo: 'corner', options: opts }))
  assert.equal(auto.kiosk_pick_scale, null, 'automatic unless set')
  const changed = await ok(owner.patch(`/api/menus/variant-groups/${dip.id}`, { name: 'Corner dip', kiosk_pick_photo: 'corner', kiosk_pick_scale: 55, options: dip.options.map(o => ({ ...o })) }))
  assert.equal(changed.kiosk_pick_scale, 55)
  assert.equal((await ok(owner.get('/api/menus/variant-groups'))).find(x => x.id === dip.id).kiosk_pick_scale, 55, 'listed')
  const copy = await ok(owner.post(`/api/menus/variant-groups/${dip.id}/copy`, {}))
  assert.equal(copy.kiosk_pick_scale, 55, 'a copy keeps it')
  // Combo steps: kept only with the corner, left out when automatic.
  const M = mine.ids.menu
  const body = menuSaveBody(await ok(owner.get(`/api/menus/${M}`)))
  const SIDE = u(), DRINK = u(), MAIN = u()
  body.sections.push({ id: u(), title: 'Corner meals', items: [{
    id: u(), name: 'Corner meal', kind: 'combo', price_pence: 1200, is_orderable: true,
    combo: { mode: 'manual', steps: [
      { id: MAIN, name: 'Main', min: 1, max: 1, pick_photo: 'split', pick_scale: 30, options: [{ id: u(), type: 'custom', label: 'Tenders', image_url: '/uploads/t.jpg' }] },
      { id: SIDE, name: 'Side', min: 1, max: 1, pick_photo: 'corner', pick_scale: 35, options: [{ id: u(), type: 'custom', label: 'Fries', image_url: '/uploads/f.png' }] },
      { id: DRINK, name: 'Drink', min: 1, max: 1, pick_photo: 'corner', pick_scale: null, options: [{ id: u(), type: 'custom', label: 'Cola', image_url: '/uploads/c.png' }] },
    ] },
  }] })
  const tooBig = JSON.parse(JSON.stringify(body))
  tooBig.sections.at(-1).items[0].combo.steps[1].pick_scale = 80
  assert.equal((await owner.patch(`/api/menus/${M}`, tooBig)).status, 400)
  await ok(owner.patch(`/api/menus/${M}`, body))
  const [row] = await sql`SELECT combo FROM menu_items WHERE tenant_id = ${ids.a} AND name = 'Corner meal'`
  const byId = Object.fromEntries(row.combo.steps.map(st => [st.id, st]))
  assert.equal(byId[SIDE].pick_scale, 35)
  assert.ok(!('pick_scale' in byId[MAIN]), 'not kept with split')
  assert.ok(!('pick_scale' in byId[DRINK]), 'automatic is left out of the stored step')
  await ok(owner.post(`/api/menus/${M}/publish`, {}))
  await ok(owner.patch(`/api/menus/${M}`, menuSaveBody(await ok(owner.get(`/api/menus/${M}`)))))
  assert.equal(((await ok(owner.get(`/api/menus/${M}/publish`))).changes || []).length, 0, 'a plain save changes nothing to publish')
  // The kiosk gets both: the group's from the library, the step's from the live menu.
  const link = await ok(owner.post(`/api/pos/kiosk-designs/${design.id}/preview`, { venue_id: mine.ids.venue }))
  const cfg = (await preview(link.token)).json
  assert.equal(cfg.groups[dip.id].kiosk_pick_scale, 55)
  assert.equal(cfg.groups[auto.id].kiosk_pick_scale, null)
  const meal = Object.values(cfg.items).find(it => it.name === 'Corner meal')
  assert.equal(meal.combo.steps.find(st => st.id === SIDE).pick_scale, 35)
  // Another tenant can't change it.
  assert.equal((await as(B.owner, ids.b).patch(`/api/menus/variant-groups/${dip.id}`, { name: 'Mine', kiosk_pick_photo: 'corner', kiosk_pick_scale: 20, options: [] })).status, 404)
})

test('layout options round trip; a design keeps only the tenant\'s own sections, dishes and order types', async () => {
  const myMenu = await ok(owner.get(`/api/menus/${mine.ids.menu}`))
  const mySection = myMenu.sections[0].id
  const myDish = myMenu.sections[0].items[0].id
  const [their] = await sql`SELECT s.id AS section_id, i.id AS item_id FROM menu_sections s JOIN menu_items i ON i.section_id = s.id WHERE s.tenant_id = ${ids.b} LIMIT 1`
  const [theirType] = await sql`SELECT id FROM order_types WHERE tenant_id = ${ids.b} LIMIT 1`
  const [myType] = await sql`SELECT id FROM order_types WHERE tenant_id = ${ids.a} LIMIT 1`
  const saved = await ok(owner.put(`/api/pos/kiosk-designs/${design.id}`, {
    name: design.name,
    settings: {
      layout: {
        tiles: 'hexagon', option_tiles: 'round', option_pictures: false, option_align: 'center', header: false, icon_buttons: true,
        hero: 'stacked', hero_image_align: 'left', hero_text_align: 'right', hero_backdrop: false, combo_build: false, fly_to_order: false,
      },
      start: { type_cards: { [myType.id]: { label: 'Stay' }, [theirType.id]: { label: 'Theirs' } } },
      menu: {
        rail: 'none',
        section_tiles: [{ section_id: their.section_id, title: 'Theirs' }, { section_id: mySection, title: 'Noodles', size: 'wide' }],
        hidden_section_ids: [their.section_id],
        banners: [{ image_url: '/b.jpg', link: { kind: 'section', id: their.section_id } }, { image_url: '/c.jpg', link: { kind: 'item', id: myDish } }],
        featured: [{ title: 'Theirs', link: { kind: 'item', id: their.item_id } }],
      },
      options: { wheel_spin: true, wheel_spin_picks: true, pick_photos: 'corner' }, // pick_photos: gone (per group now), dropped
      checkout: { upsell_item_ids: [their.item_id, myDish] },
      behaviour: { reach: true, reach_media: [{ type: 'video', url: '/uploads/reach.mp4' }, { type: 'image', url: '/uploads/reach.jpg' }] },
    },
  }))
  const s = saved.settings
  assert.deepEqual(s.layout, {
    tiles: 'hexagon', option_tiles: 'round', option_pictures: false, option_align: 'center',
    hero: 'stacked', hero_image_align: 'left', hero_text_align: 'right', hero_backdrop: false, combo_build: false, fly_to_order: false, header: false, icon_buttons: true,
  })
  assert.equal(s.options.pick_photos, undefined)
  assert.equal(s.menu.rail, 'none')
  assert.deepEqual(s.menu.section_tiles.map(t => t.section_id), [mySection])
  assert.equal(s.menu.section_tiles[0].size, 'wide')
  assert.deepEqual(s.menu.hidden_section_ids, [])
  assert.deepEqual(s.menu.banners.map(b => b.link), [{ kind: 'none', id: null }, { kind: 'item', id: myDish }])
  assert.deepEqual(s.menu.featured[0].link, { kind: 'none', id: null })
  assert.deepEqual(s.checkout.upsell_item_ids, [myDish])
  assert.deepEqual(Object.keys(s.start.type_cards), [myType.id])
  assert.equal(s.options.wheel_spin_picks, true)
  assert.deepEqual(s.behaviour.reach_media.map(m => [m.type, m.url]), [['video', '/uploads/reach.mp4'], ['image', '/uploads/reach.jpg']])
  const listed = (await ok(owner.get('/api/pos/kiosk-designs'))).find(d => d.id === design.id)
  assert.deepEqual(listed.settings, s)
  // A copy keeps it as it is.
  const copy = await ok(owner.post('/api/pos/kiosk-designs', { name: 'Copy', copy_from: design.id }))
  assert.deepEqual(copy.settings, s)
  // The preview gets the layout.
  const link = await ok(owner.post(`/api/pos/kiosk-designs/${design.id}/preview`, { venue_id: mine.ids.venue }))
  const cfg = (await preview(link.token)).json
  assert.equal(cfg.design.layout.tiles, 'hexagon')
  assert.equal(cfg.design.layout.option_tiles, 'round')
  assert.equal(cfg.design.layout.option_pictures, false)
  assert.equal(cfg.design.layout.option_align, 'center')
  assert.equal(cfg.design.layout.hero, 'stacked')
  assert.equal(cfg.design.layout.hero_backdrop, false, 'no shade behind the dish\'s photo')
  assert.equal(cfg.design.layout.combo_build, false, 'meal deals keep their own photo')
  assert.equal(cfg.design.layout.fly_to_order, false, 'no flight into the order')
  assert.equal(cfg.design.options.pick_photos, undefined)
  assert.equal(cfg.design.menu.rail, 'none')
  assert.equal(cfg.design.behaviour.reach_media.length, 2, 'the reach pictures reach the kiosk')
})

test('the bottom bar and side menu colours: not set until set, saved in lower case, a copy and the kiosk get them', async () => {
  const before = (await ok(owner.get('/api/pos/kiosk-designs'))).find(d => d.id === design.id).settings
  for (const k of ['bar', 'bar_text', 'rail', 'rail_text']) assert.ok(!before.brand.colors[k], k + ' not set')
  const colors = { ...before.brand.colors, bar: '#7A0019', rail: '#000000', bar_text: 'blue', rail_text: '#FFD43B' }
  const saved = await ok(owner.put(`/api/pos/kiosk-designs/${design.id}`, { name: design.name, settings: { ...before, brand: { ...before.brand, colors } } }))
  const c = saved.settings.brand.colors
  assert.deepEqual([c.bar, c.bar_text, c.rail, c.rail_text], ['#7a0019', null, '#000000', '#ffd43b'], 'a colour code kept, anything else not set')
  assert.equal(c.text, before.brand.colors.text, 'the other colours unchanged')
  const copy = await ok(owner.post('/api/pos/kiosk-designs', { name: 'Bars', copy_from: design.id }))
  assert.equal(copy.settings.brand.colors.bar, '#7a0019')
  const link = await ok(owner.post(`/api/pos/kiosk-designs/${design.id}/preview`, { venue_id: mine.ids.venue }))
  const cfg = (await preview(link.token)).json
  assert.equal(cfg.design.brand.colors.bar, '#7a0019', 'the kiosk gets the bar colour')
  assert.equal(cfg.design.brand.colors.rail_text, '#ffd43b')
  assert.equal(cfg.design.brand.colors.bar_text, null, 'words not set reach it as not set (the kiosk works them out)')
  // Cleared again: not set.
  const cleared = await ok(owner.put(`/api/pos/kiosk-designs/${design.id}`, { name: design.name, settings: { ...saved.settings, brand: { ...saved.settings.brand, colors: { ...c, bar: null, rail: '', rail_text: null } } } }))
  for (const k of ['bar', 'bar_text', 'rail', 'rail_text']) assert.equal(cleared.settings.brand.colors[k], null, k + ' cleared')
})

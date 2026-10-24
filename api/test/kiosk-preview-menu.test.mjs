// Kiosk previews with the menu's changes not published yet: the editor's
// preview link and a design's shared link (migration 188) show the published
// menu or the draft; the preview link lists the menus with unpublished
// changes; a kiosk itself always gets the published menu.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID as u } from 'node:crypto'
import { as, getApp, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { menuSaveBody } from '../src/routes/menus.js'
import { withTenant } from '../src/config/db.js'
import { kioskConfig, previewDevice } from '../src/services/kioskSvc.js'
import { tillConfig } from '../src/services/posSvc.js'

let ids, owner, mine, design, M, dishId

async function pub(url) {
  const app = await getApp()
  const res = await app.inject({ method: 'GET', url, headers: { [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET } })
  return { status: res.statusCode, json: res.json() }
}
const previewLink = menu => ok(owner.post(`/api/pos/kiosk-designs/${design.id}/preview`, { venue_id: mine.ids.venue, ...(menu ? { menu } : {}) }))
const previewConfig = async link => {
  const res = await pub('/pos-api/kiosk-preview?token=' + encodeURIComponent(link.token))
  assert.equal(res.status, 200, JSON.stringify(res.json))
  return res.json
}
const dishNamed = (cfg, name) => Object.values(cfg.items).find(it => it.name === name)

before(async () => {
  ids = await resetAndSeed()
  mine = await fillTenant(A.owner, ids.a)
  assert.deepEqual(mine.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  design = (await ok(owner.get('/api/pos/kiosk-designs')))[0]
  M = mine.ids.menu
  dishId = (await ok(owner.get(`/api/menus/${M}`))).sections[0].items[0].id
})
after(closeApp)

test('nothing unpublished: the preview says so and shows the published menu', async () => {
  const link = await previewLink()
  assert.equal(link.menu, 'live')
  assert.deepEqual(link.menus_changed, [])
  const cfg = await previewConfig(link)
  assert.equal(cfg.menu_version, 'live')
  assert.ok(cfg.items[dishId])
})

test('a saved change: the published menu by default, the draft when asked for', async () => {
  const body = menuSaveBody(await ok(owner.get(`/api/menus/${M}`)))
  const dish = body.sections[0].items.find(it => it.id === dishId)
  dish.image_url = '/uploads/new-photo.jpg'
  body.sections[0].items.push({ id: u(), name: 'Mango sticky rice', price_pence: 650, is_orderable: true, image_url: '/uploads/mango.jpg' })
  await ok(owner.patch(`/api/menus/${M}`, body))

  const live = await previewLink('live')
  assert.deepEqual(live.menus_changed.map(m => m.id), [M], 'the changed menu is listed')
  const liveCfg = await previewConfig(live)
  assert.equal(liveCfg.menu_version, 'live')
  assert.equal(liveCfg.items[dishId].image_url, null, 'the published photo (none)')
  assert.equal(dishNamed(liveCfg, 'Mango sticky rice'), undefined, 'a dish not published isn\'t there')

  const draft = await previewLink('draft')
  assert.equal(draft.menu, 'draft')
  assert.notEqual(draft.token, live.token)
  assert.deepEqual(draft.menus_changed.map(m => m.id), [M])
  const draftCfg = await previewConfig(draft)
  assert.equal(draftCfg.menu_version, 'draft')
  assert.equal(draftCfg.items[dishId].image_url, '/uploads/new-photo.jpg')
  assert.equal(dishNamed(draftCfg, 'Mango sticky rice')?.image_url, '/uploads/mango.jpg')
  assert.equal((await owner.post(`/api/pos/kiosk-designs/${design.id}/preview`, { venue_id: mine.ids.venue, menu: 'all' })).status, 400)
})

test('a new menu not published yet shows only in the draft preview', async () => {
  const fresh = await ok(owner.post('/api/menus', { name: 'Dessert menu', slug: 'desserts' }))
  const body = menuSaveBody(await ok(owner.get(`/api/menus/${fresh.id}`)))
  body.is_published = true
  body.sections = [{ id: u(), title: 'Puddings', items: [{ id: u(), name: 'Coconut ice cream', price_pence: 450, is_orderable: true }] }]
  await ok(owner.patch(`/api/menus/${fresh.id}`, body))
  const live = await previewLink('live')
  assert.ok(live.menus_changed.some(m => m.id === fresh.id && m.name === 'Dessert menu'))
  assert.equal(dishNamed(await previewConfig(live), 'Coconut ice cream'), undefined)
  assert.ok(dishNamed(await previewConfig(await previewLink('draft')), 'Coconut ice cream'))
})

test('a shared link can show the draft, and says so', async () => {
  const share = await ok(owner.put(`/api/pos/kiosk-designs/${design.id}/share`, { venue_id: mine.ids.venue, menu: 'draft' }))
  assert.equal(share.menu, 'draft')
  const token = new URL(share.url).searchParams.get('kiosk_share')
  let res = await pub('/pos-api/kiosk-share?token=' + token)
  assert.equal(res.status, 200)
  assert.equal(res.json.menu_version, 'draft')
  assert.equal(res.json.share.menu, 'draft')
  assert.ok(dishNamed(res.json, 'Mango sticky rice'))
  // Saved without a menu: back to the published menu (the editor always sends it).
  const back = await ok(owner.put(`/api/pos/kiosk-designs/${design.id}/share`, { venue_id: mine.ids.venue }))
  assert.equal(back.menu, 'live')
  res = await pub('/pos-api/kiosk-share?token=' + token)
  assert.equal(res.json.menu_version, 'live')
  assert.equal(dishNamed(res.json, 'Mango sticky rice'), undefined)
  // Stopping sharing forgets the choice.
  await ok(owner.put(`/api/pos/kiosk-designs/${design.id}/share`, { venue_id: mine.ids.venue, menu: 'draft' }))
  await ok(owner.delete(`/api/pos/kiosk-designs/${design.id}/share`))
  const again = await ok(owner.put(`/api/pos/kiosk-designs/${design.id}/share`, { venue_id: mine.ids.venue }))
  assert.equal(again.menu, 'live')
  assert.equal((await owner.put(`/api/pos/kiosk-designs/${design.id}/share`, { venue_id: mine.ids.venue, menu: 'all' })).status, 400)
})

test('a kiosk (not a preview) always gets the published menu', async () => {
  const cfg = await withTenant(ids.a, tx => kioskConfig(tx, ids.a, mine.ids.venue, previewDevice({ designId: design.id, streamId: null }), { menuVersion: 'draft' }))
  assert.equal(cfg.menu_version, 'live')
  assert.equal(dishNamed(cfg, 'Mango sticky rice'), undefined)
})

test('published: the live preview has the changes and nothing is listed', async () => {
  await ok(owner.post(`/api/menus/${M}/publish`, {}))
  const live = await previewLink('live')
  assert.ok(!live.menus_changed.some(m => m.id === M))
  const cfg = await previewConfig(live)
  assert.equal(cfg.items[dishId].image_url, '/uploads/new-photo.jpg')
  assert.ok(dishNamed(cfg, 'Mango sticky rice'))
})

test('the menu\'s option settings reach the kiosk (Hide £0, Hide unpriced), not the till', async () => {
  const body = menuSaveBody(await ok(owner.get(`/api/menus/${M}`)))
  body.hide_zero_priced_variants = true
  body.hide_unpriced_variants = true
  await ok(owner.patch(`/api/menus/${M}`, body))
  await ok(owner.post(`/api/menus/${M}/publish`, {}))
  const cfg = await previewConfig(await previewLink('live'))
  assert.deepEqual(cfg.items[dishId].variant_rules, { hideUnpriced: true, hideZeroPrice: true })
  const till = await withTenant(ids.a, tx => tillConfig(tx, ids.a, mine.ids.venue))
  assert.equal(till.items[dishId].variant_rules, undefined, 'staff see every option')
})

test('another tenant and people without access', async () => {
  const b = as(B.owner, ids.b)
  assert.equal((await b.post(`/api/pos/kiosk-designs/${design.id}/preview`, { venue_id: mine.ids.venue, menu: 'draft' })).status, 404)
  assert.equal((await as(A.viewer, ids.a).post(`/api/pos/kiosk-designs/${design.id}/preview`, { venue_id: mine.ids.venue, menu: 'draft' })).status, 403)
})

test('a dish with no price is left off the kiosk menu, kept for combos and on the till', async () => {
  const body = menuSaveBody(await ok(owner.get(`/api/menus/${M}`)))
  const noPrice = { id: u(), name: 'Wings no price', price_pence: null, is_orderable: true }
  body.sections[0].items.push(noPrice)
  await ok(owner.patch(`/api/menus/${M}`, body))
  const cfg = await previewConfig(await previewLink('draft'))
  const section = cfg.menus.flatMap(m => m.sections).find(s => s.id === body.sections[0].id)
  assert.ok(cfg.items[noPrice.id], 'still known (a combo may offer it)')
  assert.ok(!section.item_ids.includes(noPrice.id), 'not listed on the kiosk')
  assert.ok(section.item_ids.includes(dishId), 'priced dishes still listed')
  assert.ok(cfg.section_items[section.id].includes(noPrice.id), 'a combo offering the section still finds it')
  assert.equal(section.all_ids, undefined)
  // Tills list it as before (staff can type a price-less line or see the problem).
  await ok(owner.post(`/api/menus/${M}/publish`, {}))
  const till = await withTenant(ids.a, tx => tillConfig(tx, ids.a, mine.ids.venue))
  const tillSection = till.menus.flatMap(m => m.sections).find(s => s.id === body.sections[0].id)
  assert.ok(tillSection.item_ids.includes(noPrice.id))
})

test('the design editor\'s preview link names the dishes left off for having no price', async () => {
  const link = await previewLink('live')
  const names = link.unpriced.map(d => d.name)
  assert.ok(names.includes('Wings no price'), JSON.stringify(link.unpriced))
  assert.ok(!link.unpriced.some(d => d.id === dishId), 'a priced dish is not listed')
})

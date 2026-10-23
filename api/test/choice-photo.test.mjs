// A choice's second picture (migration 199): an option group option's
// photo_url (the picture it puts on the dish's photo on kiosks, beside
// image_url on its own tile) saves, lists, copies and reaches the kiosk; a
// combo choice's photo_url is stored only when set, so a menu saved without
// one has nothing new to publish.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID as u } from 'node:crypto'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { menuSaveBody } from '../src/routes/menus.js'

let ids, owner, mine, design

async function kioskConfig() {
  const link = await ok(owner.post(`/api/pos/kiosk-designs/${design.id}/preview`, { venue_id: mine.ids.venue }))
  const app = await getApp()
  const res = await app.inject({
    method: 'GET', url: '/pos-api/kiosk-preview?token=' + encodeURIComponent(link.token),
    headers: { [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET },
  })
  assert.equal(res.statusCode, 200, res.body)
  return res.json()
}

before(async () => {
  ids = await resetAndSeed()
  mine = await fillTenant(A.owner, ids.a)
  assert.deepEqual(mine.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  design = (await ok(owner.get('/api/pos/kiosk-designs')))[0]
})
after(closeApp)

test('an option\'s tile picture and dish picture save, list, copy and reach the kiosk', async () => {
  const g = await ok(owner.post('/api/menus/variant-groups', {
    name: 'Flavour', kiosk_pick_photo: 'corner',
    options: [
      { label: 'Lemon', price_pence: 0, image_url: '/uploads/lemon-tile.png', photo_url: '/uploads/lemon-wings.jpg' },
      { label: 'Hot', price_pence: 0, image_url: '/uploads/hot-tile.png' },
    ],
  }))
  const byLabel = list => Object.fromEntries(list.map(o => [o.label, o]))
  let o = byLabel(g.options)
  assert.equal(o.Lemon.photo_url, '/uploads/lemon-wings.jpg')
  assert.equal(o.Hot.photo_url, null)

  // A save changes it; one without it clears it (the editor always sends it).
  const changed = await ok(owner.patch(`/api/menus/variant-groups/${g.id}`, {
    name: 'Flavour', kiosk_pick_photo: 'corner',
    options: g.options.map(x => ({ id: x.id, label: x.label, price_pence: 0, image_url: x.image_url, photo_url: x.label === 'Hot' ? '/uploads/hot-wings.jpg' : x.photo_url })),
  }))
  o = byLabel(changed.options)
  assert.equal(o.Hot.photo_url, '/uploads/hot-wings.jpg')
  assert.equal(o.Hot.image_url, '/uploads/hot-tile.png', 'the tile picture stays')
  o = byLabel((await ok(owner.get('/api/menus/variant-groups'))).find(x => x.id === g.id).options)
  assert.equal(o.Lemon.photo_url, '/uploads/lemon-wings.jpg')
  assert.equal(o.Hot.photo_url, '/uploads/hot-wings.jpg')

  // A copy keeps both pictures.
  const copy = await ok(owner.post(`/api/menus/variant-groups/${g.id}/copy`, {}))
  o = byLabel(copy.options || (await ok(owner.get('/api/menus/variant-groups'))).find(x => x.id === copy.id).options)
  assert.equal(o.Lemon.photo_url, '/uploads/lemon-wings.jpg')
  assert.equal(o.Lemon.image_url, '/uploads/lemon-tile.png')

  // The kiosk's group library carries both.
  const cfg = await kioskConfig()
  o = byLabel(cfg.groups[g.id].options)
  assert.equal(o.Lemon.image_url, '/uploads/lemon-tile.png')
  assert.equal(o.Lemon.photo_url, '/uploads/lemon-wings.jpg')

  // Another tenant can't see the group.
  const theirs = as(B.owner, ids.b)
  assert.ok(!(await ok(theirs.get('/api/menus/variant-groups'))).some(x => x.id === g.id))
  const r = await theirs.patch(`/api/menus/variant-groups/${g.id}`, { name: 'X', options: [] })
  assert.equal(r.status, 404)
})

test('a combo choice\'s meal picture is stored only when set', async () => {
  const M = mine.ids.menu
  const full = await ok(owner.get(`/api/menus/${M}`))
  const dishes = full.sections[0].items.filter(it => it.kind !== 'combo')
  const STEP = u(), WITH = u(), PLAIN = u(), CUSTOM = u()
  const body = menuSaveBody(full)
  body.sections.push({ id: u(), title: 'Boxes', items: [{
    id: u(), name: 'Noodle box', kind: 'combo', price_pence: 1500, is_orderable: true,
    combo: { mode: 'manual', steps: [{ id: STEP, name: 'Your noodles', min: 1, max: 1, pick_photo: 'split', options: [
      { id: WITH, type: 'item', item_id: dishes[0].id, photo_url: '/uploads/noodles-in-box.jpg' },
      { id: PLAIN, type: 'item', item_id: dishes[1]?.id || dishes[0].id, photo_url: null },
      { id: CUSTOM, type: 'custom', label: 'Chef special', image_url: '/uploads/chef-tile.png', photo_url: '/uploads/chef-in-box.jpg' },
    ] }] },
  }] })
  await ok(owner.patch(`/api/menus/${M}`, body))
  const [row] = await sql`SELECT combo FROM menu_items WHERE tenant_id = ${ids.a} AND name = 'Noodle box'`
  const opts = Object.fromEntries(row.combo.steps[0].options.map(x => [x.id, x]))
  assert.equal(opts[WITH].photo_url, '/uploads/noodles-in-box.jpg')
  assert.ok(!('photo_url' in opts[PLAIN]), 'none is left out of the stored choice')
  assert.equal(opts[CUSTOM].photo_url, '/uploads/chef-in-box.jpg')

  await ok(owner.post(`/api/menus/${M}/publish`, {}))
  await ok(owner.patch(`/api/menus/${M}`, menuSaveBody(await ok(owner.get(`/api/menus/${M}`)))))
  const status = await ok(owner.get(`/api/menus/${M}/publish`))
  assert.equal((status.changes || []).length, 0, 'no changes after a plain save: ' + JSON.stringify(status.changes))

  const cfg = await kioskConfig()
  const box = Object.values(cfg.items).find(it => it.name === 'Noodle box')
  const kopts = Object.fromEntries(box.combo.steps[0].options.map(x => [x.id, x]))
  assert.equal(kopts[WITH].photo_url, '/uploads/noodles-in-box.jpg')
  assert.equal(kopts[CUSTOM].photo_url, '/uploads/chef-in-box.jpg')
})

// An option group's display name (migration 198): what guests and the tills
// see, the group's name staying the staff's. The editor's draft keeps the
// name with display_name beside it; a published menu holds the display name
// as the group's name, so a new display name is a change to publish; draft
// previews show it at once; the kiosk's group library and the translation
// sources use it; a save that leaves it out keeps it.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'

let ids, owner, mine, M, dish, group

async function pub(url) {
  const app = await getApp()
  const res = await app.inject({ method: 'GET', url, headers: { [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET } })
  return { status: res.statusCode, json: res.json() }
}
async function kioskConfigFor(menu) {
  const design = (await ok(owner.get('/api/pos/kiosk-designs')))[0]
  const link = await ok(owner.post(`/api/pos/kiosk-designs/${design.id}/preview`, { venue_id: mine.ids.venue, menu }))
  const res = await pub('/pos-api/kiosk-preview?token=' + encodeURIComponent(link.token))
  assert.equal(res.status, 200, JSON.stringify(res.json))
  return res.json
}
const groupBody = (g, extra) => ({
  name: g.name, sort_order: g.sort_order, price_mode: g.price_mode, min_select: g.min_select, max_select: g.max_select,
  options: g.options.map(o => ({ id: o.id, label: o.label, price_pence: o.price_pence })), ...extra,
})
const dishGroup = menu => menu.sections[0].items.find(it => it.id === dish.id).variant_groups[0]

before(async () => {
  ids = await resetAndSeed()
  mine = await fillTenant(A.owner, ids.a)
  assert.deepEqual(mine.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  M = mine.ids.menu
  const draft = await ok(owner.get(`/api/menus/${M}`))
  dish = draft.sections[0].items.find(it => it.variant_groups?.length)
  const groups = await ok(owner.get('/api/menus/variant-groups'))
  group = groups.find(g => g.id === dish.variant_groups[0].group_id)
  assert.ok(group, 'the dish has a group')
})
after(closeApp)

test('guests see the display name once published; the editor keeps the name', async () => {
  // Nothing changes for a menu whose groups have no display name.
  assert.equal((await ok(owner.get(`/api/menus/${M}/publish`))).in_sync, true)

  const saved = await ok(owner.patch(`/api/menus/variant-groups/${group.id}`, groupBody(group, { display_name: '  Choose your size ' })))
  assert.equal(saved.display_name, 'Choose your size')
  assert.equal(saved.name, group.name)
  const listed = (await ok(owner.get('/api/menus/variant-groups'))).find(g => g.id === group.id)
  assert.equal(listed.display_name, 'Choose your size')

  // The editor: the group's own name, the display name beside it.
  const draft = await ok(owner.get(`/api/menus/${M}`))
  assert.equal(dishGroup(draft).name, group.name)
  assert.equal(dishGroup(draft).display_name, 'Choose your size')

  // A change to publish, listed with the dish's options.
  const status = await ok(owner.get(`/api/menus/${M}/publish`))
  assert.equal(status.in_sync, false)
  assert.ok(status.changes.some(c => c.kind === 'options'), JSON.stringify(status.changes))

  // Guests still see the published name; a draft preview shows the display name.
  const live = await ok(owner.get(`/api/menus/${M}?version=live`))
  assert.equal(dishGroup(live).name, group.name)
  const liveKiosk = await kioskConfigFor('live')
  assert.equal(liveKiosk.items[dish.id].variant_groups[0].name, group.name)
  const draftKiosk = await kioskConfigFor('draft')
  assert.equal(draftKiosk.items[dish.id].variant_groups[0].name, 'Choose your size')
  // The kiosk's group library (nested groups, the tills') is live.
  assert.equal(draftKiosk.groups[group.id].name, 'Choose your size')
  assert.equal(liveKiosk.groups[group.id].name, 'Choose your size')

  await ok(owner.post(`/api/menus/${M}/publish`, {}))
  const published = await ok(owner.get(`/api/menus/${M}?version=live`))
  assert.equal(dishGroup(published).name, 'Choose your size')
  assert.equal(dishGroup(published).display_name, undefined, 'a release keeps only the shown name')
  assert.equal((await ok(owner.get(`/api/menus/${M}/publish`))).in_sync, true)
  assert.equal((await kioskConfigFor('live')).items[dish.id].variant_groups[0].name, 'Choose your size')

  // Translations: the display name is the text to translate.
  const tr = await ok(owner.get('/api/menus/translations?lang=es'))
  const src = tr.sources.find(s => s.key === 'group:' + group.id + ':name')
  assert.equal(src?.text, 'Choose your size')
})

test('a save that leaves it out keeps it; an empty one clears it; others are refused', async () => {
  const kept = await ok(owner.patch(`/api/menus/variant-groups/${group.id}`, groupBody(group, { name: group.name + ' (wings)' })))
  assert.equal(kept.display_name, 'Choose your size')
  assert.equal(kept.name, group.name + ' (wings)')

  // A copy keeps the display name (guests can't tell them apart; staff can).
  const copy = await ok(owner.post(`/api/menus/variant-groups/${group.id}/copy`, {}))
  assert.equal(copy.display_name, 'Choose your size')

  const cleared = await ok(owner.patch(`/api/menus/variant-groups/${group.id}`, groupBody(group, { display_name: '' })))
  assert.equal(cleared.display_name, null)
  assert.equal((await owner.patch(`/api/menus/variant-groups/${group.id}`, groupBody(group, { display_name: 'x'.repeat(81) }))).status, 400)

  const other = await as(B.owner, ids.b).patch(`/api/menus/variant-groups/${group.id}`, groupBody(group, { display_name: 'Theirs' }))
  assert.equal(other.status, 404)
  const viewer = await as(A.viewer, ids.a).patch(`/api/menus/variant-groups/${group.id}`, groupBody(group, { display_name: 'Viewer' }))
  assert.equal(viewer.status, 403)
  const final = (await ok(owner.get('/api/menus/variant-groups'))).find(g => g.id === group.id)
  assert.equal(final.display_name, null)
})

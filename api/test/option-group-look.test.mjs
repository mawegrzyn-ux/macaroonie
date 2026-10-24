// An option group's own kiosk look and its variation type (migration 206):
// saved, listed, kept when a save leaves them out, copied, refused when
// unknown, sent to kiosks and to the kiosk design editor; never a menu
// change to publish. A kiosk design's looks per group (options.group_looks)
// keep only the tenant's own groups.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { menuSaveBody } from '../src/routes/menus.js'

let ids, owner, mine, design

async function preview(token) {
  const app = await getApp()
  const res = await app.inject({
    method: 'GET', url: '/pos-api/kiosk-preview?token=' + encodeURIComponent(token),
    headers: { [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET },
  })
  return res.json()
}

before(async () => {
  ids = await resetAndSeed()
  mine = await fillTenant(A.owner, ids.a)
  assert.deepEqual(mine.failed, [], 'fixtures')
  const theirs = await fillTenant(B.owner, ids.b, { mark: 'Yyb', slug: 'yyb' })
  assert.deepEqual(theirs.failed, [], 'fixtures B')
  owner = as(A.owner, ids.a)
  design = (await ok(owner.get('/api/pos/kiosk-designs')))[0]
})
after(closeApp)

const opts = [{ label: 'Lemon', price_pence: 0 }, { label: 'Hot', price_pence: 50 }]

test('an option group\'s own kiosk look and variation type: saved, kept, cleared, copied, refused, sent to kiosks', async () => {
  const g = await ok(owner.post('/api/menus/variant-groups', {
    name: 'Flavours', kiosk_tiles: 'hexagon', kiosk_pictures: false, kiosk_entrance: 'bubble', variation_type: 'addition', options: opts,
  }))
  assert.deepEqual([g.kiosk_tiles, g.kiosk_pictures, g.kiosk_entrance, g.variation_type], ['hexagon', false, 'bubble', 'addition'])
  const plain = await ok(owner.post('/api/menus/variant-groups', { name: 'Plain', options: opts }))
  assert.deepEqual([plain.kiosk_tiles, plain.kiosk_pictures, plain.kiosk_entrance, plain.variation_type], [null, null, null, null], 'not set unless asked for')

  // Unknown values are refused.
  for (const bad of [{ kiosk_tiles: 'square' }, { kiosk_pictures: 'no' }, { kiosk_entrance: 'explode' }, { variation_type: 'other' }]) {
    assert.equal((await owner.post('/api/menus/variant-groups', { name: 'Bad', options: [], ...bad })).status, 400, JSON.stringify(bad))
    assert.equal((await owner.patch(`/api/menus/variant-groups/${g.id}`, { name: 'Flavours', options: g.options, ...bad })).status, 400, 'patch ' + JSON.stringify(bad))
  }

  // A save that leaves them out keeps them; null clears them; each on its own.
  const kept = await ok(owner.patch(`/api/menus/variant-groups/${g.id}`, { name: 'Flavours', options: g.options.map(o => ({ ...o })) }))
  assert.deepEqual([kept.kiosk_tiles, kept.kiosk_pictures, kept.kiosk_entrance, kept.variation_type], ['hexagon', false, 'bubble', 'addition'])
  const changed = await ok(owner.patch(`/api/menus/variant-groups/${g.id}`, {
    name: 'Flavours', kiosk_tiles: 'round', kiosk_pictures: true, kiosk_entrance: null, variation_type: 'side', options: g.options.map(o => ({ ...o })),
  }))
  assert.deepEqual([changed.kiosk_tiles, changed.kiosk_pictures, changed.kiosk_entrance, changed.variation_type], ['round', true, null, 'side'])
  for (const t of ['modification', 'side', 'addition']) {
    assert.equal((await ok(owner.patch(`/api/menus/variant-groups/${g.id}`, { name: 'Flavours', variation_type: t, options: g.options.map(o => ({ ...o })) }))).variation_type, t)
  }
  const listed = (await ok(owner.get('/api/menus/variant-groups'))).find(x => x.id === g.id)
  assert.deepEqual([listed.kiosk_tiles, listed.kiosk_pictures, listed.kiosk_entrance, listed.variation_type], ['round', true, null, 'addition'])

  // A copy keeps them.
  const copy = await ok(owner.post(`/api/menus/variant-groups/${g.id}/copy`, {}))
  assert.deepEqual([copy.kiosk_tiles, copy.kiosk_pictures, copy.kiosk_entrance, copy.variation_type], ['round', true, null, 'addition'])

  // Kiosks get the look (not the stock type); the design editor gets every group with its look.
  const link = await ok(owner.post(`/api/pos/kiosk-designs/${design.id}/preview`, { venue_id: mine.ids.venue }))
  const cfg = await preview(link.token)
  assert.deepEqual([cfg.groups[g.id].kiosk_tiles, cfg.groups[g.id].kiosk_pictures, cfg.groups[g.id].kiosk_entrance], ['round', true, null])
  assert.equal(cfg.groups[plain.id].kiosk_tiles, null)
  const setup = await ok(owner.get(`/api/pos/venues/${mine.ids.venue}/setup`))
  const og = setup.option_groups.find(x => x.id === g.id)
  assert.deepEqual([og.name, og.kiosk_tiles, og.kiosk_pictures, og.kiosk_entrance], ['Flavours', 'round', true, null])
  assert.ok(setup.option_groups.some(x => x.id === plain.id), 'every group is listed')
  assert.ok(setup.option_groups.every(x => !x.name.includes('Yyb')), 'only the tenant\'s own groups')

  // A viewer can't change a group; another tenant can't find it.
  assert.equal((await as(A.viewer, ids.a).patch(`/api/menus/variant-groups/${g.id}`, { name: 'X', kiosk_tiles: 'plain', options: [] })).status, 403)
  assert.equal((await as(B.owner, ids.b).patch(`/api/menus/variant-groups/${g.id}`, { name: 'X', kiosk_tiles: 'plain', options: [] })).status, 404)
  assert.equal((await ok(owner.get('/api/menus/variant-groups'))).find(x => x.id === g.id).kiosk_tiles, 'round', 'unchanged')
})

test('a group\'s look and type change straight away: a published menu has nothing new to publish', async () => {
  const g = await ok(owner.post('/api/menus/variant-groups', { name: 'Dips', options: opts }))
  const M = mine.ids.menu
  const body = menuSaveBody(await ok(owner.get(`/api/menus/${M}`)))
  body.sections[0].items[0].variant_groups = [...(body.sections[0].items[0].variant_groups || []), { group_id: g.id, overrides: [] }]
  await ok(owner.patch(`/api/menus/${M}`, body))
  await ok(owner.post(`/api/menus/${M}/publish`, {}))
  assert.equal(((await ok(owner.get(`/api/menus/${M}/publish`))).changes || []).length, 0, 'published')
  await ok(owner.patch(`/api/menus/variant-groups/${g.id}`, {
    name: 'Dips', kiosk_tiles: 'plain', kiosk_pictures: false, kiosk_entrance: 'deal', variation_type: 'side', options: g.options.map(o => ({ ...o })),
  }))
  const status = await ok(owner.get(`/api/menus/${M}/publish`))
  assert.equal((status.changes || []).length, 0, 'nothing to publish: ' + JSON.stringify(status.changes))
})

test('a kiosk design\'s looks per option group: kept for the tenant\'s own groups, sent to the kiosk', async () => {
  const g = await ok(owner.post('/api/menus/variant-groups', { name: 'Sauces', kiosk_tiles: 'round', options: opts }))
  const other = await ok(owner.post('/api/menus/variant-groups', { name: 'Gone soon', options: opts }))
  const theirs = (await ok(as(B.owner, ids.b).get('/api/menus/variant-groups')))[0]
  assert.ok(theirs, 'the other tenant has a group')
  const saved = await ok(owner.put(`/api/pos/kiosk-designs/${design.id}`, {
    name: design.name,
    settings: { ...design.settings, options: { ...design.settings.options, group_looks: [
      { group_id: g.id, tiles: 'hexagon', entrance: 'slide', display: 'wheel', pictures: false },
      { group_id: theirs.id, tiles: 'plain' },
      { group_id: other.id },
      { group_id: g.id, tiles: 'oval' },
      { group_id: 'nope', tiles: 'oval' },
    ] } },
  }))
  assert.deepEqual(saved.settings.options.group_looks, [
    { group_id: g.id, display: 'wheel', tiles: 'hexagon', pictures: false, entrance: 'slide' },
    { group_id: other.id, display: null, tiles: null, pictures: null, entrance: null },
  ], 'the other tenant\'s group, a second row for the same group and a bad id are left out')
  const listed = (await ok(owner.get('/api/pos/kiosk-designs'))).find(d => d.id === design.id)
  assert.deepEqual(listed.settings.options.group_looks, saved.settings.options.group_looks)

  // The kiosk gets the design's looks and the group's own.
  const link = await ok(owner.post(`/api/pos/kiosk-designs/${design.id}/preview`, { venue_id: mine.ids.venue }))
  const cfg = await preview(link.token)
  assert.deepEqual(cfg.design.options.group_looks, saved.settings.options.group_looks)
  assert.equal(cfg.groups[g.id].kiosk_tiles, 'round')

  // A deleted group drops off at the next save.
  await ok(owner.delete(`/api/menus/variant-groups/${other.id}`))
  const again = await ok(owner.put(`/api/pos/kiosk-designs/${design.id}`, { name: design.name, settings: listed.settings }))
  assert.deepEqual(again.settings.options.group_looks.map(x => x.group_id), [g.id])
})

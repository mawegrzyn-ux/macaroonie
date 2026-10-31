// Till layouts (migration 228; routes/tillLayouts.js, shared/pos/tillLayout.js):
// company-wide layouts, which one a venue's tills and a till use, what reaches
// the till's config, and the company's own ids.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, ok, closeApp, sql } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'

let ids, owner, operator, other, V, W, till, mine, theirs

async function config(d) {
  const app = await getApp()
  const res = await app.inject({
    method: 'GET', url: '/pos-api/config',
    headers: { authorization: `Device ${d.device_id}.${d.secret}`, [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET },
  })
  assert.equal(res.statusCode, 200, res.body)
  return res.json()
}
// A tenant's first section, its first dish and its first till discount.
async function menuIds(who, menuId) {
  const menu = await ok(who.get('/api/menus/' + menuId))
  const section = menu.sections.find(s => s.items?.length)
  const presets = await ok(who.get('/api/pos/discounts'))
  return { section: section.id, item: section.items[0].id, preset: (presets.discounts || presets)[0]?.id }
}
const layoutWith = ({ section, item, preset }) => ({
  cols: 12, rows: 8,
  zones: [
    { id: 'check', type: 'check', x: 0, y: 0, w: 4, h: 8 },
    { id: 'cats', type: 'categories', x: 4, y: 0, w: 8, h: 1, sections: [section] },
    { id: 'dishes', type: 'items', x: 4, y: 1, w: 8, h: 5 },
    {
      id: 'pay', type: 'buttons', x: 4, y: 6, w: 8, h: 2,
      buttons: [{ id: 'b1', action: 'item', item_id: item }, { id: 'b2', action: 'discount_preset', preset_id: preset }, { id: 'b3', action: 'exact_cash' }],
    },
  ],
})

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  const filledB = await fillTenant(B.owner, ids.b, { mark: 'Yyl', slug: 'yyl' })
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  other = as(B.owner, ids.b)
  V = filled.ids.venue
  W = filledB.ids.venue
  till = await linkDevice(owner, V, { kind: 'terminal', name: 'Zql Till' })
  mine = await menuIds(owner, filled.ids.menu)
  theirs = await menuIds(other, filledB.ids.menu)
  assert.ok(mine.preset && theirs.preset, 'both groups have a till discount')
  // The fixtures made a layout in each group, used by Ware and its till:
  // start without them (deleting puts both back to the standard screen).
  for (const who of [owner, other]) {
    for (const l of (await ok(who.get('/api/pos/till-layouts'))).layouts) await ok(who.delete('/api/pos/till-layouts/' + l.id))
  }
  const [s] = await sql`SELECT till_layout_id FROM pos_settings WHERE venue_id = ${V}`
  assert.equal(s.till_layout_id, null, 'the venue is back on the standard screen')
  const [left] = await sql`SELECT count(*)::int AS n FROM pos_devices WHERE tenant_id = ${ids.a} AND settings ? 'till_layout'`
  assert.equal(left.n, 0, 'no till names a deleted layout')
})
after(closeApp)

test('layouts: made from a template or a copy, saved, problems refused, listed with where they are used', async () => {
  const quick = await ok(owner.post('/api/pos/till-layouts', { name: 'Zql Quick', template: 'quick' }))
  assert.equal(quick.name, 'Zql Quick')
  assert.ok(quick.layout.zones.some(z => z.type === 'modifiers' && z.kind === 'required'), 'the quick template')
  assert.deepEqual(quick.problems, [])
  const std = await ok(owner.post('/api/pos/till-layouts', { name: 'Zql Standard' }))
  assert.deepEqual(std.layout.zones.map(z => z.type), ['check', 'categories', 'items', 'seats'])
  const copy = await ok(owner.post('/api/pos/till-layouts', { name: 'Zql Copy', copy_from: quick.id }))
  assert.deepEqual(copy.layout, quick.layout)

  // Saved: normalised, a name needed.
  const saved = await ok(owner.put('/api/pos/till-layouts/' + std.id, { name: 'Zql Bar', layout: { ...layoutWith(mine), cols: 99 } }))
  assert.equal(saved.name, 'Zql Bar')
  assert.equal(saved.layout.cols, 24, 'numbers kept inside their limits')
  assert.equal((await owner.put('/api/pos/till-layouts/' + std.id, { name: ' ', layout: layoutWith(mine) })).status, 400)
  // Overlapping zones: refused with the problems listed.
  const bad = await owner.put('/api/pos/till-layouts/' + std.id, {
    name: 'Zql Bar',
    layout: { zones: [{ type: 'check', x: 0, y: 0, w: 6, h: 8 }, { type: 'items', x: 5, y: 0, w: 4, h: 4 }] },
  })
  assert.equal(bad.status, 422)
  assert.equal(bad.json.code, 'layout')
  assert.match(bad.json.error, /overlap/)
  assert.equal(bad.json.problems[0].code, 'overlap')
  const noCheck = await owner.put('/api/pos/till-layouts/' + std.id, { name: 'Zql Bar', layout: { zones: [{ type: 'items', x: 0, y: 0, w: 4, h: 4 }] } })
  assert.equal(noCheck.json.problems[0].code, 'no_check')
  assert.equal((await ok(owner.get('/api/pos/till-layouts/' + std.id))).layout.zones.length, 4, 'a refused save changes nothing')

  const list = await ok(owner.get('/api/pos/till-layouts'))
  assert.deepEqual(list.layouts.map(l => l.name), ['Zql Bar', 'Zql Copy', 'Zql Quick'])
  assert.deepEqual(list.templates.map(t => t.key), ['standard', 'quick'])
  // Store tech's setup lists them for the venue and till choices.
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  assert.deepEqual(setup.till_layouts.map(l => l.name), ['Zql Bar', 'Zql Copy', 'Zql Quick'])
  await ok(owner.delete('/api/pos/till-layouts/' + copy.id))
  await ok(owner.delete('/api/pos/till-layouts/' + quick.id))
})

test('a layout keeps only the company\'s own sections, dishes and discounts', async () => {
  const l = await ok(owner.post('/api/pos/till-layouts', { name: 'Zql Mixed' }))
  const mixed = layoutWith(mine)
  mixed.zones[1].sections = [mine.section, theirs.section]
  mixed.zones[3].buttons.push({ id: 'x1', action: 'item', item_id: theirs.item }, { id: 'x2', action: 'discount_preset', preset_id: theirs.preset })
  const saved = await ok(owner.put('/api/pos/till-layouts/' + l.id, { name: 'Zql Mixed', layout: mixed }))
  assert.deepEqual(saved.layout.zones[1].sections, [mine.section])
  assert.deepEqual(saved.layout.zones[3].buttons.map(b => b.id), ['b1', 'b2', 'b3'])
  await ok(owner.delete('/api/pos/till-layouts/' + l.id))
})

test('the venue\'s layout and a till\'s own reach the till; deleting a layout puts them back', async () => {
  const bar = await ok(owner.post('/api/pos/till-layouts', { name: 'Zql House' }))
  await ok(owner.put('/api/pos/till-layouts/' + bar.id, { name: 'Zql House', layout: layoutWith(mine) }))
  const quick = await ok(owner.post('/api/pos/till-layouts', { name: 'Zql Quick 2', template: 'quick' }))

  // None set: the standard screen.
  let cfg = await config(till)
  assert.equal(cfg.settings.till_layout_id, null)
  assert.deepEqual(cfg.till_layouts, {})

  // The venue's.
  const s = await ok(owner.patch(`/api/pos/venues/${V}/settings`, { till_layout_id: bar.id }))
  assert.equal(s.till_layout_id, bar.id)
  cfg = await config(till)
  assert.equal(cfg.settings.till_layout_id, bar.id)
  assert.deepEqual(Object.keys(cfg.till_layouts), [bar.id])
  assert.equal(cfg.till_layouts[bar.id].name, 'Zql House')
  assert.equal(cfg.till_layouts[bar.id].zones[3].buttons[0].item_id, mine.item)
  // Another group's layout can't be picked.
  const theirLayout = await ok(other.post('/api/pos/till-layouts', { name: 'Yyl Theirs' }))
  assert.equal((await owner.patch(`/api/pos/venues/${V}/settings`, { till_layout_id: theirLayout.id })).status, 422)

  // The till's own: a layout, the standard screen, or back to the venue's.
  const dev = (await ok(owner.get(`/api/pos/venues/${V}/setup`))).devices.find(d => d.id === till.device_id)
  await ok(owner.patch('/api/pos/devices/' + till.device_id, { settings: { ...dev.settings, till_layout: quick.id } }))
  cfg = await config(till)
  assert.deepEqual(Object.keys(cfg.till_layouts).sort(), [bar.id, quick.id].sort())
  assert.equal(cfg.device.settings.till_layout, quick.id)
  await ok(owner.patch('/api/pos/devices/' + till.device_id, { settings: { ...dev.settings, till_layout: 'standard' } }))
  assert.equal((await config(till)).device.settings.till_layout, 'standard')
  assert.equal((await owner.patch('/api/pos/devices/' + till.device_id, { settings: { ...dev.settings, till_layout: theirLayout.id } })).status, 422)
  assert.equal((await owner.patch('/api/pos/devices/' + till.device_id, { settings: { ...dev.settings, till_layout: 'sideways' } })).status, 400)

  // Where each is used.
  await ok(owner.patch('/api/pos/devices/' + till.device_id, { settings: { ...dev.settings, till_layout: quick.id } }))
  const list = await ok(owner.get('/api/pos/till-layouts'))
  const used = name => list.layouts.find(l => l.name === name).used_by
  assert.deepEqual(used('Zql House').venues.map(v => v.id), [V])
  assert.deepEqual(used('Zql Quick 2').tills.map(t => t.id), [till.device_id])

  // Deleting: the till goes back to its venue's, the venue to the standard screen.
  await ok(owner.delete('/api/pos/till-layouts/' + quick.id))
  cfg = await config(till)
  assert.equal(cfg.device.settings.till_layout, undefined)
  assert.deepEqual(Object.keys(cfg.till_layouts), [bar.id])
  await ok(owner.delete('/api/pos/till-layouts/' + bar.id))
  cfg = await config(till)
  assert.equal(cfg.settings.till_layout_id, null)
  assert.deepEqual(cfg.till_layouts, {})
  await ok(other.delete('/api/pos/till-layouts/' + theirLayout.id))
})

test('Store tech view reads, manage changes; another group can\'t touch them', async () => {
  const l = await ok(owner.post('/api/pos/till-layouts', { name: 'Zql Locked' }))
  assert.equal((await operator.get('/api/pos/till-layouts')).status, 403, 'operators have no Store tech access by default')
  await sql`UPDATE tenant_roles SET permissions = permissions || '{"pos_setup": "view"}'::jsonb WHERE tenant_id = ${ids.a} AND key = 'operator'`
  assert.equal((await operator.get('/api/pos/till-layouts')).status, 200)
  assert.equal((await operator.get('/api/pos/till-layouts/' + l.id)).status, 200)
  assert.equal((await operator.post('/api/pos/till-layouts', { name: 'Zql Nope' })).status, 403)
  assert.equal((await operator.put('/api/pos/till-layouts/' + l.id, { name: 'Zql Nope', layout: layoutWith(mine) })).status, 403)
  assert.equal((await operator.delete('/api/pos/till-layouts/' + l.id)).status, 403)
  assert.equal((await operator.patch(`/api/pos/venues/${V}/settings`, { till_layout_id: l.id })).status, 403)
  assert.equal((await other.get('/api/pos/till-layouts/' + l.id)).status, 404)
  assert.equal((await other.put('/api/pos/till-layouts/' + l.id, { name: 'Yyl Mine', layout: layoutWith(theirs) })).status, 404)
  assert.equal((await other.delete('/api/pos/till-layouts/' + l.id)).status, 404)
  assert.equal((await other.post('/api/pos/till-layouts', { name: 'Yyl Copy', copy_from: l.id })).status, 404)
  assert.deepEqual((await ok(other.get('/api/pos/till-layouts'))).layouts, [], 'not in another group\'s list')
  await ok(owner.delete('/api/pos/till-layouts/' + l.id))
})

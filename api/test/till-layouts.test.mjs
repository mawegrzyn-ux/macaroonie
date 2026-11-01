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

let ids, owner, operator, other, V, W, till, mine, theirs, menuA, menuB

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
  menuA = filled.ids.menu
  menuB = filledB.ids.menu
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

test('where the words sit on a zone\'s buttons: saved, cleaned, in the till\'s config; older layouts get the defaults', async () => {
  const l = await ok(owner.post('/api/pos/till-layouts', { name: 'Zql Words' }))
  const base = layoutWith(mine)
  const set = { cats: { align: 'right', valign: 'top' }, dishes: { align: 'center', valign: 'bottom' }, pay: { align: 'sideways', valign: 'up' }, check: { align: 'left', valign: 'top' } }
  const layout = { ...base, zones: base.zones.map(z => ({ ...z, ...set[z.id] })) }
  const saved = await ok(owner.put('/api/pos/till-layouts/' + l.id, { name: 'Zql Words', layout }))
  const by = id => saved.layout.zones.find(z => z.id === id)
  assert.deepEqual([by('cats').align, by('cats').valign], ['right', 'top'])
  assert.deepEqual([by('dishes').align, by('dishes').valign], ['center', 'bottom'])
  assert.deepEqual([by('pay').align, by('pay').valign], ['center', 'middle'], 'not ours: the Buttons zone\'s default')
  assert.equal('align' in by('check'), false, 'the Order zone has no grid of buttons')
  const [row] = await sql`SELECT layout FROM pos_till_layouts WHERE id = ${l.id}`
  assert.equal(row.layout.zones.find(z => z.id === 'dishes').valign, 'bottom', 'stored')

  // The till gets them.
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { till_layout_id: l.id }))
  let cfg = await config(till)
  const tz = id => cfg.till_layouts[l.id].zones.find(z => z.id === id)
  assert.deepEqual([tz('cats').align, tz('cats').valign, tz('dishes').align, tz('dishes').valign], ['right', 'top', 'center', 'bottom'])

  // A layout stored before they could be set: each zone as it drew its words.
  const old = { ...row.layout, zones: row.layout.zones.map(({ align, valign, ...z }) => z) }
  await sql`UPDATE pos_till_layouts SET layout = ${sql.json(old)} WHERE id = ${l.id}`
  const view = await ok(owner.get('/api/pos/till-layouts/' + l.id))
  const vz = id => view.layout.zones.find(z => z.id === id)
  assert.deepEqual([vz('cats').align, vz('cats').valign], ['center', 'middle'])
  assert.deepEqual([vz('dishes').align, vz('dishes').valign], ['left', 'top'])
  assert.deepEqual([vz('pay').align, vz('pay').valign], ['center', 'middle'])
  cfg = await config(till)
  assert.deepEqual([tz('dishes').align, tz('dishes').valign], ['left', 'top'])

  // The designer's preview shows each dish's price.
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  assert.ok(setup.items.length && setup.items.every(i => 'price_pence' in i))
  assert.ok(setup.items.some(i => i.price_pence > 0))

  await ok(owner.delete('/api/pos/till-layouts/' + l.id))
})

test('Menus zone: the company\'s own menus kept, its options reach the till, the designer gets each menu\'s till times', async () => {
  const l = await ok(owner.post('/api/pos/till-layouts', { name: 'Zql Menus' }))
  const base = layoutWith(mine)
  const layout = {
    ...base,
    zones: [
      ...base.zones.map(z => (z.id === 'dishes' ? { ...z, h: 4, y: 2 } : z)),
      { id: 'menus', type: 'menus', x: 4, y: 1, w: 8, h: 1, cols: 3, rows: 1, menu_ids: [menuB, menuA], tap: 'several', times_button: false, show_times: true, align: 'left' },
    ],
  }
  const saved = await ok(owner.put('/api/pos/till-layouts/' + l.id, { name: 'Zql Menus', layout }))
  const z = saved.layout.zones.find(x => x.id === 'menus')
  assert.deepEqual(z.menu_ids, [menuA], 'another group\'s menu dropped')
  assert.deepEqual([z.tap, z.times_button, z.show_times, z.cols, z.align, z.overflow], ['several', false, true, 3, 'left', 'scroll'])
  const [row] = await sql`SELECT layout FROM pos_till_layouts WHERE id = ${l.id}`
  assert.deepEqual(row.layout.zones.find(x => x.id === 'menus').menu_ids, [menuA], 'stored without it')
  // Two Menus zones: refused.
  const two = await owner.put('/api/pos/till-layouts/' + l.id, { name: 'Zql Menus', layout: { ...layout, zones: [...layout.zones, { id: 'menus2', type: 'menus', x: 4, y: 6, w: 8, h: 1 }].filter(x => x.id !== 'pay') } })
  assert.equal(two.status, 422)
  assert.equal(two.json.problems[0].code, 'too_many')

  // The till gets the zone.
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { till_layout_id: l.id }))
  const cfg = await config(till)
  const tz = cfg.till_layouts[l.id].zones.find(x => x.id === 'menus')
  assert.deepEqual([tz.type, tz.menu_ids, tz.tap, tz.show_times], ['menus', [menuA], 'several', true])

  // The designer: each menu's times on the tills (any time, its own, or off).
  let setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  const timesOf = (st, id) => st.menus.find(m => m.id === id).till_times
  assert.deepEqual(timesOf(setup, menuA), { from: '2026-01-01', until: null, times: [] }, 'the fixtures\' menu: its own times on the tills')
  const lunch = { from: null, until: null, times: [{ days: [1, 2, 3, 4, 5], start: '11:00', end: '15:00' }] }
  await ok(owner.put(`/api/menu-times/venues/${V}`, { rows: [{ menu_id: menuA, times: null, web: { use: 'menu' }, kiosk: { use: 'always' }, till: { use: 'own', times: lunch } }] }))
  setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  assert.deepEqual(timesOf(setup, menuA), lunch)
  await ok(owner.put(`/api/menu-times/venues/${V}`, { rows: [{ menu_id: menuA, times: null, web: { use: 'menu' }, kiosk: { use: 'always' }, till: { use: 'off' } }] }))
  setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  assert.equal(timesOf(setup, menuA), false, 'off on the tills')
  await ok(owner.put(`/api/menu-times/venues/${V}`, { rows: [{ menu_id: menuA, times: null, web: { use: 'menu' }, kiosk: { use: 'always' }, till: { use: 'always' } }] }))
  setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  assert.equal(timesOf(setup, menuA), null, 'any time')
  assert.equal(setup.menus.some(m => m.id === menuB), false, 'only the venue\'s menus')

  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { till_layout_id: null }))
  await ok(owner.delete('/api/pos/till-layouts/' + l.id))
})

test('Pop-up zones: saved with the buttons that open them, another group\'s dish dropped, one nothing closes refused, in the till\'s config', async () => {
  const l = await ok(owner.post('/api/pos/till-layouts', { name: 'Zql Pop-ups' }))
  const base = layoutWith(mine)
  const drinks = {
    id: 'drinks', type: 'popup', x: 5, y: 1, w: 6, h: 4, title: 'Zql Drinks', frame: false, controls: false, close_outside: true, close_on_tap: true,
    cols: 2, rows: 2, align: 'left',
    buttons: [
      { id: 'mine', action: 'item', item_id: mine.item, w: 2 },
      { id: 'theirs', action: 'item', item_id: theirs.item },
      { id: 'done', action: 'close_popup', label: 'Done' },
      { id: 'cash', action: 'exact_cash' },
    ],
  }
  const layout = {
    ...base,
    zones: [
      ...base.zones.map(z => (z.id === 'pay'
        ? { ...z, buttons: [...z.buttons, { id: 'open', action: 'open_popup', popup_id: 'drinks' }, { id: 'shut', action: 'close_popup' }, { id: 'lost', action: 'open_popup', popup_id: 'gone' }] }
        : z)),
      drinks,
    ],
  }
  const saved = await ok(owner.put('/api/pos/till-layouts/' + l.id, { name: 'Zql Pop-ups', layout }))
  const p = saved.layout.zones.find(x => x.id === 'drinks')
  assert.deepEqual(p.buttons.map(b => b.id), ['mine', 'done', 'cash'], 'another group\'s dish dropped')
  assert.deepEqual([p.type, p.title, p.frame, p.controls, p.close_outside, p.close_on_tap, p.cols, p.rows, p.align, p.overflow],
    ['popup', 'Zql Drinks', false, false, true, true, 2, 2, 'left', 'pages'])
  assert.deepEqual(saved.layout.zones.find(x => x.id === 'pay').buttons.map(b => b.id), ['b1', 'b2', 'b3', 'open'],
    'Close only in a pop-up; a button opening a pop-up the layout lacks goes')
  assert.deepEqual(saved.problems, [])
  assert.ok(!saved.warnings.some(w => w.code === 'popup_unopened'), 'opened by the Pay zone\'s button')
  const [row] = await sql`SELECT layout FROM pos_till_layouts WHERE id = ${l.id}`
  assert.deepEqual(row.layout.zones.find(x => x.id === 'drinks').buttons.map(b => b.id), ['mine', 'done', 'cash'], 'stored as shown')

  // Nothing closes it once it is open: refused with the reason.
  const stuck = { ...layout, zones: layout.zones.map(z => (z.id === 'drinks' ? { ...z, close_outside: false, close_on_tap: false, buttons: z.buttons.filter(b => b.action !== 'close_popup') } : z)) }
  const refused = await owner.put('/api/pos/till-layouts/' + l.id, { name: 'Zql Pop-ups', layout: stuck })
  assert.equal(refused.status, 422)
  assert.equal(refused.json.code, 'layout')
  assert.deepEqual(refused.json.problems.map(x => x.code), ['popup_stuck'])
  assert.deepEqual(refused.json.problems[0].zones, ['drinks'])
  assert.match(refused.json.error, /Nothing closes a pop-up once it is open \(Zql Drinks\)/)
  // After any button with only another group's dish left: nothing to tap, so nothing closes it.
  const theirsOnly = { ...layout, zones: layout.zones.map(z => (z.id === 'drinks' ? { ...z, close_outside: false, buttons: [{ id: 'theirs', action: 'item', item_id: theirs.item }] } : z)) }
  const refused2 = await owner.put('/api/pos/till-layouts/' + l.id, { name: 'Zql Pop-ups', layout: theirsOnly })
  assert.equal(refused2.status, 422)
  assert.deepEqual(refused2.json.problems.map(x => x.code), ['popup_stuck'], 'checked after another group\'s ids go')

  // Taken out, the button that opened it goes with it.
  const without = await ok(owner.put('/api/pos/till-layouts/' + l.id, { name: 'Zql Pop-ups', layout: { ...layout, zones: layout.zones.filter(z => z.id !== 'drinks') } }))
  assert.deepEqual(without.layout.zones.find(x => x.id === 'pay').buttons.map(b => b.id), ['b1', 'b2', 'b3'])

  // Back in; the till gets it, the Pay zone's opener and the pop-up's own buttons.
  await ok(owner.put('/api/pos/till-layouts/' + l.id, { name: 'Zql Pop-ups', layout }))
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { till_layout_id: l.id }))
  const cfg = await config(till)
  const tl = cfg.till_layouts[l.id]
  const tz = tl.zones.find(x => x.id === 'drinks')
  assert.deepEqual([tz.type, tz.title, tz.frame, tz.controls, tz.close_outside, tz.close_on_tap], ['popup', 'Zql Drinks', false, false, true, true])
  assert.deepEqual(tz.buttons.map(b => [b.id, b.action]), [['mine', 'item'], ['done', 'close_popup'], ['cash', 'exact_cash']])
  assert.equal(tz.buttons[0].item_id, mine.item)
  assert.deepEqual(tl.zones.find(x => x.id === 'pay').buttons.find(b => b.id === 'open'), { id: 'open', action: 'open_popup', label: null, colour: null, w: 1, h: 1, popup_id: 'drinks' })
  const listed = (await ok(owner.get('/api/pos/till-layouts'))).layouts.find(x => x.id === l.id)
  assert.equal(listed.problems, 0)

  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { till_layout_id: null }))
  await ok(owner.delete('/api/pos/till-layouts/' + l.id))
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

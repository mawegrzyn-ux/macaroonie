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
  assert.deepEqual(list.templates.map(t => t.key), ['standard', 'quick', 'phone', 'phone_table', 'phone_categories'])
  assert.deepEqual(list.templates.filter(t => t.phone).map(t => t.key), ['phone', 'phone_table', 'phone_categories'], 'the phone starting points are marked')
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

test('a category\'s dishes zone and dishes left out: own ids kept, in the till\'s config', async () => {
  const menu = await ok(owner.get('/api/menus/' + menuA))
  // A section and dishes nothing else on the layout names, so the zone's own
  // ids are the only reason they are kept.
  const noodles = menu.sections.find(s => s.id === mine.section)
  const curry = noodles.items.find(i => i.id !== mine.item).id
  const section = menu.sections.find(s => s.id !== mine.section && s.items?.length)
  const dishIds = section.items.map(i => i.id)
  const l = await ok(owner.post('/api/pos/till-layouts', { name: 'Zql Drinks' }))
  const layout = layoutWith(mine)
  layout.zones[2].h = 3
  layout.zones[2].hide_item_ids = [curry, theirs.item, 'not-a-uuid', curry]
  layout.zones.push(
    { id: 'drinks', type: 'category', x: 4, y: 4, w: 4, h: 2, section_id: section.id, hide_item_ids: [dishIds[0], theirs.item], price: false },
    { id: 'theirs', type: 'category', x: 8, y: 4, w: 4, h: 2, section_id: theirs.section },
  )
  const saved = await ok(owner.put('/api/pos/till-layouts/' + l.id, { name: 'Zql Drinks', layout }))
  const z = id => saved.layout.zones.find(x => x.id === id)
  assert.deepEqual(z('dishes').hide_item_ids, [curry], 'the Dishes zone keeps its own dish once')
  assert.equal(z('drinks').type, 'category')
  assert.equal(z('drinks').section_id, section.id)
  assert.deepEqual(z('drinks').hide_item_ids, [dishIds[0]])
  assert.equal(z('drinks').price, false)
  assert.equal(z('theirs').section_id, null, 'another group\'s category is dropped')
  assert.deepEqual(z('theirs').hide_item_ids, [])
  assert.ok(saved.warnings.some(w => w.code === 'category_unset' && w.zones.includes('theirs')), JSON.stringify(saved.warnings))

  // Nine category zones are too many.
  const many = layoutWith(mine)
  many.zones[2].h = 1
  for (let i = 0; i < 9; i++) many.zones.push({ id: 'c' + i, type: 'category', x: 4 + (i % 8), y: 2 + Math.floor(i / 8), w: 1, h: 1, section_id: section.id })
  assert.equal((await owner.put('/api/pos/till-layouts/' + l.id, { name: 'Zql Drinks', layout: many })).status, 422)

  // The till gets it as saved.
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { till_layout_id: l.id }))
  const cfg = await config(till)
  const tz = cfg.till_layouts[l.id].zones.find(x => x.id === 'drinks')
  assert.equal(tz.section_id, section.id)
  assert.deepEqual(tz.hide_item_ids, [dishIds[0]])
  assert.ok(cfg.menus.some(m => m.sections.some(s => s.id === section.id)), 'the till has the category')
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { till_layout_id: null }))
  await ok(owner.delete('/api/pos/till-layouts/' + l.id))
})

test('several Dishes zones, each following a Categories zone: saved, checked, in the till\'s config', async () => {
  const menu = await ok(owner.get('/api/menus/' + menuA))
  const drinks = menu.sections.find(s => s.id !== mine.section && s.items?.length)
  const l = await ok(owner.post('/api/pos/till-layouts', { name: 'Zql Two lists' }))
  const layout = {
    cols: 12, rows: 8,
    zones: [
      { id: 'check', type: 'check', x: 0, y: 0, w: 4, h: 8 },
      { id: 'food', type: 'categories', x: 4, y: 0, w: 4, h: 1, sections: [mine.section] },
      { id: 'drink', type: 'categories', x: 8, y: 0, w: 4, h: 1, sections: [drinks.id] },
      { id: 'mains', type: 'items', x: 4, y: 1, w: 4, h: 7, follows: 'food' },
      { id: 'glasses', type: 'items', x: 8, y: 1, w: 4, h: 7, follows: 'drink' },
    ],
  }
  const put = body => owner.put('/api/pos/till-layouts/' + l.id, { name: 'Zql Two lists', layout: body })
  const saved = await ok(put(layout))
  const z = (r, id) => r.layout.zones.find(x => x.id === id)
  assert.equal(z(saved, 'mains').follows, 'food')
  assert.equal(z(saved, 'glasses').follows, 'drink')
  assert.deepEqual(saved.warnings.filter(w => ['categories_alone', 'same_dishes', 'items_alone'].includes(w.code)), [], JSON.stringify(saved.warnings))

  // Following a zone that isn't a Categories zone means following the first:
  // both lists then show the food, and nothing shows the drinks.
  const stale = await ok(put({ ...layout, zones: layout.zones.map(x => (x.id === 'glasses' ? { ...x, follows: 'mains' } : x)) }))
  assert.equal(z(stale, 'glasses').follows, null)
  const same = stale.warnings.find(w => w.code === 'same_dishes')
  assert.deepEqual(same?.zones, ['mains', 'glasses'], JSON.stringify(stale.warnings))
  const alone = stale.warnings.find(w => w.code === 'categories_alone')
  assert.deepEqual(alone?.zones, ['drink'])
  assert.match(alone.message, /Categories 2/)

  // Four of each are allowed, five Dishes zones are too many.
  const five = await put({ ...layout, zones: [...layout.zones.slice(0, 3), ...[0, 1, 2, 3, 4].map(i => ({ id: 'd' + i, type: 'items', x: 4 + i, y: 1, w: 1, h: 7 }))] })
  assert.equal(five.status, 422)
  assert.equal(five.json.code, 'layout')
  assert.ok(five.json.problems.some(p => p.code === 'too_many'), JSON.stringify(five.json.problems))

  // The till gets it as saved.
  await ok(put(layout))
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { till_layout_id: l.id }))
  const cfg = await config(till)
  const tz = id => cfg.till_layouts[l.id].zones.find(x => x.id === id)
  assert.equal(tz('mains').follows, 'food')
  assert.equal(tz('glasses').follows, 'drink')
  assert.deepEqual(tz('drink').sections, [drinks.id])
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { till_layout_id: null }))
  await ok(owner.delete('/api/pos/till-layouts/' + l.id))
})

test('the look: Label zones, backgrounds, borders and a category\'s colours saved, cleaned and in the till\'s config; up to 50 zones', async () => {
  const l = await ok(owner.post('/api/pos/till-layouts', { name: 'Zql The look' }))
  const put = body => owner.put('/api/pos/till-layouts/' + l.id, { name: 'Zql The look', layout: body })
  const layout = {
    cols: 12, rows: 8, background: '#0F172A',
    zones: [
      { id: 'check', type: 'check', x: 0, y: 0, w: 4, h: 8, background: '#000000', border: { style: 'bold', colour: '#FF0000' } },
      { id: 'hello', type: 'label', x: 4, y: 0, w: 8, h: 1, text: '  Welcome\r\nto Zql  ', font: 30, colour: '#FFFFFF', background: '#1F2A44', border: { style: 'dotted' } },
      { id: 'drinks', type: 'category', x: 4, y: 1, w: 8, h: 4, section_id: mine.section, button_colour: '#FEF3C7', button_text: 'nope', show_name: true, name_font: 22, name_colour: '#1F2A44', button_border: { style: 'thin', colour: '#00FF00' } },
      { id: 'pay', type: 'buttons', x: 4, y: 5, w: 8, h: 3, background: 'not a colour', button_border: { style: 'none' }, buttons: [{ id: 'b1', action: 'exact_cash' }] },
    ],
  }
  const saved = await ok(put(layout))
  const z = id => saved.layout.zones.find(x => x.id === id)
  assert.equal(saved.layout.background, '#0f172a')
  assert.equal('background' in z('check'), false, 'the Order zone keeps its white panel')
  assert.deepEqual(z('check').border, { style: 'bold', colour: '#ff0000' })
  assert.deepEqual([z('hello').text, z('hello').font, z('hello').colour, z('hello').background], ['Welcome\nto Zql', 30, '#ffffff', '#1f2a44'])
  assert.deepEqual(z('hello').border, { style: 'dotted', colour: null })
  assert.equal('button_border' in z('hello'), false)
  assert.deepEqual([z('drinks').section_id, z('drinks').button_colour, z('drinks').button_text, z('drinks').show_name, z('drinks').name_font, z('drinks').name_colour],
    [mine.section, '#fef3c7', null, true, 22, '#1f2a44'])
  assert.deepEqual(z('drinks').button_border, { style: 'thin', colour: '#00ff00' })
  assert.equal(z('pay').background, null)
  assert.deepEqual(z('pay').button_border, { style: 'none', colour: null })
  const [row] = await sql`SELECT layout FROM pos_till_layouts WHERE id = ${l.id}`
  assert.equal(row.layout.zones.find(x => x.id === 'hello').text, 'Welcome\nto Zql', 'stored as cleaned')
  // The till gets it as saved.
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { till_layout_id: l.id }))
  const cfg = await config(till)
  const t = cfg.till_layouts[l.id]
  assert.equal(t.background, '#0f172a')
  assert.equal(t.zones.find(x => x.id === 'hello').text, 'Welcome\nto Zql')
  assert.equal(t.zones.find(x => x.id === 'drinks').button_colour, '#fef3c7')
  assert.deepEqual(t.zones.find(x => x.id === 'check').border, { style: 'bold', colour: '#ff0000' })
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { till_layout_id: null }))
  // A Label with no words is a note, still saved.
  const blank = await ok(put({ ...layout, zones: layout.zones.map(x => (x.id === 'hello' ? { ...x, text: '   ' } : x)) }))
  assert.deepEqual(blank.warnings.filter(w => w.code === 'empty_label').map(w => w.zones), [['hello']])
  // Every zone type at its most (49 zones) saves; more than 50 is refused.
  const n = (k, f) => Array.from({ length: k }, (_, i) => f(i))
  const many = {
    cols: 24, rows: 16,
    zones: [
      { id: 'check', type: 'check', x: 0, y: 0, w: 4, h: 16 },
      ...n(12, i => ({ id: 'l' + i, type: 'label', x: 4 + i, y: 0, w: 1, h: 1, text: 'L' + i })),
      ...n(8, i => ({ id: 'b' + i, type: 'buttons', x: 4 + i, y: 1, w: 1, h: 1, buttons: [{ id: 'x', action: 'no_sale' }] })),
      ...n(8, i => ({ id: 'k' + i, type: 'category', x: 4 + i, y: 2, w: 1, h: 1, section_id: mine.section })),
      ...n(4, i => ({ id: 'c' + i, type: 'categories', x: 4 + i, y: 3, w: 1, h: 1 })),
      ...n(4, i => ({ id: 'd' + i, type: 'items', x: 4 + i, y: 4, w: 1, h: 1, follows: 'c' + i })),
      { id: 'menus', type: 'menus', x: 4, y: 5, w: 1, h: 1 },
      { id: 'seats', type: 'seats', x: 5, y: 5, w: 1, h: 1 },
      { id: 'must', type: 'modifiers', x: 12, y: 8, w: 4, h: 4, kind: 'required' },
      { id: 'opt', type: 'modifiers', x: 16, y: 8, w: 4, h: 4, kind: 'optional' },
      ...n(8, i => ({ id: 'p' + i, type: 'popup', x: 12, y: 0, w: 4, h: 4, title: 'P' + i, buttons: [{ id: 'x', action: 'no_sale' }] })),
    ],
  }
  assert.equal(many.zones.length, 49)
  const big = await ok(put(many))
  assert.equal(big.layout.zones.length, 49)
  assert.deepEqual(big.problems || [], [])
  const thirteen = await put({ ...many, zones: [...many.zones, { id: 'l12', type: 'label', x: 4, y: 6, w: 1, h: 1, text: 'One too many' }] })
  assert.equal(thirteen.status, 422)
  assert.ok(thirteen.json.problems.some(p => p.code === 'too_many'), JSON.stringify(thirteen.json.problems))
  const tooMany = await put({ ...many, zones: [...many.zones, ...n(2, i => ({ id: 'x' + i, type: 'label', x: 6 + i, y: 5, w: 1, h: 1 }))] })
  assert.equal(tooMany.status, 400)
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

test('Phone layouts: the phone templates, zones shown as pop-ups and as lists, an order no button can open refused, in the lists and the till\'s config', async () => {
  // Each phone starting point: made for a phone, no top bar, the dishes as a
  // list, the order a pop-up over the whole screen with a button that opens it.
  for (const key of ['phone', 'phone_table', 'phone_categories']) {
    const made = await ok(owner.post('/api/pos/till-layouts', { name: 'Zql ' + key, template: key }))
    assert.deepEqual([made.layout.phone, made.layout.top_bar, made.layout.cols, made.layout.rows], [true, false, 6, 12], key)
    assert.deepEqual(made.problems, [], key)
    const order = made.layout.zones.find(z => z.type === 'check')
    assert.deepEqual([order.show, order.cover, order.controls, order.close_on_tap], ['popup', 'screen', true, false], key + ': the order')
    const bar = made.layout.zones.find(z => z.type === 'buttons')
    assert.ok(bar.buttons.some(b => b.action === 'open_popup' && b.popup_id === order.id), key + ': a button opens the order')
    assert.equal(made.layout.zones.find(z => z.type === 'items').view, 'list', key + ': dishes as a list')
    assert.ok(!made.warnings.some(w => w.code === 'popup_unopened'), key + ': every pop-up has a button')
    await ok(owner.delete('/api/pos/till-layouts/' + made.id))
  }
  assert.equal((await owner.post('/api/pos/till-layouts', { name: 'Zql Watch', template: 'watch' })).status, 400, 'an unknown starting point')

  const l = await ok(owner.post('/api/pos/till-layouts', { name: 'Zql Phone', template: 'phone' }))
  const base = l.layout
  const ids = Object.fromEntries(base.zones.map(z => [z.type, z.id]))
  // The categories as a pop-up list with their own name, opened from the bar;
  // values that aren't offered go back to the usual ones.
  const layout = {
    ...base,
    zones: base.zones.map(z => (z.type === 'categories'
      ? { ...z, show: 'popup', title: '  Zql Food  ', cover: 'sideways', frame: false, view: 'list', cols: 5, rows: 6, close_on_tap: undefined, sections: [mine.section, theirs.section] }
      : z.type === 'items' ? { ...z, show: 'sometimes', view: 'rows', title: 'Zql Nope', cover: 'screen' }
        // A list that scrolls: every button is in reach.
        : z.type === 'buttons' ? { ...z, view: 'list', cols: 4, overflow: 'scroll', buttons: [...z.buttons, { id: 'food', action: 'open_popup', popup_id: ids.categories }] }
          : z)),
  }
  const saved = await ok(owner.put('/api/pos/till-layouts/' + l.id, { name: 'Zql Phone', layout }))
  const zone = type => saved.layout.zones.find(z => z.type === type)
  const cats = zone('categories')
  assert.deepEqual([cats.show, cats.title, cats.cover, cats.frame, cats.controls, cats.close_outside, cats.close_on_tap],
    ['popup', 'Zql Food', 'zone', false, true, true, true], 'a zone shown as a pop-up: its name trimmed, the usual values where none fits')
  assert.deepEqual([cats.view, cats.cols, cats.rows], ['list', 1, 6], 'a list is one button across')
  assert.deepEqual(cats.sections, [mine.section], 'another group\'s category dropped')
  const dishes = zone('items')
  assert.deepEqual([dishes.show, dishes.view], ['always', 'grid'], 'unknown values: always there, a grid')
  assert.deepEqual(['title', 'cover', 'frame', 'controls', 'close_outside', 'close_on_tap'].filter(k => k in dishes), [], 'no pop-up settings on a zone that is always there')
  const bar = zone('buttons')
  assert.deepEqual([bar.view, bar.cols], ['list', 1])
  assert.ok(bar.buttons.every(b => b.w === 1), 'a list\'s buttons are one across')
  assert.deepEqual(bar.buttons.filter(b => b.action === 'open_popup').map(b => b.popup_id), [ids.check, ids.categories])
  assert.deepEqual(saved.problems, [])
  assert.ok(!saved.warnings.some(w => w.code === 'popup_unopened'))
  const [row] = await sql`SELECT layout FROM pos_till_layouts WHERE id = ${l.id}`
  assert.deepEqual([row.layout.phone, row.layout.zones.find(z => z.type === 'categories').show, row.layout.zones.find(z => z.type === 'categories').view], [true, 'popup', 'list'], 'stored as shown')

  // The order as a pop-up needs a button that opens it: refused without one.
  const unopened = { ...layout, zones: layout.zones.map(z => (z.type === 'buttons' ? { ...z, buttons: z.buttons.filter(b => b.popup_id !== ids.check) } : z)) }
  const refused = await owner.put('/api/pos/till-layouts/' + l.id, { name: 'Zql Phone', layout: unopened })
  assert.equal(refused.status, 422)
  assert.equal(refused.json.code, 'layout')
  assert.deepEqual(refused.json.problems.map(x => [x.code, x.zones]), [['order_unopened', [ids.check]]])
  assert.match(refused.json.error, /The Order zone is a pop-up and nothing opens it/)
  // Over the whole screen nothing is outside it to tap: without its window controls nothing closes the order.
  const stuck = { ...layout, zones: layout.zones.map(z => (z.type === 'check' ? { ...z, controls: false, close_outside: true, close_on_tap: true } : z)) }
  const refused2 = await owner.put('/api/pos/till-layouts/' + l.id, { name: 'Zql Phone', layout: stuck })
  assert.equal(refused2.status, 422)
  assert.deepEqual(refused2.json.problems.map(x => [x.code, x.zones]), [['popup_stuck', [ids.check]]])
  assert.match(refused2.json.error, /Nothing closes a pop-up once it is open \(Order\)/)
  assert.equal((await ok(owner.get('/api/pos/till-layouts/' + l.id))).layout.zones.find(z => z.type === 'check').controls, true, 'a refused save changes nothing')
  // Any other pop-up nothing opens is worth knowing, and saves.
  const lonely = { ...layout, zones: layout.zones.map(z => (z.type === 'buttons' ? { ...z, buttons: z.buttons.filter(b => b.id !== 'food') } : z)) }
  const warned = await ok(owner.put('/api/pos/till-layouts/' + l.id, { name: 'Zql Phone', layout: lonely }))
  assert.deepEqual(warned.warnings.filter(w => w.code === 'popup_unopened').map(w => w.zones), [[ids.categories]])
  assert.match(warned.warnings.find(w => w.code === 'popup_unopened').message, /Zql Food/)
  // A button its zone leaves out opens nothing. The phone bar is full and
  // leaves out what doesn't fit, so a fifth button there never shows: the
  // categories count as a pop-up nothing opens (worth knowing, and it saves).
  const crowded = {
    ...base,
    zones: base.zones.map(z => (z.type === 'categories' ? { ...z, show: 'popup' }
      : z.type === 'buttons' ? { ...z, buttons: [...z.buttons, { id: 'food', action: 'open_popup', popup_id: ids.categories }] }
        : z)),
  }
  const squeezed = await ok(owner.put('/api/pos/till-layouts/' + l.id, { name: 'Zql Phone', layout: crowded }))
  assert.deepEqual(squeezed.problems, [])
  assert.deepEqual(squeezed.warnings.filter(w => w.code === 'popup_unopened').map(w => w.zones), [[ids.buttons, ids.categories]], 'the zone holding the button first: that is where to make room')
  assert.match(squeezed.warnings.find(w => w.code === 'popup_unopened').message, /The button that opens a pop-up \(Categories\) doesn't fit in its zone and is left out/)
  // The order's own button left out is refused: nothing would open the order.
  const shut = {
    ...base,
    zones: base.zones.map(z => (z.type === 'buttons'
      ? { ...z, buttons: [...z.buttons.filter(b => b.popup_id !== ids.check), { id: 'f1', action: 'no_sale', w: 2 }, { id: 'f2', action: 'sign_out', w: 2 }, ...z.buttons.filter(b => b.popup_id === ids.check)] }
      : z)),
  }
  const refused3 = await owner.put('/api/pos/till-layouts/' + l.id, { name: 'Zql Phone', layout: shut })
  assert.equal(refused3.status, 422)
  assert.equal(refused3.json.code, 'layout')
  assert.deepEqual(refused3.json.problems.map(x => [x.code, x.zones]), [['order_unopened', [ids.buttons, ids.check]]])
  assert.match(refused3.json.error, /The button that opens the order doesn't fit in its zone and is left out, so nothing opens the order/)
  // In pages instead, every button is in reach: saved.
  const paged = { ...shut, zones: shut.zones.map(z => (z.type === 'buttons' ? { ...z, overflow: 'pages' } : z)) }
  assert.deepEqual((await ok(owner.put('/api/pos/till-layouts/' + l.id, { name: 'Zql Phone', layout: paged }))).problems, [])
  // A button in a pop-up nothing opens can't be tapped either: the order's
  // only button there is refused, until the bar opens that pop-up.
  const tools = { id: 'tools', type: 'popup', title: 'Zql Tools', x: 0, y: 6, w: 6, h: 4, buttons: [{ id: 'o2', action: 'open_popup', popup_id: ids.check }] }
  const inPopup = { ...base, zones: [...base.zones.map(z => (z.type === 'buttons' ? { ...z, buttons: z.buttons.filter(b => b.popup_id !== ids.check) } : z)), tools] }
  const refused4 = await owner.put('/api/pos/till-layouts/' + l.id, { name: 'Zql Phone', layout: inPopup })
  assert.equal(refused4.status, 422)
  assert.deepEqual(refused4.json.problems.map(x => [x.code, x.zones]), [['order_unopened', ['tools', ids.check]]])
  assert.match(refused4.json.error, /The button that opens the order is in a pop-up nothing opens \(Zql Tools\), so nothing opens the order/)
  const reached = { ...inPopup, zones: inPopup.zones.map(z => (z.type === 'buttons' ? { ...z, buttons: [...z.buttons, { id: 'tools', action: 'open_popup', popup_id: 'tools' }] } : z)) }
  const through = await ok(owner.put('/api/pos/till-layouts/' + l.id, { name: 'Zql Phone', layout: reached }))
  assert.deepEqual(through.problems, [])
  assert.ok(!through.warnings.some(w => w.code === 'popup_unopened'), 'the bar opens the pop-up, the pop-up opens the order')
  // Always there again: the button that opened it goes, and so do its pop-up settings.
  const always = await ok(owner.put('/api/pos/till-layouts/' + l.id, { name: 'Zql Phone', layout: { ...layout, zones: layout.zones.map(z => (z.type === 'categories' ? { ...z, show: 'always' } : z)) } }))
  assert.deepEqual(always.layout.zones.find(z => z.type === 'buttons').buttons.filter(b => b.action === 'open_popup').map(b => b.popup_id), [ids.check])
  assert.equal('title' in always.layout.zones.find(z => z.type === 'categories'), false)

  // In the lists: made for a phone or not.
  await ok(owner.put('/api/pos/till-layouts/' + l.id, { name: 'Zql Phone', layout }))
  const tablet = await ok(owner.post('/api/pos/till-layouts', { name: 'Zql Tablet' }))
  const these = rows => rows.filter(x => x.id === l.id || x.id === tablet.id).map(x => [x.name, x.phone])
  assert.deepEqual(these((await ok(owner.get('/api/pos/till-layouts'))).layouts), [['Zql Phone', true], ['Zql Tablet', false]])
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  assert.deepEqual(these(setup.till_layouts), [['Zql Phone', true], ['Zql Tablet', false]])

  // The till gets it whole: made for a phone, the order and the categories as pop-ups, the lists.
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { till_layout_id: l.id }))
  const cfg = await config(till)
  const tl = cfg.till_layouts[l.id]
  assert.deepEqual([tl.phone, tl.top_bar], [true, false])
  const tz = type => tl.zones.find(z => z.type === type)
  assert.deepEqual([tz('check').show, tz('check').cover], ['popup', 'screen'])
  assert.deepEqual([tz('categories').show, tz('categories').title, tz('categories').view, tz('categories').close_on_tap, tz('categories').sections], ['popup', 'Zql Food', 'list', true, [mine.section]])
  assert.deepEqual([tz('items').show, tz('buttons').view], ['always', 'list'])
  assert.deepEqual(tz('buttons').buttons.find(b => b.id === 'food'), { id: 'food', action: 'open_popup', label: null, colour: null, w: 1, h: 1, popup_id: ids.categories })

  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { till_layout_id: null }))
  await ok(owner.delete('/api/pos/till-layouts/' + tablet.id))
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

// The report builder's subjects phase 3d added for menus, menu screens, the
// website and local info (docs/REPORTS.md 20) against the app's own pages
// for the same rows:
//
//   menu publishes          each menu's Publishing window (GET /api/menus/:id/publish)
//   option groups, options  Menus → Variant groups (GET /api/menus/variant-groups)
//   tags, dish tags         Allergens & dietary and the allergen matrix
//   a dish's option groups, option prices and own options
//                           the menu editor (GET /api/menus/:id)
//   tax rates               Menus → Tax rates (GET /api/tax-rates)
//   menu screens, boards, playlists, walls
//                           the Menu screens pages (GET /api/screens/...)
//   reviews                 the Reviews page (GET /api/reviews, /stats)
//   website pages           Website → Pages & modals (GET /api/website/pages)
//   media                   the Media page (GET /api/media/items, /categories)
//   local info entries and captures
//                           the Local info page (GET /api/local-info/items, .../sources)
//
// Rows the API makes only from devices, the review sites, uploads or a
// capture's run (screens, releases at chosen times, reviews, media files,
// findings) are written here by SQL. Tenant B's rows sit beside them and
// must never show.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { runner, rowsOf, p, measures, refused, LEVELS } from './support/reports.mjs'
import { menuSaveBody } from '../src/routes/menus.js'
import { SYSTEM_PAGES, pagePath } from '../../shared/sitePages.js'
import { frequencyText } from '../../shared/localInfo.js'

const ALL = LEVELS

let ids, owner, V, V2, VB, run, filled, venues

const here = () => ({ field: 'venue', op: 'in', value: [V] })
const go = (spec, levels = ALL) => run(spec, undefined, { levels })
const sorted = list => [...list].map(String).sort()
const count = (list, f) => list.filter(f).length
const distinct = list => new Set(list).size
/** Words as a list shows them: an empty string reads as nothing. */
const words = v => (v == null || v === '' ? null : v)
/** A list result's rows as objects by column key, with the row's id. */
const listRows = res => res.rows.filter(r => r.kind === 'row').map(r => ({
  ...Object.fromEntries(res.columns.map((c, i) => [c.key, r.cells[i]])),
  _id: String(r.id),
}))
const byId = list => new Map(list.map(r => [String(r.id), r]))
/** A summary's figures with no rows. */
const figures = async (subject, list, filters = []) => rowsOf(await go({ subject, values: measures(list), filters }))[0]
const near = (a, b, what, within = 1e-6) => assert.ok(Math.abs(Number(a) - Number(b)) < within, `${what}: ${a} against ${b}`)
const days = (from, to) => Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86400_000)
const venueName = id => (id ? venues.find(v => v.id === id)?.name ?? null : null)

before(async () => {
  ids = await resetAndSeed()
  filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  const other = await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc' })
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  V2 = filled.ids.venue2
  VB = other.ids.venue
  run = runner(ids.a)
  venues = (await ok(owner.get('/api/venues'), 'venues'))
})
after(closeApp)

test('menu publishes: each menu\'s Publishing window, live, earlier, scheduled and cancelled', async () => {
  const [live] = await sql`
    SELECT id FROM menu_releases WHERE tenant_id = ${ids.a} AND menu_id = ${filled.ids.menu} AND cancelled_at IS NULL
     ORDER BY goes_live_at DESC, created_at DESC LIMIT 1`
  const hour = 3600_000
  const day = 24 * hour
  const now = Date.now()
  const add = (at, made, note, cancelled = false) => sql`
    INSERT INTO menu_releases (tenant_id, menu_id, snapshot, content_hash, goes_live_at, created_at, note, published_by, cancelled_at, cancelled_by)
    SELECT tenant_id, menu_id, snapshot, content_hash, ${new Date(at)}::timestamptz, ${new Date(made)}::timestamptz, ${note}::text,
           'boss@example.com', ${cancelled ? new Date(now) : null}::timestamptz, ${cancelled ? 'owner@example.com' : null}::text
      FROM menu_releases WHERE id = ${live.id}`
  await add(now - 2 * day, now - 2 * day, 'Zqx last week\'s prices')
  await add(now + 3 * day, now, 'Zqx Christmas prices')
  await add(now + 5 * day, now - hour, 'Zqx dropped', true)

  const menus = (await ok(owner.get('/api/menus'), 'menus'))
  const history = []
  for (const m of menus) {
    const status = (await ok(owner.get(`/api/menus/${m.id}/publish`), 'publish status'))
    for (const h of status.history) history.push({ ...h, menu: m.name, menu_id: m.id })
  }
  for (const state of ['live', 'past', 'scheduled', 'cancelled']) assert.ok(history.some(h => h.state === state), state)

  const list = listRows(await go({ subject: 'menu.releases', kind: 'list',
    rows: ['menu.name', 'state', 'published_by', 'note', 'scheduled', 'cancelled_by'] }))
  assert.deepEqual(sorted(list.map(r => r._id)), sorted(history.map(h => h.id)))
  const want = byId(history)
  for (const r of list) {
    const h = want.get(r._id)
    assert.equal(r['menu.name'], h.menu)
    assert.equal(r.state, h.state === 'past' ? 'earlier' : h.state, h.note)
    assert.equal(words(r.published_by), words(h.published_by))
    assert.equal(words(r.note), words(h.note))
    assert.equal(r.scheduled, Date.parse(h.goes_live_at) - Date.parse(h.created_at) > 60_000, 'scheduled: ' + h.note)
    assert.equal(words(r.cancelled_by), words(h.cancelled_by))
  }
  const theirs = await sql`SELECT id FROM menu_releases WHERE tenant_id = ${ids.b}`
  assert.ok(theirs.length > 0)
  for (const { id } of theirs) assert.ok(!want.has(id) && !list.some(r => r._id === id), 'the other group\'s publish')

  const f = await figures('menu.releases', ['publishes', 'cancelled', 'scheduled_now', 'menus_published'])
  assert.equal(f.publishes, count(history, h => !h.cancelled_at))
  assert.equal(f.cancelled, count(history, h => !!h.cancelled_at))
  assert.equal(f.scheduled_now, count(history, h => h.state === 'scheduled'))
  assert.equal(f.menus_published, distinct(history.map(h => h.menu_id)))
})

test('option groups and their options: Menus → Variant groups', async () => {
  const size = (await ok(owner.get('/api/menus/variant-groups'))).find(g => g.name === 'Zqx Size')
  await ok(owner.post('/api/menus/variant-groups', {
    name: 'Zqx Sauce', display_name: 'Pick a sauce', price_mode: 'extra', min_select: 1, max_select: 2,
    allow_repeat: true, pos_prefixes: true, kiosk_display: 'list',
    options: [
      { label: 'Zqx Hot', price_pence: 50, description: 'Zqx very hot', level: 4, image_url: '/uploads/zqx-hot.png', photo_url: '/uploads/zqx-hot-dish.png' },
      { label: 'Zqx Mild', price_pence: 0, child_group_id: size.id },
    ],
  }), 'sauce group')
  await ok(owner.post('/api/menus/variant-groups', {
    name: 'Zqx Extras', min_select: 0, max_select: 3, on_request: true,
    options: [{ label: 'Zqx Egg', price_pence: 125 }],
  }), 'extras group')

  const groups = (await ok(owner.get('/api/menus/variant-groups'), 'groups'))
  const gList = listRows(await go({ subject: 'menu.option_groups', kind: 'list',
    rows: ['name', 'display_name', 'price_mode', 'min_picks', 'max_picks', 'required', 'repeats', 'on_request', 'till_prefixes', 'kiosk_display', 'variation_type'] }))
  assert.deepEqual(sorted(gList.map(r => r._id)), sorted(groups.map(g => g.id)))
  const gWant = byId(groups)
  for (const r of gList) {
    const g = gWant.get(r._id)
    assert.equal(r.name, g.name)
    assert.equal(words(r.display_name), words(g.display_name?.trim()), g.name)
    assert.equal(r.price_mode, g.price_mode)
    assert.equal(r.min_picks, g.min_select)
    assert.equal(r.max_picks, g.max_select)
    assert.equal(r.required, g.min_select > 0)
    assert.equal(r.repeats, !!g.allow_repeat)
    assert.equal(r.on_request, !!g.on_request)
    assert.equal(r.till_prefixes, !!g.pos_prefixes)
    assert.equal(words(r.kiosk_display), words(g.kiosk_display))
    assert.equal(words(r.variation_type), words(g.variation_type))
  }
  assert.ok(gList.some(r => r.display_name === 'Pick a sauce') && gList.some(r => !r.required))
  const gf = await figures('menu.option_groups', ['groups', 'required_groups'])
  assert.equal(gf.groups, groups.length)
  assert.equal(gf.required_groups, count(groups, g => g.min_select > 0))

  const options = groups.flatMap(g => g.options.map(o => ({ ...o, group: g.name })))
  const oList = listRows(await go({ subject: 'menu.options', kind: 'list',
    rows: ['name', 'group.name', 'price', 'description', 'level', 'has_tile_picture', 'has_dish_picture', 'then_asks'] }))
  assert.deepEqual(sorted(oList.map(r => r._id)), sorted(options.map(o => o.id)))
  const oWant = byId(options)
  for (const r of oList) {
    const o = oWant.get(r._id)
    assert.equal(r.name, o.label)
    assert.equal(r['group.name'], o.group)
    assert.equal(p(r.price), o.price_pence, o.label)
    assert.equal(words(r.description), words(o.description))
    assert.equal(r.level ?? null, o.level ?? null)
    assert.equal(r.has_tile_picture, !!o.image_url)
    assert.equal(r.has_dish_picture, !!o.photo_url)
    assert.equal(r.then_asks, !!o.child_group_id)
  }
  assert.ok(oList.some(r => r.then_asks) && oList.some(r => r.has_dish_picture))
  const of = await figures('menu.options', ['options', 'average_price'])
  assert.equal(of.options, options.length)
  near(Number(of.average_price) * 100, options.reduce((s, o) => s + o.price_pence, 0) / options.length, 'average price', 0.001)
})

test('tags and the tags on each dish: Allergens & dietary and the allergen matrix', async () => {
  const tags0 = (await ok(owner.get('/api/menus/dietary/all'), 'tags'))
  const allergens = tags0.filter(t => t.kind === 'allergen')
  const spicy = tags0.find(t => t.label === 'Zqx Spicy')
  const draft = (await ok(owner.get(`/api/menus/${filled.ids.menu}`), 'menu'))
  const curry = draft.sections.flatMap(s => s.items).find(i => i.name === 'Zqx Green Curry')
  await ok(owner.put(`/api/menus/${filled.ids.menu}/allergens`, { items: [{ item_id: curry.id, levels: {
    [allergens[0].id]: 'removable', [allergens[1].id]: 'contains', [spicy.id]: 'contains',
  } }] }), 'matrix save')

  const tags = (await ok(owner.get('/api/menus/dietary/all'), 'tags'))
  const tList = listRows(await go({ subject: 'menu.tags', kind: 'list', rows: ['name', 'code', 'kind', 'standard', 'on_menus', 'in_key'] }))
  assert.deepEqual(sorted(tList.map(r => r._id)), sorted(tags.map(t => t.id)))
  const tWant = byId(tags)
  for (const r of tList) {
    const t = tWant.get(r._id)
    assert.equal(r.name, t.label)
    assert.equal(r.code, t.code)
    assert.equal(r.kind, t.kind)
    assert.equal(words(r.standard), words(t.standard_key))
    assert.equal(r.on_menus, !!t.show_on_menu)
    assert.equal(r.in_key, !!t.in_key)
  }
  const tf = await figures('menu.tags', ['tags', 'allergens', 'dietary_tags'])
  assert.equal(tf.tags, tags.length)
  assert.equal(tf.allergens, count(tags, t => t.kind === 'allergen'))
  assert.equal(tf.dietary_tags, count(tags, t => t.kind === 'dietary'))

  const menus = (await ok(owner.get('/api/menus'), 'menus'))
  const onDishes = []
  for (const m of menus) {
    const matrix = (await ok(owner.get(`/api/menus/${m.id}/allergens`), 'allergen matrix'))
    for (const s of matrix.sections) for (const it of s.items) {
      for (const [tagId, level] of Object.entries(it.levels)) {
        onDishes.push({ id: `${it.id}:${tagId}`, item: it.id, dish: it.name, tag: tWant.get(tagId).label, level })
      }
    }
  }
  for (const level of ['contains', 'may_contain', 'removable']) assert.ok(onDishes.some(d => d.level === level), level)
  const dList = listRows(await go({ subject: 'menu.dish_tags', kind: 'list', rows: ['dish.name', 'tag.name', 'level'] }))
  assert.deepEqual(sorted(dList.map(r => r._id)), sorted(onDishes.map(d => d.id)))
  const dWant = byId(onDishes)
  for (const r of dList) {
    const d = dWant.get(r._id)
    assert.equal(r['dish.name'], d.dish)
    assert.equal(r['tag.name'], d.tag)
    assert.equal(r.level, d.level)
  }
  const df = await figures('menu.dish_tags', ['dish_tags', 'contains', 'may_contain', 'removable', 'dishes'])
  assert.equal(df.dish_tags, onDishes.length)
  for (const level of ['contains', 'may_contain', 'removable']) assert.equal(df[level], count(onDishes, d => d.level === level), level)
  assert.equal(df.dishes, distinct(onDishes.map(d => d.item)))
})

test('a dish\'s option groups, its own prices for their options and its own options: the menu editor', async () => {
  const dips = (await ok(owner.post('/api/menus/variant-groups', {
    name: 'Zqx Dips', price_mode: 'extra', min_select: 0, max_select: 2,
    options: [{ label: 'Zqx Peanut', price_pence: 60 }, { label: 'Zqx Sweet chilli', price_pence: 40 }],
  }), 'dips group'))
  const size = (await ok(owner.get('/api/menus/variant-groups'))).find(g => g.name === 'Zqx Size')
  const body = menuSaveBody((await ok(owner.get(`/api/menus/${filled.ids.menu}`), 'menu')))
  const curry = body.sections.flatMap(s => s.items).find(i => i.name === 'Zqx Green Curry')
  const peanut = dips.options.find(o => o.label === 'Zqx Peanut')
  curry.variant_groups = [
    { group_id: dips.id, overrides: [{ option_id: peanut.id, price_pence: 90 }] },
    { group_id: size.id, overrides: [] },
  ]
  await ok(owner.patch(`/api/menus/${filled.ids.menu}`, body), 'menu save')

  const attached = []
  const prices = []
  const own = []
  for (const m of (await ok(owner.get('/api/menus'), 'menus'))) {
    const full = (await ok(owner.get(`/api/menus/${m.id}`), 'menu'))
    for (const s of full.sections || []) for (const it of s.items || []) {
      for (const g of it.variant_groups || []) {
        attached.push({ id: `${it.id}:${g.group_id}`, item: it.id, group_id: g.group_id, dish: it.name, group: g.name, place: g.sort_order + 1 })
        for (const o of g.options || []) {
          if (o.overridden) prices.push({ id: `${it.id}:${o.option_id}`, item: it.id, dish: it.name, group: g.name, option: o.label, price: o.price_pence, usual: o.default_pence })
        }
      }
      for (const v of it.variants || []) own.push({ id: v.id, item: it.id, dish: it.name, name: v.label, price: v.price_pence })
    }
  }
  assert.ok(attached.some(a => a.place === 2) && prices.length >= 2 && own.length >= 1, 'something on each list')

  const gList = listRows(await go({ subject: 'menu.dish_option_groups', kind: 'list', rows: ['dish.name', 'group.name', 'place'] }))
  assert.deepEqual(sorted(gList.map(r => r._id)), sorted(attached.map(a => a.id)))
  const gWant = byId(attached)
  for (const r of gList) {
    const a = gWant.get(r._id)
    assert.equal(r['dish.name'], a.dish)
    assert.equal(r['group.name'], a.group)
    assert.equal(r.place, a.place, a.id)
  }
  const gf = await figures('menu.dish_option_groups', ['dish_groups', 'dishes', 'groups'])
  assert.equal(gf.dish_groups, attached.length)
  assert.equal(gf.dishes, distinct(attached.map(a => a.item)))
  assert.equal(gf.groups, distinct(attached.map(a => a.group_id)))

  const pList = listRows(await go({ subject: 'menu.dish_option_prices', kind: 'list',
    rows: ['dish.name', 'option.name', 'option.group.name', 'price', 'usual_price', 'difference'] }))
  assert.deepEqual(sorted(pList.map(r => r._id)), sorted(prices.map(x => x.id)))
  const pWant = byId(prices)
  for (const r of pList) {
    const x = pWant.get(r._id)
    assert.equal(r['dish.name'], x.dish)
    assert.equal(r['option.name'], x.option)
    assert.equal(r['option.group.name'], x.group)
    assert.equal(p(r.price), x.price)
    assert.equal(p(r.usual_price), x.usual)
    assert.equal(p(r.difference), x.price - x.usual)
  }
  const pf = await figures('menu.dish_option_prices', ['prices', 'dishes'])
  assert.equal(pf.prices, prices.length)
  assert.equal(pf.dishes, distinct(prices.map(x => x.item)))

  const oList = listRows(await go({ subject: 'menu.dish_own_options', kind: 'list', rows: ['dish.name', 'name', 'price'] }))
  assert.deepEqual(sorted(oList.map(r => r._id)), sorted(own.map(o => o.id)))
  const oWant = byId(own)
  for (const r of oList) {
    const o = oWant.get(r._id)
    assert.equal(r['dish.name'], o.dish)
    assert.equal(r.name, o.name)
    assert.equal(p(r.price), o.price)
  }
  const of = await figures('menu.dish_own_options', ['options', 'dishes'])
  assert.equal(of.options, own.length)
  assert.equal(of.dishes, distinct(own.map(o => o.item)))
})

test('tax rates: Menus → Tax rates, switched off ones too', async () => {
  const old = (await ok(owner.post('/api/tax-rates', { name: 'Zqx Old reduced', rate: 12.5 }), 'rate'))
  await owner.delete(`/api/tax-rates/${old.id}`)
  const { rates } = (await ok(owner.get('/api/tax-rates'), 'tax rates'))
  assert.ok(rates.some(r => !r.is_active) && rates.some(r => r.is_default))
  const list = listRows(await go({ subject: 'menu.tax_rates', kind: 'list', rows: ['name', 'rate', 'usual', 'active'] }))
  assert.deepEqual(sorted(list.map(r => r._id)), sorted(rates.map(r => r.id)))
  const want = byId(rates)
  for (const r of list) {
    const x = want.get(r._id)
    assert.equal(r.name, x.name)
    near(r.rate, x.rate / 100, x.name)
    assert.equal(r.usual, !!x.is_default)
    assert.equal(r.active, !!x.is_active)
  }
  const f = await figures('menu.tax_rates', ['rates'])
  assert.equal(f.rates, count(rates, r => r.is_active))
})

test('menu screens, boards, playlists and walls: the Menu screens pages', async () => {
  const board = (await ok(owner.get('/api/screens/designs'), 'boards')).find(d => d.name === 'Zqx Board')
  const playlist = (await ok(owner.get('/api/screens/playlists'), 'playlists')).find(x => x.name === 'Zqx Day')
  const wall = (await ok(owner.get('/api/screens/walls'), 'walls')).find(w => w.name === 'Zqx Wall')
  await sql`UPDATE screen_designs
               SET layout = jsonb_set(COALESCE(layout, '{}'::jsonb), '{blocks}', '[{"id":"a","type":"heading"},{"id":"b","type":"text"}]'::jsonb)
             WHERE id = ${board.id}`
  await sql`UPDATE screen_walls SET design_id = ${board.id} WHERE id = ${wall.id}`
  const add = (tenantId, venueId, name, code, { design = null, list = null, seen = null, rotation = 0, inWall = null, col = null, row = null } = {}) => sql`
    INSERT INTO screens (tenant_id, venue_id, name, short_code, design_id, playlist_id, last_seen_at, paired_at, app_version, rotation, wall_id, wall_col, wall_row)
    VALUES (${tenantId}, ${venueId}, ${name}, ${code}, ${design}, ${list}, ${seen}, ${seen}, ${seen ? '2.4' : null}, ${rotation}, ${inWall}, ${col}, ${row})`
  const now = Date.now()
  await add(ids.a, V, 'Zqx Front', 'S91', { design: board.id, seen: new Date(now) })
  await add(ids.a, V, 'Zqx Back', 'S92', { list: playlist.id, seen: new Date(now - 3600_000), rotation: 90 })
  await add(ids.a, V, 'Zqx Wall left', 'S93', { list: playlist.id, seen: new Date(now), inWall: wall.id, col: 1, row: 0 })
  await add(ids.a, V2, 'Zqx Spare', 'S94')
  await add(ids.b, VB, 'Yyc Front', 'S91', { seen: new Date(now) })

  const { screens } = (await ok(owner.get('/api/screens/screens'), 'screens'))
  const list = listRows(await go({ subject: 'screens.screens', kind: 'list',
    rows: ['name', 'code', 'venue.name', 'shows_kind', 'shows', 'in_wall', 'wall_place', 'online', 'mounted', 'fit', 'width', 'height', 'app_version'] }))
  assert.deepEqual(sorted(list.map(r => r._id)), sorted(screens.map(s => s.id)))
  const want = byId(screens)
  for (const r of list) {
    const s = want.get(r._id)
    assert.equal(r.name, s.name)
    assert.equal(r.code, s.short_code)
    assert.equal(r['venue.name'], s.venue_name)
    assert.equal(r.shows_kind ?? null, s.shows?.kind ?? null, s.name)
    assert.equal(r.shows ?? null, s.shows?.name ?? null, s.name)
    assert.equal(r.in_wall, !!s.wall)
    assert.equal(words(r.wall_place), s.wall ? `Column ${s.wall.col + 1}, row ${s.wall.row + 1}` : null)
    assert.equal(r.online, s.online, s.name)
    assert.equal(r.mounted, String(s.rotation))
    assert.equal(r.fit, s.fit)
    assert.equal(r.width, s.width)
    assert.equal(r.height, s.height)
    assert.equal(words(r.app_version), words(s.app_version))
  }
  const wallLeft = list.find(r => r.name === 'Zqx Wall left')
  assert.deepEqual([wallLeft.shows_kind, wallLeft.shows, wallLeft.wall_place], ['board', 'Zqx Board', 'Column 2, row 1'], 'a screen in a wall shows the wall\'s board')
  const tally = async (filters, rows) => {
    const f = await figures('screens.screens', ['screens', 'online_now', 'in_walls', 'showing_nothing'], filters)
    assert.deepEqual([f.screens, f.online_now, f.in_walls, f.showing_nothing],
      [rows.length, count(rows, s => s.online), count(rows, s => !!s.wall), count(rows, s => !s.shows)])
  }
  await tally([], screens)
  await tally([here()], screens.filter(s => s.venue_id === V))

  const boards = (await ok(owner.get('/api/screens/designs'), 'boards'))
  const bList = listRows(await go({ subject: 'screens.boards', kind: 'list', rows: ['name', 'width', 'height', 'blocks', 'changed_by'] }))
  assert.deepEqual(sorted(bList.map(r => r._id)), sorted(boards.map(d => d.id)))
  const bWant = byId(boards)
  for (const r of bList) {
    const d = bWant.get(r._id)
    assert.deepEqual([r.name, r.width, r.height, r.blocks], [d.name, d.width, d.height, d.block_count])
    assert.equal(words(r.changed_by), words(d.updated_by))
  }
  assert.equal(bList.find(r => r._id === board.id).blocks, 2)

  const playlists = (await ok(owner.get('/api/screens/playlists'), 'playlists'))
  const pList = listRows(await go({ subject: 'screens.playlists', kind: 'list', rows: ['name', 'boards', 'seconds'] }))
  assert.deepEqual(sorted(pList.map(r => r._id)), sorted(playlists.map(x => x.id)))
  const pWant = byId(playlists)
  for (const r of pList) {
    const x = pWant.get(r._id)
    assert.deepEqual([r.name, r.boards, r.seconds], [x.name, x.items.length, x.items.reduce((s, i) => s + i.duration_secs, 0)])
  }

  const walls = (await ok(owner.get('/api/screens/walls'), 'walls'))
  const wList = listRows(await go({ subject: 'screens.walls', kind: 'list',
    rows: ['name', 'venue.name', 'columns', 'rows', 'places', 'gap', 'shows_kind', 'shows'] }))
  assert.deepEqual(sorted(wList.map(r => r._id)), sorted(walls.map(w => w.id)))
  const wWant = byId(walls)
  for (const r of wList) {
    const w = wWant.get(r._id)
    assert.deepEqual([r.name, r['venue.name'], r.columns, r.rows, r.places, r.gap],
      [w.name, w.venue_name, w.cols, w.rows, w.cols * w.rows, w.gap])
    assert.equal(r.shows_kind ?? null, w.shows?.kind ?? null)
    assert.equal(r.shows ?? null, w.shows?.name ?? null)
  }
  const counts = await Promise.all([
    figures('screens.boards', ['boards']), figures('screens.playlists', ['playlists']), figures('screens.walls', ['walls']),
  ])
  assert.deepEqual(counts.map(c => Object.values(c)[0]), [boards.length, playlists.length, walls.length])
})

test('reviews: the Reviews page\'s list and its figures', async () => {
  const add = (tenantId, venueId, site, source, who, rating, text, { written = null, reply = null, approved = false, featured = false, checked = false } = {}) => sql`
    INSERT INTO reviews (tenant_id, venue_id, platform, source, reviewer_name, rating, review_text, review_date, reply_text,
                         is_approved, is_featured, checked_at, checked_by)
    VALUES (${tenantId}, ${venueId}, ${site}, ${source}, ${who}, ${rating}, ${text}, ${written}, ${reply},
            ${approved}, ${featured}, ${checked ? new Date() : null}, ${checked ? 'owner@example.com' : null})`
  const day = 86400_000
  await add(ids.a, V, 'google', 'scraped', 'Zqx Ann', 5, 'Zqx superb', { written: new Date(Date.now() - 3 * day), reply: 'Zqx thank you Ann', approved: true, featured: true, checked: true })
  await add(ids.a, V, 'tripadvisor', 'scraped', 'Zqx Ben', 1, 'Zqx cold food', { written: new Date(Date.now() - day) })
  await add(ids.a, null, 'justeat', 'csv', 'Zqx Cat', 3, 'Zqx fine', { reply: '  ', checked: true })
  await add(ids.b, VB, 'google', 'manual', 'Yyc Dan', 2, 'Yyc meh', { checked: true })

  const reviews = (await ok(owner.get('/api/reviews?limit=500'), 'reviews'))
  const replied = x => !!(x.reply_text && x.reply_text.trim())
  const list = listRows(await go({ subject: 'website.reviews', kind: 'list',
    rows: ['site', 'came_from', 'reviewer', 'rating', 'review', 'reply', 'replied', 'on_website', 'featured', 'checked', 'checked_by', 'venue.name'] }))
  assert.deepEqual(sorted(list.map(r => r._id)), sorted(reviews.map(x => x.id)))
  const want = byId(reviews)
  for (const r of list) {
    const x = want.get(r._id)
    assert.deepEqual([r.site, r.came_from, r.reviewer, r.rating], [x.platform, x.source, x.reviewer_name, x.rating])
    assert.equal(words(r.review), words(x.review_text))
    assert.equal(words(r.reply), words(x.reply_text))
    assert.equal(r.replied, replied(x), x.reviewer_name)
    assert.deepEqual([r.on_website, r.featured, r.checked], [!!x.is_approved, !!x.is_featured, !!x.checked_at])
    assert.equal(words(r.checked_by), words(x.checked_by))
    assert.equal(r['venue.name'] ?? null, x.venue_name ?? null)
  }

  const tally = async (filters, rows, stats) => {
    const f = await figures('website.reviews',
      ['reviews', 'average_rating', 'five_stars', 'low_ratings', 'shown_on_website', 'featured_reviews', 'to_check', 'replied_to', 'reply_rate'], filters)
    assert.equal(f.reviews, Number(stats.total))
    assert.equal(Math.round(f.average_rating * 10) / 10, Number(stats.avg_rating))
    assert.equal(f.five_stars, count(rows, x => x.rating === 5))
    assert.equal(f.low_ratings, count(rows, x => x.rating <= 2))
    assert.equal(f.shown_on_website, Number(stats.approved))
    assert.equal(f.featured_reviews, Number(stats.featured))
    assert.equal(f.to_check, Number(stats.to_check))
    assert.equal(f.replied_to, count(rows, replied))
    near(f.reply_rate, count(rows, replied) / rows.length, 'reply rate')
  }
  await tally([], reviews, (await ok(owner.get('/api/reviews/stats'), 'stats')))
  await tally([here()], reviews.filter(x => x.venue_id === V), (await ok(owner.get(`/api/reviews/stats?venue_id=${V}`), 'stats here')))

  const stats = (await ok(owner.get('/api/reviews/stats'), 'stats'))
  const bySite = Object.fromEntries(rowsOf(await go({ subject: 'website.reviews', rows: ['site'], values: measures(['reviews']) })).map(r => [r.site, r.reviews]))
  for (const site of ['google', 'tripadvisor', 'justeat', 'deliveroo', 'manual']) assert.equal(bySite[site] ?? 0, Number(stats[site]), site)
})

test('website pages and modals: Website → Pages & modals', async () => {
  await ok(owner.post(`/api/website/pages?venue_id=${V}`, { slug: 'zqx-allergens', title: 'Zqx Allergens', kind: 'modal', blocks: [] }), 'modal')
  const events = (await ok(owner.post(`/api/website/pages?venue_id=${V}`, {
    slug: 'zqx-events', title: 'Zqx Events', is_published: false,
    blocks: [{ id: 'b1', type: 'heading', data: { text: 'Zqx' } }, { id: 'b2', type: 'text', data: {} }],
  }), 'events page'))
  await ok(owner.patch(`/api/website/pages/${events.id}`, { is_legal: true, show_header: false }), 'legal page')

  const pages = []
  for (const where of ['tenant', ...venues.map(v => v.id)]) pages.push(...(await ok(owner.get(`/api/website/pages?venue_id=${where}`), 'pages')))
  const slugOf = id => venues.find(v => v.id === id)?.slug
  const addressOf = pg => (pg.kind === 'modal' ? '#modal/' + pg.slug
    : pg.system_key ? SYSTEM_PAGES[pg.system_key].path
    : pg.venue_id ? `/locations/${slugOf(pg.venue_id)}/p/${pg.slug}` : pagePath(pg))
  const blocksOf = pg => (Array.isArray(pg.blocks) ? pg.blocks.length : 0)
  assert.ok(pages.some(pg => pg.system_key) && pages.some(pg => pg.venue_id) && pages.some(pg => !pg.venue_id))

  const list = listRows(await go({ subject: 'website.pages', kind: 'list',
    rows: ['title', 'slug', 'address', 'kind', 'built_in', 'published', 'legal', 'shows_header', 'shows_footer', 'blocks', 'venue.name'] }))
  assert.deepEqual(sorted(list.map(r => r._id)), sorted(pages.map(pg => pg.id)))
  const want = byId(pages)
  for (const r of list) {
    const pg = want.get(r._id)
    assert.deepEqual([r.title, r.slug, r.address, r.kind], [pg.title, pg.slug, addressOf(pg), pg.kind], pg.title)
    assert.equal(words(r.built_in), words(pg.system_key))
    assert.deepEqual([r.published, r.legal, r.shows_header, r.shows_footer], [!!pg.is_published, !!pg.is_legal, !!pg.show_header, !!pg.show_footer], pg.title)
    assert.equal(r.blocks, blocksOf(pg))
    assert.equal(r['venue.name'] ?? null, venueName(pg.venue_id))
  }
  const ev = list.find(r => r._id === events.id)
  assert.deepEqual([ev.address, ev.published, ev.legal, ev.shows_header, ev.blocks],
    [`/locations/${slugOf(V)}/p/zqx-events`, false, true, false, 2])

  const tally = async (filters, rows) => {
    const f = await figures('website.pages', ['pages', 'standalone', 'modals', 'published_pages'], filters)
    assert.deepEqual([f.pages, f.standalone, f.modals, f.published_pages],
      [rows.length, count(rows, pg => pg.kind === 'page'), count(rows, pg => pg.kind === 'modal'), count(rows, pg => pg.is_published)])
  }
  await tally([], pages)
  await tally([here()], pages.filter(pg => pg.venue_id === V))
})

test('media files and their categories: the Media page', async () => {
  const food = (await ok(owner.get('/api/media/categories'), 'categories')).find(c => c.name === 'Zqx Food')
  const add = (tenantId, file, type, bytes, { category = null, width = null, height = null, scope = 'shared' } = {}) => sql`
    INSERT INTO media_items (tenant_id, category_id, scope, filename, url, storage_key, mimetype, bytes, width, height)
    VALUES (${tenantId}, ${category}, ${scope}, ${file}, ${'/uploads/' + file}, ${'media/' + file}, ${type}, ${bytes}, ${width}, ${height})`
  await add(ids.a, 'zqx-dish.jpg', 'image/jpeg', 2_097_152, { category: food.id, width: 1200, height: 800 })
  await add(ids.a, 'zqx-loop.mp4', 'video/mp4', 15_728_640, { scope: 'screens' })
  await add(ids.a, 'zqx-menu.pdf', 'application/pdf', 524_288)
  await add(ids.a, 'zqx-notes.txt', 'text/plain', 1_000, { category: food.id })
  await add(ids.b, 'yyc-dish.jpg', 'image/jpeg', 99_999)

  const files = (await ok(owner.get('/api/media/items?limit=500'), 'media'))
  const kindOf = t => (t.startsWith('image/') ? 'picture' : t.startsWith('video/') ? 'video' : t === 'application/pdf' ? 'pdf' : 'other')
  const mb = f => Number(f.bytes) / 1048576
  const list = listRows(await go({ subject: 'website.media', kind: 'list',
    rows: ['filename', 'kind', 'file_type', 'scope', 'size_mb', 'width', 'height', 'category.name'] }))
  assert.deepEqual(sorted(list.map(r => r._id)), sorted(files.map(f => f.id)))
  const want = byId(files)
  for (const r of list) {
    const f = want.get(r._id)
    assert.deepEqual([r.filename, r.kind, r.file_type, r.scope], [f.filename, kindOf(f.mimetype), f.mimetype, f.scope])
    near(r.size_mb, mb(f), f.filename)
    assert.equal(r.width ?? null, f.width ?? null)
    assert.equal(r.height ?? null, f.height ?? null)
    assert.equal(r['category.name'] ?? null, f.category_name ?? null)
  }
  for (const kind of ['picture', 'video', 'pdf', 'other']) assert.ok(list.some(r => r.kind === kind), kind)
  const f = await figures('website.media', ['files', 'total_mb', 'pictures', 'videos'])
  assert.equal(f.files, files.length)
  near(f.total_mb, files.reduce((s, x) => s + mb(x), 0), 'total size')
  assert.equal(f.pictures, count(files, x => kindOf(x.mimetype) === 'picture'))
  assert.equal(f.videos, count(files, x => kindOf(x.mimetype) === 'video'))

  const categories = (await ok(owner.get('/api/media/categories'), 'categories'))
  const cList = listRows(await go({ subject: 'website.media_categories', kind: 'list', rows: ['name'] }))
  assert.deepEqual(sorted(cList.map(r => r._id)), sorted(categories.map(c => c.id)))
  assert.equal((await figures('website.media_categories', ['categories'])).categories, categories.length)
  const byCategory = rowsOf(await go({ subject: 'website.media', rows: ['category.name'], values: measures(['files']) }))
  for (const c of categories.filter(x => Number(x.item_count) > 0)) {
    assert.equal(byCategory.find(r => r['category.name'] === c.name)?.files, Number(c.item_count), c.name)
  }
  assert.equal(byCategory.find(r => r['category.name'] == null)?.files, count(files, x => !x.category_id), 'files in no category')
})

test('local info entries: the Local info page, without forecasts, hidden findings or findings put into another entry', async () => {
  const [weather] = await sql`SELECT id FROM local_info_sources WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND kind = 'weather'`
  const [found] = await sql`SELECT id FROM local_info_sources WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND kind = 'events'`
  await sql`
    INSERT INTO local_info_items (tenant_id, venue_id, source_id, kind, title, starts_on, severity, data, external_key)
    VALUES (${ids.a}, ${V}, ${weather.id}, 'weather', 'Zqx rain', '2027-01-18', 'notice', ${sql.json({ weather_code: 61, rain_mm: 4 })}, 'weather:2027-01-18')`
  const [lane] = await sql`
    INSERT INTO local_info_items (tenant_id, venue_id, source_id, kind, title, starts_on, severity, external_key)
    VALUES (${ids.a}, ${V}, ${found.id}, 'traffic', 'Zqx lane closed', '2027-01-19', 'warning', 'zqx-lane') RETURNING id`
  await ok(owner.patch(`/api/local-info/items/${lane.id}`, { hidden: true }), 'hide')
  await sql`
    INSERT INTO local_info_items (tenant_id, venue_id, source_id, kind, title, details, place, url, time_text, starts_on, ends_on, severity, external_key)
    VALUES (${ids.a}, ${V}, ${found.id}, 'incidents', 'Zqx burst main', 'Zqx water off', 'Zqx Baldock St', 'https://news.example/zqx',
            '08:00', '2027-01-23', '2027-01-25', 'warning', 'zqx-main')`
  await ok(owner.post('/api/local-info/items', {
    kind: 'traffic', title: 'Zqx road works', details: 'Zqx A10 closed', place: 'Zqx A10',
    starts_on: '2027-01-20', ends_on: '2027-01-22', time_text: 'All day', severity: 'warning',
  }), 'road works')
  await ok(owner.post('/api/local-info/items', { venue_id: V2, title: 'Zqx Hertford fete', starts_on: '2027-01-21' }), 'fete')

  const { items } = (await ok(owner.get('/api/local-info/items?from=2026-06-01&to=2027-06-30'), 'local info'))
  const forecast = it => it.kind === 'weather' && typeof it.data?.weather_code === 'number'
  assert.ok(items.some(forecast), 'the page shows the forecast')
  assert.ok(!items.some(it => it.id === lane.id), 'the page hides the hidden finding')
  const entries = items.filter(it => !forecast(it))
  const apart = new Set((await sql`SELECT id FROM local_info_items WHERE tenant_id = ${ids.a} AND keep_separate`).map(r => r.id))
  assert.ok(apart.size > 0 && entries.some(e => e.also.length > 0) && entries.some(e => e.feedback?.relevant > 0))

  const list = listRows(await go({ subject: 'local.items', kind: 'list',
    rows: ['title', 'details', 'kind', 'severity', 'place', 'last_day', 'days', 'time', 'link', 'came_from',
      'flagged_relevant', 'flagged_not_relevant', 'other_reports', 'kept_apart', 'venue.name'] }))
  assert.deepEqual(sorted(list.map(r => r._id)), sorted(entries.map(e => e.id)))
  const want = byId(entries)
  for (const r of list) {
    const e = want.get(r._id)
    const last = e.ends_on ?? e.starts_on
    assert.deepEqual([r.title, r.kind, r.severity], [e.title, e.kind, e.severity])
    assert.deepEqual([words(r.details), words(r.place), words(r.time), words(r.link)], [words(e.details), words(e.place), words(e.time_text), words(e.url)], e.title)
    assert.deepEqual([r.last_day, r.days], [last, days(e.starts_on, last) + 1], e.title)
    assert.equal(r.came_from, e.source_id ? 'captured' : 'typed')
    assert.deepEqual([r.flagged_relevant, r.flagged_not_relevant], [e.feedback?.relevant ?? 0, e.feedback?.not_relevant ?? 0], e.title)
    assert.equal(r.other_reports, e.also.length, e.title)
    assert.equal(r.kept_apart, apart.has(e.id))
    assert.equal(r['venue.name'] ?? null, venueName(e.venue_id))
  }

  const tally = async (filters, rows) => {
    const f = await figures('local.items', ['items', 'warnings', 'events', 'traffic', 'incidents', 'typed', 'captured'], filters)
    assert.deepEqual([f.items, f.warnings, f.events, f.traffic, f.incidents, f.typed, f.captured], [
      rows.length, count(rows, e => e.severity === 'warning'), count(rows, e => e.kind === 'events'),
      count(rows, e => e.kind === 'traffic'), count(rows, e => e.kind === 'incidents'),
      count(rows, e => !e.source_id), count(rows, e => !!e.source_id)])
  }
  await tally([], entries)
  const atV = entries.filter(e => e.venue_id === V)
  assert.ok(atV.length < entries.length, 'the group-wide and other venue\'s entries are left out')
  await tally([here()], atV)
})

test('local info captures: each venue\'s Captures window', async () => {
  const { source: roads } = (await ok(owner.post(`/api/local-info/venues/${V}/sources`, {
    kind: 'traffic', frequency: 'hours', every_hours: 6, place: 'Zqx Ware', site: 'roads.example.com', query: 'Zqx roadworks',
  }), 'roads capture'))
  await ok(owner.post(`/api/local-info/venues/${V2}/sources`, { kind: 'incidents', frequency: 'weekly', place: 'Zqx Hertford', enabled: false }), 'weekly capture')
  await sql`UPDATE local_info_sources SET last_error = 'Zqx place not found' WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND kind = 'weather'`
  await sql`UPDATE local_info_sources SET merge_error = 'Zqx Claude is busy' WHERE id = ${roads.id}`

  const sources = []
  for (const v of venues) sources.push(...(await ok(owner.get(`/api/local-info/venues/${v.id}/sources`), 'captures')).sources)
  const list = listRows(await go({ subject: 'local.captures', kind: 'list',
    rows: ['kind', 'enabled', 'how_often', 'place', 'site', 'query', 'failing', 'problem', 'learns', 'merge_problem', 'venue.name'] }))
  assert.deepEqual(sorted(list.map(r => r._id)), sorted(sources.map(s => s.id)))
  const want = byId(sources)
  for (const r of list) {
    const s = want.get(r._id)
    assert.deepEqual([r.kind, r.enabled, r.how_often], [s.kind, !!s.enabled, frequencyText(s)], s.kind)
    assert.deepEqual([words(r.place), words(r.site), words(r.query)], [words(s.place), words(s.site), words(s.query)])
    assert.equal(r.failing, !!(s.last_error && s.last_error.trim()))
    assert.equal(words(r.problem), words(s.last_error))
    assert.equal(r.learns, !!s.learn_auto && s.kind !== 'weather', s.kind)
    assert.equal(words(r.merge_problem), words(s.merge_error))
    assert.equal(r['venue.name'], venueName(s.venue_id))
  }
  assert.equal(list.find(r => r._id === roads.id).how_often, 'Every 6 hours')

  const tally = async (filters, rows) => {
    const f = await figures('local.captures', ['captures', 'switched_on', 'failing_captures'], filters)
    assert.deepEqual([f.captures, f.switched_on, f.failing_captures],
      [rows.length, count(rows, s => s.enabled), count(rows, s => !!(s.last_error && s.last_error.trim()))])
  }
  await tally([], sources)
  await tally([here()], sources.filter(s => s.venue_id === V))
})

test('each area needs its own module, and the other group\'s rows never show', async () => {
  for (const [module, subject, figure] of [
    ['menus', 'menu.releases', 'publishes'], ['menus', 'menu.tags', 'tags'], ['menus', 'menu.tax_rates', 'rates'],
    ['screens', 'screens.screens', 'screens'], ['screens', 'screens.boards', 'boards'],
    ['website', 'website.reviews', 'reviews'], ['website', 'website.pages', 'pages'], ['website', 'website.media', 'files'],
    ['local_info', 'local.items', 'items'], ['local_info', 'local.captures', 'captures'],
  ]) {
    const r = await refused(go({ subject, values: measures([figure]) }, { ...ALL, [module]: 'none' }))
    assert.equal(r.status, 403, subject)
  }

  for (const [subject, field, table] of [
    ['menu.releases', 'note', 'menu_releases'], ['menu.option_groups', 'name', 'menu_variant_groups'],
    ['menu.options', 'name', 'menu_variant_options'], ['menu.tags', 'name', 'menu_dietary_tags'],
    ['menu.tax_rates', 'name', 'tax_rates'], ['screens.boards', 'name', 'screen_designs'],
    ['screens.playlists', 'name', 'screen_playlists'], ['screens.walls', 'name', 'screen_walls'],
    ['website.reviews', 'reviewer', 'reviews'], ['website.pages', 'title', 'website_pages'],
    ['website.media_categories', 'name', 'media_categories'], ['local.items', 'title', 'local_info_items'],
    ['local.captures', 'kind', 'local_info_sources'],
  ]) {
    const theirs = await sql`SELECT id FROM ${sql(table)} WHERE tenant_id = ${ids.b}`
    assert.ok(theirs.length > 0, subject + ': the other group has some')
    const mine = new Set(listRows(await go({ subject, kind: 'list', rows: [field] })).map(r => r._id))
    assert.ok(mine.size > 0, subject)
    for (const { id } of theirs) assert.ok(!mine.has(String(id)), subject + ': the other group\'s row')
  }
})

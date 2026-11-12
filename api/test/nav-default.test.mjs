// The default main menu (migrations 196 + 202 + 208 + 211 + 216 + 219 + 221 + 225 + 227 + 228 + 230 + 231 + 235 + 240 + 241): the migrations' tree is the
// same as DEFAULT_NAV_TREE, every page in the route catalogue is in it once,
// and a new tenant gets it through /api/me. Migration 241 gave the designers
// their own links and every entry a description: its SQL is run here on
// menus without the links, and the descriptions are saved, cut and refused.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { getApp, as, ok, sql, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { DEFAULT_NAV_TREE } from '../src/config/defaultNav.js'
import { ROUTE_CATALOG } from '../src/routes/nav.js'
import {
  NAV_KEYWORDS, NAV_DESCRIPTIONS, DESCRIPTION_MAX, EXTRA_SEARCH_ROUTES, searchWords, searchNavTree, navDescription,
} from '../../shared/navSearch.js'

after(closeApp)

const strip = nodes => nodes.map(n => ({
  label: n.label,
  ...(n.icon ? { icon: n.icon } : {}),
  ...(n.route ? { route: n.route } : {}),
  ...(n.module ? { module: n.module } : {}),
  ...(n.children?.length ? { children: strip(n.children) } : {}),
}))
const routes = nodes => nodes.flatMap(n => [...(n.route ? [n.route] : []), ...routes(n.children || [])])

// Migration 241: its link rows as written in the SQL, and its DO block.
const SQL_241 = fs.readFileSync(new URL('../../migrations/241_nav_descriptions_designers.sql', import.meta.url), 'utf8')
const LINKS_241 = [...SQL_241.matchAll(/\(\s*(\d+),\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'\s*\)/g)]
  .map(m => ({ ord: Number(m[1]), route: m[2], label: m[3], icon: m[4], module: m[5], anchor: m[6], fallback: m[7] }))
  .sort((a, b) => a.ord - b.ord)
const BLOCK_241 = SQL_241.match(/DO \$\$[\s\S]*?END \$\$;/)[0]
// The list (and so the parent) a route's link sits in.
const siblingsOf = (nodes, r) => {
  for (const n of nodes) {
    if (n.route === r) return nodes
    const hit = siblingsOf(n.children || [], r)
    if (hit) return hit
  }
  return null
}
// A tenant's menu as stored: [{ label, icon, route, module, children }] in order.
async function storedTree(tenantId) {
  const rows = await sql`SELECT id, parent_id, label, icon, route, module, hidden_role_ids, description FROM nav_items WHERE tenant_id = ${tenantId} ORDER BY sort_order, created_at`
  const kids = p => rows.filter(r => r.parent_id === p).map(r => ({ label: r.label, icon: r.icon, route: r.route, module: r.module, children: kids(r.id) }))
  return { tree: kids(null), rows }
}

// Migration 196's tree with 202's change applied: Till setup (and its Floor
// plan) and Menu screens out, the Store tech section in after Venues.
test('migrations 196 + 202 + 208 + 211 + 216 + 219 + 221 + 225 + 227 + 228 + 230 + 231 + 235 + 240 + 241 hold the same tree as DEFAULT_NAV_TREE', () => {
  const read = f => fs.readFileSync(new URL('../../migrations/' + f, import.meta.url), 'utf8').match(/\$nav\$([\s\S]*?)\$nav\$/)[1]
  const drop = nodes => nodes.filter(n => !['/pos', '/pos/floor', '/screens'].includes(n.route))
    .map(n => (n.children ? { ...n, children: drop(n.children) } : n))
  const tree = drop(JSON.parse(read('196_main_menu.sql')))
  const at = tree.findIndex(s => routes(s.children || []).includes('/venues'))
  tree.splice(at + 1, 0, { label: 'Store tech', children: JSON.parse(read('202_store_tech_menu.sql')) })
  // 208: Kiosk analytics after Till reports.
  const money = tree.find(s => routes(s.children || []).includes('/pos/reports'))
  money.children.splice(money.children.findIndex(n => n.route === '/pos/reports') + 1, 0,
    { label: 'Kiosk analytics', icon: 'Activity', route: '/pos/kiosk-analytics', module: 'pos_reports' })
  // 211: Loyalty after Customers.
  const service = tree.find(s => routes(s.children || []).includes('/customers'))
  service.children.splice(service.children.findIndex(n => n.route === '/customers') + 1, 0,
    { label: 'Loyalty', icon: 'Gift', route: '/loyalty', module: 'loyalty' })
  // 216: Device updates after Card machines.
  const tech = tree.find(s => s.label === 'Store tech')
  tech.children.splice(tech.children.findIndex(n => n.route === '/pos/cards') + 1, 0,
    { label: 'Device updates', icon: 'RefreshCw', route: '/pos/updates', module: 'pos_setup' })
  // 219: Venue hub just before Printers.
  tech.children.splice(tech.children.findIndex(n => n.route === '/pos/printers'), 0,
    { label: 'Venue hub', icon: 'Server', route: '/pos/hub', module: 'pos_setup' })
  // 225: Discounts after Order types.
  tech.children.splice(tech.children.findIndex(n => n.route === '/pos/types') + 1, 0,
    { label: 'Discounts', icon: 'BadgePercent', route: '/pos/discounts', module: 'pos_setup' })
  // 231: Charges after Discounts.
  tech.children.splice(tech.children.findIndex(n => n.route === '/pos/discounts') + 1, 0,
    { label: 'Charges', icon: 'HandCoins', route: '/pos/charges', module: 'pos_setup' })
  // 235: Order flows after Charges.
  tech.children.splice(tech.children.findIndex(n => n.route === '/pos/charges') + 1, 0,
    { label: 'Order flows', icon: 'Workflow', route: '/pos/flows', module: 'pos_setup' })
  // 228: Till layouts after Tills.
  tech.children.splice(tech.children.findIndex(n => n.route === '/pos/tills') + 1, 0,
    { label: 'Till layouts', icon: 'PanelsTopLeft', route: '/pos/layouts', module: 'pos_setup' })
  // 221: Today at the top of Home, before Overview.
  const home = tree.find(s => routes(s.children || []).includes('/'))
  home.children.splice(home.children.findIndex(n => n.route === '/'), 0,
    { label: 'Today', icon: 'Sun', route: '/today', module: 'dashboard' })
  // 227: Today for everyone, its module gone.
  delete home.children.find(n => n.route === '/today').module
  // 240: Local info after Today.
  home.children.splice(home.children.findIndex(n => n.route === '/today') + 1, 0,
    { label: 'Local info', icon: 'CloudSun', route: '/local-info', module: 'local_info' })
  // 230: Menu times first under the Menus link.
  const findRoute = (nodes, r) => {
    for (const n of nodes) {
      if (n.route === r) return n
      const hit = findRoute(n.children || [], r)
      if (hit) return hit
    }
    return null
  }
  const menusLink = findRoute(tree, '/menus')
  menusLink.children.unshift({ label: 'Menu times', icon: 'Clock', route: '/menus/times', module: 'menus' })
  // 241: the designers' own links, each straight after its anchor (read
  // from the migration, in its order: a later link may go after an earlier one).
  assert.equal(LINKS_241.length, 9, 'the nine links of migration 241')
  for (const l of LINKS_241) {
    const list = siblingsOf(tree, l.anchor) || siblingsOf(tree, l.fallback)
    const anchor = list.find(n => n.route === l.anchor) || list.find(n => n.route === l.fallback)
    list.splice(list.indexOf(anchor) + 1, 0, { label: l.label, icon: l.icon, route: l.route, module: l.module })
  }
  assert.deepEqual(strip(tree), strip(DEFAULT_NAV_TREE))
})

test('every catalogue page is in the default menu once, and nothing else', () => {
  const inTree = routes(DEFAULT_NAV_TREE)
  assert.equal(new Set(inTree).size, inTree.length, 'a page is in the menu twice')
  assert.deepEqual([...inTree].sort(), ROUTE_CATALOG.map(r => r.route).sort())
  for (const section of DEFAULT_NAV_TREE) assert.ok(!section.route && section.children.length, section.label + ' is a section with links')
  // A page is gated by the same module in the menu and in the catalogue (the
  // Navigation designer and Pepper's open_page read the catalogue's). Only
  // Today has none: it is for everyone signed in.
  const links = []
  const walk = list => { for (const n of list || []) { if (n.route) links.push(n); walk(n.children) } }
  walk(DEFAULT_NAV_TREE)
  for (const c of ROUTE_CATALOG) {
    assert.equal(c.module ?? null, links.find(n => n.route === c.route).module ?? null, c.route + ': the catalogue and the menu name the same module')
  }
  assert.deepEqual(ROUTE_CATALOG.filter(c => !c.module).map(c => c.route), ['/today'])
})

// The menu search (8 Nov 2026): every page can be found by words beyond its
// label, and a renamed or removed route can't leave stale keywords behind.
test('every catalogue page has menu-search keywords, and none point at a page that is gone', () => {
  const catalog = new Set(ROUTE_CATALOG.map(r => r.route))
  for (const r of catalog) {
    assert.ok(searchWords(NAV_KEYWORDS[r] || '').length, r + ' needs search keywords in shared/navSearch.js')
  }
  for (const key of Object.keys(NAV_KEYWORDS)) {
    assert.ok(catalog.has(key) || EXTRA_SEARCH_ROUTES.includes(key),
      key + ' is not a page — remove or rename its NAV_KEYWORDS entry')
  }
})

// Every entry has a description (migration 241): a page's standard one comes
// from shared/navSearch.js, at most 260 characters, and the link's label and
// icon in the catalogue are the ones migration 241 gave existing menus.
test('every catalogue page has a description of at most 260 characters', () => {
  const catalog = new Map(ROUTE_CATALOG.map(r => [r.route, r]))
  for (const r of catalog.keys()) {
    const d = NAV_DESCRIPTIONS[r] || ''
    assert.ok(d.length >= 20, r + ' needs a description in shared/navSearch.js')
    assert.ok(d.length <= DESCRIPTION_MAX, r + ': ' + d.length + ' characters')
  }
  for (const key of Object.keys(NAV_DESCRIPTIONS)) {
    assert.ok(catalog.has(key) || EXTRA_SEARCH_ROUTES.includes(key), key + ' is not a page')
  }
  for (const l of LINKS_241) {
    const c = catalog.get(l.route)
    assert.ok(c, l.route + ' is in the catalogue')
    assert.deepEqual({ label: c.label, icon: c.icon, module: c.module }, { label: l.label, icon: l.icon, module: l.module })
  }
})

// A page's address must load from a typed address or a reload. On the admin's
// hosts nginx hands some paths to the API before the app sees them (the
// guests' /reservations widget, /manage links, /api/, /ws...), and it matches
// them as plain prefixes: /reservations-widget was caught by /reservations and
// showed the API's 404. The dev server's proxy list is checked the same way.
test('no page address starts with a path the admin\'s hosts send to the API', () => {
  const nginx = fs.readFileSync(new URL('../../scripts/nginx-office-ops.sh', import.meta.url), 'utf8')
  const looped = (nginx.match(/for p in ([^;]+);\s*do/) || [])[1]
  assert.ok(looped, 'the list of guest paths is still a for loop in nginx-office-ops.sh')
  const prefixes = new Set(looped.trim().split(/\s+/))
  for (const m of nginx.matchAll(/^\s*location\s+(?:\^~\s+)?(\/[^\s{$]+)\s*\{/gm)) prefixes.add(m[1])
  const vite = fs.readFileSync(new URL('../../admin/vite.config.js', import.meta.url), 'utf8')
  const proxy = vite.slice(vite.indexOf('proxy:'))
  for (const m of proxy.matchAll(/'(\/[a-z-]+)'\s*:\s*'http/g)) prefixes.add(m[1])
  prefixes.delete('/')
  prefixes.delete('/.well-known/acme-challenge/')
  for (const p of ['/reservations', '/manage', '/widget-api', '/api/', '/ws']) assert.ok(prefixes.has(p), p + ' was read from the configs')
  for (const r of [...ROUTE_CATALOG.map(c => c.route), ...EXTRA_SEARCH_ROUTES]) {
    const hit = [...prefixes].find(p => r.startsWith(p))
    assert.ok(!hit, `${r} starts with ${hit}, which nginx sends to the API: a reload of that page would be a 404`)
  }
})

let ids
test('a new tenant gets the default menu', async () => {
  await getApp()
  ids = await resetAndSeed()
  const me = await ok(as(A.owner, ids.a).get('/api/me'))
  assert.deepEqual(me.nav_tree.map(n => n.label), DEFAULT_NAV_TREE.map(n => n.label))
  const brand = me.nav_tree.find(n => n.label === 'Brand & web').children[0]
  assert.equal(brand.route, '/brand')
  // The designers are links of their own, found by the menu search by name.
  const all = routes(me.nav_tree)
  for (const l of LINKS_241) assert.ok(all.includes(l.route), l.route + ' is in the owner\'s menu')
  assert.equal(searchNavTree(me.nav_tree, 'kiosk designer')[0].route, '/pos/kiosk-designs')
  assert.equal(searchNavTree(me.nav_tree, 'page builder')[0].route, '/website/builder')
  assert.deepEqual(searchNavTree(me.nav_tree, 'designer').slice(0, 5).map(r => r.label).sort(),
    ['Kiosk designer', 'Kitchen flow designer', 'Menu print designer', 'Receipt & ticket designer', 'Screen board designer'],
    'the pages called designer come first')
})

// Migration 241's SQL on real rows: on a menu without the links it puts each
// one straight after its anchor with the anchor's hidden roles, and a second
// run adds nothing. (The test database already had 241 applied, so the
// links are taken out first.)
test('migration 241 puts the designers\' links into existing menus, once', async () => {
  const news = LINKS_241.map(l => l.route)
  const before = await storedTree(ids.a)
  assert.deepEqual(strip(before.tree), strip(DEFAULT_NAV_TREE), 'the seeded menu is the default')

  // Tenant A: the menu as it was before 241, Kiosks hidden from one role.
  const [role] = await sql`SELECT id FROM tenant_roles WHERE tenant_id = ${ids.a} AND key = 'viewer'`
  await sql`DELETE FROM nav_items WHERE tenant_id = ${ids.a} AND route = ANY(${news})`
  await sql`UPDATE nav_items SET hidden_role_ids = ${[role.id]} WHERE tenant_id = ${ids.a} AND route = '/pos/kiosks'`
  // Tenant B: no Website link (the page builder and the widget have no
  // anchor), no Printing link, and it already has the kitchen flow designer
  // under another name, somewhere else.
  await sql`DELETE FROM nav_items WHERE tenant_id = ${ids.b} AND route = ANY(${news.filter(r => r !== '/pos/kitchen-flow')})`
  await sql`DELETE FROM nav_items WHERE tenant_id = ${ids.b} AND route IN ('/website', '/pos/printing')`
  await sql`UPDATE nav_items SET label = 'Our flows', sort_order = 999 WHERE tenant_id = ${ids.b} AND route = '/pos/kitchen-flow'`
  // The screen playlists' own anchor (the board designer) is put in by the
  // same run; with Menu times gone the menu print designer uses its fallback.
  await sql`DELETE FROM nav_items WHERE tenant_id = ${ids.b} AND route = '/menus/times'`

  await sql.unsafe(BLOCK_241)

  const a = await storedTree(ids.a)
  assert.deepEqual(strip(a.tree), strip(DEFAULT_NAV_TREE), 'tenant A is back on the default menu')
  const kiosk = a.rows.find(r => r.route === '/pos/kiosk-designs')
  assert.deepEqual(kiosk.hidden_role_ids, [role.id], 'hidden from the roles its anchor is hidden from')
  assert.deepEqual(a.rows.find(r => r.route === '/screens/boards').hidden_role_ids, [])
  assert.ok(a.rows.every(r => r.description === null), 'descriptions start empty: the standard words show')
  const ties = await sql`SELECT parent_id, sort_order FROM nav_items WHERE tenant_id = ${ids.a} GROUP BY 1, 2 HAVING count(*) > 1`
  assert.equal(ties.length, 0, 'no two links share a place')

  const b = await storedTree(ids.b)
  const bRoutes = routes(b.tree)
  assert.ok(!bRoutes.includes('/website/builder') && !bRoutes.includes('/website/reservations-widget'), 'no anchor, no link')
  assert.ok(!bRoutes.includes('/pos/print-designs'))
  assert.equal(bRoutes.filter(r => r === '/pos/kitchen-flow').length, 1, 'a page already in the menu is left alone')
  assert.equal(b.rows.find(r => r.route === '/pos/kitchen-flow').label, 'Our flows')
  const screens = siblingsOf(b.tree, '/screens').map(n => n.route)
  const at = screens.indexOf('/screens')
  assert.deepEqual(screens.slice(at, at + 4), ['/screens', '/screens/boards', '/screens/playlists', '/screens/walls'])
  const menuKids = b.tree.flatMap(s => s.children).find(n => n.route === '/menus')
  const menus = siblingsOf(b.tree, '/menus').map(n => n.route)
  assert.equal(menus[menus.indexOf('/menus') + 1], '/menus/print-designs', 'the fallback anchor: straight after Menus')
  assert.ok(!routes(menuKids.children).includes('/menus/print-designs'))

  // A second run changes nothing.
  const count = async t => (await sql`SELECT count(*)::int AS n FROM nav_items WHERE tenant_id = ${t}`)[0].n
  const [na, nb] = [await count(ids.a), await count(ids.b)]
  await sql.unsafe(BLOCK_241)
  assert.deepEqual([await count(ids.a), await count(ids.b)], [na, nb])
  assert.deepEqual(strip((await storedTree(ids.a)).tree), strip(DEFAULT_NAV_TREE))
})

test('a menu entry\'s own description is saved, shown and searched; over 260 characters is refused', async () => {
  ids = await resetAndSeed()
  const owner = as(A.owner, ids.a)

  // The route catalogue hands the Navigation designer each page's standard words.
  const catalog = await ok(owner.get('/api/nav/route-catalog'))
  assert.equal(catalog.find(r => r.route === '/rota').description, NAV_DESCRIPTIONS['/rota'])
  assert.ok(catalog.every(r => r.description && r.description.length <= DESCRIPTION_MAX))

  const flat = n => n.flatMap(x => [x, ...flat(x.children || [])])
  const rota = (await ok(owner.get('/api/nav/items'))).find(n => n.route === '/rota')
  assert.equal(rota.description, null, 'nothing of its own yet')

  // Its own words: trimmed, kept, sent to the person's menu.
  const own = '  Who is on this week, and the zebra shift.  '
  const saved = await ok(owner.patch('/api/nav/items/' + rota.id, { description: own }))
  assert.equal(saved.description, own.trim())
  let me = await ok(owner.get('/api/me'))
  const mine = flat(me.nav_tree).find(n => n.route === '/rota')
  assert.equal(mine.description, own.trim())
  assert.equal(navDescription(mine), own.trim())
  assert.deepEqual(searchNavTree(me.nav_tree, 'zebra').map(r => r.route), ['/rota'], 'found by a word only its description has')
  assert.equal(searchNavTree(me.nav_tree, 'zebra')[0].description, own.trim(), 'and the result shows it')
  // The name still beats the description: Staff's standard words don't mention rota.
  assert.equal(searchNavTree(me.nav_tree, 'rota')[0].route, '/rota')

  // 260 characters fit, 261 don't.
  const max = 'a'.repeat(DESCRIPTION_MAX)
  assert.equal((await ok(owner.patch('/api/nav/items/' + rota.id, { description: max }))).description, max)
  const tooLong = await owner.patch('/api/nav/items/' + rota.id, { description: max + 'b' })
  assert.equal(tooLong.status, 400)
  assert.match(tooLong.body, /260/)
  await assert.rejects(sql`UPDATE nav_items SET description = ${max + 'b'} WHERE id = ${rota.id}`, /nav_items_description_len/,
    'the table refuses it too')

  // Emptied: back to the standard words.
  assert.equal((await ok(owner.patch('/api/nav/items/' + rota.id, { description: '   ' }))).description, null)
  me = await ok(owner.get('/api/me'))
  assert.equal(navDescription(flat(me.nav_tree).find(n => n.route === '/rota')), NAV_DESCRIPTIONS['/rota'])
  // A change that leaves the description out keeps it.
  await ok(owner.patch('/api/nav/items/' + rota.id, { description: 'Kept.' }))
  assert.equal((await ok(owner.patch('/api/nav/items/' + rota.id, { label: 'Rota' }))).description, 'Kept.')

  // A new link and a new section take one too.
  const made = await ok(owner.post('/api/nav/items', { kind: 'link', label: 'Zq link', route: '/rota', description: 'Zq words.' }))
  assert.equal(made.description, 'Zq words.')
  const section = await ok(owner.post('/api/nav/items', { kind: 'section', label: 'Zq section', description: 'Zq section words.' }))
  assert.equal(section.description, 'Zq section words.')
  const bad = await owner.post('/api/nav/items', { kind: 'link', label: 'Zq long', route: '/rota', description: 'x'.repeat(DESCRIPTION_MAX + 1) })
  assert.equal(bad.status, 400)

  // Who may: a viewer can't, and the other group's entries aren't there to change.
  assert.equal((await as(A.viewer, ids.a).patch('/api/nav/items/' + rota.id, { description: 'No.' })).status, 403)
  assert.equal((await as(B.owner, ids.b).patch('/api/nav/items/' + rota.id, { description: 'No.' })).status, 404)
  const other = await ok(as(B.owner, ids.b).get('/api/me'))
  assert.equal(flat(other.nav_tree).find(n => n.route === '/rota').description, null)

  // Reset to defaults clears every description.
  await ok(owner.post('/api/nav/reset', {}))
  me = await ok(owner.get('/api/me'))
  assert.ok(flat(me.nav_tree).every(n => !n.description))
})

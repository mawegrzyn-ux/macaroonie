// The default main menu (migrations 196 + 202 + 208 + 211 + 216 + 219 + 221 + 225 + 227): the migrations' tree is the
// same as DEFAULT_NAV_TREE, every page in the route catalogue is in it once,
// and a new tenant gets it through /api/me.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { getApp, as, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A } from './support/seed.mjs'
import { DEFAULT_NAV_TREE } from '../src/config/defaultNav.js'
import { ROUTE_CATALOG } from '../src/routes/nav.js'

after(closeApp)

const strip = nodes => nodes.map(n => ({
  label: n.label,
  ...(n.icon ? { icon: n.icon } : {}),
  ...(n.route ? { route: n.route } : {}),
  ...(n.module ? { module: n.module } : {}),
  ...(n.children?.length ? { children: strip(n.children) } : {}),
}))
const routes = nodes => nodes.flatMap(n => [...(n.route ? [n.route] : []), ...routes(n.children || [])])

// Migration 196's tree with 202's change applied: Till setup (and its Floor
// plan) and Menu screens out, the Store tech section in after Venues.
test('migrations 196 + 202 + 208 + 211 + 216 + 219 + 221 + 225 + 227 hold the same tree as DEFAULT_NAV_TREE', () => {
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
  // 221: Today at the top of Home, before Overview.
  const home = tree.find(s => routes(s.children || []).includes('/'))
  home.children.splice(home.children.findIndex(n => n.route === '/'), 0,
    { label: 'Today', icon: 'Sun', route: '/today', module: 'dashboard' })
  // 227: Today for everyone, its module gone.
  delete home.children.find(n => n.route === '/today').module
  assert.deepEqual(strip(tree), strip(DEFAULT_NAV_TREE))
})

test('every catalogue page is in the default menu once, and nothing else', () => {
  const inTree = routes(DEFAULT_NAV_TREE)
  assert.equal(new Set(inTree).size, inTree.length, 'a page is in the menu twice')
  assert.deepEqual([...inTree].sort(), ROUTE_CATALOG.map(r => r.route).sort())
  for (const section of DEFAULT_NAV_TREE) assert.ok(!section.route && section.children.length, section.label + ' is a section with links')
})

test('a new tenant gets the default menu', async () => {
  await getApp()
  const ids = await resetAndSeed()
  const me = await ok(as(A.owner, ids.a).get('/api/me'))
  assert.deepEqual(me.nav_tree.map(n => n.label), DEFAULT_NAV_TREE.map(n => n.label))
  const brand = me.nav_tree.find(n => n.label === 'Brand & web').children[0]
  assert.equal(brand.route, '/brand')
})

// The default main menu (migrations 196 + 202): the migrations' tree is the
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
test('migrations 196 + 202 hold the same tree as DEFAULT_NAV_TREE', () => {
  const read = f => fs.readFileSync(new URL('../../migrations/' + f, import.meta.url), 'utf8').match(/\$nav\$([\s\S]*?)\$nav\$/)[1]
  const drop = nodes => nodes.filter(n => !['/pos', '/pos/floor', '/screens'].includes(n.route))
    .map(n => (n.children ? { ...n, children: drop(n.children) } : n))
  const tree = drop(JSON.parse(read('196_main_menu.sql')))
  const at = tree.findIndex(s => routes(s.children || []).includes('/venues'))
  tree.splice(at + 1, 0, { label: 'Store tech', children: JSON.parse(read('202_store_tech_menu.sql')) })
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

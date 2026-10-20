// The default main menu (migration 196): the tree in the migration is the
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

test('migration 196 holds the same tree as DEFAULT_NAV_TREE', () => {
  const sql = fs.readFileSync(new URL('../../migrations/196_main_menu.sql', import.meta.url), 'utf8')
  const json = sql.match(/\$nav\$([\s\S]*?)\$nav\$/)[1]
  assert.deepEqual(strip(JSON.parse(json)), strip(DEFAULT_NAV_TREE))
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

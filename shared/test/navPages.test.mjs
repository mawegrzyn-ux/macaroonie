// The admin's pages, one record each in its area's file (shared/nav/<area>.js,
// gathered by shared/nav/index.js), and the admin's routes, one file per area
// (admin/src/routes/<area>.jsx, gathered by admin/src/main.jsx):
// docs/PARALLEL_WORK.md 3.4 and 3.6. What has to hold for the gathered lists
// to stay whole when several areas add pages at once.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  AREA_PAGES, NAV_PAGES, SECTIONS, ROUTE_CATALOG, DEFAULT_NAV_TREE,
  NAV_KEYWORDS, NAV_DESCRIPTIONS, EXTRA_SEARCH_ROUTES, NAV_SECTION_DESCRIPTIONS,
} from '../nav/index.js'
import * as navSearch from '../navSearch.js'
import { searchWords, DESCRIPTION_MAX } from '../navSearch.js'

const NAV_DIR = new URL('../nav/', import.meta.url)
const ROUTES_DIR = new URL('../../admin/src/routes/', import.meta.url)
const AREAS_DIR = new URL('../../docs/claude/areas/', import.meta.url)
const AREAS = fs.readdirSync(AREAS_DIR).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3))

const FIELDS = new Set(['path', 'label', 'menuLabel', 'icon', 'module', 'section', 'parent', 'order',
  'catalogOrder', 'keywords', 'description', 'searchOnly', 'accepts', 'tabs'])
const listed = NAV_PAGES.filter(p => !p.searchOnly)
const links = nodes => nodes.flatMap(n => [...(n.route ? [n] : []), ...links(n.children || [])])

test('every file in shared/nav is an area of the notes, and the index gathers each one', () => {
  const files = fs.readdirSync(NAV_DIR).filter(f => f.endsWith('.js') && !['index.js', 'sections.js', 'links.js'].includes(f))
  for (const f of files) assert.ok(AREAS.includes(f.slice(0, -3)), f + ' is not an area (docs/claude/areas/<area>.md)')
  assert.deepEqual(Object.keys(AREA_PAGES).sort(), files.map(f => f.slice(0, -3)).sort(),
    'shared/nav/index.js imports every area file in shared/nav, and only those')
  for (const [area, list] of Object.entries(AREA_PAGES)) assert.ok(Array.isArray(list) && list.length, area + ' exports its pages')
})

test('a page is in one area file once, with only the known fields', () => {
  const seen = new Map()
  for (const p of NAV_PAGES) {
    assert.ok(!seen.has(p.path), p.path + ' is in ' + seen.get(p.path) + ' and ' + p.area)
    seen.set(p.path, p.area)
    for (const k of Object.keys(p)) assert.ok(FIELDS.has(k) || k === 'area', p.path + ': unknown field ' + k)
    assert.match(p.path, /^\/[a-z0-9/-]*$/, p.path + ' is an address')
    assert.ok(Number.isInteger(p.catalogOrder) && p.catalogOrder > 0, p.path + ' has a catalogOrder')
  }
})

test('every page has search words and a description', () => {
  for (const p of NAV_PAGES) {
    assert.ok(searchWords(p.keywords).length, p.path + ' needs keywords')
    assert.ok(typeof p.description === 'string' && p.description.length >= 20, p.path + ' needs a description')
    assert.ok(p.description.length <= DESCRIPTION_MAX, p.path + ': ' + p.description.length + ' characters')
    assert.equal(NAV_KEYWORDS[p.path], p.keywords)
    assert.equal(NAV_DESCRIPTIONS[p.path], p.description)
  }
  assert.deepEqual(Object.keys(NAV_KEYWORDS).sort(), NAV_PAGES.map(p => p.path).sort())
  assert.deepEqual(Object.keys(NAV_DESCRIPTIONS).sort(), NAV_PAGES.map(p => p.path).sort())
})

test('a listed page has its name, icon and place in the standard menu; a search-only page has none', () => {
  const sections = new Set(SECTIONS.map(s => s.label))
  for (const p of listed) {
    assert.ok(p.label && p.icon, p.path + ' has a label and an icon')
    assert.ok(sections.has(p.section), p.path + ': no section ' + p.section + ' in shared/nav/sections.js')
    assert.ok(Number.isInteger(p.order) && p.order > 0, p.path + ' has an order')
    if (p.parent) {
      const parent = listed.find(q => q.path === p.parent)
      assert.ok(parent, p.path + ': its parent ' + p.parent + ' is not a page')
      assert.equal(parent.section, p.section, p.path + ' is in its parent\'s section')
    }
  }
  for (const p of NAV_PAGES.filter(q => q.searchOnly)) {
    for (const k of ['label', 'menuLabel', 'icon', 'module', 'section', 'parent', 'order']) {
      assert.equal(p[k], undefined, p.path + ' is search-only: no ' + k)
    }
  }
  assert.deepEqual(EXTRA_SEARCH_ROUTES.slice().sort(), NAV_PAGES.filter(p => p.searchOnly).map(p => p.path).sort())
})

test('the standard menu holds every catalogue page once, and every link in it is in the catalogue', () => {
  const catalog = new Set(ROUTE_CATALOG.map(r => r.route))
  assert.equal(catalog.size, ROUTE_CATALOG.length, 'no page twice in the catalogue')
  const inTree = links(DEFAULT_NAV_TREE).map(n => n.route)
  assert.equal(new Set(inTree).size, inTree.length, 'no page twice in the menu')
  for (const r of inTree) assert.ok(catalog.has(r), r + ' is in the menu but not the catalogue')
  for (const r of catalog) assert.ok(inTree.includes(r), r + ' is in the catalogue but not the menu')
  for (const s of DEFAULT_NAV_TREE) assert.ok(s.children.length, s.label + ' has links')
  assert.deepEqual(DEFAULT_NAV_TREE.map(s => s.label), SECTIONS.slice().sort((a, b) => a.order - b.order).map(s => s.label))
  for (const s of SECTIONS) assert.equal(NAV_SECTION_DESCRIPTIONS[s.label], s.description)
})

test('the menu search reads the gathered lists', () => {
  assert.equal(navSearch.NAV_KEYWORDS, NAV_KEYWORDS)
  assert.equal(navSearch.NAV_DESCRIPTIONS, NAV_DESCRIPTIONS)
  assert.equal(navSearch.NAV_SECTION_DESCRIPTIONS, NAV_SECTION_DESCRIPTIONS)
  assert.equal(navSearch.EXTRA_SEARCH_ROUTES, EXTRA_SEARCH_ROUTES)
})

// The admin's route files: read as text (they are JSX for Vite), one route
// per line: { path: '...' | index: true, shell: '...', element: ... }.
const SHELLS = ['bare', 'installer', 'office', 'mobile']
function adminRoutes() {
  const out = []
  for (const f of fs.readdirSync(ROUTES_DIR).filter(n => n.endsWith('.jsx'))) {
    const text = fs.readFileSync(new URL(f, ROUTES_DIR), 'utf8')
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*\{\s*(?:path:\s*'([^']*)'|index:\s*true)\s*,\s*shell:\s*'([^']*)'/)
      if (m) out.push({ file: f, path: m[1] ?? null, shell: m[2] })
    }
  }
  return out
}

test('every admin route file is an area, and every route has a known shell and is in one file once', () => {
  const files = fs.readdirSync(ROUTES_DIR).filter(n => n.endsWith('.jsx'))
  assert.ok(files.length, 'the admin has route files')
  for (const f of files) assert.ok(AREAS.includes(f.slice(0, -4)), f + ' is not an area (docs/claude/areas/<area>.md)')
  const routes = adminRoutes()
  for (const f of files) {
    const text = fs.readFileSync(new URL(f, ROUTES_DIR), 'utf8')
    const count = (text.match(/^\s*\{\s*(?:path:|index:)/gm) || []).length
    assert.equal(routes.filter(r => r.file === f).length, count, f + ': every route on one line, path (or index) then shell')
  }
  const seen = new Map()
  for (const r of routes) {
    assert.ok(SHELLS.includes(r.shell), r.file + ': ' + (r.path ?? 'index') + ' has no known shell (' + r.shell + ')')
    const key = r.shell + ' ' + (r.path ?? '(index)')
    assert.ok(!seen.has(key), key + ' is in ' + seen.get(key) + ' and ' + r.file)
    seen.set(key, r.file)
  }
})

test('every catalogue page opens a page in the office shell', () => {
  const office = adminRoutes().filter(r => r.shell === 'office')
  const matches = (pattern, url) => {
    const a = pattern.split('/'), b = url.split('/')
    return a.length === b.length && a.every((s, i) => s === b[i] || (s.startsWith(':') && b[i]))
  }
  for (const { route } of ROUTE_CATALOG) {
    const url = route.slice(1)
    const hit = url === '' ? office.find(r => r.path === null) : office.find(r => r.path !== null && matches(r.path, url))
    assert.ok(hit, route + ' has no route in admin/src/routes/*.jsx')
  }
})

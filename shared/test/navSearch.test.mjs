// The menu search's rules (shared/navSearch.js): what a typed query means,
// which links it matches and how they rank.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { searchTerms, searchWords, searchNavTree, scoreLink, NAV_KEYWORDS, STOP_WORDS } from '../navSearch.js'

// A small tree in /api/me's nav_tree shape: sections with links, a link
// with children, a custom label over a catalogue route, a duplicate.
const TREE = [
  { kind: 'section', id: 's1', label: 'People', children: [
    { kind: 'link', id: 'l1', label: 'Rota', route: '/rota', icon: 'CalendarRange', children: [] },
    { kind: 'link', id: 'l2', label: 'Staff', route: '/staff', icon: 'UsersRound', children: [] },
  ] },
  { kind: 'section', id: 's2', label: 'Health & safety', children: [
    { kind: 'link', id: 'l3', label: 'Food safety', route: '/food-safety', children: [] },
    { kind: 'link', id: 'l4', label: 'Checklists', route: '/checklists', children: [] },
  ] },
  { kind: 'section', id: 's3', label: 'Menus', children: [
    { kind: 'link', id: 'l5', label: 'Menus', route: '/menus', children: [
      // A renamed link: the catalogue's words still find it by its route.
      { kind: 'link', id: 'l6', label: 'Option groups', route: '/menus/variant-groups', children: [] },
    ] },
  ] },
  { kind: 'section', id: 's4', label: 'Help', children: [
    { kind: 'link', id: 'l7', label: "What's new", route: '/changelog', children: [] },
    // The same page twice (a custom menu can do that).
    { kind: 'link', id: 'l8', label: 'Staff', route: '/staff', children: [] },
    // Renamed again: "hs" exists only in the route's own words.
    { kind: 'link', id: 'l9', label: 'Jobs list', route: '/hs-action-log', children: [] },
  ] },
]

test('searchTerms drops filler words and falls back to them when nothing else is left', () => {
  assert.deepEqual(searchTerms('how do I change staff pay'), ['staff', 'pay'])
  assert.deepEqual(searchTerms('  Fridge   TEMPERATURES '), ['fridge', 'temperatures'])
  // Every word filler: the words themselves are the terms.
  assert.deepEqual(searchTerms('whats new'), ['whats', 'new'])
  // Nothing typed, or separators only: not a search.
  assert.deepEqual(searchTerms(''), [])
  assert.deepEqual(searchTerms('  ...  '), [])
  // Apostrophes vanish before splitting, so "what's" reads as one word.
  assert.deepEqual(searchWords("What's new"), ['whats', 'new'])
})

test('a link matches only when every term hits, ranked by where the hits land', () => {
  const link = { labelWords: ['rota'], keywordWords: ['shifts', 'pay'], pathWords: ['people'] }
  assert.equal(scoreLink(['rota'], link), 3)
  assert.equal(scoreLink(['shif'], link), 2)             // prefix of a keyword
  assert.equal(scoreLink(['people'], link), 1)           // ancestor label
  assert.equal(scoreLink(['rota', 'pay'], link), 5)      // summed
  assert.equal(scoreLink(['rota', 'zebra'], link), 0)    // one term missing = no match
  assert.equal(scoreLink(['ota'], link), 0)              // prefix only, never substring
})

test('searchNavTree narrows the tree to the links that fit', () => {
  // Nothing typed = not searching.
  assert.equal(searchNavTree(TREE, ''), null)
  assert.equal(searchNavTree(TREE, '   '), null)

  // "change staff pay": filler dropped, Staff by its label first, Rota by
  // its keywords (pay, wages) after, each with the section it sits in.
  const pay = searchNavTree(TREE, 'how do I change staff pay')
  assert.deepEqual(pay.map(r => [r.label, r.path]), [
    ['Staff', 'People'], ['Staff', 'Help'], ['Rota', 'People'],
  ])

  // A term that matches nothing leaves no results at all.
  assert.deepEqual(searchNavTree(TREE, 'rota zebra'), [])

  // Prefixes work: "temp" finds Food safety through its keywords.
  assert.deepEqual(searchNavTree(TREE, 'temp').map(r => r.route), ['/food-safety'])

  // An ancestor's label counts: "health" lists everything under the
  // section (Checklists only matches through it) plus the renamed action
  // log, whose keywords say health.
  assert.deepEqual(searchNavTree(TREE, 'health').map(r => r.route).sort(), ['/checklists', '/food-safety', '/hs-action-log'])

  // A renamed link is still found by its route's catalogue words — and by
  // the route's own words.
  assert.deepEqual(searchNavTree(TREE, 'modifiers').map(r => r.label), ['Option groups'])
  assert.deepEqual(searchNavTree(TREE, 'hs action').map(r => r.label), ['Jobs list'])

  // A child link carries its parent link's label as an ancestor — and the
  // label hit outranks the Menus link's own keyword hit.
  const nested = searchNavTree(TREE, 'option')
  assert.deepEqual(nested.map(r => [r.label, r.path]), [['Option groups', 'Menus · Menus'], ['Menus', 'Menus']])

  // "whats new" (all filler) still finds What's new by its label.
  assert.deepEqual(searchNavTree(TREE, 'whats new').map(r => r.route), ['/changelog'])

  // The same page twice in the menu is listed twice, with distinct keys.
  const staff = searchNavTree(TREE, 'staff').filter(r => r.route === '/staff')
  assert.equal(staff.length, 2)
  assert.notEqual(staff[0].key, staff[1].key)
})

test('the keyword list itself is lowercase words with no filler-only entries', () => {
  for (const [route, words] of Object.entries(NAV_KEYWORDS)) {
    assert.ok(words.trim().length, route + ' has keywords')
    assert.equal(words, words.toLowerCase(), route + ' keywords are lowercase')
    assert.ok(searchWords(words).some(w => !STOP_WORDS.has(w)), route + ' keywords are not all filler')
  }
})

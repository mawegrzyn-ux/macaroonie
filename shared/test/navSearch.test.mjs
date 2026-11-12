// The menu search's rules (shared/navSearch.js): what a typed query means,
// which links it matches and how they rank, and the menu entries'
// descriptions.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  searchTerms, searchWords, searchNavTree, scoreLink, matchLink, navDescription, exactRoutes, placeText,
  NAV_KEYWORDS, NAV_DESCRIPTIONS, NAV_SECTION_DESCRIPTIONS, DESCRIPTION_MAX, SEARCH_WEIGHTS, STOP_WORDS,
  wordForms, FORM_PENALTY,
} from '../navSearch.js'

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
  const link = { labelWords: ['rota'], keywordWords: ['shifts', 'pay'], descriptionWords: ['weekly', 'hours', 'pay'], pathWords: ['people'] }
  assert.deepEqual(SEARCH_WEIGHTS, { label: 4, keywords: 3, description: 2, path: 1 })
  assert.equal(scoreLink(['rota'], link), 4)             // the link's own name
  assert.equal(scoreLink(['shif'], link), 3)             // prefix of a keyword
  assert.equal(scoreLink(['week'], link), 2)             // prefix of a word in the description
  assert.equal(scoreLink(['people'], link), 1)           // ancestor label
  assert.equal(scoreLink(['rota', 'pay'], link), 7)      // summed; pay counts once, at its best place
  assert.equal(scoreLink(['rota', 'hours'], link), 6)
  assert.equal(scoreLink(['rota', 'zebra'], link), 0)    // one term missing = no match
  assert.equal(scoreLink(['ota'], link), 0)              // prefix only, never substring
  // matchLink also says how many terms are in the name itself.
  assert.deepEqual(matchLink(['rota', 'pay'], link), { score: 7, labelHits: 1 })
  assert.equal(matchLink(['zebra'], link), null)
  // A link with no description or ancestors still matches by the rest.
  assert.equal(scoreLink(['rota'], { labelWords: ['rota'], keywordWords: [] }), 4)
})

test('a plural typed is the same word as its singular, worth a little less than the word as typed', () => {
  // The forms of a word: itself and itself without a plural ending.
  assert.deepEqual(wordForms('designers'), ['designers', 'designer'])
  assert.deepEqual(wordForms('dishes'), ['dishes', 'dishe', 'dish'])
  assert.deepEqual(wordForms('allergies'), ['allergies', 'allergie', 'allergi', 'allergy'])
  assert.deepEqual(wordForms('designer'), ['designer'])
  // Short words and words ending in ss keep their s; no form is under three letters.
  assert.deepEqual(wordForms('pos'), ['pos'])
  assert.deepEqual(wordForms('kds'), ['kds'])
  assert.deepEqual(wordForms('glass'), ['glass'])
  assert.deepEqual(wordForms('news'), ['news', 'new'])
  assert.deepEqual(wordForms('uses'), ['uses', 'use'])

  assert.equal(FORM_PENALTY, 0.5)
  const designer = { labelWords: ['kiosk', 'designer'], keywordWords: ['designs', 'look'], descriptionWords: ['colours', 'category'], pathWords: ['store', 'tech'] }
  // "designers" is "designer" in the name: a name hit, half a point under the word as typed.
  assert.deepEqual(matchLink(['designers'], designer), { score: 3.5, labelHits: 1 })
  assert.deepEqual(matchLink(['designer'], designer), { score: 4, labelHits: 1 })
  assert.deepEqual(matchLink(['kiosks', 'designers'], designer), { score: 7, labelHits: 2 })
  // The same in the search words (2.5), the description (1.5, y for ies) and a section above (0.5).
  assert.equal(scoreLink(['looks'], designer), 2.5)
  assert.equal(scoreLink(['categories'], designer), 1.5)
  assert.equal(scoreLink(['stores'], designer), 0.5)
  // A form in the name beats the word as typed in the search words...
  assert.equal(scoreLink(['designs'], designer), 3)      // "designs" is typed in the search words; "designer" isn't its singular
  assert.equal(scoreLink(['kiosks'], { labelWords: ['kiosk'], keywordWords: ['kiosks'] }), 3.5)
  // ...and the word as typed in the name beats a form of it.
  assert.equal(scoreLink(['menus'], { labelWords: ['menus'], keywordWords: [] }), 4)
  assert.equal(scoreLink(['menus'], { labelWords: ['menu', 'times'], keywordWords: [] }), 3.5)
  // The singular typed finds the plural as before (the start of the word).
  assert.equal(scoreLink(['playlist'], { labelWords: ['screen', 'playlists'], keywordWords: [] }), 4)
  // ...and where the plural isn't the singular plus letters (category, categories) it is still the same word.
  assert.equal(scoreLink(['category'], { labelWords: ['categories'], keywordWords: [] }), 3.5)
  assert.equal(scoreLink(['allergy'], { labelWords: ['allergies'], keywordWords: [] }), 3.5)
  // Another form is the same word, never the start of a longer one: "times" isn't "timeline".
  assert.equal(scoreLink(['times'], { labelWords: ['timeline'], keywordWords: [] }), 0)
  assert.equal(scoreLink(['time'], { labelWords: ['timeline'], keywordWords: [] }), 4)
  assert.equal(scoreLink(['boards'], { labelWords: ['boarding'], keywordWords: [] }), 0)
  // Short words aren't cut down: "pos" doesn't become "po".
  assert.equal(scoreLink(['pos'], { labelWords: ['po'], keywordWords: [] }), 0)

  // In a tree: the page called Menus first, the Menu... pages after it, search words last.
  const tree = [{ kind: 'section', id: 's', label: 'Menus', children: [
    { kind: 'link', id: 'a', label: 'Menu times', route: '/menus/times', children: [] },
    { kind: 'link', id: 'b', label: 'Menus', route: '/menus', children: [] },
    { kind: 'link', id: 'c', label: 'Promotions', route: '/promotions', children: [] },
  ] }]
  assert.deepEqual(searchNavTree(tree, 'menus').map(r => r.label), ['Menus', 'Menu times', 'Promotions'])
  // Every designer by the plural, in name order.
  const designers = [{ kind: 'section', id: 's', label: 'Store tech', children: [
    { kind: 'link', id: 'a', label: 'Kiosks', route: '/pos/kiosks', children: [] },
    { kind: 'link', id: 'b', label: 'Kiosk designer', route: '/pos/kiosk-designs', children: [] },
    { kind: 'link', id: 'c', label: 'Kitchen flow designer', route: '/pos/kitchen-flow', children: [] },
    { kind: 'link', id: 'd', label: 'Receipt & ticket designer', route: '/pos/print-designs', children: [] },
  ] }]
  assert.deepEqual(searchNavTree(designers, 'designers').map(r => r.label), ['Kiosk designer', 'Kitchen flow designer', 'Receipt & ticket designer'])
  assert.deepEqual(searchNavTree(designers, 'tickets').map(r => r.label)[0], 'Receipt & ticket designer')
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
  // label hit outranks the Menus link's own keyword hit. Its place says a
  // name once when the section and the link under it share it.
  const nested = searchNavTree(TREE, 'option')
  assert.deepEqual(nested.map(r => [r.label, r.path]), [['Option groups', 'Menus'], ['Menus', 'Menus']])
  assert.equal(placeText(['Menus', 'menus', 'Printing']), 'Menus · Printing')
  assert.equal(placeText(['Store tech', 'Tills']), 'Store tech · Tills')
  assert.equal(placeText(['Menus', 'Printing', 'Menus']), 'Menus · Printing · Menus')   // only neighbours fold
  assert.equal(placeText([]), '')
  // The two results still have keys of their own.
  assert.notEqual(nested[0].key, nested[1].key)

  // "whats new" (all filler) still finds What's new by its label.
  assert.deepEqual(searchNavTree(TREE, 'whats new').map(r => r.route), ['/changelog'])

  // The same page twice in the menu is listed twice, with distinct keys.
  const staff = searchNavTree(TREE, 'staff').filter(r => r.route === '/staff')
  assert.equal(staff.length, 2)
  assert.notEqual(staff[0].key, staff[1].key)

  // Every result says what its page is for.
  assert.equal(searchNavTree(TREE, 'rota')[0].description, NAV_DESCRIPTIONS['/rota'])
})

test('a description is searched, below the name and the keywords and above the section', () => {
  const tree = [
    { kind: 'section', id: 's1', label: 'Fridge things', children: [
      // Only its section says fridge.
      { kind: 'link', id: 'a', label: 'Other', route: '/x-other', children: [] },
    ] },
    { kind: 'section', id: 's2', label: 'Kitchen', children: [
      // Only its own description says fridge.
      { kind: 'link', id: 'b', label: 'Repairs', route: '/x-repairs', description: 'Broken fridge? Log it here.', children: [] },
      // Its page's keywords say fridge (and its standard description too: counted once, as a keyword).
      { kind: 'link', id: 'c', label: 'Food safety', route: '/food-safety', children: [] },
      // Its name says fridge.
      { kind: 'link', id: 'd', label: 'Fridge log', route: '/x-log', children: [] },
    ] },
  ]
  const found = searchNavTree(tree, 'fridge')
  assert.deepEqual(found.map(r => [r.label, r.score]), [
    ['Fridge log', 4], ['Food safety', 3], ['Repairs', 2], ['Other', 1],
  ])
  // Found by its description alone, and by a prefix of a word in it.
  assert.deepEqual(searchNavTree(tree, 'broken').map(r => r.label), ['Repairs'])
  assert.deepEqual(searchNavTree(tree, 'brok').map(r => r.label), ['Repairs'])
  assert.equal(found[2].description, 'Broken fridge? Log it here.')

  // A page's standard description is searched when the entry has none of its own...
  const standard = [{ kind: 'link', id: 'i', label: 'Stock items', route: '/inventory', children: [] }]
  assert.ok(!searchWords(NAV_KEYWORDS['/inventory']).includes('buy'), 'the test word is in the description only')
  assert.deepEqual(searchNavTree(standard, 'buy').map(r => r.label), ['Stock items'])
  // ...and one written for the entry takes its place.
  const own = [{ kind: 'link', id: 'i', label: 'Stock items', route: '/inventory', description: 'Wine, beer and spirits behind the bar.', children: [] }]
  assert.deepEqual(searchNavTree(own, 'buy'), [])
  assert.deepEqual(searchNavTree(own, 'wine').map(r => r.label), ['Stock items'])
  // The page's keywords still find it either way.
  assert.deepEqual(searchNavTree(own, 'supplier prices').map(r => r.label), ['Stock items'])

  // Equal scores: the link with more of the query in its own name comes
  // first, whatever the alphabet says.
  const tie = [
    { kind: 'link', id: 'p', label: 'Aardvark', route: '/rota', children: [] },                                   // shifts + holiday by keywords: 3 + 3
    { kind: 'link', id: 'q', label: 'Zed shifts', route: '/x-zed', description: 'Holiday cover.', children: [] }, // name + description: 4 + 2
  ]
  assert.deepEqual(searchNavTree(tie, 'shifts holiday').map(r => [r.label, r.score]), [['Zed shifts', 6], ['Aardvark', 6]])
})

test('a section\'s description is shown, never searched through its links', () => {
  const tree = [
    { kind: 'section', id: 's1', label: 'Cellar', description: 'Everything about wine.', children: [
      { kind: 'link', id: 'a', label: 'Stock', route: '/x-stock', children: [] },
    ] },
    // The standard menu's Store tech section: its standard description names kiosks.
    { kind: 'section', id: 's2', label: 'Store tech', children: [
      { kind: 'link', id: 'b', label: 'Printers', route: '/pos/printers', children: [] },
    ] },
  ]
  assert.deepEqual(searchNavTree(tree, 'wine'), [])
  assert.ok(searchWords(NAV_SECTION_DESCRIPTIONS['Store tech']).includes('kiosks'))
  assert.deepEqual(searchNavTree(tree, 'kiosks'), [])
  // The section's name still counts for its links.
  assert.deepEqual(searchNavTree(tree, 'cellar').map(r => r.label), ['Stock'])
  assert.deepEqual(searchNavTree(tree, 'store tech').map(r => r.label), ['Printers'])
})

test('navDescription: the entry\'s own words, else its page\'s, else its section\'s', () => {
  assert.equal(navDescription({ kind: 'link', route: '/rota', description: '  Who is on this week.  ' }), 'Who is on this week.')
  assert.equal(navDescription({ kind: 'link', route: '/rota', description: '' }), NAV_DESCRIPTIONS['/rota'])
  assert.equal(navDescription({ kind: 'link', route: '/rota', description: null }), NAV_DESCRIPTIONS['/rota'])
  assert.equal(navDescription({ kind: 'link', route: '/rota' }), NAV_DESCRIPTIONS['/rota'])
  // A page with no standard description (a route that isn't in the catalogue).
  assert.equal(navDescription({ kind: 'link', route: '/somewhere-else' }), '')
  // Sections: the standard menu's by name; a renamed one has none; its own wins.
  assert.equal(navDescription({ kind: 'section', label: 'Store tech' }), NAV_SECTION_DESCRIPTIONS['Store tech'])
  assert.equal(navDescription({ kind: 'section', label: 'Our gadgets' }), '')
  assert.equal(navDescription({ kind: 'section', label: 'Store tech', description: 'Tills and things.' }), 'Tills and things.')
  // A link is never described by a section's words, even with a section's name.
  assert.equal(navDescription({ kind: 'link', label: 'Store tech', route: '/x' }), '')
  // Never longer than the limit, whatever was stored.
  assert.equal(navDescription({ route: '/rota', description: 'x'.repeat(DESCRIPTION_MAX + 40) }).length, DESCRIPTION_MAX)
  assert.equal(navDescription(null), '')
  assert.equal(DESCRIPTION_MAX, 260)
})

test('exactRoutes: a link another link\'s address starts with only matches its own address', () => {
  const tree = [
    { kind: 'section', label: 'Home', children: [
      { kind: 'link', label: 'Overview', route: '/', children: [] },
    ] },
    { kind: 'section', label: 'Store tech', children: [
      { kind: 'link', label: 'Menu screens', route: '/screens', children: [] },
      { kind: 'link', label: 'Screen board designer', route: '/screens/boards', children: [] },
      { kind: 'link', label: 'Kiosks', route: '/pos/kiosks', children: [] },
      { kind: 'link', label: 'Kiosk designer', route: '/pos/kiosk-designs', children: [] },
      { kind: 'link', label: 'Till layouts', route: '/pos/layouts', children: [] },
      { kind: 'link', label: 'Kitchen screens', route: '/pos/kitchen', children: [] },
      { kind: 'link', label: 'Kitchen flow designer', route: '/pos/kitchen-flow', children: [] },
    ] },
    { kind: 'section', label: 'Menus', children: [
      { kind: 'link', label: 'Menus', route: '/menus', children: [
        { kind: 'link', label: 'Menu print designer', route: '/menus/print-designs', children: [] },
      ] },
    ] },
  ]
  // /screens and /menus have a longer address beside or under them; the home
  // page always matches exactly. /pos/kiosks is not the start of
  // /pos/kiosk-designs, and /pos/kitchen-flow only begins with the letters of
  // /pos/kitchen: it isn't under it (addresses compare by whole parts).
  assert.deepEqual([...exactRoutes(tree)].sort(), ['/', '/menus', '/screens'])
  assert.deepEqual([...exactRoutes([])], [])
  assert.deepEqual([...exactRoutes(null)], [])
  // The same page twice in the menu doesn't make itself exact.
  assert.deepEqual([...exactRoutes([
    { kind: 'link', label: 'Staff', route: '/staff', children: [] },
    { kind: 'link', label: 'Staff again', route: '/staff', children: [] },
  ])], [])
})

test('the keyword list itself is lowercase words with no filler-only entries', () => {
  for (const [route, words] of Object.entries(NAV_KEYWORDS)) {
    assert.ok(words.trim().length, route + ' has keywords')
    assert.equal(words, words.toLowerCase(), route + ' keywords are lowercase')
    assert.ok(searchWords(words).some(w => !STOP_WORDS.has(w)), route + ' keywords are not all filler')
  }
})

test('every page with keywords has a description, a sentence within the limit', () => {
  assert.deepEqual(Object.keys(NAV_DESCRIPTIONS).sort(), Object.keys(NAV_KEYWORDS).sort())
  for (const [key, text] of [...Object.entries(NAV_DESCRIPTIONS), ...Object.entries(NAV_SECTION_DESCRIPTIONS)]) {
    assert.ok(text.trim().length >= 20, key + ' has a description')
    assert.equal(text, text.trim(), key + ' description has no stray spaces')
    assert.ok(text.length <= DESCRIPTION_MAX, key + ' description is ' + text.length + ' characters, over ' + DESCRIPTION_MAX)
    assert.ok(/[.?!]$/.test(text), key + ' description ends as a sentence')
    assert.ok(/^[A-Z]/.test(text), key + ' description starts with a capital')
    assert.ok(!/\s{2,}|\n/.test(text), key + ' description is one line')
  }
})

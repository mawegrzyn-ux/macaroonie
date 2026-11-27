// Allergens from recipes as a check on the declaration (shared/allergenCheck.js,
// inventory phase 8a, 27 Nov 2026): a product's allergens (unknown until
// checked), the roll-up on the cost engine's own walk (a prep recipe inside,
// an option's rule, a line whose unit has no size still counted), the product
// chooseQuote() picks at each venue (another supplier, another suggestion),
// the scopes a dish can differ at, the differences against the declaration
// (a declared allergen nothing has is said only when everything is known),
// what a stored check does next (a dismissal holds while the differences are
// the same) and the declaration after accepting.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  quoteAllergens, allergenListProblem, productWords, dishScopes, dishItems, scopeSuggestion, recipeSuggestion,
  declaredOf, dishCheck, fingerprint, nextCheck, acceptedLevels, evidenceWords, checksDish, checkCounts, ALLERGEN_KEYS,
} from '../allergenCheck.js'
import { usageOf, dishMap } from '../costing.js'
import { STANDARD_ALLERGENS } from '../menuTags.js'

const SOHO = 'v-soho', LEEDS = 'v-leeds', TAKE = 't-take'
const names = { venues: { [SOHO]: 'Soho', [LEEDS]: 'Leeds' }, streams: {}, types: { [TAKE]: 'Take out' } }
const CHECKED = '2026-11-20T10:00:00Z'
const item = (id, name, base_unit = 'g', extra = {}) => ({ id, name, base_unit, yield_pct: 100, units: [], ...extra })
const quote = (id, itemId, supplier, allergens = null, extra = {}) => ({
  id, item_id: itemId, supplier_name: supplier, product_name: null, supplier_code: null, pack_name: 'Pack', pack_count: 1, pack_qty: 1000,
  pack_unit: 'g', pack_base_qty: 1000, price: 5, venue_prices: {}, is_active: true,
  allergens_contains: allergens?.contains || [], allergens_may_contain: allergens?.may || [], allergens_checked_at: allergens ? CHECKED : null,
  allergens_source: allergens ? 'Spec sheet' : null, ...extra,
})
const items = new Map([
  ['noodles', item('noodles', 'Rice noodles')], ['egg', item('egg', 'Egg', 'each')], ['oyster', item('oyster', 'Oyster sauce', 'ml')],
  ['fish', item('fish', 'Fish sauce', 'ml')], ['tamarind', item('tamarind', 'Tamarind')], ['prawns', item('prawns', 'Prawns')],
  ['tofu', item('tofu', 'Tofu')], ['chilli', item('chilli', 'Chilli')],
])
const baseQuotes = () => new Map([
  ['noodles', [quote('q-noodles', 'noodles', 'Brakes', {})]],
  ['egg', [quote('q-egg', 'egg', 'Brakes', { contains: ['eggs'] })]],
  // Two suppliers' oyster sauces differ: Brakes' has wheat in it, Bidfood's may hold sesame.
  ['oyster', [
    quote('q-oyster-brakes', 'oyster', 'Brakes', { contains: ['molluscs', 'soya', 'gluten'] }, { product_name: 'Lee Kum Kee oyster sauce' }),
    quote('q-oyster-bid', 'oyster', 'Bidfood', { contains: ['molluscs', 'soya'], may: ['sesame'] }),
  ]],
  ['fish', [quote('q-fish', 'fish', 'Brakes', { contains: ['fish'] })]],
  ['tamarind', [quote('q-tamarind', 'tamarind', 'Brakes', null)]],
  ['prawns', [quote('q-prawns', 'prawns', 'Brakes', { contains: ['crustaceans'] })]],
  ['tofu', [quote('q-tofu', 'tofu', 'Brakes', { contains: ['soya'] })]],
])
// Soho orders Brakes' oyster sauce (the group's choice), Leeds Bidfood's.
const preferred = new Map([['oyster', { default: 'q-oyster-brakes', venues: { [LEEDS]: 'q-oyster-bid' } }]])
const recipe = (id, name, kind, lines, extra = {}) => ({
  id, name, kind, portions: 1, yield_qty: kind === 'prep' ? 1 : null, yield_unit: kind === 'prep' ? 'l' : null, loss_pct: 0,
  status: 'live', source: null, variant_of: null, lines: lines.map((l, i) => ({ id: id + '-' + i, sort_order: i, yield_pct: null, ...l })), ...extra,
})
const recipes = () => new Map([
  ['sauce', recipe('sauce', 'Pad thai sauce', 'prep', [{ item_id: 'oyster', qty: 500, unit: 'ml' }, { item_id: 'fish', qty: 200, unit: 'ml' }, { item_id: 'tamarind', qty: 300, unit: 'g' }])],
  // The egg's unit has no size ("a piece"): it is in the dish all the same.
  ['padthai', recipe('padthai', 'Pad thai', 'dish', [{ item_id: 'noodles', qty: 150, unit: 'g' }, { item_id: 'egg', qty: 1, unit: 'piece' }, { sub_recipe_id: 'sauce', qty: 80, unit: 'ml' }])],
  // The takeaway version swaps the egg for tofu.
  ['padthai-to-go', recipe('padthai-to-go', 'Pad thai to go', 'dish', [{ item_id: 'noodles', qty: 150, unit: 'g' }, { item_id: 'tofu', qty: 50, unit: 'g' }, { sub_recipe_id: 'sauce', qty: 80, unit: 'ml' }])],
])
const options = new Map([
  ['o-prawns', { id: 'o-prawns', label: 'Add prawns', group_id: 'g-extras', group_name: 'Extras', variation_type: 'addition', price_mode: 'extra', price_pence: 250 }],
  ['o-spicy', { id: 'o-spicy', label: 'Extra spicy', group_id: 'g-heat', group_name: 'Heat', variation_type: 'modification', price_mode: 'extra', price_pence: 0 }],
  ['o-peanuts', { id: 'o-peanuts', label: 'Peanuts on top', group_id: 'g-top', group_name: 'Toppings', variation_type: 'addition', price_mode: 'extra', price_pence: 50 }],
])
const rule = (option_id, action, extra = {}) => ({ id: 'rule-' + option_id, option_id, dish_id: null, option_label: null, action, item_id: null, sub_recipe_id: null, swap_item_id: null, qty: null, unit: null, factor: null, recipe_id: null, ...extra })
const rules = [rule('o-prawns', 'add', { item_id: 'prawns', qty: 60, unit: 'g' })]
const group = (id, name, opts) => ({ group_id: id, name, price_mode: 'extra', min_select: 0, max_select: 3, options: opts.map(o => ({ option_id: o, label: options.get(o).label, price_pence: options.get(o).price_pence })) })
const dishRow = (id, name, groups = [], extra = {}) => ({ id, name, price_pence: 1200, kind: null, tax: null, variants: [], variant_groups: groups, dietary: [], allergen_levels: {}, ...extra })
const menu = {
  id: 'm1', name: 'Dinner', item_type: null,
  sections: [{ id: 's1', title: 'Noodles', items: [
    dishRow('d-padthai', 'Pad thai', [group('g-extras', 'Extras', ['o-prawns']), group('g-heat', 'Heat', ['o-spicy'])]),
    dishRow('d-plain', 'Plain noodles'),
    dishRow('d-norecipe', 'Soup of the day'),
    dishRow('d-deal', 'Noodle deal', [], { kind: 'combo', combo: { steps: [] } }),
    dishRow('d-candle', 'Candle', [], { item_type: 'goods' }),
  ] }],
}
const link = (id, dish, recipeId, scope = {}) => ({ id, dish_id: dish, recipe_id: recipeId, portions: 1, venue_id: null, revenue_stream_id: null, order_type_id: null, ...scope })
const ctx = (extra = {}) => ({
  items, recipes: recipes(), quotes: baseQuotes(), preferred, rules, options, names,
  links: [link('l1', 'd-padthai', 'padthai'), link('l2', 'd-padthai', 'padthai-to-go', { order_type_id: TAKE }), link('l3', 'd-plain', 'padthai')],
  dishes: dishMap([menu]), venueId: null, basis: 'standard', ...extra,
})
const keys = levels => Object.keys(levels).sort()

test('a product\'s allergens are unknown until checked, and a bad list is refused by name', () => {
  assert.deepEqual(quoteAllergens(quote('q', 'x', 'B', null)), { known: false, levels: {}, checked_at: null, checked_by: null, source: null })
  const a = quoteAllergens(quote('q', 'x', 'B', { contains: ['soya', 'gluten'], may: ['sesame', 'soya'] }))
  assert.equal(a.known, true)
  assert.deepEqual(a.levels, { sesame: 'may_contain', soya: 'contains', gluten: 'contains' }, 'contains beats may contain for the same key')
  assert.deepEqual(quoteAllergens(quote('q', 'x', 'B', {})).levels, {}, 'checked and free of all 14 is known, with none')
  assert.equal(productWords(quoteAllergens(quote('q', 'x', 'B', {}))), 'None of the 14 allergens')
  assert.equal(productWords(a), 'Contains gluten, soya. May contain sesame')
  assert.equal(productWords(quoteAllergens(null)), 'Allergens not known')
  assert.equal(allergenListProblem({ contains: ['soya'], may_contain: ['sesame'] }), null)
  assert.match(allergenListProblem({ contains: ['garlic'] }), /garlic.*14 allergens/)
  assert.match(allergenListProblem({ contains: ['soya'], may_contain: ['soya'] }), /Soya can't be both/)
  assert.deepEqual(ALLERGEN_KEYS, STANDARD_ALLERGENS.map(s => s.key), 'one list: the menus\' 14')
})

test('the walk is the cost engine\'s: a prep recipe inside, an option\'s rule, a line with no size, and nothing changes without a trace', () => {
  const c = ctx()
  const w = dishItems('d-padthai', { venue_id: SOHO }, c)
  assert.deepEqual(w.recipe, { id: 'padthai', name: 'Pad thai' })
  const byItem = Object.fromEntries(w.entries.map(e => [e.item_id, e]))
  assert.deepEqual(Object.keys(byItem).sort(), ['egg', 'fish', 'noodles', 'oyster', 'prawns', 'tamarind'])
  assert.deepEqual(byItem.oyster.via, ['Pad thai', 'Pad thai sauce'], 'through the prep recipe')
  assert.equal(byItem.egg.option, null, 'the egg has no size for a piece, and is still in the dish')
  assert.equal(byItem.prawns.option, 'Add prawns', 'what an option\'s rule adds is named with it')
  assert.deepEqual(byItem.prawns.via, [])
  assert.deepEqual(w.gaps, [], 'a modification with no rule changes nothing: no gap')
  // The same usageOf() call without the trace takes off what it always did (the egg has no quantity).
  const plain = usageOf({ dish_id: 'd-padthai', qty: 1 }, { venue_id: SOHO }, c)
  const traced = usageOf({ dish_id: 'd-padthai', qty: 1 }, { venue_id: SOHO }, c, { trace: { item: () => {}, recipe: () => {} } })
  assert.deepEqual(traced.items, plain.items)
  assert.deepEqual(traced.uncosted, plain.uncosted)
  assert.ok(!plain.items.some(i => i.item_id === 'egg'))
  // An option that adds with no rule leaves the list unknown.
  const withPeanuts = ctx({ dishes: dishMap([{ ...menu, sections: [{ ...menu.sections[0], items: [dishRow('d-padthai', 'Pad thai', [group('g-top', 'Toppings', ['o-peanuts'])])] }] }]) })
  const g = dishItems('d-padthai', { venue_id: SOHO }, withPeanuts).gaps
  assert.equal(g.length, 1)
  assert.equal(g[0].reason, 'option')
  assert.match(g[0].text, /Peanuts on top/)
  // No recipe: a gap, nothing to list.
  const none = dishItems('d-norecipe', { venue_id: SOHO }, c)
  assert.equal(none.recipe, null)
  assert.equal(none.gaps[0].reason, 'no_recipe')
  // A recipe with nothing in it is unknown, never free of allergens.
  const r = recipes()
  r.set('empty', recipe('empty', 'Soup base', 'dish', []))
  const empty = dishItems('d-norecipe', { venue_id: SOHO }, ctx({ recipes: r, links: [...c.links, link('l9', 'd-norecipe', 'empty')] }))
  assert.deepEqual(empty.gaps.map(g => g.reason), ['empty'])
  assert.equal(scopeSuggestion('d-norecipe', { venue_id: SOHO }, ctx({ recipes: r, links: [...c.links, link('l9', 'd-norecipe', 'empty')] })).complete, false)
})

test('each item at the product chooseQuote() picks at the venue: another supplier, another suggestion; unknown is a gap', () => {
  const c = ctx()
  const soho = scopeSuggestion('d-padthai', { venue_id: SOHO }, c)
  const leeds = scopeSuggestion('d-padthai', { venue_id: LEEDS }, c)
  assert.deepEqual(keys(soho.levels), ['crustaceans', 'eggs', 'fish', 'gluten', 'molluscs', 'soya'])
  assert.deepEqual(keys(leeds.levels), ['crustaceans', 'eggs', 'fish', 'molluscs', 'sesame', 'soya'])
  assert.equal(leeds.levels.sesame, 'may_contain')
  assert.equal(soho.evidence.gluten[0].supplier, 'Brakes')
  assert.equal(soho.evidence.gluten[0].product, 'Lee Kum Kee oyster sauce')
  assert.equal(evidenceWords(soho.evidence.gluten[0]), 'Oyster sauce in Pad thai sauce (Brakes: Lee Kum Kee oyster sauce)')
  assert.equal(evidenceWords(soho.evidence.crustaceans[0]), 'Prawns with Add prawns (Brakes)')
  assert.equal(evidenceWords(leeds.evidence.sesame[0]), 'Oyster sauce in Pad thai sauce (Bidfood), may contain')
  // Tamarind's product has no allergen data: a gap at each venue, by name.
  assert.equal(soho.complete, false)
  assert.equal(soho.gaps.length, 1)
  assert.equal(soho.gaps[0].reason, 'unknown')
  assert.equal(soho.gaps[0].text, 'Allergens unknown for Tamarind at Soho (Brakes: Tamarind)')
  // An item with no supplier product at all is a gap too.
  const q = baseQuotes()
  q.delete('fish')
  const noFish = scopeSuggestion('d-padthai', { venue_id: SOHO }, ctx({ quotes: q }))
  assert.ok(noFish.gaps.some(g => g.reason === 'no_product' && /Fish sauce at Soho: no supplier product/.test(g.text)))
  // A switched-off product isn't picked.
  const off = baseQuotes()
  off.get('oyster')[0].is_active = false
  assert.ok(!scopeSuggestion('d-padthai', { venue_id: SOHO }, ctx({ quotes: off })).levels.gluten)
})

test('the scopes a dish can differ at: each venue, and each link of its that applies there', () => {
  const c = ctx()
  const scopes = dishScopes(c.dishes.get('d-padthai'), c, [SOHO, LEEDS])
  assert.deepEqual(scopes, [
    { venue_id: SOHO, revenue_stream_id: null, order_type_id: null }, { venue_id: SOHO, revenue_stream_id: null, order_type_id: TAKE },
    { venue_id: LEEDS, revenue_stream_id: null, order_type_id: null }, { venue_id: LEEDS, revenue_stream_id: null, order_type_id: TAKE },
  ])
  const only = dishScopes(c.dishes.get('d-padthai'), { ...c, links: [...c.links, link('l4', 'd-padthai', 'padthai', { venue_id: LEEDS, order_type_id: 'eat' })] }, [SOHO])
  assert.equal(only.length, 2, 'Leeds\' own link doesn\'t apply at Soho')
  const take = scopeSuggestion('d-padthai', { venue_id: SOHO, order_type_id: TAKE }, c)
  assert.equal(take.recipe.name, 'Pad thai to go', 'the matrix\'s recipe for take out')
  assert.ok(!take.levels.eggs, 'the takeaway version has tofu, not egg')
})

test('the declaration by standard key, through the group\'s tags', () => {
  const tags = [
    { code: 'GL', standard_key: 'gluten', kind: 'allergen' }, { code: 'celery', standard_key: 'celery', kind: 'allergen' },
    { code: 'SE', standard_key: 'sesame', kind: 'allergen' }, { code: 'garlic', standard_key: null, kind: 'allergen' }, { code: 'vegan', standard_key: null, kind: 'dietary' },
  ]
  assert.deepEqual(declaredOf({ dietary: ['GL', 'celery', 'SE', 'garlic', 'vegan'], allergen_levels: { SE: 'may_contain', celery: 'removable' } }, tags),
    { gluten: 'contains', celery: 'removable', sesame: 'may_contain' })
  assert.deepEqual(declaredOf({ dietary: [] }, tags), {})
})

test('the check: the union over every scope against the one declaration; "nothing has it" only when everything is known', () => {
  const c = ctx()
  const dish = c.dishes.get('d-padthai')
  const scopes = dishScopes(dish, c, [SOHO, LEEDS])
  const results = scopes.map(s => scopeSuggestion(dish.id, s, c))
  const declared = { gluten: 'contains', eggs: 'contains', molluscs: 'may_contain', celery: 'contains', fish: 'contains', crustaceans: 'removable' }
  const check = dishCheck(dish, results, declared, names)
  assert.equal(check.checkable, true)
  assert.equal(check.complete, false, 'tamarind is unknown')
  const byKey = Object.fromEntries(check.differences.map(d => [d.allergen, d]))
  assert.deepEqual(Object.keys(byKey).sort(), ['molluscs', 'sesame', 'soya'])
  assert.equal(byKey.soya.kind, 'missing')
  assert.equal(byKey.soya.text, 'The recipe has soya; the dish does not say so')
  // The same line through the same product at several scopes is one line of evidence with all their places.
  const brakesOyster = byKey.soya.evidence.filter(e => e.quote_id === 'q-oyster-brakes' && e.via[0] === 'Pad thai')
  assert.equal(brakesOyster.length, 1)
  assert.deepEqual(brakesOyster[0].where, ['Soho'])
  const prawnLines = dishCheck(dish, results, { gluten: 'contains' }, names).differences.find(d => d.allergen === 'crustaceans').evidence
  assert.equal(prawnLines.length, 1, 'the option adds the same prawns at every scope: one line')
  assert.equal(prawnLines[0].where.length, 4)
  assert.ok(byKey.soya.evidence.some(e => e.item === 'Tofu'), 'the takeaway version\'s tofu')
  assert.equal(byKey.sesame.kind, 'missing_may')
  assert.deepEqual(byKey.sesame.where, ['Leeds', 'Take out at Leeds'], 'only Leeds\' supplier has it')
  assert.equal(byKey.molluscs.kind, 'weaker')
  assert.ok(!byKey.celery, 'celery isn\'t said while a product is unknown')
  assert.ok(!byKey.crustaceans, 'removable counts as declared')
  assert.ok(check.gaps.some(g => g.reason === 'unknown'))
  assert.ok(check.groups.length >= 3, 'Soho, Leeds and the takeaway version suggest different things')
  // Everything known: the declared celery nothing has is said.
  const q = baseQuotes()
  q.set('tamarind', [quote('q-tamarind', 'tamarind', 'Brakes', {})])
  const c2 = ctx({ quotes: q })
  const full = dishCheck(dish, scopes.map(s => scopeSuggestion(dish.id, s, c2)), { ...declared, soya: 'contains', sesame: 'may_contain', molluscs: 'contains' }, names)
  assert.equal(full.complete, true)
  assert.deepEqual(full.differences.map(d => [d.allergen, d.kind]), [['celery', 'not_found']])
  assert.equal(full.differences[0].text, 'The dish declares celery; nothing in the recipe has it')
  // Declared contains where only "may contain" is in it.
  const may = dishCheck(dish, scopes.map(s => scopeSuggestion(dish.id, s, c2)), { gluten: 'contains', eggs: 'contains', molluscs: 'contains', fish: 'contains', crustaceans: 'contains', soya: 'contains', sesame: 'contains' }, names)
  assert.deepEqual(may.differences.map(d => [d.allergen, d.kind]), [['sesame', 'stronger']])
  // No recipe anywhere: nothing to check, no differences.
  const none = dishCheck(c.dishes.get('d-norecipe'), [scopeSuggestion('d-norecipe', { venue_id: SOHO }, c)], { celery: 'contains' }, names)
  assert.equal(none.checkable, false)
  assert.deepEqual(none.differences, [])
  assert.ok(!checksDish(c.dishes.get('d-deal')), 'a meal deal\'s allergens are its dishes\'')
  assert.ok(!checksDish(c.dishes.get('d-candle')), 'goods have no allergens')
  assert.ok(checksDish(dish))
})

test('a decision holds while the differences are the same; accepting gives the new declaration', () => {
  const diffs = [{ allergen: 'soya', kind: 'missing', suggested: 'contains', declared: null }, { allergen: 'celery', kind: 'not_found', suggested: null, declared: 'contains' }]
  const fp = fingerprint(diffs)
  assert.equal(fp, fingerprint([...diffs].reverse()), 'order doesn\'t matter')
  const check = { checkable: true, differences: diffs }
  assert.deepEqual(nextCheck(null, check), { op: 'insert', status: 'open', reopened: false })
  assert.deepEqual(nextCheck({ status: 'open', fingerprint: '' }, check), { op: 'update', status: 'open', reopened: false })
  assert.deepEqual(nextCheck({ status: 'dismissed', fingerprint: fp }, check), { op: 'update', status: 'dismissed', reopened: false }, 'a dismissal holds')
  assert.deepEqual(nextCheck({ status: 'dismissed', fingerprint: fp }, { checkable: true, differences: [diffs[0], { ...diffs[1], allergen: 'mustard' }] }),
    { op: 'update', status: 'open', reopened: true }, 'until the differences change')
  assert.deepEqual(nextCheck({ status: 'accepted', fingerprint: '' }, check), { op: 'update', status: 'open', reopened: true }, 'accepted, and different again')
  assert.deepEqual(nextCheck({ status: 'accepted', fingerprint: fp }, { checkable: true, differences: [] }), { op: 'update', status: 'accepted', reopened: false }, 'the record of who accepted stays')
  assert.deepEqual(nextCheck({ status: 'open', fingerprint: fp }, { checkable: true, differences: [] }), { op: 'delete', status: null, reopened: false })
  assert.deepEqual(nextCheck({ status: 'dismissed', fingerprint: fp }, { checkable: false, differences: [] }), { op: 'delete', status: null, reopened: false })
  assert.deepEqual(nextCheck(null, { checkable: true, differences: [] }), { op: 'none', status: null, reopened: false })
  assert.deepEqual(acceptedLevels({ celery: 'contains' }, diffs), { soya: 'contains', celery: null })
  assert.deepEqual(acceptedLevels({}, diffs, ['soya']), { soya: 'contains' }, 'only the allergens named')
  assert.deepEqual(acceptedLevels({ sesame: 'contains' }, [{ allergen: 'sesame', kind: 'stronger' }, { allergen: 'milk', kind: 'missing_may' }, { allergen: 'gluten', kind: 'weaker' }]),
    { sesame: 'may_contain', milk: 'may_contain', gluten: 'contains' })
  assert.deepEqual(checkCounts([{ checkable: true, status: 'open' }, { checkable: true, status: null }, { checkable: false }, { checkable: true, status: 'dismissed' }]),
    { open: 1, accepted: 0, dismissed: 1, agree: 1, not_checkable: 1 })
})

test('a recipe\'s own suggestion (the recipe editor), a draft Pepper read in marked as not checked', () => {
  const c = ctx()
  const sauce = c.recipes.get('sauce')
  const s = recipeSuggestion(sauce, SOHO, c)
  assert.deepEqual(keys(s.levels), ['fish', 'gluten', 'molluscs', 'soya'])
  assert.equal(s.complete, false)
  assert.equal(s.gaps[0].reason, 'unknown')
  const l = recipeSuggestion(sauce, LEEDS, c)
  assert.equal(l.levels.sesame, 'may_contain')
  const r = recipes()
  r.set('sauce', { ...r.get('sauce'), status: 'draft', source: 'reader' })
  const d = recipeSuggestion(c.recipes.get('padthai'), SOHO, ctx({ recipes: r }))
  assert.ok(d.gaps.some(g => g.reason === 'draft' && /Pad thai sauce is a draft read in by Pepper, not checked yet/.test(g.text)))
})

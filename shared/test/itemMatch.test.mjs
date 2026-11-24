// shared/itemMatch.js: matching another till's items, variants and modifier
// options to our dishes and options (codes first, then names, price and
// category breaking ties).
import test from 'node:test'
import assert from 'node:assert/strict'
import { nameScore, rankDishes, AUTO_MATCH, normCode, matchIndex, matchThing } from '../itemMatch.js'
import * as deliveroo from '../deliveroo.js'

const options = [
  { id: 'o-reg', group_id: 'g-size', group_name: 'Size', label: 'Regular', price_pence: 0 },
  { id: 'o-lrg', group_id: 'g-size', group_name: 'Size', label: 'Large', price_pence: 50 },
  { id: 'o-oat', group_id: 'g-milk', group_name: 'Milk', label: 'Oat', price_pence: 40 },
  { id: 'o-shot', group_id: 'g-x', group_name: 'Extras', label: 'Extra shot', price_pence: 60 },
]
const dishes = [
  { id: 'd-fw', name: 'Flat white', kind: 'dish', price_pence: 300, sku: 'FW', section: 'Coffee', group_ids: ['g-size', 'g-milk'],
    option_codes: [{ option_id: 'o-lrg', sku: 'FW-L', barcode: null }], option_prices: { 'o-lrg': 70 } },
  { id: 'd-latte', name: 'Latte', kind: 'dish', price_pence: 320, sku: null, barcode: '5000112637922', section: 'Coffee', group_ids: ['g-size'] },
  { id: 'd-cola', name: 'Cola', kind: 'dish', price_pence: 200, section: 'Soft drinks', group_ids: [] },
  { id: 'd-cola2', name: 'Cola', kind: 'dish', price_pence: 250, section: 'Bottles', group_ids: [] },
  { id: 'd-deal', name: 'Coffee deal', kind: 'combo', price_pence: 500, section: 'Deals', group_ids: [] },
]
const idx = matchIndex({ dishes, options })

test('the matcher lives in one place: Deliveroo uses the same functions', () => {
  assert.equal(deliveroo.nameScore, nameScore)
  assert.equal(deliveroo.rankDishes, rankDishes)
  assert.equal(deliveroo.AUTO_MATCH, AUTO_MATCH)
  assert.equal(normCode(' fw-l '), 'FW-L')
})

test('a code beats a name: the SKU finds the dish, even under another name', () => {
  const m = matchThing({ kind: 'item', name: 'Totally different', values: [], sku: 'fw' }, idx)
  assert.equal(m.best.by, 'code')
  assert.equal(m.best.target.item_id, 'd-fw')
  assert.equal(m.best.score, 1)
  assert.ok(m.auto)
  assert.match(m.best.reason, /Same code/)
  // A barcode too.
  assert.equal(matchThing({ kind: 'item', name: 'x', barcode: '5000112637922' }, idx).best.target.item_id, 'd-latte')
  // Code first even where a name also matches exactly.
  const both = matchThing({ kind: 'item', name: 'Latte', sku: 'FW' }, idx)
  assert.deepEqual([both.best.by, both.best.target.item_id], ['code', 'd-fw'])
})

test('a variant\'s code on one of a dish\'s options gives the dish and that option', () => {
  const m = matchThing({ kind: 'variant', name: 'Flat white', values: ['Large'], sku: 'FW-L' }, idx)
  assert.deepEqual(m.best.target, { item_id: 'd-fw', combo_id: null, option_ids: ['o-lrg'] })
  assert.equal(m.best.label, 'Flat white + Size: Large')
})

test('a variant by name: the dish with our options for its values', () => {
  const m = matchThing({ kind: 'variant', name: 'Flat White', values: ['Large', 'Oat'], price_pence: 410 }, idx)
  assert.deepEqual(m.best.target, { item_id: 'd-fw', combo_id: null, option_ids: ['o-lrg', 'o-oat'] })
  assert.equal(m.best.by, 'name')
  assert.ok(m.auto)
  assert.match(m.best.reason, /Large → Size: Large/)
  assert.match(m.best.reason, /same price £4\.10/, 'the dish\'s own price for Large (70) + Oat (40)')
  // Values with no option on the dish: a weaker match on the dish alone, not ticked.
  const w = matchThing({ kind: 'variant', name: 'Flat white', values: ['Huge'] }, idx)
  assert.equal(w.best.target.item_id, 'd-fw')
  assert.ok(w.best.score < AUTO_MATCH)
  assert.equal(w.auto, false)
})

test('a tie is broken by price, then category; an unbroken tie is not ticked', () => {
  const byPrice = matchThing({ kind: 'item', name: 'Cola', price_pence: 250 }, idx)
  assert.equal(byPrice.best.target.item_id, 'd-cola2')
  assert.ok(byPrice.auto)
  const byCategory = matchThing({ kind: 'item', name: 'Cola', category: 'Soft drinks' }, idx)
  assert.equal(byCategory.best.target.item_id, 'd-cola')
  assert.ok(byCategory.auto)
  const tied = matchThing({ kind: 'item', name: 'Cola' }, idx)
  assert.equal(tied.best.score, 1)
  assert.equal(tied.auto, false)
})

test('a modifier option matches our options, or a dish sold as a side; a combo stays a combo', () => {
  const m = matchThing({ kind: 'option', name: 'Extra shot' }, idx)
  assert.deepEqual(m.best.target, { item_id: null, combo_id: null, option_ids: ['o-shot'] })
  const side = matchThing({ kind: 'option', name: 'Latte' }, idx)
  assert.equal(side.best.target.item_id, 'd-latte')
  const deal = matchThing({ kind: 'item', name: 'Coffee Deal' }, idx)
  assert.deepEqual(deal.best.target, { item_id: null, combo_id: 'd-deal', option_ids: [] })
  assert.equal(matchThing({ kind: 'item', name: 'Banana bread' }, idx).best, null)
})

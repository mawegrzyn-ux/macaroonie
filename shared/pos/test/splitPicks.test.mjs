// More picks, more dishes (shared/pos/pricing.js splitPicks): a till
// layout's Dish choices zone lets a choice that takes one pick take more,
// each pick its own dish. Also: a till's dishes follow the menu's option
// display settings (posChoices with variant_rules).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitPicks, splitsPicks, posChoices, priceItem, lineGross } from '../pricing.js'

const choice = (key, name, ids, extra = {}) => ({
  key, name, mode: 'base', min: 1, max: 1, repeat: false, prefixes: false,
  options: ids.map(id => ({ id, label: id, price_pence: null })), ...extra,
})
const protein = choice('p', 'Protein', ['chicken', 'prawn', 'tofu'])
const spice = choice('s', 'Spice', ['mild', 'hot'])
const extras = choice('x', 'Extras', ['egg', 'peanuts'], { mode: 'extra', min: 0, max: 2 })

test('which choices can take more picks', () => {
  assert.equal(splitsPicks(protein), true)
  assert.equal(splitsPicks(extras), false, 'takes more than one already')
  assert.equal(splitsPicks({ ...protein, repeat: true }), false)
  assert.equal(splitsPicks({ ...protein, prefixes: true }), false, 'No / Light / Extra groups don\'t')
  assert.equal(splitsPicks(null), false)
})

test('one pick each: the selection itself', () => {
  const sel = { choices: { p: [{ id: 'chicken' }], s: ['mild'] } }
  const r = splitPicks([protein, spice, extras], sel)
  assert.equal(r.ok, true)
  assert.deepEqual(r.selections, [sel])
  assert.deepEqual(splitPicks([protein], {}).selections, [{}])
})

test('two proteins: two dishes, the rest on both', () => {
  const sel = { choices: { p: [{ id: 'chicken' }, { id: 'prawn' }], s: [{ id: 'hot' }], x: [{ id: 'egg' }, { id: 'peanuts' }] }, combo: undefined }
  const r = splitPicks([protein, spice, extras], sel)
  assert.equal(r.ok, true)
  assert.deepEqual(r.selections.map(x => x.choices.p), [[{ id: 'chicken' }], [{ id: 'prawn' }]])
  for (const x of r.selections) {
    assert.deepEqual(x.choices.s, [{ id: 'hot' }], 'picked once: on every dish')
    assert.deepEqual(x.choices.x, [{ id: 'egg' }, { id: 'peanuts' }], 'a group taking more: on every dish')
  }
  // The same option twice: two of the same dish.
  const twice = splitPicks([protein], { choices: { p: ['chicken', 'chicken', 'tofu'] } })
  assert.deepEqual(twice.selections.map(x => x.choices.p[0].id), ['chicken', 'chicken', 'tofu'])
})

test('two choices picked more than once pair up, or must match', () => {
  const r = splitPicks([protein, spice], { choices: { p: ['chicken', 'prawn'], s: ['mild', 'hot'] } })
  assert.deepEqual(r.selections.map(x => x.choices.p[0].id + '/' + x.choices.s[0].id), ['chicken/mild', 'prawn/hot'])
  const bad = splitPicks([protein, spice], { choices: { p: ['chicken', 'prawn', 'tofu'], s: ['mild', 'hot'] } })
  assert.equal(bad.ok, false)
  assert.match(bad.error, /Spice: pick 3/)
})

test('each dish prices on its own', () => {
  const item = {
    id: 'pad', name: 'Pad Thai', price_pence: 900, kind: 'dish',
    variants: [], variant_groups: [{ group_id: 'p', name: 'Protein', price_mode: 'extra', min_select: 1, max_select: 1, options: [
      { option_id: 'chicken', label: 'Chicken', price_pence: 0 }, { option_id: 'prawn', label: 'Prawn', price_pence: 200 },
    ] }],
  }
  item.pos_choices = posChoices(item)
  const sel = { choices: { p: [{ id: 'chicken' }, { id: 'prawn' }] } }
  assert.equal(priceItem(item, sel).ok, false, 'as one dish it is too many')
  const r = splitPicks(item.pos_choices, sel)
  const prices = r.selections.map(x => priceItem(item, x))
  assert.ok(prices.every(p => p.ok))
  // The prawn's extra charge is on its modifier, so each line's total differs.
  assert.deepEqual(prices.map(p => lineGross({ ...p, qty: 1 })), [900, 1100])
})

test('a till follows the menu\'s option display settings (variant_rules)', () => {
  const item = { id: 'd', name: 'Soup', price_pence: 500, variants: [{ label: 'Small', price_pence: 0 }, { label: 'Large', price_pence: 700 }], variant_groups: [] }
  assert.deepEqual(posChoices(item)[0].options.map(o => o.label), ['Small', 'Large'], 'no rules: every option')
  const hidden = posChoices({ ...item, variant_rules: { hideUnpriced: true, hideZeroPrice: false } })
  assert.deepEqual(hidden[0].options.map(o => o.label), ['Large'], 'unpriced options left out')
  const zero = posChoices({ ...item, variant_rules: { hideUnpriced: false, hideZeroPrice: true } })
  assert.deepEqual(zero[0].options.map(o => o.label), ['Small', 'Large'])
  assert.equal(zero[0].hide_zero_price, true, '£0 options keep their name, show no price')
})

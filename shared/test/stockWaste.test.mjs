// Waste and transfers (inventory phase 4b, docs/INVENTORY.md 6.3, 6.4): what
// a wasted thing is in items (itemsOf() in shared/stockItems.js over
// dishCost()'s lines), what may be done to an entry, waste added up, the
// reason a till void counts under, and a transfer line's moves into
// stockOnHand() at both venues.
import test from 'node:test'
import assert from 'node:assert/strict'
import { itemsOf } from '../stockItems.js'
import {
  wasteUndo, wasteTotals, voidReason, transferLineMoves, lostInTransit, stockOnHand, runningBalance, asSentEntry, entriesToBase,
  MOVE_KINDS, WASTE_KINDS, WASTE_REASON_SEEDS,
} from '../stock.js'
import { pageLink } from '../nav/links.js'
import { NAV_KEYWORDS, NAV_DESCRIPTIONS } from '../nav/index.js'
import { objects } from '../registry/stock.js'
import { openLink } from '../registry/index.js'

const item = (id, name, base_unit = 'g', extra = {}) => ({ id, name, base_unit, yield_pct: 100, units: [], ...extra })
const recipe = (id, name, lines, extra = {}) => ({
  id, name, kind: 'dish', portions: 1, status: 'live', variant_of: null,
  lines: lines.map((l, i) => ({ id: id + '-' + i, sort_order: i, yield_pct: null, ...l })), ...extra,
})

function ctxOf() {
  const items = new Map([
    ['beef', item('beef', 'Beef patty', 'each')],
    ['bun', item('bun', 'Brioche bun', 'each')],
    ['onion', item('onion', 'Red onion', 'g', { yield_pct: 80 })],
    ['cheese', item('cheese', 'Cheddar', 'g', { units: [{ name: 'slice', base_qty: 20 }] })],
    ['potato', item('potato', 'Potatoes', 'g', { yield_pct: 75 })],
  ])
  const relish = recipe('relish', 'Onion relish', [{ item_id: 'onion', qty: 800, unit: 'g' }], { kind: 'prep', portions: null, yield_qty: 1, yield_unit: 'kg', loss_pct: 20 })
  const burger = recipe('burger', 'Burger', [
    { item_id: 'beef', qty: 1, unit: 'each' }, { item_id: 'bun', qty: 1, unit: 'each' },
    { item_id: 'onion', qty: 20, unit: 'g' }, { sub_recipe_id: 'relish', qty: 40, unit: 'g' },
  ])
  const fries = recipe('fries', 'Fries', [{ item_id: 'potato', qty: 150, unit: 'g' }])
  const read = recipe('read', 'Wings read in', [{ item_id: 'beef', qty: 2, unit: 'each' }], { status: 'draft', source: 'reader' })
  const recipes = new Map([['relish', relish], ['burger', burger], ['fries', fries], ['read', read]])
  const links = [
    { id: 'l1', dish_id: 'd-burger', recipe_id: 'burger', portions: 1 },
    { id: 'l2', dish_id: 'd-fries', recipe_id: 'fries', portions: 1 },
    { id: 'l3', dish_id: 'd-wings', recipe_id: 'read', portions: 1 },
  ]
  const options = new Map([
    ['o-cheese', { id: 'o-cheese', label: 'Cheese', group: 'Extras', variation_type: 'addition' }],
    ['o-onion', { id: 'o-onion', label: 'Onion', group: 'Take off', variation_type: 'modification' }],
  ])
  const rules = [{ id: 'r1', option_id: 'o-cheese', dish_id: null, action: 'add', item_id: 'cheese', qty: 1, unit: 'slice' }]
  const dishes = new Map([
    ['d-burger', { id: 'd-burger', name: 'Burger', item_type: 'food' }],
    ['d-fries', { id: 'd-fries', name: 'Fries', item_type: 'food' }],
    ['d-wings', { id: 'd-wings', name: 'Wings', item_type: 'food' }],
    ['d-water', { id: 'd-water', name: 'Corkage', item_type: 'service' }],
    ['d-deal', { id: 'd-deal', name: 'Burger meal', item_type: 'food', kind: 'combo', combo: { steps: [{ id: 's1', name: 'Main', min: 1, max: 1, choices: [{ item_id: 'd-burger' }] }, { id: 's2', name: 'Side', min: 1, max: 1, choices: [{ item_id: 'd-fries' }] }] } }],
    ['d-norecipe', { id: 'd-norecipe', name: 'Soup', item_type: 'food' }],
  ])
  return { items, recipes, links, options, rules, dishes, names: {} }
}
const qtys = r => Object.fromEntries(r.items.map(i => [i.item_id, i.qty_base]))

test('an item is itself; a batch through its recipe with its loss and the item\'s yield', () => {
  const ctx = ctxOf()
  assert.deepEqual(itemsOf({ item_id: 'beef', qty_base: 3 }, ctx).items, [{ item_id: 'beef', qty_base: 3 }])
  // The relish makes 800 g (1 kg less 20%) from 800 g of usable onion: 1 kg bought.
  // Half a kilo of it is 500 g usable, 625 g bought.
  const r = itemsOf({ recipe_id: 'relish', qty: 0.5, unit: 'kg' }, ctx)
  assert.deepEqual(qtys(r), { onion: 625 })
  assert.deepEqual(r.recipe, { id: 'relish', name: 'Onion relish' })
  assert.match(itemsOf({ recipe_id: 'relish', qty: 1, unit: 'each' }, ctx).gaps[0], /doesn't fit/)
})

test('a dish through the recipe the matrix picks, with its options; several dishes multiply', () => {
  const ctx = ctxOf()
  // Two burgers: 2 patties, 2 buns, onion 2 x 20 g / 0.8 = 50 g, relish 2 x 40 g = 80 g (100 g bought onion).
  assert.deepEqual(qtys(itemsOf({ dish_id: 'd-burger', qty: 2 }, ctx)), { beef: 2, bun: 2, onion: 150 })
  // With cheese (a slice: 20 g) and No onion: an option with no rule finds its lines by the words of
  // its name (dishCost()), so the raw onion and the Onion relish both come out.
  const opts = itemsOf({ dish_id: 'd-burger', qty: 1, options: [{ option_id: 'o-cheese' }, { option_id: 'o-onion', prefix: 'no' }] }, ctx)
  assert.deepEqual(qtys(opts), { beef: 1, bun: 1, cheese: 20 })
  // A meal deal is its picks, each broken in.
  const deal = itemsOf({ dish_id: 'd-deal', qty: 1, picks: [{ item_id: 'd-burger', modifiers: [] }, { item_id: 'd-fries', modifiers: [] }] }, ctx)
  assert.deepEqual(qtys(deal), { beef: 1, bun: 1, onion: 75, potato: 200 })
  assert.match(itemsOf({ dish_id: 'd-deal', qty: 1 }, ctx).gaps[0], /meal deal: log the dishes/)
})

test('what can\'t be broken in is said, never refused: no recipe, a draft nobody checked, a dish gone; a service has no stock', () => {
  const ctx = ctxOf()
  const none = itemsOf({ dish_id: 'd-norecipe', qty: 1 }, ctx)
  assert.deepEqual(none.items, [])
  assert.match(none.gaps[0], /no recipe/)
  const draft = itemsOf({ dish_id: 'd-wings', qty: 1 }, ctx)
  assert.deepEqual(qtys(draft), { beef: 2 }, 'its lines are taken off all the same')
  assert.match(draft.gaps.join(' '), /not checked yet/)
  assert.match(itemsOf({ dish_id: 'nope', qty: 1 }, ctx).gaps[0], /no menu/)
  assert.deepEqual(itemsOf({ dish_id: 'd-water', qty: 1 }, ctx), { items: [], gaps: [], recipe: null })
  // A line in a unit the item has no size for is named, the rest taken off.
  ctx.recipes.get('fries').lines.push({ id: 'f1', sort_order: 1, item_id: 'cheese', qty: 1, unit: 'tbsp', yield_pct: null })
  const f = itemsOf({ dish_id: 'd-fries', qty: 1 }, ctx)
  assert.deepEqual(qtys(f), { potato: 200 })
  assert.match(f.gaps[0], /Cheddar has no size for a tbsp/)
})

test('undo on its day by whoever logged it or Manage; reverse after it by Manage; never twice', () => {
  const e = { day: '2026-11-27', wasted_by: 'Cook@x' }
  const today = '2026-11-27'
  assert.equal(wasteUndo(e, { today, me: ['cook@x', 'sub|1'], canUse: true }).undo, true, 'any case, any form of the name')
  assert.equal(wasteUndo(e, { today, me: 'chef@x', canUse: true }).undo, false)
  assert.equal(wasteUndo(e, { today, me: 'boss@x', canUse: true, canManage: true }).undo, true)
  assert.equal(wasteUndo(e, { today, me: 'cook@x', canUse: false }).undo, false, 'Use is needed even for one\'s own')
  assert.deepEqual(wasteUndo(e, { today: '2026-11-28', me: 'boss@x', canManage: true }), { undo: false, reverse: true, why: null })
  assert.match(wasteUndo(e, { today: '2026-11-28', me: 'cook@x', canUse: true }).why, /Stock manage can reverse/)
  assert.match(wasteUndo({ ...e, undone_at: 'x' }, { today, me: 'cook@x', canUse: true, canManage: true }).why, /undone/)
  assert.match(wasteUndo({ ...e, reversed: true }, { today: '2026-11-28', canManage: true }).why, /reversed already/)
  assert.match(wasteUndo({ ...e, reverses_id: 'w1' }, { today, canManage: true }).why, /reverses another/)
})

test('waste added up by reason, kind, item and person; quantities only in one unit', () => {
  const rows = [
    { reason: 'Dropped', reason_kind: 'preparation', by: 'a@x', qty: 2, unit: 'each', value: 3, day: '2026-11-27' },
    { reason: 'Out of date', reason_kind: 'spoilage', by: 'b@x', qty: 1, unit: 'kg', value: 5, day: '2026-11-26' },
    { reason: 'Dropped', reason_kind: 'preparation', by: 'a@x', qty: 1, unit: 'kg', value: null, day: '2026-11-27' },
  ]
  const byReason = wasteTotals(rows, 'reason')
  assert.deepEqual(byReason.map(r => [r.label, r.entries, r.qty, r.value, r.unvalued]), [['Out of date', 1, 1, 5, 0], ['Dropped', 2, null, 3, 1]], 'biggest value first; mixed units have no total')
  assert.deepEqual(wasteTotals(rows, 'kind').map(r => [r.key, r.label]), [['spoilage', 'Spoilage'], ['preparation', 'Preparation']])
  assert.deepEqual(wasteTotals(rows, 'person').map(r => [r.label, r.entries]), [['b@x', 1], ['a@x', 2]])
  const items = wasteTotals([{ item_id: 'i', item_name: 'Onion', qty_base: 100, base_unit: 'g', value: 0.1 }, { item_id: 'i', item_name: 'Onion', qty_base: 50, base_unit: 'g', value: 0.05 }], 'item')
  assert.deepEqual(items.map(r => [r.label, r.qty, r.unit, r.value]), [['Onion', 150, 'g', 0.15]])
  assert.equal(WASTE_REASON_SEEDS.length, 9)
  assert.ok(WASTE_REASON_SEEDS.every(r => WASTE_KINDS[r.kind]))
})

test('a reversing entry takes its entry back: a mistake and its reversal are no entries at all', () => {
  const rows = [
    { reason: 'Dropped', reason_kind: 'preparation', by: 'a@x', qty: 2, unit: 'each', value: 3, day: '2026-11-27' },
    { reason: 'Gone off', reason_kind: 'spoilage', by: 'a@x', qty: 1, unit: 'kg', value: 4, day: '2026-11-26' },
    { reason: 'Gone off', reason_kind: 'spoilage', by: 'b@x', qty: -1, unit: 'kg', value: -4, day: '2026-11-26', reverses_id: 'w2' },
  ]
  assert.deepEqual(wasteTotals(rows, 'reason').map(r => [r.label, r.entries, r.value]), [['Dropped', 1, 3]], 'the reversed mistake leaves no row')
  assert.deepEqual(wasteTotals(rows, 'kind').map(r => [r.key, r.entries]), [['preparation', 1]])
  const items = wasteTotals([
    { item_id: 'i', item_name: 'Onion', qty_base: 100, base_unit: 'g', value: 0.1 },
    { item_id: 'i', item_name: 'Onion', qty_base: 100, base_unit: 'g', value: 0.1 },
    { item_id: 'i', item_name: 'Onion', qty_base: -100, base_unit: 'g', value: -0.1, reverses: true },
  ], 'item')
  assert.deepEqual(items.map(r => [r.label, r.entries, r.qty, r.value]), [['Onion', 1, 100, 0.1]])
})

test('received as sent: in the unit it was sent in while its size is the same, else what was sent in the base unit', () => {
  const choices = [{ key: 'g', label: 'g', base_qty: 1 }, { key: 'kg', label: 'kg', base_qty: 1000 }, { key: 'tray', label: 'tray', base_qty: 2500 }]
  const line = { qty: 2, unit: 'tray', qty_base: 5000, base_unit: 'g' }
  assert.deepEqual(asSentEntry(line, choices), { qty: 2, unit: 'tray' })
  // The tray is 3 kg now: 2 trays would read 6 kg, a gain nobody reported.
  const bigger = choices.map(c => (c.key === 'tray' ? { ...c, base_qty: 3000 } : c))
  const e = asSentEntry(line, bigger)
  assert.deepEqual(e, { qty: 5000, unit: 'g' })
  assert.equal(lostInTransit(line.qty_base, entriesToBase([e], bigger).qty_base), 0)
  assert.deepEqual(asSentEntry({ ...line, unit: 'crate' }, choices), { qty: 5000, unit: 'g' }, 'a unit it no longer has')
})

test('the Stock page opens at its Waste and Transfers tabs, and is found by their words', () => {
  assert.equal(pageLink('/stock', { tab: 'waste' }), '/stock?tab=waste')
  assert.equal(pageLink('/stock', { tab: 'transfers' }), '/stock?tab=transfers')
  for (const key of ['stock.waste', 'stock.transfers']) {
    const o = objects.find(x => x.key === key)
    assert.match(openLink(o, { tab: key === 'stock.waste' ? 'waste' : 'transfers' }), /\?tab=(waste|transfers)$/, key + ' opens at its tab')
  }
  for (const w of ['waste', 'wastage', 'spoilage', 'transfer', 'in transit']) assert.ok(NAV_KEYWORDS['/stock'].includes(w), w)
  assert.match(NAV_DESCRIPTIONS['/stock'], /waste/)
  assert.match(NAV_DESCRIPTIONS['/stock'], /transfers/)
})

test('a till void counts under the group\'s reason of its name, else its own words as preparation', () => {
  const reasons = [{ id: 'r1', name: 'Sent back by a guest', kind: 'plate' }]
  assert.deepEqual(voidReason(' sent back by a GUEST ', reasons), { reason_id: 'r1', reason: 'Sent back by a guest', kind: 'plate' })
  assert.deepEqual(voidReason('Wrong table', reasons), { reason_id: null, reason: 'Wrong table', kind: 'preparation' })
  assert.equal(voidReason('', reasons).reason, 'Voided on the till')
})

test('a transfer at both venues: in transit, received short, cancelled after a count at the sender', () => {
  assert.ok(['waste', 'transfer_out', 'transfer_in', 'lost_in_transit'].every(k => MOVE_KINDS[k] && !MOVE_KINDS[k].sets))
  const base = { id: 't1', number: 7, from_venue_id: 'S', to_venue_id: 'L', from_name: 'Soho', to_name: 'Leeds', sent_at: '2026-11-20T10:00:00Z', sent_by: 'a@x' }
  const line = { item_id: 'i', qty_base: 2000, received_base: null, cost_per_base: 0.01 }
  const counts = [{ venue_id: 'S', kind: 'count', qty_base: 5000, at: '2026-11-19T10:00:00Z' }, { venue_id: 'L', kind: 'count', qty_base: 1000, at: '2026-11-19T10:00:00Z' }]
  const at = (moves, v) => stockOnHand({ moves: moves.filter(m => m.venue_id === v) }).on_hand
  const transit = [...counts, ...transferLineMoves({ ...base, status: 'sent' }, line)]
  assert.deepEqual([at(transit, 'S'), at(transit, 'L')], [3000, 1000], 'it left Soho; Leeds hasn\'t it yet')
  const got = [...counts, ...transferLineMoves({ ...base, status: 'received', received_at: '2026-11-20T16:00:00Z', received_by: 'b@x' }, { ...line, received_base: 1800 })]
  assert.deepEqual([at(got, 'S'), at(got, 'L')], [3000, 2800], 'Soho still lost all of it; Leeds has what arrived')
  const lostMove = got.find(m => m.kind === 'lost_in_transit')
  assert.deepEqual([lostMove.venue_id, lostMove.qty_base, lostMove.cost_per_base], ['S', -200, 0.01])
  assert.match(lostMove.source.label, /^Transfer 7 to Leeds: didn't arrive/)
  // Cancelled after Soho counted 3 kg on the shelf: it comes back on top of that count.
  const cancelled = [...counts, { venue_id: 'S', kind: 'count', qty_base: 3000, at: '2026-11-20T12:00:00Z' },
    ...transferLineMoves({ ...base, status: 'cancelled', cancelled_at: '2026-11-20T13:00:00Z' }, line)]
  assert.equal(at(cancelled, 'S'), 5000)
  assert.deepEqual(runningBalance(cancelled.filter(m => m.venue_id === 'S')).map(m => [m.kind, m.change]), [['count', null], ['transfer_out', -2000], ['count', 0], ['transfer_in', 2000]])
  assert.equal(lostInTransit(2000, null), 0, 'nothing is lost before it is received')
  assert.equal(lostInTransit(2000, 2500), 0)
  // A count's figures as on hand counts them: waste and transfers since are kept apart.
  const r = stockOnHand({ moves: [...got.filter(m => m.venue_id === 'S'), { kind: 'waste', qty_base: -100, at: '2026-11-21T09:00:00Z' }] })
  assert.deepEqual([r.on_hand, r.wasted_since, r.transferred_since], [2900, -100, -2000])
})

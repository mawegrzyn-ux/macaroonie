// shared/itemMapping.js: what another till's lines are on our menus. Exact
// item and variant rules, a variant to a dish plus options, variant and
// modifier axes, a combination to a combo, ignore and keep, venue before
// connection, effective_from, the SKU and name fallback, allocation adding up
// to the line, and the page's catalogue states from the same rules.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mapCheck, normaliseRule, ruleKey, catalogContext, ourContext, catalogState } from '../itemMapping.js'

const V = 'venue-1', W = 'venue-2'
const cat = catalogContext([
  { kind: 'item', external_id: 'it-coffee', attrs: { option1_name: 'Size', option2_name: 'Milk' } },
  { kind: 'variant', external_id: 'var-lrg-oat', parent_ref: 'it-coffee', attrs: { option1_value: 'Large', option2_value: 'Oat' } },
  { kind: 'variant', external_id: 'var-reg-dairy', parent_ref: 'it-coffee', attrs: { option1_value: 'Regular', option2_value: 'Dairy' } },
  { kind: 'item', external_id: 'it-burger', attrs: {} },
  { kind: 'item', external_id: 'it-card', attrs: {} },
  { kind: 'modifier', external_id: 'mod-extras', attrs: {} },
  { kind: 'modifier_option', external_id: 'opt-shot', parent_ref: 'mod-extras', attrs: {} },
  { kind: 'modifier_option', external_id: 'opt-syrup', parent_ref: 'mod-extras', attrs: {} },
  { kind: 'modifier_option', external_id: 'opt-meal', parent_ref: 'mod-meal', attrs: {} },
  { kind: 'modifier_option', external_id: 'opt-noonion', parent_ref: 'mod-notes', attrs: {} },
])
const ours = ourContext({
  items: [{ id: 'd-fw', price_pence: 300 }, { id: 'd-burger', price_pence: 900 }, { id: 'c-meal', price_pence: 1200, kind: 'combo' },
    { id: 'd-cookie', price_pence: 150 }, { id: 'd-fries', price_pence: 300 }],
  options: [{ id: 'o-large', group_id: 'g-size', price_pence: 50 }, { id: 'o-reg', group_id: 'g-size', price_pence: 0 },
    { id: 'o-oat', group_id: 'g-milk', price_pence: 40 }, { id: 'o-dairy', group_id: 'g-milk', price_pence: 0 },
    { id: 'o-shot', group_id: 'g-extra', price_pence: 60 }],
  itemOptionPrices: [{ item_id: 'd-fw', option_id: 'o-large', price_pence: 70 }],
})
const ctx = { catalog: cat, ours }
const R = (id, r) => normaliseRule({ id, effective_from: '2026-01-01', venue_id: null, ...r })

const coffee = (extra = {}) => ({ id: 'l1', line_kind: 'item', parent_id: null, item_ref: 'it-coffee', variant_ref: 'var-lrg-oat',
  sku: 'FW-L-O', name: 'Flat white', variant_name: 'Large / Oat', qty: 2, net_pence: 666, ...extra })
const shot = { id: 'l2', line_kind: 'modifier', parent_id: 'l1', option_ref: 'opt-shot', name: 'Extra shot', qty: 2, net_pence: 100 }
const run = (lines, rules, { venue = V, date = '2026-06-01' } = {}) => mapCheck({ venue_id: venue, business_date: date, lines }, rules, ctx)
const sum = parts => parts.reduce((s, p) => s + p.net_pence, 0)

test('an exact item rule maps every variant to the dish; a modifier with no rule stays a note', () => {
  const [item, mod] = run([coffee(), shot], [R('r1', { kind: 'exact', item_ref: 'it-coffee', target_item_id: 'd-fw' })])
  assert.equal(item.state, 'mapped')
  assert.equal(item.item_id, 'd-fw')
  assert.equal(item.rule_id, 'r1')
  assert.equal(item.allocated_net_pence, 666)
  assert.deepEqual(item.parts.map(p => [p.role, p.item_id, p.net_pence]), [['main', 'd-fw', 666]])
  assert.equal(mod.state, 'note')
})

test('a variant to a dish plus options; the dish\'s own option price weighs; parts add up', () => {
  const rules = [
    R('r1', { kind: 'exact', item_ref: 'it-coffee', target_item_id: 'd-burger' }),
    R('r2', { kind: 'exact', item_ref: 'it-coffee', variant_ref: 'var-lrg-oat', target_item_id: 'd-fw', target_option_ids: ['o-large', 'o-oat'] }),
  ]
  const [item] = run([coffee()], rules)
  assert.equal(item.rule_id, 'r2', 'the variant rule beats the item rule')
  assert.deepEqual(item.parts.map(p => [p.role, p.item_id || p.option_id]), [['main', 'd-fw'], ['option', 'o-large'], ['option', 'o-oat']])
  // 300 : 70 (the dish's own Large price) : 40 of 666, the remainder on the dish.
  const large = Math.trunc(666 * 70 / 410), oat = Math.trunc(666 * 40 / 410)
  assert.deepEqual(item.parts.map(p => p.net_pence), [666 - large - oat, large, oat])
  assert.equal(sum(item.parts), 666)
  const [other] = run([coffee({ variant_ref: 'var-reg-dairy', variant_name: 'Regular / Dairy' })], rules)
  assert.equal(other.rule_id, 'r1', 'another variant falls back to the item rule')
})

test('axis rules add options by the variant\'s values and by a modifier group, after the dish is known', () => {
  const rules = [
    R('r1', { kind: 'exact', item_ref: 'it-coffee', target_item_id: 'd-fw' }),
    R('a1', { kind: 'axis', axis_kind: 'variant', axis_name: 'size', target_group_id: 'g-size', axis_values: [{ from: 'Large', option_id: 'o-large' }, { from: 'Regular', option_id: 'o-reg' }] }),
    R('a2', { kind: 'axis', axis_kind: 'variant', axis_name: 'Milk', target_group_id: 'g-milk', axis_values: [{ from: 'Oat', option_id: 'o-oat' }] }),
    R('a3', { kind: 'axis', axis_kind: 'modifier', axis_group_ref: 'mod-extras', target_group_id: 'g-extra', axis_values: [{ from: 'opt-shot', option_id: 'o-shot' }] }),
  ]
  const [item, mod] = run([coffee(), shot], rules)
  assert.deepEqual(item.parts.map(p => [p.role, p.item_id || p.option_id, p.rule_id, p.source_line_id]),
    [['main', 'd-fw', 'r1', null], ['option', 'o-large', 'a1', null], ['option', 'o-oat', 'a2', null], ['option', 'o-shot', 'a3', 'l2']])
  assert.equal(sum(item.parts), 666)
  assert.equal(mod.state, 'mapped')
  assert.equal(mod.option_id, 'o-shot')
  assert.equal(mod.allocated_net_pence, item.parts[3].net_pence)
  // A dish rule that already gives a size keeps it: the axis doesn't add a second.
  const withSize = [R('r1', { kind: 'exact', item_ref: 'it-coffee', target_item_id: 'd-fw', target_option_ids: ['o-reg'] }), ...rules.slice(1)]
  const [again] = run([coffee()], withSize)
  assert.deepEqual(again.parts.map(p => p.option_id).filter(Boolean), ['o-reg', 'o-oat'])
  // Without a mapped dish, the axis adds nothing and the item is unmapped.
  const [bare] = run([coffee()], rules.slice(1))
  assert.equal(bare.state, 'unmapped')
  assert.deepEqual(bare.parts, [])
})

test('a combination (item + modifier) becomes a combo; its modifier is part of it, others still map', () => {
  const rules = [
    R('r1', { kind: 'exact', item_ref: 'it-burger', target_item_id: 'd-burger' }),
    R('c1', { kind: 'combination', item_ref: 'it-burger', option_refs: ['opt-meal'], target_combo_id: 'c-meal' }),
    R('r3', { kind: 'exact', option_ref: 'opt-shot', target_item_id: 'd-fries' }),
  ]
  const lines = [
    { id: 'b', line_kind: 'item', item_ref: 'it-burger', name: 'Burger', qty: 1, net_pence: 1500 },
    { id: 'm', line_kind: 'modifier', parent_id: 'b', option_ref: 'opt-meal', name: 'Make it a meal', qty: 1, net_pence: 300 },
    { id: 's', line_kind: 'modifier', parent_id: 'b', option_ref: 'opt-shot', name: 'Fries', qty: 1, net_pence: 0 },
  ]
  const [b, m, s] = run(lines, rules)
  assert.equal(b.rule_id, 'c1')
  assert.equal(b.combo_id, 'c-meal')
  assert.equal(b.item_id, null)
  assert.equal(m.state, 'in_combo')
  assert.equal(s.state, 'mapped')
  assert.equal(s.item_id, 'd-fries')
  assert.deepEqual(b.parts.map(p => [p.role, p.combo_id || p.item_id]), [['main', 'c-meal'], ['dish', 'd-fries']])
  assert.equal(sum(b.parts), 1500)
  // Without the meal modifier the plain burger rule applies.
  const [plain] = run([lines[0]], rules)
  assert.equal(plain.rule_id, 'r1')
})

test('ignore and keep; a modifier ignored; venue rules beat connection rules; effective_from', () => {
  const rules = [
    R('i1', { kind: 'ignore', item_ref: 'it-card' }),
    R('k1', { kind: 'keep', item_ref: 'it-burger' }),
    R('v1', { kind: 'exact', item_ref: 'it-burger', venue_id: V, target_item_id: 'd-burger' }),
    R('n1', { kind: 'ignore', option_ref: 'opt-noonion' }),
    R('late', { kind: 'exact', item_ref: 'it-coffee', target_item_id: 'd-fw', effective_from: '2026-07-01' }),
  ]
  const lines = [
    { id: 'c', line_kind: 'item', item_ref: 'it-card', name: 'Gift card', qty: 1, net_pence: 2000 },
    { id: 'b', line_kind: 'item', item_ref: 'it-burger', name: 'Burger', qty: 1, net_pence: 900 },
    { id: 'n', line_kind: 'modifier', parent_id: 'b', option_ref: 'opt-noonion', name: 'No onion', qty: 1, net_pence: 0 },
    coffee({ id: 'f' }),
  ]
  const [c, b, n, f] = run(lines, rules)
  assert.deepEqual([c.state, c.rule_id, c.parts.length], ['ignored', 'i1', 0])
  assert.deepEqual([b.state, b.rule_id, b.item_id], ['mapped', 'v1', 'd-burger'])
  assert.equal(n.state, 'ignored')
  assert.equal(f.state, 'unmapped', 'before its effective_from')
  const [, b2] = run(lines, rules, { venue: W })
  assert.deepEqual([b2.state, b2.rule_id], ['kept', 'k1'], 'the other venue gets the connection rule')
  const [, , , f2] = run(lines, rules, { date: '2026-07-01' })
  assert.equal(f2.rule_id, 'late')
})

test('a rule whose item was made again on the other till matches by SKU, then by name; never when its ref is still there', () => {
  const rules = [R('old', { kind: 'exact', item_ref: 'it-gone', variant_ref: 'var-gone', ext_sku: 'FW-L-O', ext_name: 'Flat white · Large / Oat', target_item_id: 'd-fw' })]
  const [a] = run([coffee({ variant_ref: 'var-new' })], rules)
  assert.equal(a.rule_id, 'old')
  const [b] = run([coffee({ variant_ref: 'var-new', sku: null })], rules)
  assert.equal(b.rule_id, 'old', 'by name')
  const still = [R('live', { kind: 'exact', item_ref: 'it-coffee', variant_ref: 'var-reg-dairy', ext_sku: 'FW-L-O', target_item_id: 'd-fw' })]
  const [c] = run([coffee()], still)
  assert.equal(c.state, 'unmapped', 'var-reg-dairy is still on the till: no SKU fallback')
})

test('a refund allocates its negative net the same way', () => {
  const rules = [R('r2', { kind: 'exact', variant_ref: 'var-lrg-oat', target_item_id: 'd-fw', target_option_ids: ['o-large'] })]
  const [item] = run([coffee({ net_pence: -333 })], rules)
  assert.equal(sum(item.parts), -333)
  assert.ok(item.parts.every(p => p.net_pence <= 0))
})

test('ruleKey: one decision per thing; catalogState matches mapCheck', () => {
  assert.equal(ruleKey({ kind: 'exact', item_ref: 'x' }), ruleKey({ kind: 'ignore', item_ref: 'x' }))
  assert.notEqual(ruleKey({ kind: 'exact', item_ref: 'x' }), ruleKey({ kind: 'exact', item_ref: 'x', variant_ref: 'v' }))
  assert.equal(ruleKey({ kind: 'combination', item_ref: 'x', option_refs: ['b', 'a'] }), ruleKey({ kind: 'combination', item_ref: 'x', option_refs: ['a', 'b', 'a'] }))
  assert.equal(ruleKey({ kind: 'axis', axis_kind: 'variant', axis_name: 'Size' }), ruleKey({ kind: 'axis', axis_kind: 'variant', axis_name: ' size' }))
  const rules = [R('r1', { kind: 'exact', item_ref: 'it-coffee', target_item_id: 'd-fw' }), R('n1', { kind: 'ignore', option_ref: 'opt-noonion' })]
  assert.equal(catalogState({ item_ref: 'it-coffee', variant_ref: 'var-lrg-oat' }, rules, ctx, { venue_id: V, date: '2026-06-01' }).rule_id, 'r1')
  assert.equal(catalogState({ option_ref: 'opt-noonion' }, rules, ctx).state, 'ignored')
  assert.equal(catalogState({ option_ref: 'opt-shot' }, rules, ctx).state, 'note')
  assert.equal(catalogState({ item_ref: 'it-burger' }, rules, ctx).state, 'unmapped')
})

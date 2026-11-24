// shared/itemMapping.js, phase 3 (migration 293): pattern rules and the
// category bucket, their order (after the rules that match by ref, code
// equals > code starts with > name contains > category > bucket, a venue's
// before the connection's), axis options on a pattern's dish, and learning
// (learnOffers()).
import test from 'node:test'
import assert from 'node:assert/strict'
import { mapCheck, normaliseRule, ruleKey, catalogContext, ourContext, learnOffers, LEARN_MIN } from '../itemMapping.js'

const V = 'venue-1'
const cat = catalogContext([
  { kind: 'item', external_id: 'it-water', category_ref: 'cat-cold', attrs: {} },
  { kind: 'variant', external_id: 'var-water', parent_ref: 'it-water', sku: 'BTL-WAT', attrs: { barcode: '5000000000001' } },
  { kind: 'item', external_id: 'it-latte', category_ref: 'cat-hot', attrs: { option1_name: 'Size' } },
  { kind: 'variant', external_id: 'var-latte-l', parent_ref: 'it-latte', sku: 'LAT-L', attrs: { option1_value: 'Large' } },
  { kind: 'item', external_id: 'it-mocha', category_ref: 'cat-hot', attrs: { option1_name: 'Size' } },
  { kind: 'variant', external_id: 'var-mocha-l', parent_ref: 'it-mocha', sku: 'MOC-L', attrs: { option1_value: 'Large' } },
  { kind: 'item', external_id: 'it-fw', category_ref: 'cat-hot', attrs: { option1_name: 'Size', option2_name: 'Milk' } },
  { kind: 'variant', external_id: 'var-fw-lo', parent_ref: 'it-fw', sku: 'FW-L-O', attrs: { option1_value: 'Large', option2_value: 'Oat' } },
  { kind: 'item', external_id: 'it-juice', category_ref: 'cat-cold', attrs: {} },
  { kind: 'variant', external_id: 'var-juice', parent_ref: 'it-juice', sku: 'BTL-JUI', attrs: {} },
  { kind: 'item', external_id: 'it-cola', category_ref: 'cat-cold', attrs: {} },
  { kind: 'variant', external_id: 'var-cola', parent_ref: 'it-cola', sku: 'BTL-COL', attrs: {} },
])
const ours = ourContext({
  items: ['d-a', 'd-b', 'd-c', 'd-d', 'd-e', 'd-exact', 'd-latte'].map(id => ({ id, price_pence: 200 })),
  options: [{ id: 'o-large', group_id: 'g-size', price_pence: 50 }, { id: 'o-oat', group_id: 'g-milk', price_pence: 40 }],
})
const ctx = { catalog: cat, ours }
const R = (id, r) => normaliseRule({ id, effective_from: '2026-01-01', venue_id: null, ...r })
const water = { id: 'l1', line_kind: 'item', parent_id: null, item_ref: 'it-water', variant_ref: 'var-water', sku: 'BTL-WAT',
  name: 'Bottle of water', variant_name: null, qty: 1, net_pence: 120 }
const run = (rules, line = water) => mapCheck({ venue_id: V, business_date: '2026-06-01', lines: [line] }, rules, ctx)[0]
const P = (id, field, op, value, target, extra = {}) => R(id, { kind: 'pattern', pattern_field: field, pattern_op: op, pattern_value: value, target_item_id: target, ...extra })

test('patterns apply most specific first: code equals, code starts with (longer first), name, category, bucket', () => {
  const rules = [
    R('b1', { kind: 'bucket', pattern_value: 'cat-cold', target_section_id: 's-drinks' }),
    P('p1', 'category', 'equals', 'cat-cold', 'd-a'),
    P('p2', 'name', 'contains', 'WATER', 'd-b'),
    P('p3', 'code', 'starts_with', 'btl', 'd-c'),
    P('p4', 'code', 'starts_with', 'BTL-W', 'd-d'),
    P('p5', 'code', 'equals', 'btl-wat', 'd-e'),
  ]
  const order = ['p5', 'p4', 'p3', 'p2', 'p1']
  for (let i = 0; i < order.length; i++) {
    const left = rules.filter(r => !order.slice(0, i).includes(r.id))
    const res = run(left)
    assert.deepEqual([res.state, res.rule_id], ['mapped', order[i]], 'step ' + i)
    assert.equal(res.parts[0].net_pence, 120, 'money unchanged')
  }
  const bucket = run(rules.filter(r => r.id === 'b1'))
  assert.deepEqual([bucket.state, bucket.section_id, bucket.item_id, bucket.parts.length], ['bucket', 's-drinks', null, 0])
  // The barcode counts as a code.
  assert.equal(run([P('pb', 'code', 'equals', '5000000000001', 'd-e')]).rule_id, 'pb')
  // A rule that matches by ref beats every pattern; nothing matching leaves it unmapped.
  assert.equal(run([...rules, R('x', { kind: 'exact', item_ref: 'it-water', target_item_id: 'd-exact' })]).rule_id, 'x')
  assert.equal(run([P('no', 'name', 'contains', 'juice', 'd-b')]).state, 'unmapped')
})

test('a venue\'s pattern beats the connection\'s at the same step; axis rules still add options to a pattern\'s dish', () => {
  const res = run([P('conn', 'name', 'contains', 'water', 'd-a'), P('ven', 'name', 'contains', 'water', 'd-b', { venue_id: V })])
  assert.equal(res.rule_id, 'ven')
  const latte = { ...water, item_ref: 'it-latte', variant_ref: 'var-latte-l', sku: 'LAT-L', name: 'Latte', variant_name: 'Large' }
  const r = run([P('lat', 'code', 'starts_with', 'LAT', 'd-latte'),
    R('ax', { kind: 'axis', axis_kind: 'variant', axis_name: 'Size', target_group_id: 'g-size', axis_values: [{ from: 'Large', option_id: 'o-large' }] })], latte)
  assert.deepEqual(r.parts.map(p => [p.role, p.item_id || p.option_id]), [['main', 'd-latte'], ['option', 'o-large']])
  assert.equal(r.parts.reduce((s, p) => s + p.net_pence, 0), 120)
  assert.equal(ruleKey(P('k', 'name', 'contains', ' Water ', 'd-a')), 'p:name:contains:water')
})

const options = {
  'o-large': { group_id: 'g-size', group_name: 'Size', label: 'Large' },
  'o-oat': { group_id: 'g-milk', group_name: 'Milk', label: 'Oat' },
}
const variantRule = (id, item, variant, opts, extra = {}) => R(id, { kind: 'exact', venue_id: V, item_ref: item, variant_ref: variant, target_item_id: 'd-' + item, target_option_ids: opts, ...extra })

test('learning: three variants named Large mapped to our Large are offered as one axis rule', () => {
  const rules = [variantRule('a', 'it-latte', 'var-latte-l', ['o-large']), variantRule('b', 'it-mocha', 'var-mocha-l', ['o-large']),
    variantRule('c', 'it-fw', 'var-fw-lo', ['o-large', 'o-oat'])]
  assert.equal(LEARN_MIN, 3)
  const offers = learnOffers([rules[2]], rules, cat, options)
  const axis = offers.filter(o => o.kind === 'axis')
  assert.equal(axis.length, 1, 'Oat appears once only: no offer for it')
  assert.deepEqual(axis[0].rule, { kind: 'axis', venue_id: V, axis_kind: 'variant', axis_name: 'Size', item_ref: null, target_group_id: 'g-size',
    axis_values: [{ from: 'Large', option_id: 'o-large' }] })
  assert.equal(axis[0].replaces, null)
  assert.match(axis[0].title, /3 variants with Size Large are mapped to Size: Large/)
  // Two only: nothing. None just added: nothing.
  assert.equal(learnOffers([rules[0]], rules.slice(0, 2), cat, options).length, 0)
  assert.equal(learnOffers([], rules, cat, options).length, 0)
  // An axis rule for Size at that scope already: merged into it (replaces); one that has Large already: no offer.
  const existing = R('ax', { kind: 'axis', venue_id: V, axis_kind: 'variant', axis_name: 'Size', target_group_id: 'g-size', axis_values: [{ from: 'Regular', option_id: 'o-reg' }] })
  const merged = learnOffers([rules[0]], [...rules, existing], cat, options).find(o => o.kind === 'axis')
  assert.equal(merged.replaces, 'ax')
  assert.deepEqual(merged.rule.axis_values.map(v => v.from), ['Regular', 'Large'])
  const done = { ...existing, axis_values: [{ from: 'Large', option_id: 'o-large' }] }
  assert.equal(learnOffers([rules[0]], [...rules, done], cat, options).filter(o => o.kind === 'axis').length, 0)
})

test('learning: three items to the same dish whose codes share a prefix are offered as a code pattern', () => {
  const same = (id, item) => R(id, { kind: 'exact', venue_id: V, item_ref: item, target_item_id: 'd-a' })
  const rules = [same('w', 'it-water'), same('j', 'it-juice'), same('c', 'it-cola')]
  const [offer] = learnOffers([rules[0]], rules, cat, options)
  assert.deepEqual([offer.kind, offer.rule.pattern_field, offer.rule.pattern_op, offer.rule.pattern_value, offer.rule.target_item_id],
    ['pattern', 'code', 'starts_with', 'BTL-', 'd-a'])
  // Already a rule: not offered again.
  const have = P('have', 'code', 'starts_with', 'BTL-', 'd-a', { venue_id: V })
  assert.equal(learnOffers([rules[0]], [...rules, have], cat, options).length, 0)
})

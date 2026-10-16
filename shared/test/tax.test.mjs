import test from 'node:test'
import assert from 'node:assert/strict'
import { taxFor, resolveTaxRateId, taxProblems, ruleWeight, normTax, cleanTax, ratePercent, defaultTaxFor, ruleText } from '../tax.js'

const STD = 'r-std', ZERO = 'r-zero', RED = 'r-red'
const rates = [
  { id: STD, name: 'Standard', rate: 20, is_default: true, values: { ie: 23 } },
  { id: ZERO, name: 'Zero', rate: 0 },
  { id: RED, name: 'Reduced', rate: 5, is_active: false },
]
const EAT = 't-eat', OUT = 't-out', DEL = 't-del'
const LON = 'v-lon', IE = 'ie'
const BAR = 's-bar', REST = 's-rest'

const ctx = (type, stream = null, venue = LON) => ({ venue_id: venue, order_type_id: type, revenue_stream_id: stream })

test('nothing set: the tenant default rate, at the location\'s %', () => {
  assert.deepEqual(pick(taxFor([], ctx(EAT), rates)), { id: STD, pct: 20, from: 'default' })
  assert.equal(taxFor([], ctx(EAT, null, IE), rates).vat_rate, 23)
  assert.equal(defaultTaxFor(ctx(OUT), rates).tax_rate_id, STD)
})

test('dish beats section beats menu', () => {
  const menu = { rate: ZERO }
  const section = { rate: STD }
  assert.equal(taxFor([null, section, menu], ctx(EAT), rates).tax_rate_id, STD)
  assert.equal(taxFor([{ rate: ZERO }, section, menu], ctx(EAT), rates).from, 'dish')
  assert.equal(taxFor([{}, {}, menu], ctx(EAT), rates).from, 'menu')
})

test('cold takeaway: section takes out at zero, a hot dish in it stays standard', () => {
  const sandwiches = { rate: STD, rules: [{ types: [OUT, DEL], rate: ZERO }] }
  assert.equal(taxFor([null, sandwiches], ctx(EAT), rates).tax_rate_id, STD)
  assert.equal(taxFor([null, sandwiches], ctx(OUT), rates).tax_rate_id, ZERO)
  // A dish's own rate beats the section's exception (dish wins over section).
  const toastie = { rate: STD }
  assert.equal(taxFor([toastie, sandwiches], ctx(OUT), rates).tax_rate_id, STD)
})

test('within a setting the closest rule wins: stream 4, type 2, location 1', () => {
  const tax = {
    rate: STD,
    rules: [
      { venues: [LON], rate: ZERO },
      { types: [OUT], rate: RED },
      { streams: [BAR], rate: ZERO },
      { streams: [BAR], types: [OUT], rate: STD },
    ],
  }
  assert.equal(resolveTaxRateId([tax], ctx(EAT, REST), { rates }).rate_id, ZERO)       // location only
  assert.equal(resolveTaxRateId([tax], ctx(OUT, REST), { rates }).rate_id, RED)        // type beats location
  assert.equal(resolveTaxRateId([tax], ctx(EAT, BAR), { rates }).rate_id, ZERO)        // stream beats type
  assert.equal(resolveTaxRateId([tax], ctx(OUT, BAR), { rates }).rate_id, STD)         // stream + type
  assert.equal(resolveTaxRateId([tax], ctx(EAT, null, 'v-x'), { rates }).rate_id, STD) // nothing matches: own rate
})

test('a rule without a rate or a condition, or an unknown rate, is passed over', () => {
  const tax = { rate: STD, rules: [{ types: [OUT], rate: 'gone' }, { rate: ZERO }, { types: [OUT] }] }
  assert.equal(taxFor([tax], ctx(OUT), rates).tax_rate_id, STD)
  assert.equal(taxFor([{ rate: 'gone' }, { rate: ZERO }], ctx(OUT), rates).tax_rate_id, ZERO)
})

test('an inactive rate still resolves for settings that name it', () => {
  assert.equal(taxFor([{ rate: RED }], ctx(EAT), rates).vat_rate, 5)
})

test('weights and normalising', () => {
  assert.equal(ruleWeight({ streams: ['a'], types: ['b'] }), 6)
  assert.equal(ruleWeight({ venues: ['a'] }), 1)
  assert.deepEqual(normTax(null), { rate: null, rules: [] })
  assert.deepEqual(normTax({ rules: [{ types: ['a', 'a', ''], rate: 'x' }] }).rules[0].types, ['a'])
  assert.deepEqual(cleanTax({ rate: STD, rules: [{}, { types: [OUT], rate: ZERO }] }).rules.length, 1)
  assert.equal(ratePercent(null), 20)
})

test('problems: overlap with different rates, missing parts, unknown ids', () => {
  const lookups = { rates, types: [{ id: EAT }, { id: OUT }, { id: DEL }], streams: [{ id: BAR }], venues: [{ id: LON }] }
  assert.deepEqual(taxProblems({ rate: STD, rules: [{ types: [OUT], rate: ZERO }] }, lookups), [])
  // Same kinds, overlapping values, different rates.
  const p = taxProblems({ rules: [{ types: [OUT, DEL], rate: ZERO }, { types: [DEL], rate: STD }] }, lookups)
  assert.equal(p.length, 1)
  assert.match(p[0], /Exceptions 1 and 2/)
  // Same rate: harmless. Different kinds: weights differ, no tie.
  assert.deepEqual(taxProblems({ rules: [{ types: [OUT], rate: ZERO }, { types: [OUT], rate: ZERO }] }, lookups), [])
  assert.deepEqual(taxProblems({ rules: [{ types: [OUT], rate: ZERO }, { streams: [BAR], rate: STD }] }, lookups), [])
  // Disjoint values: no overlap.
  assert.deepEqual(taxProblems({ rules: [{ types: [OUT], rate: ZERO }, { types: [EAT], rate: STD }] }, lookups), [])
  assert.equal(taxProblems({ rules: [{ rate: ZERO }] }, lookups).length, 1)
  assert.equal(taxProblems({ rules: [{ types: [OUT] }] }, lookups).length, 1)
  assert.equal(taxProblems({ rules: [{ venues: [LON], streams: [BAR], rate: ZERO }] }, lookups).length, 1)
  assert.equal(taxProblems({ rate: 'nope', rules: [{ types: ['x'], rate: ZERO }] }, lookups).length, 2)
})

test('rule text', () => {
  const names = { types: { [OUT]: 'Take out', [DEL]: 'Delivery' }, streams: { [BAR]: 'Bar' } }
  assert.equal(ruleText({ types: [OUT, DEL], streams: [BAR] }, names), 'Take out, Delivery at Bar')
  assert.equal(ruleText({ streams: [BAR] }, names), 'Bar')
})

function pick(t) { return { id: t.tax_rate_id, pct: t.vat_rate, from: t.from } }

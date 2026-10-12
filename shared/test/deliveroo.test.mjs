// Deliveroo menu file tests: reading the file, prices, matching dishes,
// filling a row from a dish, row checks, and writing the file back.
// Run: node --test shared/test/deliveroo.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCsv, readSheet, toCsv, priceRule, priceText, pricePence, dishPrice,
  nameScore, matchRow, dishValues, buildRow, rowProblems, defaultMaps, defaultFill,
} from '../deliveroo.js'

const HEADER = 'item_id,item_name,item_description,delivery_price,instore_price,tax_rate,allergens,calories,energy_kcal,hfss,max_quantity,age_restricted,plu'
const FILE = [
  HEADER,
  'tha7148ha8,7up can,,2.2,,20,,,,false,,false,',
  'rlycqzgco,Chu Chi Pla,"Fried white fish, panang sauce and ""lime"" leaves.",15.5,,0,,,,false,,false,',
  'a1,Egg Fried Rice,,4,,20,eggs,,,false,,false,',
  'a2,Fried Egg Noodles,,5,,20,,,,false,,false,',
  'a3,Fried Egg Noodles,,6,,20,,,,false,,false,',
  'a4,Pad Thai (Chicken),Rice noodles,12.95,,20,,,,FALSE,,false,',
].join('\r\n')

const tags = [
  { code: 'eggs', label: 'Eggs', kind: 'allergen', standard_key: 'eggs' },
  { code: 'nuts', label: 'Nuts', kind: 'allergen', standard_key: 'nuts' },
  { code: 'gluten', label: 'Gluten', kind: 'allergen', standard_key: 'gluten' },
  { code: 'v', label: 'Vegetarian', kind: 'dietary', standard_key: null },
  { code: 'spicy', label: 'Spicy', kind: 'dietary', standard_key: null },
]

test('parseCsv keeps text, quotes and line endings', () => {
  const { cells, eol, trailing } = parseCsv(FILE)
  assert.equal(eol, '\r\n')
  assert.equal(trailing, false)
  assert.equal(cells.length, 7)
  assert.equal(cells[2][2], 'Fried white fish, panang sauce and "lime" leaves.')
  assert.equal(cells[1][3], '2.2')
  const multi = parseCsv('a,b\n1,"two\nlines"\n')
  assert.deepEqual(multi.cells, [['a', 'b'], ['1', 'two\nlines']])
  assert.equal(multi.trailing, true)
  assert.equal(parseCsv('﻿item_id\nx').cells[0][0], 'item_id')
})

test('readSheet checks columns and tidies values', () => {
  const { columns, rows, problems } = readSheet(parseCsv(FILE).cells)
  assert.equal(columns.length, 13)
  assert.deepEqual(problems, [])
  assert.equal(rows.length, 6)
  assert.equal(rows[5].hfss, 'false')
  const bad = readSheet([['name', 'price'], ['x', '1']])
  assert.match(bad.problems[0], /item_id, item_name, delivery_price/)
  const dup = readSheet([['item_id', 'item_name', 'delivery_price'], ['x', 'A', '1'], ['x', 'B', '2']])
  assert.match(dup.problems[0], /twice/)
  const money = readSheet([['item_id', 'item_name', 'delivery_price'], ['x', 'A', '£2.20']])
  assert.equal(money.rows[0].delivery_price, '2.2')
})

test('round trip: an untouched file comes back byte for byte', () => {
  const parsed = parseCsv(FILE)
  const { columns, rows } = readSheet(parsed.cells)
  rows[5].hfss = 'FALSE' // the source had FALSE; tidy made it false
  assert.equal(toCsv(columns, rows, parsed), FILE)
})

test('prices', () => {
  assert.equal(priceText(1350), '13.5')
  assert.equal(priceText(1400), '14')
  assert.equal(priceText(1295), '12.95')
  assert.equal(pricePence('12.95'), 1295)
  assert.equal(pricePence('£2.20'), 220)
  assert.equal(pricePence(''), null)
  assert.equal(priceRule(1000, 10, 1), 1100)
  assert.equal(priceRule(1295, 15, 10, 'up'), 1490)      // 14.8925 -> 14.90
  assert.equal(priceRule(1295, 15, 50, 'up'), 1500)
  assert.equal(priceRule(1295, 15, 50, 'nearest'), 1500)
  assert.equal(priceRule(1240, 0, 10, 'up'), 1240)       // no float drift up
  assert.equal(priceRule(1000, 10, 50, 'up'), 1100)      // 11.00 exactly stays
  assert.equal(dishPrice({ price_pence: null, variant_groups: [
    { name: 'Protein', price_mode: 'base', options: [{ label: 'Chicken', price_pence: 1250 }, { label: 'Tofu', price_pence: 1150 }] },
    { name: 'Extras', price_mode: 'extra', options: [{ label: 'Egg', price_pence: 100 }] },
  ] }).pence, 1150)
})

test('name matching', () => {
  assert.equal(nameScore('Coke Can', 'coke can'), 1)
  assert.equal(nameScore('Pad Thai (Chicken)', 'Pad Thai'), 0.95)
  assert.ok(nameScore('Green Curry', 'Thai Green Curry') >= 0.75)
  assert.ok(nameScore('Duck Curry', 'Prawn Crackers') < 0.3)
  assert.equal(nameScore('Coke Can', 'Coke'), 0.95)
  assert.equal(nameScore('Still Water 330ml', 'Still Water'), 0.95)
  assert.equal(nameScore('Still Water 330 ml', 'Still Water'), 0.95)
  assert.ok(nameScore('Coke zero can', 'Coke') < 0.9)
  assert.equal(nameScore('Pad Med Ma Muang', 'Pad Med Mamuang'), 0.95)
  const dishes = [
    { id: 'd1', name: 'Egg Fried Rice' },
    { id: 'd2', name: 'Pad Thai' },
    { id: 'd3', name: 'Thai Green Curry' },
  ]
  assert.equal(matchRow({ item_name: 'Egg Fried Rice' }, null, dishes).state, 'auto')
  assert.equal(matchRow({ item_name: 'Pad Thai (Chicken)' }, null, dishes).dish.id, 'd2')
  const green = matchRow({ item_name: 'Green Curry' }, null, dishes)
  assert.equal(green.state, 'suggested')
  assert.equal(green.suggestions[0].dish.id, 'd3')
  assert.equal(matchRow({ item_name: 'Xyz' }, null, dishes).state, 'none')
  assert.equal(matchRow({ item_name: 'Green Curry' }, { menu_item_id: 'd3' }, dishes).state, 'linked')
  assert.equal(matchRow({ item_name: 'Green Curry' }, { menu_item_id: 'gone' }, dishes).state, 'missing')
  assert.equal(matchRow({ item_name: 'Egg Fried Rice' }, { skip: true }, dishes).state, 'skipped')
  // Two dishes with the same name: no automatic pick
  const twins = [{ id: 'a', name: 'Spring Rolls' }, { id: 'b', name: 'Spring Rolls' }]
  assert.equal(matchRow({ item_name: 'Spring Rolls' }, null, twins).state, 'suggested')
})

test('defaultMaps', () => {
  const m = defaultMaps(tags)
  assert.deepEqual(m.allergen.eggs, ['eggs'])
  assert.deepEqual(m.allergen.gluten, ['gluten_wheat'])
  assert.deepEqual(m.allergen.nuts, [])
  assert.deepEqual(m.dietary.v, ['vegetarian'])
  assert.deepEqual(m.dietary.spicy, [])
})

test('dishValues: price rule, VAT, allergens and levels', () => {
  const maps = defaultMaps(tags)
  const settings = { price_uplift_pct: 15, price_round_pence: 10, price_round_mode: 'up', allergen_map: maps.allergen, dietary_map: maps.dietary, default_vat_takeaway: 20 }
  const dish = { name: 'Pad Thai', description: ' Rice noodles ', price_pence: 1295, calories: 640.4, vat_takeaway: null,
    dietary: ['eggs', 'gluten', 'v', 'spicy'], allergen_levels: { gluten: 'may_contain' } }
  const { values, problems } = dishValues(dish, { settings, tags })
  assert.equal(values.delivery_price, '14.9')
  assert.equal(values.instore_price, '12.95')
  assert.equal(values.tax_rate, '20')
  assert.equal(values.item_description, 'Rice noodles')
  assert.equal(values.calories, '640')
  assert.equal(values.allergens, 'eggs,gluten_wheat')
  assert.equal(values.dietary_information, 'vegetarian')
  assert.deepEqual(problems, [])
  const noMay = dishValues(dish, { settings: { ...settings, include_may_contain: false }, tags })
  assert.equal(noMay.values.allergens, 'eggs')
  const nuts = dishValues({ ...dish, dietary: ['nuts'] }, { settings, tags })
  assert.equal(nuts.problems[0].level, 'error')
  assert.match(nuts.problems[0].text, /Nuts has no Deliveroo code/)
  assert.equal(dishValues({ ...dish, vat_takeaway: 0 }, { settings, tags }).values.tax_rate, '0')
})

test('buildRow: fills chosen fields, keeps, edits, never blanks', () => {
  const { columns, rows } = readSheet(parseCsv(FILE).cells)
  const maps = defaultMaps(tags)
  const ctx = { tags, settings: { price_uplift_pct: 0, price_round_pence: 1, allergen_map: maps.allergen, dietary_map: maps.dietary, default_vat_takeaway: 20 } }
  const dish = { id: 'd1', name: 'Egg Fried Rice', description: 'Jasmine rice with egg', price_pence: 450, calories: null, dietary: ['eggs'], allergen_levels: {} }
  const row = rows[2]
  const out = buildRow(row, { columns, match: { dish }, ctx })
  assert.equal(out.values.delivery_price, '4.5')
  assert.equal(out.values.item_description, 'Jasmine rice with egg')
  assert.equal(out.values.allergens, 'eggs')
  assert.equal(out.values.calories, '') // nothing on our side: Deliveroo's (empty) value stays
  assert.deepEqual(out.changes.map(c => c.field).sort(), ['delivery_price', 'item_description'])
  assert.equal(out.changes.find(c => c.field === 'delivery_price').source, 'menu')
  // Keep Deliveroo's description, edit the price
  const kept = buildRow(row, { columns, match: { dish }, link: { keep: ['item_description'], overrides: { delivery_price: '4.99' } }, ctx })
  assert.equal(kept.values.item_description, '')
  assert.equal(kept.values.delivery_price, '4.99')
  assert.equal(kept.changes.find(c => c.field === 'delivery_price').source, 'edit')
  // Fields switched off aren't touched
  const fill = { ...defaultFill(), item_description: false }
  assert.equal(buildRow(row, { columns, match: { dish }, fill, ctx }).values.item_description, '')
  // No dish: the row stays as it is
  const none = buildRow(rows[0], { columns, match: { dish: null }, ctx })
  assert.deepEqual(none.values, rows[0])
  assert.deepEqual(none.changes, [])
  assert.deepEqual(none.problems, [])
  // Columns the tool doesn't know are never changed
  assert.equal(out.values.plu, row.plu)
  assert.equal(out.values.hfss, row.hfss)
})

test('rowProblems', () => {
  const columns = ['item_id', 'item_name', 'delivery_price', 'tax_rate', 'allergens', 'calories', 'hfss']
  const base = { item_id: 'x', item_name: 'A', delivery_price: '5', tax_rate: '20', allergens: '', calories: '', hfss: 'false' }
  assert.deepEqual(rowProblems(base, columns), [])
  const fields = r => rowProblems({ ...base, ...r }, columns).map(p => p.field + ':' + p.level)
  assert.deepEqual(fields({ delivery_price: '0' }), ['delivery_price:error'])
  assert.deepEqual(fields({ delivery_price: '4.999' }), ['delivery_price:error'])
  assert.deepEqual(fields({ tax_rate: '17.5' }), ['tax_rate:error'])
  assert.deepEqual(fields({ tax_rate: '12.50' }), [])
  assert.deepEqual(fields({ calories: '12.5' }), ['calories:error'])
  assert.deepEqual(fields({ allergens: 'eggs,nuts' }), ['allergens:warning'])
  assert.deepEqual(fields({ allergens: 'no_allergens,eggs' }), ['allergens:error'])
  assert.deepEqual(fields({ hfss: 'yes' }), ['hfss:error'])
  assert.deepEqual(fields({ item_id: '7.03E+12' }), ['item_id:error'])
  assert.deepEqual(rowProblems({ ...base, delivery_price: '9' }, columns, base).map(p => p.level), ['warning'])
})

// Menu engineering (inventory phase 7a, shared/engineering.js): Kasavana and
// Smith's classes on a worked section, uncosted units left out of GP but in
// popularity, a meal deal as one dish of its own section, what is left out,
// and the sales figures stripped for people without till reports view.
import test from 'node:test'
import assert from 'node:assert/strict'
import { engineer, classOf, popularPct, withoutSales, classWords, averageText, CLASS_KEYS, ENGINEERING_SALES_FIELDS } from '../engineering.js'

const MAINS = 'sec-mains'
const DEALS = 'sec-deals'
// One row per dish here; dish_cost_days has one per day, channel and scope, summed the same way.
const row = (dish_id, name, qty, net_pence, cost, extra = {}) => ({ dish_id, name, section_id: MAINS, section: 'Mains', qty, net_pence, cost, uncosted_qty: 0, typical_qty: 0, left_out: null, ...extra })

// The worked section. Four dishes, 200 units costed: an equal share is 50, popular from 70% of it.
//   Burger 100 x (£10.00 net - £3.00) = £700 GP each, £70,000.00 ... in pence: 70000
//   Steak   20 x (£20.00 - £8.00)     = 1200 each,  24000
//   Salad   60 x (£8.00 - £2.50)      =  550 each,  33000
//   Fish    20 x (£12.00 - £7.00)     =  500 each,  10000
// Section GP 137000 over 200 units: 685 a unit on average.
const worked = () => [
  row('burger', 'Burger', 100, 100000, 300),
  row('steak', 'Steak', 20, 40000, 160),
  row('salad', 'Salad', 60, 48000, 150),
  row('fish', 'Fish', 20, 24000, 140),
]

test('the worked section: stars, plough-horses, puzzles and dogs', () => {
  const r = engineer(worked())
  assert.equal(r.sections.length, 1)
  const s = r.sections[0]
  assert.equal(s.dish_count, 4)
  assert.equal(s.units, 200)
  assert.equal(s.popular_pct, 17.5)
  assert.equal(s.gp_pence, 137000)
  assert.equal(s.avg_gp_per_unit_pence, 685)
  const by = Object.fromEntries(s.dishes.map(d => [d.dish_id, d]))
  assert.equal(by.burger.class, 'star')
  assert.equal(by.salad.class, 'plough_horse')
  assert.equal(by.steak.class, 'puzzle')
  assert.equal(by.fish.class, 'dog')
  assert.equal(by.burger.gp_per_unit_pence, 700)
  assert.equal(by.burger.share_pct, 50)
  assert.equal(by.steak.gp_pence, 24000)
  assert.equal(by.steak.cost_pct, 40)
  assert.deepEqual(s.classes, { star: 1, plough_horse: 1, puzzle: 1, dog: 1, not_costed: 0 })
  // Most units first.
  assert.deepEqual(s.dishes.map(d => d.dish_id), ['burger', 'salad', 'fish', 'steak'])
})

test('popular is at least 70% of an equal share, profitable at least the average, both inclusive', () => {
  // Two dishes: equal share 50%, popular from 35%. 35 of 100 is popular exactly.
  const rows = [row('a', 'A', 65, 65000, 325), row('b', 'B', 35, 35000, 175)]
  const s = engineer(rows).sections[0]
  const b = s.dishes.find(d => d.dish_id === 'b')
  assert.equal(b.popular, true)
  // Same GP per unit as the average (500 each): profitable.
  assert.equal(b.gp_per_unit_pence, 500)
  assert.equal(s.avg_gp_per_unit_pence, 500)
  assert.equal(b.class, 'star')
  assert.equal(popularPct(4), 17.5)
  assert.equal(classOf(true, null), null)
})

test('units not costed count for popularity, never for GP; a dish with none costed has no class', () => {
  const rows = [
    ...worked(),
    // Ten more fish sold with an option that has no rule: their cost is partial, so the row is left out of GP.
    row('fish', 'Fish', 10, 12000, 50, { uncosted_qty: 10 }),
    // Soup has no recipe: 40 units, no cost.
    row('soup', 'Soup', 40, 20000, null, { uncosted_qty: 40 }),
  ]
  const s = engineer(rows).sections[0]
  const by = Object.fromEntries(s.dishes.map(d => [d.dish_id, d]))
  assert.equal(s.units, 250)
  assert.equal(s.costed_units, 200)
  assert.equal(s.uncosted_units, 50)
  // The average is still over the 200 costed units: never pulled down by units priced at nothing.
  assert.equal(s.avg_gp_per_unit_pence, 685)
  assert.equal(by.fish.units, 30)
  assert.equal(by.fish.costed_units, 20)
  assert.equal(by.fish.gp_per_unit_pence, 500)
  assert.equal(by.fish.class, 'dog')
  // Soup sold well (40 of 250 with five dishes: 14% needed) but its profitability isn't known.
  assert.equal(by.soup.popular, true)
  assert.equal(by.soup.gp_pence, null)
  assert.equal(by.soup.profitable, null)
  assert.equal(by.soup.class, null)
  assert.equal(s.classes.not_costed, 1)
  assert.match(classWords(null).hint, /Not costed/)
})

test('a meal deal is one dish of its own section; its picks add nothing to theirs; left out rows are counted apart', () => {
  const rows = [
    ...worked(),
    // 50 lunch deals took £15.00 net each; the burgers and drinks picked in them cost £4.00 a deal (kept on the deal's row).
    { dish_id: 'lunch', name: 'Lunch deal', kind: 'deal', section_id: DEALS, section: 'Meal deals', qty: 50, net_pence: 75000, cost: 200, uncosted_qty: 0, typical_qty: 0, left_out: null },
    { dish_id: 'kids', name: 'Kids deal', kind: 'deal', section_id: DEALS, section: 'Meal deals', qty: 10, net_pence: 8000, cost: 30, uncosted_qty: 0, typical_qty: 10, left_out: null },
    // An open item, a service and a dish no longer on any menu.
    { dish_id: null, name: 'Open food', section_id: null, qty: 5, net_pence: 2500, cost: null, uncosted_qty: 0, left_out: 'open' },
    { dish_id: 'corkage', name: 'Corkage', section_id: MAINS, qty: 3, net_pence: 1500, cost: null, uncosted_qty: 0, left_out: 'service' },
    { dish_id: 'gone', name: 'Old dish', section_id: null, qty: 2, net_pence: 1000, cost: null, uncosted_qty: 2, left_out: null },
  ]
  const r = engineer(rows, { names: { [DEALS]: 'Meal deals (Lunch menu)' } })
  const mains = r.sections.find(s => s.section_id === MAINS)
  const deals = r.sections.find(s => s.section_id === DEALS)
  assert.equal(mains.units, 200, 'the deals\' burgers are not Mains units')
  assert.equal(mains.dish_count, 4, 'the service is not a dish of the section')
  assert.equal(deals.section, 'Meal deals (Lunch menu)')
  assert.equal(deals.dish_count, 2)
  assert.equal(deals.popular_pct, 35)
  const lunch = deals.dishes.find(d => d.dish_id === 'lunch')
  const kids = deals.dishes.find(d => d.dish_id === 'kids')
  assert.equal(lunch.kind, 'deal')
  assert.equal(lunch.gp_per_unit_pence, 1100)
  assert.equal(deals.avg_gp_per_unit_pence, 1000)
  assert.equal(lunch.class, 'star')
  assert.equal(kids.class, 'dog')
  assert.equal(kids.typical_units, 10)
  assert.deepEqual(r.left_out, { units: 10, dishes: 3 })
  assert.equal(r.total.units, 260)
  assert.equal(r.total.dish_count, 6)
  assert.equal(r.total.classes.star, 2)
  assert.equal(r.total.gp_pence, 137000 + 55000 + 5000)
})

test('without till reports view the sales figures go, units and shares stay', () => {
  const r = withoutSales(engineer(worked()))
  const s = r.sections[0]
  for (const k of ENGINEERING_SALES_FIELDS) {
    assert.equal(k in s, false, 'section ' + k)
    for (const d of s.dishes) assert.equal(k in d, false, 'dish ' + k)
    assert.equal(k in r.total, false, 'total ' + k)
  }
  assert.equal(s.dishes[0].units, 100)
  assert.equal(s.dishes[0].share_pct, 50)
  assert.equal(s.dishes[0].popular, true)
  assert.equal(s.dishes[0].cost_pence, 30000)
  assert.deepEqual(CLASS_KEYS, ['star', 'plough_horse', 'puzzle', 'dog'])
})

test('nothing sold, nothing to engineer', () => {
  assert.deepEqual(engineer([]).sections, [])
  // A dish sold and refunded to nothing in the period isn't one of the section's dishes.
  const s = engineer([...worked(), row('pie', 'Pie', 0, 0, 0)]).sections[0]
  assert.equal(s.dish_count, 4)
})

test('a section none of whose units could be costed has no average: a gap in words, never £0.00 (7a review)', () => {
  const r = engineer([...worked(), row('stew', 'Stew', 12, 9600, null, { section_id: 'sec-specials', section: 'Specials', uncosted_qty: 12 })])
  const sp = r.sections.find(s => s.section === 'Specials')
  assert.equal(sp.avg_gp_per_unit_pence, null)
  assert.equal(sp.dishes[0].class, null)
  const pence = p => '£' + (p / 100).toFixed(2)
  assert.equal(averageText(sp, pence), '-')
  assert.equal(averageText(sp, pence, 'not costed'), 'not costed')
  assert.equal(averageText(r.sections.find(s => s.section === 'Mains'), pence), '£6.85')
  assert.equal(averageText(null, pence), '-')
})

test('an automatic deal found among separate dishes: they count in their own sections at what they took, the deal has no units (7a review)', () => {
  // The till rang up 10 burgers and 10 cokes one by one and found the automatic Burger meal in 4 of each, taking
  // £2.00 off each burger and £0.50 off each coke there: dish_cost_days has one row per dish, its net after the
  // saving, and none for the deal. 2 Burger meals were rung up from the deal's own button: the deal's own row.
  const drinks = { section_id: 'sec-drinks', section: 'Drinks' }
  const rows = [
    row('burger', 'Burger', 10, 10 * 1000 - 4 * 200, 30),
    row('chips', 'Chips', 10, 10 * 300, 5),
    row('coke', 'Coke', 10, 10 * 250 - 4 * 50, 5, drinks),
    row('water', 'Water', 10, 10 * 150, 1, drinks),
    row('meal', 'Burger meal', 2, 2 * 1100, 7, { section_id: DEALS, section: 'Deals', kind: 'deal' }),
  ]
  const r = engineer(rows)
  const mains = r.sections.find(s => s.section === 'Mains')
  const burger = mains.dishes.find(d => d.dish_id === 'burger')
  assert.equal(burger.units, 10, 'every burger counts in Mains, the four in deals too')
  assert.equal(burger.net_pence, 9200, 'at what they took after the saving')
  assert.equal(burger.gp_per_unit_pence, 620)
  const deals = r.sections.find(s => s.section === 'Deals')
  assert.equal(deals.units, 2, 'only the deals rung up as deals')
  assert.equal(deals.dishes[0].kind, 'deal')
  assert.equal(r.sections.find(s => s.section === 'Drinks').units, 20)
})

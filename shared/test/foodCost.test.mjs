// Food cost beyond one stock period (inventory phase 6b, migration 313):
// a week's theoretical food cost from its sales, its actual only from a stock
// period (the one covering it, else the latest closed, named), never one of
// its own; dishes over their cost target at their worst order type; the
// crossings the rule trigger fires on; margins by menu; the variance rule
// event; and the three rule triggers in shared/rules.js (matches, the money
// they carry, what a person needs to make them).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  daysFoodCost, weekFoodCost, overTarget, targetCrossings, marginsByMenu, overviewWords, varianceEvent, penceWords,
} from '../foodCost.js'
import { periodVariance, itemVariance } from '../variance.js'
import { costShare, soldMargins } from '../costing.js'
import {
  TRIGGERS, ruleProblem, matches, fillInput, usesMoney, ruleNeeds, ruleLines, MONEY_HIDDEN,
} from '../rules.js'

const row = (o = {}) => ({ day: '2026-11-23', item_type: 'food', left_out: null, net_pence: 1000, cost: 3, qty: 1, uncosted_qty: 0, ...o })

test('daysFoodCost: food and drink only, costs in pounds over sales in pence through costShare()', () => {
  const rows = [
    row({ net_pence: 10000, cost: 28, qty: 10 }),
    row({ day: '2026-11-24', net_pence: 5000, cost: 14, qty: 5 }),
    row({ item_type: 'goods', net_pence: 9000, cost: 6 }),          // retail goods: not food sales
    row({ left_out: 'service', net_pence: 2000, cost: null }),      // a service
    row({ net_pence: 1000, cost: null, qty: 2, uncosted_qty: 2 }),  // sold without a recipe
  ]
  const w = daysFoodCost(rows)
  assert.equal(w.net_food_pence, 16000)
  assert.equal(w.theoretical_value, 42)
  assert.equal(w.theoretical_pct, costShare(42, 16000))
  assert.equal(w.theoretical_pct, 26.25)
  assert.equal(w.uncosted_units, 2)
  assert.equal(w.days, 2)
  // Nothing costed: no theoretical figure, never 0%.
  const none = daysFoodCost([row({ cost: null })])
  assert.equal(none.theoretical_value, null)
  assert.equal(none.theoretical_pct, null)
  assert.equal(daysFoodCost([]).theoretical_pct, null)
})

test('weekFoodCost: actual only from a stock period, the covering one said so, else the latest closed one named', () => {
  const week = daysFoodCost([row({ net_pence: 100000, cost: 290 })])
  const fc = { complete: true, uncounted_used: 0, actual_pct: 31.2, theoretical_pct: 28.6, gap_pts: 2.6 }
  const period = { id: 'p1', from_at: '2026-11-02T06:00:00Z', to_at: '2026-11-30T06:00:00Z', status: 'closed', food_cost: fc }

  const covering = weekFoodCost({ week, period, covers: true })
  assert.equal(covering.theoretical.theoretical_pct, 29)
  assert.equal(covering.actual.pct, 31.2)
  assert.equal(covering.actual.covers, true)
  assert.match(covering.lines[0], /Theoretical food cost 29% of £1,000.00 net food sales/)
  assert.match(covering.lines[1], /which covers this week/)
  assert.match(covering.lines[1], /the period's figure, not the week's/)

  const latest = weekFoodCost({ week, period, covers: false })
  assert.equal(latest.actual.covers, false)
  assert.match(latest.lines[1], /No stock period covers this week/)
  assert.match(latest.lines[1], /The latest closed period, Mon 2 Nov to Mon 30 Nov, had actual 31.2% against theoretical 28.6%/)

  // Never invented: no period, no actual.
  const none = weekFoodCost({ week, period: null })
  assert.equal(none.actual, null)
  assert.match(none.lines[1], /needs a full stock count at both ends/)

  // A period whose food cost isn't complete (an item sales used not counted at both ends): no actual figure.
  const partial = weekFoodCost({ week, period: { ...period, food_cost: { ...fc, complete: false, uncounted_used: 3, actual_pct: null, gap_pts: null } }, covers: true })
  assert.equal(partial.actual.pct, null)
  assert.equal(partial.actual.complete, false)
  assert.match(partial.lines[1], /isn't known yet: 3 items sales used weren't counted at both ends/)

  // Uncosted sales say the theoretical figure reads low; no sales say so.
  assert.match(weekFoodCost({ week: daysFoodCost([row({ uncosted_qty: 4 })]) }).lines[0], /4 units sold without a full recipe, so it reads low/)
  assert.match(weekFoodCost({ week: daysFoodCost([]) }).lines[0], /No food sales worked out/)
  // Sales left out of usage (an open item, a dish no longer on a menu) are in the net with no cost and no
  // uncosted units: the % reads low for them too, and the line says so (review fixes).
  const open = daysFoodCost([row(), row({ left_out: 'open', cost: null, qty: 3 }), row({ left_out: 'gone', cost: null, qty: 1 })])
  assert.equal(open.left_out_units, 4)
  assert.equal(open.uncosted_units, 0)
  assert.equal(open.net_food_pence, 3000)
  assert.match(weekFoodCost({ week: open }).lines[0], /\(4 units left out of usage \(open items, dishes no longer on a menu\), so it reads low\)/)
  assert.match(weekFoodCost({ week: daysFoodCost([row({ uncosted_qty: 2 }), row({ left_out: 'open', cost: null, qty: 1 })]) }).lines[0],
    /2 units sold without a full recipe, 1 unit left out of usage .*, so it reads low/)
  assert.doesNotMatch(weekFoodCost({ week: daysFoodCost([row()]) }).lines[0], /reads low/)
})

test('weekFoodCost reads periodVariance()\'s food cost as it is (rule 12): the same figures as the Variance tab', () => {
  const T = h => new Date(Date.UTC(2026, 10, 1) + h * 3600000).toISOString()
  const r = itemVariance({
    moves: [{ kind: 'count', at: T(0), qty_base: 1000 }, { kind: 'delivery', at: T(5), qty_base: 4000 }, { kind: 'usage', at: T(20), qty_base: -3000 }, { kind: 'count', at: T(30), qty_base: 1500 }],
    from: T(0), to: T(30), price: 0.01,
  })
  const view = periodVariance({ items: [{ item_id: 'i', name: 'Chicken', base_unit: 'g', ...r }], net_food_pence: 15000 })
  const line = weekFoodCost({ week: daysFoodCost([]), period: { from_at: T(0), to_at: T(30), status: 'closed', food_cost: view.food_cost }, covers: true })
  assert.equal(line.actual.pct, view.food_cost.actual_pct)
  assert.equal(line.actual.theoretical_pct, view.food_cost.theoretical_pct)
  assert.equal(line.actual.gap_pts, view.food_cost.gap_pts)
  assert.equal(view.food_cost.actual_pct, 23.33) // 3500 g x £0.01 = £35 over £150
})

test('overTarget: one per dish at its worst order type, a meal deal at its highest, dearest first', () => {
  const m = (o) => ({ dish_id: 'd1', name: 'Burger', menu_id: 'm1', menu: 'Lunch', kind: 'dish', cost_pct: 31, band: 'watch', thresholds: { target_pct: 30, limit_pct: 35 }, order_type_id: 't1', order_type: 'Eat in', ...o })
  const rows = [
    m({}), m({ cost_pct: 36.4, band: 'over', order_type_id: 't2', order_type: 'Takeaway' }),
    m({ dish_id: 'd2', name: 'Salad', cost_pct: 22, band: 'good' }),
    m({ dish_id: 'd3', name: 'Deal', kind: 'deal', cost_pct: null, cost_pct_max: 33.1, band: 'watch' }),
    m({ dish_id: 'd4', name: 'Soup', cost_pct: null, band: null }),
  ]
  const out = overTarget(rows)
  assert.deepEqual(out.map(d => [d.name, d.cost_pct, d.band, d.order_type]), [['Burger', 36.4, 'over', 'Takeaway'], ['Deal', 33.1, 'watch', 'Eat in']])
  assert.equal(out[0].target_pct, 30)
  assert.equal(out[0].limit_pct, 35)
})

test('targetCrossings: a dish newly over (or worse) crosses once; back under is forgotten, so over again is new', () => {
  const now = [{ dish_id: 'a', band: 'watch' }, { dish_id: 'b', band: 'over' }, { dish_id: 'c', band: 'watch' }]
  const states = [{ dish_id: 'a', band: 'watch', since: 't0' }, { dish_id: 'b', band: 'watch', since: 't0' }, { dish_id: 'z', band: 'over', since: 't0' }]
  const r = targetCrossings(states, now)
  assert.deepEqual(r.crossed.map(d => d.dish_id), ['b', 'c'], 'b went from over the target to over the limit; c is new')
  assert.deepEqual(r.kept.map(d => [d.dish_id, d.since]), [['a', 't0']])
  assert.deepEqual(r.cleared, ['z'])
  // The same look again: nothing crosses.
  const again = targetCrossings([...r.kept, ...r.crossed.map(d => ({ ...d, since: 't1' }))], now)
  assert.equal(again.crossed.length, 0)
  // Easing back from the limit to the target is no new event.
  assert.equal(targetCrossings([{ dish_id: 'b', band: 'over', since: 't1' }], [{ dish_id: 'b', band: 'watch' }]).crossed.length, 0)
})

test('targetCrossings: a kept dish whose cost % went up has risen; every row carries the last look', () => {
  // cost_pct as the states table gives it (numeric, maybe a string).
  const states = [
    { dish_id: 'a', band: 'watch', since: 't0', cost_pct: '31.00' }, { dish_id: 'b', band: 'watch', since: 't0', cost_pct: 33 },
    { dish_id: 'c', band: 'over', since: 't0', cost_pct: 36 }, { dish_id: 'e', band: 'watch', since: 't0', cost_pct: 34 },
  ]
  const now = [
    { dish_id: 'a', band: 'watch', cost_pct: 34 }, { dish_id: 'b', band: 'watch', cost_pct: 32 }, { dish_id: 'c', band: 'over', cost_pct: 45 },
    { dish_id: 'd', band: 'watch', cost_pct: 31 }, { dish_id: 'e', band: 'over', cost_pct: 36 },
  ]
  const r = targetCrossings(states, now)
  assert.deepEqual(r.rose.map(d => [d.dish_id, d.prev_cost_pct, d.cost_pct, d.since]), [['a', 31, 34, 't0'], ['c', 36, 45, 't0']])
  assert.ok(r.rose.every(d => r.kept.includes(d)), 'a rise is kept: its since stays')
  assert.deepEqual(r.crossed.map(d => [d.dish_id, d.prev_band, d.prev_cost_pct]), [['d', null, null], ['e', 'watch', 34]])
  assert.deepEqual(r.kept.map(d => d.dish_id), ['a', 'b', 'c'])
  assert.equal(r.kept.find(d => d.dish_id === 'b').prev_cost_pct, 33, 'a fall is kept, and no event')
  // The same look again: no rise.
  assert.equal(targetCrossings(now.map(d => ({ ...d, since: 't1' })), now).rose.length, 0)
})

test('dish_over_target with a % of its own tells as the dish passes it, a rise within its band included, once', () => {
  // Target 30, limit 35 (the defaults). The events as the sweep makes them (services/stockFoodCostSvc.js).
  const rule = conditions => ({ name: 'r', trigger: 'dish_over_target', conditions, action_tool: 'send_notice', action_input: { to: 'owner', title: 'x' }, per_day: 5 })
  const ev = (kind, prev_band, prev_cost_pct, band, cost_pct) => ({ trigger: 'dish_over_target', kind, prev_band, prev_cost_pct, band, cost_pct, dish: 'Burger', menu: 'Lunch' })
  const r33 = rule({ over: 33 })
  assert.equal(matches(r33, ev('crossed', null, null, 'watch', 31)), false, 'over the target at 31%: not over 33% yet')
  assert.equal(matches(r33, ev('rose', 'watch', 31, 'watch', 34)), true, 'drifts to 34% in the same band: it passes 33%')
  assert.equal(matches(r33, ev('rose', 'watch', 34, 'watch', 34.5)), false, 'past 33% already: not again')
  assert.equal(matches(r33, ev('crossed', 'watch', 34.5, 'over', 36)), false, 'over the limit, but 33% was passed before')
  assert.equal(matches(r33, ev('crossed', null, null, 'over', 36)), true, 'straight over 33% as it goes over')
  const r40 = rule({ over: 40 })
  assert.equal(matches(r40, ev('crossed', 'watch', 34, 'over', 36)), false)
  assert.equal(matches(r40, ev('rose', 'over', 36, 'over', 45)), true, 'over the limit at 36%, then climbing past 40%')
  // A rule without a % of its own never takes a rise: it told when the dish went over.
  assert.equal(matches(rule({}), ev('rose', 'watch', 31, 'watch', 34)), false)
  assert.equal(matches(rule({ limit: true }), ev('rose', 'over', 36, 'over', 45)), false)
  assert.equal(matches(rule({}), ev('crossed', 'watch', 34, 'over', 36)), true, 'from the target to over the limit is still a crossing')
  assert.equal(matches(rule({ limit: true }), ev('crossed', 'watch', 34, 'over', 36)), true)
  // Over the limit and over 33%: it holds once the limit is passed, though 33% was passed before.
  assert.equal(matches(rule({ over: 33, limit: true }), ev('crossed', 'watch', 34, 'over', 36)), true)
  assert.equal(matches(rule({ over: 33, limit: true }), ev('rose', 'over', 36, 'over', 40)), false)
  // A sentence's dish words still narrow it.
  assert.equal(matches(rule({ over: 33, dish: 'salad' }), ev('rose', 'watch', 31, 'watch', 34)), false)
})

test('marginsByMenu: soldMargins() per menu, the same total as the Sold tab\'s for one menu', () => {
  const rows = [
    { dish_id: 'd1', name: 'Burger', section_id: 's1', menu_id: 'm1', menu: 'Lunch', qty: 10, sales_pence: 12000, net_pence: 10000, cost: 30, uncosted_qty: 0, typical_qty: 0 },
    { dish_id: 'd2', name: 'Chips', section_id: 's1', menu_id: 'm1', menu: 'Lunch', qty: 5, sales_pence: 2400, net_pence: 2000, cost: 4, uncosted_qty: 0, typical_qty: 0 },
    { dish_id: 'd3', name: 'Cake', section_id: null, menu_id: null, menu: null, qty: 2, sales_pence: 1200, net_pence: 1000, cost: null, uncosted_qty: 2, typical_qty: 0 },
  ]
  const out = marginsByMenu(rows, null)
  assert.equal(out[0].menu, 'Lunch')
  assert.deepEqual(out[0], { menu_id: 'm1', menu: 'Lunch', ...soldMargins(rows.slice(0, 2)).total })
  assert.equal(out[0].cost_pct, 28.3) // margin()'s cost % to one place: £34 over £120 net
  assert.equal(out[1].menu, null)
  assert.equal(out[1].uncosted_qty, 2)
})

test('overviewWords and penceWords', () => {
  assert.equal(overviewWords({ to_approve: 1, incoming: 2, unreviewed: 3, last_full_count_at: 'x' }), '1 count to approve · 2 transfers to receive · 3 flagged items to review')
  assert.equal(overviewWords({ last_full_count_at: 'x' }), 'Nothing waiting')
  assert.equal(overviewWords({}), 'no full count yet')
  assert.equal(penceWords(421050), '£4,210.50')
})

test('varianceEvent: only over the band or with flagged items; keyed by the period and when it was closed', () => {
  const p = { id: 'p1', venue_id: 'v1', from_at: '2026-11-02T06:00:00Z', to_at: '2026-11-09T06:00:00Z', closed_at: '2026-11-09T10:00:00Z' }
  const frozen = {
    rows: [{ name: 'Beef', flagged: true, unexplained_value: 80 }, { name: 'Chicken', flagged: false, unexplained_value: 10 }],
    totals: { unexplained_value: 90 }, band: { band_pct: 1, unexplained_pct: 1.8, over: true }, flagged: 1,
  }
  const e = varianceEvent(p, frozen, 'Soho')
  assert.equal(e.trigger, 'variance_over_band')
  assert.equal(e.key, 'p1:' + Date.parse(p.closed_at))
  assert.equal(e.top_item, 'Beef')
  assert.equal(e.unexplained, '90.00')
  assert.equal(e.unexplained_pts, '1.8')
  assert.equal(e.over_band, true)
  assert.equal(e.day, '2026-11-09')
  assert.equal(varianceEvent(p, { rows: [], totals: {}, band: { over: false }, flagged: 0 }), null)
  // Reclosed later: a new key.
  assert.notEqual(varianceEvent({ ...p, closed_at: '2026-11-10T10:00:00Z' }, frozen).key, e.key)
})

test('rule triggers: the three new ones match their conditions', () => {
  for (const k of ['dish_over_target', 'variance_over_band', 'waste_logged']) assert.ok(TRIGGERS[k], k)
  const rule = (trigger, conditions) => ({ name: 'r', trigger, conditions, action_tool: 'send_notice', action_input: { to: 'owner', title: 'x' }, per_day: 5 })
  const dish = { trigger: 'dish_over_target', dish: 'Beef burger', menu: 'Lunch', cost_pct: 36.2, band: 'over' }
  assert.equal(matches(rule('dish_over_target', {}), dish), true)
  assert.equal(matches(rule('dish_over_target', { over: 35 }), dish), true)
  assert.equal(matches(rule('dish_over_target', { over: 40 }), dish), false)
  assert.equal(matches(rule('dish_over_target', { limit: true }), { ...dish, band: 'watch' }), false)
  assert.equal(matches(rule('dish_over_target', { dish: 'burger', menu: 'lunch' }), dish), true)
  const period = { trigger: 'variance_over_band', over_band: false, unexplained_value: 120, flagged: 2 }
  assert.equal(matches(rule('variance_over_band', {}), period), true)
  assert.equal(matches(rule('variance_over_band', { venue_band: true }), period), false)
  assert.equal(matches(rule('variance_over_band', { pounds_over: 100, flagged_at_least: 2 }), period), true)
  assert.equal(matches(rule('variance_over_band', { flagged_at_least: 3 }), period), false)
  const waste = { trigger: 'waste_logged', what: 'Chicken thighs', reason: 'Dropped', value_num: 62.5 }
  assert.equal(matches(rule('waste_logged', { over: 50 }), waste), true)
  assert.equal(matches(rule('waste_logged', { over: 50 }), { ...waste, value_num: null }), false, 'no value: never over an amount')
  assert.equal(matches(rule('waste_logged', { reason: 'drop', what: 'chicken' }), waste), true)
  assert.equal(matches(rule('waste_logged', { reason: 'expired' }), waste), false)
  assert.equal(matches(rule('waste_logged', {}), { ...waste, trigger: 'review_low' }), false)
})

test('rule triggers: costs and shares of sales are money; never in an H&S action; ruleNeeds() says what a maker must see', () => {
  const notice = { name: 'Waste', trigger: 'waste_logged', conditions: { over: 50 }, action_tool: 'send_notice', action_input: { to: 'owner', title: '£{value} of {what} wasted' }, per_day: 5 }
  assert.equal(ruleProblem(notice), null)
  assert.equal(usesMoney(notice), true)
  assert.deepEqual(ruleNeeds(notice), ['stock', 'costing'])
  assert.deepEqual(ruleNeeds({ ...notice, conditions: {}, action_input: { to: 'owner', title: '{what} wasted' } }), ['stock'])
  assert.deepEqual(ruleNeeds({ ...notice, action_input: { to: 'owner', title: '{what} wasted' } }), ['stock', 'costing'], 'a money condition needs Costing too')
  assert.equal(fillInput(notice, { venue_id: 'v', value: '62.50', what: 'Chicken' }).title, '£62.50 of Chicken wasted')
  assert.equal(fillInput(notice, { venue_id: 'v', value: '62.50', what: 'Chicken' }, { prices: false }).title, MONEY_HIDDEN + ' of Chicken wasted')
  // A % after a cost goes with it when hidden.
  const dish = { name: 'Dish', trigger: 'dish_over_target', conditions: {}, action_tool: 'send_notice', action_input: { to: 'owner', title: '{dish} is at {cost_pct}%' }, per_day: 5 }
  assert.equal(fillInput(dish, { dish: 'Burger', cost_pct: 36.2 }).title, 'Burger is at 36.2%')
  assert.equal(fillInput(dish, { dish: 'Burger', cost_pct: 36.2 }, { prices: false }).title, 'Burger is at ' + MONEY_HIDDEN)
  assert.deepEqual(ruleNeeds(dish), ['costing'])
  // The variance trigger's money needs both Costing and Till reports.
  assert.deepEqual(ruleNeeds({ ...dish, trigger: 'variance_over_band', action_input: { to: 'owner', title: '{venue} {unexplained_pts} pts' } }), ['stock', 'costing', 'pos_reports'])
  // An H&S action is read by everyone with the action log: no cost in it.
  const hs = { name: 'HS', trigger: 'waste_logged', conditions: {}, action_tool: 'add_hs_action', action_input: { task: 'Check {what}: £{value}' }, per_day: 5 }
  assert.match(ruleProblem(hs), /can't carry \{value\}/)
  assert.equal(ruleProblem({ ...hs, action_input: { task: 'Check why {what} was wasted ({reason})' } }), null)
  // Unknown words for a trigger are refused by name.
  assert.match(ruleProblem({ ...dish, action_input: { to: 'owner', title: '{total}' } }), /\{total\} isn't known/)
  assert.deepEqual(ruleLines(notice), ['When waste is logged at any venue', 'If worth over (£) 50', 'Then: send a notice to people\'s phones (To: owner; Title: £{value} of {what} wasted)', 'At most 5 times a day'])
  // The first four triggers need nothing new.
  assert.deepEqual(ruleNeeds({ trigger: 'supplier_order', conditions: { over: 500 }, action_input: { title: '{total}' } }), [])
})

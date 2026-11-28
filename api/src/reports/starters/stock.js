// src/reports/starters/stock.js
//
// Starter reports on stock (inventory phase 4a): the last count's
// differences at each venue, from Count lines (the venue's latest approved
// count, whatever the period; values need Costing view and are left out
// without it), and what is on hand now (moved from purchasing with the
// subject). Phase 4b: this week's waste by reason (the till's voids marked
// wasted in it) and the transfers in transit. Phase 5: theoretical food cost
// by week (Dish sales and theoretical cost, from usage from sales). Phase 9a:
// how good the order form's suggestions are (Suggested orders).

import { starter, m } from './define.js'

/** Where these starters come in the list (index.js gathers this folder by it, then by file name). */
export const order = 62

export const starters = [
  starter({
    key: 'stock_last_count_differences',
    name: 'Last count\'s differences',
    about: 'Each venue\'s latest approved stock count: every item whose count differs from what was expected at that moment (the last approved count before it plus what was received and adjusted since), how much over or short, and what the difference is worth, biggest loss first. Sales are taken off as usage from sales (by each dish\'s recipe), so what is short beyond them is waste nobody logged, a recipe that uses more than it says, or a delivery booked in wrong.',
    period: false,
    spec: {
      subject: 'stock.count_lines',
      kind: 'list',
      rows: ['item_name', 'venue.name', 'counted', 'expected', 'difference', 'base_unit', 'value', 'areas'],
      filters: [{ field: 'latest', op: 'is', value: true }, { field: 'off', op: 'is', value: true }],
      // No sort of its own: the subject's usual order (biggest loss first, then by name) is a
      // default the engine leaves out where the role can't see values, where a sort asked for
      // would refuse the run (a role with Stock but not Costing).
    },
  }),

  starter({
    key: 'stock_waste_by_reason_week',
    name: 'Waste by reason this week',
    about: 'This week\'s waste at each venue by reason and WRAP\'s kind (spoilage, preparation, plate): how many entries, what was wasted in each item\'s own unit and, with Costing view, its value at what was paid. Dishes voided on the till and marked wasted are in it, broken into items by their recipe; test till sales are left out.',
    period: 'this_week',
    spec: {
      subject: 'stock.waste',
      rows: ['reason', 'kind'],
      values: m('entries', 'items_wasted'),
      sort: [{ by: 'entries', dir: 'desc' }],
      drill: { down: ['item_name', 'name', 'date', 'by'], rows: ['date', 'name', 'entry_qty', 'item_name', 'qty', 'base_unit', 'by'] },
    },
  }),

  starter({
    key: 'stock_transfers_in_transit',
    name: 'Transfers in transit',
    about: 'Stock sent from one venue to another that hasn\'t been received yet: each item with what was sent, where from and where to, when and by whom. It left the sender when it was sent and reaches the receiver only once someone there receives it.',
    period: false,
    spec: {
      subject: 'stock.transfers',
      kind: 'list',
      rows: ['number', 'venue.name', 'other_venue.name', 'item_name', 'sent', 'base_unit', 'sent_at', 'sent_by'],
      filters: [{ field: 'status', op: 'is', value: 'sent' }, { field: 'direction', op: 'is', value: 'out' }],
      sort: [{ by: 'sent_at', dir: 'asc' }],
    },
  }),

  // Phase 5 (migration 311): what sales should have used, in pounds, week by week.
  starter({
    key: 'stock_theoretical_food_cost_week',
    name: 'Theoretical food cost by week',
    about: 'Week by week at each venue: net sales, the theoretical cost of what was sold (each dish\'s recipe, at what was paid for its items then) and the theoretical food cost %, with the units that couldn\'t be costed beside it (a dish with no recipe makes the % read low). Usage from sales keeps the last 14 days worked out; older days are there once they were. Actual against theoretical comes with variance (phase 6).',
    period: { relative: 'last_n_days', n: 56 },
    spec: {
      subject: 'stock.dish_sales',
      rows: [{ field: 'date', bucket: 'week' }],
      values: m('net_sales', 'theoretical_cost', 'theoretical_cost_pct', 'uncosted'),
      sort: [{ by: 'date:week', dir: 'asc' }],
      drill: { down: ['venue.name', 'section', 'dish'] },
      view: { kind: 'line', x: 'date:week', y: ['theoretical_cost_pct'] },
    },
  }),

  // Phase 6a (migration 312): variance by item over the stock periods, and food cost actual against theoretical.
  starter({
    key: 'stock_variance_by_item',
    name: 'Variance by item',
    about: 'The stock periods that ended in the last 30 days (between two approved full counts at a venue): each item\'s unexplained loss in pounds, biggest first, with how many periods flagged it. Unexplained is actual usage (what the counts say was used) less what sales took by their recipes, less logged waste and adjustments. Values need Costing view.',
    period: { relative: 'last_n_days', n: 30 },
    spec: {
      subject: 'stock.variance',
      rows: ['item_name'],
      values: m('unexplained_total', 'flagged_items', 'items'),
      sort: [{ by: 'unexplained_total', dir: 'desc' }],
      drill: { down: ['venue.name', 'date'], rows: ['date', 'venue.name', 'item_name', 'actual', 'theoretical', 'waste', 'unexplained', 'base_unit', 'unexplained_value'] },
    },
  }),

  starter({
    key: 'stock_food_cost_actual_theoretical_week',
    name: 'Theoretical against actual food cost by week',
    about: 'Week by week at each venue, from its stock periods (between two approved full counts; a period counts in the week it ends): net food sales, the actual food cost % (what the counts say was used) and the theoretical (what sales took by their recipes), side by side. The gap is waste, recipes that take more than they say, sales without a recipe and stock nobody can account for.',
    period: { relative: 'last_n_days', n: 84 },
    spec: {
      subject: 'stock.food_cost',
      rows: [{ field: 'date', bucket: 'week' }],
      values: m('net_food_sales', 'actual_food_cost_pct', 'theoretical_food_cost_pct', 'periods'),
      sort: [{ by: 'date:week', dir: 'asc' }],
      drill: { down: ['venue.name'] },
      view: { kind: 'line', x: 'date:week', y: ['actual_food_cost_pct', 'theoretical_food_cost_pct'] },
    },
  }),

  // Phase 9a (migration 320): the order form's Suggest judged against what was ordered and what sales used.
  starter({
    key: 'stock_suggested_orders_how_good',
    name: 'How good are the suggested orders',
    about: 'The last 30 days of the order form\'s Suggest for each item: how many lines were suggested and placed, the share placed as suggested, and, for suggestions whose days have passed, what sales really took against the forecast (100% is a forecast that was right). Open an item for its venues and days; add the supplier as a column with Purchasing view. A low share placed as suggested with sales close to the forecast means the suggestions were right and people ordered more or less anyway; sales far off the forecast mean the forecast needs a look (a recipe, a par, an unusual week).',
    period: { relative: 'last_n_days', n: 30 },
    spec: {
      subject: 'stock.suggestions',
      // By item, not by supplier: Supplier needs Purchasing view, and a starter must run for a role
      // with only its subject's module (Stock view), grouping included (reports-areas.test.mjs).
      rows: ['item_name'],
      values: m('suggestions', 'placed', 'as_suggested_share', 'forecast_ratio'),
      sort: [{ by: 'suggestions', dir: 'desc' }],
      drill: { down: ['venue.name', 'date'], rows: ['date', 'venue.name', 'item_name', 'basis', 'suggested', 'ordered', 'order_status', 'forecast', 'actual', 'base_unit'] },
    },
  }),
]

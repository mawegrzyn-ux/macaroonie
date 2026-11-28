// shared/registry/stock.js: the Stock area's business objects
// (shared/registry/index.js says what a record holds). Inventory phase 4a;
// waste, its reasons and transfers phase 4b; suggested orders phase 9a.

export const objects = [
  {
    key: 'stock.counts', label: 'Stock count', plural: 'Stock counts', words: ['stocktake', 'stock take', 'count', 'key items count'],
    table: 'stock_counts', subjects: ['stock.counts', 'stock.count_lines'],
    page: '/stock',
    open: { page: '/stock', with: ['venue', 'tab'] },
    actions: ['count_stock'],
    forms: ['stock_key_count'],
  },
  {
    key: 'stock.adjustments', label: 'Stock adjustment', plural: 'Stock adjustments', words: ['adjustment', 'write-off', 'correction'],
    table: 'stock_adjustments', subjects: ['stock.adjustments'],
    page: '/stock',
  },
  {
    key: 'stock.waste', label: 'Waste entry', plural: 'Waste', words: ['wastage', 'spoilage', 'thrown away', 'binned', 'dropped'],
    table: 'stock_waste', subjects: ['stock.waste'],
    page: '/stock',
    open: { page: '/stock', with: ['venue', 'tab'] },
    actions: ['log_waste'],
    forms: ['stock_waste'],
  },
  {
    key: 'stock.waste_reasons', label: 'Waste reason', plural: 'Waste reasons', words: ['why it was wasted', 'spoilage', 'plate waste'],
    table: 'waste_reasons',
    page: '/stock',
  },
  {
    key: 'stock.transfers', label: 'Stock transfer', plural: 'Stock transfers', words: ['transfer', 'in transit', 'moved stock', 'sent to another venue'],
    table: 'stock_transfers', subjects: ['stock.transfers'],
    page: '/stock',
    open: { page: '/stock', with: ['venue', 'tab'] },
    actions: ['send_transfer', 'receive_transfer'],
    forms: ['stock_transfer'],
  },
  {
    key: 'stock.areas', label: 'Storage area', plural: 'Storage areas', words: ['walk-in', 'dry store', 'shelf', 'count sheet'],
    table: 'stock_areas',
    page: '/stock',
  },
  {
    key: 'stock.key_lists', label: 'Key-item list', plural: 'Key-item lists', words: ['key items', 'daily count list'],
    table: 'stock_key_lists',
    page: '/stock',
  },
  // Phase 6a (migration 312): closed and reopened on the Variance tab by Stock manage; Pepper reads them only.
  {
    key: 'stock.periods', label: 'Stock period', plural: 'Stock periods', words: ['period between counts', 'variance period', 'close the period'],
    table: 'stock_periods', subjects: ['stock.periods'],
    page: '/stock',
    open: { page: '/stock', with: ['venue', 'tab'] },
  },
]

export const notObjects = {
  'What is on hand and each item\'s ledger are worked out from the deliveries, counts and adjustments each time: figures, never kept or changed by hand.': ['stock.on_hand', 'stock.moves'],
  // Phase 5 (migration 311): usage_summary reads them.
  'Usage from sales and each dish\'s sales with its theoretical cost are worked out from what sold by the usage job: figures, recomputed, never changed by hand.': ['stock.usage', 'stock.dish_sales'],
  // Phase 6a: variance_summary and explain_variance read them.
  'Variance and food cost by period are worked out from the counts, the ledger and the sales (shared/variance.js), frozen when a period is closed: figures, never changed by hand.': ['stock.variance', 'stock.food_cost'],
  // Phase 9a (migration 320): suggested_order reads the same rule; the order form keeps each suggestion on its line.
  'Suggested orders are what Suggest worked out from the forecast (shared/forecast.js), kept on each restaurant order line beside what was ordered: figures, never changed by hand.': ['stock.suggestions'],
}

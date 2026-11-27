// shared/registry/stock.js: the Stock area's business objects
// (shared/registry/index.js says what a record holds). Inventory phase 4a.

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
    key: 'stock.areas', label: 'Storage area', plural: 'Storage areas', words: ['walk-in', 'dry store', 'shelf', 'count sheet'],
    table: 'stock_areas',
    page: '/stock',
  },
  {
    key: 'stock.key_lists', label: 'Key-item list', plural: 'Key-item lists', words: ['key items', 'daily count list'],
    table: 'stock_key_lists',
    page: '/stock',
  },
]

export const notObjects = {
  'What is on hand and each item\'s ledger are worked out from the deliveries, counts and adjustments each time: figures, never kept or changed by hand.': ['stock.on_hand', 'stock.moves'],
}

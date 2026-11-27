// shared/registry/stock.js: the Stock area's business objects
// (shared/registry/index.js says what a record holds). Inventory phase 4a;
// waste, its reasons and transfers phase 4b.

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
]

export const notObjects = {
  'What is on hand and each item\'s ledger are worked out from the deliveries, counts and adjustments each time: figures, never kept or changed by hand.': ['stock.on_hand', 'stock.moves'],
}

// src/reports/starters/stock.js
//
// Starter reports on stock (inventory phase 4a): the last count's
// differences at each venue, from Count lines (the venue's latest approved
// count, whatever the period; values need Costing view and are left out
// without it), and what is on hand now (moved from purchasing with the
// subject).

import { starter } from './define.js'

/** Where these starters come in the list (index.js gathers this folder by it, then by file name). */
export const order = 62

export const starters = [
  starter({
    key: 'stock_last_count_differences',
    name: 'Last count\'s differences',
    about: 'Each venue\'s latest approved stock count: every item whose count differs from what was expected at that moment (the last approved count before it plus what was received and adjusted since), how much over or short, and what the difference is worth, biggest loss first. Sales aren\'t taken off yet, so items used in dishes show as short.',
    period: false,
    spec: {
      subject: 'stock.count_lines',
      kind: 'list',
      rows: ['item_name', 'venue.name', 'counted', 'expected', 'difference', 'base_unit', 'value', 'areas'],
      filters: [{ field: 'latest', op: 'is', value: true }, { field: 'off', op: 'is', value: true }],
      sort: [{ by: 'value', dir: 'asc' }, { by: 'item_name', dir: 'asc' }],
    },
  }),
]

// src/reports/starters/stock.js
//
// Starter reports on stock (inventory phase 4a): the last count's
// differences at each venue, from Count lines (the venue's latest approved
// count, whatever the period; values need Costing view and are left out
// without it), and what is on hand now (moved from purchasing with the
// subject). Phase 4b: this week's waste by reason (the till's voids marked
// wasted in it) and the transfers in transit.

import { starter, m } from './define.js'

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
]

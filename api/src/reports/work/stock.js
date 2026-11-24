// src/reports/work/stock.js
//
// Stock on hand worked out in code for a report run (Pepper-first step 8B3,
// migration 287), merged into WORKS in work/index.js: one row per inventory
// item per venue that was counted or received there, by the same rule as
// the Stock tab (loadStockOnHand() in services/stockSvc.js, stockOnHand() in
// shared/procurement.js): the last count plus what was received since. Sales
// aren't taken off (no recipes yet), which the subject's words say.
//
// Not by period: on hand is now. A report's venues narrow the rows.

import { loadStockOnHand } from '../../services/stockSvc.js'

// The tables on hand is worked out from (the catalogue's from.tables).
export const STOCK_TABLES = ['stock_counts', 'stock_count_lines']

export const STOCK_WORKS = {
  stock_on_hand: {
    columns: [
      ['tenant_id', 'uuid'], ['id', 'text'], ['venue_id', 'uuid'], ['item_id', 'uuid'],
      ['on_hand', 'numeric'], ['counted', 'numeric'], ['counted_at', 'timestamptz'],
      ['received_since', 'numeric'], ['never_counted', 'boolean'],
    ],
    async fill(tx, { tenantId, venueIds }) {
      const rows = await loadStockOnHand(tx, tenantId, { venueIds })
      return rows.map(r => ({
        ...r, tenant_id: tenantId, id: r.venue_id + '|' + r.item_id, never_counted: r.counted == null,
      }))
    },
  },
}

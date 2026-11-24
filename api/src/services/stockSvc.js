// src/services/stockSvc.js
//
// Stock on hand per inventory item per venue (Pepper-first step 8B3,
// migration 287): the item's last stock count at the venue plus what was
// received there since. The rule is stockOnHand() in shared/procurement.js;
// this file reads the rows it needs, for the Stock tab (routes/stock.js) and
// the report subject purchasing.stock (reports/work/stock.js).
//
// What was received: each purchase order line booked in at the venue
// (received_qty packs x the line's pack_base_qty, at the order's received_at;
// deliveries without an order count, they arrived). What sales used: nothing
// yet. No dish is linked to the items it uses (there are no recipes), so
// SALES_COUNTED is false and every answer says so.
//
//   SALES_COUNTED, NO_RECIPES_NOTE
//   loadStockOnHand(tx, tenantId, { venueIds, itemIds, allItems })
//     -> [{ venue_id, item_id, ...stockOnHand() }]: every active item at each
//        venue with allItems, else only items counted or received there

import { stockOnHand } from '../../../shared/procurement.js'

export const SALES_COUNTED = false
export const NO_RECIPES_NOTE = 'Sales aren\'t taken off: no dish is linked to the items it uses yet (no recipes), so on hand is the last count plus what was received since.'

export async function loadStockOnHand(tx, tenantId, { venueIds = null, itemIds = null, allItems = false } = {}) {
  const venueCut = venueIds ? tx`AND c.venue_id = ANY(${venueIds}::uuid[])` : tx``
  const items = itemIds ? itemIds : null
  const counts = await tx`
    SELECT DISTINCT ON (c.venue_id, l.item_id) c.venue_id, l.item_id, l.qty_base::float8 AS qty_base, c.counted_at AS at
      FROM stock_count_lines l
      JOIN stock_counts c ON c.id = l.count_id AND c.tenant_id = l.tenant_id
     WHERE l.tenant_id = ${tenantId} ${venueCut} ${items ? tx`AND l.item_id = ANY(${items}::uuid[])` : tx``}
     ORDER BY c.venue_id, l.item_id, c.counted_at DESC, c.created_at DESC`
  const receipts = await tx`
    SELECT po.venue_id, pl.item_id, (pl.received_qty * pl.pack_base_qty)::float8 AS qty_base, po.received_at AS at
      FROM purchase_order_lines pl
      JOIN purchase_orders po ON po.id = pl.po_id AND po.tenant_id = pl.tenant_id
     WHERE pl.tenant_id = ${tenantId} AND pl.item_id IS NOT NULL AND pl.received_qty > 0
       AND po.received_at IS NOT NULL AND po.status <> 'cancelled'
       ${venueIds ? tx`AND po.venue_id = ANY(${venueIds}::uuid[])` : tx``} ${items ? tx`AND pl.item_id = ANY(${items}::uuid[])` : tx``}`
  const key = (v, i) => v + '|' + i
  const countOf = new Map(counts.map(c => [key(c.venue_id, c.item_id), c]))
  const receivedOf = new Map()
  for (const r of receipts) {
    const k = key(r.venue_id, r.item_id)
    if (!receivedOf.has(k)) receivedOf.set(k, [])
    receivedOf.get(k).push(r)
  }
  const pairs = new Set([...countOf.keys(), ...receivedOf.keys()])
  if (allItems) {
    const venues = venueIds || (await tx`SELECT id FROM venues WHERE tenant_id = ${tenantId}`).map(v => v.id)
    const active = await tx`SELECT id FROM inv_items WHERE tenant_id = ${tenantId} AND is_active ${items ? tx`AND id = ANY(${items}::uuid[])` : tx``}`
    for (const v of venues) for (const i of active) pairs.add(key(v, i.id))
  }
  return [...pairs].map(k => {
    const [venue_id, item_id] = k.split('|')
    return {
      venue_id, item_id,
      ...stockOnHand({ count: countOf.get(k) || null, receipts: receivedOf.get(k) || [], usage: SALES_COUNTED ? [] : null }),
    }
  })
}

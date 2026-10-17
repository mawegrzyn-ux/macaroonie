// src/services/soldOut.js
//
// Dishes sold out at a venue (ordering_item_availability, migration 122):
// the online ordering page, the orders board, the till and the menu screens
// all read the same rows. Set from the Online orders board (routes/orders.js)
// or the till (routes/posApi.js, permission sold_out); both go through here
// so everyone showing the dish hears about it:
//   venue room       'ordering.availability'  (orders board, ordering page)
//   'pos:<venue>'    'pos.config'             (tills download their config)
//   'screens:<venue>' 'screens.sold_out'      (menu screens, with the list)
//
// sold_out_until: null = until someone puts it back; else the next local
// midnight ("today"). Rows past their time are ignored, not deleted.

import { broadcast } from '../config/ws.js'
import { httpError } from '../middleware/error.js'
import { localParts, addDays } from './orderSvc.js'

export const SOLD_OUT_MODES = ['today', 'indefinite', false]

/** Item ids sold out at the venue right now. */
export async function soldOutItemIds(tx, tenantId, venueId) {
  const rows = await tx`
    SELECT item_id FROM ordering_item_availability
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}
       AND (sold_out_until IS NULL OR sold_out_until > now())
     ORDER BY item_id`
  return rows.map(r => r.item_id)
}

/** Rows sold out right now, with their end time (null = until put back). */
export async function soldOutRows(tx, tenantId, venueId) {
  return tx`
    SELECT item_id, sold_out_until FROM ordering_item_availability
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}
       AND (sold_out_until IS NULL OR sold_out_until > now())
     ORDER BY item_id`
}

/**
 * Mark a dish sold out ('today' | 'indefinite') or back on (false).
 * venue: { id, tenant_id, timezone }. Returns { sold_out, sold_out_until }.
 */
export async function setSoldOut(tx, venue, itemId, mode) {
  if (mode === false) {
    await tx`DELETE FROM ordering_item_availability
              WHERE tenant_id = ${venue.tenant_id} AND venue_id = ${venue.id} AND item_id = ${itemId}`
    return { sold_out: false, sold_out_until: null }
  }
  // Only the tenant's own dishes: in a menu's draft, or still on a published
  // version (a dish taken out of the draft stays on the till until publish).
  const [dish] = await tx`
    SELECT 1 FROM menu_items WHERE id = ${itemId} AND tenant_id = ${venue.tenant_id}
    UNION ALL
    SELECT 1 FROM menu_releases
     WHERE tenant_id = ${venue.tenant_id} AND cancelled_at IS NULL AND snapshot::text LIKE ${'%"' + itemId + '"%'}
    LIMIT 1
  `
  if (!dish) throw httpError(404, 'Dish not found')
  let until = null
  if (mode === 'today') {
    const today = localParts(new Date(), venue.timezone || 'Europe/London').date
    const [{ ts }] = await tx`SELECT ((${addDays(today, 1)}::date)::timestamp AT TIME ZONE ${venue.timezone || 'Europe/London'}) AS ts`
    until = ts
  }
  await tx`
    INSERT INTO ordering_item_availability (venue_id, item_id, tenant_id, sold_out_until)
    VALUES (${venue.id}, ${itemId}, ${venue.tenant_id}, ${until})
    ON CONFLICT (venue_id, item_id) DO UPDATE SET sold_out_until = EXCLUDED.sold_out_until, updated_at = now()
  `
  return { sold_out: true, sold_out_until: until }
}

/** Tell everyone showing the venue's dishes. `ids` = the venue's sold out list now. */
export function announceSoldOut(venueId, itemId, result, ids) {
  try {
    broadcast(venueId, { type: 'ordering.availability', data: { item_id: itemId, ...result } })
    broadcast('pos:' + venueId, { type: 'pos.config' })
    broadcast('screens:' + venueId, { type: 'screens.sold_out', item_ids: ids })
  } catch { /* no socket server (tests, scripts) */ }
}

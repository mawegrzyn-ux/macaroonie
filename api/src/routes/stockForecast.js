// src/routes/stockForecast.js
//
// The forecast and the suggested order (inventory phase 9a, migrations 319
// and 320; docs/INVENTORY.md 9), mounted at /api/stock by src/areas/stock.js.
// The rules are shared/forecast.js, the reading services/stockForecastSvc.js;
// the order form's Suggest is purchasing's POST /api/purchasing/orders/:id/suggest,
// on the same suggestFor().
//
//   GET /venues/:venueId/suggested-order?supplier_id=&delivery_date=
//        (Stock view and any purchasing module's view): what the supplier
//        sells the venue that it orders (on its active order lists) or that
//        sales used in the last four weeks, each with its suggested packs and
//        the working; the order arriving on delivery_date (the supplier's
//        next delivery when left out, never before today) and lasting until
//        the delivery after it. No prices: { supplier_id, supplier_name,
//        today, next_delivery, after, window, buffer_pct, covers, lines }.
//        Pepper's suggested_order reads it.
//   GET /forecast-settings          { buffer_pct } (Stock view)
//   PUT /forecast-settings          { buffer_pct } (Stock manage, whole)
//
// Quantities only, so Stock view is enough for on hand (the order form's
// rule); covers are said as a share more or fewer than usual, never as
// bookings.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission, requireAnyPermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { requireOwnVenue } from '../middleware/venue.js'
import { loadVenue, loadSuppliersForVenue } from '../services/purchasingSvc.js'
import { suggestFor, supplierItems, loadBuffer } from '../services/stockForecastSvc.js'
import { venueToday } from '../services/stockUsageSvc.js'
import { bufferProblem, BUFFER_PCT_MAX } from '../../../shared/forecast.js'
import { who } from './stock.js'

const canView = requirePermission('stock', 'view')
const canManage = requirePermission('stock', 'manage')
const seesOrdering = requireAnyPermission(['purchasing', 'purchasing_setup', 'purchasing_approve'], 'view')
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const BufferBody = z.object({ buffer_pct: z.number().min(0).max(BUFFER_PCT_MAX) }).strict()

/**
 * A supplier of the group, with its settings at the venue (next delivery,
 * delivery days), else 404; the delivery day asked for, when one was, is
 * today or later at the venue (422 otherwise).
 */
export async function supplierAt(tx, tenantId, venue, supplierId, deliveryDate, today) {
  const [own] = await tx`SELECT id FROM suppliers WHERE id = ${supplierId} AND tenant_id = ${tenantId}`
  if (!own) throw httpError(404, 'Supplier not found')
  const supplier = (await loadSuppliersForVenue(tx, tenantId, venue, [supplierId]))[supplierId]
  if (deliveryDate && deliveryDate < today) throw httpError(422, 'The delivery day has gone: pick today or later', { code: 'delivery_date' })
  return supplier
}

export default async function stockForecastRoutes(app) {
  app.addHook('preHandler', requireAuth)
  app.addHook('preHandler', requireOwnVenue('venueId'))

  app.get('/venues/:venueId/suggested-order', { preHandler: [canView, seesOrdering] }, async req => {
    const q = z.object({ supplier_id: z.string().uuid(), delivery_date: Day.optional() }).parse(req.query || {})
    return withTenant(req.tenantId, async tx => {
      const venue = await loadVenue(tx, req.tenantId, req.params.venueId)
      const { today } = await venueToday(tx, req.tenantId, venue.id)
      const supplier = await supplierAt(tx, req.tenantId, venue, q.supplier_id, q.delivery_date, today)
      const items = await supplierItems(tx, req.tenantId, venue, supplier.id, { today })
      return { venue_id: venue.id, venue_name: venue.name, ...(await suggestFor(tx, req.tenantId, { venue, supplier, items, deliveryDate: q.delivery_date || null })) }
    })
  })

  app.get('/forecast-settings', { preHandler: canView }, async req =>
    withTenant(req.tenantId, async tx => ({ buffer_pct: await loadBuffer(tx, req.tenantId) })))

  app.put('/forecast-settings', { preHandler: canManage }, async req => {
    const b = BufferBody.parse(req.body || {})
    const problem = bufferProblem(b.buffer_pct)
    if (problem) throw httpError(422, problem, { code: 'buffer' })
    const me = await who(req)
    const saved = await withTenant(req.tenantId, async tx => {
      await tx`
        INSERT INTO stock_settings (tenant_id, buffer_pct, updated_at, updated_by)
        VALUES (${req.tenantId}, ${b.buffer_pct}, now(), ${me})
        ON CONFLICT (tenant_id) DO UPDATE SET buffer_pct = EXCLUDED.buffer_pct, updated_at = now(), updated_by = EXCLUDED.updated_by`
      return { buffer_pct: await loadBuffer(tx, req.tenantId) }
    })
    return saved
  })
}

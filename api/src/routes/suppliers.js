// src/routes/suppliers.js
//
// Suppliers for purchasing (migration 153), mounted at /api/suppliers:
// contact details, how orders reach them (email / print / Excel / PDF),
// cutoff, lead days, delivery days, minimum order, and per-venue
// differences (account number, delivery days, cutoff). Setup data:
// purchasing_setup view to read, manage to change. Every query filters
// tenant_id itself.

import { z }          from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError }  from '../middleware/error.js'

const uuid = z.string().uuid()
const optText = (max = 500) => z.string().trim().max(max).nullable().optional()
  .transform(v => (v === undefined ? undefined : v || null))
const time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable()
const days = z.array(z.number().int().min(0).max(6)).max(7)
const money = z.number().min(0).max(1000000).nullable()

const SupplierBody = z.object({
  name:             z.string().trim().min(1).max(200),
  contact_name:     optText(200),
  phone:            optText(60),
  email:            optText(200).refine(v => v == null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email address'),
  cc_emails:        optText(1000),
  website:          optText(500),
  account_ref:      optText(100),
  send_method:      z.enum(['email', 'print', 'excel', 'pdf']).optional(),
  email_attachment: z.enum(['none', 'pdf', 'excel']).optional(),
  cutoff_time:      time.optional(),
  lead_days:        z.number().int().min(0).max(30).optional(),
  delivery_days:    days.optional(),
  min_order:        money.optional(),
  delivery_charge:  money.optional(),
  notes:            optText(4000),
  is_active:        z.boolean().optional(),
})

const VenuesBody = z.object({
  venues: z.array(z.object({
    venue_id:      uuid,
    account_ref:   optText(100),
    delivery_days: days.nullable().optional(),
    cutoff_time:   time.optional(),
  })).max(500),
})

const canView   = requirePermission('purchasing_setup', 'view')
const canManage = requirePermission('purchasing_setup', 'manage')

const SUPPLIER_COLS = tx => tx`
  s.id, s.name, s.contact_name, s.phone, s.email, s.cc_emails, s.website, s.account_ref,
  s.send_method, s.email_attachment, s.cutoff_time::text AS cutoff_time, s.lead_days, s.delivery_days,
  s.min_order::float8 AS min_order, s.delivery_charge::float8 AS delivery_charge, s.notes, s.is_active,
  s.created_at, s.updated_at`

async function loadSupplier(tx, tenantId, id) {
  const [s] = await tx`
    SELECT ${SUPPLIER_COLS(tx)},
           (SELECT count(*)::int FROM purchase_orders po WHERE po.supplier_id = s.id AND po.tenant_id = ${tenantId}) AS po_count
      FROM suppliers s WHERE s.id = ${id} AND s.tenant_id = ${tenantId}
  `
  if (!s) throw httpError(404, 'Supplier not found')
  s.venues = await tx`
    SELECT sv.venue_id, v.name AS venue_name, sv.account_ref, sv.delivery_days, sv.cutoff_time::text AS cutoff_time
      FROM supplier_venues sv JOIN venues v ON v.id = sv.venue_id AND v.tenant_id = ${tenantId}
     WHERE sv.supplier_id = ${id} AND sv.tenant_id = ${tenantId}
     ORDER BY v.name
  `
  s.quotes = await tx`
    SELECT q.id, q.item_id, i.name AS item_name, i.base_unit, i.is_active AS item_active,
           q.supplier_code, q.product_name, q.pack_name, q.pack_unit, q.is_active,
           q.pack_count::float8 AS pack_count, q.pack_qty::float8 AS pack_qty, q.pack_base_qty::float8 AS pack_base_qty,
           q.price::float8 AS price, q.vat_rate::float8 AS vat_rate, q.updated_at
      FROM inv_quotes q JOIN inv_items i ON i.id = q.item_id AND i.tenant_id = ${tenantId}
     WHERE q.supplier_id = ${id} AND q.tenant_id = ${tenantId}
     ORDER BY lower(i.name), q.pack_base_qty
  `
  return s
}

function clean(b) {
  const out = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined))
  if (out.delivery_days) out.delivery_days = [...new Set(out.delivery_days)].sort()
  return out
}

export default async function supplierRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.get('/', { preHandler: canView }, async req => withTenant(req.tenantId, tx => tx`
    SELECT ${SUPPLIER_COLS(tx)},
           (SELECT count(*)::int FROM inv_quotes q WHERE q.supplier_id = s.id AND q.tenant_id = ${req.tenantId}) AS quote_count,
           (SELECT count(*)::int FROM purchase_orders po WHERE po.supplier_id = s.id AND po.tenant_id = ${req.tenantId}) AS po_count,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('venue_id', sv.venue_id, 'account_ref', sv.account_ref,
                                                         'delivery_days', sv.delivery_days, 'cutoff_time', sv.cutoff_time::text))
                       FROM supplier_venues sv WHERE sv.supplier_id = s.id AND sv.tenant_id = ${req.tenantId}), '[]'::jsonb) AS venues
      FROM suppliers s
     WHERE s.tenant_id = ${req.tenantId}
     ORDER BY s.is_active DESC, lower(s.name)
  `))

  app.get('/:id', { preHandler: canView }, async req =>
    withTenant(req.tenantId, tx => loadSupplier(tx, req.tenantId, req.params.id)))

  app.post('/', { preHandler: canManage }, async req => {
    const b = clean(SupplierBody.parse(req.body || {}))
    return withTenant(req.tenantId, async tx => {
      const [s] = await tx`INSERT INTO suppliers ${tx({ ...b, tenant_id: req.tenantId })} RETURNING id`
      return loadSupplier(tx, req.tenantId, s.id)
    })
  })

  app.patch('/:id', { preHandler: canManage }, async req => {
    const b = clean(SupplierBody.partial().parse(req.body || {}))
    return withTenant(req.tenantId, async tx => {
      const [s] = await tx`SELECT id FROM suppliers WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}`
      if (!s) throw httpError(404, 'Supplier not found')
      if (Object.keys(b).length) {
        await tx`UPDATE suppliers SET ${tx(b)}, updated_at = now() WHERE id = ${s.id} AND tenant_id = ${req.tenantId}`
      }
      return loadSupplier(tx, req.tenantId, s.id)
    })
  })

  // A supplier with purchase orders can only be switched off (orders keep it).
  app.delete('/:id', { preHandler: canManage }, async req => withTenant(req.tenantId, async tx => {
    const [s] = await tx`SELECT id FROM suppliers WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}`
    if (!s) throw httpError(404, 'Supplier not found')
    const [po] = await tx`SELECT 1 FROM purchase_orders WHERE supplier_id = ${s.id} AND tenant_id = ${req.tenantId} LIMIT 1`
    if (po) throw httpError(409, 'This supplier has orders. Switch it off instead of deleting it.')
    await tx`DELETE FROM suppliers WHERE id = ${s.id} AND tenant_id = ${req.tenantId}`
    return { ok: true }
  }))

  // Replaces every per-venue setting for the supplier. A venue left out (or
  // with nothing set) uses the supplier's own settings.
  app.put('/:id/venues', { preHandler: canManage }, async req => {
    const { venues } = VenuesBody.parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const [s] = await tx`SELECT id FROM suppliers WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}`
      if (!s) throw httpError(404, 'Supplier not found')
      const ids = venues.map(v => v.venue_id)
      if (ids.length) {
        const own = await tx`SELECT id FROM venues WHERE id = ANY(${ids}::uuid[]) AND tenant_id = ${req.tenantId}`
        if (own.length !== new Set(ids).size) throw httpError(404, 'Venue not found')
      }
      await tx`DELETE FROM supplier_venues WHERE supplier_id = ${s.id} AND tenant_id = ${req.tenantId}`
      const rows = venues
        .filter(v => v.account_ref || v.delivery_days != null || v.cutoff_time)
        .map(v => ({
          supplier_id: s.id, venue_id: v.venue_id, tenant_id: req.tenantId,
          account_ref: v.account_ref ?? null,
          delivery_days: v.delivery_days == null ? null : [...new Set(v.delivery_days)].sort(),
          cutoff_time: v.cutoff_time ?? null,
        }))
      if (rows.length) await tx`INSERT INTO supplier_venues ${tx(rows)}`
      return loadSupplier(tx, req.tenantId, s.id)
    })
  })
}

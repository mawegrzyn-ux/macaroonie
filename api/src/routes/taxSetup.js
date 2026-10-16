// src/routes/taxSetup.js
//
// Tax rates and order types (migration 170; shared/tax.js), mounted at /api.
//
//   GET    /tax-rates                     the tenant's rates (with per-location %s), locations, order types, revenue streams
//   POST   /tax-rates                     { name, rate }
//   PATCH  /tax-rates/:id                 { name?, rate?, is_default?, is_active? }
//   PUT    /tax-rates/order               { ids }
//   PUT    /tax-rates/:id/values          { values: { venueId: rate | null } } (null = the rate's own %)
//   DELETE /tax-rates/:id                 removes it from the lists (kept for history; refused
//                                         while it is the default or a draft menu names it)
//   GET    /tax-rates/check?venue_id=&stream_id=   every draft dish's rate per order type there
//
//   GET    /order-types                   the tenant's order types
//   POST   /order-types                   { name, colour }
//   PATCH  /order-types/:id               { name?, colour?, is_active? }
//   PUT    /order-types/order             { ids }
//   DELETE /order-types/:id               removes it from the lists (kept for history)
//
// Reads are open to anyone signed in (menus, the till setup, ordering setup
// and Deliveroo all pick from them). Tax rates change with Menus manage;
// order types with Till setup or Ordering setup manage.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission, requireAnyPermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { notifyTillsOnWrite } from '../services/posNotify.js'
import { ensureTaxDefaults, loadTaxRates, loadOrderTypes } from '../services/taxSvc.js'
import { taxFor } from '../../../shared/tax.js'

const UUID = z.string().uuid()
const RATE = z.number().min(0).max(100)
const canTax = requirePermission('menus', 'manage')
const canTypes = requireAnyPermission(['pos_setup', 'web_ordering_setup'], 'manage')

const RateBody = z.object({ name: z.string().trim().min(1).max(60), rate: RATE })
const RatePatch = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  rate: RATE.optional(),
  is_default: z.literal(true).optional(),
  is_active: z.boolean().optional(),
})
const ValuesBody = z.object({ values: z.record(UUID, RATE.nullable()) })
const OrderBody = z.object({ ids: z.array(UUID).max(200) })
const TypeBody = z.object({ name: z.string().trim().min(1).max(40), colour: z.string().max(20).nullable().optional() })
const TypePatch = TypeBody.partial().extend({ is_active: z.boolean().optional() })

async function ownRate(tx, tenantId, id) {
  const [r] = await tx`SELECT * FROM tax_rates WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!r) throw httpError(404, 'Tax rate not found')
  return r
}

async function ownType(tx, tenantId, id) {
  const [r] = await tx`SELECT * FROM order_types WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!r) throw httpError(404, 'Order type not found')
  return r
}

/** Draft menus that name a rate anywhere (menu, section or dish setting). */
async function menusNaming(tx, tenantId, rateId) {
  const like = '%' + rateId + '%'
  return tx`
    SELECT DISTINCT m.name FROM menus m
     WHERE m.tenant_id = ${tenantId}
       AND (m.tax::text LIKE ${like}
         OR EXISTS (SELECT 1 FROM menu_sections s WHERE s.menu_id = m.id AND s.tenant_id = ${tenantId} AND s.tax::text LIKE ${like})
         OR EXISTS (SELECT 1 FROM menu_items i JOIN menu_sections s ON s.id = i.section_id
                     WHERE s.menu_id = m.id AND i.tenant_id = ${tenantId} AND i.tax::text LIKE ${like}))
     ORDER BY m.name`
}

export default async function taxSetupRoutes(app) {
  app.addHook('preHandler', requireAuth)
  // Tills keep rates and order types in their config: any change tells them.
  app.addHook('onResponse', notifyTillsOnWrite)

  // ── Tax rates ────────────────────────────────────────────────
  // Also the order types and every location's revenue streams: what a tax
  // exception can name (the Tax boxes on Menus).
  app.get('/tax-rates', async req => withTenant(req.tenantId, async tx => {
    await ensureTaxDefaults(tx, req.tenantId)
    const [rates, venues, orderTypes, streams] = await Promise.all([
      loadTaxRates(tx, req.tenantId),
      tx`SELECT id, name FROM venues WHERE tenant_id = ${req.tenantId} AND is_active ORDER BY name`,
      loadOrderTypes(tx, req.tenantId),
      tx`SELECT id, name, venue_id, is_active FROM pos_revenue_streams WHERE tenant_id = ${req.tenantId} ORDER BY sort_order, name`,
    ])
    return { rates, venues, order_types: orderTypes, streams }
  }))

  app.post('/tax-rates', { preHandler: canTax }, async (req, reply) => {
    const body = RateBody.parse(req.body)
    const row = await withTenant(req.tenantId, async tx => {
      await ensureTaxDefaults(tx, req.tenantId)
      const [{ n }] = await tx`SELECT COALESCE(max(sort_order), -1)::int + 1 AS n FROM tax_rates WHERE tenant_id = ${req.tenantId}`
      const [r] = await tx`INSERT INTO tax_rates (tenant_id, name, rate, sort_order)
                           VALUES (${req.tenantId}, ${body.name}, ${body.rate}, ${n}) RETURNING id`
      return r
    })
    return reply.code(201).send(row)
  })

  app.patch('/tax-rates/:id', { preHandler: canTax }, async req => {
    const id = UUID.parse(req.params.id)
    const body = RatePatch.parse(req.body)
    await withTenant(req.tenantId, async tx => {
      const r = await ownRate(tx, req.tenantId, id)
      if (body.is_active === false) {
        if (r.is_default) throw httpError(422, 'Make another rate the default first')
        const names = await menusNaming(tx, req.tenantId, id)
        if (names.length) throw httpError(422, 'These menus use it: ' + names.map(x => x.name).join(', ') + '. Change them first.')
      }
      if (body.is_default) {
        if (!r.is_active && body.is_active !== true) throw httpError(422, 'Put the rate back before making it the default')
        await tx`UPDATE tax_rates SET is_default = false WHERE tenant_id = ${req.tenantId} AND is_default AND id <> ${id}`
      }
      await tx`
        UPDATE tax_rates
           SET name = ${body.name ?? r.name}, rate = ${body.rate ?? r.rate},
               is_default = ${body.is_default ?? r.is_default}, is_active = ${body.is_active ?? r.is_active}
         WHERE id = ${id} AND tenant_id = ${req.tenantId}`
    })
    return { ok: true }
  })

  app.put('/tax-rates/order', { preHandler: canTax }, async req => {
    const { ids } = OrderBody.parse(req.body)
    await withTenant(req.tenantId, async tx => {
      for (const [i, id] of ids.entries()) {
        await tx`UPDATE tax_rates SET sort_order = ${i} WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      }
    })
    return { ok: true }
  })

  app.put('/tax-rates/:id/values', { preHandler: canTax }, async req => {
    const id = UUID.parse(req.params.id)
    const { values } = ValuesBody.parse(req.body)
    await withTenant(req.tenantId, async tx => {
      await ownRate(tx, req.tenantId, id)
      const venues = new Set((await tx`SELECT id FROM venues WHERE tenant_id = ${req.tenantId}`).map(v => v.id))
      for (const [venueId, rate] of Object.entries(values)) {
        if (!venues.has(venueId)) throw httpError(422, 'Location not found')
        if (rate == null) {
          await tx`DELETE FROM tax_rate_values WHERE tax_rate_id = ${id} AND venue_id = ${venueId} AND tenant_id = ${req.tenantId}`
        } else {
          await tx`
            INSERT INTO tax_rate_values (tax_rate_id, venue_id, tenant_id, rate) VALUES (${id}, ${venueId}, ${req.tenantId}, ${rate})
            ON CONFLICT (tax_rate_id, venue_id) DO UPDATE SET rate = EXCLUDED.rate`
        }
      }
    })
    return { ok: true }
  })

  app.delete('/tax-rates/:id', { preHandler: canTax }, async req => {
    const id = UUID.parse(req.params.id)
    await withTenant(req.tenantId, async tx => {
      const r = await ownRate(tx, req.tenantId, id)
      if (r.is_default) throw httpError(422, 'Make another rate the default first')
      const names = await menusNaming(tx, req.tenantId, id)
      if (names.length) throw httpError(422, 'These menus use it: ' + names.map(x => x.name).join(', ') + '. Change them first.')
      await tx`UPDATE tax_rates SET is_active = false WHERE id = ${id} AND tenant_id = ${req.tenantId}`
    })
    return { ok: true }
  })

  // Every dish of the draft menus with its rate for each order type, at one
  // location (and revenue stream). Draft, because it checks what is being set up.
  app.get('/tax-rates/check', async req => {
    const q = z.object({ venue_id: UUID, stream_id: UUID.optional(), menu_id: UUID.optional() }).parse(req.query)
    return withTenant(req.tenantId, async tx => {
      const [venue] = await tx`SELECT id FROM venues WHERE id = ${q.venue_id} AND tenant_id = ${req.tenantId}`
      if (!venue) throw httpError(404, 'Location not found')
      if (q.stream_id) {
        const [s] = await tx`SELECT id FROM pos_revenue_streams WHERE id = ${q.stream_id} AND venue_id = ${q.venue_id} AND tenant_id = ${req.tenantId}`
        if (!s) throw httpError(404, 'Revenue stream not found')
      }
      await ensureTaxDefaults(tx, req.tenantId)
      const [rates, types, menus, sections, items] = await Promise.all([
        loadTaxRates(tx, req.tenantId),
        loadOrderTypes(tx, req.tenantId),
        tx`SELECT id, name, tax FROM menus WHERE tenant_id = ${req.tenantId}
             ${q.menu_id ? tx`AND id = ${q.menu_id}` : tx``}
             AND (venue_id IS NULL OR venue_id = ${q.venue_id}) ORDER BY sort_order, name`,
        tx`SELECT id, menu_id, title, tax FROM menu_sections WHERE tenant_id = ${req.tenantId} ORDER BY sort_order`,
        tx`SELECT id, section_id, name, tax FROM menu_items WHERE tenant_id = ${req.tenantId} ORDER BY sort_order`,
      ])
      const activeTypes = types.filter(t => t.is_active)
      return {
        order_types: activeTypes,
        rates,
        menus: menus.map(m => ({
          id: m.id, name: m.name,
          sections: sections.filter(s => s.menu_id === m.id).map(s => ({
            id: s.id, title: s.title,
            items: items.filter(i => i.section_id === s.id).map(i => ({
              id: i.id, name: i.name,
              rates: Object.fromEntries(activeTypes.map(t => {
                const r = taxFor([i.tax, s.tax, m.tax], { venue_id: q.venue_id, order_type_id: t.id, revenue_stream_id: q.stream_id || null }, rates)
                return [t.id, { rate_id: r.tax_rate_id, vat_rate: r.vat_rate, from: r.from }]
              })),
            })),
          })),
        })),
      }
    })
  })

  // ── Order types ──────────────────────────────────────────────
  app.get('/order-types', async req => withTenant(req.tenantId, async tx => {
    await ensureTaxDefaults(tx, req.tenantId)
    return loadOrderTypes(tx, req.tenantId)
  }))

  app.post('/order-types', { preHandler: canTypes }, async (req, reply) => {
    const body = TypeBody.parse(req.body)
    const row = await withTenant(req.tenantId, async tx => {
      await ensureTaxDefaults(tx, req.tenantId)
      const [{ n }] = await tx`SELECT COALESCE(max(sort_order), -1)::int + 1 AS n FROM order_types WHERE tenant_id = ${req.tenantId}`
      const [r] = await tx`INSERT INTO order_types (tenant_id, name, colour, sort_order)
                           VALUES (${req.tenantId}, ${body.name}, ${body.colour ?? null}, ${n}) RETURNING id`
      return r
    })
    return reply.code(201).send(row)
  })

  app.patch('/order-types/:id', { preHandler: canTypes }, async req => {
    const id = UUID.parse(req.params.id)
    const body = TypePatch.parse(req.body)
    await withTenant(req.tenantId, async tx => {
      const t = await ownType(tx, req.tenantId, id)
      await tx`
        UPDATE order_types
           SET name = ${body.name ?? t.name}, colour = ${body.colour !== undefined ? body.colour : t.colour},
               is_active = ${body.is_active ?? t.is_active}
         WHERE id = ${id} AND tenant_id = ${req.tenantId}`
    })
    return { ok: true }
  })

  app.put('/order-types/order', { preHandler: canTypes }, async req => {
    const { ids } = OrderBody.parse(req.body)
    await withTenant(req.tenantId, async tx => {
      for (const [i, id] of ids.entries()) {
        await tx`UPDATE order_types SET sort_order = ${i} WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      }
    })
    return { ok: true }
  })

  // Kept (old checks, orders and tax exceptions name it), just off every list.
  app.delete('/order-types/:id', { preHandler: canTypes }, async req => {
    const id = UUID.parse(req.params.id)
    await withTenant(req.tenantId, async tx => {
      await ownType(tx, req.tenantId, id)
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM order_types WHERE tenant_id = ${req.tenantId} AND is_active AND id <> ${id}`
      if (!n) throw httpError(422, 'Keep at least one order type')
      await tx`UPDATE order_types SET is_active = false WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      await tx`UPDATE pos_revenue_streams SET default_order_type_id = NULL WHERE tenant_id = ${req.tenantId} AND default_order_type_id = ${id}`
    })
    return { ok: true }
  })
}


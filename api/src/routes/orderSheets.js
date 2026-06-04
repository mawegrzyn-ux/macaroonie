// src/routes/orderSheets.js
//
// Order Sheets feature: templates + orders for supplier order management.
// Mounted at /api/order-sheets in app.js.

import { z }          from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { httpError }  from '../middleware/error.js'

// ── Schemas ───────────────────────────────────────────────────

const TemplateBody = z.object({
  name:        z.string().min(1).max(200),
  show_prices: z.boolean().optional().default(false),
  venue_ids:   z.array(z.string().uuid()).optional().default([]),
})

const TemplatePatch = z.object({
  name:        z.string().min(1).max(200).optional(),
  show_prices: z.boolean().optional(),
  is_active:   z.boolean().optional(),
  sort_order:  z.number().int().optional(),
})

const VenueIdsBody = z.object({
  venue_ids: z.array(z.string().uuid()),
})

const ItemBody = z.object({
  name:  z.string().min(1).max(200),
  unit:  z.string().min(1).max(100),
  price: z.number().positive().nullable().optional(),
})

const ItemPatch = z.object({
  name:       z.string().min(1).max(200).optional(),
  unit:       z.string().min(1).max(100).optional(),
  price:      z.number().positive().nullable().optional(),
  sort_order: z.number().int().optional(),
})

const ItemOrderBody = z.object({
  ids: z.array(z.string().uuid()),
})

const SuggestedBody = z.object({
  venue_qtys: z.array(z.object({
    venue_id: z.string().uuid(),
    qty:      z.number().min(0),
  })),
})

const OrderBody = z.object({
  template_id:   z.string().uuid(),
  venue_id:      z.string().uuid(),
  delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes:         z.string().nullable().optional(),
})

const OrderPatch = z.object({
  notes:         z.string().nullable().optional(),
  delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

const OrderItemsBody = z.object({
  items: z.array(z.object({
    item_id:    z.string().uuid(),
    qty:        z.number().min(0).nullable().optional(),
    unit_price: z.number().positive().nullable().optional(),
  })),
})

const OrderStatusBody = z.object({
  status: z.enum(['ordering', 'ready', 'placed']),
})

// ── Helpers ───────────────────────────────────────────────────

/** Allowed status transitions: { from: [allowed tos] } */
const TRANSITIONS = {
  ordering: ['ready'],
  ready:    ['placed', 'ordering'],
  placed:   ['ready', 'ordering'],
}

/** Transitions that require admin/owner role */
const ADMIN_TRANSITIONS = new Set([
  'ready->ordering',
  'placed->ready',
  'placed->ordering',
])

// ── Plugin ────────────────────────────────────────────────────

export default async function orderSheetsRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // ── GET /templates ──────────────────────────────────────────
  app.get('/templates', async (req) => {
    return withTenant(req.tenantId, tx => tx`
      SELECT
        t.id,
        t.name,
        t.show_prices,
        t.is_active,
        t.sort_order,
        t.created_at,
        t.updated_at,
        COALESCE(
          array_agg(DISTINCT tv.venue_id) FILTER (WHERE tv.venue_id IS NOT NULL),
          '{}'
        ) AS venue_ids,
        COUNT(DISTINCT i.id)::int AS item_count
      FROM order_sheet_templates t
      LEFT JOIN order_sheet_template_venues tv ON tv.template_id = t.id
      LEFT JOIN order_sheet_items i ON i.template_id = t.id
      GROUP BY t.id
      ORDER BY t.sort_order, t.name
    `)
  })

  // ── GET /templates/:id ──────────────────────────────────────
  app.get('/templates/:id', async (req) => {
    const { id } = req.params
    const [tmpl] = await withTenant(req.tenantId, tx => tx`
      SELECT
        t.id,
        t.name,
        t.show_prices,
        t.is_active,
        t.sort_order,
        t.created_at,
        t.updated_at,
        COALESCE(
          array_agg(DISTINCT tv.venue_id) FILTER (WHERE tv.venue_id IS NOT NULL),
          '{}'
        ) AS venue_ids
      FROM order_sheet_templates t
      LEFT JOIN order_sheet_template_venues tv ON tv.template_id = t.id
      WHERE t.id = ${id}
      GROUP BY t.id
    `)
    if (!tmpl) throw httpError(404, 'Template not found')

    const items = await withTenant(req.tenantId, tx => tx`
      SELECT
        i.id,
        i.name,
        i.unit,
        i.price,
        i.sort_order,
        i.created_at,
        COALESCE(
          json_object_agg(sq.venue_id::text, sq.qty) FILTER (WHERE sq.venue_id IS NOT NULL),
          '{}'::json
        ) AS suggested_qty
      FROM order_sheet_items i
      LEFT JOIN order_sheet_suggested_qty sq ON sq.item_id = i.id
      WHERE i.template_id = ${id}
      GROUP BY i.id
      ORDER BY i.sort_order, i.created_at
    `)

    return { ...tmpl, items }
  })

  // ── POST /templates ─────────────────────────────────────────
  app.post('/templates', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const body = TemplateBody.parse(req.body)

    const [tmpl] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO order_sheet_templates (tenant_id, name, show_prices)
      VALUES (${req.tenantId}, ${body.name}, ${body.show_prices})
      RETURNING *
    `)

    if (body.venue_ids.length > 0) {
      const rows = body.venue_ids.map(vid => ({ template_id: tmpl.id, venue_id: vid }))
      await withTenant(req.tenantId, tx => tx`
        INSERT INTO order_sheet_template_venues ${tx(rows)}
        ON CONFLICT DO NOTHING
      `)
    }

    return { ...tmpl, venue_ids: body.venue_ids, item_count: 0 }
  })

  // ── PATCH /templates/:id ────────────────────────────────────
  app.patch('/templates/:id', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const { id } = req.params
    const body = TemplatePatch.parse(req.body)

    const fields = Object.keys(body).filter(k => body[k] !== undefined)
    if (fields.length === 0) throw httpError(400, 'No fields to update')

    const updates = Object.fromEntries(fields.map(k => [k, body[k]]))
    const [tmpl] = await withTenant(req.tenantId, tx => tx`
      UPDATE order_sheet_templates
      SET ${tx(updates, ...fields)}, updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `)
    if (!tmpl) throw httpError(404, 'Template not found')
    return tmpl
  })

  // ── DELETE /templates/:id ───────────────────────────────────
  app.delete('/templates/:id', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const { id } = req.params
    await withTenant(req.tenantId, tx => tx`
      DELETE FROM order_sheet_templates WHERE id = ${id}
    `)
    return { ok: true }
  })

  // ── PUT /templates/:id/venues ───────────────────────────────
  app.put('/templates/:id/venues', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const { id } = req.params
    const { venue_ids } = VenueIdsBody.parse(req.body)

    // Verify template exists
    const [tmpl] = await withTenant(req.tenantId, tx => tx`
      SELECT id FROM order_sheet_templates WHERE id = ${id}
    `)
    if (!tmpl) throw httpError(404, 'Template not found')

    await withTenant(req.tenantId, async tx => {
      await tx`DELETE FROM order_sheet_template_venues WHERE template_id = ${id}`
      if (venue_ids.length > 0) {
        const rows = venue_ids.map(vid => ({ template_id: id, venue_id: vid }))
        await tx`INSERT INTO order_sheet_template_venues ${tx(rows)} ON CONFLICT DO NOTHING`
      }
    })

    return { ok: true, venue_ids }
  })

  // ── POST /templates/:id/items ───────────────────────────────
  app.post('/templates/:id/items', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const { id } = req.params
    const body = ItemBody.parse(req.body)

    // Verify template exists
    const [tmpl] = await withTenant(req.tenantId, tx => tx`
      SELECT id FROM order_sheet_templates WHERE id = ${id}
    `)
    if (!tmpl) throw httpError(404, 'Template not found')

    const [maxRow] = await withTenant(req.tenantId, tx => tx`
      SELECT COALESCE(MAX(sort_order), -1) AS max_order
      FROM order_sheet_items WHERE template_id = ${id}
    `)
    const sortOrder = (maxRow?.max_order ?? -1) + 1

    const [item] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO order_sheet_items (template_id, name, unit, price, sort_order)
      VALUES (${id}, ${body.name}, ${body.unit}, ${body.price ?? null}, ${sortOrder})
      RETURNING *
    `)
    return item
  })

  // ── PATCH /templates/:id/items/:itemId ──────────────────────
  app.patch('/templates/:id/items/:itemId', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const { id, itemId } = req.params
    const body = ItemPatch.parse(req.body)

    const fields = Object.keys(body).filter(k => body[k] !== undefined)
    if (fields.length === 0) throw httpError(400, 'No fields to update')

    const updates = Object.fromEntries(fields.map(k => [k, body[k]]))
    const [item] = await withTenant(req.tenantId, tx => tx`
      UPDATE order_sheet_items
      SET ${tx(updates, ...fields)}
      WHERE id = ${itemId} AND template_id = ${id}
      RETURNING *
    `)
    if (!item) throw httpError(404, 'Item not found')
    return item
  })

  // ── DELETE /templates/:id/items/:itemId ─────────────────────
  app.delete('/templates/:id/items/:itemId', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const { id, itemId } = req.params
    await withTenant(req.tenantId, tx => tx`
      DELETE FROM order_sheet_items WHERE id = ${itemId} AND template_id = ${id}
    `)
    return { ok: true }
  })

  // ── PATCH /templates/:id/item-order ─────────────────────────
  app.patch('/templates/:id/item-order', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const { id } = req.params
    const { ids } = ItemOrderBody.parse(req.body)

    await withTenant(req.tenantId, async tx => {
      for (let i = 0; i < ids.length; i++) {
        await tx`
          UPDATE order_sheet_items
          SET sort_order = ${i}
          WHERE id = ${ids[i]} AND template_id = ${id}
        `
      }
    })
    return { ok: true }
  })

  // ── PUT /templates/:id/items/:itemId/suggested ───────────────
  app.put('/templates/:id/items/:itemId/suggested', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const { id, itemId } = req.params
    const { venue_qtys } = SuggestedBody.parse(req.body)

    // Verify item belongs to template
    const [item] = await withTenant(req.tenantId, tx => tx`
      SELECT id FROM order_sheet_items WHERE id = ${itemId} AND template_id = ${id}
    `)
    if (!item) throw httpError(404, 'Item not found')

    await withTenant(req.tenantId, async tx => {
      await tx`DELETE FROM order_sheet_suggested_qty WHERE item_id = ${itemId}`
      if (venue_qtys.length > 0) {
        const rows = venue_qtys.map(vq => ({ item_id: itemId, venue_id: vq.venue_id, qty: vq.qty }))
        await tx`INSERT INTO order_sheet_suggested_qty ${tx(rows)} ON CONFLICT DO NOTHING`
      }
    })

    return { ok: true }
  })

  // ── GET /orders ──────────────────────────────────────────────
  app.get('/orders', async (req) => {
    const { status, venue_id, template_id } = req.query

    const statuses = status
      ? status.split(',').map(s => s.trim()).filter(s => ['ordering','ready','placed'].includes(s))
      : ['ordering']

    return withTenant(req.tenantId, tx => {
      const statusFilter   = tx`AND o.status = ANY(${statuses})`
      const venueFilter    = venue_id    ? tx`AND o.venue_id    = ${venue_id}`    : tx``
      const templateFilter = template_id ? tx`AND o.template_id = ${template_id}` : tx``

      return tx`
        SELECT
          o.id,
          o.template_id,
          o.venue_id,
          o.delivery_date,
          o.status,
          o.notes,
          o.created_by,
          o.ready_at,
          o.placed_at,
          o.created_at,
          o.updated_at,
          t.name        AS template_name,
          t.show_prices,
          v.name        AS venue_name,
          COUNT(DISTINCT i.id)::int  AS item_count,
          COUNT(DISTINCT oi.id)::int AS filled_count
        FROM order_sheets o
        JOIN order_sheet_templates t ON t.id = o.template_id
        JOIN venues v ON v.id = o.venue_id
        LEFT JOIN order_sheet_items i ON i.template_id = o.template_id
        LEFT JOIN order_sheet_order_items oi
          ON oi.order_id = o.id AND oi.item_id = i.id AND oi.qty IS NOT NULL
        WHERE 1=1
          ${statusFilter}
          ${venueFilter}
          ${templateFilter}
        GROUP BY o.id, t.name, t.show_prices, v.name
        ORDER BY o.delivery_date DESC, o.created_at DESC
      `
    })
  })

  // ── GET /orders/:id ──────────────────────────────────────────
  app.get('/orders/:id', async (req) => {
    const { id } = req.params

    const [order] = await withTenant(req.tenantId, tx => tx`
      SELECT
        o.*,
        t.name        AS template_name,
        t.show_prices,
        v.name        AS venue_name
      FROM order_sheets o
      JOIN order_sheet_templates t ON t.id = o.template_id
      JOIN venues v ON v.id = o.venue_id
      WHERE o.id = ${id}
    `)
    if (!order) throw httpError(404, 'Order not found')

    const items = await withTenant(req.tenantId, tx => tx`
      SELECT
        i.id,
        i.name,
        i.unit,
        i.price,
        i.sort_order,
        oi.qty,
        oi.unit_price,
        COALESCE(sq.qty, NULL) AS suggested_qty
      FROM order_sheet_items i
      LEFT JOIN order_sheet_order_items oi ON oi.order_id = ${id} AND oi.item_id = i.id
      LEFT JOIN order_sheet_suggested_qty sq ON sq.item_id = i.id AND sq.venue_id = ${order.venue_id}
      WHERE i.template_id = ${order.template_id}
      ORDER BY i.sort_order, i.created_at
    `)

    // Last 3 non-ordering orders for same template+venue (excluding current)
    const history = await withTenant(req.tenantId, tx => tx`
      SELECT
        o2.id,
        o2.delivery_date,
        COALESCE(
          json_object_agg(oi2.item_id::text, oi2.qty),
          '{}'::json
        ) AS item_qtys
      FROM order_sheets o2
      LEFT JOIN order_sheet_order_items oi2 ON oi2.order_id = o2.id
      WHERE o2.template_id = ${order.template_id}
        AND o2.venue_id    = ${order.venue_id}
        AND o2.status     != 'ordering'
        AND o2.id         != ${id}
      GROUP BY o2.id
      ORDER BY o2.delivery_date DESC, o2.created_at DESC
      LIMIT 3
    `)

    return { ...order, items, history }
  })

  // ── POST /orders ─────────────────────────────────────────────
  app.post('/orders', async (req) => {
    const body = OrderBody.parse(req.body)

    // Verify template is assigned to venue
    const [assignment] = await withTenant(req.tenantId, tx => tx`
      SELECT tv.venue_id
      FROM order_sheet_template_venues tv
      JOIN order_sheet_templates t ON t.id = tv.template_id
      WHERE t.id = ${body.template_id}
        AND tv.venue_id = ${body.venue_id}
    `)
    if (!assignment) throw httpError(422, 'Template is not assigned to this venue')

    const [order] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO order_sheets (tenant_id, template_id, venue_id, delivery_date, notes, created_by)
      VALUES (
        ${req.tenantId},
        ${body.template_id},
        ${body.venue_id},
        ${body.delivery_date},
        ${body.notes ?? null},
        ${req.user.id ?? null}
      )
      RETURNING *
    `)
    return order
  })

  // ── PATCH /orders/:id ────────────────────────────────────────
  app.patch('/orders/:id', async (req) => {
    const { id } = req.params
    const body = OrderPatch.parse(req.body)

    const [current] = await withTenant(req.tenantId, tx => tx`
      SELECT id, status FROM order_sheets WHERE id = ${id}
    `)
    if (!current) throw httpError(404, 'Order not found')
    if (current.status !== 'ordering') throw httpError(403, 'Order is locked — only ordering orders can be edited')

    const fields = Object.keys(body).filter(k => body[k] !== undefined)
    if (fields.length === 0) throw httpError(400, 'No fields to update')

    const updates = Object.fromEntries(fields.map(k => [k, body[k]]))
    const [order] = await withTenant(req.tenantId, tx => tx`
      UPDATE order_sheets
      SET ${tx(updates, ...fields)}, updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `)
    return order
  })

  // ── PUT /orders/:id/items ────────────────────────────────────
  app.put('/orders/:id/items', async (req) => {
    const { id } = req.params
    const { items } = OrderItemsBody.parse(req.body)

    const [current] = await withTenant(req.tenantId, tx => tx`
      SELECT id, status FROM order_sheets WHERE id = ${id}
    `)
    if (!current) throw httpError(404, 'Order not found')
    if (current.status !== 'ordering') throw httpError(403, 'Order is locked — only ordering orders can be edited')

    await withTenant(req.tenantId, async tx => {
      await tx`DELETE FROM order_sheet_order_items WHERE order_id = ${id}`
      if (items.length > 0) {
        const rows = items.map(it => ({
          order_id:   id,
          item_id:    it.item_id,
          qty:        it.qty ?? null,
          unit_price: it.unit_price ?? null,
        }))
        await tx`INSERT INTO order_sheet_order_items ${tx(rows)}`
      }
    })

    const [updated] = await withTenant(req.tenantId, tx => tx`
      UPDATE order_sheets SET updated_at = now() WHERE id = ${id} RETURNING *
    `)
    return updated
  })

  // ── PATCH /orders/:id/status ─────────────────────────────────
  app.patch('/orders/:id/status', async (req) => {
    const { id } = req.params
    const { status: newStatus } = OrderStatusBody.parse(req.body)

    const [current] = await withTenant(req.tenantId, tx => tx`
      SELECT id, status FROM order_sheets WHERE id = ${id}
    `)
    if (!current) throw httpError(404, 'Order not found')

    const allowed = TRANSITIONS[current.status] ?? []
    if (!allowed.includes(newStatus)) {
      throw httpError(422, `Cannot transition from ${current.status} to ${newStatus}`)
    }

    const transKey = `${current.status}->${newStatus}`
    if (ADMIN_TRANSITIONS.has(transKey)) {
      if (!['admin', 'owner'].includes(req.user.role)) {
        throw httpError(403, 'Only admin or owner can perform this status change')
      }
    }

    // Build timestamp fields
    const now = new Date()
    let extra = {}
    if (newStatus === 'ready')    extra = { ready_at: now,  placed_at: null }
    if (newStatus === 'placed')   extra = { placed_at: now }
    if (newStatus === 'ordering') extra = { ready_at: null, placed_at: null }

    const updates = { status: newStatus, ...extra }
    const fields = Object.keys(updates)
    const [order] = await withTenant(req.tenantId, tx => tx`
      UPDATE order_sheets
      SET ${tx(updates, ...fields)}, updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `)
    return order
  })

  // ── DELETE /orders/:id ───────────────────────────────────────
  app.delete('/orders/:id', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const { id } = req.params
    await withTenant(req.tenantId, tx => tx`
      DELETE FROM order_sheets WHERE id = ${id}
    `)
    return { ok: true }
  })
}

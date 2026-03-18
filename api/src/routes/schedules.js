// src/routes/schedules.js
// GET|PUT  /venues/:id/schedule/template/:dow
// POST     /venues/:id/schedule/template/:dow/sittings
// PATCH    /venues/:id/schedule/sittings/:sid
// PUT      /venues/:id/schedule/sittings/:sid/caps     (replace all caps for a sitting)
// GET      /venues/:id/schedule/overrides
// POST     /venues/:id/schedule/overrides
// PATCH    /venues/:id/schedule/overrides/:oid
// DELETE   /venues/:id/schedule/overrides/:oid
// POST     /venues/:id/schedule/overrides/:oid/sittings
// PATCH    /venues/:id/schedule/overrides/sittings/:sid
// PUT      /venues/:id/schedule/overrides/sittings/:sid/caps

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'

const DOW = z.coerce.number().int().min(0).max(6)

const TemplateBody = z.object({
  is_open:            z.boolean(),
  slot_interval_mins: z.union([z.literal(15), z.literal(30), z.literal(60)]).default(15),
})

const SittingBody = z.object({
  opens_at:            z.string().regex(/^\d{2}:\d{2}$/),
  closes_at:           z.string().regex(/^\d{2}:\d{2}$/),
  default_max_covers:  z.number().int().min(0).nullable().default(null),
  sort_order:          z.number().int().default(0),
})

// Array of { slot_time, max_covers } — replaces all caps for a sitting
const CapsBody = z.array(z.object({
  slot_time:   z.string().regex(/^\d{2}:\d{2}$/),
  max_covers:  z.number().int().min(0),
}))

const OverrideBody = z.object({
  override_date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  is_open:            z.boolean().default(true),
  slot_interval_mins: z.union([z.literal(15), z.literal(30), z.literal(60)]).nullable().optional(),
  label:              z.string().max(200).nullable().optional(),
})

export default async function schedulesRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // ── GET full schedule for a venue ────────────────────────
  // Returns all 7 day templates + their sittings + caps in one shot.
  // Useful for the admin schedule editor to hydrate the full UI.
  app.get('/:venueId/schedule', async (req) => {
    const { venueId } = req.params
    return withTenant(req.tenantId, async tx => {
      const templates = await tx`
        SELECT t.*,
               COALESCE(json_agg(
                 json_build_object(
                   'id',                  s.id,
                   'opens_at',            s.opens_at,
                   'closes_at',           s.closes_at,
                   'default_max_covers',  s.default_max_covers,
                   'sort_order',          s.sort_order,
                   'caps', (
                     SELECT COALESCE(json_agg(
                       json_build_object('slot_time', c.slot_time, 'max_covers', c.max_covers)
                       ORDER BY c.slot_time
                     ), '[]')
                     FROM sitting_slot_caps c WHERE c.sitting_id = s.id
                   )
                 ) ORDER BY s.sort_order, s.opens_at
               ) FILTER (WHERE s.id IS NOT NULL), '[]') AS sittings
          FROM venue_schedule_templates t
          LEFT JOIN venue_sittings s ON s.template_id = t.id
         WHERE t.venue_id = ${venueId}
         GROUP BY t.id
         ORDER BY t.day_of_week
      `
      return templates
    })
  })

  // ── PUT /venues/:venueId/schedule/template/:dow ───────────
  // Upsert a day template (is_open + interval).
  app.put('/:venueId/schedule/template/:dow', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const { venueId } = req.params
    const dow  = DOW.parse(req.params.dow)
    const body = TemplateBody.parse(req.body)

    const [row] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO venue_schedule_templates
        (venue_id, tenant_id, day_of_week, is_open, slot_interval_mins)
      VALUES
        (${venueId}, ${req.tenantId}, ${dow}, ${body.is_open}, ${body.slot_interval_mins})
      ON CONFLICT (venue_id, day_of_week) DO UPDATE
         SET is_open = EXCLUDED.is_open,
             slot_interval_mins = EXCLUDED.slot_interval_mins,
             updated_at = now()
      RETURNING *
    `)
    return row
  })

  // ── POST /venues/:venueId/schedule/template/:dow/sittings ─
  app.post('/:venueId/schedule/template/:dow/sittings', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const { venueId } = req.params
    const dow  = DOW.parse(req.params.dow)
    const body = SittingBody.parse(req.body)

    const [sitting] = await withTenant(req.tenantId, async tx => {
      const [tmpl] = await tx`
        SELECT id FROM venue_schedule_templates
         WHERE venue_id = ${venueId} AND day_of_week = ${dow}
      `
      if (!tmpl) throw httpError(404, 'Template not found — PUT the template first')

      return tx`
        INSERT INTO venue_sittings
          (template_id, venue_id, tenant_id, opens_at, closes_at, default_max_covers, sort_order)
        VALUES
          (${tmpl.id}, ${venueId}, ${req.tenantId},
           ${body.opens_at}, ${body.closes_at}, ${body.default_max_covers}, ${body.sort_order})
        RETURNING *
      `
    })
    return reply.code(201).send(sitting)
  })

  // ── PATCH /venues/:venueId/schedule/sittings/:sid ─────────
  app.patch('/:venueId/schedule/sittings/:sid', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const body   = SittingBody.partial().parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE venue_sittings
         SET ${tx(body, ...fields)}, updated_at = now()
       WHERE id = ${req.params.sid}
         AND venue_id = ${req.params.venueId}
         AND tenant_id = ${req.tenantId}
      RETURNING *
    `)
    if (!row) throw httpError(404, 'Sitting not found')
    return row
  })

  // ── DELETE /venues/:venueId/schedule/sittings/:sid ────────
  app.delete('/:venueId/schedule/sittings/:sid', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      DELETE FROM venue_sittings
       WHERE id = ${req.params.sid}
         AND venue_id = ${req.params.venueId}
         AND tenant_id = ${req.tenantId}
      RETURNING id
    `)
    if (!row) throw httpError(404, 'Sitting not found')
    return { ok: true }
  })

  // ── PUT /venues/:venueId/schedule/sittings/:sid/caps ──────
  // Replace all slot caps for a sitting atomically.
  // Send the full array — missing slots revert to sitting default.
  app.put('/:venueId/schedule/sittings/:sid/caps', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const caps = CapsBody.parse(req.body)
    const { sid, venueId } = req.params

    await withTenant(req.tenantId, async tx => {
      // Verify sitting belongs to this venue + tenant
      const [sitting] = await tx`
        SELECT id FROM venue_sittings
         WHERE id = ${sid} AND venue_id = ${venueId} AND tenant_id = ${req.tenantId}
      `
      if (!sitting) throw httpError(404, 'Sitting not found')

      // Delete existing caps then bulk insert new ones
      await tx`DELETE FROM sitting_slot_caps WHERE sitting_id = ${sid}`

      if (caps.length > 0) {
        const rows = caps.map(c => ({
          sitting_id: sid,
          venue_id:   venueId,
          tenant_id:  req.tenantId,
          slot_time:  c.slot_time,
          max_covers: c.max_covers,
        }))
        await tx`INSERT INTO sitting_slot_caps ${tx(rows)}`
      }
    })

    // Return updated caps
    return withTenant(req.tenantId, tx => tx`
      SELECT slot_time, max_covers FROM sitting_slot_caps
       WHERE sitting_id = ${sid}
       ORDER BY slot_time
    `)
  })

  // ── GET /venues/:venueId/schedule/overrides ───────────────
  app.get('/:venueId/schedule/overrides', async (req) => {
    const { from, to } = req.query  // optional date range filter
    return withTenant(req.tenantId, async tx => {
      const overrides = await tx`
        SELECT o.*,
               COALESCE(json_agg(
                 json_build_object(
                   'id',                 s.id,
                   'opens_at',           s.opens_at,
                   'closes_at',          s.closes_at,
                   'default_max_covers', s.default_max_covers,
                   'sort_order',         s.sort_order,
                   'caps', (
                     SELECT COALESCE(json_agg(
                       json_build_object('slot_time', c.slot_time, 'max_covers', c.max_covers)
                       ORDER BY c.slot_time
                     ), '[]')
                     FROM override_slot_caps c WHERE c.sitting_id = s.id
                   )
                 ) ORDER BY s.sort_order
               ) FILTER (WHERE s.id IS NOT NULL), '[]') AS sittings
          FROM schedule_date_overrides o
          LEFT JOIN override_sittings s ON s.override_id = o.id
         WHERE o.venue_id = ${req.params.venueId}
           AND (${from ?? null}::date IS NULL OR o.override_date >= ${from ?? null}::date)
           AND (${to ?? null}::date   IS NULL OR o.override_date <= ${to ?? null}::date)
         GROUP BY o.id
         ORDER BY o.override_date
      `
      return overrides
    })
  })

  // ── POST /venues/:venueId/schedule/overrides ──────────────
  app.post('/:venueId/schedule/overrides', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const body = OverrideBody.parse(req.body)
    const [override] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO schedule_date_overrides
        (venue_id, tenant_id, override_date, is_open, slot_interval_mins, label)
      VALUES
        (${req.params.venueId}, ${req.tenantId}, ${body.override_date},
         ${body.is_open}, ${body.slot_interval_mins ?? null}, ${body.label ?? null})
      RETURNING *
    `)
    return reply.code(201).send(override)
  })

  // ── PATCH /venues/:venueId/schedule/overrides/:oid ────────
  app.patch('/:venueId/schedule/overrides/:oid', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const body   = OverrideBody.partial().parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE schedule_date_overrides
         SET ${tx(body, ...fields)}, updated_at = now()
       WHERE id = ${req.params.oid}
         AND venue_id = ${req.params.venueId}
         AND tenant_id = ${req.tenantId}
      RETURNING *
    `)
    if (!row) throw httpError(404, 'Override not found')
    return row
  })

  // ── DELETE /venues/:venueId/schedule/overrides/:oid ───────
  app.delete('/:venueId/schedule/overrides/:oid', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      DELETE FROM schedule_date_overrides
       WHERE id = ${req.params.oid}
         AND venue_id = ${req.params.venueId}
         AND tenant_id = ${req.tenantId}
      RETURNING id
    `)
    if (!row) throw httpError(404, 'Override not found')
    return { ok: true }
  })

  // ── POST override sittings + caps (same pattern as weekly) ─
  app.post('/:venueId/schedule/overrides/:oid/sittings', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const body = SittingBody.parse(req.body)
    const [sitting] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO override_sittings
        (override_id, venue_id, tenant_id, opens_at, closes_at, default_max_covers, sort_order)
      VALUES
        (${req.params.oid}, ${req.params.venueId}, ${req.tenantId},
         ${body.opens_at}, ${body.closes_at}, ${body.default_max_covers}, ${body.sort_order})
      RETURNING *
    `)
    return reply.code(201).send(sitting)
  })

  app.put('/:venueId/schedule/overrides/sittings/:sid/caps', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const caps = CapsBody.parse(req.body)
    const { sid, venueId } = req.params

    await withTenant(req.tenantId, async tx => {
      const [sitting] = await tx`
        SELECT id FROM override_sittings
         WHERE id = ${sid} AND venue_id = ${venueId} AND tenant_id = ${req.tenantId}
      `
      if (!sitting) throw httpError(404, 'Sitting not found')

      await tx`DELETE FROM override_slot_caps WHERE sitting_id = ${sid}`

      if (caps.length > 0) {
        const rows = caps.map(c => ({
          sitting_id: sid,
          venue_id:   venueId,
          tenant_id:  req.tenantId,
          slot_time:  c.slot_time,
          max_covers: c.max_covers,
        }))
        await tx`INSERT INTO override_slot_caps ${tx(rows)}`
      }
    })

    return withTenant(req.tenantId, tx => tx`
      SELECT slot_time, max_covers FROM override_slot_caps
       WHERE sitting_id = ${sid}
       ORDER BY slot_time
    `)
  })
}

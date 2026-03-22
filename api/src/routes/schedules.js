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
//
// Schedule exceptions (named periods — closed or alternative schedule):
// GET    /venues/:id/schedule/exceptions
// POST   /venues/:id/schedule/exceptions
// PATCH  /venues/:id/schedule/exceptions/:eid
// DELETE /venues/:id/schedule/exceptions/:eid
// PUT    /venues/:id/schedule/exceptions/:eid/template/:dow   (upsert DOW template)
// POST   /venues/:id/schedule/exceptions/:eid/template/:dow/sittings
// PATCH  /venues/:id/schedule/exceptions/:eid/sittings/:sid
// DELETE /venues/:id/schedule/exceptions/:eid/sittings/:sid
// PUT    /venues/:id/schedule/exceptions/:eid/sittings/:sid/caps

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'

const DOW = z.coerce.number().int().min(0).max(6)

const TemplateBody = z.object({
  is_open:            z.boolean(),
  slot_interval_mins: z.union([z.literal(15), z.literal(30), z.literal(60)]).default(15),
  doors_close_time:   z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
})

const SittingBody = z.object({
  opens_at:            z.string().regex(/^\d{2}:\d{2}$/),
  closes_at:           z.string().regex(/^\d{2}:\d{2}$/),
  default_max_covers:  z.number().int().min(0).nullable().default(null),
  sort_order:          z.number().int().default(0),
  doors_close_time:    z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
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

const ExceptionBody = z.object({
  name:       z.string().min(1).max(200),
  date_from:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  date_to:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  is_closed:  z.boolean().default(false),
  priority:   z.number().int().min(0).default(0),
})

const ExceptionDayTemplateBody = z.object({
  is_open:            z.boolean().default(true),
  slot_interval_mins: z.union([z.literal(15), z.literal(30), z.literal(60)]).default(15),
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
                   'doors_close_time',    s.doors_close_time,
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

  // ── GET /venues/:venueId/schedule/sittings-for-date?date= ─
  // Returns the resolved sittings (opens_at, closes_at) for a specific date,
  // applying the same Priority 1→2→3 resolution as get_available_slots():
  //   1. schedule_exceptions  2. schedule_date_overrides  3. venue_schedule_templates
  // Used by the Timeline to draw accurate grey strips based on exact sitting
  // open/close times, independent of slot_duration_mins constraints.
  app.get('/:venueId/schedule/sittings-for-date', async (req) => {
    const { venueId } = req.params
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(req.query.date)
    // DOW: 0=Sun … 6=Sat, matching PostgreSQL EXTRACT(DOW FROM date)
    const dow = new Date(date + 'T12:00:00Z').getUTCDay()

    return withTenant(req.tenantId, async tx => {
      // Priority 1: named schedule exception
      const [exception] = await tx`
        SELECT id, is_closed
          FROM schedule_exceptions
         WHERE venue_id  = ${venueId}
           AND ${date}::date BETWEEN date_from AND date_to
         ORDER BY priority DESC, (date_to - date_from) ASC
         LIMIT 1
      `

      if (exception) {
        if (exception.is_closed) return { sittings: [] }

        const [excTemplate] = await tx`
          SELECT id, is_open
            FROM exception_day_templates
           WHERE exception_id = ${exception.id}
             AND day_of_week  = ${dow}
        `

        if (excTemplate) {
          if (!excTemplate.is_open) return { sittings: [] }
          const sittings = await tx`
            SELECT opens_at, closes_at, doors_close_time
              FROM exception_sittings
             WHERE template_id = ${excTemplate.id}
             ORDER BY opens_at
          `
          return { sittings }
        }
        // Exception found but no DOW template — fall through to override / weekly
      }

      // Priority 2: single-date override
      const [override] = await tx`
        SELECT id, is_open
          FROM schedule_date_overrides
         WHERE venue_id     = ${venueId}
           AND override_date = ${date}::date
      `

      if (override) {
        if (!override.is_open) return { sittings: [] }
        const sittings = await tx`
          SELECT opens_at, closes_at, doors_close_time
            FROM override_sittings
           WHERE override_id = ${override.id}
           ORDER BY opens_at
        `
        return { sittings }
      }

      // Priority 3: weekly template
      const [template] = await tx`
        SELECT id, is_open
          FROM venue_schedule_templates
         WHERE venue_id    = ${venueId}
           AND day_of_week = ${dow}
      `

      if (!template || !template.is_open) return { sittings: [] }

      const sittings = await tx`
        SELECT opens_at, closes_at, doors_close_time
          FROM venue_sittings
         WHERE template_id = ${template.id}
         ORDER BY opens_at
      `
      return { sittings }
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
        (venue_id, tenant_id, day_of_week, is_open, slot_interval_mins, doors_close_time)
      VALUES
        (${venueId}, ${req.tenantId}, ${dow}, ${body.is_open}, ${body.slot_interval_mins}, ${body.doors_close_time ?? null})
      ON CONFLICT (venue_id, day_of_week) DO UPDATE
         SET is_open = EXCLUDED.is_open,
             slot_interval_mins = EXCLUDED.slot_interval_mins,
             doors_close_time = EXCLUDED.doors_close_time,
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
          (template_id, venue_id, tenant_id, opens_at, closes_at, default_max_covers, sort_order,
           doors_close_time)
        VALUES
          (${tmpl.id}, ${venueId}, ${req.tenantId},
           ${body.opens_at}, ${body.closes_at}, ${body.default_max_covers}, ${body.sort_order},
           ${body.doors_close_time ?? null})
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

  // ── POST /venues/:venueId/schedule/copy-day ──────────────
  // Copies sittings + caps from one day-of-week to another within the same venue.
  app.post('/:venueId/schedule/copy-day', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const { source_dow, target_dow } = z.object({
      source_dow: DOW,
      target_dow: DOW,
    }).parse(req.body)
    if (source_dow === target_dow) throw httpError(400, 'Source and target day must be different')

    const { venueId } = req.params

    await withTenant(req.tenantId, async tx => {
      // Get source template
      const [srcTmpl] = await tx`
        SELECT * FROM venue_schedule_templates
         WHERE venue_id = ${venueId} AND day_of_week = ${source_dow}
      `
      if (!srcTmpl) throw httpError(404, 'Source day has no schedule')

      // Upsert target template with source settings
      const [tgtTmpl] = await tx`
        INSERT INTO venue_schedule_templates
          (venue_id, tenant_id, day_of_week, is_open, slot_interval_mins)
        VALUES
          (${venueId}, ${req.tenantId}, ${target_dow}, ${srcTmpl.is_open}, ${srcTmpl.slot_interval_mins})
        ON CONFLICT (venue_id, day_of_week) DO UPDATE
           SET is_open = EXCLUDED.is_open, slot_interval_mins = EXCLUDED.slot_interval_mins, updated_at = now()
        RETURNING id
      `

      // Replace target sittings
      await tx`DELETE FROM venue_sittings WHERE template_id = ${tgtTmpl.id}`

      const sittings = await tx`SELECT * FROM venue_sittings WHERE template_id = ${srcTmpl.id}`
      for (const s of sittings) {
        const [newS] = await tx`
          INSERT INTO venue_sittings
            (template_id, venue_id, tenant_id, opens_at, closes_at, default_max_covers, sort_order,
             doors_close_time)
          VALUES
            (${tgtTmpl.id}, ${venueId}, ${req.tenantId}, ${s.opens_at}, ${s.closes_at},
             ${s.default_max_covers}, ${s.sort_order}, ${s.doors_close_time ?? null})
          RETURNING id
        `
        const caps = await tx`SELECT slot_time, max_covers FROM sitting_slot_caps WHERE sitting_id = ${s.id}`
        if (caps.length) {
          await tx`INSERT INTO sitting_slot_caps ${tx(caps.map(c => ({
            sitting_id: newS.id, venue_id: venueId, tenant_id: req.tenantId,
            slot_time: c.slot_time, max_covers: c.max_covers,
          })))}`
        }
      }
    })

    return reply.send({ ok: true })
  })

  // ── POST /venues/:venueId/schedule/copy-from ─────────────
  // Replaces target venue's full schedule with a copy from source_venue_id.
  app.post('/:venueId/schedule/copy-from', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const { source_venue_id } = z.object({ source_venue_id: z.string().uuid() }).parse(req.body)
    const { venueId } = req.params
    if (source_venue_id === venueId) throw httpError(400, 'Source and target venue must be different')

    await withTenant(req.tenantId, async tx => {
      const [src] = await tx`SELECT id FROM venues WHERE id = ${source_venue_id}`
      if (!src) throw httpError(404, 'Source venue not found')

      const templates = await tx`SELECT * FROM venue_schedule_templates WHERE venue_id = ${source_venue_id}`

      for (const tmpl of templates) {
        const [newTmpl] = await tx`
          INSERT INTO venue_schedule_templates
            (venue_id, tenant_id, day_of_week, is_open, slot_interval_mins)
          VALUES
            (${venueId}, ${req.tenantId}, ${tmpl.day_of_week}, ${tmpl.is_open}, ${tmpl.slot_interval_mins})
          ON CONFLICT (venue_id, day_of_week) DO UPDATE
             SET is_open = EXCLUDED.is_open, slot_interval_mins = EXCLUDED.slot_interval_mins, updated_at = now()
          RETURNING id
        `

        await tx`DELETE FROM venue_sittings WHERE template_id = ${newTmpl.id}`

        const sittings = await tx`SELECT * FROM venue_sittings WHERE template_id = ${tmpl.id}`
        for (const s of sittings) {
          const [newS] = await tx`
            INSERT INTO venue_sittings
              (template_id, venue_id, tenant_id, opens_at, closes_at, default_max_covers, sort_order,
               doors_close_time)
            VALUES
              (${newTmpl.id}, ${venueId}, ${req.tenantId}, ${s.opens_at}, ${s.closes_at},
               ${s.default_max_covers}, ${s.sort_order}, ${s.doors_close_time ?? null})
            RETURNING id
          `
          const caps = await tx`SELECT slot_time, max_covers FROM sitting_slot_caps WHERE sitting_id = ${s.id}`
          if (caps.length) {
            await tx`INSERT INTO sitting_slot_caps ${tx(caps.map(c => ({
              sitting_id: newS.id, venue_id: venueId, tenant_id: req.tenantId,
              slot_time: c.slot_time, max_covers: c.max_covers,
            })))}`
          }
        }
      }
    })

    return reply.send({ ok: true })
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
                   'doors_close_time',   s.doors_close_time,
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
        (override_id, venue_id, tenant_id, opens_at, closes_at, default_max_covers, sort_order,
         doors_close_time)
      VALUES
        (${req.params.oid}, ${req.params.venueId}, ${req.tenantId},
         ${body.opens_at}, ${body.closes_at}, ${body.default_max_covers}, ${body.sort_order},
         ${body.doors_close_time ?? null})
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

  // ══════════════════════════════════════════════════════════
  // ── Schedule exceptions ──────────────────────────────────
  // ══════════════════════════════════════════════════════════

  // ── GET /venues/:venueId/schedule/exceptions ──────────────
  // Returns all exceptions fully nested: day_templates → sittings → caps.
  app.get('/:venueId/schedule/exceptions', async (req) => {
    return withTenant(req.tenantId, async tx => {
      return tx`
        SELECT e.*,
               COALESCE(json_agg(
                 json_build_object(
                   'id',                 t.id,
                   'day_of_week',        t.day_of_week,
                   'is_open',            t.is_open,
                   'slot_interval_mins', t.slot_interval_mins,
                   'sittings', (
                     SELECT COALESCE(json_agg(
                       json_build_object(
                         'id',                 s.id,
                         'opens_at',           s.opens_at,
                         'closes_at',          s.closes_at,
                         'default_max_covers', s.default_max_covers,
                         'doors_close_time',   s.doors_close_time,
                         'sort_order',         s.sort_order,
                         'caps', (
                           SELECT COALESCE(json_agg(
                             json_build_object('slot_time', c.slot_time, 'max_covers', c.max_covers)
                             ORDER BY c.slot_time
                           ), '[]')
                           FROM exception_sitting_slot_caps c WHERE c.sitting_id = s.id
                         )
                       ) ORDER BY s.sort_order, s.opens_at
                     ), '[]')
                     FROM exception_sittings s WHERE s.template_id = t.id
                   )
                 ) ORDER BY t.day_of_week
               ) FILTER (WHERE t.id IS NOT NULL), '[]') AS day_templates
          FROM schedule_exceptions e
          LEFT JOIN exception_day_templates t ON t.exception_id = e.id
         WHERE e.venue_id   = ${req.params.venueId}
           AND e.tenant_id  = ${req.tenantId}
         GROUP BY e.id
         ORDER BY e.date_from, e.priority DESC
      `
    })
  })

  // ── POST /venues/:venueId/schedule/exceptions ─────────────
  app.post('/:venueId/schedule/exceptions', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const body = ExceptionBody.parse(req.body)
    if (body.date_to < body.date_from) throw httpError(422, 'date_to must be on or after date_from')

    const [exc] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO schedule_exceptions
        (venue_id, tenant_id, name, date_from, date_to, is_closed, priority)
      VALUES
        (${req.params.venueId}, ${req.tenantId},
         ${body.name}, ${body.date_from}, ${body.date_to}, ${body.is_closed}, ${body.priority})
      RETURNING *
    `)
    return reply.code(201).send({ ...exc, day_templates: [] })
  })

  // ── PATCH /venues/:venueId/schedule/exceptions/:eid ───────
  app.patch('/:venueId/schedule/exceptions/:eid', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const body = ExceptionBody.partial().parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE schedule_exceptions
         SET ${tx(body, ...fields)}, updated_at = now()
       WHERE id        = ${req.params.eid}
         AND venue_id  = ${req.params.venueId}
         AND tenant_id = ${req.tenantId}
      RETURNING *
    `)
    if (!row) throw httpError(404, 'Exception not found')
    return row
  })

  // ── DELETE /venues/:venueId/schedule/exceptions/:eid ──────
  app.delete('/:venueId/schedule/exceptions/:eid', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      DELETE FROM schedule_exceptions
       WHERE id        = ${req.params.eid}
         AND venue_id  = ${req.params.venueId}
         AND tenant_id = ${req.tenantId}
      RETURNING id
    `)
    if (!row) throw httpError(404, 'Exception not found')
    return { ok: true }
  })

  // ── PUT /venues/:venueId/schedule/exceptions/:eid/template/:dow ─
  // Upsert a DOW template within an alternative-schedule exception.
  app.put('/:venueId/schedule/exceptions/:eid/template/:dow', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const { venueId, eid } = req.params
    const dow  = DOW.parse(req.params.dow)
    const body = ExceptionDayTemplateBody.parse(req.body)

    const [exc] = await withTenant(req.tenantId, tx => tx`
      SELECT id FROM schedule_exceptions
       WHERE id = ${eid} AND venue_id = ${venueId} AND tenant_id = ${req.tenantId}
    `)
    if (!exc) throw httpError(404, 'Exception not found')

    const [row] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO exception_day_templates
        (exception_id, venue_id, tenant_id, day_of_week, is_open, slot_interval_mins)
      VALUES
        (${eid}, ${venueId}, ${req.tenantId}, ${dow}, ${body.is_open}, ${body.slot_interval_mins})
      ON CONFLICT (exception_id, day_of_week) DO UPDATE
         SET is_open            = EXCLUDED.is_open,
             slot_interval_mins = EXCLUDED.slot_interval_mins
      RETURNING *
    `)
    return { ...row, sittings: [] }
  })

  // ── POST /venues/:venueId/schedule/exceptions/:eid/template/:dow/sittings ─
  app.post('/:venueId/schedule/exceptions/:eid/template/:dow/sittings', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const { venueId, eid } = req.params
    const dow  = DOW.parse(req.params.dow)
    const body = SittingBody.parse(req.body)

    const [sitting] = await withTenant(req.tenantId, async tx => {
      const [tmpl] = await tx`
        SELECT id FROM exception_day_templates
         WHERE exception_id = ${eid}
           AND day_of_week  = ${dow}
           AND venue_id     = ${venueId}
           AND tenant_id    = ${req.tenantId}
      `
      if (!tmpl) throw httpError(404, 'DOW template not found — PUT the template first')

      return tx`
        INSERT INTO exception_sittings
          (template_id, venue_id, tenant_id, opens_at, closes_at,
           default_max_covers, sort_order, doors_close_time)
        VALUES
          (${tmpl.id}, ${venueId}, ${req.tenantId},
           ${body.opens_at}, ${body.closes_at},
           ${body.default_max_covers}, ${body.sort_order}, ${body.doors_close_time ?? null})
        RETURNING *
      `
    })
    return reply.code(201).send(sitting)
  })

  // ── PATCH /venues/:venueId/schedule/exceptions/:eid/sittings/:sid ─
  app.patch('/:venueId/schedule/exceptions/:eid/sittings/:sid', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const body   = SittingBody.partial().parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE exception_sittings
         SET ${tx(body, ...fields)}, updated_at = now()
       WHERE id         = ${req.params.sid}
         AND venue_id   = ${req.params.venueId}
         AND tenant_id  = ${req.tenantId}
         AND template_id IN (
               SELECT id FROM exception_day_templates WHERE exception_id = ${req.params.eid}
             )
      RETURNING *
    `)
    if (!row) throw httpError(404, 'Sitting not found')
    return row
  })

  // ── DELETE /venues/:venueId/schedule/exceptions/:eid/sittings/:sid ─
  app.delete('/:venueId/schedule/exceptions/:eid/sittings/:sid', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      DELETE FROM exception_sittings
       WHERE id         = ${req.params.sid}
         AND venue_id   = ${req.params.venueId}
         AND tenant_id  = ${req.tenantId}
         AND template_id IN (
               SELECT id FROM exception_day_templates WHERE exception_id = ${req.params.eid}
             )
      RETURNING id
    `)
    if (!row) throw httpError(404, 'Sitting not found')
    return { ok: true }
  })

  // ── PUT /venues/:venueId/schedule/exceptions/:eid/sittings/:sid/caps ─
  app.put('/:venueId/schedule/exceptions/:eid/sittings/:sid/caps', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const caps = CapsBody.parse(req.body)
    const { sid, venueId, eid } = req.params

    await withTenant(req.tenantId, async tx => {
      const [sitting] = await tx`
        SELECT s.id FROM exception_sittings s
         WHERE s.id         = ${sid}
           AND s.venue_id   = ${venueId}
           AND s.tenant_id  = ${req.tenantId}
           AND s.template_id IN (
                 SELECT id FROM exception_day_templates WHERE exception_id = ${eid}
               )
      `
      if (!sitting) throw httpError(404, 'Sitting not found')

      await tx`DELETE FROM exception_sitting_slot_caps WHERE sitting_id = ${sid}`

      if (caps.length > 0) {
        await tx`INSERT INTO exception_sitting_slot_caps ${tx(caps.map(c => ({
          sitting_id: sid, venue_id: venueId, tenant_id: req.tenantId,
          slot_time: c.slot_time, max_covers: c.max_covers,
        })))}`
      }
    })

    return withTenant(req.tenantId, tx => tx`
      SELECT slot_time, max_covers FROM exception_sitting_slot_caps
       WHERE sitting_id = ${sid} ORDER BY slot_time
    `)
  })
}

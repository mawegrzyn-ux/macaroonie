// src/routes/foodSafety.js
//
// SFBB-style food safety temperature & delivery logs (per venue).
// Mounted at /api/food-safety in app.js.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'

const EQUIPMENT_TYPES = ['fridge', 'freezer', 'hot_hold', 'cold_hold', 'other']

const DEFAULT_TEMPS = {
  fridge:    { target: 5,   min: -2,  max: 8 },
  freezer:   { target: -18, min: -30, max: -15 },
  hot_hold:  { target: 63,  min: 63,  max: 100 },
  cold_hold: { target: 5,   min: -2,  max: 8 },
  other:     { target: null, min: null, max: null },
}

function withinRange(temp, min, max) {
  if (temp == null) return null
  if (min != null && temp < min) return false
  if (max != null && temp > max) return false
  return true
}

const EquipmentBody = z.object({
  venue_id:       z.string().uuid(),
  name:           z.string().min(1).max(200),
  equipment_type: z.enum(EQUIPMENT_TYPES).default('fridge'),
  target_temp_c:  z.number().nullable().optional(),
  min_temp_c:     z.number().nullable().optional(),
  max_temp_c:     z.number().nullable().optional(),
  location:       z.string().max(200).nullable().optional(),
  notes:          z.string().max(2000).nullable().optional(),
  is_active:      z.boolean().optional(),
  sort_order:     z.number().int().optional(),
})

const EquipmentPatch = EquipmentBody.partial().omit({ venue_id: true })

const CaptureTimeBody = z.object({
  venue_id:    z.string().uuid(),
  label:       z.string().min(1).max(100),
  time_of_day: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  sort_order:  z.number().int().optional(),
})

const CaptureTimePatch = CaptureTimeBody.partial().omit({ venue_id: true }).extend({
  is_active: z.boolean().optional(),
})

const TempLogBody = z.object({
  venue_id:           z.string().uuid(),
  equipment_id:       z.string().uuid(),
  capture_time_id:    z.string().uuid().nullable().optional(),
  log_date:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  temperature_c:      z.number(),
  corrective_action:  z.string().max(2000).nullable().optional(),
  notes:              z.string().max(2000).nullable().optional(),
  recorded_by:        z.string().max(200).nullable().optional(),
})

const DeliveryBody = z.object({
  venue_id:           z.string().uuid(),
  delivery_date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  vendor_name:        z.string().min(1).max(200),
  packaging_ok:       z.boolean().default(true),
  damage_ok:          z.boolean().default(true),
  quality_ok:         z.boolean().default(true),
  temp_ok:            z.boolean().default(true),
  product_temp_c:     z.number().nullable().optional(),
  items:              z.array(z.any()).optional(),
  accepted:           z.boolean().default(true),
  corrective_action:  z.string().max(2000).nullable().optional(),
  notes:              z.string().max(2000).nullable().optional(),
  recorded_by:        z.string().max(200).nullable().optional(),
})

const HoldBody = z.object({
  venue_id:           z.string().uuid(),
  check_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hold_type:          z.enum(['hot_hold', 'cold_hold']),
  item_name:          z.string().min(1).max(200),
  temperature_c:      z.number(),
  corrective_action:  z.string().max(2000).nullable().optional(),
  notes:              z.string().max(2000).nullable().optional(),
  recorded_by:        z.string().max(200).nullable().optional(),
})

const CookingBody = z.object({
  venue_id:           z.string().uuid(),
  check_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dish_name:          z.string().min(1).max(200),
  core_temp_c:        z.number(),
  hold_seconds:       z.number().int().nullable().optional(),
  corrective_action:  z.string().max(2000).nullable().optional(),
  notes:              z.string().max(2000).nullable().optional(),
  recorded_by:        z.string().max(200).nullable().optional(),
})

function applyEquipmentDefaults(body) {
  const d = DEFAULT_TEMPS[body.equipment_type] || DEFAULT_TEMPS.other
  return {
    ...body,
    target_temp_c: body.target_temp_c !== undefined ? body.target_temp_c : d.target,
    min_temp_c:    body.min_temp_c !== undefined ? body.min_temp_c : d.min,
    max_temp_c:    body.max_temp_c !== undefined ? body.max_temp_c : d.max,
  }
}

export default async function foodSafetyRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // ── Equipment ─────────────────────────────────────────────

  app.get('/equipment', {
    preHandler: requirePermission('food_safety', 'view'),
  }, async (req) => {
    const { venue_id, active } = req.query
    if (!venue_id) throw httpError(400, 'venue_id required')

    return withTenant(req.tenantId, tx => {
      const activeFilter = active === 'false'
        ? tx``
        : active === 'all'
          ? tx``
          : tx`AND e.is_active = true`
      return tx`
        SELECT e.*
          FROM fs_equipment e
         WHERE e.tenant_id = ${req.tenantId}
           AND e.venue_id  = ${venue_id}
           ${activeFilter}
         ORDER BY e.sort_order, e.name
      `
    })
  })

  app.post('/equipment', {
    preHandler: requirePermission('food_safety', 'manage'),
  }, async (req) => {
    const body = applyEquipmentDefaults(EquipmentBody.parse(req.body))
    const [row] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO fs_equipment
        (tenant_id, venue_id, name, equipment_type, target_temp_c, min_temp_c, max_temp_c,
         location, notes, is_active, sort_order)
      VALUES
        (${req.tenantId}, ${body.venue_id}, ${body.name}, ${body.equipment_type},
         ${body.target_temp_c ?? null}, ${body.min_temp_c ?? null}, ${body.max_temp_c ?? null},
         ${body.location ?? null}, ${body.notes ?? null},
         ${body.is_active ?? true}, ${body.sort_order ?? 0})
      RETURNING *
    `)
    return row
  })

  app.patch('/equipment/:id', {
    preHandler: requirePermission('food_safety', 'manage'),
  }, async (req) => {
    const body = EquipmentPatch.parse(req.body)
    const fields = Object.keys(body).filter(k => body[k] !== undefined)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE fs_equipment
         SET ${tx(Object.fromEntries(fields.map(k => [k, body[k]])), ...fields)},
             updated_at = now()
       WHERE id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
       RETURNING *
    `)
    if (!row) throw httpError(404, 'Equipment not found')
    return row
  })

  app.delete('/equipment/:id', {
    preHandler: requirePermission('food_safety', 'manage'),
  }, async (req) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE fs_equipment
         SET is_active = false, updated_at = now()
       WHERE id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
       RETURNING *
    `)
    if (!row) throw httpError(404, 'Equipment not found')
    return row
  })

  // ── Capture times ─────────────────────────────────────────
  // Scheduled check times (e.g. "Morning check" 09:00) an operator sets up
  // per venue, so the Today tab can prompt "which check is this?" instead
  // of a single once-a-day reading.

  app.get('/capture-times', {
    preHandler: requirePermission('food_safety', 'view'),
  }, async (req) => {
    const { venue_id, active } = req.query
    if (!venue_id) throw httpError(400, 'venue_id required')

    return withTenant(req.tenantId, tx => {
      const activeFilter = active === 'all' ? tx`` : tx`AND c.is_active = true`
      return tx`
        SELECT c.* FROM fs_capture_times c
         WHERE c.tenant_id = ${req.tenantId}
           AND c.venue_id  = ${venue_id}
           ${activeFilter}
         ORDER BY c.time_of_day, c.sort_order
      `
    })
  })

  app.post('/capture-times', {
    preHandler: requirePermission('food_safety', 'manage'),
  }, async (req) => {
    const body = CaptureTimeBody.parse(req.body)
    const [row] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO fs_capture_times (tenant_id, venue_id, label, time_of_day, sort_order)
      VALUES (${req.tenantId}, ${body.venue_id}, ${body.label}, ${body.time_of_day}, ${body.sort_order ?? 0})
      RETURNING *
    `)
    return row
  })

  app.patch('/capture-times/:id', {
    preHandler: requirePermission('food_safety', 'manage'),
  }, async (req) => {
    const body = CaptureTimePatch.parse(req.body)
    const fields = Object.keys(body).filter(k => body[k] !== undefined)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE fs_capture_times
         SET ${tx(Object.fromEntries(fields.map(k => [k, body[k]])), ...fields)},
             updated_at = now()
       WHERE id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
       RETURNING *
    `)
    if (!row) throw httpError(404, 'Capture time not found')
    return row
  })

  app.delete('/capture-times/:id', {
    preHandler: requirePermission('food_safety', 'manage'),
  }, async (req) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE fs_capture_times
         SET is_active = false, updated_at = now()
       WHERE id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
       RETURNING *
    `)
    if (!row) throw httpError(404, 'Capture time not found')
    return row
  })

  // ── Temperature logs ──────────────────────────────────────

  app.get('/temp-logs', {
    preHandler: requirePermission('food_safety', 'view'),
  }, async (req) => {
    const { venue_id, date, from, to, limit = '100' } = req.query
    if (!venue_id) throw httpError(400, 'venue_id required')
    const lim = Math.min(parseInt(limit, 10) || 100, 500)

    return withTenant(req.tenantId, tx => {
      const dateFilter = date
        ? tx`AND l.log_date = ${date}`
        : from || to
          ? tx`AND l.log_date >= ${from || '1970-01-01'} AND l.log_date <= ${to || '2999-12-31'}`
          : tx``
      return tx`
        SELECT l.*, e.name AS equipment_name, e.equipment_type,
               e.target_temp_c, e.min_temp_c, e.max_temp_c
          FROM fs_temp_logs l
          JOIN fs_equipment e ON e.id = l.equipment_id
         WHERE l.tenant_id = ${req.tenantId}
           AND l.venue_id  = ${venue_id}
           ${dateFilter}
         ORDER BY l.log_date DESC, l.recorded_at DESC
         LIMIT ${lim}
      `
    })
  })

  app.post('/temp-logs', {
    preHandler: requirePermission('food_safety', 'manage'),
  }, async (req) => {
    const body = TempLogBody.parse(req.body)

    const [eq] = await withTenant(req.tenantId, tx => tx`
      SELECT id, min_temp_c, max_temp_c FROM fs_equipment
       WHERE id = ${body.equipment_id} AND tenant_id = ${req.tenantId}
         AND venue_id = ${body.venue_id}
    `)
    if (!eq) throw httpError(404, 'Equipment not found')

    if (body.capture_time_id) {
      const [ct] = await withTenant(req.tenantId, tx => tx`
        SELECT id FROM fs_capture_times
         WHERE id = ${body.capture_time_id} AND tenant_id = ${req.tenantId}
           AND venue_id = ${body.venue_id}
      `)
      if (!ct) throw httpError(404, 'Capture time not found')
    }

    const inRange = withinRange(body.temperature_c, eq.min_temp_c, eq.max_temp_c)
    const logDate = body.log_date || new Date().toISOString().slice(0, 10)

    // Slot-linked readings upsert (re-logging the same equipment/slot/day
    // corrects the existing row); ad-hoc readings (no capture_time_id)
    // always insert a new row — the partial unique index only covers
    // capture_time_id IS NOT NULL, so ON CONFLICT never fires for those.
    const [row] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO fs_temp_logs
        (tenant_id, venue_id, equipment_id, capture_time_id, log_date, temperature_c,
         is_within_range, corrective_action, notes, recorded_by)
      VALUES
        (${req.tenantId}, ${body.venue_id}, ${body.equipment_id}, ${body.capture_time_id ?? null}, ${logDate},
         ${body.temperature_c}, ${inRange},
         ${body.corrective_action ?? null}, ${body.notes ?? null},
         ${body.recorded_by ?? req.user?.email ?? null})
      ON CONFLICT (equipment_id, log_date, capture_time_id) WHERE capture_time_id IS NOT NULL
      DO UPDATE SET
        temperature_c     = EXCLUDED.temperature_c,
        is_within_range   = EXCLUDED.is_within_range,
        corrective_action = EXCLUDED.corrective_action,
        notes             = EXCLUDED.notes,
        recorded_by       = EXCLUDED.recorded_by,
        recorded_at       = now()
      RETURNING *
    `)
    return row
  })

  // ── Delivery checks ───────────────────────────────────────

  app.get('/deliveries', {
    preHandler: requirePermission('food_safety', 'view'),
  }, async (req) => {
    const { venue_id, date, limit = '50' } = req.query
    if (!venue_id) throw httpError(400, 'venue_id required')
    const lim = Math.min(parseInt(limit, 10) || 50, 200)

    return withTenant(req.tenantId, tx => {
      const dateFilter = date ? tx`AND d.delivery_date = ${date}` : tx``
      return tx`
        SELECT d.* FROM fs_delivery_checks d
         WHERE d.tenant_id = ${req.tenantId}
           AND d.venue_id  = ${venue_id}
           ${dateFilter}
         ORDER BY d.delivery_date DESC, d.recorded_at DESC
         LIMIT ${lim}
      `
    })
  })

  app.post('/deliveries', {
    preHandler: requirePermission('food_safety', 'manage'),
  }, async (req) => {
    const body = DeliveryBody.parse(req.body)
    const deliveryDate = body.delivery_date || new Date().toISOString().slice(0, 10)

    const [row] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO fs_delivery_checks
        (tenant_id, venue_id, delivery_date, vendor_name,
         packaging_ok, damage_ok, quality_ok, temp_ok,
         product_temp_c, items, accepted, corrective_action, notes, recorded_by)
      VALUES
        (${req.tenantId}, ${body.venue_id}, ${deliveryDate}, ${body.vendor_name},
         ${body.packaging_ok}, ${body.damage_ok}, ${body.quality_ok}, ${body.temp_ok},
         ${body.product_temp_c ?? null}, ${JSON.stringify(body.items ?? [])},
         ${body.accepted}, ${body.corrective_action ?? null}, ${body.notes ?? null},
         ${body.recorded_by ?? req.user?.email ?? null})
      RETURNING *
    `)
    return row
  })

  // ── Hold checks ───────────────────────────────────────────

  app.get('/holds', {
    preHandler: requirePermission('food_safety', 'view'),
  }, async (req) => {
    const { venue_id, date, hold_type, limit = '50' } = req.query
    if (!venue_id) throw httpError(400, 'venue_id required')
    const lim = Math.min(parseInt(limit, 10) || 50, 200)

    return withTenant(req.tenantId, tx => {
      const dateFilter = date ? tx`AND h.check_date = ${date}` : tx``
      const typeFilter = hold_type ? tx`AND h.hold_type = ${hold_type}` : tx``
      return tx`
        SELECT h.* FROM fs_hold_checks h
         WHERE h.tenant_id = ${req.tenantId}
           AND h.venue_id  = ${venue_id}
           ${dateFilter} ${typeFilter}
         ORDER BY h.check_date DESC, h.recorded_at DESC
         LIMIT ${lim}
      `
    })
  })

  app.post('/holds', {
    preHandler: requirePermission('food_safety', 'manage'),
  }, async (req) => {
    const body = HoldBody.parse(req.body)
    const checkDate = body.check_date || new Date().toISOString().slice(0, 10)
    // hot ≥63, cold ≤8
    const inRange = body.hold_type === 'hot_hold'
      ? body.temperature_c >= 63
      : body.temperature_c <= 8

    const [row] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO fs_hold_checks
        (tenant_id, venue_id, check_date, hold_type, item_name, temperature_c,
         is_within_range, corrective_action, notes, recorded_by)
      VALUES
        (${req.tenantId}, ${body.venue_id}, ${checkDate}, ${body.hold_type},
         ${body.item_name}, ${body.temperature_c}, ${inRange},
         ${body.corrective_action ?? null}, ${body.notes ?? null},
         ${body.recorded_by ?? req.user?.email ?? null})
      RETURNING *
    `)
    return row
  })

  // ── Cooking checks ────────────────────────────────────────

  app.get('/cooking', {
    preHandler: requirePermission('food_safety', 'view'),
  }, async (req) => {
    const { venue_id, date, limit = '50' } = req.query
    if (!venue_id) throw httpError(400, 'venue_id required')
    const lim = Math.min(parseInt(limit, 10) || 50, 200)

    return withTenant(req.tenantId, tx => {
      const dateFilter = date ? tx`AND c.check_date = ${date}` : tx``
      return tx`
        SELECT c.* FROM fs_cooking_checks c
         WHERE c.tenant_id = ${req.tenantId}
           AND c.venue_id  = ${venue_id}
           ${dateFilter}
         ORDER BY c.check_date DESC, c.recorded_at DESC
         LIMIT ${lim}
      `
    })
  })

  app.post('/cooking', {
    preHandler: requirePermission('food_safety', 'manage'),
  }, async (req) => {
    const body = CookingBody.parse(req.body)
    const checkDate = body.check_date || new Date().toISOString().slice(0, 10)
    const inRange = body.core_temp_c >= 75

    const [row] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO fs_cooking_checks
        (tenant_id, venue_id, check_date, dish_name, core_temp_c, hold_seconds,
         is_within_range, corrective_action, notes, recorded_by)
      VALUES
        (${req.tenantId}, ${body.venue_id}, ${checkDate}, ${body.dish_name},
         ${body.core_temp_c}, ${body.hold_seconds ?? null}, ${inRange},
         ${body.corrective_action ?? null}, ${body.notes ?? null},
         ${body.recorded_by ?? req.user?.email ?? null})
      RETURNING *
    `)
    return row
  })

  // ── Defaults helper for UI ────────────────────────────────

  app.get('/defaults', {
    preHandler: requirePermission('food_safety', 'view'),
  }, async () => DEFAULT_TEMPS)
}

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

// Editing an already-logged reading — used by the autosave temp cells (no
// popup, so a corrective action can be attached after the fact) and by the
// end-of-day review's batched corrective-action prompt.
const TempLogPatch = z.object({
  temperature_c:      z.number().optional(),
  corrective_action:  z.string().max(2000).nullable().optional(),
  notes:              z.string().max(2000).nullable().optional(),
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

const DeliveryPatch = DeliveryBody.partial().omit({ venue_id: true })

// ── Hold stations (the "fridges-style" setup for hot/cold hold) ──
const HoldStationBody = z.object({
  venue_id:       z.string().uuid(),
  name:           z.string().min(1).max(200),
  hold_type:      z.enum(['hot_hold', 'cold_hold']),
  target_temp_c:  z.number().nullable().optional(),
  min_temp_c:     z.number().nullable().optional(),
  max_temp_c:     z.number().nullable().optional(),
  location:       z.string().max(200).nullable().optional(),
  notes:          z.string().max(2000).nullable().optional(),
  is_active:      z.boolean().optional(),
  sort_order:     z.number().int().optional(),
})
const HoldStationPatch = HoldStationBody.partial().omit({ venue_id: true })

const HoldCaptureTimeBody = z.object({
  venue_id:    z.string().uuid(),
  label:       z.string().min(1).max(100),
  time_of_day: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  sort_order:  z.number().int().optional(),
})
const HoldCaptureTimePatch = HoldCaptureTimeBody.partial().omit({ venue_id: true }).extend({
  is_active: z.boolean().optional(),
})

const HoldBody = z.object({
  venue_id:           z.string().uuid(),
  station_id:         z.string().uuid(),
  capture_time_id:    z.string().uuid().nullable().optional(),
  check_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  temperature_c:      z.number(),
  corrective_action:  z.string().max(2000).nullable().optional(),
  notes:              z.string().max(2000).nullable().optional(),
  recorded_by:        z.string().max(200).nullable().optional(),
})

const HoldPatch = z.object({
  temperature_c:      z.number().optional(),
  corrective_action:  z.string().max(2000).nullable().optional(),
  notes:              z.string().max(2000).nullable().optional(),
})

// ── Cooking sessions (frequency + how many items must be checked) ──
const CookingSessionBody = z.object({
  venue_id:              z.string().uuid(),
  label:                 z.string().min(1).max(100),
  time_of_day:           z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
  required_items_count:  z.number().int().min(1).max(100).optional(),
  sort_order:            z.number().int().optional(),
})
const CookingSessionPatch = CookingSessionBody.partial().omit({ venue_id: true }).extend({
  is_active: z.boolean().optional(),
})

const CookingBody = z.object({
  venue_id:           z.string().uuid(),
  session_id:         z.string().uuid().nullable().optional(),
  menu_item_id:       z.string().uuid().nullable().optional(),
  dish_name:          z.string().min(1).max(200).nullable().optional(),
  check_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  core_temp_c:        z.number(),
  hold_seconds:       z.number().int().nullable().optional(),
  corrective_action:  z.string().max(2000).nullable().optional(),
  notes:              z.string().max(2000).nullable().optional(),
  recorded_by:        z.string().max(200).nullable().optional(),
}).refine(
  b => !!b.menu_item_id || !!(b.dish_name && b.dish_name.trim()),
  { message: 'Either menu_item_id or dish_name is required' },
)

// Editing an already-logged check — the dish identity (menu_item_id /
// dish_name) is fixed once created, only the reading itself can change.
const CookingPatch = z.object({
  core_temp_c:        z.number().optional(),
  corrective_action:  z.string().max(2000).nullable().optional(),
  notes:              z.string().max(2000).nullable().optional(),
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

  // Must be registered before /equipment/:id.
  app.patch('/equipment/reorder', {
    preHandler: requirePermission('food_safety', 'manage'),
  }, async (req) => {
    const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1) }).parse(req.body)
    await withTenant(req.tenantId, async tx => {
      const owned = await tx`SELECT id FROM fs_equipment WHERE id = ANY(${ids}::uuid[]) AND tenant_id = ${req.tenantId}`
      if (owned.length !== ids.length) throw httpError(404, 'One or more equipment items not found')
      for (let i = 0; i < ids.length; i++) {
        await tx`UPDATE fs_equipment SET sort_order = ${i}, updated_at = now() WHERE id = ${ids[i]} AND tenant_id = ${req.tenantId}`
      }
    })
    return { ok: true }
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

  app.patch('/temp-logs/:id', {
    preHandler: requirePermission('food_safety', 'manage'),
  }, async (req) => {
    const body = TempLogPatch.parse(req.body)
    const fields = Object.keys(body).filter(k => body[k] !== undefined)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [existing] = await withTenant(req.tenantId, tx => tx`
      SELECT l.temperature_c, e.min_temp_c, e.max_temp_c
        FROM fs_temp_logs l JOIN fs_equipment e ON e.id = l.equipment_id
       WHERE l.id = ${req.params.id} AND l.tenant_id = ${req.tenantId}
    `)
    if (!existing) throw httpError(404, 'Temp log not found')

    const temp = body.temperature_c ?? existing.temperature_c
    const updates = { ...body, is_within_range: withinRange(temp, existing.min_temp_c, existing.max_temp_c) }
    const updateFields = Object.keys(updates)

    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE fs_temp_logs
         SET ${tx(updates, ...updateFields)}
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
       RETURNING *
    `)
    if (!row) throw httpError(404, 'Temp log not found')
    return row
  })

  // ── Delivery checks ───────────────────────────────────────

  app.get('/deliveries', {
    preHandler: requirePermission('food_safety', 'view'),
  }, async (req) => {
    const { venue_id, date, from, to, limit = '50' } = req.query
    if (!venue_id) throw httpError(400, 'venue_id required')
    const lim = Math.min(parseInt(limit, 10) || 50, 200)

    return withTenant(req.tenantId, tx => {
      const dateFilter = date
        ? tx`AND d.delivery_date = ${date}`
        : from || to
          ? tx`AND d.delivery_date >= ${from || '1970-01-01'} AND d.delivery_date <= ${to || '2999-12-31'}`
          : tx``
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
         ${body.product_temp_c ?? null}, ${body.items ?? []},
         ${body.accepted}, ${body.corrective_action ?? null}, ${body.notes ?? null},
         ${body.recorded_by ?? req.user?.email ?? null})
      RETURNING *
    `)
    return row
  })

  app.patch('/deliveries/:id', {
    preHandler: requirePermission('food_safety', 'manage'),
  }, async (req) => {
    const body = DeliveryPatch.parse(req.body)
    const fields = Object.keys(body).filter(k => body[k] !== undefined)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE fs_delivery_checks
         SET ${tx(Object.fromEntries(fields.map(k => [k, body[k]])), ...fields)}
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
       RETURNING *
    `)
    if (!row) throw httpError(404, 'Delivery check not found')
    return row
  })

  // ── Hold stations ─────────────────────────────────────────
  // The "fridges-style" setup for hot/cold hold checks — named
  // stations with their own target/min/max, kept as their own tab
  // rather than folded into fs_equipment.

  app.get('/hold-stations', {
    preHandler: requirePermission('food_safety', 'view'),
  }, async (req) => {
    const { venue_id, active } = req.query
    if (!venue_id) throw httpError(400, 'venue_id required')

    return withTenant(req.tenantId, tx => {
      const activeFilter = active === 'all' ? tx`` : tx`AND s.is_active = true`
      return tx`
        SELECT s.* FROM fs_hold_stations s
         WHERE s.tenant_id = ${req.tenantId}
           AND s.venue_id  = ${venue_id}
           ${activeFilter}
         ORDER BY s.sort_order, s.name
      `
    })
  })

  app.post('/hold-stations', {
    preHandler: requirePermission('food_safety', 'manage'),
  }, async (req) => {
    const body = HoldStationBody.parse(req.body)
    const [row] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO fs_hold_stations
        (tenant_id, venue_id, name, hold_type, target_temp_c, min_temp_c, max_temp_c,
         location, notes, is_active, sort_order)
      VALUES
        (${req.tenantId}, ${body.venue_id}, ${body.name}, ${body.hold_type},
         ${body.target_temp_c ?? null}, ${body.min_temp_c ?? null}, ${body.max_temp_c ?? null},
         ${body.location ?? null}, ${body.notes ?? null},
         ${body.is_active ?? true}, ${body.sort_order ?? 0})
      RETURNING *
    `)
    return row
  })

  // Must be registered before /hold-stations/:id.
  app.patch('/hold-stations/reorder', {
    preHandler: requirePermission('food_safety', 'manage'),
  }, async (req) => {
    const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1) }).parse(req.body)
    await withTenant(req.tenantId, async tx => {
      const owned = await tx`SELECT id FROM fs_hold_stations WHERE id = ANY(${ids}::uuid[]) AND tenant_id = ${req.tenantId}`
      if (owned.length !== ids.length) throw httpError(404, 'One or more hold stations not found')
      for (let i = 0; i < ids.length; i++) {
        await tx`UPDATE fs_hold_stations SET sort_order = ${i}, updated_at = now() WHERE id = ${ids[i]} AND tenant_id = ${req.tenantId}`
      }
    })
    return { ok: true }
  })

  app.patch('/hold-stations/:id', {
    preHandler: requirePermission('food_safety', 'manage'),
  }, async (req) => {
    const body = HoldStationPatch.parse(req.body)
    const fields = Object.keys(body).filter(k => body[k] !== undefined)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE fs_hold_stations
         SET ${tx(Object.fromEntries(fields.map(k => [k, body[k]])), ...fields)},
             updated_at = now()
       WHERE id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
       RETURNING *
    `)
    if (!row) throw httpError(404, 'Hold station not found')
    return row
  })

  app.delete('/hold-stations/:id', {
    preHandler: requirePermission('food_safety', 'manage'),
  }, async (req) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE fs_hold_stations
         SET is_active = false, updated_at = now()
       WHERE id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
       RETURNING *
    `)
    if (!row) throw httpError(404, 'Hold station not found')
    return row
  })

  // ── Hold capture times ────────────────────────────────────

  app.get('/hold-capture-times', {
    preHandler: requirePermission('food_safety', 'view'),
  }, async (req) => {
    const { venue_id, active } = req.query
    if (!venue_id) throw httpError(400, 'venue_id required')

    return withTenant(req.tenantId, tx => {
      const activeFilter = active === 'all' ? tx`` : tx`AND c.is_active = true`
      return tx`
        SELECT c.* FROM fs_hold_capture_times c
         WHERE c.tenant_id = ${req.tenantId}
           AND c.venue_id  = ${venue_id}
           ${activeFilter}
         ORDER BY c.time_of_day, c.sort_order
      `
    })
  })

  app.post('/hold-capture-times', {
    preHandler: requirePermission('food_safety', 'manage'),
  }, async (req) => {
    const body = HoldCaptureTimeBody.parse(req.body)
    const [row] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO fs_hold_capture_times (tenant_id, venue_id, label, time_of_day, sort_order)
      VALUES (${req.tenantId}, ${body.venue_id}, ${body.label}, ${body.time_of_day}, ${body.sort_order ?? 0})
      RETURNING *
    `)
    return row
  })

  app.patch('/hold-capture-times/:id', {
    preHandler: requirePermission('food_safety', 'manage'),
  }, async (req) => {
    const body = HoldCaptureTimePatch.parse(req.body)
    const fields = Object.keys(body).filter(k => body[k] !== undefined)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE fs_hold_capture_times
         SET ${tx(Object.fromEntries(fields.map(k => [k, body[k]])), ...fields)},
             updated_at = now()
       WHERE id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
       RETURNING *
    `)
    if (!row) throw httpError(404, 'Hold capture time not found')
    return row
  })

  app.delete('/hold-capture-times/:id', {
    preHandler: requirePermission('food_safety', 'manage'),
  }, async (req) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE fs_hold_capture_times
         SET is_active = false, updated_at = now()
       WHERE id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
       RETURNING *
    `)
    if (!row) throw httpError(404, 'Hold capture time not found')
    return row
  })

  // ── Hold checks ───────────────────────────────────────────

  app.get('/holds', {
    preHandler: requirePermission('food_safety', 'view'),
  }, async (req) => {
    const { venue_id, date, from, to, limit = '100' } = req.query
    if (!venue_id) throw httpError(400, 'venue_id required')
    const lim = Math.min(parseInt(limit, 10) || 100, 500)

    return withTenant(req.tenantId, tx => {
      const dateFilter = date
        ? tx`AND h.check_date = ${date}`
        : from || to
          ? tx`AND h.check_date >= ${from || '1970-01-01'} AND h.check_date <= ${to || '2999-12-31'}`
          : tx``
      return tx`
        SELECT h.*, s.name AS station_name, s.hold_type,
               s.target_temp_c, s.min_temp_c, s.max_temp_c
          FROM fs_hold_checks h
          JOIN fs_hold_stations s ON s.id = h.station_id
         WHERE h.tenant_id = ${req.tenantId}
           AND h.venue_id  = ${venue_id}
           ${dateFilter}
         ORDER BY h.check_date DESC, h.recorded_at DESC
         LIMIT ${lim}
      `
    })
  })

  app.post('/holds', {
    preHandler: requirePermission('food_safety', 'manage'),
  }, async (req) => {
    const body = HoldBody.parse(req.body)

    const [station] = await withTenant(req.tenantId, tx => tx`
      SELECT id, min_temp_c, max_temp_c FROM fs_hold_stations
       WHERE id = ${body.station_id} AND tenant_id = ${req.tenantId}
         AND venue_id = ${body.venue_id}
    `)
    if (!station) throw httpError(404, 'Hold station not found')

    if (body.capture_time_id) {
      const [ct] = await withTenant(req.tenantId, tx => tx`
        SELECT id FROM fs_hold_capture_times
         WHERE id = ${body.capture_time_id} AND tenant_id = ${req.tenantId}
           AND venue_id = ${body.venue_id}
      `)
      if (!ct) throw httpError(404, 'Capture time not found')
    }

    const inRange = withinRange(body.temperature_c, station.min_temp_c, station.max_temp_c)
    const checkDate = body.check_date || new Date().toISOString().slice(0, 10)

    // Slot-linked readings upsert (re-logging the same station/slot/day
    // corrects the existing row); ad-hoc readings (no capture_time_id)
    // always insert a new row — same pattern as fs_temp_logs.
    const [row] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO fs_hold_checks
        (tenant_id, venue_id, station_id, capture_time_id, check_date, temperature_c,
         is_within_range, corrective_action, notes, recorded_by)
      VALUES
        (${req.tenantId}, ${body.venue_id}, ${body.station_id}, ${body.capture_time_id ?? null}, ${checkDate},
         ${body.temperature_c}, ${inRange},
         ${body.corrective_action ?? null}, ${body.notes ?? null},
         ${body.recorded_by ?? req.user?.email ?? null})
      ON CONFLICT (station_id, check_date, capture_time_id) WHERE capture_time_id IS NOT NULL
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

  app.patch('/holds/:id', {
    preHandler: requirePermission('food_safety', 'manage'),
  }, async (req) => {
    const body = HoldPatch.parse(req.body)
    const fields = Object.keys(body).filter(k => body[k] !== undefined)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [existing] = await withTenant(req.tenantId, tx => tx`
      SELECT h.temperature_c, s.min_temp_c, s.max_temp_c
        FROM fs_hold_checks h JOIN fs_hold_stations s ON s.id = h.station_id
       WHERE h.id = ${req.params.id} AND h.tenant_id = ${req.tenantId}
    `)
    if (!existing) throw httpError(404, 'Hold check not found')

    const temp = body.temperature_c ?? existing.temperature_c
    const updates = { ...body, is_within_range: withinRange(temp, existing.min_temp_c, existing.max_temp_c) }
    const updateFields = Object.keys(updates)

    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE fs_hold_checks
         SET ${tx(updates, ...updateFields)}
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
       RETURNING *
    `)
    if (!row) throw httpError(404, 'Hold check not found')
    return row
  })

  // ── Cooking sessions ──────────────────────────────────────
  // How many times a day cooking checks happen, and how many items
  // must be checked in each session to meet criteria.

  app.get('/cooking-sessions', {
    preHandler: requirePermission('food_safety', 'view'),
  }, async (req) => {
    const { venue_id, active } = req.query
    if (!venue_id) throw httpError(400, 'venue_id required')

    return withTenant(req.tenantId, tx => {
      const activeFilter = active === 'all' ? tx`` : tx`AND s.is_active = true`
      return tx`
        SELECT s.* FROM fs_cooking_sessions s
         WHERE s.tenant_id = ${req.tenantId}
           AND s.venue_id  = ${venue_id}
           ${activeFilter}
         ORDER BY s.sort_order, s.time_of_day NULLS LAST, s.label
      `
    })
  })

  app.post('/cooking-sessions', {
    preHandler: requirePermission('food_safety', 'manage'),
  }, async (req) => {
    const body = CookingSessionBody.parse(req.body)
    const [row] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO fs_cooking_sessions (tenant_id, venue_id, label, time_of_day, required_items_count, sort_order)
      VALUES (${req.tenantId}, ${body.venue_id}, ${body.label}, ${body.time_of_day ?? null},
              ${body.required_items_count ?? 1}, ${body.sort_order ?? 0})
      RETURNING *
    `)
    return row
  })

  app.patch('/cooking-sessions/:id', {
    preHandler: requirePermission('food_safety', 'manage'),
  }, async (req) => {
    const body = CookingSessionPatch.parse(req.body)
    const fields = Object.keys(body).filter(k => body[k] !== undefined)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE fs_cooking_sessions
         SET ${tx(Object.fromEntries(fields.map(k => [k, body[k]])), ...fields)},
             updated_at = now()
       WHERE id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
       RETURNING *
    `)
    if (!row) throw httpError(404, 'Cooking session not found')
    return row
  })

  app.delete('/cooking-sessions/:id', {
    preHandler: requirePermission('food_safety', 'manage'),
  }, async (req) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE fs_cooking_sessions
         SET is_active = false, updated_at = now()
       WHERE id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
       RETURNING *
    `)
    if (!row) throw httpError(404, 'Cooking session not found')
    return row
  })

  // ── Menu items for the cooking-check picker ───────────────
  // Flattened section (category) + item list for the venue's published
  // menu(s) — just enough for "categories as tabs, items as buttons".
  // Tenant-wide menus (venue_id IS NULL) are included alongside the
  // venue's own, same inheritance rule the public site uses.

  app.get('/cooking/menu-items', {
    preHandler: requirePermission('food_safety', 'view'),
  }, async (req) => {
    const { venue_id } = req.query
    if (!venue_id) throw httpError(400, 'venue_id required')

    return withTenant(req.tenantId, tx => tx`
      SELECT s.id AS section_id, s.title AS section_title, s.sort_order AS section_sort,
             i.id AS item_id, i.name AS item_name, i.sort_order AS item_sort
        FROM menu_items i
        JOIN menu_sections s ON s.id = i.section_id
        JOIN menus m ON m.id = s.menu_id
       WHERE i.tenant_id = ${req.tenantId}
         AND m.is_published = true
         AND (m.venue_id = ${venue_id} OR m.venue_id IS NULL)
       ORDER BY m.sort_order, s.sort_order, i.sort_order
    `)
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
        SELECT c.*, s.label AS session_label, s.required_items_count
          FROM fs_cooking_checks c
          LEFT JOIN fs_cooking_sessions s ON s.id = c.session_id
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

    // A durable compliance record must keep showing what was checked even
    // if the menu item is later renamed/removed, so dish_name is captured
    // now rather than looked up live via menu_item_id on every read.
    let dishName = body.dish_name?.trim() || null
    if (body.menu_item_id) {
      const [item] = await withTenant(req.tenantId, tx => tx`
        SELECT i.name FROM menu_items i
         WHERE i.id = ${body.menu_item_id} AND i.tenant_id = ${req.tenantId}
      `)
      if (!item) throw httpError(404, 'Menu item not found')
      dishName = item.name
    }
    if (!dishName) throw httpError(400, 'Either menu_item_id or dish_name is required')

    if (body.session_id) {
      const [session] = await withTenant(req.tenantId, tx => tx`
        SELECT id FROM fs_cooking_sessions
         WHERE id = ${body.session_id} AND tenant_id = ${req.tenantId}
           AND venue_id = ${body.venue_id}
      `)
      if (!session) throw httpError(404, 'Cooking session not found')
    }

    const [row] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO fs_cooking_checks
        (tenant_id, venue_id, check_date, session_id, menu_item_id, dish_name, core_temp_c, hold_seconds,
         is_within_range, corrective_action, notes, recorded_by)
      VALUES
        (${req.tenantId}, ${body.venue_id}, ${checkDate}, ${body.session_id ?? null}, ${body.menu_item_id ?? null},
         ${dishName}, ${body.core_temp_c}, ${body.hold_seconds ?? null}, ${inRange},
         ${body.corrective_action ?? null}, ${body.notes ?? null},
         ${body.recorded_by ?? req.user?.email ?? null})
      RETURNING *
    `)
    return row
  })

  app.patch('/cooking/:id', {
    preHandler: requirePermission('food_safety', 'manage'),
  }, async (req) => {
    const body = CookingPatch.parse(req.body)
    const fields = Object.keys(body).filter(k => body[k] !== undefined)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [existing] = await withTenant(req.tenantId, tx => tx`
      SELECT core_temp_c FROM fs_cooking_checks
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
    `)
    if (!existing) throw httpError(404, 'Cooking check not found')

    const temp = body.core_temp_c ?? existing.core_temp_c
    const updates = { ...body, is_within_range: temp >= 75 }
    const updateFields = Object.keys(updates)

    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE fs_cooking_checks
         SET ${tx(updates, ...updateFields)}
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
       RETURNING *
    `)
    if (!row) throw httpError(404, 'Cooking check not found')
    return row
  })

  // ── Defaults helper for UI ────────────────────────────────

  app.get('/defaults', {
    preHandler: requirePermission('food_safety', 'view'),
  }, async () => DEFAULT_TEMPS)
}

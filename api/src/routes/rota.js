// src/routes/rota.js
//
// Staff, roles, rota setup, the weekly rota, and rota pay / tips.
// Mounted at /api/rota in app.js. Maths lives in services/rotaCalc.js.
//
// Setup (tenant-wide; `staff` module):
//   GET    /setup                               settings + shifts + roles (any signed-in user)
//   PATCH  /settings                             { mode, slot_minutes }
//   POST   /shifts   PATCH /shifts/:id   DELETE /shifts/:id   PUT /shifts/reorder { ids }
//   POST   /roles    PATCH /roles/:id    DELETE /roles/:id    PUT /roles/reorder  { ids }
//
// Staff (per venue; `staff` module):
//   GET    /venues/:venueId/staff               with role + per-shift rates
//   POST   /venues/:venueId/staff
//   PATCH  /venues/:venueId/staff/:id           incl. shift_rates [{ shift_id, rate }]
//   DELETE /venues/:venueId/staff/:id           soft (is_active=false) if used, else hard
//   PUT    /venues/:venueId/staff/reorder       { ids }
//
// Rota (per venue + ISO week; `rota` module):
//   GET    /venues/:venueId/weeks/:week         settings, shifts, staff, entries
//   PUT    /venues/:venueId/weeks/:week/entries  whole-week replace
//   POST   /venues/:venueId/weeks/:week/copy     { from_week }
//
// Pay, points and tips (`rota_pay` module):
//   GET    /venues/:venueId/weeks/:week/pay
//   PATCH  /venues/:venueId/weeks/:week/tip-pot         { tip_pot_override }
//   PATCH  /venues/:venueId/weeks/:week/staff/:staffId  { pay_override }
//   POST   /venues/:venueId/weeks/:week/move-points     { from_staff_id, to_staff_id, points }
//   POST   /venues/:venueId/weeks/:week/reset-points
//   POST   /venues/:venueId/weeks/:week/fill-wages      writes Cash Recon wages

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { computeRotaWeek, periodsOverlap, span } from '../services/rotaCalc.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$|^24:00(:00)?$/
const UUID = z.string().uuid()
const Money = z.coerce.number().min(0).max(1_000_000)

const SettingsBody = z.object({
  mode:         z.enum(['day_parts', 'hourly']).optional(),
  slot_minutes: z.union([z.literal(15), z.literal(30), z.literal(60)]).optional(),
})

const ShiftBody = z.object({
  name:       z.string().trim().min(1).max(100),
  start_time: z.string().regex(TIME_RE),
  end_time:   z.string().regex(TIME_RE),
  points:     z.coerce.number().min(0).max(100).default(1),
})
const ShiftPatch = ShiftBody.partial().extend({ is_active: z.boolean().optional() })

const RoleBody = z.object({
  name:              z.string().trim().min(1).max(100),
  points_multiplier: z.coerce.number().min(0).max(100).default(1),
})
const RolePatch = RoleBody.partial().extend({ is_active: z.boolean().optional() })

const StaffBody = z.object({
  name:         z.string().trim().min(1).max(200),
  role_id:      UUID.nullable().optional(),
  pay_type:     z.enum(['hourly', 'fixed']).default('fixed'),
  pay_basis:    z.enum(['week', 'day', 'shift']).default('week'),
  default_rate: Money.nullable().optional(),
  is_active:    z.boolean().optional(),
  shift_rates:  z.array(z.object({ shift_id: UUID, rate: Money })).optional(),
})
const StaffPatch = StaffBody.partial()

const EntryBody = z.object({
  staff_id:   UUID,
  work_date:  z.string().regex(DATE_RE),
  shift_id:   UUID.nullable().optional(),
  start_time: z.string().regex(TIME_RE).nullable().optional(),
  end_time:   z.string().regex(TIME_RE).nullable().optional(),
}).refine(e => (e.shift_id ? !e.start_time && !e.end_time : !!e.start_time && !!e.end_time), {
  message: 'An entry is either a shift (shift_id) or a period (start_time and end_time)',
})

// ── helpers ──────────────────────────────────────────────────

function mondayOf(dateStr) {
  if (!DATE_RE.test(dateStr)) throw httpError(400, `Invalid date: ${dateStr}`)
  const d = new Date(dateStr + 'T00:00:00Z')
  if (isNaN(d)) throw httpError(400, `Invalid date: ${dateStr}`)
  const day = d.getUTCDay()
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day))
  return d.toISOString().slice(0, 10)
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function weekDates(monday) {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

async function assertVenue(tx, tenantId, venueId) {
  const [v] = await tx`SELECT id FROM venues WHERE id = ${venueId} AND tenant_id = ${tenantId}`
  if (!v) throw httpError(404, 'Venue not found')
}

async function loadSettings(tx, tenantId) {
  const [row] = await tx`SELECT mode, slot_minutes FROM rota_settings WHERE tenant_id = ${tenantId}`
  return row ?? { mode: 'day_parts', slot_minutes: 30 }
}

function loadShifts(tx, tenantId) {
  return tx`
    SELECT id, name, start_time::text AS start_time, end_time::text AS end_time,
           points::float8 AS points, sort_order, is_active
      FROM rota_shifts
     WHERE tenant_id = ${tenantId}
     ORDER BY sort_order, start_time
  `
}

function loadRoles(tx, tenantId) {
  return tx`
    SELECT id, name, points_multiplier::float8 AS points_multiplier, sort_order, is_active
      FROM staff_roles
     WHERE tenant_id = ${tenantId}
     ORDER BY sort_order, name
  `
}

/** Staff with role + per-shift rates; `alsoIds` keeps inactive staff that have rota entries. */
async function loadStaff(tx, tenantId, venueId, { activeOnly = false, alsoIds = [] } = {}) {
  const rows = await tx`
    SELECT s.id, s.name, s.role_id, s.pay_type, s.pay_basis,
           s.default_rate::float8 AS default_rate, s.is_active, s.sort_order,
           r.name AS role_name, r.points_multiplier::float8 AS role_multiplier
      FROM cash_staff s
      LEFT JOIN staff_roles r ON r.id = s.role_id
     WHERE s.tenant_id = ${tenantId}
       AND s.venue_id  = ${venueId}
       AND (${!activeOnly} OR s.is_active = true OR s.id = ANY(${alsoIds}::uuid[]))
     ORDER BY s.sort_order, s.name
  `
  if (!rows.length) return rows
  const rates = await tx`
    SELECT staff_id, shift_id, rate::float8 AS rate
      FROM staff_shift_rates
     WHERE tenant_id = ${tenantId}
       AND staff_id = ANY(${rows.map(r => r.id)}::uuid[])
  `
  const byStaff = {}
  for (const r of rates) (byStaff[r.staff_id] ??= {})[r.shift_id] = r.rate
  return rows.map(r => ({ ...r, shift_rates: byStaff[r.id] ?? {} }))
}

function loadEntries(tx, tenantId, venueId, monday) {
  return tx`
    SELECT id, staff_id, work_date::text AS work_date, shift_id,
           to_char(start_time, 'HH24:MI') AS start_time,
           to_char(end_time,   'HH24:MI') AS end_time
      FROM rota_entries
     WHERE tenant_id = ${tenantId}
       AND venue_id  = ${venueId}
       AND work_date BETWEEN ${monday}::date AND ${addDays(monday, 6)}::date
     ORDER BY work_date, start_time NULLS FIRST
  `
}

/** Everything the pay calculation needs for one venue week. */
async function computeWeek(tx, tenantId, venueId, monday) {
  const [shifts, entries] = await Promise.all([loadShifts(tx, tenantId), loadEntries(tx, tenantId, venueId, monday)])
  const withEntries = [...new Set(entries.map(e => e.staff_id))]
  const staff = await loadStaff(tx, tenantId, venueId, { activeOnly: true, alsoIds: withEntries })
  const weekStaff = await tx`
    SELECT staff_id, points_adjustment::float8 AS points_adjustment, pay_override::float8 AS pay_override
      FROM rota_week_staff
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND week_start = ${monday}::date
  `
  const [week] = await tx`
    SELECT tip_pot_override::float8 AS tip_pot_override FROM rota_weeks
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND week_start = ${monday}::date
  `
  // Tip pot source: the week's service charge / tips entries from sources
  // marked "Distributed to Staff". "Split" sources have no percentage in
  // Cash Recon, so they're reported separately for payroll to decide.
  const [sc] = await tx`
    SELECT COALESCE(SUM(e.amount) FILTER (WHERE s.distribution = 'staff'), 0)::float8 AS staff_total,
           COALESCE(SUM(e.amount) FILTER (WHERE s.distribution = 'split'), 0)::float8 AS split_total
      FROM cash_sc_entries e
      JOIN cash_sc_sources s    ON s.id = e.source_id
      JOIN cash_daily_reports d ON d.id = e.report_id
     WHERE e.tenant_id = ${tenantId}
       AND d.venue_id  = ${venueId}
       AND d.report_date BETWEEN ${monday}::date AND ${addDays(monday, 6)}::date
  `
  const override = week?.tip_pot_override ?? null
  const tipPot = override ?? sc.staff_total
  const result = computeRotaWeek({ shifts, staff, entries, weekStaff, tipPot })
  return {
    ...result,
    week_start: monday,
    tip_pot: { from_service_charge: sc.staff_total, split_sources: sc.split_total, override, value: tipPot },
  }
}

async function ensureWeekStaff(tx, tenantId, venueId, monday, staffId) {
  await tx`
    INSERT INTO rota_week_staff (tenant_id, venue_id, week_start, staff_id)
    VALUES (${tenantId}, ${venueId}, ${monday}::date, ${staffId})
    ON CONFLICT (venue_id, week_start, staff_id) DO NOTHING
  `
}

async function reorder(tx, table, tenantId, ids, extraWhere) {
  for (let i = 0; i < ids.length; i++) {
    await tx`
      UPDATE ${tx(table)} SET sort_order = ${i}
       WHERE id = ${ids[i]} AND tenant_id = ${tenantId} ${extraWhere ?? tx``}
    `
  }
}

async function replaceShiftRates(tx, tenantId, staffId, rates) {
  await tx`DELETE FROM staff_shift_rates WHERE staff_id = ${staffId} AND tenant_id = ${tenantId}`
  if (rates.length) {
    const valid = await tx`
      SELECT id FROM rota_shifts WHERE tenant_id = ${tenantId} AND id = ANY(${rates.map(r => r.shift_id)}::uuid[])
    `
    const ok = new Set(valid.map(v => v.id))
    const rows = rates.filter(r => ok.has(r.shift_id))
      .map(r => ({ tenant_id: tenantId, staff_id: staffId, shift_id: r.shift_id, rate: r.rate }))
    if (rows.length) await tx`INSERT INTO staff_shift_rates ${tx(rows)}`
  }
}

// ── routes ───────────────────────────────────────────────────

export default async function rotaRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // ── Setup ──────────────────────────────────────────────────

  app.get('/setup', async (req) => withTenant(req.tenantId, async tx => {
    const [settings, shifts, roles] = await Promise.all([
      loadSettings(tx, req.tenantId), loadShifts(tx, req.tenantId), loadRoles(tx, req.tenantId),
    ])
    return { settings, shifts, roles }
  }))

  app.patch('/settings', { preHandler: requirePermission('staff', 'manage') }, async (req) => {
    const body = SettingsBody.parse(req.body)
    return withTenant(req.tenantId, async tx => {
      const current = await loadSettings(tx, req.tenantId)
      const next = { ...current, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) }
      const [row] = await tx`
        INSERT INTO rota_settings (tenant_id, mode, slot_minutes)
        VALUES (${req.tenantId}, ${next.mode}, ${next.slot_minutes})
        ON CONFLICT (tenant_id) DO UPDATE
          SET mode = EXCLUDED.mode, slot_minutes = EXCLUDED.slot_minutes, updated_at = now()
        RETURNING mode, slot_minutes
      `
      return row
    })
  })

  // Shifts
  app.post('/shifts', { preHandler: requirePermission('staff', 'manage') }, async (req) => {
    const b = ShiftBody.parse(req.body)
    if (b.start_time.slice(0, 5) === b.end_time.slice(0, 5)) throw httpError(400, 'A shift must have a length')
    const [row] = await withTenant(req.tenantId, async tx => {
      const [{ n }] = await tx`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM rota_shifts WHERE tenant_id = ${req.tenantId}`
      return tx`
        INSERT INTO rota_shifts (tenant_id, name, start_time, end_time, points, sort_order)
        VALUES (${req.tenantId}, ${b.name}, ${b.start_time}, ${b.end_time}, ${b.points}, ${n})
        RETURNING id
      `
    })
    return row
  })

  app.put('/shifts/reorder', { preHandler: requirePermission('staff', 'manage') }, async (req) => {
    const { ids } = z.object({ ids: z.array(UUID) }).parse(req.body)
    await withTenant(req.tenantId, tx => reorder(tx, 'rota_shifts', req.tenantId, ids))
    return { ok: true }
  })

  app.patch('/shifts/:id', { preHandler: requirePermission('staff', 'manage') }, async (req) => {
    const b = ShiftPatch.parse(req.body)
    const fields = Object.keys(b).filter(k => b[k] !== undefined)
    if (!fields.length) throw httpError(400, 'No fields to update')
    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE rota_shifts SET ${tx(Object.fromEntries(fields.map(k => [k, b[k]])), ...fields)}
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
      RETURNING id
    `)
    if (!row) throw httpError(404, 'Shift not found')
    return row
  })

  // Deleting a shift that is on any rota only hides it, so past weeks keep their pay.
  app.delete('/shifts/:id', { preHandler: requirePermission('staff', 'manage') }, async (req, reply) => {
    await withTenant(req.tenantId, async tx => {
      const [used] = await tx`SELECT 1 FROM rota_entries WHERE shift_id = ${req.params.id} AND tenant_id = ${req.tenantId} LIMIT 1`
      const [row] = used
        ? await tx`UPDATE rota_shifts SET is_active = false WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId} RETURNING id`
        : await tx`DELETE FROM rota_shifts WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId} RETURNING id`
      if (!row) throw httpError(404, 'Shift not found')
    })
    return reply.code(204).send()
  })

  // Roles
  app.post('/roles', { preHandler: requirePermission('staff', 'manage') }, async (req) => {
    const b = RoleBody.parse(req.body)
    const [row] = await withTenant(req.tenantId, async tx => {
      const [{ n }] = await tx`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM staff_roles WHERE tenant_id = ${req.tenantId}`
      return tx`
        INSERT INTO staff_roles (tenant_id, name, points_multiplier, sort_order)
        VALUES (${req.tenantId}, ${b.name}, ${b.points_multiplier}, ${n})
        RETURNING id
      `
    })
    return row
  })

  app.put('/roles/reorder', { preHandler: requirePermission('staff', 'manage') }, async (req) => {
    const { ids } = z.object({ ids: z.array(UUID) }).parse(req.body)
    await withTenant(req.tenantId, tx => reorder(tx, 'staff_roles', req.tenantId, ids))
    return { ok: true }
  })

  app.patch('/roles/:id', { preHandler: requirePermission('staff', 'manage') }, async (req) => {
    const b = RolePatch.parse(req.body)
    const fields = Object.keys(b).filter(k => b[k] !== undefined)
    if (!fields.length) throw httpError(400, 'No fields to update')
    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE staff_roles SET ${tx(Object.fromEntries(fields.map(k => [k, b[k]])), ...fields)}
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
      RETURNING id
    `)
    if (!row) throw httpError(404, 'Role not found')
    return row
  })

  // Deleting a role clears it from staff (ON DELETE SET NULL).
  app.delete('/roles/:id', { preHandler: requirePermission('staff', 'manage') }, async (req, reply) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      DELETE FROM staff_roles WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId} RETURNING id
    `)
    if (!row) throw httpError(404, 'Role not found')
    return reply.code(204).send()
  })

  // ── Staff ──────────────────────────────────────────────────

  app.get('/venues/:venueId/staff', { preHandler: requirePermission('staff', 'view') }, async (req) =>
    withTenant(req.tenantId, async tx => {
      await assertVenue(tx, req.tenantId, req.params.venueId)
      return loadStaff(tx, req.tenantId, req.params.venueId)
    }))

  app.post('/venues/:venueId/staff', { preHandler: requirePermission('staff', 'manage') }, async (req) => {
    const b = StaffBody.parse(req.body)
    return withTenant(req.tenantId, async tx => {
      await assertVenue(tx, req.tenantId, req.params.venueId)
      const [{ n }] = await tx`
        SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM cash_staff
         WHERE tenant_id = ${req.tenantId} AND venue_id = ${req.params.venueId}
      `
      const [row] = await tx`
        INSERT INTO cash_staff (tenant_id, venue_id, name, role_id, pay_type, pay_basis, default_rate, is_active, sort_order)
        VALUES (${req.tenantId}, ${req.params.venueId}, ${b.name}, ${b.role_id ?? null}, ${b.pay_type}, ${b.pay_basis},
                ${b.default_rate ?? null}, ${b.is_active ?? true}, ${n})
        RETURNING id
      `
      if (b.shift_rates) await replaceShiftRates(tx, req.tenantId, row.id, b.shift_rates)
      return row
    })
  })

  app.put('/venues/:venueId/staff/reorder', { preHandler: requirePermission('staff', 'manage') }, async (req) => {
    const { ids } = z.object({ ids: z.array(UUID) }).parse(req.body)
    await withTenant(req.tenantId, tx =>
      reorder(tx, 'cash_staff', req.tenantId, ids, tx`AND venue_id = ${req.params.venueId}`))
    return { ok: true }
  })

  app.patch('/venues/:venueId/staff/:id', { preHandler: requirePermission('staff', 'manage') }, async (req) => {
    const b = StaffPatch.parse(req.body)
    const { shift_rates, ...rest } = b
    const fields = Object.keys(rest).filter(k => rest[k] !== undefined)
    if (!fields.length && !shift_rates) throw httpError(400, 'No fields to update')
    return withTenant(req.tenantId, async tx => {
      const [exists] = await tx`
        SELECT id FROM cash_staff WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId} AND venue_id = ${req.params.venueId}
      `
      if (!exists) throw httpError(404, 'Staff member not found')
      if (fields.length) {
        await tx`
          UPDATE cash_staff SET ${tx(Object.fromEntries(fields.map(k => [k, rest[k]])), ...fields)}
           WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
        `
      }
      if (shift_rates) await replaceShiftRates(tx, req.tenantId, req.params.id, shift_rates)
      return { id: req.params.id }
    })
  })

  // Staff with wages or rota history are deactivated rather than deleted.
  app.delete('/venues/:venueId/staff/:id', { preHandler: requirePermission('staff', 'manage') }, async (req, reply) => {
    await withTenant(req.tenantId, async tx => {
      const [used] = await tx`
        SELECT 1 FROM cash_wage_entries WHERE staff_id = ${req.params.id} AND tenant_id = ${req.tenantId}
        UNION ALL
        SELECT 1 FROM rota_entries WHERE staff_id = ${req.params.id} AND tenant_id = ${req.tenantId}
        LIMIT 1
      `
      const [row] = used
        ? await tx`UPDATE cash_staff SET is_active = false WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId} AND venue_id = ${req.params.venueId} RETURNING id`
        : await tx`DELETE FROM cash_staff WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId} AND venue_id = ${req.params.venueId} RETURNING id`
      if (!row) throw httpError(404, 'Staff member not found')
    })
    return reply.code(204).send()
  })

  // ── Rota ───────────────────────────────────────────────────

  app.get('/venues/:venueId/weeks/:week', { preHandler: requirePermission('rota', 'view') }, async (req) => {
    const monday = mondayOf(req.params.week)
    return withTenant(req.tenantId, async tx => {
      await assertVenue(tx, req.tenantId, req.params.venueId)
      const [settings, shifts, entries] = await Promise.all([
        loadSettings(tx, req.tenantId), loadShifts(tx, req.tenantId),
        loadEntries(tx, req.tenantId, req.params.venueId, monday),
      ])
      const withEntries = [...new Set(entries.map(e => e.staff_id))]
      const staff = (await loadStaff(tx, req.tenantId, req.params.venueId, { activeOnly: true, alsoIds: withEntries }))
        .map(({ id, name, role_name, is_active }) => ({ id, name, role_name, is_active }))
      return { week_start: monday, dates: weekDates(monday), settings, shifts, staff, entries }
    })
  })

  app.put('/venues/:venueId/weeks/:week/entries', { preHandler: requirePermission('rota', 'manage') }, async (req) => {
    const monday = mondayOf(req.params.week)
    const dates = new Set(weekDates(monday))
    const { entries } = z.object({ entries: z.array(EntryBody).max(5000) }).parse(req.body)

    for (const e of entries) {
      if (!dates.has(e.work_date)) throw httpError(400, `${e.work_date} is not in the week of ${monday}`)
      if (!e.shift_id && e.start_time.slice(0, 5) === e.end_time.slice(0, 5)) {
        throw httpError(400, 'A worked period must have a length')
      }
    }
    // Hourly periods for one person on one day must not overlap.
    const periods = {}
    for (const e of entries.filter(e => !e.shift_id)) {
      (periods[`${e.staff_id}|${e.work_date}`] ??= []).push(e)
    }
    for (const [key, list] of Object.entries(periods)) {
      if (periodsOverlap(list)) throw httpError(422, `Overlapping times for one person on ${key.split('|')[1]}`)
    }

    return withTenant(req.tenantId, async tx => {
      await assertVenue(tx, req.tenantId, req.params.venueId)
      const staffIds = [...new Set(entries.map(e => e.staff_id))]
      if (staffIds.length) {
        const ok = await tx`
          SELECT id FROM cash_staff
           WHERE tenant_id = ${req.tenantId} AND venue_id = ${req.params.venueId} AND id = ANY(${staffIds}::uuid[])
        `
        if (ok.length !== staffIds.length) throw httpError(400, 'Unknown staff member for this venue')
      }
      const shiftIds = [...new Set(entries.map(e => e.shift_id).filter(Boolean))]
      if (shiftIds.length) {
        const ok = await tx`SELECT id FROM rota_shifts WHERE tenant_id = ${req.tenantId} AND id = ANY(${shiftIds}::uuid[])`
        if (ok.length !== shiftIds.length) throw httpError(400, 'Unknown shift')
      }

      await tx`
        DELETE FROM rota_entries
         WHERE tenant_id = ${req.tenantId} AND venue_id = ${req.params.venueId}
           AND work_date BETWEEN ${monday}::date AND ${addDays(monday, 6)}::date
      `
      // Drop exact duplicate shift ticks rather than failing the unique index.
      const seen = new Set()
      const rows = []
      for (const e of entries) {
        const key = e.shift_id ? `${e.staff_id}|${e.work_date}|${e.shift_id}` : null
        if (key && seen.has(key)) continue
        if (key) seen.add(key)
        rows.push({
          tenant_id: req.tenantId, venue_id: req.params.venueId, staff_id: e.staff_id,
          work_date: e.work_date, shift_id: e.shift_id ?? null,
          start_time: e.shift_id ? null : e.start_time, end_time: e.shift_id ? null : e.end_time,
        })
      }
      if (rows.length) await tx`INSERT INTO rota_entries ${tx(rows)}`
      return { saved: rows.length }
    })
  })

  app.post('/venues/:venueId/weeks/:week/copy', { preHandler: requirePermission('rota', 'manage') }, async (req) => {
    const monday = mondayOf(req.params.week)
    const { from_week } = z.object({ from_week: z.string().regex(DATE_RE) }).parse(req.body)
    const source = mondayOf(from_week)
    if (source === monday) throw httpError(400, 'Pick a different week to copy from')
    const offsetDays = Math.round((new Date(monday) - new Date(source)) / 86_400_000)

    return withTenant(req.tenantId, async tx => {
      await assertVenue(tx, req.tenantId, req.params.venueId)
      const src = await loadEntries(tx, req.tenantId, req.params.venueId, source)
      if (!src.length) throw httpError(422, `Nothing on the rota for the week of ${source}`)
      await tx`
        DELETE FROM rota_entries
         WHERE tenant_id = ${req.tenantId} AND venue_id = ${req.params.venueId}
           AND work_date BETWEEN ${monday}::date AND ${addDays(monday, 6)}::date
      `
      const rows = src.map(e => ({
        tenant_id: req.tenantId, venue_id: req.params.venueId, staff_id: e.staff_id,
        work_date: addDays(e.work_date, offsetDays), shift_id: e.shift_id,
        start_time: e.start_time, end_time: e.end_time,
      }))
      await tx`INSERT INTO rota_entries ${tx(rows)}`
      return { copied: rows.length }
    })
  })

  // ── Pay, points, tips ──────────────────────────────────────

  app.get('/venues/:venueId/weeks/:week/pay', { preHandler: requirePermission('rota_pay', 'view') }, async (req) => {
    const monday = mondayOf(req.params.week)
    return withTenant(req.tenantId, async tx => {
      await assertVenue(tx, req.tenantId, req.params.venueId)
      return computeWeek(tx, req.tenantId, req.params.venueId, monday)
    })
  })

  app.patch('/venues/:venueId/weeks/:week/tip-pot', { preHandler: requirePermission('rota_pay', 'manage') }, async (req) => {
    const monday = mondayOf(req.params.week)
    const { tip_pot_override } = z.object({ tip_pot_override: Money.nullable() }).parse(req.body)
    return withTenant(req.tenantId, async tx => {
      await assertVenue(tx, req.tenantId, req.params.venueId)
      await tx`
        INSERT INTO rota_weeks (tenant_id, venue_id, week_start, tip_pot_override)
        VALUES (${req.tenantId}, ${req.params.venueId}, ${monday}::date, ${tip_pot_override})
        ON CONFLICT (venue_id, week_start) DO UPDATE
          SET tip_pot_override = EXCLUDED.tip_pot_override, updated_at = now()
      `
      return computeWeek(tx, req.tenantId, req.params.venueId, monday)
    })
  })

  app.patch('/venues/:venueId/weeks/:week/staff/:staffId', { preHandler: requirePermission('rota_pay', 'manage') }, async (req) => {
    const monday = mondayOf(req.params.week)
    const { pay_override } = z.object({ pay_override: Money.nullable() }).parse(req.body)
    return withTenant(req.tenantId, async tx => {
      await assertVenue(tx, req.tenantId, req.params.venueId)
      await ensureWeekStaff(tx, req.tenantId, req.params.venueId, monday, req.params.staffId)
      await tx`
        UPDATE rota_week_staff SET pay_override = ${pay_override}, updated_at = now()
         WHERE venue_id = ${req.params.venueId} AND week_start = ${monday}::date
           AND staff_id = ${req.params.staffId} AND tenant_id = ${req.tenantId}
      `
      return computeWeek(tx, req.tenantId, req.params.venueId, monday)
    })
  })

  // Moving points is zero-sum: what one person loses, another gains.
  app.post('/venues/:venueId/weeks/:week/move-points', { preHandler: requirePermission('rota_pay', 'manage') }, async (req) => {
    const monday = mondayOf(req.params.week)
    const b = z.object({
      from_staff_id: UUID, to_staff_id: UUID, points: z.coerce.number().positive().max(1000),
    }).parse(req.body)
    if (b.from_staff_id === b.to_staff_id) throw httpError(400, 'Pick two different people')
    return withTenant(req.tenantId, async tx => {
      await assertVenue(tx, req.tenantId, req.params.venueId)
      const before = await computeWeek(tx, req.tenantId, req.params.venueId, monday)
      const from = before.rows.find(r => r.staff_id === b.from_staff_id)
      if (!before.rows.find(r => r.staff_id === b.to_staff_id) || !from) throw httpError(404, 'Staff member not on this week')
      if (b.points > from.points + 1e-9) throw httpError(422, `${from.name} only has ${from.points} points this week`)
      for (const [id, delta] of [[b.from_staff_id, -b.points], [b.to_staff_id, b.points]]) {
        await ensureWeekStaff(tx, req.tenantId, req.params.venueId, monday, id)
        await tx`
          UPDATE rota_week_staff SET points_adjustment = points_adjustment + ${delta}, updated_at = now()
           WHERE venue_id = ${req.params.venueId} AND week_start = ${monday}::date
             AND staff_id = ${id} AND tenant_id = ${req.tenantId}
        `
      }
      return computeWeek(tx, req.tenantId, req.params.venueId, monday)
    })
  })

  app.post('/venues/:venueId/weeks/:week/reset-points', { preHandler: requirePermission('rota_pay', 'manage') }, async (req) => {
    const monday = mondayOf(req.params.week)
    return withTenant(req.tenantId, async tx => {
      await assertVenue(tx, req.tenantId, req.params.venueId)
      await tx`
        UPDATE rota_week_staff SET points_adjustment = 0, updated_at = now()
         WHERE venue_id = ${req.params.venueId} AND week_start = ${monday}::date AND tenant_id = ${req.tenantId}
      `
      return computeWeek(tx, req.tenantId, req.params.venueId, monday)
    })
  })

  // Writes each rostered person's pay into the week's Cash Recon wages.
  // People already on the wages keep their row (and Paid tick: someone
  // fully paid stays fully paid at the new amount); others are added;
  // wage rows for people not on the rota are left alone.
  app.post('/venues/:venueId/weeks/:week/fill-wages', { preHandler: requirePermission('rota_pay', 'manage') }, async (req) => {
    const monday = mondayOf(req.params.week)
    return withTenant(req.tenantId, async tx => {
      await assertVenue(tx, req.tenantId, req.params.venueId)
      const week = await computeWeek(tx, req.tenantId, req.params.venueId, monday)
      const rostered = week.rows.filter(r => r.entry_count > 0 || r.pay_override != null)
      if (!rostered.length) throw httpError(422, 'Nobody is on the rota this week')

      const [report] = await tx`
        INSERT INTO cash_wage_reports (tenant_id, venue_id, week_start)
        VALUES (${req.tenantId}, ${req.params.venueId}, ${monday}::date)
        ON CONFLICT (tenant_id, venue_id, week_start) DO UPDATE SET updated_at = now()
        RETURNING id, status
      `
      if (report.status === 'submitted') throw httpError(422, 'This week\'s wages are submitted. Unsubmit them in Cash Recon first.')

      const existing = await tx`
        SELECT id, staff_id, total::float8 AS total, cash_amount::float8 AS cash_amount
          FROM cash_wage_entries WHERE wage_report_id = ${report.id} AND tenant_id = ${req.tenantId}
      `
      const byStaff = new Map(existing.filter(e => e.staff_id).map(e => [e.staff_id, e]))
      let updated = 0, added = 0
      for (const r of rostered) {
        const hourly = r.pay_type === 'hourly' && r.hours > 0
        const values = {
          entry_type: hourly ? 'hourly' : 'fixed',
          hours:      hourly ? r.hours : null,
          rate:       hourly ? Math.round((r.pay / r.hours) * 100) / 100 : null,
          total:      r.pay,
        }
        const prev = byStaff.get(r.staff_id)
        if (prev) {
          const fullyPaid = prev.cash_amount > 0 && prev.cash_amount === prev.total
          await tx`
            UPDATE cash_wage_entries
               SET entry_type = ${values.entry_type}, hours = ${values.hours}, rate = ${values.rate},
                   total = ${values.total}, name = ${r.name},
                   cash_amount = ${fullyPaid ? values.total : prev.cash_amount}
             WHERE id = ${prev.id}
          `
          updated++
        } else {
          await tx`
            INSERT INTO cash_wage_entries (tenant_id, wage_report_id, staff_id, name, entry_type, hours, rate, total, cash_amount)
            VALUES (${req.tenantId}, ${report.id}, ${r.staff_id}, ${r.name}, ${values.entry_type},
                    ${values.hours}, ${values.rate}, ${values.total}, 0)
          `
          added++
        }
      }
      return { updated, added, total_pay: week.totals.pay }
    })
  })
}

// src/routes/rota.js
//
// Staff, roles, rota setup, the weekly rota, and rota pay / tips.
// Mounted at /api/rota in app.js. Maths lives in services/rotaCalc.js.
//
// Setup (tenant-wide; `staff` module):
//   GET    /setup                               settings + shifts + roles (any signed-in user)
//   PATCH  /settings                             { mode, slot_minutes, tip_round_to, tip_round_mode }
//   POST   /shifts   PATCH /shifts/:id   DELETE /shifts/:id   PUT /shifts/reorder { ids }
//   POST   /roles    PATCH /roles/:id    DELETE /roles/:id    PUT /roles/reorder  { ids }
//   Tip pots (migration 108):
//   POST   /pots     PATCH /pots/:id     DELETE /pots/:id     PUT /pots/reorder   { ids }
//   PUT    /pots/:id/sources           { source_ids }  Cash Recon SC sources feeding the pot
//   POST   /pots/:id/lines             { name, kind: amount | percent }  manual line (value entered weekly, may be negative)
//   PATCH  /pot-lines/:id  DELETE /pot-lines/:id  PUT /pots/:id/lines/reorder { ids }
//   GET    /sc-sources                 every venue's SC sources with their pot
//
// Staff (per venue; `staff` module):
//   GET    /venues/:venueId/staff               with role + per-shift rates
//   POST   /venues/:venueId/staff
//   PATCH  /venues/:venueId/staff/:id           incl. shift_rates [{ shift_id, rate }]
//   DELETE /venues/:venueId/staff/:id           soft (is_active=false) if used, else hard
//   PUT    /venues/:venueId/staff/reorder       { ids }
//
// Rota (per venue + ISO week; `rota` module):
//   GET    /venues/:venueId/weeks/:week         settings, shifts, staff, entries, open_dates
//   PUT    /venues/:venueId/weeks/:week/entries  whole-week replace
//   POST   /venues/:venueId/weeks/:week/copy     { from_week }
//
// Pay (`rota_pay` module) and tips (`rota_tips` module, migration 118); GET .../pay
// needs either and strips the half the caller can't view (redactWeek):
//   GET    /venues/:venueId/weeks/:week/pay
//   PUT    /venues/:venueId/weeks/:week/pot-lines       { amounts: [{ line_id, amount }] }
//   PUT    /venues/:venueId/weeks/:week/pots/:potId/manual  { amounts: [{ staff_id, amount }] }
//   PATCH  /venues/:venueId/weeks/:week/staff/:staffId  { pay_override }
//   POST   /venues/:venueId/weeks/:week/pay-adjustments { staff_id, kind: extra|deduction|advance, amount, note }
//   PATCH  /venues/:venueId/weeks/:week/pay-adjustments/:id { amount?, note? }
//   DELETE /venues/:venueId/weeks/:week/pay-adjustments/:id
//   POST   /venues/:venueId/weeks/:week/tip-moves       { kind: points | money, action: move | add | remove, from_staff_id (move only), lines: [{ to_staff_id, amount }], note (required for add/remove) }
//   DELETE /venues/:venueId/weeks/:week/tip-moves/:id
//   POST   /venues/:venueId/weeks/:week/reset-moves     { kind: points | money | all }
//   POST   /venues/:venueId/weeks/:week/tip-nudge       { staff_id, direction: plus | minus }  0.50 to / from the unallocated pot
//   POST   /venues/:venueId/weeks/:week/reset-unallocated  hand the unallocated pot back (every nudge to 0)
//   POST   /venues/:venueId/weeks/:week/fill-wages      writes Cash Recon wages

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission, requireAnyPermission, permissionLevel } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { computeRotaWeek, periodsOverlap, span } from '../services/rotaCalc.js'
import { openDatesOrNull } from '../services/openDays.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$|^24:00(:00)?$/
const UUID = z.string().uuid()
const Money = z.coerce.number().min(0).max(1_000_000)

const SettingsBody = z.object({
  mode:           z.enum(['day_parts', 'hourly']).optional(),
  slot_minutes:   z.union([z.literal(15), z.literal(30), z.literal(60)]).optional(),
  tip_round_to:   z.coerce.number().positive().max(1000).nullable().optional(),
  tip_round_mode: z.enum(['nearest', 'up', 'down']).optional(),
  hide_closed_on_rota:  z.boolean().optional(),
  hide_closed_on_print: z.boolean().optional(),
  hide_totals_on_print: z.boolean().optional(),
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

const PotBody = z.object({
  name:           z.string().trim().min(1).max(100),
  distribution:   z.enum(['house', 'points', 'manual']).default('points'),
  // Applied in this order, each on what is left after the ones before it.
  surcharges: z.array(z.object({
    name: z.string().trim().max(60).nullable().optional(),
    pct:  z.coerce.number().min(0).max(100),
  })).max(10).optional(),
})
const PotPatch = PotBody.partial().extend({ is_active: z.boolean().optional() })
const LineBody = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['amount', 'percent']).default('amount'),
})
const LinePatch = z.object({
  name:      z.string().trim().min(1).max(100).optional(),
  kind:      z.enum(['amount', 'percent']).optional(),
  is_active: z.boolean().optional(),
})
const AmountRow = key => z.object({ [key]: UUID, amount: Money.nullable() })

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

// Working, or a kind of time off (migration 129). See rotaCalc.js for pay rules.
const ENTRY_STATUSES = ['on', 'sick', 'pto', 'uto', 'abs']

const EntryBody = z.object({
  staff_id:   UUID,
  work_date:  z.string().regex(DATE_RE),
  shift_id:   UUID.nullable().optional(),
  start_time: z.string().regex(TIME_RE).nullable().optional(),
  end_time:   z.string().regex(TIME_RE).nullable().optional(),
  status:     z.enum(ENTRY_STATUSES).default('on'),
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
  const [row] = await tx`
    SELECT mode, slot_minutes, tip_round_to::float8 AS tip_round_to, tip_round_mode,
           hide_closed_on_rota, hide_closed_on_print, hide_totals_on_print
      FROM rota_settings WHERE tenant_id = ${tenantId}
  `
  return row ?? {
    mode: 'day_parts', slot_minutes: 30, tip_round_to: null, tip_round_mode: 'nearest',
    hide_closed_on_rota: false, hide_closed_on_print: false, hide_totals_on_print: false,
  }
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

/** Tip pots with their manual lines and allocated SC source ids (all venues). */
async function loadPots(tx, tenantId) {
  const [pots, lines, sources] = await Promise.all([
    tx`SELECT id, name, distribution, surcharges, sort_order, is_active FROM tip_pots
        WHERE tenant_id = ${tenantId} ORDER BY sort_order, name`,
    tx`SELECT id, pot_id, name, kind, sort_order, is_active FROM tip_pot_lines
        WHERE tenant_id = ${tenantId} ORDER BY sort_order, created_at`,
    tx`SELECT id, tip_pot_id FROM cash_sc_sources
        WHERE tenant_id = ${tenantId} AND tip_pot_id IS NOT NULL`,
  ])
  return pots.map(p => ({
    ...p,
    lines:      lines.filter(l => l.pot_id === p.id),
    source_ids: sources.filter(x => x.tip_pot_id === p.id).map(x => x.id),
  }))
}

/** Surcharges as stored: blank names become null, 0% rows are dropped. */
function cleanSurcharges(list) {
  return (list ?? [])
    .map(s => ({ name: s.name?.trim() || null, pct: Math.round(Number(s.pct) * 100) / 100 }))
    .filter(s => s.pct > 0)
}

async function assertPot(tx, tenantId, potId) {
  const [p] = await tx`SELECT id, distribution FROM tip_pots WHERE id = ${potId} AND tenant_id = ${tenantId}`
  if (!p) throw httpError(404, 'Tip pot not found')
  return p
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
           to_char(end_time,   'HH24:MI') AS end_time, status
      FROM rota_entries
     WHERE tenant_id = ${tenantId}
       AND venue_id  = ${venueId}
       AND work_date BETWEEN ${monday}::date AND ${addDays(monday, 6)}::date
     ORDER BY work_date, start_time NULLS FIRST
  `
}

/** Everything the pay calculation needs for one venue week. */
async function computeWeek(tx, tenantId, venueId, monday) {
  const sunday = addDays(monday, 6)
  const [shifts, entries, settings, pots] = await Promise.all([
    loadShifts(tx, tenantId), loadEntries(tx, tenantId, venueId, monday), loadSettings(tx, tenantId),
    loadPots(tx, tenantId),
  ])
  // This venue's service charge / tips for the week, per SC source.
  const scRows = await tx`
    SELECT s.id, s.name, s.tip_pot_id, COALESCE(SUM(e.amount), 0)::float8 AS amount
      FROM cash_sc_sources s
      LEFT JOIN cash_sc_entries e ON e.source_id = s.id AND e.tenant_id = ${tenantId}
       AND e.report_id IN (
         SELECT id FROM cash_daily_reports
          WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}
            AND report_date BETWEEN ${monday}::date AND ${sunday}::date)
     WHERE s.tenant_id = ${tenantId} AND s.venue_id = ${venueId} AND s.tip_pot_id IS NOT NULL
     GROUP BY s.id, s.name, s.tip_pot_id, s.sort_order
     ORDER BY s.sort_order, s.name
  `
  const lineAmounts = await tx`
    SELECT line_id, amount::float8 AS amount FROM rota_week_pot_lines
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND week_start = ${monday}::date
  `
  const manualRows = await tx`
    SELECT pot_id, staff_id, amount::float8 AS amount FROM rota_week_pot_manual
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND week_start = ${monday}::date
  `
  const lineAmt = new Map(lineAmounts.map(l => [l.line_id, l.amount]))

  // Active pots, plus inactive ones that still hold money this week.
  const potInputs = pots.map(p => {
    const sources = scRows.filter(r => r.tip_pot_id === p.id).map(r => ({ id: r.id, name: r.name, amount: r.amount }))
    const lines = p.lines
      .filter(l => l.is_active || lineAmt.has(l.id))
      .map(l => ({ id: l.id, name: l.name, kind: l.kind, amount: lineAmt.get(l.id) ?? 0, is_active: l.is_active }))
    const manual = {}
    for (const m of manualRows.filter(m => m.pot_id === p.id)) manual[m.staff_id] = m.amount
    return {
      id: p.id, name: p.name, distribution: p.distribution, is_active: p.is_active,
      surcharges: p.surcharges,
      sources, sources_total: sources.reduce((s, x) => s + x.amount, 0), lines, manual,
    }
  }).filter(p => p.is_active || p.sources_total > 0 || p.lines.some(l => l.amount !== 0) || Object.keys(p.manual).length)

  const weekStaff = await tx`
    SELECT staff_id, pay_override::float8 AS pay_override, tip_unallocated::float8 AS tip_unallocated
      FROM rota_week_staff
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND week_start = ${monday}::date
  `
  const moves = await loadMoves(tx, tenantId, venueId, monday)
  // Pay adjustments this week (migration 137), and what last week's Cash
  // Recon wage rows left unpaid (total - cash paid), which carries in.
  // Only part-paid rows carry: a row with no cash paid at all is either paid
  // another way (bank transfer) or not paid yet, and isn't counted as owed.
  const payAdjustments = await tx`
    SELECT id, staff_id, kind, amount::float8 AS amount, note, source_id
      FROM rota_pay_adjustments
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND week_start = ${monday}::date
     ORDER BY created_at, id
  `
  const owedRows = await tx`
    SELECT e.staff_id, SUM(e.total - e.cash_amount)::float8 AS owed
      FROM cash_wage_entries e
      JOIN cash_wage_reports r ON r.id = e.wage_report_id AND r.tenant_id = ${tenantId}
     WHERE e.tenant_id = ${tenantId} AND r.venue_id = ${venueId}
       AND r.week_start = ${addDays(monday, -7)}::date AND e.staff_id IS NOT NULL
       AND e.cash_amount > 0 AND e.cash_amount < e.total
     GROUP BY e.staff_id
    HAVING SUM(e.total - e.cash_amount) > 0.004
  `
  const carriedOwed = Object.fromEntries(owedRows.map(r => [r.staff_id, r.owed]))
  const withEntries = [...new Set([
    ...payAdjustments.map(a => a.staff_id), ...owedRows.map(r => r.staff_id),
    ...entries.map(e => e.staff_id), ...manualRows.map(m => m.staff_id),
    ...weekStaff.filter(w => w.pay_override != null || w.tip_unallocated !== 0).map(w => w.staff_id),
    ...moves.flatMap(m => [m.from_staff_id, ...m.lines.map(l => l.to_staff_id)]).filter(Boolean),
  ])]
  const staff = await loadStaff(tx, tenantId, venueId, { activeOnly: true, alsoIds: withEntries })
  const tipRounding = settings.tip_round_to ? { to: settings.tip_round_to, mode: settings.tip_round_mode } : null
  const result = computeRotaWeek({ shifts, staff, entries, weekStaff, moves, pots: potInputs, tipRounding, payAdjustments, carriedOwed })
  const nameOf = new Map(staff.map(s => [s.id, s.name]))
  return {
    ...result,
    week_start: monday,
    moves: moves.map(m => ({
      ...m,
      from_name: m.from_staff_id ? (nameOf.get(m.from_staff_id) ?? 'Unknown') : null,
      lines: m.lines.map(l => ({ ...l, name: nameOf.get(l.to_staff_id) ?? 'Unknown' })),
      total: Math.round(m.lines.reduce((s, l) => s + l.amount, 0) * 100) / 100,
    })),
  }
}

// The pay payload covers two permissions: `rota_pay` (hours and pay) and
// `rota_tips` (pots, points, shares, moves). Strip whichever the caller
// can't view, so a role can be given one without the other.
const PAY_ROW_FIELDS = ['pay_type', 'pay_basis', 'computed_pay', 'pay_override', 'pay', 'base_pay', 'adjustments',
  'extra_pay', 'deductions', 'advance', 'advance_repay', 'carried_owed', 'pay_shortfall']
const TIP_ROW_FIELDS = ['base_points', 'points_adjustment', 'tip_adjustment', 'tip_unallocated', 'points',
  'pot_shares', 'pot_shares_exact', 'tip_share', 'tip_share_from_pots']
const TIP_TOTAL_FIELDS = ['points', 'tips_gross', 'surcharges', 'tips_in', 'tips_shared',
  'kept_by_house', 'tips_added', 'tips_taken_out', 'tips_unallocated']

export function redactWeek(week, { pay, tips }) {
  const out = { ...week, access: { pay, tips } }
  const seePay = pay !== 'none'
  const seeTips = tips !== 'none'
  out.rows = week.rows.map(r => {
    const row = { ...r }
    if (!seePay) for (const f of PAY_ROW_FIELDS) delete row[f]
    if (!seeTips) for (const f of TIP_ROW_FIELDS) delete row[f]
    return row
  })
  out.totals = { ...week.totals }
  if (!seePay) delete out.totals.pay
  if (!seeTips) {
    for (const f of TIP_TOTAL_FIELDS) delete out.totals[f]
    out.pots = []
    out.moves = []
    out.tip_rounding = null
  }
  return out
}

async function weekFor(req, tx, monday) {
  const [pay, tips] = await Promise.all([permissionLevel(req, 'rota_pay'), permissionLevel(req, 'rota_tips')])
  return redactWeek(await computeWeek(tx, req.tenantId, req.params.venueId, monday), { pay, tips })
}

/** The week's tip moves, oldest first, each with its recipient lines. */
async function loadMoves(tx, tenantId, venueId, monday) {
  const moves = await tx`
    SELECT id, kind, action, from_staff_id, note, created_by, created_at
      FROM rota_tip_moves
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND week_start = ${monday}::date
     ORDER BY created_at, id
  `
  if (!moves.length) return []
  const lines = await tx`
    SELECT move_id, to_staff_id, amount::float8 AS amount
      FROM rota_tip_move_lines
     WHERE tenant_id = ${tenantId} AND move_id = ANY(${moves.map(m => m.id)}::uuid[])
  `
  return moves.map(m => ({ ...m, lines: lines.filter(l => l.move_id === m.id).map(({ move_id, ...l }) => l) }))
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
    const [settings, shifts, roles, pots] = await Promise.all([
      loadSettings(tx, req.tenantId), loadShifts(tx, req.tenantId), loadRoles(tx, req.tenantId),
      loadPots(tx, req.tenantId),
    ])
    return { settings, shifts, roles, pots }
  }))

  app.patch('/settings', { preHandler: requirePermission('staff', 'manage') }, async (req) => {
    const body = SettingsBody.parse(req.body)
    return withTenant(req.tenantId, async tx => {
      const current = await loadSettings(tx, req.tenantId)
      const next = { ...current, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) }
      const [row] = await tx`
        INSERT INTO rota_settings (tenant_id, mode, slot_minutes, tip_round_to, tip_round_mode,
                                   hide_closed_on_rota, hide_closed_on_print, hide_totals_on_print)
        VALUES (${req.tenantId}, ${next.mode}, ${next.slot_minutes}, ${next.tip_round_to}, ${next.tip_round_mode},
                ${next.hide_closed_on_rota}, ${next.hide_closed_on_print}, ${next.hide_totals_on_print})
        ON CONFLICT (tenant_id) DO UPDATE
          SET mode = EXCLUDED.mode, slot_minutes = EXCLUDED.slot_minutes,
              tip_round_to = EXCLUDED.tip_round_to, tip_round_mode = EXCLUDED.tip_round_mode,
              hide_closed_on_rota = EXCLUDED.hide_closed_on_rota,
              hide_closed_on_print = EXCLUDED.hide_closed_on_print,
              hide_totals_on_print = EXCLUDED.hide_totals_on_print,
              updated_at = now()
        RETURNING mode, slot_minutes, tip_round_to::float8 AS tip_round_to, tip_round_mode,
                  hide_closed_on_rota, hide_closed_on_print, hide_totals_on_print
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

  // Tip pots
  app.get('/sc-sources', { preHandler: requirePermission('staff', 'view') }, async (req) =>
    withTenant(req.tenantId, tx => tx`
      SELECT s.id, s.name, s.type, s.is_active, s.tip_pot_id, s.venue_id, v.name AS venue_name
        FROM cash_sc_sources s
        JOIN venues v ON v.id = s.venue_id
       WHERE s.tenant_id = ${req.tenantId}
       ORDER BY v.name, s.sort_order, s.name
    `))

  app.post('/pots', { preHandler: requirePermission('staff', 'manage') }, async (req) => {
    const b = PotBody.parse(req.body)
    const [row] = await withTenant(req.tenantId, async tx => {
      const [{ n }] = await tx`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM tip_pots WHERE tenant_id = ${req.tenantId}`
      return tx`
        INSERT INTO tip_pots (tenant_id, name, distribution, surcharges, sort_order)
        VALUES (${req.tenantId}, ${b.name}, ${b.distribution}, ${tx.json(cleanSurcharges(b.surcharges))}, ${n})
        RETURNING id
      `
    })
    return row
  })

  app.put('/pots/reorder', { preHandler: requirePermission('staff', 'manage') }, async (req) => {
    const { ids } = z.object({ ids: z.array(UUID) }).parse(req.body)
    await withTenant(req.tenantId, tx => reorder(tx, 'tip_pots', req.tenantId, ids))
    return { ok: true }
  })

  app.patch('/pots/:id', { preHandler: requirePermission('staff', 'manage') }, async (req) => {
    const b = PotPatch.parse(req.body)
    const fields = Object.keys(b).filter(k => b[k] !== undefined)
    if (!fields.length) throw httpError(400, 'No fields to update')
    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE tip_pots SET ${tx({
        ...Object.fromEntries(fields.map(k => [k, k === 'surcharges' ? tx.json(cleanSurcharges(b[k])) : b[k]])),
        updated_at: new Date(),
      }, ...fields, 'updated_at')}
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
      RETURNING id
    `)
    if (!row) throw httpError(404, 'Tip pot not found')
    return row
  })

  // Deleting a pot unassigns its sources and removes its lines and weekly amounts.
  app.delete('/pots/:id', { preHandler: requirePermission('staff', 'manage') }, async (req, reply) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      DELETE FROM tip_pots WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId} RETURNING id
    `)
    if (!row) throw httpError(404, 'Tip pot not found')
    return reply.code(204).send()
  })

  // A source feeds at most one pot: listing it here moves it from any other pot.
  app.put('/pots/:id/sources', { preHandler: requirePermission('staff', 'manage') }, async (req) => {
    const { source_ids } = z.object({ source_ids: z.array(UUID).max(500) }).parse(req.body)
    return withTenant(req.tenantId, async tx => {
      await assertPot(tx, req.tenantId, req.params.id)
      if (source_ids.length) {
        const ok = await tx`SELECT id FROM cash_sc_sources WHERE tenant_id = ${req.tenantId} AND id = ANY(${source_ids}::uuid[])`
        if (ok.length !== source_ids.length) throw httpError(400, 'Unknown service charge source')
      }
      await tx`
        UPDATE cash_sc_sources SET tip_pot_id = NULL
         WHERE tenant_id = ${req.tenantId} AND tip_pot_id = ${req.params.id}
           AND NOT (id = ANY(${source_ids}::uuid[]))
      `
      if (source_ids.length) {
        await tx`
          UPDATE cash_sc_sources SET tip_pot_id = ${req.params.id}
           WHERE tenant_id = ${req.tenantId} AND id = ANY(${source_ids}::uuid[])
        `
      }
      return { ok: true }
    })
  })

  app.post('/pots/:id/lines', { preHandler: requirePermission('staff', 'manage') }, async (req) => {
    const b = LineBody.parse(req.body)
    const [row] = await withTenant(req.tenantId, async tx => {
      await assertPot(tx, req.tenantId, req.params.id)
      const [{ n }] = await tx`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM tip_pot_lines WHERE pot_id = ${req.params.id}`
      return tx`
        INSERT INTO tip_pot_lines (tenant_id, pot_id, name, kind, sort_order)
        VALUES (${req.tenantId}, ${req.params.id}, ${b.name}, ${b.kind}, ${n})
        RETURNING id
      `
    })
    return row
  })

  app.put('/pots/:id/lines/reorder', { preHandler: requirePermission('staff', 'manage') }, async (req) => {
    const { ids } = z.object({ ids: z.array(UUID) }).parse(req.body)
    await withTenant(req.tenantId, tx =>
      reorder(tx, 'tip_pot_lines', req.tenantId, ids, tx`AND pot_id = ${req.params.id}`))
    return { ok: true }
  })

  app.patch('/pot-lines/:id', { preHandler: requirePermission('staff', 'manage') }, async (req) => {
    const b = LinePatch.parse(req.body)
    const fields = Object.keys(b).filter(k => b[k] !== undefined)
    if (!fields.length) throw httpError(400, 'No fields to update')
    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE tip_pot_lines SET ${tx(Object.fromEntries(fields.map(k => [k, b[k]])), ...fields)}
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
      RETURNING id
    `)
    if (!row) throw httpError(404, 'Line not found')
    return row
  })

  app.delete('/pot-lines/:id', { preHandler: requirePermission('staff', 'manage') }, async (req, reply) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      DELETE FROM tip_pot_lines WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId} RETURNING id
    `)
    if (!row) throw httpError(404, 'Line not found')
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
      const dates = weekDates(monday)
      // open_dates is null when the venue has no weekly schedule at all, so
      // "hide closed days" never hides a whole week of an unscheduled venue.
      const openDates = await openDatesOrNull(tx, req.tenantId, req.params.venueId, dates)
      return { week_start: monday, dates, open_dates: openDates, settings, shifts, staff, entries }
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
          status: e.status,
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
      // Only worked shifts are copied: sickness and time off are one-offs.
      const src = (await loadEntries(tx, req.tenantId, req.params.venueId, source)).filter(e => e.status === 'on')
      if (!src.length) throw httpError(422, `Nobody working on the rota for the week of ${source}`)
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

  app.get('/venues/:venueId/weeks/:week/pay', { preHandler: requireAnyPermission(['rota_pay', 'rota_tips'], 'view') }, async (req) => {
    const monday = mondayOf(req.params.week)
    return withTenant(req.tenantId, async tx => {
      await assertVenue(tx, req.tenantId, req.params.venueId)
      return weekFor(req, tx, monday)
    })
  })

  // This week's amounts for the pots' manual lines (blank / null clears one).
  app.put('/venues/:venueId/weeks/:week/pot-lines', { preHandler: requirePermission('rota_tips', 'manage') }, async (req) => {
    const monday = mondayOf(req.params.week)
    // Values may be negative (a deduction). £ for amount lines, % for percent lines.
    const { amounts } = z.object({
      amounts: z.array(z.object({
        line_id: UUID,
        amount:  z.coerce.number().min(-1_000_000).max(1_000_000).nullable(),
      })).max(500),
    }).parse(req.body)
    return withTenant(req.tenantId, async tx => {
      await assertVenue(tx, req.tenantId, req.params.venueId)
      const ids = amounts.map(a => a.line_id)
      if (ids.length) {
        const ok = await tx`SELECT id, name, kind FROM tip_pot_lines WHERE tenant_id = ${req.tenantId} AND id = ANY(${ids}::uuid[])`
        if (ok.length !== new Set(ids).size) throw httpError(400, 'Unknown pot line')
        const kindOf = new Map(ok.map(l => [l.id, l]))
        for (const a of amounts) {
          const l = kindOf.get(a.line_id)
          if (a.amount != null && l.kind === 'percent' && (a.amount < -100 || a.amount > 100)) {
            throw httpError(400, `${l.name}: enter a percentage between -100 and 100`)
          }
        }
      }
      for (const a of amounts) {
        if (a.amount == null) {
          await tx`
            DELETE FROM rota_week_pot_lines
             WHERE tenant_id = ${req.tenantId} AND venue_id = ${req.params.venueId}
               AND week_start = ${monday}::date AND line_id = ${a.line_id}
          `
        } else {
          await tx`
            INSERT INTO rota_week_pot_lines (tenant_id, venue_id, week_start, line_id, amount)
            VALUES (${req.tenantId}, ${req.params.venueId}, ${monday}::date, ${a.line_id}, ${a.amount})
            ON CONFLICT (venue_id, week_start, line_id) DO UPDATE SET amount = EXCLUDED.amount, updated_at = now()
          `
        }
      }
      return weekFor(req, tx, monday)
    })
  })

  // Manual distribution: replaces this week's per-person amounts for one pot.
  app.put('/venues/:venueId/weeks/:week/pots/:potId/manual', { preHandler: requirePermission('rota_tips', 'manage') }, async (req) => {
    const monday = mondayOf(req.params.week)
    const { amounts } = z.object({ amounts: z.array(AmountRow('staff_id')).max(500) }).parse(req.body)
    return withTenant(req.tenantId, async tx => {
      await assertVenue(tx, req.tenantId, req.params.venueId)
      const pot = await assertPot(tx, req.tenantId, req.params.potId)
      if (pot.distribution !== 'manual') throw httpError(422, 'This pot is not shared manually')
      const rows = amounts.filter(a => a.amount != null && a.amount > 0)
      if (rows.length) {
        const ok = await tx`
          SELECT id FROM cash_staff
           WHERE tenant_id = ${req.tenantId} AND venue_id = ${req.params.venueId}
             AND id = ANY(${rows.map(r => r.staff_id)}::uuid[])
        `
        if (ok.length !== new Set(rows.map(r => r.staff_id)).size) throw httpError(400, 'Unknown staff member for this venue')
      }
      await tx`
        DELETE FROM rota_week_pot_manual
         WHERE tenant_id = ${req.tenantId} AND venue_id = ${req.params.venueId}
           AND week_start = ${monday}::date AND pot_id = ${req.params.potId}
      `
      if (rows.length) {
        await tx`INSERT INTO rota_week_pot_manual ${tx(rows.map(r => ({
          tenant_id: req.tenantId, venue_id: req.params.venueId, week_start: monday,
          pot_id: req.params.potId, staff_id: r.staff_id, amount: r.amount,
        })))}`
      }
      return weekFor(req, tx, monday)
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
      return weekFor(req, tx, monday)
    })
  })

  // Pay adjustments (migration 137): extra pay, a deduction, or a cash
  // advance. An advance also books its repayment (advance_repay) in the
  // next week, linked by source_id, so it comes off next week's pay;
  // deleting the advance deletes the repayment. A repayment can be edited
  // (e.g. to spread it) or deleted on its own.
  app.post('/venues/:venueId/weeks/:week/pay-adjustments', { preHandler: requirePermission('rota_pay', 'manage') }, async (req) => {
    const monday = mondayOf(req.params.week)
    const body = z.object({
      staff_id: z.string().uuid(),
      kind:     z.enum(['extra', 'deduction', 'advance']),
      amount:   z.coerce.number().positive().max(1_000_000),
      note:     z.string().trim().max(500).nullable().optional(),
    }).parse(req.body)
    return withTenant(req.tenantId, async tx => {
      await assertVenue(tx, req.tenantId, req.params.venueId)
      const [st] = await tx`
        SELECT id FROM cash_staff WHERE id = ${body.staff_id} AND venue_id = ${req.params.venueId} AND tenant_id = ${req.tenantId}
      `
      if (!st) throw httpError(404, 'Staff member not found')
      const amount = Math.round(body.amount * 100) / 100
      const [adj] = await tx`
        INSERT INTO rota_pay_adjustments (tenant_id, venue_id, staff_id, week_start, kind, amount, note, created_by)
        VALUES (${req.tenantId}, ${req.params.venueId}, ${body.staff_id}, ${monday}::date, ${body.kind},
                ${amount}, ${body.note || null}, ${req.user?.email ?? null})
        RETURNING id
      `
      if (body.kind === 'advance') {
        await tx`
          INSERT INTO rota_pay_adjustments (tenant_id, venue_id, staff_id, week_start, kind, amount, note, source_id, created_by)
          VALUES (${req.tenantId}, ${req.params.venueId}, ${body.staff_id}, ${addDays(monday, 7)}::date, 'advance_repay',
                  ${amount}, ${body.note || null}, ${adj.id}, ${req.user?.email ?? null})
        `
      }
      return weekFor(req, tx, monday)
    })
  })

  app.patch('/venues/:venueId/weeks/:week/pay-adjustments/:id', { preHandler: requirePermission('rota_pay', 'manage') }, async (req) => {
    const monday = mondayOf(req.params.week)
    const body = z.object({
      amount: z.coerce.number().positive().max(1_000_000).optional(),
      note:   z.string().trim().max(500).nullable().optional(),
    }).parse(req.body)
    return withTenant(req.tenantId, async tx => {
      await assertVenue(tx, req.tenantId, req.params.venueId)
      const [adj] = await tx`
        SELECT id, kind, amount::float8 AS amount FROM rota_pay_adjustments
         WHERE id = ${req.params.id} AND venue_id = ${req.params.venueId} AND tenant_id = ${req.tenantId}
           AND week_start = ${monday}::date
      `
      if (!adj) throw httpError(404, 'Adjustment not found')
      const amount = body.amount != null ? Math.round(body.amount * 100) / 100 : adj.amount
      await tx`
        UPDATE rota_pay_adjustments SET amount = ${amount}, updated_at = now()
         WHERE id = ${adj.id} AND tenant_id = ${req.tenantId}
      `
      if (body.note !== undefined) {
        await tx`UPDATE rota_pay_adjustments SET note = ${body.note || null} WHERE id = ${adj.id} AND tenant_id = ${req.tenantId}`
      }
      // Changing an advance changes what comes off next week, unless next
      // week's repayment was already changed by hand.
      if (adj.kind === 'advance' && body.amount != null) {
        await tx`
          UPDATE rota_pay_adjustments SET amount = ${amount}, updated_at = now()
           WHERE source_id = ${adj.id} AND tenant_id = ${req.tenantId} AND amount = ${adj.amount}
        `
      }
      return weekFor(req, tx, monday)
    })
  })

  app.delete('/venues/:venueId/weeks/:week/pay-adjustments/:id', { preHandler: requirePermission('rota_pay', 'manage') }, async (req) => {
    const monday = mondayOf(req.params.week)
    return withTenant(req.tenantId, async tx => {
      await assertVenue(tx, req.tenantId, req.params.venueId)
      const [row] = await tx`
        DELETE FROM rota_pay_adjustments
         WHERE id = ${req.params.id} AND venue_id = ${req.params.venueId} AND tenant_id = ${req.tenantId}
           AND week_start = ${monday}::date
        RETURNING id
      `
      if (!row) throw httpError(404, 'Adjustment not found')
      return weekFor(req, tx, monday)
    })
  })

  // A tip move takes points or £ from one person and gives it to one or more
  // others. Zero-sum: the lines add up to exactly what the giver loses. The
  // UI works out an equal / by amount / by % split; the API stores the final
  // amount per recipient (2 decimals).
  app.post('/venues/:venueId/weeks/:week/tip-moves', { preHandler: requirePermission('rota_tips', 'manage') }, async (req) => {
    const monday = mondayOf(req.params.week)
    const b = z.object({
      kind:          z.enum(['points', 'money']),
      action:        z.enum(['move', 'add', 'remove']).default('move'),
      from_staff_id: UUID.nullable().optional(),
      lines: z.array(z.object({
        to_staff_id: UUID,
        amount:      z.coerce.number().positive().max(100_000),
      })).min(1).max(100),
      note: z.string().trim().max(300).nullable().optional(),
    }).parse(req.body)
    const lines = b.lines.map(l => ({ ...l, amount: Math.round(l.amount * 100) / 100 }))
    if (lines.some(l => l.amount <= 0)) throw httpError(400, 'Each amount must be at least 0.01')
    if (new Set(lines.map(l => l.to_staff_id)).size !== lines.length) throw httpError(400, 'Each person can only be picked once')
    const isMove = b.action === 'move'
    if (isMove && !b.from_staff_id) throw httpError(400, 'Pick who to take from')
    if (!isMove && b.from_staff_id) throw httpError(400, 'Only a move has someone to take from')
    if (!isMove && !b.note) throw httpError(400, 'Enter a reason')
    if (isMove && lines.some(l => l.to_staff_id === b.from_staff_id)) throw httpError(400, 'Cannot move to the same person')
    const total = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100
    const unit = (kind, v) => (kind === 'money' ? `£${v.toFixed(2)} in tips` : `${v} points`)

    return withTenant(req.tenantId, async tx => {
      await assertVenue(tx, req.tenantId, req.params.venueId)
      const before = await computeWeek(tx, req.tenantId, req.params.venueId, monday)
      const rowOf = id => before.rows.find(r => r.staff_id === id)
      const balance = r => (b.kind === 'money' ? r.tip_share : r.points)
      const from = isMove ? rowOf(b.from_staff_id) : null
      if ((isMove && !from) || lines.some(l => !rowOf(l.to_staff_id))) {
        throw httpError(404, 'Staff member not on this week')
      }
      if (isMove && total > balance(from) + 1e-9) {
        throw httpError(422, `${from.name} only has ${unit(b.kind, balance(from))} this week`)
      }
      if (b.action === 'remove') {
        const short = lines.map(l => rowOf(l.to_staff_id)).find((r, i) => lines[i].amount > balance(r) + 1e-9)
        if (short) throw httpError(422, `${short.name} only has ${unit(b.kind, balance(short))} this week`)
      }
      const [move] = await tx`
        INSERT INTO rota_tip_moves (tenant_id, venue_id, week_start, kind, action, from_staff_id, note, created_by)
        VALUES (${req.tenantId}, ${req.params.venueId}, ${monday}::date, ${b.kind}, ${b.action}, ${isMove ? b.from_staff_id : null},
                ${b.note || null}, ${req.user?.email ?? null})
        RETURNING id
      `
      await tx`
        INSERT INTO rota_tip_move_lines ${tx(lines.map(l => ({
          move_id: move.id, tenant_id: req.tenantId, to_staff_id: l.to_staff_id, amount: l.amount,
        })))}
      `
      return weekFor(req, tx, monday)
    })
  })

  app.delete('/venues/:venueId/weeks/:week/tip-moves/:id', { preHandler: requirePermission('rota_tips', 'manage') }, async (req) => {
    const monday = mondayOf(req.params.week)
    return withTenant(req.tenantId, async tx => {
      await assertVenue(tx, req.tenantId, req.params.venueId)
      const [row] = await tx`
        DELETE FROM rota_tip_moves
         WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
           AND venue_id = ${req.params.venueId} AND week_start = ${monday}::date
        RETURNING id
      `
      if (!row) throw httpError(404, 'Move not found')
      return weekFor(req, tx, monday)
    })
  })

  // Undo point moves, £ moves, or both for the week.
  app.post('/venues/:venueId/weeks/:week/reset-moves', { preHandler: requirePermission('rota_tips', 'manage') }, async (req) => {
    const monday = mondayOf(req.params.week)
    const { kind } = z.object({ kind: z.enum(['points', 'money', 'all']).default('all') }).parse(req.body ?? {})
    return withTenant(req.tenantId, async tx => {
      await assertVenue(tx, req.tenantId, req.params.venueId)
      const kinds = kind === 'all' ? ['points', 'money'] : [kind]
      await tx`
        DELETE FROM rota_tip_moves
         WHERE venue_id = ${req.params.venueId} AND week_start = ${monday}::date
           AND tenant_id = ${req.tenantId} AND kind = ANY(${kinds})
      `
      return weekFor(req, tx, monday)
    })
  })

  // +/- nudge: moves NUDGE_STEP between one person's tip total and the
  // week's unallocated pot. Minus needs the person to have at least the step;
  // plus needs the pot to hold at least the step. The advisory lock
  // serialises rapid taps on the same venue week so two can't both pass the
  // balance check.
  const NUDGE_STEP = 0.5
  app.post('/venues/:venueId/weeks/:week/tip-nudge', { preHandler: requirePermission('rota_tips', 'manage') }, async (req) => {
    const monday = mondayOf(req.params.week)
    const b = z.object({ staff_id: UUID, direction: z.enum(['plus', 'minus']) }).parse(req.body)
    return withTenant(req.tenantId, async tx => {
      await assertVenue(tx, req.tenantId, req.params.venueId)
      await tx`SELECT pg_advisory_xact_lock(hashtext(${'tip-nudge:' + req.params.venueId + ':' + monday}))`
      const before = await computeWeek(tx, req.tenantId, req.params.venueId, monday)
      const row = before.rows.find(r => r.staff_id === b.staff_id)
      if (!row) throw httpError(404, 'Staff member not on this week')
      if (b.direction === 'minus' && row.tip_share < NUDGE_STEP - 1e-9) {
        throw httpError(422, `${row.name} only has £${row.tip_share.toFixed(2)} in tips`)
      }
      if (b.direction === 'plus' && before.totals.tips_unallocated < NUDGE_STEP - 1e-9) {
        throw httpError(422, `Only £${before.totals.tips_unallocated.toFixed(2)} left unallocated`)
      }
      const delta = b.direction === 'plus' ? NUDGE_STEP : -NUDGE_STEP
      await ensureWeekStaff(tx, req.tenantId, req.params.venueId, monday, b.staff_id)
      await tx`
        UPDATE rota_week_staff SET tip_unallocated = tip_unallocated + ${delta}, updated_at = now()
         WHERE venue_id = ${req.params.venueId} AND week_start = ${monday}::date
           AND staff_id = ${b.staff_id} AND tenant_id = ${req.tenantId}
      `
      return weekFor(req, tx, monday)
    })
  })

  // Puts every nudge back to 0, so the unallocated pot is handed back to
  // the people it came from.
  app.post('/venues/:venueId/weeks/:week/reset-unallocated', { preHandler: requirePermission('rota_tips', 'manage') }, async (req) => {
    const monday = mondayOf(req.params.week)
    return withTenant(req.tenantId, async tx => {
      await assertVenue(tx, req.tenantId, req.params.venueId)
      await tx`
        UPDATE rota_week_staff SET tip_unallocated = 0, updated_at = now()
         WHERE venue_id = ${req.params.venueId} AND week_start = ${monday}::date
           AND tenant_id = ${req.tenantId} AND tip_unallocated <> 0
      `
      return weekFor(req, tx, monday)
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
      const rostered = week.rows.filter(r => r.entry_count > 0 || r.pay_override != null || r.adjustments.length > 0 || r.carried_owed > 0)
      if (!rostered.length) throw httpError(422, 'Nobody is on the rota this week')

      const [report] = await tx`
        INSERT INTO cash_wage_reports (tenant_id, venue_id, week_start)
        VALUES (${req.tenantId}, ${req.params.venueId}, ${monday}::date)
        ON CONFLICT (tenant_id, venue_id, week_start) DO UPDATE SET updated_at = now()
        RETURNING id
      `

      const existing = await tx`
        SELECT id, staff_id, total::float8 AS total, cash_amount::float8 AS cash_amount, notes
          FROM cash_wage_entries WHERE wage_report_id = ${report.id} AND tenant_id = ${req.tenantId}
      `
      const byStaff = new Map(existing.filter(e => e.staff_id).map(e => [e.staff_id, e]))
      let updated = 0, added = 0
      for (const r of rostered) {
        // paid_hours = worked + paid time off (PTO), so rate = pay / paid hours.
        const hourly = r.pay_type === 'hourly' && r.paid_hours > 0
        const values = {
          entry_type: hourly ? 'hourly' : 'fixed',
          hours:      hourly ? r.paid_hours : null,
          rate:       hourly ? Math.round((r.base_pay / r.paid_hours) * 100) / 100 : null,
          total:      r.pay,
        }
        // Adjustments behind the total, for the wage row's notes.
        const why = [
          r.extra_pay > 0 && `extra ${r.extra_pay.toFixed(2)}`,
          r.deductions > 0 && `deduction ${r.deductions.toFixed(2)}`,
          r.advance > 0 && `advance ${r.advance.toFixed(2)}`,
          r.advance_repay > 0 && `advance repaid ${r.advance_repay.toFixed(2)}`,
          r.carried_owed > 0 && `owed from last week ${r.carried_owed.toFixed(2)}`,
        ].filter(Boolean).join(', ') || null
        const prev = byStaff.get(r.staff_id)
        if (prev) {
          const fullyPaid = prev.cash_amount > 0 && prev.cash_amount === prev.total
          await tx`
            UPDATE cash_wage_entries
               SET entry_type = ${values.entry_type}, hours = ${values.hours}, rate = ${values.rate},
                   total = ${values.total}, name = ${r.name},
                   cash_amount = ${fullyPaid ? values.total : prev.cash_amount},
                   notes = ${prev.notes || why}
             WHERE id = ${prev.id}
          `
          updated++
        } else {
          await tx`
            INSERT INTO cash_wage_entries (tenant_id, wage_report_id, staff_id, name, entry_type, hours, rate, total, cash_amount, notes)
            VALUES (${req.tenantId}, ${report.id}, ${r.staff_id}, ${r.name}, ${values.entry_type},
                    ${values.hours}, ${values.rate}, ${values.total}, 0, ${why})
          `
          added++
        }
      }
      return { updated, added, total_pay: week.totals.pay }
    })
  })
}

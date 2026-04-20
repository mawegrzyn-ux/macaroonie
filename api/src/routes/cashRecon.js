// src/routes/cashRecon.js
//
// Cash Reconciliation module.
//
// Registered at prefix /api/venues so all paths below are relative to
// /:venueId/cash-recon/...
//
// Config (CRUD for lookup tables):
//   GET    /:venueId/cash-recon/config
//   PATCH  /:venueId/cash-recon/settings
//   POST   /:venueId/cash-recon/config/income-sources
//   PUT    /:venueId/cash-recon/config/income-sources/reorder
//   PATCH  /:venueId/cash-recon/config/income-sources/:id
//   PUT    /:venueId/cash-recon/config/income-sources/:id
//   DELETE /:venueId/cash-recon/config/income-sources/:id
//   POST   /:venueId/cash-recon/config/payment-channels
//   PUT    /:venueId/cash-recon/config/payment-channels/reorder
//   PATCH  /:venueId/cash-recon/config/payment-channels/:id
//   PUT    /:venueId/cash-recon/config/payment-channels/:id
//   DELETE /:venueId/cash-recon/config/payment-channels/:id
//   POST   /:venueId/cash-recon/config/sc-sources
//   PUT    /:venueId/cash-recon/config/sc-sources/reorder
//   PATCH  /:venueId/cash-recon/config/sc-sources/:id
//   PUT    /:venueId/cash-recon/config/sc-sources/:id
//   DELETE /:venueId/cash-recon/config/sc-sources/:id
//   POST   /:venueId/cash-recon/config/staff
//   PUT    /:venueId/cash-recon/config/staff/reorder
//   PATCH  /:venueId/cash-recon/config/staff/:id
//   PUT    /:venueId/cash-recon/config/staff/:id
//   DELETE /:venueId/cash-recon/config/staff/:id
//
// Week summary:
//   GET    /:venueId/cash-recon/week/:week_start
//
// Daily reports:
//   GET    /:venueId/cash-recon/daily/:date
//   PUT    /:venueId/cash-recon/daily/:date
//   POST   /:venueId/cash-recon/daily/:date/submit
//   POST   /:venueId/cash-recon/daily/:date/unsubmit
//
// Individual expenses:
//   POST   /:venueId/cash-recon/expenses
//   PUT    /:venueId/cash-recon/expenses/:expenseId
//   DELETE /:venueId/cash-recon/expenses/:expenseId
//
// Expense receipts:
//   POST   /:venueId/cash-recon/expenses/:expenseId/receipt
//   DELETE /:venueId/cash-recon/expenses/:expenseId/receipt
//
// Weekly wages:
//   GET    /:venueId/cash-recon/wages/:week_start
//   PUT    /:venueId/cash-recon/wages/:week_start
//   POST   /:venueId/cash-recon/wages/:week_start/submit
//   POST   /:venueId/cash-recon/wages/:week_start/unsubmit

import { z }                            from 'zod'
import { withTenant }                   from '../config/db.js'
import { requireAuth, requireRole }     from '../middleware/auth.js'
import { httpError }                    from '../middleware/error.js'
import { getStorage }                   from '../services/storageSvc.js'
import path                             from 'node:path'

// ── Schemas ───────────────────────────────────────────────────

const UUID = z.string().uuid()
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Config schemas
const IncomeSourceBody = z.object({
  name:                z.string().min(1).max(200),
  type:                z.enum(['pos', 'delivery', 'other']).default('other'),
  vat_rate:            z.coerce.number().min(0).max(100).default(0),
  vat_inclusive:       z.coerce.boolean().default(true),
  exclude_from_recon:  z.coerce.boolean().default(false),
  tooltip:             z.string().max(500).nullable().optional(),
})

const IncomeSourcePatch = z.object({
  name:                z.string().min(1).max(200).optional(),
  type:                z.enum(['pos', 'delivery', 'other']).optional(),
  vat_rate:            z.coerce.number().min(0).max(100).optional(),
  vat_inclusive:       z.coerce.boolean().optional(),
  exclude_from_recon:  z.coerce.boolean().optional(),
  tooltip:             z.string().max(500).nullable().optional(),
  is_active:           z.coerce.boolean().optional(),
  sort_order:          z.coerce.number().int().optional(),
})

const ChannelBody = z.object({
  name:    z.string().min(1).max(200),
  type:    z.enum(['cash', 'card', 'voucher', 'online', 'other']).default('cash'),
  tooltip: z.string().max(500).nullable().optional(),
})

const ChannelPatch = z.object({
  name:       z.string().min(1).max(200).optional(),
  type:       z.enum(['cash', 'card', 'voucher', 'online', 'other']).optional(),
  tooltip:    z.string().max(500).nullable().optional(),
  is_active:  z.coerce.boolean().optional(),
  sort_order: z.coerce.number().int().optional(),
})

const ScSourceBody = z.object({
  name:                z.string().min(1).max(200),
  type:                z.enum(['tips', 'service_charge']).default('tips'),
  included_in_takings: z.coerce.boolean().default(false),
  included_in_sales:   z.coerce.boolean().default(false),
  distribution:        z.enum(['house', 'staff', 'split']).default('house'),
  tooltip:             z.string().max(500).nullable().optional(),
})

const ScSourcePatch = z.object({
  name:                z.string().min(1).max(200).optional(),
  type:                z.enum(['tips', 'service_charge']).optional(),
  included_in_takings: z.coerce.boolean().optional(),
  included_in_sales:   z.coerce.boolean().optional(),
  distribution:        z.enum(['house', 'staff', 'split']).optional(),
  tooltip:             z.string().max(500).nullable().optional(),
  is_active:           z.coerce.boolean().optional(),
  sort_order:          z.coerce.number().int().optional(),
})

const CategoryBody = z.object({
  name:       z.string().min(1).max(100),
  colour:     z.string().max(20).nullable().optional(),
  sort_order: z.coerce.number().int().optional(),
})

const CategoryPatch = z.object({
  name:       z.string().min(1).max(100).optional(),
  colour:     z.string().max(20).nullable().optional(),
  is_active:  z.coerce.boolean().optional(),
  sort_order: z.coerce.number().int().optional(),
})

const StaffBody = z.object({
  name:         z.string().min(1).max(200),
  default_rate: z.coerce.number().min(0).nullable().optional(),
})

const StaffPatch = z.object({
  name:         z.string().min(1).max(200).optional(),
  default_rate: z.coerce.number().min(0).nullable().optional(),
  is_active:    z.coerce.boolean().optional(),
  sort_order:   z.coerce.number().int().optional(),
})

// Daily report schemas
const IncomeEntrySchema = z.object({
  source_id:    UUID,
  gross_amount: z.coerce.number().min(0).default(0),
  vat_amount:   z.coerce.number().min(0).default(0),
  net_amount:   z.coerce.number().min(0).default(0),
  notes:        z.string().max(500).nullable().optional(),
})

const TakingsEntrySchema = z.object({
  channel_id: UUID,
  amount:     z.coerce.number().min(0).default(0),
  notes:      z.string().max(500).nullable().optional(),
})

const ScEntrySchema = z.object({
  source_id: UUID,
  amount:    z.coerce.number().min(0).default(0),
  notes:     z.string().max(500).nullable().optional(),
})

const ExpenseEntrySchema = z.object({
  id:          UUID.optional(),
  description: z.string().min(1).max(500),
  category:    z.string().max(100).nullable().optional(),
  category_id: UUID.nullable().optional(),
  amount:      z.coerce.number().min(0).default(0),
  notes:       z.string().max(1000).nullable().optional(),
})

const DailyReportBody = z.object({
  notes:    z.string().max(2000).nullable().optional(),
  income:   z.array(IncomeEntrySchema).default([]),
  takings:  z.array(TakingsEntrySchema).default([]),
  sc:       z.array(ScEntrySchema).default([]),
  expenses: z.array(ExpenseEntrySchema).default([]),
})

// Wages schemas
const WageEntrySchema = z.object({
  id:          UUID.optional(),
  staff_id:    UUID.nullable().optional(),
  name:        z.string().min(1).max(200),
  entry_type:  z.enum(['hourly', 'fixed']).default('fixed'),
  hours:       z.coerce.number().min(0).nullable().optional(),
  rate:        z.coerce.number().min(0).nullable().optional(),
  total:       z.coerce.number().min(0).default(0),
  cash_amount: z.coerce.number().min(0).default(0),
  notes:       z.string().max(1000).nullable().optional(),
})

const WageReportBody = z.object({
  notes:   z.string().max(2000).nullable().optional(),
  entries: z.array(WageEntrySchema).default([]),
})

// ── Helpers ───────────────────────────────────────────────────

/**
 * Parse a YYYY-MM-DD string and return a JS Date at midnight UTC.
 * Throws httpError(400) if invalid.
 */
function parseDate(str) {
  if (!DATE_RE.test(str)) throw httpError(400, `Invalid date format: ${str} — expected YYYY-MM-DD`)
  const d = new Date(`${str}T00:00:00Z`)
  if (isNaN(d.getTime())) throw httpError(400, `Invalid date: ${str}`)
  return d
}

/**
 * Given any date string, return the ISO date string (YYYY-MM-DD) of the
 * Monday of the same ISO week.
 */
function toMondayStr(dateStr) {
  const d = parseDate(dateStr)
  // JS getDay(): 0=Sun, 1=Mon … 6=Sat
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day   // shift to Monday
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() + diff)
  return monday.toISOString().slice(0, 10)
}

/**
 * Verify that a venue belongs to the current tenant.
 * Must be called from OUTSIDE withTenant (uses the global sql).
 * Returns the venue row or throws 404.
 */
async function assertVenueOwnership(tx, tenantId, venueId) {
  const [venue] = await tx`
    SELECT id FROM venues
     WHERE id        = ${venueId}
       AND tenant_id = ${tenantId}
  `
  if (!venue) throw httpError(404, 'Venue not found')
  return venue
}

/**
 * Load a daily report header plus all its child entries.
 * Must be called from inside a withTenant callback.
 */
async function loadDailyReport(tx, tenantId, reportId) {
  const [report] = await tx`
    SELECT * FROM cash_daily_reports
     WHERE id        = ${reportId}
       AND tenant_id = ${tenantId}
  `
  if (!report) return null

  const [income, takings, sc, expenses] = await Promise.all([
    tx`
      SELECT e.*, s.name AS source_name, s.type AS source_type,
             s.vat_rate, s.vat_inclusive
        FROM cash_income_entries e
        JOIN cash_income_sources s ON s.id = e.source_id
       WHERE e.report_id  = ${reportId}
         AND e.tenant_id  = ${tenantId}
       ORDER BY s.sort_order, s.name
    `,
    tx`
      SELECT e.*, c.name AS channel_name, c.type AS channel_type
        FROM cash_takings_entries e
        JOIN cash_payment_channels c ON c.id = e.channel_id
       WHERE e.report_id  = ${reportId}
         AND e.tenant_id  = ${tenantId}
       ORDER BY c.sort_order, c.name
    `,
    tx`
      SELECT e.*, s.name AS source_name, s.type AS source_type,
             s.included_in_takings, s.included_in_sales, s.distribution
        FROM cash_sc_entries e
        JOIN cash_sc_sources s ON s.id = e.source_id
       WHERE e.report_id  = ${reportId}
         AND e.tenant_id  = ${tenantId}
       ORDER BY s.sort_order, s.name
    `,
    tx`
      SELECT * FROM cash_expenses
       WHERE report_id = ${reportId}
         AND tenant_id = ${tenantId}
       ORDER BY created_at
    `,
  ])

  return { ...report, income_entries: income, takings_entries: takings, sc_entries: sc, expenses }
}

/**
 * Load a wage report header plus all its entries.
 * Must be called from inside a withTenant callback.
 */
async function loadWageReport(tx, tenantId, wageReportId) {
  const [report] = await tx`
    SELECT * FROM cash_wage_reports
     WHERE id        = ${wageReportId}
       AND tenant_id = ${tenantId}
  `
  if (!report) return null

  const entries = await tx`
    SELECT e.*,
           s.name         AS staff_name,
           s.default_rate AS staff_default_rate
      FROM cash_wage_entries e
      LEFT JOIN cash_staff s ON s.id = e.staff_id
     WHERE e.wage_report_id = ${wageReportId}
       AND e.tenant_id      = ${tenantId}
     ORDER BY e.name
  `
  return { ...report, entries }
}

// Allowed MIME types for receipt uploads
const ALLOWED_RECEIPT_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp',
  'application/pdf',
])

/**
 * Determine which dates in `dates` the venue is actually open, applying the
 * same priority resolution as /schedule/sittings-for-date:
 *   1. Named schedule exceptions  2. Single-date overrides  3. Weekly templates
 * Returns the subset of `dates` (in original order) where the venue has sittings.
 * Must be called from inside a withTenant callback.
 */
async function resolveOpenDaysForWeek(tx, tenantId, venueId, dates) {
  const weekStart = dates[0]
  const weekEnd   = dates[dates.length - 1]

  // Bulk-load all three schedule layers for the week in parallel
  const [exceptions, overrides, templates] = await Promise.all([
    tx`
      SELECT id, is_closed, date_from::text, date_to::text
        FROM schedule_exceptions
       WHERE venue_id   = ${venueId}
         AND tenant_id  = ${tenantId}
         AND date_from <= ${weekEnd}::date
         AND date_to   >= ${weekStart}::date
       ORDER BY priority DESC, (date_to - date_from) ASC
    `,
    tx`
      SELECT override_date::text AS date, is_open
        FROM schedule_date_overrides
       WHERE venue_id      = ${venueId}
         AND tenant_id     = ${tenantId}
         AND override_date BETWEEN ${weekStart}::date AND ${weekEnd}::date
    `,
    tx`
      SELECT day_of_week, is_open
        FROM venue_schedule_templates
       WHERE venue_id  = ${venueId}
         AND tenant_id = ${tenantId}
    `,
  ])

  const overrideByDate = Object.fromEntries(overrides.map(o => [o.date, o.is_open]))
  const templateByDow  = Object.fromEntries(templates.map(t => [t.day_of_week, t.is_open]))

  // Bulk-load exception day-of-week templates for any relevant exceptions
  const excIds = exceptions.map(e => e.id)
  const excDayTemplates = excIds.length > 0
    ? await tx`
        SELECT exception_id, day_of_week, is_open
          FROM exception_day_templates
         WHERE exception_id = ANY(${excIds}::uuid[])
      `
    : []
  // excDowMap[excId][dow] = is_open (boolean)
  const excDowMap = {}
  for (const edt of excDayTemplates) {
    ;(excDowMap[edt.exception_id] ??= {})[edt.day_of_week] = edt.is_open
  }

  const openDates = []
  for (const date of dates) {
    // JS getUTCDay(): 0=Sun … 6=Sat — same convention as PostgreSQL EXTRACT(DOW)
    const dow = new Date(date + 'T12:00:00Z').getUTCDay()

    // Priority 1: named exception (array is already sorted highest-priority first)
    const exc = exceptions.find(e => e.date_from <= date && date <= e.date_to)
    if (exc) {
      if (exc.is_closed) continue           // whole period explicitly closed
      const dowMap = excDowMap[exc.id]
      if (dowMap) {
        const isOpen = dowMap[dow]
        if (isOpen !== undefined) {
          if (isOpen) openDates.push(date)
          continue
        }
      }
      // Exception exists but no DOW template — fall through to priority 2
    }

    // Priority 2: single-date override
    if (date in overrideByDate) {
      if (overrideByDate[date]) openDates.push(date)
      continue
    }

    // Priority 3: weekly template
    if (templateByDow[dow]) openDates.push(date)
  }

  return openDates
}

// ── Plugin ────────────────────────────────────────────────────

export default async function cashReconRoutes(app) {

  app.addHook('preHandler', requireAuth)

  // ── GET /:venueId/cash-recon/config ────────────────────────
  // Returns all config arrays for the venue in a single call.
  app.get('/:venueId/cash-recon/config', {
    preHandler: requireRole('operator', 'admin', 'owner'),
  }, async (req) => {
    const { venueId } = req.params

    return withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)

      const [income_sources, payment_channels, sc_sources, staff, expense_categories, venueSettingsRows] = await Promise.all([
        tx`
          SELECT * FROM cash_income_sources
           WHERE venue_id  = ${venueId}
             AND tenant_id = ${req.tenantId}
           ORDER BY sort_order, name
        `,
        tx`
          SELECT * FROM cash_payment_channels
           WHERE venue_id  = ${venueId}
             AND tenant_id = ${req.tenantId}
           ORDER BY sort_order, name
        `,
        tx`
          SELECT * FROM cash_sc_sources
           WHERE venue_id  = ${venueId}
             AND tenant_id = ${req.tenantId}
           ORDER BY sort_order, name
        `,
        tx`
          SELECT * FROM cash_staff
           WHERE venue_id  = ${venueId}
             AND tenant_id = ${req.tenantId}
           ORDER BY sort_order, name
        `,
        tx`
          SELECT * FROM cash_expense_categories
           WHERE venue_id  = ${venueId}
             AND tenant_id = ${req.tenantId}
           ORDER BY sort_order, created_at
        `,
        tx`
          SELECT allow_bulk_submit
            FROM cash_venue_settings
           WHERE venue_id  = ${venueId}
             AND tenant_id = ${req.tenantId}
        `,
      ])

      const venue_settings = venueSettingsRows[0] ?? { allow_bulk_submit: false }
      return { income_sources, payment_channels, sc_sources, staff, expense_categories, venue_settings }
    })
  })

  // ── PATCH /:venueId/cash-recon/settings ───────────────────────────────────
  // Upserts per-venue cash recon settings (allow_bulk_submit, etc.)
  app.patch('/:venueId/cash-recon/settings', {
    preHandler: requireRole('admin', 'owner'),
  }, async (req) => {
    const { venueId } = req.params
    const body = z.object({
      allow_bulk_submit: z.coerce.boolean().optional(),
    }).parse(req.body)

    const [row] = await withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)
      return tx`
        INSERT INTO cash_venue_settings (venue_id, tenant_id, allow_bulk_submit)
        VALUES (${venueId}, ${req.tenantId}, ${body.allow_bulk_submit ?? false})
        ON CONFLICT (venue_id) DO UPDATE
           SET allow_bulk_submit = EXCLUDED.allow_bulk_submit,
               updated_at        = now()
        RETURNING *
      `
    })
    return row
  })

  // ────────────────────────────────────────────────────────────
  // INCOME SOURCES CRUD
  // ────────────────────────────────────────────────────────────

  // POST /:venueId/cash-recon/config/income-sources
  app.post('/:venueId/cash-recon/config/income-sources', {
    preHandler: requireRole('operator', 'admin', 'owner'),
  }, async (req, reply) => {
    const { venueId } = req.params
    const body = IncomeSourceBody.parse(req.body)

    const [row] = await withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)
      return tx`
        INSERT INTO cash_income_sources
               (tenant_id, venue_id, name, type, vat_rate, vat_inclusive, exclude_from_recon, tooltip)
        VALUES (${req.tenantId}, ${venueId}, ${body.name}, ${body.type},
                ${body.vat_rate}, ${body.vat_inclusive}, ${body.exclude_from_recon}, ${body.tooltip ?? null})
        RETURNING *
      `
    })

    return reply.code(201).send(row)
  })

  // PUT /:venueId/cash-recon/config/income-sources/reorder
  // MUST be registered before /:id to prevent Fastify treating 'reorder' as an id param
  app.put('/:venueId/cash-recon/config/income-sources/reorder', {
    preHandler: requireRole('operator', 'admin', 'owner'),
  }, async (req) => {
    const { venueId } = req.params
    const { ids } = z.object({ ids: z.array(z.string().uuid()) }).parse(req.body)

    await withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)
      for (let i = 0; i < ids.length; i++) {
        await tx`
          UPDATE cash_income_sources
             SET sort_order = ${i}
           WHERE id        = ${ids[i]}
             AND venue_id  = ${venueId}
             AND tenant_id = ${req.tenantId}
        `
      }
    })

    return { ok: true }
  })

  // PATCH /:venueId/cash-recon/config/income-sources/:id
  // PUT   /:venueId/cash-recon/config/income-sources/:id  (alias)
  const incomeSourceUpdateHandler = async (req) => {
    const { venueId, id } = req.params
    const body = IncomeSourcePatch.parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [row] = await withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)
      const result = await tx`
        UPDATE cash_income_sources
           SET ${tx(body, ...fields)}
         WHERE id        = ${id}
           AND venue_id  = ${venueId}
           AND tenant_id = ${req.tenantId}
        RETURNING *
      `
      if (!result.length) throw httpError(404, 'Income source not found')
      return result
    })

    return row
  }
  app.patch('/:venueId/cash-recon/config/income-sources/:id', { preHandler: requireRole('operator', 'admin', 'owner') }, incomeSourceUpdateHandler)
  app.put('/:venueId/cash-recon/config/income-sources/:id',   { preHandler: requireRole('operator', 'admin', 'owner') }, incomeSourceUpdateHandler)

  // DELETE /:venueId/cash-recon/config/income-sources/:id
  app.delete('/:venueId/cash-recon/config/income-sources/:id', {
    preHandler: requireRole('operator', 'admin', 'owner'),
  }, async (req, reply) => {
    const { venueId, id } = req.params

    await withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)

      // Check whether any entries reference this source
      const [usage] = await tx`
        SELECT 1 FROM cash_income_entries
         WHERE source_id = ${id}
           AND tenant_id = ${req.tenantId}
         LIMIT 1
      `

      if (usage) {
        // Has history — soft-delete instead
        const [updated] = await tx`
          UPDATE cash_income_sources
             SET is_active = false
           WHERE id        = ${id}
             AND venue_id  = ${venueId}
             AND tenant_id = ${req.tenantId}
          RETURNING id
        `
        if (!updated) throw httpError(404, 'Income source not found')
      } else {
        const [deleted] = await tx`
          DELETE FROM cash_income_sources
           WHERE id        = ${id}
             AND venue_id  = ${venueId}
             AND tenant_id = ${req.tenantId}
          RETURNING id
        `
        if (!deleted) throw httpError(404, 'Income source not found')
      }
    })

    return reply.code(204).send()
  })

  // ────────────────────────────────────────────────────────────
  // PAYMENT CHANNELS CRUD
  // ────────────────────────────────────────────────────────────

  // POST /:venueId/cash-recon/config/payment-channels
  app.post('/:venueId/cash-recon/config/payment-channels', {
    preHandler: requireRole('operator', 'admin', 'owner'),
  }, async (req, reply) => {
    const { venueId } = req.params
    const body = ChannelBody.parse(req.body)

    const [row] = await withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)
      return tx`
        INSERT INTO cash_payment_channels (tenant_id, venue_id, name, type, tooltip)
        VALUES (${req.tenantId}, ${venueId}, ${body.name}, ${body.type}, ${body.tooltip ?? null})
        RETURNING *
      `
    })

    return reply.code(201).send(row)
  })

  // PUT /:venueId/cash-recon/config/payment-channels/reorder
  app.put('/:venueId/cash-recon/config/payment-channels/reorder', {
    preHandler: requireRole('operator', 'admin', 'owner'),
  }, async (req) => {
    const { venueId } = req.params
    const { ids } = z.object({ ids: z.array(z.string().uuid()) }).parse(req.body)

    await withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)
      for (let i = 0; i < ids.length; i++) {
        await tx`
          UPDATE cash_payment_channels
             SET sort_order = ${i}
           WHERE id        = ${ids[i]}
             AND venue_id  = ${venueId}
             AND tenant_id = ${req.tenantId}
        `
      }
    })

    return { ok: true }
  })

  // PATCH /:venueId/cash-recon/config/payment-channels/:id
  // PUT   /:venueId/cash-recon/config/payment-channels/:id  (alias)
  const channelUpdateHandler = async (req) => {
    const { venueId, id } = req.params
    const body = ChannelPatch.parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [row] = await withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)
      const result = await tx`
        UPDATE cash_payment_channels
           SET ${tx(body, ...fields)}
         WHERE id        = ${id}
           AND venue_id  = ${venueId}
           AND tenant_id = ${req.tenantId}
        RETURNING *
      `
      if (!result.length) throw httpError(404, 'Payment channel not found')
      return result
    })

    return row
  }
  app.patch('/:venueId/cash-recon/config/payment-channels/:id', { preHandler: requireRole('operator', 'admin', 'owner') }, channelUpdateHandler)
  app.put('/:venueId/cash-recon/config/payment-channels/:id',   { preHandler: requireRole('operator', 'admin', 'owner') }, channelUpdateHandler)

  // DELETE /:venueId/cash-recon/config/payment-channels/:id
  app.delete('/:venueId/cash-recon/config/payment-channels/:id', {
    preHandler: requireRole('operator', 'admin', 'owner'),
  }, async (req, reply) => {
    const { venueId, id } = req.params

    await withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)

      const [usage] = await tx`
        SELECT 1 FROM cash_takings_entries
         WHERE channel_id = ${id}
           AND tenant_id  = ${req.tenantId}
         LIMIT 1
      `

      if (usage) {
        const [updated] = await tx`
          UPDATE cash_payment_channels
             SET is_active = false
           WHERE id        = ${id}
             AND venue_id  = ${venueId}
             AND tenant_id = ${req.tenantId}
          RETURNING id
        `
        if (!updated) throw httpError(404, 'Payment channel not found')
      } else {
        const [deleted] = await tx`
          DELETE FROM cash_payment_channels
           WHERE id        = ${id}
             AND venue_id  = ${venueId}
             AND tenant_id = ${req.tenantId}
          RETURNING id
        `
        if (!deleted) throw httpError(404, 'Payment channel not found')
      }
    })

    return reply.code(204).send()
  })

  // ────────────────────────────────────────────────────────────
  // SC SOURCES CRUD
  // ────────────────────────────────────────────────────────────

  // POST /:venueId/cash-recon/config/sc-sources
  app.post('/:venueId/cash-recon/config/sc-sources', {
    preHandler: requireRole('operator', 'admin', 'owner'),
  }, async (req, reply) => {
    const { venueId } = req.params
    const body = ScSourceBody.parse(req.body)

    const [row] = await withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)
      return tx`
        INSERT INTO cash_sc_sources
               (tenant_id, venue_id, name, type,
                included_in_takings, included_in_sales,
                distribution, tooltip)
        VALUES (${req.tenantId}, ${venueId}, ${body.name}, ${body.type},
                ${body.included_in_takings}, ${body.included_in_sales},
                ${body.distribution}, ${body.tooltip ?? null})
        RETURNING *
      `
    })

    return reply.code(201).send(row)
  })

  // PUT /:venueId/cash-recon/config/sc-sources/reorder
  app.put('/:venueId/cash-recon/config/sc-sources/reorder', {
    preHandler: requireRole('operator', 'admin', 'owner'),
  }, async (req) => {
    const { venueId } = req.params
    const { ids } = z.object({ ids: z.array(z.string().uuid()) }).parse(req.body)

    await withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)
      for (let i = 0; i < ids.length; i++) {
        await tx`
          UPDATE cash_sc_sources
             SET sort_order = ${i}
           WHERE id        = ${ids[i]}
             AND venue_id  = ${venueId}
             AND tenant_id = ${req.tenantId}
        `
      }
    })

    return { ok: true }
  })

  // PATCH /:venueId/cash-recon/config/sc-sources/:id
  // PUT   /:venueId/cash-recon/config/sc-sources/:id  (alias)
  const scSourceUpdateHandler = async (req) => {
    const { venueId, id } = req.params
    const body = ScSourcePatch.parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [row] = await withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)
      const result = await tx`
        UPDATE cash_sc_sources
           SET ${tx(body, ...fields)}
         WHERE id        = ${id}
           AND venue_id  = ${venueId}
           AND tenant_id = ${req.tenantId}
        RETURNING *
      `
      if (!result.length) throw httpError(404, 'SC source not found')
      return result
    })

    return row
  }
  app.patch('/:venueId/cash-recon/config/sc-sources/:id', { preHandler: requireRole('operator', 'admin', 'owner') }, scSourceUpdateHandler)
  app.put('/:venueId/cash-recon/config/sc-sources/:id',   { preHandler: requireRole('operator', 'admin', 'owner') }, scSourceUpdateHandler)

  // DELETE /:venueId/cash-recon/config/sc-sources/:id
  app.delete('/:venueId/cash-recon/config/sc-sources/:id', {
    preHandler: requireRole('operator', 'admin', 'owner'),
  }, async (req, reply) => {
    const { venueId, id } = req.params

    await withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)

      const [usage] = await tx`
        SELECT 1 FROM cash_sc_entries
         WHERE source_id = ${id}
           AND tenant_id = ${req.tenantId}
         LIMIT 1
      `

      if (usage) {
        const [updated] = await tx`
          UPDATE cash_sc_sources
             SET is_active = false
           WHERE id        = ${id}
             AND venue_id  = ${venueId}
             AND tenant_id = ${req.tenantId}
          RETURNING id
        `
        if (!updated) throw httpError(404, 'SC source not found')
      } else {
        const [deleted] = await tx`
          DELETE FROM cash_sc_sources
           WHERE id        = ${id}
             AND venue_id  = ${venueId}
             AND tenant_id = ${req.tenantId}
          RETURNING id
        `
        if (!deleted) throw httpError(404, 'SC source not found')
      }
    })

    return reply.code(204).send()
  })

  // ────────────────────────────────────────────────────────────
  // STAFF CRUD
  // ────────────────────────────────────────────────────────────

  // POST /:venueId/cash-recon/config/staff
  app.post('/:venueId/cash-recon/config/staff', {
    preHandler: requireRole('operator', 'admin', 'owner'),
  }, async (req, reply) => {
    const { venueId } = req.params
    const body = StaffBody.parse(req.body)

    const [row] = await withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)
      return tx`
        INSERT INTO cash_staff (tenant_id, venue_id, name, default_rate)
        VALUES (${req.tenantId}, ${venueId}, ${body.name}, ${body.default_rate ?? null})
        RETURNING *
      `
    })

    return reply.code(201).send(row)
  })

  // PUT /:venueId/cash-recon/config/staff/reorder
  app.put('/:venueId/cash-recon/config/staff/reorder', {
    preHandler: requireRole('operator', 'admin', 'owner'),
  }, async (req) => {
    const { venueId } = req.params
    const { ids } = z.object({ ids: z.array(z.string().uuid()) }).parse(req.body)

    await withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)
      for (let i = 0; i < ids.length; i++) {
        await tx`
          UPDATE cash_staff
             SET sort_order = ${i}
           WHERE id        = ${ids[i]}
             AND venue_id  = ${venueId}
             AND tenant_id = ${req.tenantId}
        `
      }
    })

    return { ok: true }
  })

  // PATCH /:venueId/cash-recon/config/staff/:id
  // PUT   /:venueId/cash-recon/config/staff/:id  (alias)
  const staffUpdateHandler = async (req) => {
    const { venueId, id } = req.params
    const body = StaffPatch.parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [row] = await withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)
      const result = await tx`
        UPDATE cash_staff
           SET ${tx(body, ...fields)}
         WHERE id        = ${id}
           AND venue_id  = ${venueId}
           AND tenant_id = ${req.tenantId}
        RETURNING *
      `
      if (!result.length) throw httpError(404, 'Staff member not found')
      return result
    })

    return row
  }
  app.patch('/:venueId/cash-recon/config/staff/:id', { preHandler: requireRole('operator', 'admin', 'owner') }, staffUpdateHandler)
  app.put('/:venueId/cash-recon/config/staff/:id',   { preHandler: requireRole('operator', 'admin', 'owner') }, staffUpdateHandler)

  // DELETE /:venueId/cash-recon/config/staff/:id
  app.delete('/:venueId/cash-recon/config/staff/:id', {
    preHandler: requireRole('operator', 'admin', 'owner'),
  }, async (req, reply) => {
    const { venueId, id } = req.params

    await withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)

      const [usage] = await tx`
        SELECT 1 FROM cash_wage_entries
         WHERE staff_id  = ${id}
           AND tenant_id = ${req.tenantId}
         LIMIT 1
      `

      if (usage) {
        const [updated] = await tx`
          UPDATE cash_staff
             SET is_active = false
           WHERE id        = ${id}
             AND venue_id  = ${venueId}
             AND tenant_id = ${req.tenantId}
          RETURNING id
        `
        if (!updated) throw httpError(404, 'Staff member not found')
      } else {
        const [deleted] = await tx`
          DELETE FROM cash_staff
           WHERE id        = ${id}
             AND venue_id  = ${venueId}
             AND tenant_id = ${req.tenantId}
          RETURNING id
        `
        if (!deleted) throw httpError(404, 'Staff member not found')
      }
    })

    return reply.code(204).send()
  })

  // ────────────────────────────────────────────────────────────
  // EXPENSE CATEGORIES CRUD
  // ────────────────────────────────────────────────────────────

  // ── Expense Categories config ─────────────────────────────────────────────────

  // POST /:venueId/cash-recon/config/expense-categories
  app.post('/:venueId/cash-recon/config/expense-categories', {
    preHandler: requireRole('operator', 'admin', 'owner'),
  }, async (req, reply) => {
    const { venueId } = req.params
    const body = CategoryBody.parse(req.body)
    const [row] = await withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)
      return tx`
        INSERT INTO cash_expense_categories (tenant_id, venue_id, name, colour)
        VALUES (${req.tenantId}, ${venueId}, ${body.name}, ${body.colour ?? null})
        RETURNING *
      `
    })
    return reply.code(201).send(row)
  })

  // PUT /:venueId/cash-recon/config/expense-categories/reorder — BEFORE /:id
  app.put('/:venueId/cash-recon/config/expense-categories/reorder', {
    preHandler: requireRole('operator', 'admin', 'owner'),
  }, async (req) => {
    const { venueId } = req.params
    const { ids } = z.object({ ids: z.array(z.string().uuid()) }).parse(req.body)
    await withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)
      for (let i = 0; i < ids.length; i++) {
        await tx`
          UPDATE cash_expense_categories
             SET sort_order = ${i}
           WHERE id        = ${ids[i]}
             AND venue_id  = ${venueId}
             AND tenant_id = ${req.tenantId}
        `
      }
    })
    return { ok: true }
  })

  // PATCH/PUT /:venueId/cash-recon/config/expense-categories/:id
  const catUpdateHandler = async (req) => {
    const { venueId, id } = req.params
    const body = CategoryPatch.parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')
    const [row] = await withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)
      const result = await tx`
        UPDATE cash_expense_categories
           SET ${tx(body, ...fields)}
         WHERE id        = ${id}
           AND venue_id  = ${venueId}
           AND tenant_id = ${req.tenantId}
        RETURNING *
      `
      if (!result.length) throw httpError(404, 'Category not found')
      return result
    })
    return row
  }
  app.patch('/:venueId/cash-recon/config/expense-categories/:id', { preHandler: requireRole('operator', 'admin', 'owner') }, catUpdateHandler)
  app.put('/:venueId/cash-recon/config/expense-categories/:id',   { preHandler: requireRole('operator', 'admin', 'owner') }, catUpdateHandler)

  // DELETE /:venueId/cash-recon/config/expense-categories/:id
  app.delete('/:venueId/cash-recon/config/expense-categories/:id', {
    preHandler: requireRole('operator', 'admin', 'owner'),
  }, async (req, reply) => {
    const { venueId, id } = req.params
    await withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)
      const [usage] = await tx`
        SELECT 1 FROM cash_expenses WHERE category_id = ${id} AND tenant_id = ${req.tenantId} LIMIT 1
      `
      if (usage) {
        const [upd] = await tx`
          UPDATE cash_expense_categories
             SET is_active = false
           WHERE id        = ${id}
             AND venue_id  = ${venueId}
             AND tenant_id = ${req.tenantId}
          RETURNING id
        `
        if (!upd) throw httpError(404, 'Category not found')
      } else {
        const [del] = await tx`
          DELETE FROM cash_expense_categories
           WHERE id        = ${id}
             AND venue_id  = ${venueId}
             AND tenant_id = ${req.tenantId}
          RETURNING id
        `
        if (!del) throw httpError(404, 'Category not found')
      }
    })
    return reply.code(204).send()
  })

  // ────────────────────────────────────────────────────────────
  // WEEK SUMMARY
  // ────────────────────────────────────────────────────────────

  // GET /:venueId/cash-recon/week/:week_start
  app.get('/:venueId/cash-recon/week/:week_start', {
    preHandler: requireRole('operator', 'admin', 'owner'),
  }, async (req) => {
    const { venueId, week_start: rawWeekStart } = req.params

    const mondayStr = toMondayStr(rawWeekStart)

    // Build the 7 dates of the week (Mon–Sun)
    const weekDates = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(`${mondayStr}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() + i)
      weekDates.push(d.toISOString().slice(0, 10))
    }

    return withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)

      // Fetch all daily reports for the week in one query
      const reports = await tx`
        SELECT r.id,
               r.report_date::text AS report_date,
               r.status,
               COALESCE(SUM(ie.gross_amount), 0) AS total_income,
               COALESCE(SUM(te.amount),       0) AS total_takings
          FROM cash_daily_reports r
          LEFT JOIN cash_income_entries  ie ON ie.report_id = r.id AND ie.tenant_id = r.tenant_id
          LEFT JOIN cash_takings_entries te ON te.report_id = r.id AND te.tenant_id = r.tenant_id
         WHERE r.venue_id    = ${venueId}
           AND r.tenant_id   = ${req.tenantId}
           AND r.report_date = ANY(${weekDates}::date[])
         GROUP BY r.id, r.report_date, r.status
      `

      const reportByDate = Object.fromEntries(reports.map(r => [r.report_date, r]))

      const days = weekDates.map(date => {
        const r = reportByDate[date]
        if (!r) return { date, status: null }
        return {
          date,
          status:       r.status,
          total_income:  Number(r.total_income),
          total_takings: Number(r.total_takings),
          variance:      Number(r.total_takings) - Number(r.total_income),
        }
      })

      // Fetch wage report for this week
      const [wageReport] = await tx`
        SELECT wr.id,
               wr.status,
               COALESCE(SUM(we.total), 0) AS total_wages
          FROM cash_wage_reports wr
          LEFT JOIN cash_wage_entries we ON we.wage_report_id = wr.id AND we.tenant_id = wr.tenant_id
         WHERE wr.venue_id   = ${venueId}
           AND wr.tenant_id  = ${req.tenantId}
           AND wr.week_start = ${mondayStr}::date
         GROUP BY wr.id, wr.status
      `

      const wages = wageReport
        ? { status: wageReport.status, total_wages: Number(wageReport.total_wages) }
        : { status: null, total_wages: 0 }

      return { days, wages }
    })
  })

  // GET /:venueId/cash-recon/week-detail/:week_start
  // Returns full per-source/channel breakdown for all 7 days of the week in one call.
  app.get('/:venueId/cash-recon/week-detail/:week_start', {
    preHandler: requireRole('operator', 'admin', 'owner'),
  }, async (req) => {
    const { venueId, week_start } = req.params
    const weekStart = toMondayStr(week_start)

    const weekBase = parseDate(weekStart)
    const dates = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekBase)
      d.setUTCDate(weekBase.getUTCDate() + i)
      return d.toISOString().slice(0, 10)
    })
    const weekEnd = dates[6]

    return withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)

      const headers = await tx`
        SELECT id, report_date::text AS date, status
          FROM cash_daily_reports
         WHERE venue_id    = ${venueId}
           AND tenant_id   = ${req.tenantId}
           AND report_date BETWEEN ${weekStart}::date AND ${weekEnd}::date
      `

      const reportByDate = Object.fromEntries(headers.map(r => [r.date, r]))
      const reportIds    = headers.map(r => r.id)

      const [incomeRows, takingsRows, scRows, expenseRows] = reportIds.length > 0
        ? await Promise.all([
            tx`SELECT report_id, source_id, gross_amount, vat_amount, net_amount, notes
                 FROM cash_income_entries
                WHERE report_id = ANY(${reportIds}::uuid[]) AND tenant_id = ${req.tenantId}`,
            tx`SELECT report_id, channel_id, amount, notes
                 FROM cash_takings_entries
                WHERE report_id = ANY(${reportIds}::uuid[]) AND tenant_id = ${req.tenantId}`,
            tx`SELECT report_id, source_id, amount, notes
                 FROM cash_sc_entries
                WHERE report_id = ANY(${reportIds}::uuid[]) AND tenant_id = ${req.tenantId}`,
            tx`SELECT report_id, id, description, category, category_id, amount, notes
                 FROM cash_expenses
                WHERE report_id = ANY(${reportIds}::uuid[]) AND tenant_id = ${req.tenantId}
                ORDER BY created_at`,
          ])
        : [[], [], [], []]

      const groupByReport = rows => rows.reduce((acc, r) => {
        ;(acc[r.report_id] ??= []).push(r)
        return acc
      }, {})

      const incomeByRpt  = groupByReport(incomeRows)
      const takingsByRpt = groupByReport(takingsRows)
      const scByRpt      = groupByReport(scRows)
      const expenseByRpt = groupByReport(expenseRows)

      const [wages] = await tx`
        SELECT wr.status,
               COALESCE(SUM(we.total), 0) AS total_wages
          FROM cash_wage_reports wr
          LEFT JOIN cash_wage_entries we
                 ON we.wage_report_id = wr.id AND we.tenant_id = ${req.tenantId}
         WHERE wr.venue_id   = ${venueId}
           AND wr.tenant_id  = ${req.tenantId}
           AND wr.week_start = ${weekStart}::date
         GROUP BY wr.id, wr.status
      `

      const days = {}
      for (const date of dates) {
        const hdr = reportByDate[date]
        if (!hdr) { days[date] = null; continue }
        const exps   = expenseByRpt[hdr.id] ?? []
        const totExp = exps.reduce((s, e) => s + parseFloat(e.amount ?? 0), 0)
        days[date] = {
          status:         hdr.status,
          report_id:      hdr.id,
          income:         incomeByRpt[hdr.id]  ?? [],
          sc:             scByRpt[hdr.id]      ?? [],
          takings:        takingsByRpt[hdr.id] ?? [],
          expenses:       exps,
          total_expenses: totExp.toFixed(2),
        }
      }

      // Resolve which days the venue is actually open (schedule-aware)
      const openDates = await resolveOpenDaysForWeek(tx, req.tenantId, venueId, dates)

      return {
        dates,
        open_dates:   openDates,
        days,
        wages_total:  wages ? String(wages.total_wages) : null,
        wages_status: wages?.status ?? null,
      }
    })
  })

  // ────────────────────────────────────────────────────────────
  // DAILY REPORT
  // ────────────────────────────────────────────────────────────

  // GET /:venueId/cash-recon/daily/:date
  app.get('/:venueId/cash-recon/daily/:date', {
    preHandler: requireRole('operator', 'admin', 'owner'),
  }, async (req) => {
    const { venueId, date } = req.params
    parseDate(date)   // validates format

    return withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)

      const [header] = await tx`
        SELECT * FROM cash_daily_reports
         WHERE venue_id    = ${venueId}
           AND tenant_id   = ${req.tenantId}
           AND report_date = ${date}::date
      `
      if (!header) return null

      return loadDailyReport(tx, req.tenantId, header.id)
    })
  })

  // PUT /:venueId/cash-recon/daily/:date
  // Upsert full daily report.
  app.put('/:venueId/cash-recon/daily/:date', {
    preHandler: requireRole('operator', 'admin', 'owner'),
  }, async (req) => {
    const { venueId, date } = req.params
    parseDate(date)
    const body = DailyReportBody.parse(req.body)

    return withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)

      // Upsert the report header
      const [report] = await tx`
        INSERT INTO cash_daily_reports (tenant_id, venue_id, report_date, notes)
        VALUES (${req.tenantId}, ${venueId}, ${date}::date, ${body.notes ?? null})
        ON CONFLICT (tenant_id, venue_id, report_date) DO UPDATE
          SET notes      = EXCLUDED.notes,
              updated_at = now()
        RETURNING *
      `

      const reportId = report.id

      // Block writes to submitted reports
      if (report.status === 'submitted') {
        throw httpError(422, 'Cannot edit a submitted report — unsubmit first')
      }

      // Replace income entries (DELETE + INSERT)
      await tx`
        DELETE FROM cash_income_entries
         WHERE report_id = ${reportId}
           AND tenant_id = ${req.tenantId}
      `
      if (body.income.length > 0) {
        await tx`
          INSERT INTO cash_income_entries ${tx(body.income.map(e => ({
            tenant_id:    req.tenantId,
            report_id:    reportId,
            source_id:    e.source_id,
            gross_amount: e.gross_amount,
            vat_amount:   e.vat_amount,
            net_amount:   e.net_amount,
            notes:        e.notes ?? null,
          })))}
        `
      }

      // Replace takings entries
      await tx`
        DELETE FROM cash_takings_entries
         WHERE report_id = ${reportId}
           AND tenant_id = ${req.tenantId}
      `
      if (body.takings.length > 0) {
        await tx`
          INSERT INTO cash_takings_entries ${tx(body.takings.map(e => ({
            tenant_id:  req.tenantId,
            report_id:  reportId,
            channel_id: e.channel_id,
            amount:     e.amount,
            notes:      e.notes ?? null,
          })))}
        `
      }

      // Replace SC entries
      await tx`
        DELETE FROM cash_sc_entries
         WHERE report_id = ${reportId}
           AND tenant_id = ${req.tenantId}
      `
      if (body.sc.length > 0) {
        await tx`
          INSERT INTO cash_sc_entries ${tx(body.sc.map(e => ({
            tenant_id: req.tenantId,
            report_id: reportId,
            source_id: e.source_id,
            amount:    e.amount,
            notes:     e.notes ?? null,
          })))}
        `
      }

      // Expense handling — more careful: preserve receipt_url rows
      const incomingIds = new Set(body.expenses.filter(e => e.id).map(e => e.id))

      // Fetch current expenses to decide what to delete vs keep
      const existingExpenses = await tx`
        SELECT id, receipt_url FROM cash_expenses
         WHERE report_id = ${reportId}
           AND tenant_id = ${req.tenantId}
      `

      for (const existing of existingExpenses) {
        if (!incomingIds.has(existing.id)) {
          if (existing.receipt_url) {
            // Has a receipt — zero amount but do not delete the row
            await tx`
              UPDATE cash_expenses
                 SET amount = 0,
                     notes  = NULL
               WHERE id        = ${existing.id}
                 AND tenant_id = ${req.tenantId}
            `
          } else {
            // No receipt — safe to delete
            await tx`
              DELETE FROM cash_expenses
               WHERE id        = ${existing.id}
                 AND tenant_id = ${req.tenantId}
            `
          }
        }
      }

      // Upsert each incoming expense
      for (const e of body.expenses) {
        if (e.id) {
          // Update existing
          await tx`
            UPDATE cash_expenses
               SET description = ${e.description},
                   category    = ${e.category ?? null},
                   category_id = ${e.category_id ?? null},
                   amount      = ${e.amount},
                   notes       = ${e.notes ?? null}
             WHERE id        = ${e.id}
               AND report_id = ${reportId}
               AND tenant_id = ${req.tenantId}
          `
        } else {
          // Insert new
          await tx`
            INSERT INTO cash_expenses
                   (tenant_id, report_id, description, category, category_id, amount, notes)
            VALUES (${req.tenantId}, ${reportId}, ${e.description},
                    ${e.category ?? null}, ${e.category_id ?? null}, ${e.amount}, ${e.notes ?? null})
          `
        }
      }

      return loadDailyReport(tx, req.tenantId, reportId)
    })
  })

  // POST /:venueId/cash-recon/daily/:date/submit
  app.post('/:venueId/cash-recon/daily/:date/submit', {
    preHandler: requireRole('operator', 'admin', 'owner'),
  }, async (req) => {
    const { venueId, date } = req.params
    parseDate(date)

    return withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)

      const [report] = await tx`
        SELECT * FROM cash_daily_reports
         WHERE venue_id    = ${venueId}
           AND tenant_id   = ${req.tenantId}
           AND report_date = ${date}::date
      `
      if (!report) throw httpError(404, 'Daily report not found')
      if (report.status === 'submitted') throw httpError(422, 'Report is already submitted')

      await tx`
        UPDATE cash_daily_reports
           SET status       = 'submitted',
               submitted_at = now(),
               submitted_by = ${req.user.sub},
               updated_at   = now()
         WHERE id        = ${report.id}
           AND tenant_id = ${req.tenantId}
      `

      return loadDailyReport(tx, req.tenantId, report.id)
    })
  })

  // POST /:venueId/cash-recon/daily/:date/unsubmit (admin/owner only)
  app.post('/:venueId/cash-recon/daily/:date/unsubmit', {
    preHandler: requireRole('admin', 'owner'),
  }, async (req) => {
    const { venueId, date } = req.params
    parseDate(date)

    return withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)

      const [report] = await tx`
        SELECT * FROM cash_daily_reports
         WHERE venue_id    = ${venueId}
           AND tenant_id   = ${req.tenantId}
           AND report_date = ${date}::date
      `
      if (!report) throw httpError(404, 'Daily report not found')
      if (report.status === 'draft') throw httpError(422, 'Report is already in draft')

      await tx`
        UPDATE cash_daily_reports
           SET status       = 'draft',
               submitted_at = NULL,
               submitted_by = NULL,
               updated_at   = now()
         WHERE id        = ${report.id}
           AND tenant_id = ${req.tenantId}
      `

      return loadDailyReport(tx, req.tenantId, report.id)
    })
  })

  // ────────────────────────────────────────────────────────────
  // INDIVIDUAL EXPENSE CRUD
  // ────────────────────────────────────────────────────────────

  // POST /:venueId/cash-recon/expenses
  app.post('/:venueId/cash-recon/expenses', {
    preHandler: requireRole('operator', 'admin', 'owner'),
  }, async (req, reply) => {
    const { venueId } = req.params
    const { report_id, description, category, category_id, amount, notes } = z.object({
      report_id:   z.string().uuid(),
      description: z.string().min(1).max(500),
      category:    z.string().max(100).nullable().optional(),
      category_id: UUID.nullable().optional(),
      amount:      z.coerce.number().min(0).default(0),
      notes:       z.string().max(1000).nullable().optional(),
    }).parse(req.body)

    const [row] = await withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)

      // Verify the report belongs to this tenant + venue
      const [report] = await tx`
        SELECT id FROM cash_daily_reports
         WHERE id        = ${report_id}
           AND venue_id  = ${venueId}
           AND tenant_id = ${req.tenantId}
      `
      if (!report) throw httpError(404, 'Daily report not found')

      return tx`
        INSERT INTO cash_expenses
               (tenant_id, report_id, description, category, category_id, amount, notes)
        VALUES (${req.tenantId}, ${report_id}, ${description},
                ${category ?? null}, ${category_id ?? null}, ${amount}, ${notes ?? null})
        RETURNING *
      `
    })

    return reply.code(201).send(row)
  })

  // PUT /:venueId/cash-recon/expenses/:expenseId
  app.put('/:venueId/cash-recon/expenses/:expenseId', {
    preHandler: requireRole('operator', 'admin', 'owner'),
  }, async (req) => {
    const { venueId, expenseId } = req.params
    const { description, category, category_id, amount, notes } = z.object({
      description: z.string().min(1).max(500),
      category:    z.string().max(100).nullable().optional(),
      category_id: UUID.nullable().optional(),
      amount:      z.coerce.number().min(0).default(0),
      notes:       z.string().max(1000).nullable().optional(),
    }).parse(req.body)

    const [row] = await withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)

      const result = await tx`
        UPDATE cash_expenses
           SET description = ${description},
               category    = ${category ?? null},
               category_id = ${category_id ?? null},
               amount      = ${amount},
               notes       = ${notes ?? null}
         WHERE id        = ${expenseId}
           AND tenant_id = ${req.tenantId}
           AND report_id IN (
             SELECT id FROM cash_daily_reports
              WHERE venue_id  = ${venueId}
                AND tenant_id = ${req.tenantId}
           )
        RETURNING *
      `
      if (!result.length) throw httpError(404, 'Expense not found')
      return result
    })

    return row
  })

  // DELETE /:venueId/cash-recon/expenses/:expenseId
  // Only allowed when no receipt is attached.
  app.delete('/:venueId/cash-recon/expenses/:expenseId', {
    preHandler: requireRole('operator', 'admin', 'owner'),
  }, async (req, reply) => {
    const { venueId, expenseId } = req.params

    await withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)

      const [expense] = await tx`
        SELECT e.id, e.receipt_url
          FROM cash_expenses e
          JOIN cash_daily_reports r ON r.id = e.report_id
         WHERE e.id        = ${expenseId}
           AND e.tenant_id = ${req.tenantId}
           AND r.venue_id  = ${venueId}
      `
      if (!expense) throw httpError(404, 'Expense not found')
      if (expense.receipt_url) throw httpError(422, 'Cannot delete an expense with a receipt — delete the receipt first')

      await tx`
        DELETE FROM cash_expenses
         WHERE id        = ${expenseId}
           AND tenant_id = ${req.tenantId}
      `
    })

    return reply.code(204).send()
  })

  // ────────────────────────────────────────────────────────────
  // EXPENSE RECEIPTS
  // ────────────────────────────────────────────────────────────

  // POST /:venueId/cash-recon/expenses/:expenseId/receipt
  app.post('/:venueId/cash-recon/expenses/:expenseId/receipt', {
    preHandler: requireRole('operator', 'admin', 'owner'),
  }, async (req, reply) => {
    const { venueId, expenseId } = req.params

    // Verify the expense belongs to this tenant + venue
    const expense = await withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)

      const [row] = await tx`
        SELECT e.id, e.receipt_url
          FROM cash_expenses e
          JOIN cash_daily_reports r ON r.id = e.report_id
         WHERE e.id        = ${expenseId}
           AND e.tenant_id = ${req.tenantId}
           AND r.venue_id  = ${venueId}
      `
      if (!row) throw httpError(404, 'Expense not found')
      return row
    })

    // Read multipart file
    const data = await req.file()
    if (!data) throw httpError(400, 'No file uploaded')

    const mimetype = data.mimetype
    if (!ALLOWED_RECEIPT_MIME.has(mimetype)) {
      throw httpError(415, 'Unsupported file type — allowed: JPEG, PNG, WebP, PDF')
    }

    const buffer = await data.toBuffer()
    const ext = path.extname(data.filename).replace('.', '') || mimetype.split('/')[1]

    // Delete old receipt if present
    if (expense.receipt_url) {
      await getStorage().delete(expense.receipt_url).catch(() => null)
    }

    const { url } = await getStorage().put(req.tenantId, 'receipts', ext, mimetype, buffer)

    await withTenant(req.tenantId, tx => tx`
      UPDATE cash_expenses
         SET receipt_url = ${url}
       WHERE id        = ${expenseId}
         AND tenant_id = ${req.tenantId}
    `)

    return reply.code(200).send({ receipt_url: url })
  })

  // DELETE /:venueId/cash-recon/expenses/:expenseId/receipt
  app.delete('/:venueId/cash-recon/expenses/:expenseId/receipt', {
    preHandler: requireRole('operator', 'admin', 'owner'),
  }, async (req) => {
    const { venueId, expenseId } = req.params

    return withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)

      const [expense] = await tx`
        SELECT e.id, e.receipt_url
          FROM cash_expenses e
          JOIN cash_daily_reports r ON r.id = e.report_id
         WHERE e.id        = ${expenseId}
           AND e.tenant_id = ${req.tenantId}
           AND r.venue_id  = ${venueId}
      `
      if (!expense) throw httpError(404, 'Expense not found')
      if (!expense.receipt_url) throw httpError(422, 'Expense has no receipt')

      await getStorage().delete(expense.receipt_url).catch(() => null)

      const [updated] = await tx`
        UPDATE cash_expenses
           SET receipt_url = NULL
         WHERE id        = ${expenseId}
           AND tenant_id = ${req.tenantId}
        RETURNING *
      `

      return updated
    })
  })

  // ────────────────────────────────────────────────────────────
  // WEEKLY WAGES
  // ────────────────────────────────────────────────────────────

  // GET /:venueId/cash-recon/wages/:week_start
  app.get('/:venueId/cash-recon/wages/:week_start', {
    preHandler: requireRole('operator', 'admin', 'owner'),
  }, async (req) => {
    const { venueId, week_start } = req.params
    const mondayStr = toMondayStr(week_start)

    return withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)

      const [header] = await tx`
        SELECT * FROM cash_wage_reports
         WHERE venue_id   = ${venueId}
           AND tenant_id  = ${req.tenantId}
           AND week_start = ${mondayStr}::date
      `
      if (!header) return null

      return loadWageReport(tx, req.tenantId, header.id)
    })
  })

  // PUT /:venueId/cash-recon/wages/:week_start
  app.put('/:venueId/cash-recon/wages/:week_start', {
    preHandler: requireRole('operator', 'admin', 'owner'),
  }, async (req) => {
    const { venueId, week_start } = req.params
    const mondayStr = toMondayStr(week_start)
    const body = WageReportBody.parse(req.body)

    return withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)

      // Upsert wage report header
      const [report] = await tx`
        INSERT INTO cash_wage_reports (tenant_id, venue_id, week_start, notes)
        VALUES (${req.tenantId}, ${venueId}, ${mondayStr}::date, ${body.notes ?? null})
        ON CONFLICT (tenant_id, venue_id, week_start) DO UPDATE
          SET notes      = EXCLUDED.notes,
              updated_at = now()
        RETURNING *
      `

      if (report.status === 'submitted') {
        throw httpError(422, 'Cannot edit a submitted wage report — unsubmit first')
      }

      // Replace all entries (DELETE + INSERT)
      await tx`
        DELETE FROM cash_wage_entries
         WHERE wage_report_id = ${report.id}
           AND tenant_id      = ${req.tenantId}
      `

      if (body.entries.length > 0) {
        await tx`
          INSERT INTO cash_wage_entries ${tx(body.entries.map(e => ({
            tenant_id:      req.tenantId,
            wage_report_id: report.id,
            staff_id:       e.staff_id ?? null,
            name:           e.name,
            entry_type:     e.entry_type,
            hours:          e.hours ?? null,
            rate:           e.rate ?? null,
            total:          e.total,
            cash_amount:    e.cash_amount,
            notes:          e.notes ?? null,
          })))}
        `
      }

      return loadWageReport(tx, req.tenantId, report.id)
    })
  })

  // POST /:venueId/cash-recon/wages/:week_start/submit
  app.post('/:venueId/cash-recon/wages/:week_start/submit', {
    preHandler: requireRole('operator', 'admin', 'owner'),
  }, async (req) => {
    const { venueId, week_start } = req.params
    const mondayStr = toMondayStr(week_start)

    return withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)

      const [report] = await tx`
        SELECT * FROM cash_wage_reports
         WHERE venue_id   = ${venueId}
           AND tenant_id  = ${req.tenantId}
           AND week_start = ${mondayStr}::date
      `
      if (!report) throw httpError(404, 'Wage report not found')
      if (report.status === 'submitted') throw httpError(422, 'Wage report is already submitted')

      await tx`
        UPDATE cash_wage_reports
           SET status       = 'submitted',
               submitted_at = now(),
               updated_at   = now()
         WHERE id        = ${report.id}
           AND tenant_id = ${req.tenantId}
      `

      return loadWageReport(tx, req.tenantId, report.id)
    })
  })

  // POST /:venueId/cash-recon/wages/:week_start/unsubmit (admin/owner only)
  app.post('/:venueId/cash-recon/wages/:week_start/unsubmit', {
    preHandler: requireRole('admin', 'owner'),
  }, async (req) => {
    const { venueId, week_start } = req.params
    const mondayStr = toMondayStr(week_start)

    return withTenant(req.tenantId, async tx => {
      await assertVenueOwnership(tx, req.tenantId, venueId)

      const [report] = await tx`
        SELECT * FROM cash_wage_reports
         WHERE venue_id   = ${venueId}
           AND tenant_id  = ${req.tenantId}
           AND week_start = ${mondayStr}::date
      `
      if (!report) throw httpError(404, 'Wage report not found')
      if (report.status === 'draft') throw httpError(422, 'Wage report is already in draft')

      await tx`
        UPDATE cash_wage_reports
           SET status       = 'draft',
               submitted_at = NULL,
               updated_at   = now()
         WHERE id        = ${report.id}
           AND tenant_id = ${req.tenantId}
      `

      return loadWageReport(tx, req.tenantId, report.id)
    })
  })
}

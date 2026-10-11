// src/routes/loyverse.js
//
// Loyverse POS link for Cash Reconciliation (migration 154). Mounted at
// /api/loyverse.
//
//   GET    /connections                    the tenant's Loyverse accounts (no tokens)
//   POST   /connections                    { name, access_token } checked with Loyverse first
//   PATCH  /connections/:id                { name?, access_token? }
//   POST   /connections/:id/test           check the saved token again
//   DELETE /connections/:id                (removes its venue links too)
//   GET    /connections/:id/catalog        stores, payment types, categories, items
//   GET    /venues/:venueId/link           the venue's link + mapping, or null
//   PUT    /venues/:venueId/link           { connection_id, store_id, store_name, day_starts_at, mappings }
//   DELETE /venues/:venueId/link
//   POST   /venues/:venueId/preview        { from, to } Loyverse figures next to what Cash Recon has
//   POST   /venues/:venueId/apply          { dates } write the mapped fields for those days
//
// Setup (accounts, links, mappings) is owner/admin with Cash reconciliation
// manage; preview needs view; apply needs manage (same people who fill a
// day in by hand). Access tokens are stored as typed and never returned.
// Apply reads Loyverse again on the server (never takes figures from the
// browser), writes only mapped fields, keeps their notes, and leaves
// submitted days alone.

import { z }          from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requireRole, requirePermission } from '../middleware/auth.js'
import { httpError }  from '../middleware/error.js'
import { checkToken, tokenHint, loadCatalog, loadStores, venueDays, datesBetween, LoyverseError } from '../services/loyverseSvc.js'
import { fillReconDay, reconFields } from '../services/reconFill.js'
import { isValidTerm, sumTerms, MAPPING_GROUPS } from '../../../shared/loyverse.js'

const UUID = z.string().uuid()
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const MAX_DAYS = 31

const by = req => req.user?.email ?? null
const canView   = [requirePermission('cash_recon', 'view')]
const canFill   = [requirePermission('cash_recon', 'manage')]
const canSetup  = [requireRole('admin', 'owner'), requirePermission('cash_recon', 'manage')]

const ConnectionBody = z.object({
  name:         z.string().trim().min(1).max(120),
  access_token: z.string().trim().min(8).max(500),
})
const ConnectionPatch = z.object({
  name:         z.string().trim().min(1).max(120).optional(),
  access_token: z.string().trim().min(8).max(500).optional(),
})

const Term = z.object({
  sign:  z.union([z.literal(1), z.literal(-1)]),
  kind:  z.string().max(40),
  ref:   z.string().max(100).optional(),
  label: z.string().max(200).optional(),
})
const GroupMap = z.record(z.string(), z.array(Term).max(30)).default({})
const LinkBody = z.object({
  connection_id: UUID,
  store_id:      z.string().trim().min(1).max(100),
  store_name:    z.string().max(200).nullable().optional(),
  day_starts_at: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/).default('00:00'),
  mappings:      z.object({ income: GroupMap, takings: GroupMap, sc: GroupMap }).default({}),
})

const PreviewBody = z.object({ from: DATE, to: DATE })
const ApplyBody   = z.object({ dates: z.array(DATE).min(1).max(MAX_DAYS) })

const pounds = p => Math.round(p) / 100

function connectionView(c) {
  return {
    id: c.id, name: c.name, token_hint: c.token_hint,
    business_name: c.business_name, currency: c.currency,
    last_checked_at: c.last_checked_at, last_error: c.last_error,
    venue_count: c.venue_count != null ? Number(c.venue_count) : undefined,
    created_at: c.created_at,
  }
}

/** Loyverse failures become 422 with Loyverse's message; anything else is rethrown. */
function asHttp(e) {
  if (e instanceof LoyverseError) return httpError(422, e.message)
  return e
}

async function ownVenue(tx, tenantId, venueId) {
  const [v] = await tx`SELECT id, name, timezone FROM venues WHERE id = ${venueId} AND tenant_id = ${tenantId}`
  if (!v) throw httpError(404, 'Venue not found')
  return v
}

async function ownConnection(tx, tenantId, id) {
  const [c] = await tx`SELECT * FROM loyverse_connections WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!c) throw httpError(404, 'Loyverse account not found')
  return c
}

/** The venue's active Cash Recon fields, in day-view order. */

/** Mapped fields that still exist: [{ key, group, id, name, terms, source }]. */
function mappedFields(fields, mappings) {
  const out = []
  for (const group of ['income', 'sc', 'takings']) {
    for (const row of fields[group]) {
      const terms = (mappings?.[group]?.[row.id] || []).filter(isValidTerm)
      if (terms.length) out.push({ key: group + ':' + row.id, group, id: row.id, name: row.name, terms, source: row })
    }
  }
  return out
}

/** The values Cash Recon has now for these days: { date: { report, values: { key: amount } } }. */
async function currentValues(tx, tenantId, venueId, dates) {
  const reports = await tx`
    SELECT id, report_date::text AS date, status, loyverse_filled_at, loyverse_filled_by
      FROM cash_daily_reports
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND report_date = ANY(${dates}::date[])
  `
  const out = Object.fromEntries(dates.map(d => [d, { report: null, values: {} }]))
  if (!reports.length) return out
  const ids = reports.map(r => r.id)
  const byId = Object.fromEntries(reports.map(r => [r.id, r.date]))
  for (const r of reports) out[r.date].report = r
  const [income, takings, sc] = await Promise.all([
    tx`SELECT report_id, source_id AS id, SUM(gross_amount)::float8 AS amount FROM cash_income_entries
        WHERE tenant_id = ${tenantId} AND report_id = ANY(${ids}::uuid[]) GROUP BY report_id, source_id`,
    tx`SELECT report_id, channel_id AS id, SUM(amount)::float8 AS amount FROM cash_takings_entries
        WHERE tenant_id = ${tenantId} AND report_id = ANY(${ids}::uuid[]) GROUP BY report_id, channel_id`,
    tx`SELECT report_id, source_id AS id, SUM(amount)::float8 AS amount FROM cash_sc_entries
        WHERE tenant_id = ${tenantId} AND report_id = ANY(${ids}::uuid[]) GROUP BY report_id, source_id`,
  ])
  for (const [group, rows] of [['income', income], ['takings', takings], ['sc', sc]]) {
    for (const r of rows) out[byId[r.report_id]].values[group + ':' + r.id] = r.amount
  }
  return out
}

async function loadLink(tx, tenantId, venueId) {
  const [link] = await tx`
    SELECT l.*, c.name AS connection_name, c.access_token, c.business_name, c.currency, c.token_hint
      FROM loyverse_venue_links l
      JOIN loyverse_connections c ON c.id = l.connection_id AND c.tenant_id = l.tenant_id
     WHERE l.tenant_id = ${tenantId} AND l.venue_id = ${venueId}
  `
  return link || null
}

function linkView(link) {
  if (!link) return null
  return {
    venue_id: link.venue_id, connection_id: link.connection_id, connection_name: link.connection_name,
    business_name: link.business_name, currency: link.currency, token_hint: link.token_hint,
    store_id: link.store_id, store_name: link.store_name, day_starts_at: link.day_starts_at,
    mappings: link.mappings || {}, updated_at: link.updated_at,
  }
}

/** Read Loyverse for a run of days. Returns { link, venue, fields, figures }. */
async function readDays(tenantId, venueId, dates) {
  const ctx = await withTenant(tenantId, async tx => {
    const venue = await ownVenue(tx, tenantId, venueId)
    const link = await loadLink(tx, tenantId, venueId)
    if (!link) throw httpError(422, 'This venue isn\'t linked to Loyverse yet. Set it up in Cash reconciliation settings > Loyverse.')
    const fields = mappedFields(await reconFields(tx, tenantId, venueId), link.mappings)
    return { venue, link, fields }
  })
  let figures
  try {
    figures = await venueDays({
      token: ctx.link.access_token, storeId: ctx.link.store_id, timezone: ctx.venue.timezone,
      dayStartsAt: ctx.link.day_starts_at, dates, mappings: ctx.link.mappings,
    })
  } catch (e) {
    if (e instanceof LoyverseError && e.tokenProblem) {
      await withTenant(tenantId, tx => tx`
        UPDATE loyverse_connections SET last_error = ${e.message}, last_checked_at = now()
         WHERE id = ${ctx.link.connection_id} AND tenant_id = ${tenantId}`).catch(() => {})
    }
    throw asHttp(e)
  }
  return { ...ctx, figures }
}

function spanOf(from, to) {
  if (to < from) throw httpError(400, 'The end date is before the start date')
  const dates = datesBetween(from, to)
  if (dates.length > MAX_DAYS) throw httpError(400, 'Pick ' + MAX_DAYS + ' days or fewer')
  return dates
}

export default async function loyverseRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // ── Accounts ──────────────────────────────────────────────────
  app.get('/connections', { preHandler: canView }, async req => withTenant(req.tenantId, async tx => {
    const rows = await tx`
      SELECT c.*, (SELECT count(*) FROM loyverse_venue_links l WHERE l.connection_id = c.id AND l.tenant_id = c.tenant_id) AS venue_count
        FROM loyverse_connections c
       WHERE c.tenant_id = ${req.tenantId}
       ORDER BY c.created_at
    `
    return rows.map(connectionView)
  }))

  app.post('/connections', { preHandler: canSetup }, async (req, reply) => {
    const body = ConnectionBody.parse(req.body)
    let info
    try { info = await checkToken(body.access_token) } catch (e) { throw asHttp(e) }
    const row = await withTenant(req.tenantId, async tx => {
      const [c] = await tx`
        INSERT INTO loyverse_connections (tenant_id, name, access_token, token_hint, merchant_id, business_name, currency, last_checked_at, created_by)
        VALUES (${req.tenantId}, ${body.name}, ${body.access_token}, ${tokenHint(body.access_token)},
                ${info.merchant_id}, ${info.business_name}, ${info.currency}, now(), ${by(req)})
        RETURNING *
      `
      return c
    })
    reply.code(201)
    return connectionView({ ...row, venue_count: 0 })
  })

  app.patch('/connections/:id', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    const body = ConnectionPatch.parse(req.body)
    await withTenant(req.tenantId, tx => ownConnection(tx, req.tenantId, id))
    let info = null
    if (body.access_token) {
      try { info = await checkToken(body.access_token) } catch (e) { throw asHttp(e) }
    }
    return withTenant(req.tenantId, async tx => {
      const [c] = info
        ? await tx`
            UPDATE loyverse_connections
               SET name = COALESCE(${body.name ?? null}, name),
                   access_token = ${body.access_token}, token_hint = ${tokenHint(body.access_token)},
                   merchant_id = ${info.merchant_id}, business_name = ${info.business_name}, currency = ${info.currency},
                   last_checked_at = now(), last_error = NULL, updated_at = now()
             WHERE id = ${id} AND tenant_id = ${req.tenantId}
            RETURNING *`
        : await tx`
            UPDATE loyverse_connections SET name = COALESCE(${body.name ?? null}, name), updated_at = now()
             WHERE id = ${id} AND tenant_id = ${req.tenantId}
            RETURNING *`
      return connectionView(c)
    })
  })

  app.post('/connections/:id/test', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    const c = await withTenant(req.tenantId, tx => ownConnection(tx, req.tenantId, id))
    let info = null, error = null
    try { info = await checkToken(c.access_token) } catch (e) {
      if (!(e instanceof LoyverseError)) throw e
      error = e.message
    }
    return withTenant(req.tenantId, async tx => {
      const [row] = info
        ? await tx`
            UPDATE loyverse_connections
               SET merchant_id = ${info.merchant_id}, business_name = ${info.business_name}, currency = ${info.currency},
                   last_checked_at = now(), last_error = NULL
             WHERE id = ${id} AND tenant_id = ${req.tenantId} RETURNING *`
        : await tx`
            UPDATE loyverse_connections SET last_checked_at = now(), last_error = ${error}
             WHERE id = ${id} AND tenant_id = ${req.tenantId} RETURNING *`
      return { ok: !!info, error, connection: connectionView(row) }
    })
  })

  app.delete('/connections/:id', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    return withTenant(req.tenantId, async tx => {
      await ownConnection(tx, req.tenantId, id)
      await tx`DELETE FROM loyverse_venue_links WHERE connection_id = ${id} AND tenant_id = ${req.tenantId}`
      await tx`DELETE FROM loyverse_connections WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      return { ok: true }
    })
  })

  app.get('/connections/:id/catalog', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    const c = await withTenant(req.tenantId, tx => ownConnection(tx, req.tenantId, id))
    try { return await loadCatalog(c.access_token) } catch (e) { throw asHttp(e) }
  })

  // ── Venue link + mapping ──────────────────────────────────────
  app.get('/venues/:venueId/link', { preHandler: canView }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    return withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      return { link: linkView(await loadLink(tx, req.tenantId, venueId)) }
    })
  })

  app.put('/venues/:venueId/link', { preHandler: canSetup }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    const body = LinkBody.parse(req.body)
    const conn = await withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      return ownConnection(tx, req.tenantId, body.connection_id)
    })
    // The store must be one of this account's.
    let stores
    try { stores = await loadStores(conn.access_token) } catch (e) { throw asHttp(e) }
    const store = stores.find(s => s.id === body.store_id)
    if (!store) throw httpError(422, 'That store isn\'t on this Loyverse account')

    return withTenant(req.tenantId, async tx => {
      // Keep only fields that are this venue's, and only valid terms.
      const fields = await reconFields(tx, req.tenantId, venueId)
      const mappings = {}
      for (const group of MAPPING_GROUPS) {
        const ids = new Set(fields[group].map(r => r.id))
        mappings[group] = {}
        for (const [fid, terms] of Object.entries(body.mappings[group] || {})) {
          if (!ids.has(fid)) continue
          const valid = terms.filter(isValidTerm).map(t => ({
            sign: t.sign, kind: t.kind,
            ...(t.ref ? { ref: t.ref } : {}), ...(t.label ? { label: t.label } : {}),
          }))
          if (valid.length) mappings[group][fid] = valid
        }
      }
      await tx`
        INSERT INTO loyverse_venue_links (tenant_id, venue_id, connection_id, store_id, store_name, day_starts_at, mappings)
        VALUES (${req.tenantId}, ${venueId}, ${conn.id}, ${store.id}, ${store.name}, ${body.day_starts_at}, ${tx.json(mappings)})
        ON CONFLICT (venue_id) DO UPDATE SET
          connection_id = EXCLUDED.connection_id, store_id = EXCLUDED.store_id, store_name = EXCLUDED.store_name,
          day_starts_at = EXCLUDED.day_starts_at, mappings = EXCLUDED.mappings, updated_at = now()
        WHERE loyverse_venue_links.tenant_id = ${req.tenantId}
      `
      const link = await loadLink(tx, req.tenantId, venueId)
      if (!link) throw httpError(404, 'Venue not found')
      return { link: linkView(link) }
    })
  })

  app.delete('/venues/:venueId/link', { preHandler: canSetup }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    return withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      await tx`DELETE FROM loyverse_venue_links WHERE venue_id = ${venueId} AND tenant_id = ${req.tenantId}`
      return { ok: true }
    })
  })

  // ── Preview ───────────────────────────────────────────────────
  app.post('/venues/:venueId/preview', { preHandler: canView }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    const body = PreviewBody.parse(req.body)
    const dates = spanOf(body.from, body.to)
    const { link, fields, figures } = await readDays(req.tenantId, venueId, dates)
    const current = await withTenant(req.tenantId, tx => currentValues(tx, req.tenantId, venueId, dates))

    const mappedPayments = new Set()
    for (const group of MAPPING_GROUPS) {
      for (const terms of Object.values(link.mappings?.[group] || {})) {
        for (const t of terms || []) if (t.kind === 'payment_type') mappedPayments.add(t.ref)
      }
    }

    return {
      store_name: link.store_name, currency: link.currency, day_starts_at: link.day_starts_at,
      fields: fields.map(f => ({ key: f.key, group: f.group, id: f.id, name: f.name, terms: f.terms })),
      days: dates.map(date => {
        const day = figures[date]
        const cur = current[date]
        const values = {}
        for (const f of fields) {
          values[f.key] = { loyverse: pounds(sumTerms(day, f.terms)), current: cur.values[f.key] ?? null }
        }
        return {
          date,
          status: cur.report?.status || null,
          filled_at: cur.report?.loyverse_filled_at || null,
          filled_by: cur.report?.loyverse_filled_by || null,
          sales: day.sales, refund_receipts: day.refund_receipts,
          totals: {
            gross_sales: pounds(day.gross_sales), refunds: pounds(day.refunds), discounts: pounds(day.discounts),
            net_sales: pounds(day.net_sales), taxes: pounds(day.taxes), tips: pounds(day.tips),
            surcharges: pounds(day.surcharges), total_collected: pounds(day.total_collected),
          },
          payments: Object.entries(day.payment_types).map(([id, p]) => ({
            id, name: p.name, amount: pounds(p.amount), mapped: mappedPayments.has(id),
          })).sort((a, b) => a.name.localeCompare(b.name)),
          values,
        }
      }),
    }
  })

  // ── Apply ─────────────────────────────────────────────────────
  app.post('/venues/:venueId/apply', { preHandler: canFill }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    const body = ApplyBody.parse(req.body)
    const wanted = [...new Set(body.dates)].sort()
    const dates = spanOf(wanted[0], wanted[wanted.length - 1])
    const { fields, figures } = await readDays(req.tenantId, venueId, dates)
    if (!fields.length) throw httpError(422, 'Nothing is mapped yet. Map fields in Cash reconciliation settings > Loyverse.')

    return withTenant(req.tenantId, async tx => {
      const filled = [], skipped = []
      for (const date of wanted) {
        const day = figures[date]
        const r = await fillReconDay(tx, {
          tenantId: req.tenantId, venueId, date, source: 'loyverse', by: by(req),
          fields: fields.map(f => ({ group: f.group, id: f.id, source: f.source, amount: pounds(sumTerms(day, f.terms)) })),
        })
        if (r.skipped) skipped.push({ date, reason: r.skipped })
        else filled.push(date)
      }
      return { filled, skipped }
    })
  })
}

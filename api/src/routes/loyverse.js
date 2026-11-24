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
//   PUT    /venues/:venueId/link           { connection_id, store_id, store_name, day_starts_at } (starts its history import)
//   PUT    /venues/:venueId/mappings       { mappings } the Cash Recon field mapping
//   DELETE /venues/:venueId/link
//   POST   /venues/:venueId/preview        { from, to } Loyverse figures next to what Cash Recon has
//   POST   /venues/:venueId/apply          { dates } write the mapped fields for those days
//   POST   /venues/:venueId/sync           Sync now for the venue's account (from the fill window)
//
// Setup (accounts, links, mappings) is owner/admin with Cash reconciliation
// manage; preview needs view; apply and Sync now need use (same people who
// fill a day in by hand). Access tokens are stored as typed and never
// returned. Since sales import phase 4 the preview and apply read the
// stored receipts (services/storedSales.js), never Loyverse itself: a day
// nothing has synced for yet is refused, not filled with zeros, and a day
// can be filled again after a late sync. Apply works the figures out on
// the server (never takes them from the browser), writes only mapped
// fields, keeps their notes, and leaves submitted days alone.

import { z }          from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requireRole, requirePermission } from '../middleware/auth.js'
import { httpError }  from '../middleware/error.js'
import { checkToken, tokenHint, loadCatalog, loadStores, datesBetween, LoyverseError } from '../services/loyverseSvc.js'
import { fillReconDay, reconFields } from '../services/reconFill.js'
import { seal, unseal } from '../services/vault.js'
import { startHistory, markRequested, requestSync, setupWebhook } from '../services/salesImportSvc.js'
import { venueLink, storedDays } from '../services/storedSales.js'
import { connector } from '../services/connectors/loyverse.js'
import { isValidTerm, sumTerms, needsCategories, MAPPING_GROUPS } from '../../../shared/loyverse.js'

// Said when a day has nothing stored and the sync hasn't passed its end.
export const NOT_SYNCED = 'Loyverse hasn\'t synced this day yet. Press Sync now, then fill again in a minute.'

const UUID = z.string().uuid()
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const MAX_DAYS = 31

const by = req => req.user?.email ?? null
const canView   = [requirePermission('cash_recon', 'view')]
const canFill   = [requirePermission('cash_recon', 'use')]
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
})
const MappingsBody = z.object({
  mappings: z.object({ income: GroupMap, takings: GroupMap, sc: GroupMap }),
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
  const [c] = await tx`SELECT * FROM pos_connections WHERE id = ${id} AND tenant_id = ${tenantId} AND system = 'loyverse'`
  if (!c) throw httpError(404, 'Loyverse account not found')
  return { ...c, access_token: unseal(c.access_token) }   // stored sealed (migration 179)
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
      FROM pos_connection_venues l
      JOIN pos_connections c ON c.id = l.connection_id AND c.tenant_id = l.tenant_id AND c.system = 'loyverse'
     WHERE l.tenant_id = ${tenantId} AND l.venue_id = ${venueId}
  `
  return link ? { ...link, access_token: unseal(link.access_token) } : null
}

function linkView(link) {
  if (!link) return null
  return {
    venue_id: link.venue_id, connection_id: link.connection_id, connection_name: link.connection_name,
    business_name: link.business_name, currency: link.currency, token_hint: link.token_hint,
    store_id: link.location_id, store_name: link.location_name, day_starts_at: link.day_starts_at,
    mappings: link.mappings || {}, updated_at: link.updated_at,
  }
}

/**
 * A run of days' figures from the stored receipts. Returns { link, venue,
 * fields, figures } (figures: storedDays(), with not_synced on a day
 * nothing has come in for yet).
 */
async function readDays(tenantId, venueId, dates) {
  return withTenant(tenantId, async tx => {
    const venue = await ownVenue(tx, tenantId, venueId)
    const link = await venueLink(tx, tenantId, venueId)
    if (!link || link.system !== 'loyverse') throw httpError(422, 'This venue isn\'t linked to Loyverse yet. Link it on the Integrations page.')
    const fields = mappedFields(await reconFields(tx, tenantId, venueId), link.mappings)
    const figures = await storedDays(tx, tenantId, link, dates, { categories: needsCategories(link.mappings) })
    return { venue, link, fields, figures }
  })
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
      SELECT c.*, (SELECT count(*) FROM pos_connection_venues l WHERE l.connection_id = c.id AND l.tenant_id = c.tenant_id) AS venue_count
        FROM pos_connections c
       WHERE c.tenant_id = ${req.tenantId} AND c.system = 'loyverse'
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
        INSERT INTO pos_connections (tenant_id, name, access_token, token_hint, merchant_id, business_name, currency, last_checked_at, created_by)
        VALUES (${req.tenantId}, ${body.name}, ${seal(body.access_token)}, ${tokenHint(body.access_token)},
                ${info.merchant_id}, ${info.business_name}, ${info.currency}, now(), ${by(req)})
        RETURNING *
      `
      return c
    })
    // Sales import (migration 288): a webhook address registered with
    // Loyverse when it allows (else shown on the Integrations page), and a
    // first sync of the master data.
    const webhook = await setupWebhook(req.tenantId, row.id).catch(e => ({ registered: false, error: e.message }))
    requestSync(req.tenantId, row.id, req.log)
    reply.code(201)
    return { ...connectionView({ ...row, venue_count: 0 }), webhook }
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
            UPDATE pos_connections
               SET name = COALESCE(${body.name ?? null}, name),
                   access_token = ${seal(body.access_token)}, token_hint = ${tokenHint(body.access_token)},
                   merchant_id = ${info.merchant_id}, business_name = ${info.business_name}, currency = ${info.currency},
                   last_checked_at = now(), last_error = NULL, updated_at = now()
             WHERE id = ${id} AND tenant_id = ${req.tenantId}
            RETURNING *`
        : await tx`
            UPDATE pos_connections SET name = COALESCE(${body.name ?? null}, name), updated_at = now()
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
            UPDATE pos_connections
               SET merchant_id = ${info.merchant_id}, business_name = ${info.business_name}, currency = ${info.currency},
                   last_checked_at = now(), last_error = NULL
             WHERE id = ${id} AND tenant_id = ${req.tenantId} RETURNING *`
        : await tx`
            UPDATE pos_connections SET last_checked_at = now(), last_error = ${error}
             WHERE id = ${id} AND tenant_id = ${req.tenantId} RETURNING *`
      return { ok: !!info, error, connection: connectionView(row) }
    })
  })

  app.delete('/connections/:id', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    return withTenant(req.tenantId, async tx => {
      const c = await ownConnection(tx, req.tenantId, id)
      // Its webhook at Loyverse goes too (best effort); its stored sales
      // (ext_*) go with the connection (ON DELETE CASCADE).
      if (c.webhook_id) connector({ token: c.access_token }).deleteWebhook(c.webhook_id).catch(() => {})
      await tx`DELETE FROM pos_connection_venues WHERE connection_id = ${id} AND tenant_id = ${req.tenantId}`
      await tx`DELETE FROM pos_connections WHERE id = ${id} AND tenant_id = ${req.tenantId}`
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

  // The store and trading day (Integrations page). The Cash Recon mapping
  // is kept; it has its own route below.
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
      const [taken] = await tx`
        SELECT v.name FROM pos_connection_venues l JOIN venues v ON v.id = l.venue_id AND v.tenant_id = l.tenant_id
         WHERE l.tenant_id = ${req.tenantId} AND l.connection_id = ${conn.id} AND l.location_id = ${store.id} AND l.venue_id <> ${venueId}`
      if (taken) throw httpError(409, 'That store is already linked to ' + taken.name)
      const [before] = await tx`
        SELECT connection_id, location_id FROM pos_connection_venues WHERE tenant_id = ${req.tenantId} AND venue_id = ${venueId}`
      await tx`
        INSERT INTO pos_connection_venues (tenant_id, venue_id, connection_id, location_id, location_name, day_starts_at)
        VALUES (${req.tenantId}, ${venueId}, ${conn.id}, ${store.id}, ${store.name}, ${body.day_starts_at})
        ON CONFLICT (venue_id) DO UPDATE SET
          connection_id = EXCLUDED.connection_id, location_id = EXCLUDED.location_id, location_name = EXCLUDED.location_name,
          day_starts_at = EXCLUDED.day_starts_at, updated_at = now()
        WHERE pos_connection_venues.tenant_id = ${req.tenantId}
      `
      const moved = !before || before.connection_id !== conn.id || before.location_id !== store.id
      if (moved) {
        await startHistory(tx, req.tenantId, venueId)
        await markRequested(tx, req.tenantId, conn.id)
      }
      const link = await loadLink(tx, req.tenantId, venueId)
      if (!link) throw httpError(404, 'Venue not found')
      if (moved) requestSync(req.tenantId, conn.id, req.log)
      return { link: linkView(link) }
    })
  })

  // The Cash Recon mapping (Cash Recon settings > Loyverse): the whole
  // mapping each time; fields that aren't this venue's and invalid terms are
  // dropped.
  app.put('/venues/:venueId/mappings', { preHandler: canSetup }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    const body = MappingsBody.parse(req.body)
    return withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      if (!(await loadLink(tx, req.tenantId, venueId))) throw httpError(422, 'Link this venue to a Loyverse store first (Integrations).')
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
        UPDATE pos_connection_venues SET mappings = ${tx.json(mappings)}, updated_at = now()
         WHERE tenant_id = ${req.tenantId} AND venue_id = ${venueId}`
      return { link: linkView(await loadLink(tx, req.tenantId, venueId)) }
    })
  })

  app.delete('/venues/:venueId/link', { preHandler: canSetup }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    return withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      await tx`DELETE FROM pos_connection_venues WHERE venue_id = ${venueId} AND tenant_id = ${req.tenantId}`
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
      store_name: link.location_name, currency: link.currency, day_starts_at: link.day_starts_at,
      connection_id: link.connection_id, synced_to: link.sales_synced_to, last_sync_ok_at: link.last_sync_ok_at,
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
          synced: !day.not_synced,
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
    return applyLoyverseDays(req.tenantId, venueId, body.dates, { by: by(req) })
  })

  // ── Sync now (the fill window, for a day not synced yet) ──────
  app.post('/venues/:venueId/sync', { preHandler: canFill }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    const link = await withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      const l = await venueLink(tx, req.tenantId, venueId)
      if (!l || l.system !== 'loyverse') throw httpError(422, 'This venue isn\'t linked to Loyverse yet. Link it on the Integrations page.')
      if (l.status === 'paused') throw httpError(409, 'Syncing is paused for this Loyverse account (Integrations).')
      await markRequested(tx, req.tenantId, l.connection_id)
      return l
    })
    requestSync(req.tenantId, link.connection_id, req.log)
    return { ok: true, connection_id: link.connection_id }
  })
}

/**
 * Fills Cash Recon days from Loyverse (the apply route, the one Retrieve
 * button and the scheduled fill, services/reconRetrieve.js): each day's
 * mapped fields through fillReconDay(), submitted days skipped. With
 * keepHandEdits a field changed by hand since the last fill is left alone
 * and listed in `kept`. With onlyWithSales (Retrieve over several days, the
 * scheduled fill) a day with no sales is left out, as the preview leaves it
 * unticked, and a day after the venue's today is never filled that way.
 * A day nothing has synced for yet (storedDays() not_synced) is never
 * filled: skipped as 'not_synced', or refused (422) when it is the only day
 * asked for. Returns { filled, skipped, kept }.
 */
export async function applyLoyverseDays(tenantId, venueId, dates, { by = null, keepHandEdits = false, onlyWithSales = false } = {}) {
  let wanted = [...new Set(dates)].sort()
  const span = spanOf(wanted[0], wanted[wanted.length - 1])
  const { venue, fields, figures } = await readDays(tenantId, venueId, span)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: venue?.timezone || 'Europe/London' }).format(new Date())
  const early = []
  const waiting = wanted.filter(d => figures[d]?.not_synced)
  if (waiting.length && waiting.length === wanted.length && !onlyWithSales) throw httpError(422, NOT_SYNCED)
  for (const d of waiting) early.push({ date: d, reason: onlyWithSales && d > today ? 'not_yet' : 'not_synced' })
  wanted = wanted.filter(d => !waiting.includes(d))
  if (onlyWithSales) {
    const hasSales = d => (d?.sales || 0) + (d?.refund_receipts || 0) > 0
    for (const d of wanted) {
      if (d > today) early.push({ date: d, reason: 'not_yet' })
      else if (!hasSales(figures[d])) early.push({ date: d, reason: 'no_sales' })
    }
    wanted = wanted.filter(d => !early.some(e => e.date === d))
  }
  if (!fields.length) throw httpError(422, 'Nothing is mapped yet. Map fields in Cash reconciliation settings > Loyverse.')
  return withTenant(tenantId, async tx => {
    const filled = [], skipped = [...early], kept = []
    for (const date of wanted) {
      const day = figures[date]
      const r = await fillReconDay(tx, {
        tenantId, venueId, date, source: 'loyverse', by, keepHandEdits,
        fields: fields.map(f => ({ group: f.group, id: f.id, source: f.source, amount: pounds(sumTerms(day, f.terms)) })),
      })
      if (r.skipped) skipped.push({ date, reason: r.skipped })
      else {
        filled.push(date)
        for (const k of r.kept || []) kept.push({ date, ...k, name: fields.find(f => f.group === k.group && f.id === k.id)?.name ?? null })
      }
    }
    return { filled, skipped, kept }
  })
}

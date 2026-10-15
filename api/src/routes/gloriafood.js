// src/routes/gloriafood.js
//
// GloriaFood online orders for Cash Reconciliation and the Online orders
// board (migration 159). Mounted at /api/gloriafood; the push webhook
// (gloriafoodWebhookRoutes) is at the root.
//
//   GET    /venues/:venueId/link              the venue's link + mapping, or null (no keys)
//   GET    /venues/:venueId/push-url          the address to paste into GloriaFood (setup only)
//   PUT    /venues/:venueId/link              { method, poll_key?, day_basis, day_starts_at, show_on_board, mappings }
//   DELETE /venues/:venueId/link              stored orders are kept
//   POST   /venues/:venueId/push-url/new      a new push address (the old one stops working)
//   POST   /venues/:venueId/restaurant/reset  forget which GloriaFood restaurant the venue is linked to
//   POST   /venues/:venueId/poll              check GloriaFood for orders now (poll venues)
//   GET    /venues/:venueId/orders            the latest stored orders (settings check list)
//   GET    /venues/:venueId/day?date=         every order on one Cash Recon trading day, with the
//                                              day's figures (Cash Recon day > GloriaFood orders)
//   GET    /venues/:venueId/seen              payment methods / order types seen (mapping picker)
//   POST   /venues/:venueId/preview           { from, to } GloriaFood figures next to what Cash Recon has
//   POST   /venues/:venueId/apply             { dates } write the mapped fields for those days
//   GET    /venues/:venueId/import            imported orders: count and dates, last import
//   POST   /venues/:venueId/import            { file_name, data (base64), apply } GloriaFood's order export:
//                                              without apply, what importing it would do; with apply, do it
//   DELETE /venues/:venueId/import            remove the imported orders (not the ones GloriaFood sent)
//   GET    /import-template                   CSV with the columns the import reads
//   POST   /webhooks/gloriafood/:token        GloriaFood's "Push Accepted Order" integration
//
// Setup is owner/admin with Cash reconciliation manage (as Loyverse), and so
// is importing; preview needs view; apply and poll need manage. Poll keys are stored as typed and
// never returned. Apply works only from the stored orders (never figures
// from the browser), writes only mapped fields, keeps their notes and leaves
// submitted days alone.

import { z }          from 'zod'
import { sql, withTenant } from '../config/db.js'
import { requireAuth, requireRole, requirePermission } from '../middleware/auth.js'
import { httpError }  from '../middleware/error.js'
import { officeOrigin } from '../services/platformHost.js'
import { datesBetween } from '../services/loyverseSvc.js'
import { fillReconDay, reconFields } from '../services/reconFill.js'
import {
  GloriaFoodError, keyHint, newPushToken, pollVenue, ingestOrders, ordersOf, venueDays, seenValues,
  importExport, importedStats, removeImported, dayOrders,
} from '../services/gloriafoodSvc.js'
import { readFile } from './deliveroo.js'
import {
  isValidTerm, sumTerms, MAPPING_GROUPS, PAYMENT_LABELS, TYPE_LABELS, paymentLabel, typeLabel, IMPORT_COLUMNS,
} from '../../../shared/gloriafood.js'

const UUID = z.string().uuid()
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const MAX_DAYS = 31

const by = req => req.user?.email ?? null
const canView  = [requirePermission('cash_recon', 'view')]
const canFill  = [requirePermission('cash_recon', 'manage')]
const canSetup = [requireRole('admin', 'owner'), requirePermission('cash_recon', 'manage')]

const Term = z.object({
  sign:  z.union([z.literal(1), z.literal(-1)]),
  kind:  z.string().max(40),
  ref:   z.string().max(100).optional(),
  label: z.string().max(200).optional(),
})
const GroupMap = z.record(z.string(), z.array(Term).max(30)).default({})
const LinkBody = z.object({
  method:        z.enum(['push', 'poll']),
  poll_key:      z.string().trim().min(6).max(200).optional(),
  day_basis:     z.enum(['fulfill', 'accepted']).default('fulfill'),
  day_starts_at: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/).default('00:00'),
  show_on_board: z.boolean().default(false),
  mappings:      z.object({ income: GroupMap, takings: GroupMap, sc: GroupMap }).default({}),
})
const PreviewBody = z.object({ from: DATE, to: DATE })
const ImportBody  = z.object({
  file_name: z.string().max(300).default(''),
  data:      z.string().min(1).max(22_000_000),         // base64 of a file up to 16 MB
  apply:     z.boolean().default(false),
})
const MAX_IMPORT_FILE = 16 * 1024 * 1024
const ApplyBody   = z.object({ dates: z.array(DATE).min(1).max(MAX_DAYS) })

const pounds = p => Math.round(p) / 100
export const pushUrl = token => `${officeOrigin()}/webhooks/gloriafood/${token}`

async function ownVenue(tx, tenantId, venueId) {
  const [v] = await tx`SELECT id, name, timezone FROM venues WHERE id = ${venueId} AND tenant_id = ${tenantId}`
  if (!v) throw httpError(404, 'Venue not found')
  return v
}

async function loadLink(tx, tenantId, venueId) {
  const [link] = await tx`
    SELECT l.*,
           (SELECT count(*)::int FROM gloriafood_orders o
             WHERE o.tenant_id = l.tenant_id AND o.venue_id = l.venue_id
               AND o.received_via <> 'import') AS order_count
      FROM gloriafood_venue_links l
     WHERE l.tenant_id = ${tenantId} AND l.venue_id = ${venueId}`
  return link || null
}

function linkView(link) {
  if (!link) return null
  return {
    venue_id: link.venue_id,
    method: link.method,
    has_poll_key: !!link.poll_key,
    poll_key_hint: link.poll_key_hint,
    restaurant: link.gf_restaurant_id != null
      ? { id: String(link.gf_restaurant_id), name: link.gf_restaurant_name }
      : null,
    day_basis: link.day_basis,
    day_starts_at: link.day_starts_at,
    show_on_board: link.show_on_board,
    mappings: link.mappings || {},
    order_count: link.order_count ?? 0,
    last_order_at: link.last_order_at,
    last_poll_at: link.last_poll_at,
    last_error: link.last_error,
    last_error_at: link.last_error_at,
    last_import_at: link.last_import_at,
    last_import_by: link.last_import_by,
    last_import_file: link.last_import_file,
    updated_at: link.updated_at,
  }
}

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

/** Keep only this venue's active fields and valid terms. */
function cleanMappings(fields, body) {
  const mappings = {}
  for (const group of MAPPING_GROUPS) {
    const ids = new Set(fields[group].map(r => r.id))
    mappings[group] = {}
    for (const [fid, terms] of Object.entries(body?.[group] || {})) {
      if (!ids.has(fid)) continue
      const valid = terms.filter(isValidTerm).map(t => ({
        sign: t.sign, kind: t.kind,
        ...(t.ref ? { ref: t.ref } : {}), ...(t.label ? { label: t.label } : {}),
      }))
      if (valid.length) mappings[group][fid] = valid
    }
  }
  return mappings
}

/** The values Cash Recon has now for these days: { date: { report, values: { key: amount } } }. */
async function currentValues(tx, tenantId, venueId, dates) {
  const reports = await tx`
    SELECT id, report_date::text AS date, status, gloriafood_filled_at, gloriafood_filled_by
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

function spanOf(from, to) {
  if (to < from) throw httpError(400, 'The end date is before the start date')
  const dates = datesBetween(from, to)
  if (dates.length > MAX_DAYS) throw httpError(400, 'Pick ' + MAX_DAYS + ' days or fewer')
  return dates
}

/** Poll a poll venue before reading its orders; a failure is reported, never thrown. */
async function freshen(tenantId, venueId, log) {
  try {
    await pollVenue(tenantId, venueId, log)
    return null
  } catch (e) {
    return e instanceof GloriaFoodError ? e.message : 'Couldn\'t check GloriaFood for new orders.'
  }
}

/** Stored orders turned into day figures, with the venue's mapped fields. */
async function readDays(tenantId, venueId, dates) {
  return withTenant(tenantId, async tx => {
    const venue = await ownVenue(tx, tenantId, venueId)
    const link = await loadLink(tx, tenantId, venueId)
    if (!link) throw httpError(422, 'This venue isn\'t linked to GloriaFood yet. Set it up in Cash reconciliation settings > GloriaFood.')
    const fields = mappedFields(await reconFields(tx, tenantId, venueId), link.mappings)
    const { figures, currency } = await venueDays(tx, { tenantId, venueId, timezone: venue.timezone, link, dates })
    return { venue, link, fields, figures, currency }
  })
}

export default async function gloriafoodRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.get('/venues/:venueId/link', { preHandler: canView }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    return withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      return { link: linkView(await loadLink(tx, req.tenantId, venueId)) }
    })
  })

  app.get('/venues/:venueId/push-url', { preHandler: canSetup }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    return withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      const [l] = await tx`SELECT push_token FROM gloriafood_venue_links WHERE tenant_id = ${req.tenantId} AND venue_id = ${venueId}`
      return { push_url: l ? pushUrl(l.push_token) : null }
    })
  })

  app.put('/venues/:venueId/link', { preHandler: canSetup }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    const body = LinkBody.parse(req.body)

    const before = await withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      const [old] = await tx`SELECT * FROM gloriafood_venue_links WHERE tenant_id = ${req.tenantId} AND venue_id = ${venueId}`
      if (body.method === 'poll' && !body.poll_key && !old?.poll_key) {
        throw httpError(422, 'Paste the key from GloriaFood\'s "Poll Accepted Order v2" integration to collect orders this way.')
      }
      const fields = await reconFields(tx, req.tenantId, venueId)
      const mappings = cleanMappings(fields, body.mappings)
      const key = body.poll_key ?? old?.poll_key ?? null
      await tx`
        INSERT INTO gloriafood_venue_links (
          tenant_id, venue_id, method, push_token, poll_key, poll_key_hint,
          day_basis, day_starts_at, show_on_board, mappings, created_by
        ) VALUES (
          ${req.tenantId}, ${venueId}, ${body.method}, ${newPushToken()}, ${key}, ${key ? keyHint(key) : null},
          ${body.day_basis}, ${body.day_starts_at}, ${body.show_on_board}, ${tx.json(mappings)}, ${by(req)}
        )
        ON CONFLICT (venue_id) DO UPDATE SET
          method = EXCLUDED.method, poll_key = EXCLUDED.poll_key, poll_key_hint = EXCLUDED.poll_key_hint,
          day_basis = EXCLUDED.day_basis, day_starts_at = EXCLUDED.day_starts_at,
          show_on_board = EXCLUDED.show_on_board, mappings = EXCLUDED.mappings,
          last_error = CASE WHEN gloriafood_venue_links.poll_key IS DISTINCT FROM EXCLUDED.poll_key
                              OR gloriafood_venue_links.method IS DISTINCT FROM EXCLUDED.method
                            THEN NULL ELSE gloriafood_venue_links.last_error END,
          updated_at = now()
        WHERE gloriafood_venue_links.tenant_id = ${req.tenantId}
      `
      return old || null
    })

    // A new poll key is checked by polling with it. GloriaFood hands over any
    // waiting orders at the same time, so they are stored straight away.
    let checked = null
    if (body.method === 'poll' && body.poll_key && body.poll_key !== before?.poll_key) {
      try {
        checked = await pollVenue(req.tenantId, venueId, req.log)
      } catch (e) {
        if (e instanceof GloriaFoodError && e.keyProblem) {
          await withTenant(req.tenantId, async tx => {
            if (!before) {
              await tx`DELETE FROM gloriafood_venue_links WHERE tenant_id = ${req.tenantId} AND venue_id = ${venueId}`
            } else {
              await tx`
                UPDATE gloriafood_venue_links
                   SET method = ${before.method}, poll_key = ${before.poll_key}, poll_key_hint = ${before.poll_key_hint},
                       last_error = ${before.last_error}, last_error_at = ${before.last_error_at}
                 WHERE tenant_id = ${req.tenantId} AND venue_id = ${venueId}`
            }
          })
          throw httpError(422, e.message)
        }
        // GloriaFood unreachable: keep the key, the minute job tries again.
      }
    }
    return withTenant(req.tenantId, async tx => ({
      link: linkView(await loadLink(tx, req.tenantId, venueId)),
      checked: checked ? { stored: checked.stored || 0, updated: checked.updated || 0 } : null,
    }))
  })

  app.delete('/venues/:venueId/link', { preHandler: canSetup }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    return withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      await tx`DELETE FROM gloriafood_venue_links WHERE venue_id = ${venueId} AND tenant_id = ${req.tenantId}`
      return { ok: true }
    })
  })

  app.post('/venues/:venueId/push-url/new', { preHandler: canSetup }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    return withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      const token = newPushToken()
      const [l] = await tx`
        UPDATE gloriafood_venue_links SET push_token = ${token}, updated_at = now()
         WHERE tenant_id = ${req.tenantId} AND venue_id = ${venueId}
        RETURNING id`
      if (!l) throw httpError(404, 'This venue isn\'t linked to GloriaFood')
      return { push_url: pushUrl(token) }
    })
  })

  app.post('/venues/:venueId/restaurant/reset', { preHandler: canSetup }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    return withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      await tx`
        UPDATE gloriafood_venue_links
           SET gf_restaurant_id = NULL, gf_restaurant_name = NULL, last_error = NULL, updated_at = now()
         WHERE tenant_id = ${req.tenantId} AND venue_id = ${venueId}`
      return { link: linkView(await loadLink(tx, req.tenantId, venueId)) }
    })
  })

  app.post('/venues/:venueId/poll', { preHandler: canFill }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    const link = await withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      return loadLink(tx, req.tenantId, venueId)
    })
    if (!link) throw httpError(404, 'This venue isn\'t linked to GloriaFood')
    if (link.method !== 'poll') throw httpError(422, 'This venue gets its orders pushed by GloriaFood, so there is nothing to check.')
    let r
    try { r = await pollVenue(req.tenantId, venueId, req.log) } catch (e) {
      if (e instanceof GloriaFoodError) throw httpError(422, e.message)
      throw e
    }
    return withTenant(req.tenantId, async tx => ({
      stored: r.stored || 0, updated: r.updated || 0, refused: r.refused || 0, busy: !!r.busy,
      link: linkView(await loadLink(tx, req.tenantId, venueId)),
    }))
  })

  app.get('/venues/:venueId/orders', { preHandler: canView }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    const q = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query || {})
    return withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      const rows = await tx`
        SELECT id, gf_order_id, status, source, order_type, payment, currency, total_pence,
               accepted_at, fulfill_at, received_at, received_via, restaurant_name
          FROM gloriafood_orders
         WHERE tenant_id = ${req.tenantId} AND venue_id = ${venueId} AND received_via <> 'import'
         ORDER BY received_at DESC, gf_order_id DESC
         LIMIT ${q.limit}`
      return rows.map(r => ({
        id: r.id, order_number: String(r.gf_order_id), status: r.status, is_test: r.source === 'admin',
        type: r.order_type, type_label: typeLabel(r.order_type),
        payment: r.payment, payment_label: paymentLabel(r.payment),
        currency: r.currency || 'GBP', total: pounds(r.total_pence),
        accepted_at: r.accepted_at, fulfill_at: r.fulfill_at, received_at: r.received_at,
        received_via: r.received_via, restaurant_name: r.restaurant_name,
      }))
    })
  })

  // The orders behind one day's figures: placed on trading days exactly as a
  // fill places them, so the list adds up to what Fill from GloriaFood writes.
  app.get('/venues/:venueId/day', { preHandler: canView }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    const q = z.object({ date: DATE }).parse(req.query || {})
    return withTenant(req.tenantId, async tx => {
      const venue = await ownVenue(tx, req.tenantId, venueId)
      const link = await loadLink(tx, req.tenantId, venueId)
      if (!link) throw httpError(422, 'This venue isn\'t linked to GloriaFood yet. Set it up in Cash reconciliation settings > GloriaFood.')
      const day = await dayOrders(tx, { tenantId: req.tenantId, venueId, timezone: venue.timezone, link, date: q.date })
      return {
        date: q.date,
        timezone: venue.timezone || 'UTC',
        day_basis: link.day_basis,
        day_starts_at: link.day_starts_at,
        currency: day.currency || 'GBP',
        figures: day.figures,
        orders: day.orders,
      }
    })
  })

  app.get('/venues/:venueId/import', { preHandler: canView }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    return withTenant(req.tenantId, async tx => {
      const venue = await ownVenue(tx, req.tenantId, venueId)
      const link = await loadLink(tx, req.tenantId, venueId)
      return {
        imported: await importedStats(tx, { tenantId: req.tenantId, venueId, timezone: venue.timezone }),
        last_import_at: link?.last_import_at ?? null,
        last_import_by: link?.last_import_by ?? null,
        last_import_file: link?.last_import_file ?? null,
      }
    })
  })

  app.post('/venues/:venueId/import', { preHandler: canSetup, bodyLimit: 24 * 1024 * 1024 }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    const body = ImportBody.parse(req.body)
    const buf = Buffer.from(body.data, 'base64')
    if (!buf.length) throw httpError(422, 'That file is empty')
    if (buf.length > MAX_IMPORT_FILE) throw httpError(422, 'That file is over 16 MB. Export a shorter date range from GloriaFood.')
    const file = readFile(buf, body.file_name, { from: 'GloriaFood' })
    try {
      return await withTenant(req.tenantId, async tx => {
        const venue = await ownVenue(tx, req.tenantId, venueId)
        const result = await importExport(tx, {
          tenantId: req.tenantId, venueId, timezone: venue.timezone, cells: file.cells,
          fileName: body.file_name || null, apply: body.apply, by: by(req),
        })
        if (!body.apply) return result
        return { ...result, imported: await importedStats(tx, { tenantId: req.tenantId, venueId, timezone: venue.timezone }) }
      })
    } catch (e) {
      if (e instanceof GloriaFoodError) throw httpError(422, e.message)
      throw e
    }
  })

  app.delete('/venues/:venueId/import', { preHandler: canSetup }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    return withTenant(req.tenantId, async tx => {
      const venue = await ownVenue(tx, req.tenantId, venueId)
      const removed = await removeImported(tx, { tenantId: req.tenantId, venueId })
      return { removed, imported: await importedStats(tx, { tenantId: req.tenantId, venueId, timezone: venue.timezone }) }
    })
  })

  app.get('/import-template', { preHandler: canView }, async (req, reply) => {
    const csvCell = v => (/[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v)
    const header = IMPORT_COLUMNS.map(c => csvCell(c.header)).join(',')
    reply.header('content-type', 'text/csv; charset=utf-8')
    reply.header('content-disposition', 'attachment; filename="gloriafood-orders-template.csv"')
    return '\uFEFF' + header + '\r\n'
  })

  app.get('/venues/:venueId/seen', { preHandler: canSetup }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    return withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      const seen = await seenValues(tx, req.tenantId, venueId)
      const payments = [...new Set([...Object.keys(PAYMENT_LABELS), ...seen.payments])]
      const types = [...new Set([...Object.keys(TYPE_LABELS), ...seen.order_types])]
      return {
        payments: payments.map(p => ({ id: p, name: paymentLabel(p), seen: seen.payments.includes(p) })),
        order_types: types.map(t => ({ id: t, name: typeLabel(t), seen: seen.order_types.includes(t) })),
      }
    })
  })

  // ── Preview ───────────────────────────────────────────────────
  app.post('/venues/:venueId/preview', { preHandler: canView }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    const body = PreviewBody.parse(req.body)
    const dates = spanOf(body.from, body.to)
    const method = await withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      const [l] = await tx`SELECT method FROM gloriafood_venue_links WHERE tenant_id = ${req.tenantId} AND venue_id = ${venueId}`
      return l?.method
    })
    const pollError = method === 'poll' ? await freshen(req.tenantId, venueId, req.log) : null
    const { venue, link, fields, figures, currency } = await readDays(req.tenantId, venueId, dates)
    const { current, imported } = await withTenant(req.tenantId, async tx => ({
      current: await currentValues(tx, req.tenantId, venueId, dates),
      imported: await importedStats(tx, { tenantId: req.tenantId, venueId, timezone: venue.timezone }),
    }))

    const mappedPayments = new Set()
    for (const group of MAPPING_GROUPS) {
      for (const terms of Object.values(link.mappings?.[group] || {})) {
        for (const t of terms || []) if (t.kind === 'payment') mappedPayments.add(t.ref)
      }
    }

    return {
      restaurant_name: link.gf_restaurant_name, currency: currency || 'GBP',
      day_starts_at: link.day_starts_at, day_basis: link.day_basis, method: link.method,
      last_order_at: link.last_order_at, last_error: link.last_error, poll_error: pollError,
      imported,
      fields: fields.map(f => ({ key: f.key, group: f.group, id: f.id, name: f.name, terms: f.terms })),
      days: dates.map(date => {
        const day = figures[date]
        const cur = current[date]
        const values = {}
        for (const f of fields) {
          values[f.key] = { source: pounds(sumTerms(day, f.terms)), current: cur.values[f.key] ?? null }
        }
        return {
          date,
          status: cur.report?.status || null,
          filled_at: cur.report?.gloriafood_filled_at || null,
          filled_by: cur.report?.gloriafood_filled_by || null,
          orders: day.orders, test_orders: day.test_orders, cancelled: day.cancelled,
          split_payments: day.split_payments,
          totals: {
            total: pounds(day.total), net_total: pounds(day.net_total), subtotal: pounds(day.subtotal),
            items: pounds(day.items), discounts: pounds(day.discounts), delivery_fees: pounds(day.delivery_fees),
            tips: pounds(day.tips), service_fees: pounds(day.service_fees), tax: pounds(day.tax),
          },
          payments: Object.entries(day.payments).map(([id, p]) => ({
            id, name: paymentLabel(id), amount: pounds(p.amount), count: p.count, mapped: mappedPayments.has(id),
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
    if (!fields.length) throw httpError(422, 'Nothing is mapped yet. Map fields in Cash reconciliation settings > GloriaFood.')

    return withTenant(req.tenantId, async tx => {
      const filled = [], skipped = []
      for (const date of wanted) {
        const day = figures[date]
        const r = await fillReconDay(tx, {
          tenantId: req.tenantId, venueId, date, source: 'gloriafood', by: by(req),
          fields: fields.map(f => ({ group: f.group, id: f.id, source: f.source, amount: pounds(sumTerms(day, f.terms)) })),
        })
        if (r.skipped) skipped.push({ date, reason: r.skipped })
        else filled.push(date)
      }
      return { filled, skipped }
    })
  })
}

// ── Push webhook ────────────────────────────────────────────────
// GloriaFood's "Push Accepted Order" integration POSTs { count, orders } to
// /webhooks/gloriafood/<token>. The token (24 random bytes, unique per venue,
// replaceable from settings) is the check; the venue is found from it. We
// answer straight away (GloriaFood allows 15 seconds).
export async function gloriafoodWebhookRoutes(app) {
  // GloriaFood can be set to send XML; take it as text so the reply can say
  // to switch the integration to JSON.
  app.addContentTypeParser(['application/xml', 'text/xml', 'text/plain'], { parseAs: 'string' }, (req, body, done) => done(null, body))

  app.post('/webhooks/gloriafood/:token', {
    config: { rateLimit: { max: 240, timeWindow: '1 minute', keyGenerator: req => 'gf:' + String(req.params?.token || '') } },
  }, async (req, reply) => {
    const token = String(req.params.token || '')
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return reply.code(404).send({ error: 'Unknown address' })
    const [link] = await sql`
      SELECT tenant_id, venue_id FROM gloriafood_venue_links WHERE push_token = ${token}`
    if (!link) return reply.code(404).send({ error: 'Unknown address' })

    if (typeof req.body === 'string' || req.body == null) {
      const message = 'GloriaFood sent orders in a format we can\'t read. In GloriaFood, set the "Push Accepted Order" integration to JSON.'
      await withTenant(link.tenant_id, tx => tx`
        UPDATE gloriafood_venue_links SET last_error = ${message}, last_error_at = now()
         WHERE tenant_id = ${link.tenant_id} AND venue_id = ${link.venue_id}`).catch(() => {})
      return reply.code(415).send({ error: 'Send JSON' })
    }

    const orders = ordersOf(req.body)
    if (!orders.length) return { ok: true, stored: 0, updated: 0 }
    const r = await ingestOrders({ tenantId: link.tenant_id, venueId: link.venue_id, orders, via: 'push' })
    return { ok: true, stored: r.stored, updated: r.updated, refused: r.refused }
  })
}

// src/routes/integrations.js
//
// The Integrations page (sales from other tills, docs/SALES_IMPORT.md phase
// 1, migrations 288 to 290). Mounted at /api/integrations; the webhooks the
// other tills call are at the root (salesWebhookRoutes).
//
//   GET   /connections                              every connection with its venues, sync state,
//                                                   history progress and what is stored
//   POST  /connections/:id/sync                     Sync now (queued; never run in the request)
//   POST  /connections/:id/venues/:venueId/history  fetch the venue's history again (13 months)
//   POST  /connections/:id/webhook                  a new webhook address: registered with the
//                                                   other till when it allows, the address shown once
//   PATCH /connections/:id                          { status: 'active' | 'paused' }
//   POST  /webhooks/loyverse/:token                 Loyverse says something changed
//
// Making, renaming and removing a Loyverse account, and linking a venue to a
// store, are the Loyverse routes (/api/loyverse/connections,
// /api/loyverse/venues/:venueId/link); the Cash Recon mapping stays on the
// Cash Recon settings. Reads need Cash reconciliation view; Sync now and
// history manage; the webhook and pausing owner/admin with manage, as the
// rest of the connection's setup.

import { z }          from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requireRole, requirePermission } from '../middleware/auth.js'
import { httpError }  from '../middleware/error.js'
import {
  requestSync, markRequested, startHistory, setupWebhook, webhookPoke,
} from '../services/salesImportSvc.js'
import { SYSTEMS, syncLate, historyProgress } from '../../../shared/externalSales.js'

const UUID = z.string().uuid()
const canView   = [requirePermission('cash_recon', 'view')]
const canManage = [requirePermission('cash_recon', 'manage')]
const canSetup  = [requireRole('admin', 'owner'), requirePermission('cash_recon', 'manage')]

const StatusBody = z.object({ status: z.enum(['active', 'paused']) })

async function ownConnection(tx, tenantId, id) {
  const [c] = await tx`SELECT id, system, status FROM pos_connections WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!c) throw httpError(404, 'Connection not found')
  return c
}

export async function connectionsView(tx, tenantId) {
  const conns = await tx`
    SELECT id, system, name, status, token_hint, business_name, currency, last_error,
           last_sync_at, last_sync_ok_at, last_sync_error, last_sync_counts, sync_requested_at,
           (sync_claimed_until IS NOT NULL AND sync_claimed_until > now()) AS syncing,
           webhook_token_hash IS NOT NULL AS webhook_set, webhook_token_hint, webhook_id, webhook_last_at,
           created_at
      FROM pos_connections WHERE tenant_id = ${tenantId} ORDER BY created_at`
  if (!conns.length) return []
  const ids = conns.map(c => c.id)
  const [venues, checks, catalog] = await Promise.all([
    tx`SELECT l.connection_id, l.venue_id, v.name AS venue_name, l.location_id, l.location_name, l.day_starts_at,
              l.history_from, l.history_to, l.history_next_from, l.history_count, l.history_done_at
         FROM pos_connection_venues l JOIN venues v ON v.id = l.venue_id AND v.tenant_id = l.tenant_id
        WHERE l.tenant_id = ${tenantId} AND l.connection_id = ANY(${ids}::uuid[])
        ORDER BY v.name`,
    tx`SELECT connection_id, venue_id, count(*)::int AS n,
              count(*) FILTER (WHERE kind = 'refund')::int AS refunds,
              count(*) FILTER (WHERE cancelled)::int AS cancelled,
              min(business_date)::text AS first_day, max(business_date)::text AS last_day
         FROM ext_checks WHERE tenant_id = ${tenantId} AND connection_id = ANY(${ids}::uuid[])
        GROUP BY connection_id, venue_id`,
    tx`SELECT connection_id, kind, count(*)::int AS n FROM ext_catalog
        WHERE tenant_id = ${tenantId} AND connection_id = ANY(${ids}::uuid[]) AND deleted_at IS NULL
        GROUP BY connection_id, kind`,
  ])
  const now = Date.now()
  return conns.map(c => ({
    id: c.id, system: c.system, system_label: SYSTEMS[c.system]?.label || c.system, name: c.name,
    status: c.status, token_hint: c.token_hint, business_name: c.business_name, currency: c.currency,
    last_sync_at: c.last_sync_at, last_sync_ok_at: c.last_sync_ok_at,
    last_sync_error: c.last_sync_error || c.last_error || null, last_sync_counts: c.last_sync_counts || {},
    syncing: c.syncing, sync_requested: !!(c.sync_requested_at && (!c.last_sync_at || c.sync_requested_at > c.last_sync_at)),
    late: syncLate(c, now),
    webhook: { set: c.webhook_set, hint: c.webhook_token_hint, registered: !!c.webhook_id, last_at: c.webhook_last_at },
    catalog: Object.fromEntries(catalog.filter(r => r.connection_id === c.id).map(r => [r.kind, r.n])),
    venues: venues.filter(v => v.connection_id === c.id).map(v => {
      const k = checks.find(x => x.connection_id === c.id && x.venue_id === v.venue_id)
      return {
        venue_id: v.venue_id, venue_name: v.venue_name, store_id: v.location_id, store_name: v.location_name,
        day_starts_at: v.day_starts_at,
        history: {
          from: v.history_from, to: v.history_to, count: v.history_count, done_at: v.history_done_at,
          progress: historyProgress(v), started: !!v.history_from,
        },
        checks: k?.n || 0, refunds: k?.refunds || 0, cancelled: k?.cancelled || 0,
        first_day: k?.first_day || null, last_day: k?.last_day || null,
      }
    }),
  }))
}

export default async function integrationsRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.get('/connections', { preHandler: canView }, async req =>
    withTenant(req.tenantId, async tx => ({ connections: await connectionsView(tx, req.tenantId) })))

  app.post('/connections/:id/sync', { preHandler: canManage }, async req => {
    const id = UUID.parse(req.params.id)
    await withTenant(req.tenantId, async tx => {
      const c = await ownConnection(tx, req.tenantId, id)
      if (c.status === 'paused') throw httpError(422, 'This connection is paused. Resume it first.')
      await markRequested(tx, req.tenantId, id)
    })
    requestSync(req.tenantId, id, req.log)
    return { queued: true }
  })

  app.post('/connections/:id/venues/:venueId/history', { preHandler: canManage }, async req => {
    const id = UUID.parse(req.params.id)
    const venueId = UUID.parse(req.params.venueId)
    await withTenant(req.tenantId, async tx => {
      await ownConnection(tx, req.tenantId, id)
      const [link] = await tx`
        SELECT 1 FROM pos_connection_venues l JOIN venues v ON v.id = l.venue_id AND v.tenant_id = l.tenant_id
         WHERE l.tenant_id = ${req.tenantId} AND l.connection_id = ${id} AND l.venue_id = ${venueId}`
      if (!link) throw httpError(404, 'That venue isn\'t linked to this connection')
      await startHistory(tx, req.tenantId, venueId)
      await markRequested(tx, req.tenantId, id)
    })
    requestSync(req.tenantId, id, req.log)
    return { queued: true }
  })

  app.post('/connections/:id/webhook', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    await withTenant(req.tenantId, tx => ownConnection(tx, req.tenantId, id))
    return setupWebhook(req.tenantId, id)
  })

  app.patch('/connections/:id', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    const body = StatusBody.parse(req.body)
    await withTenant(req.tenantId, async tx => {
      await ownConnection(tx, req.tenantId, id)
      await tx`UPDATE pos_connections SET status = ${body.status}, updated_at = now() WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      if (body.status === 'active') await markRequested(tx, req.tenantId, id)
    })
    if (body.status === 'active') requestSync(req.tenantId, id, req.log)
    return withTenant(req.tenantId, async tx => ({ connections: await connectionsView(tx, req.tenantId) }))
  })
}

// ── Webhooks ────────────────────────────────────────────────────────────────
// The other till calls /webhooks/<system>/<token> when something changes.
// The token (24 random bytes, its sha256 stored) finds the connection; the
// body is never trusted or read: a sync is asked for, which reads the other
// till with our own token. Answered at once.
export async function salesWebhookRoutes(app) {
  app.post('/webhooks/loyverse/:token', {
    config: { rateLimit: { max: 240, timeWindow: '1 minute', keyGenerator: req => 'sw:' + String(req.params?.token || '') } },
  }, async (req, reply) => {
    const ok = await webhookPoke('loyverse', String(req.params.token || ''), req.log)
    if (!ok) return reply.code(404).send({ error: 'Unknown address' })
    return { ok: true }
  })
}

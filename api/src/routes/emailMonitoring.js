// src/routes/emailMonitoring.js
//
// Email monitoring API — backs the /email-monitoring admin page.
// Combines our local email_log (what we tried to send) with the
// SendGrid Stats + Suppression APIs (delivery / bounces / spam).
//
// Mounted at /api/email-monitoring in app.js.
//
//   GET  /summary?venue_id=...&days=30   — outbound stats + recent suppressions
//   GET  /stats?venue_id=...&days=30     — daily breakdown (delivered/bounced/etc)
//   GET  /suppressions/:type?venue_id    — bounces / blocks / spam_reports / invalid_emails
//   DELETE /suppressions/:type/:email?venue_id — remove from suppression
//   GET  /log?venue_id=...&limit=100     — local email_log (paginated)

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import {
  getStats,
  getSuppressions,
  removeSuppression,
  pingApiKey,
} from '../services/sendgridSvc.js'
import { env } from '../config/env.js'

const SUPPRESSION_TYPES = ['bounces', 'blocks', 'spam_reports', 'invalid_emails']

/**
 * Loads the SendGrid API key for a given venue (or null if the venue
 * uses a different provider / hasn't been configured yet).
 */
async function loadSendgridKey(tenantId, venueId) {
  const [settings] = await withTenant(tenantId, tx => tx`
    SELECT email_provider, provider_api_key
      FROM venue_email_settings
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}
     LIMIT 1
  `)
  const provider = settings?.email_provider || 'sendgrid'
  if (provider !== 'sendgrid') return { provider, apiKey: null }
  // venue-specific key, falling back to the platform-wide env var
  const apiKey = settings?.provider_api_key || env.SENDGRID_API_KEY || null
  return { provider, apiKey }
}

function defaultDateRange(days = 30) {
  const end   = new Date()
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000)
  const fmt   = (d) => d.toISOString().slice(0, 10)
  return { startDate: fmt(start), endDate: fmt(end) }
}

export default async function emailMonitoringRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // ── GET /summary ────────────────────────────────────────
  // One-shot: stats + all suppression counts + recent log. Used by the
  // page on first load so we don't need 5 round-trips.
  app.get('/summary', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const venueId = req.query.venue_id
    const days    = Math.min(Number(req.query.days) || 30, 90)
    if (!venueId) throw httpError(400, 'venue_id is required')

    const { provider, apiKey } = await loadSendgridKey(req.tenantId, venueId)

    // Local email_log totals over the same window.
    const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    const localTotals = await withTenant(req.tenantId, async tx => {
      const rows = await tx`
        SELECT status, COUNT(*)::int AS c
          FROM email_log
         WHERE tenant_id = ${req.tenantId}
           AND created_at >= ${sinceIso}
         GROUP BY status
      `
      return Object.fromEntries(rows.map(r => [r.status, r.c]))
    })

    if (provider !== 'sendgrid' || !apiKey) {
      return {
        provider,
        configured:        false,
        days,
        local:             localTotals,
        sendgrid:          null,
        suppressions:      null,
      }
    }

    const { startDate, endDate } = defaultDateRange(days)

    // Fetch in parallel; failures degrade gracefully (return nulls).
    const [stats, bounces, blocks, spam, invalid, ping] = await Promise.all([
      getStats({ apiKey, startDate, endDate }).catch(e => ({ __error: e.message })),
      getSuppressions({ apiKey, type: 'bounces',        limit: 100 }).catch(() => null),
      getSuppressions({ apiKey, type: 'blocks',         limit: 100 }).catch(() => null),
      getSuppressions({ apiKey, type: 'spam_reports',   limit: 100 }).catch(() => null),
      getSuppressions({ apiKey, type: 'invalid_emails', limit: 100 }).catch(() => null),
      pingApiKey({ apiKey }).then(() => true).catch(() => false),
    ])

    // Aggregate stats across the window
    let totals = null
    let series = null
    if (Array.isArray(stats)) {
      totals = stats.reduce((acc, day) => {
        for (const k of Object.keys(day)) {
          if (k === 'date') continue
          acc[k] = (acc[k] || 0) + (Number(day[k]) || 0)
        }
        return acc
      }, {})
      series = stats
    }

    return {
      provider:     'sendgrid',
      configured:   ping,
      days,
      local:        localTotals,
      sendgrid: {
        totals,
        series,
        statsError: stats?.__error ?? null,
      },
      suppressions: {
        bounces:        bounces        ?? [],
        blocks:         blocks         ?? [],
        spam_reports:   spam           ?? [],
        invalid_emails: invalid        ?? [],
      },
    }
  })

  // ── GET /stats ──────────────────────────────────────────
  app.get('/stats', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const venueId = req.query.venue_id
    const days    = Math.min(Number(req.query.days) || 30, 90)
    if (!venueId) throw httpError(400, 'venue_id is required')
    const { provider, apiKey } = await loadSendgridKey(req.tenantId, venueId)
    if (provider !== 'sendgrid') throw httpError(400, `Venue is using ${provider}, not SendGrid`)
    if (!apiKey) throw httpError(400, 'No SendGrid API key configured for this venue')
    const { startDate, endDate } = defaultDateRange(days)
    return getStats({ apiKey, startDate, endDate })
  })

  // ── GET /suppressions/:type ─────────────────────────────
  app.get('/suppressions/:type', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    if (!SUPPRESSION_TYPES.includes(req.params.type)) {
      throw httpError(400, 'Invalid suppression type')
    }
    const venueId = req.query.venue_id
    if (!venueId) throw httpError(400, 'venue_id is required')
    const { provider, apiKey } = await loadSendgridKey(req.tenantId, venueId)
    if (provider !== 'sendgrid') throw httpError(400, `Venue is using ${provider}, not SendGrid`)
    if (!apiKey) throw httpError(400, 'No SendGrid API key configured')
    return getSuppressions({ apiKey, type: req.params.type, limit: Math.min(Number(req.query.limit) || 100, 500) })
  })

  // ── DELETE /suppressions/:type/:email ───────────────────
  app.delete('/suppressions/:type/:email', { preHandler: requireRole('owner') }, async (req) => {
    if (!SUPPRESSION_TYPES.includes(req.params.type)) {
      throw httpError(400, 'Invalid suppression type')
    }
    const venueId = req.query.venue_id
    if (!venueId) throw httpError(400, 'venue_id is required')
    const { provider, apiKey } = await loadSendgridKey(req.tenantId, venueId)
    if (provider !== 'sendgrid') throw httpError(400, `Venue is using ${provider}, not SendGrid`)
    if (!apiKey) throw httpError(400, 'No SendGrid API key configured')
    return removeSuppression({ apiKey, type: req.params.type, email: req.params.email })
  })

  // ── GET /log ────────────────────────────────────────────
  // Local email_log (what WE tried to send). Cross-references with
  // SendGrid suppressions on the frontend via recipient match.
  app.get('/log', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500)
    const venueIdFilter = req.query.venue_id
    return withTenant(req.tenantId, tx => tx`
      SELECT el.*, b.guest_name, b.starts_at, b.venue_id, v.name AS venue_name
        FROM email_log el
        LEFT JOIN bookings b ON b.id = el.booking_id
        LEFT JOIN venues   v ON v.id = b.venue_id
       WHERE el.tenant_id = ${req.tenantId}
         ${venueIdFilter ? tx`AND (b.venue_id = ${venueIdFilter} OR el.booking_id IS NULL)` : tx``}
       ORDER BY el.created_at DESC
       LIMIT ${limit}
    `)
  })
}

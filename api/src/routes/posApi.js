// src/routes/posApi.js
//
// The till app's API, /pos-api (docs/POS.md). A till is a paired device,
// not a signed-in user: it sends `Authorization: Device <device id>.<secret>`
// on every call. People on the till are identified by their PIN, checked on
// the till itself (shared/pos/pin.js); events carry their staff id and the
// sequencer checks what their POS role allows.
//
//   POST /pair                  { code } -> { device_id, secret, ... }   (no auth)
//   GET  /me                    this till and its venue
//   GET  /config?version=       everything the till needs offline (unchanged: true when version matches)
//   GET  /sync?since=<seq>      events and changed checks since seq; reset: true with all open checks
//   POST /events                { events: [...] } -> per-event results, in order
//   GET  /checks?status=closed  recent closed checks (reopen, refund, reprint)
//   GET  /checks/:id            one check
//   GET  /reports/day?day_id=   X report (the open day) or a past day's Z
//   GET  /days                  recent trading days
//   POST /presence              { check_id, staff_id } who has which check open (soft lock)
//   GET  /print-jobs            the venue's print queue
//   POST /print-jobs/claim      a hub (later) takes queued jobs for its printers
//   POST /print-jobs/:id/status { status: 'printed' | 'failed', error }
//
// The cloud sequences every venue's events until a venue hub is installed;
// the hub will serve this same API on the LAN (the till's transport picks
// the hub when it can reach it).

import crypto from 'node:crypto'
import { z } from 'zod'
import { sql, withTenant } from '../config/db.js'
import { httpError } from '../middleware/error.js'
import { broadcast } from '../config/ws.js'
import {
  tillConfig, sequencer, sha256, normaliseCode, newDeviceSecret, loadDayChecks, fillReconFromDay, dayReport,
} from '../services/posSvc.js'
import { dayFigures } from '../../../shared/pos/reports.js'

const UUID = z.string().uuid()
const CHECK_ID = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/)
const MAX_BATCH = 200
const SYNC_WINDOW = 500

// ── Device auth ──────────────────────────────────────────────────

const deviceCache = new Map()   // id -> { device, at }
const CACHE_MS = 30_000

export function forgetDevice(id) { deviceCache.delete(id) }

function sameHash(a, b) {
  if (!a || !b || a.length !== b.length) return false
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

async function loadDevice(id) {
  const hit = deviceCache.get(id)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.device
  const [d] = await sql`
    SELECT d.id, d.tenant_id, d.venue_id, d.kind, d.name, d.short_code, d.secret_hash, d.revoked_at, d.settings,
           t.is_active AS tenant_active,
           COALESCE((SELECT m.is_enabled FROM tenant_modules m WHERE m.tenant_id = d.tenant_id AND m.module_key = 'pos_setup'), true) AS pos_enabled
      FROM pos_devices d
      JOIN tenants t ON t.id = d.tenant_id
     WHERE d.id = ${id}
     LIMIT 1`
  if (d) deviceCache.set(id, { device: d, at: Date.now() })
  return d || null
}

/** The paired device for `Device <id>.<secret>`, or null. Used by the WebSocket too. */
export async function verifyDevice(id, secret) {
  if (!UUID.safeParse(id).success || !secret) return null
  const d = await loadDevice(id)
  if (!d || d.revoked_at || !d.secret_hash || !d.tenant_active) return null
  if (!sameHash(sha256(secret), d.secret_hash)) return null
  return d
}

const lastSeen = new Map()

async function requireDevice(req, reply) {
  const m = /^Device ([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,})$/i.exec(req.headers.authorization || '')
  if (!m) return reply.code(401).send({ error: 'This till isn\'t paired', code: 'not_paired' })
  const d = await verifyDevice(m[1], m[2])
  if (!d) return reply.code(401).send({ error: 'This till isn\'t paired (or was removed)', code: 'not_paired' })
  if (!d.pos_enabled) return reply.code(403).send({ error: 'The till is switched off for this restaurant', code: 'pos_off' })
  req.posDevice = d
  req.tenantId = d.tenant_id
  const seen = lastSeen.get(d.id) || 0
  if (Date.now() - seen > 60_000) {
    lastSeen.set(d.id, Date.now())
    const version = String(req.headers['x-pos-version'] || '').slice(0, 40) || null
    sql`UPDATE pos_devices SET last_seen_at = now(), app_version = COALESCE(${version}, app_version) WHERE id = ${d.id}`
      .catch(e => req.log.warn({ err: e }, 'pos last_seen update failed'))
  }
}

// ── Presence (soft locks) ────────────────────────────────────────

const presence = new Map()   // venueId -> Map(deviceId -> { check_id, staff_id, at, device_name })
const PRESENCE_MS = 45_000

function presenceFor(venueId) {
  const map = presence.get(venueId)
  if (!map) return []
  const now = Date.now()
  const out = []
  for (const [deviceId, p] of map) {
    if (now - p.at > PRESENCE_MS) { map.delete(deviceId); continue }
    if (p.check_id) out.push({ device_id: deviceId, ...p })
  }
  return out
}

// ── Routes ───────────────────────────────────────────────────────

async function currentDay(tx, tenantId, venueId) {
  const [day] = await tx`
    SELECT id, business_date::text AS business_date, opened_at FROM pos_days
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND closed_at IS NULL LIMIT 1`
  return day || null
}

export default async function posApiRoutes(app) {
  // ── Pairing (no auth: the one-time code is the key) ──────────────
  app.post('/pair', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async req => {
    const body = z.object({
      code: z.string().min(4).max(20),
      app_version: z.string().max(40).optional(),
      user_agent: z.string().max(300).optional(),
    }).parse(req.body)
    const hash = sha256(normaliseCode(body.code))
    const secret = newDeviceSecret()
    const [d] = await sql`
      UPDATE pos_devices
         SET secret_hash = ${sha256(secret)}, pairing_code_hash = NULL, pairing_expires_at = NULL, paired_at = now(),
             last_seen_at = now(), app_version = ${body.app_version ?? null}, user_agent = ${body.user_agent ?? null}
       WHERE pairing_code_hash = ${hash} AND pairing_expires_at > now() AND revoked_at IS NULL
       RETURNING id, tenant_id, venue_id, kind, name, short_code`
    if (!d) throw httpError(422, 'That code isn\'t right or has run out: make a new one in Till setup')
    deviceCache.delete(d.id)
    const [v] = await sql`SELECT name FROM venues WHERE id = ${d.venue_id} AND tenant_id = ${d.tenant_id}`
    return { device_id: d.id, secret, name: d.name, kind: d.kind, short_code: d.short_code, venue_id: d.venue_id, venue_name: v?.name || null }
  })

  app.register(async scoped => {
    scoped.addHook('preHandler', requireDevice)

    scoped.get('/me', async req => {
      const d = req.posDevice
      const [v] = await sql`SELECT name, timezone FROM venues WHERE id = ${d.venue_id} AND tenant_id = ${d.tenant_id}`
      return { device_id: d.id, name: d.name, kind: d.kind, short_code: d.short_code, settings: d.settings || {}, venue_id: d.venue_id, venue_name: v?.name, timezone: v?.timezone }
    })

    scoped.get('/config', async req => {
      const d = req.posDevice
      const config = await withTenant(d.tenant_id, tx => tillConfig(tx, d.tenant_id, d.venue_id))
      if (req.query.version && req.query.version === config.version) return { unchanged: true, version: config.version }
      const [own] = await sql`SELECT name, short_code, settings FROM pos_devices WHERE id = ${d.id} AND tenant_id = ${d.tenant_id}`
      return { ...config, device: { id: d.id, name: own?.name, short_code: own?.short_code, settings: own?.settings || {} } }
    })

    scoped.get('/sync', async req => {
      const d = req.posDevice
      const since = Math.max(0, Number(req.query.since) || 0)
      return withTenant(d.tenant_id, async tx => {
        const [st] = await tx`SELECT last_seq FROM pos_venue_state WHERE venue_id = ${d.venue_id} AND tenant_id = ${d.tenant_id}`
        const seq = Number(st?.last_seq || 0)
        const day = await currentDay(tx, d.tenant_id, d.venue_id)
        const extra = { day, presence: presenceFor(d.venue_id), server_time: new Date().toISOString() }
        if (since === 0 || since > seq || seq - since > SYNC_WINDOW) {
          // Start again: every open check, plus this trading day's closed ones.
          const rows = await tx`
            SELECT state FROM pos_checks
             WHERE tenant_id = ${d.tenant_id} AND venue_id = ${d.venue_id}
               AND (status = 'open' ${day ? tx`OR day_id = ${day.id}` : tx``})`
          return { reset: true, seq, events: [], checks: rows.map(r => r.state), ...extra }
        }
        if (since === seq) return { seq, events: [], checks: [], ...extra }
        const events = await tx`
          SELECT id, seq, type, check_id, device_id, staff_id, approved_by, payload, assigned, client_at
            FROM pos_events
           WHERE tenant_id = ${d.tenant_id} AND venue_id = ${d.venue_id} AND seq > ${since}
           ORDER BY seq LIMIT ${SYNC_WINDOW}`
        const checks = await tx`
          SELECT state FROM pos_checks
           WHERE tenant_id = ${d.tenant_id} AND venue_id = ${d.venue_id} AND last_seq > ${since}`
        return { seq, events: events.map(e => ({ ...e, seq: Number(e.seq) })), checks: checks.map(r => r.state), ...extra }
      })
    })

    scoped.post('/events', { bodyLimit: 2 * 1024 * 1024 }, async req => {
      const d = req.posDevice
      const { events } = z.object({ events: z.array(z.record(z.any())).min(1).max(MAX_BATCH) }).parse(req.body)
      const seqr = sequencer(d.tenant_id, d.venue_id, { deviceId: d.id })
      const results = []
      const changed = {}
      let accepted = 0
      for (const raw of events) {
        // The till names itself and its venue by its pairing, not by the event.
        const e = { ...raw, venue_id: d.venue_id, device_id: d.id }
        delete e.seq
        delete e.assigned
        const r = await seqr.submit(e)
        if (r.ok) {
          if (!r.duplicate) accepted++
          for (const [id, c] of Object.entries(r.checks || {})) changed[id] = c
          results.push({ id: e.id, ok: true, seq: r.seq, duplicate: !!r.duplicate, assigned: r.event?.assigned || null })
          if (e.type === 'day.closed' && !r.duplicate) afterZ(req, d, r.event.assigned?.day_id)
        } else {
          results.push({ id: e.id, ok: false, error: r.error, code: r.code, duplicate: !!r.duplicate })
        }
      }
      const [st] = await withTenant(d.tenant_id, tx => tx`SELECT last_seq FROM pos_venue_state WHERE venue_id = ${d.venue_id} AND tenant_id = ${d.tenant_id}`)
      const seq = Number(st?.last_seq || 0)
      if (accepted) broadcast('pos:' + d.venue_id, { type: 'pos.seq', seq, from: d.id })
      return { results, seq, checks: Object.values(changed) }
    })

    scoped.get('/checks', async req => {
      const d = req.posDevice
      const q = z.object({ status: z.enum(['open', 'closed', 'void']).default('closed'), limit: z.coerce.number().int().min(1).max(200).default(60) }).parse(req.query)
      return withTenant(d.tenant_id, tx => tx`
        SELECT id, number, order_no, mode, table_id, tab_name, covers, server_id, status, opened_at, closed_at, total, paid, refunded, day_id
          FROM pos_checks
         WHERE tenant_id = ${d.tenant_id} AND venue_id = ${d.venue_id} AND status = ${q.status}
         ORDER BY COALESCE(closed_at, opened_at) DESC
         LIMIT ${q.limit}`)
    })

    scoped.get('/checks/:id', async req => {
      const d = req.posDevice
      const id = CHECK_ID.parse(req.params.id)
      const [c] = await withTenant(d.tenant_id, tx => tx`SELECT state FROM pos_checks WHERE id = ${id} AND tenant_id = ${d.tenant_id} AND venue_id = ${d.venue_id}`)
      if (!c) throw httpError(404, 'Check not found')
      return c.state
    })

    scoped.get('/reports/day', async req => {
      const d = req.posDevice
      return withTenant(d.tenant_id, async tx => {
        let dayId = req.query.day_id ? UUID.parse(req.query.day_id) : null
        if (!dayId) {
          const day = await currentDay(tx, d.tenant_id, d.venue_id)
          if (!day) return { day: null, figures: dayFigures([], null) }
          dayId = day.id
        }
        return dayReport(tx, d.tenant_id, d.venue_id, dayId)
      })
    })

    scoped.get('/days', async req => {
      const d = req.posDevice
      return withTenant(d.tenant_id, tx => tx`
        SELECT id, business_date::text AS business_date, z_number, opened_at, closed_at, declared_cash, recon_filled_at, recon_error,
               (figures->'sales'->>'total')::int AS total
          FROM pos_days WHERE tenant_id = ${d.tenant_id} AND venue_id = ${d.venue_id}
         ORDER BY opened_at DESC LIMIT 30`)
    })

    scoped.post('/presence', async req => {
      const d = req.posDevice
      const body = z.object({ check_id: CHECK_ID.nullable().optional(), staff_id: UUID.nullable().optional() }).parse(req.body || {})
      let map = presence.get(d.venue_id)
      if (!map) presence.set(d.venue_id, (map = new Map()))
      const before = map.get(d.id)?.check_id || null
      map.set(d.id, { check_id: body.check_id || null, staff_id: body.staff_id || null, at: Date.now(), device_name: d.name })
      if (before !== (body.check_id || null)) broadcast('pos:' + d.venue_id, { type: 'pos.presence' })
      return { presence: presenceFor(d.venue_id) }
    })

    scoped.get('/print-jobs', async req => {
      const d = req.posDevice
      const status = z.enum(['queued', 'printing', 'printed', 'failed', 'cancelled']).default('queued').parse(req.query.status || undefined)
      return withTenant(d.tenant_id, tx => tx`
        SELECT id, printer_id, kind, title, ops, status, attempts, error, check_id, created_at, printed_at
          FROM pos_print_jobs
         WHERE tenant_id = ${d.tenant_id} AND venue_id = ${d.venue_id} AND status = ${status}
         ORDER BY created_at DESC LIMIT 100`)
    })

    // For the venue hub (docs/POS.md): take queued jobs for printing.
    scoped.post('/print-jobs/claim', async req => {
      const d = req.posDevice
      if (d.kind !== 'hub') throw httpError(403, 'Only a hub collects print jobs')
      const body = z.object({ limit: z.number().int().min(1).max(50).default(20) }).parse(req.body || {})
      return withTenant(d.tenant_id, tx => tx`
        UPDATE pos_print_jobs SET status = 'printing', claimed_by = ${d.id}, attempts = attempts + 1
         WHERE id IN (
           SELECT id FROM pos_print_jobs
            WHERE tenant_id = ${d.tenant_id} AND venue_id = ${d.venue_id} AND status = 'queued'
            ORDER BY created_at LIMIT ${body.limit} FOR UPDATE SKIP LOCKED)
        RETURNING id, printer_id, kind, title, ops, check_id, created_at`)
    })

    scoped.post('/print-jobs/:id/status', async req => {
      const d = req.posDevice
      const id = UUID.parse(req.params.id)
      const body = z.object({ status: z.enum(['printed', 'failed', 'cancelled']), error: z.string().max(300).nullable().optional() }).parse(req.body)
      const [row] = await withTenant(d.tenant_id, tx => tx`
        UPDATE pos_print_jobs
           SET status = ${body.status}, error = ${body.error ?? null},
               printed_at = ${body.status === 'printed' ? new Date() : null}
         WHERE id = ${id} AND tenant_id = ${d.tenant_id} AND venue_id = ${d.venue_id}
         RETURNING id, status`)
      if (!row) throw httpError(404, 'Print job not found')
      return row
    })
  })
}

/** After a Z report: fill Cash Recon when the venue wants it. Never fails the Z. */
function afterZ(req, device, dayId) {
  if (!dayId) return
  ;(async () => {
    const [s] = await withTenant(device.tenant_id, tx => tx`
      SELECT recon_auto_fill FROM pos_settings WHERE venue_id = ${device.venue_id} AND tenant_id = ${device.tenant_id}`)
    if (!s?.recon_auto_fill) return
    await fillReconFromDay(device.tenant_id, device.venue_id, dayId, 'Till ' + device.name)
  })().catch(async err => {
    req.log.warn({ err }, 'pos: Cash Recon fill after Z failed')
    await withTenant(device.tenant_id, tx => tx`
      UPDATE pos_days SET recon_error = ${String(err.message || err).slice(0, 300)}
       WHERE id = ${dayId} AND tenant_id = ${device.tenant_id}`).catch(() => {})
  })
}

export { loadDayChecks }

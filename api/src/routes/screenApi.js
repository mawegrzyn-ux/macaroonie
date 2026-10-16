// src/routes/screenApi.js
//
// The menu screens' player API, /screen-api (migration 166). A screen is a
// paired device, not a person (services/screenAuth.js).
//
//   POST /pairings              (no auth) a new pairing code for the screen
//                               to show: { id, code, secret, expires_at }
//   GET  /pairings/:id          `Authorization: Pairing <secret>`:
//                               { status: 'waiting' | 'paired' | 'expired', screen_id }
//                               Once paired the screen signs in with
//                               `Screen <screen_id>.<the same secret>`.
//   GET  /config?version=       everything the screen shows (services/screenSvc.js);
//                               { unchanged: true } when the version matches
//   POST /heartbeat             { app_version, showing, viewport, error, clock } every
//                               minute: Screens shows online / what's on
//   GET  /orders                order numbers for the Order status block (kitchen
//                               screens: services/kitchenSvc.js boardFor())
//   GET  /time                  (no auth) { now } in ms: screens set their clock
//                               from a few of these (lowest round trip wins), so
//                               a wall's screens change boards together
//
// Live changes come over the WebSocket (/ws?screen=<id>&secret=<secret>):
// screens.changed, screens.sold_out, menus.live (all: fetch the config
// again), kitchen.board (fetch /orders), screen.identify, screen.reload,
// screen.removed.

import { z } from 'zod'
import { sql, withTenant } from '../config/db.js'
import { httpError } from '../middleware/error.js'
import {
  sha256, newSecret, newScreenCode, normaliseScreenCode, sameHash, verifyScreen, PAIRING_MINUTES,
} from '../services/screenAuth.js'
import { screenConfig } from '../services/screenSvc.js'
import { boardFor } from '../services/kitchenSvc.js'

const UUID = z.string().uuid()

const DeviceInfo = z.object({
  width: z.number().int().min(0).max(20000).optional(),
  height: z.number().int().min(0).max(20000).optional(),
  dpr: z.number().min(0).max(10).optional(),
  ua: z.string().max(300).optional(),
  kiosk: z.boolean().optional(),
  app_version: z.string().max(40).optional(),
}).partial()

const lastSeen = new Map()

async function requireScreen(req, reply) {
  const m = /^Screen ([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,})$/i.exec(req.headers.authorization || '')
  if (!m) return reply.code(401).send({ error: 'This screen isn\'t paired', code: 'not_paired' })
  const s = await verifyScreen(m[1], m[2])
  if (!s) return reply.code(401).send({ error: 'This screen isn\'t paired (or was removed)', code: 'not_paired' })
  if (!s.screens_enabled) return reply.code(403).send({ error: 'Menu screens are switched off for this restaurant', code: 'screens_off' })
  req.screen = s
  req.tenantId = s.tenant_id
}

export default async function screenApiRoutes(app) {
  // ── Pairing (no auth: the code is typed into Screens by someone signed in) ──
  app.post('/pairings', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async req => {
    const body = z.object({ device: DeviceInfo.optional() }).parse(req.body || {})
    const secret = newSecret()
    await sql`DELETE FROM screen_pairings WHERE expires_at < now() - interval '1 day'`
    for (let i = 0; i < 6; i++) {
      const code = newScreenCode()
      const [row] = await sql`
        INSERT INTO screen_pairings (code_hash, secret_hash, device_info, expires_at)
        VALUES (${sha256(normaliseScreenCode(code))}, ${sha256(secret)}, ${sql.json(body.device || {})},
                now() + make_interval(mins => ${PAIRING_MINUTES}))
        ON CONFLICT (code_hash) DO NOTHING
        RETURNING id, expires_at`
      if (row) return { id: row.id, code, secret, expires_at: row.expires_at }
    }
    throw httpError(503, 'Couldn\'t make a code, try again')
  })

  // The server's clock, as close to the answer as possible (no database).
  app.get('/time', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store')
    return { now: Date.now() }
  })

  app.get('/pairings/:id', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!UUID.safeParse(req.params.id).success) throw httpError(404, 'Not found')
    const m = /^Pairing ([A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization || '')
    const [p] = await sql`SELECT id, secret_hash, expires_at, screen_id, claimed_at FROM screen_pairings WHERE id = ${req.params.id}`
    if (!p || !m || !sameHash(sha256(m[1]), p.secret_hash)) return reply.code(404).send({ error: 'Not found', status: 'expired' })
    if (p.screen_id) return { status: 'paired', screen_id: p.screen_id }
    if (new Date(p.expires_at) <= new Date()) return { status: 'expired' }
    return { status: 'waiting', expires_at: p.expires_at }
  })

  app.register(async scoped => {
    scoped.addHook('preHandler', requireScreen)

    scoped.get('/config', async req => {
      const s = req.screen
      const config = await withTenant(s.tenant_id, tx => screenConfig(tx, s.tenant_id, s.id))
      if (!config) throw httpError(401, 'This screen was removed')
      const server_time = new Date().toISOString()
      if (req.query.version && req.query.version === config.version) return { unchanged: true, version: config.version, server_time }
      return { ...config, server_time }
    })

    // Order numbers for the Order status block (kitchen screens; services/kitchenSvc.js).
    scoped.get('/orders', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
      const s = req.screen
      reply.header('Cache-Control', 'no-store')
      return { orders: await boardFor(s.tenant_id, s.venue_id, { clearMins: 120 }), server_time: new Date().toISOString() }
    })

    scoped.post('/heartbeat', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async req => {
      const s = req.screen
      const b = z.object({
        app_version: z.string().max(40).optional(),
        showing: z.object({
          design_id: UUID.nullable().optional(),
          name: z.string().max(120).nullable().optional(),
          playlist_item_id: UUID.nullable().optional(),
        }).nullable().optional(),
        viewport: z.object({ w: z.number().int().min(0).max(20000), h: z.number().int().min(0).max(20000) }).nullable().optional(),
        error: z.string().max(300).nullable().optional(),
        config_version: z.string().max(40).nullable().optional(),
        offline_secs: z.number().int().min(0).max(10_000_000).optional(),
        clock: z.object({
          offset_ms: z.number().int().min(-1e10).max(1e10),
          rtt_ms: z.number().int().min(0).max(600_000),
        }).nullable().optional(),
      }).parse(req.body || {})
      // At most one write a minute per screen (several processes may each allow one).
      const seen = lastSeen.get(s.id) || 0
      if (Date.now() - seen > 50_000) {
        lastSeen.set(s.id, Date.now())
        const status = {
          showing: b.showing || null, viewport: b.viewport || null, error: b.error || null,
          config_version: b.config_version || null, offline_secs: b.offline_secs ?? 0, clock: b.clock || null,
          at: new Date().toISOString(),
        }
        await sql`
          UPDATE screens SET last_seen_at = now(), app_version = COALESCE(${b.app_version ?? null}, app_version),
                 status = ${sql.json(status)}
           WHERE id = ${s.id} AND tenant_id = ${s.tenant_id}`
      }
      return { ok: true, server_time: new Date().toISOString() }
    })
  })
}

// src/routes/posApi.js
//
// The till app's API, /pos-api (docs/POS.md). A till is a paired device,
// not a signed-in user: it sends `Authorization: Device <device id>.<secret>`
// on every call. People on the till are identified by their PIN, checked on
// the till itself (shared/pos/pin.js); events carry their staff id and the
// sequencer checks what their POS role allows.
//
//   POST /pairings              { app?, device? } (no auth) a code for this device to show, with a
//                               QR code to the installer app: { id, code, secret, expires_at, link_url }
//                               (migration 184; someone signed in links it: POST /api/pos/venues/:id/link,
//                               from Store tech or the installer). The one way a device is set up
//   POST /pair                  { code, app? } -> { device_id, secret, ... }   (no auth). Only the hand-over
//                               code of POST /move, typed in by the app at the new address. `app` is the
//                               kind the address runs: a code for another kind is refused, naming its address
//   GET  /pairings/:id          `Authorization: Pairing <secret>`: { status: 'waiting' | 'paired' |
//                               'expired' }; once paired the device signs in as `Device <id>.<the same secret>`
//   POST /disconnect            the device forgets its pairing (its settings): the secret stops
//                               working, Store tech shows it not linked; linking a device showing a code sets it up again
//   POST /move                  a kitchen screen or kiosk still on another address moves to its
//                               own: a one-time pairing code (10 minutes) for its address
//   GET  /kiosk-preview?token=  a kiosk design's preview config (the signed link is the key, services/kioskSvc.js)
//   GET  /kiosk-share?token=    a kiosk design's shared preview (its lasting link, migration 187): the
//                               config plus { share: design, venue, company names }; counts the view
//   GET  /kitchen-test?token=   the kitchen test bench's data (signed link, services/kitchenSvc.js kitchenTestData())
//   GET  /me                    this till and its venue
//   GET  /config?version=       everything the till needs offline (unchanged: true when version matches);
//                               a kitchen screen (kind 'kds') gets the kitchen's config instead, a
//                               self-order kiosk (kind 'kiosk') its menus, design and languages
//                               (a kiosk may only call /me, /config and /events). A till's or kiosk's
//                               reply always carries sold_out and prices (an unchanged one too)
//   GET  /live                  { sold_out, prices } for a till or kiosk, pulled every 30 s: sold out
//                               now, and a stamp of what sets prices (a new one: fetch /config)
//   GET  /sync?since=<seq>      events and changed checks since seq; reset: true with all open checks;
//                               numbers: this till's highest numbers today (shared/pos/numbers.js),
//                               which a till that lost its storage carries on from
//   GET  /kitchen/sync?since=   kitchen orders since seq (shared/pos/kitchen.js; services/kitchenSvc.js)
//   PUT  /kitchen/flow          { flow_id } a kitchen screen's flow button puts another kitchen flow in
//                               use (migration 177; not when Store tech turned it off for that screen)
//   POST /events                { events: [...] } -> per-event results, in order (till and kitchen
//                               events; kitchen.order_in / order_status are refused from devices)
//   GET  /checks?status=closed  recent closed checks (reopen, refund, reprint)
//   GET  /checks/:id            one check
//   GET  /reports/day?day_id=   X report (the open day) or a past day's Z; waiting: the venue's
//                               devices with changes not sent yet or not heard from lately
//   Every call may say X-Pos-Pending: <n>, how many changes the device hasn't sent yet
//   GET  /days                  recent trading days
//   POST /presence              { check_id, staff_id } who has which check open (soft lock)
//   GET  /print-jobs            the venue's print queue
//   PUT  /sold-out/:itemId      { sold_out: 'today' | 'indefinite' | false, staff_id, approved_by? }
//                               (role permission sold_out; services/soldOut.js, online only)
//   POST /print-jobs/claim      takes queued jobs for the printers it prints for (migration
//                               191): a venue hub, the network printers (connection 'hub') and
//                               the USB printers plugged into it (migration 195); a till or
//                               kitchen screen, the printers plugged into it
//   POST /print-jobs/:id/status { status: 'printed' | 'failed', error }
//   POST /hub/status            a venue hub's report: its version, each printer's state, info
//                               about itself (computer, USB printers found, updates)
//   GET  /hub/release           (no auth) the hub's latest version: { version, sha256, size, url }
//   GET  /hub/release.tgz       (no auth) the hub's code (services/hubRelease.js)
//   GET  /hub/install.sh | /hub/install.ps1   (no auth) the hub's installer for Linux / Windows,
//                               with this cloud's address filled in
//   GET  /hub/setup             (no auth) the page a mini PC opens to download the installer
//                               (pos.<domain>/hub redirects here, routes/posSite.js)
//   GET  /hub/setup.cmd | /hub/setup.sh   (no auth) the downloads: a Windows file to double-click
//                               (asks to run as administrator, runs install.ps1, opens the hub's
//                               page) and install.sh, which runs itself with sudo from a file
//   POST /card/payments         { check_id?, payment_id, amount, tip?, staff_id? } start a payment on the
//                               device's card machine (migration 193, services/cardSvc.js); a kiosk sends
//                               no check (it pays before its order exists)
//   GET  /card/payments?check_id=  this check's card attempts (resume after a reload)
//   GET  /card/payments/:id     how it is going (asks the provider at most every 1.2 s)
//   POST /card/payments/:id/cancel | /signature { accepted } | /test { result: approve | decline }
//   POST /card/refunds          { sale_id, check_id, refund_id, amount, staff_id, approved_by?, purpose }
//                               money back to the card (role permission refund, or void to take it off)
//
// The cloud sequences every venue's events until a venue hub is installed;
// the hub will serve this same API on the LAN (the till's transport picks
// the hub when it can reach it).

import crypto from 'node:crypto'
import { z } from 'zod'
import { sql, withTenant, systemSql, tenantSql } from '../config/db.js'
import { httpError } from '../middleware/error.js'
import { broadcast } from '../config/ws.js'
import {
  tillConfig, hubConfig, liveFields, sequencer, sha256, normaliseCode, newDeviceSecret, loadDayChecks, fillReconFromDay, dayReport, loadTillStaff, openPairing,
} from '../services/posSvc.js'
import { deviceOrigin } from '../services/platformHost.js'
import { hubRelease, installScript, hubSetupPage } from '../services/hubRelease.js'
import { LINK_MINUTES, newLinkCode, linkCodeHash, linkCodeTaken, linkUrl } from '../services/linkCodes.js'
import { dayFigures } from '../../../shared/pos/reports.js'
import { permissionProblem } from '../../../shared/pos/permissions.js'
import { deviceEvent } from '../../../shared/pos/deviceRules.js'
import { kioskConfig, readPreviewToken, previewDevice } from '../services/kioskSvc.js'
import { saveVisits, MAX_VISITS } from '../services/kioskJourneySvc.js'
import { kioskReceipt, sendWaitingReceipts } from '../services/receiptSvc.js'
import { settleChangedChecks } from '../services/loyaltySvc.js'
import { hubFor, hubContext, hubSync, hubTime, HUB_DEVICE_KINDS } from '../services/hubFirstSvc.js'
import { loyaltyDeviceRoutes } from './loyaltyPos.js'
import { setSoldOut, soldOutItemIds, announceSoldOut } from '../services/soldOut.js'
import { kdsConfig, kitchenSync, onlineMoves, switchFlow, readKitchenTestToken, kitchenTestData } from '../services/kitchenSvc.js'
import { changeStatus } from '../services/orderSvc.js'
import {
  startSale, refreshPayment, devicePayment, devicePayments, cancelSale, answerSignature, simulateSale, startRefund, paymentView, cardMachineOf,
} from '../services/cardSvc.js'

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
  const [d] = await systemSql`
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
// Changes a device says it hasn't sent yet (X-Pos-Pending), written when they change.
const lastPending = new Map()

const KIOSK_ROUTES = new Set(['GET /pos-api/me', 'GET /pos-api/config', 'GET /pos-api/live', 'POST /pos-api/events', 'POST /pos-api/disconnect', 'POST /pos-api/move',
  'POST /pos-api/kiosk/journeys', 'POST /pos-api/kiosk/receipts',
  'POST /pos-api/loyalty/lookup', 'POST /pos-api/loyalty/redemptions', 'POST /pos-api/loyalty/redemptions/:id/release',
  'POST /pos-api/card/payments', 'GET /pos-api/card/payments/:id', 'POST /pos-api/card/payments/:id/cancel', 'POST /pos-api/card/payments/:id/test'])
// A venue hub (hub/) prints and reports, and at a hub-first location keeps a
// copy of the venue (migration 218): its context, the cloud's log, its events.
const HUB_ROUTES = new Set(['GET /pos-api/me', 'GET /pos-api/config', 'POST /pos-api/print-jobs/claim', 'POST /pos-api/print-jobs/:id/status',
  'POST /pos-api/hub/status', 'POST /pos-api/disconnect', 'GET /pos-api/hub/context', 'GET /pos-api/hub/sync', 'POST /pos-api/hub/events'])
// A collected ticket nobody reported on (the device went off) is collected again.
const CLAIM_STALE = '2 minutes'

const KIND_NAME = { terminal: 'a till', kds: 'a kitchen screen', kiosk: 'a self-order kiosk', hub: 'a venue hub' }

// What a device says about itself with its link code (shown in the installer).
const LinkDeviceInfo = z.object({
  width: z.number().int().min(0).max(20000).optional(),
  height: z.number().int().min(0).max(20000).optional(),
  dpr: z.number().min(0).max(10).optional(),
  ua: z.string().max(300).optional(),
  app_version: z.string().max(40).optional(),
}).partial()
const DEVICE_APPS = ['terminal', 'kds', 'kiosk']

// A venue hub's report (hub/src/service.js report()): what it says about itself.
const HubReport = z.object({
  app_version: z.string().max(40).nullable().optional(),
  printers: z.array(z.object({
    id: UUID,
    online: z.boolean(),
    paper_low: z.boolean().default(false),
    paper_out: z.boolean().default(false),
    cover_open: z.boolean().default(false),
    error: z.string().max(200).nullable().optional(),
  })).max(50).default([]),
  info: z.object({
    hostname: z.string().max(100).nullable().optional(),
    os: z.string().max(120).nullable().optional(),
    platform: z.string().max(20).nullable().optional(),
    arch: z.string().max(20).nullable().optional(),
    node: z.string().max(20).nullable().optional(),
    addresses: z.array(z.string().max(60)).max(20).default([]),
    status_port: z.number().int().min(1).max(65535).nullable().optional(),
    // Hub first (migration 218): the port devices on the venue network use,
    // and how its copy of the venue stands.
    lan_port: z.number().int().min(1).max(65535).nullable().optional(),
    mirror: z.object({
      on: z.boolean().optional(),
      rev: z.number().int().min(0).optional(),
      cloud_seq: z.number().int().min(0).optional(),
      pending: z.number().int().min(0).optional(),
      to_send: z.number().int().min(0).optional(),
      conflicts: z.number().int().min(0).optional(),
      devices: z.number().int().min(0).optional(),
      last_upload_at: z.string().max(40).nullable().optional(),
      last_follow_at: z.string().max(40).nullable().optional(),
      error: z.string().max(200).nullable().optional(),
    }).optional(),
    local_printers: z.array(z.object({
      id: z.string().max(200),
      name: z.string().max(120),
      model: z.string().max(120).nullable().optional(),
      escpos: z.boolean().optional(),
      path: z.string().max(200).nullable().optional(),
    })).max(20).default([]),
    update: z.object({
      updates: z.enum(['auto', 'manual']).optional(),
      available: z.string().max(40).nullable().optional(),
      state: z.string().max(20).optional(),
      error: z.string().max(200).nullable().optional(),
      at: z.string().max(40).nullable().optional(),
    }).optional(),
  }).optional(),
})
// What can show a link code: the apps, and the venue hub (it has no address of its own).
const CODE_APPS = [...DEVICE_APPS, 'hub']

async function requireDevice(req, reply) {
  const m = /^Device ([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,})$/i.exec(req.headers.authorization || '')
  if (!m) return reply.code(401).send({ error: 'This till isn\'t paired', code: 'not_paired' })
  const d = await verifyDevice(m[1], m[2])
  if (!d) return reply.code(401).send({ error: 'This till isn\'t paired (or was removed)', code: 'not_paired' })
  if (!d.pos_enabled) return reply.code(403).send({ error: 'The till is switched off for this restaurant', code: 'pos_off' })
  // A kiosk is a public screen: it reads its own config and sends its own
  // orders, nothing else (no other checks, reports, print queue or sold out).
  const route = req.method + ' ' + (req.routeOptions?.url || req.routerPath)
  if (d.kind === 'kiosk' && !KIOSK_ROUTES.has(route)) {
    return reply.code(403).send({ error: 'A kiosk can\'t do this', code: 'kiosk' })
  }
  if (d.kind === 'hub' && !HUB_ROUTES.has(route)) {
    return reply.code(403).send({ error: 'A venue hub can\'t do this', code: 'hub' })
  }
  req.posDevice = d
  req.tenantId = d.tenant_id
  const pendingHeader = req.headers['x-pos-pending']
  if (pendingHeader != null) {
    const pending = Math.max(0, Math.min(100000, parseInt(pendingHeader, 10) || 0))
    if (lastPending.get(d.id) !== pending) {
      lastPending.set(d.id, pending)
      tenantSql(d.tenant_id)`UPDATE pos_devices SET pending_changes = ${pending}, pending_at = now() WHERE id = ${d.id}`
        .catch(e => req.log.warn({ err: e }, 'pos pending update failed'))
    }
  }
  const seen = lastSeen.get(d.id) || 0
  if (Date.now() - seen > 60_000) {
    lastSeen.set(d.id, Date.now())
    const version = String(req.headers['x-pos-version'] || '').slice(0, 40) || null
    tenantSql(d.tenant_id)`UPDATE pos_devices SET last_seen_at = now(), app_version = COALESCE(${version}, app_version) WHERE id = ${d.id}`
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

/**
 * A till's or kiosk's highest numbers today, as the sequencer saw them
 * (shared/pos/numbers.js), and the open trading day's date: a device counts
 * under that day while it is open (a day not closed by the next morning
 * keeps its numbers going), under its own clock's date once it is closed.
 */
async function deviceNumbers(d) {
  const q = tenantSql(d.tenant_id)
  const [[st], [day]] = await Promise.all([
    q`SELECT device_numbers FROM pos_venue_state WHERE venue_id = ${d.venue_id} AND tenant_id = ${d.tenant_id}`,
    q`SELECT business_date::text AS business_date FROM pos_days WHERE tenant_id = ${d.tenant_id} AND venue_id = ${d.venue_id} AND closed_at IS NULL LIMIT 1`,
  ])
  return { numbers: st?.device_numbers?.[d.id] || null, trading_day: day?.business_date || null }
}

// Not heard from for this long (but today): it may have changes made offline.
const QUIET_MINUTES = 10

/**
 * The venue's other devices that may hold changes not sent yet, for closing
 * the day: those that said so (X-Pos-Pending) and those not heard from lately.
 */
async function devicesWaiting(tx, d) {
  const rows = await tx`
    SELECT id, name, kind, short_code, pending_changes, pending_at, last_seen_at FROM pos_devices
     WHERE tenant_id = ${d.tenant_id} AND venue_id = ${d.venue_id} AND id <> ${d.id}
       AND kind IN ('terminal', 'kiosk', 'kds') AND revoked_at IS NULL AND secret_hash IS NOT NULL
       AND (pending_changes > 0
            OR (last_seen_at < now() - make_interval(mins => ${QUIET_MINUTES}) AND last_seen_at > now() - interval '18 hours'))
     ORDER BY name`
  return rows.map(r => ({
    id: r.id, name: r.name, kind: r.kind, short_code: r.short_code,
    pending: r.pending_changes || 0, last_seen_at: r.last_seen_at,
  }))
}

async function currentDay(tx, tenantId, venueId) {
  const [day] = await tx`
    SELECT id, business_date::text AS business_date, opened_at FROM pos_days
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND closed_at IS NULL LIMIT 1`
  return day || null
}

/**
 * The address a hub installed from this request should use: the till
 * address (pos.<domain>), or the address asked on a local test server.
 */
function hubApi(req) {
  const host = String(req.headers.host || '')
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return req.protocol + '://' + host
  return deviceOrigin('terminal')
}

export default async function posApiRoutes(app) {
  // ── The venue hub's code and installers (no auth; services/hubRelease.js) ──
  // The code holds no secrets (the till app's is public too); a hub checks
  // the download against the sha256 in its own config before using it.
  app.get('/hub/release', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async () => {
    const r = hubRelease()
    return { version: r.version, sha256: r.sha256, size: r.size, url: '/pos-api/hub/release.tgz' }
  })
  app.get('/hub/release.tgz', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const r = hubRelease()
    return reply
      .header('content-type', 'application/gzip')
      .header('content-disposition', `attachment; filename="macaroonie-hub-${r.version.replace(/[^\w.-]/g, '_')}.tgz"`)
      .header('x-hub-version', r.version)
      .header('cache-control', 'no-cache')
      .send(r.buffer)
  })
  for (const kind of ['sh', 'ps1']) {
    app.get('/hub/install.' + kind, { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) =>
      reply.header('content-type', 'text/plain; charset=utf-8').header('cache-control', 'no-cache').send(installScript(kind, hubApi(req))))
  }
  // The files people download on the mini PC (pos.<domain>/hub): a Windows
  // setup file to double-click, and the Linux installer to run with sh.
  for (const [kind, file] of [['cmd', 'macaroonie-hub-setup.cmd'], ['sh', 'macaroonie-hub-setup.sh']]) {
    app.get('/hub/setup.' + kind, { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) =>
      reply
        .header('content-type', 'application/octet-stream')
        .header('content-disposition', `attachment; filename="${file}"`)
        .header('cache-control', 'no-cache')
        .send(installScript(kind, hubApi(req))))
  }
  app.get('/hub/setup', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const ua = String(req.headers['user-agent'] || '')
    return reply
      .header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', 'no-cache')
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
      .send(hubSetupPage({ api: hubApi(req), windowsFirst: /Windows/i.test(ua) || !/Linux|X11/i.test(ua) }))
  })

  // ── Move hand-over (no auth: the one-time code is the key) ───────
  // A device moving to its own address (POST /move below) hands this code
  // to the app there, which pairs as the same device. People never type
  // these: a device is set up by the code it shows (/pairings).
  app.post('/pair', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async req => {
    const body = z.object({
      code: z.string().min(4).max(20),
      // The kind of device the address runs (pos/src/lib/appHost.js); none
      // (a test or local address) takes any kind.
      app: z.enum(DEVICE_APPS).optional(),
      app_version: z.string().max(40).optional(),
      user_agent: z.string().max(300).optional(),
    }).parse(req.body)
    const hash = sha256(normaliseCode(body.code))
    const bad = () => httpError(422, 'That code isn\'t right or has run out: move the device again from its old address, or link it with the code it shows')
    const [found] = await systemSql`
      SELECT id, kind FROM pos_devices
       WHERE pairing_code_hash = ${hash} AND pairing_expires_at > now() AND revoked_at IS NULL`
    if (!found) throw bad()
    // Each kind of device has its own address: a code for a kitchen screen
    // typed on the till's address would leave the kitchen screen running
    // from the wrong place. The code stays usable on the right address.
    if (body.app && found.kind !== body.app) {
      const url = deviceOrigin(found.kind)
      const err = httpError(422, `This code is for ${KIND_NAME[found.kind] || 'another device'}: open ${url.replace(/^https?:\/\//, '')} on this device and type it there`)
      err.code = 'wrong_address'
      err.errors = [{ device_kind: found.kind, url }]
      throw err
    }
    const secret = newDeviceSecret()
    const [d] = await systemSql`
      UPDATE pos_devices
         SET secret_hash = ${sha256(secret)}, pairing_code_hash = NULL, pairing_expires_at = NULL, paired_at = now(),
             last_seen_at = now(), app_version = ${body.app_version ?? null}, user_agent = ${body.user_agent ?? null}
       WHERE id = ${found.id} AND pairing_code_hash = ${hash} AND pairing_expires_at > now() AND revoked_at IS NULL
       RETURNING id, tenant_id, venue_id, kind, name, short_code`
    if (!d) throw bad()
    deviceCache.delete(d.id)
    const [v] = await tenantSql(d.tenant_id)`SELECT name FROM venues WHERE id = ${d.venue_id} AND tenant_id = ${d.tenant_id}`
    return { device_id: d.id, secret, name: d.name, kind: d.kind, short_code: d.short_code, venue_id: d.venue_id, venue_name: v?.name || null }
  })

  // ── Link codes (migration 184; services/linkCodes.js) ───────────
  // The device shows a code and a QR code to the installer app; someone
  // signed in links it (POST /api/pos/venues/:venueId/link). The secret is
  // made here, given to the device only, and kept as its hash.
  // Limits are per address, and a venue's devices share one: room for a
  // dozen being set up at once, each polling every 4 s.
  app.post('/pairings', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async req => {
    const body = z.object({ app: z.enum(CODE_APPS).optional(), device: LinkDeviceInfo.optional() }).parse(req.body || {})
    const secret = newDeviceSecret()
    await systemSql`DELETE FROM pos_pairings WHERE expires_at < now() - interval '1 day'`
    for (let i = 0; i < 6; i++) {
      const code = newLinkCode()
      const hash = linkCodeHash(code)
      if (await linkCodeTaken(systemSql, hash)) continue
      const [row] = await systemSql`
        INSERT INTO pos_pairings (code_hash, secret_hash, app, device_info, expires_at)
        VALUES (${hash}, ${sha256(secret)}, ${body.app ?? null}, ${systemSql.json(body.device || {})},
                now() + make_interval(mins => ${LINK_MINUTES}))
        ON CONFLICT (code_hash) DO NOTHING
        RETURNING id, expires_at`
      if (row) return { id: row.id, code, secret, expires_at: row.expires_at, link_url: linkUrl(code) }
    }
    throw httpError(503, 'Couldn\'t make a code, try again')
  })

  app.get('/pairings/:id', { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!UUID.safeParse(req.params.id).success) throw httpError(404, 'Not found')
    const m = /^Pairing ([A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization || '')
    const [p] = await systemSql`SELECT id, secret_hash, expires_at, device_id FROM pos_pairings WHERE id = ${req.params.id}`
    if (!p || !m || !sameHash(sha256(m[1]), p.secret_hash)) return reply.code(404).send({ error: 'Not found', status: 'expired' })
    if (p.device_id) {
      const [d] = await systemSql`
        SELECT d.id, d.venue_id, d.kind, d.name, d.short_code, d.secret_hash, d.revoked_at, v.name AS venue_name
          FROM pos_devices d JOIN venues v ON v.id = d.venue_id AND v.tenant_id = d.tenant_id
         WHERE d.id = ${p.device_id}`
      // Linked, and still with this code's secret (not linked again or removed since).
      if (d && !d.revoked_at && sameHash(d.secret_hash, p.secret_hash)) {
        return { status: 'paired', device_id: d.id, name: d.name, kind: d.kind, short_code: d.short_code, venue_id: d.venue_id, venue_name: d.venue_name }
      }
      return { status: 'expired' }
    }
    if (new Date(p.expires_at) <= new Date()) return { status: 'expired' }
    return { status: 'waiting', expires_at: p.expires_at }
  })

  // The kiosk design editor's live preview (Store tech > Kiosks): the link
  // the admin made is the key (services/kioskSvc.js, 12 hours). A preview
  // never places orders; the editor sends unsaved changes to the preview
  // itself (postMessage), so this only gives the menu and the saved design.
  app.get('/kiosk-preview', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async req => {
    const p = await readPreviewToken(req.query.token)
    if (!p) throw httpError(401, 'This preview link has run out: open the preview again from Store tech')
    return withTenant(p.tenantId, async tx => {
      const device = previewDevice(p)
      const [d] = await tx`SELECT id FROM kiosk_designs WHERE id = ${p.designId} AND tenant_id = ${p.tenantId}`
      if (!d) throw httpError(404, 'Kiosk design not found')
      return kioskConfig(tx, p.tenantId, p.venueId, device, { preview: true, menuVersion: p.menuVersion })
    })
  })

  // A kiosk design's lasting link for people outside the group (Share in the
  // kiosk designer, migration 187). The token is the key: found in system
  // mode (it names its tenant), then everything else in that tenant. Like the
  // editor's preview it never places an order; the app ignores design
  // messages in this mode, so what is shown is the design as saved.
  app.get('/kiosk-share', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async req => {
    const token = String(req.query.token || '')
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw httpError(404, 'This preview link isn\'t right: check you have all of it')
    const [d] = await systemSql`
      SELECT id, tenant_id, name, share_venue_id, share_stream_id, share_menu, share_expires_at
        FROM kiosk_designs WHERE share_token = ${token}`
    if (!d) throw httpError(404, 'This preview link doesn\'t work any more: ask for a new one')
    if (d.share_expires_at && new Date(d.share_expires_at) <= new Date()) throw httpError(410, 'This preview link has run out: ask for a new one')
    if (!d.share_venue_id) throw httpError(404, 'This preview isn\'t set up any more: ask for a new link')
    const out = await withTenant(d.tenant_id, async tx => {
      const [v] = await tx`SELECT v.name, t.name AS company FROM venues v JOIN tenants t ON t.id = v.tenant_id WHERE v.id = ${d.share_venue_id} AND v.tenant_id = ${d.tenant_id}`
      if (!v) throw httpError(404, 'This preview isn\'t set up any more: ask for a new link')
      const device = previewDevice({ designId: d.id, streamId: d.share_stream_id })
      const config = await kioskConfig(tx, d.tenant_id, d.share_venue_id, device, { preview: true, menuVersion: d.share_menu })
      await tx`UPDATE kiosk_designs SET share_views = share_views + 1, share_last_viewed_at = now() WHERE id = ${d.id} AND tenant_id = ${d.tenant_id}`
      return { ...config, share: { design: d.name, venue: v.name, company: v.company, expires_at: d.share_expires_at, menu: config.menu_version } }
    })
    return out
  })

  // The kitchen test bench (Store tech > Kitchen screens > Test the kitchen):
  // the link the admin made is the key (8 hours). It only reads the venue's
  // kitchen setup and dishes; the bench runs its pretend kitchen in the
  // browser, so test orders never reach the real screens or the reports.
  app.get('/kitchen-test', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async req => {
    const p = await readKitchenTestToken(req.query.token)
    if (!p) throw httpError(401, 'This test link has run out: open Test the kitchen again from Store tech')
    const data = await withTenant(p.tenantId, tx => kitchenTestData(tx, p.tenantId, p.venueId))
    return { ...data, expires_at: p.expiresAt }
  })

  app.register(async scoped => {
    scoped.addHook('preHandler', requireDevice)

    // The device forgets its pairing (Disconnect in its settings). Its row
    // stays, with its name and settings: linking a device showing a code to
    // it (Store tech or the installer) sets it up again.
    scoped.post('/disconnect', async req => {
      const d = req.posDevice
      await tenantSql(d.tenant_id)`
        UPDATE pos_devices SET secret_hash = NULL, pairing_code_hash = NULL, pairing_expires_at = NULL
         WHERE id = ${d.id} AND tenant_id = ${d.tenant_id}`
      deviceCache.delete(d.id)
      return { ok: true }
    })

    // Guests' visits a kiosk recorded (migration 208, pos/src/kiosk/journey.js):
    // stored once each (the kiosk's own id), summed up on arrival. The reply's
    // accepted are the visits the kiosk can forget.
    scoped.post('/kiosk/journeys', { bodyLimit: 8 * 1024 * 1024, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async req => {
      const d = req.posDevice
      if (d.kind !== 'kiosk') throw httpError(403, 'Only a self-order kiosk records visits')
      const { sessions } = z.object({ sessions: z.array(z.record(z.any())).min(1).max(MAX_VISITS) }).parse(req.body)
      return saveVisits(d, sessions)
    })

    // The receipt of an order the kiosk just placed (migration 209,
    // services/receiptSvc.js): its page's link for the QR code on the order
    // done screen, and with an email address the receipt sent there (or, for
    // an order paid at the counter, sent once the till takes payment).
    // Loyalty (migration 211): look members up, take rewards out, put them back.
    loyaltyDeviceRoutes(scoped)

    scoped.post('/kiosk/receipts', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async req => {
      const d = req.posDevice
      if (d.kind !== 'kiosk') throw httpError(403, 'Only a self-order kiosk gives guests receipts this way')
      const body = z.object({ check_id: z.string().min(1).max(64), email: z.string().max(254).nullable().optional() }).parse(req.body)
      return kioskReceipt(d, body)
    })

    // A kitchen screen or kiosk paired before it had its own address moves
    // there: a one-time code for its address, typed in for it by the app
    // (pos/src/lib/appHost.js). The old copy's secret works until the code is
    // used, so a move that never arrives can be tried again.
    scoped.post('/move', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async req => {
      const d = req.posDevice
      if (!DEVICE_APPS.includes(d.kind)) throw httpError(422, 'This device has no address of its own')
      const code = await withTenant(d.tenant_id, tx => openPairing(tx, d.tenant_id, d.id, 10))
      deviceCache.delete(d.id)
      return { url: deviceOrigin(d.kind) + '/#pair=' + encodeURIComponent(code), code, kind: d.kind }
    })

    scoped.get('/me', async req => {
      const d = req.posDevice
      const [v] = await tenantSql(d.tenant_id)`SELECT name, timezone FROM venues WHERE id = ${d.venue_id} AND tenant_id = ${d.tenant_id}`
      return { device_id: d.id, name: d.name, kind: d.kind, short_code: d.short_code, settings: d.settings || {}, venue_id: d.venue_id, venue_name: v?.name, timezone: v?.timezone }
    })

    scoped.get('/config', async req => {
      const d = req.posDevice
      const [own] = await tenantSql(d.tenant_id)`SELECT name, short_code, settings FROM pos_devices WHERE id = ${d.id} AND tenant_id = ${d.tenant_id}`
      const device = { id: d.id, kind: d.kind, name: own?.name, short_code: own?.short_code, settings: own?.settings || {} }
      // A kitchen screen gets the kitchen's config (no menus, no PINs). Its
      // own settings count towards the version, so a change made in Till
      // setup reaches it. A kiosk gets its menus, design and languages
      // (services/kioskSvc.js), no staff and no PINs.
      const config = d.kind === 'hub'
        ? await withTenant(d.tenant_id, tx => hubConfig(tx, d.tenant_id, d.venue_id, d.id))
        : d.kind === 'kds'
        ? await withTenant(d.tenant_id, async tx => {
          const c = await kdsConfig(tx, d.tenant_id, d.venue_id)
          return { ...c, version: c.version + '.' + sha256(JSON.stringify(device)).slice(0, 8) }
        })
        : d.kind === 'kiosk'
          ? await withTenant(d.tenant_id, tx => kioskConfig(tx, d.tenant_id, d.venue_id, device))
          : await withTenant(d.tenant_id, async tx => {
            const c = await tillConfig(tx, d.tenant_id, d.venue_id)
            // The till's card machine (migration 193) counts towards the version.
            const card = await cardMachineOf(tx, d.tenant_id, d.venue_id, device.settings.card_reader)
            return { ...c, card_machine: card, version: card ? c.version + '.' + sha256(JSON.stringify(card)).slice(0, 8) : c.version }
          })
      // Sold out and the prices stamp (liveFields()) aren't in the version:
      // an unchanged reply still carries them.
      // A till's or kiosk's own numbers today (shared/pos/numbers.js): not in
      // the version either, so a device that lost its storage carries on.
      const numbers = d.kind === 'terminal' || d.kind === 'kiosk' ? await deviceNumbers(d) : {}
      // Hub first (migration 218): where the venue hub is and this device's
      // key for it, outside the version too (the hub's address may move).
      const hub = HUB_DEVICE_KINDS.includes(d.kind)
        ? { hub: await withTenant(d.tenant_id, tx => hubFor(tx, d.tenant_id, d.venue_id, { kind: 'device', id: d.id, secretHash: d.secret_hash })) }
        : {}
      if (req.query.version && req.query.version === config.version) {
        return { unchanged: true, version: config.version, ...(config.prices ? { sold_out: config.sold_out, prices: config.prices } : {}), ...numbers, ...hub }
      }
      return { ...config, device, ...numbers, ...hub }
    })

    // What changes during service (a till or kiosk asks every 30 s): dishes
    // sold out now and the prices stamp. A stamp other than its config's
    // means prices changed: the device fetches the config (services/posSvc.js liveFields()).
    scoped.get('/live', async req => {
      const d = req.posDevice
      if (d.kind !== 'terminal' && d.kind !== 'kiosk') throw httpError(403, 'Only tills and kiosks ask for this', { code: 'kind' })
      return withTenant(d.tenant_id, tx => liveFields(tx, d.tenant_id, d.venue_id))
    })

    // Kitchen orders since a sequence number (a kitchen screen, or a till
    // showing what is ready). shared/pos/kitchen.js has their shape.
    scoped.get('/kitchen/sync', async req => {
      const d = req.posDevice
      const since = fromSource(req) ? Math.max(0, Number(req.query.since) || 0) : 0
      return { ...(await withTenant(d.tenant_id, tx => kitchenSync(tx, d.tenant_id, d.venue_id, since))), source: 'cloud' }
    })

    // The kitchen screen's flow button: dishes sent from now follow the flow
    // put in use, dishes already sent keep their way. Online only (the
    // sequencer routes dishes); every screen at the venue gets pos.config.
    scoped.put('/kitchen/flow', async req => {
      const d = req.posDevice
      if (d.kind !== 'kds') throw httpError(403, 'Only a kitchen screen can switch the kitchen flow')
      const { flow_id } = z.object({ flow_id: UUID }).parse(req.body)
      const out = await withTenant(d.tenant_id, async tx => {
        const [own] = await tx`SELECT name, settings FROM pos_devices WHERE id = ${d.id} AND tenant_id = ${d.tenant_id}`
        if (own?.settings?.can_switch_flow === false) {
          throw httpError(403, 'This screen can\'t switch the kitchen flow: it can be allowed in Store tech, Kitchen screens')
        }
        return switchFlow(tx, d.tenant_id, d.venue_id, flow_id, own?.name || 'A kitchen screen')
      })
      if (out.changed) broadcast('pos:' + d.venue_id, { type: 'pos.config' })
      return out
    })

    // Sold out: the signed-in person's role needs sold_out (or approved_by
    // names someone whose role has it). Online only: it changes what the
    // website, the orders board and the menu screens show straight away.
    scoped.put('/sold-out/:itemId', async req => {
      const d = req.posDevice
      if (!UUID.safeParse(req.params.itemId).success) throw httpError(404, 'Dish not found')
      const b = z.object({
        sold_out: z.union([z.literal('today'), z.literal('indefinite'), z.literal(false)]),
        staff_id: UUID,
        approved_by: UUID.nullable().optional(),
      }).parse(req.body)
      const { venue, res, ids } = await withTenant(d.tenant_id, async tx => {
        const staff = await loadTillStaff(tx, d.tenant_id, d.venue_id, { signIn: true })
        const problem = permissionProblem(Object.fromEntries(staff.map(s => [s.id, s])),
          { staff_id: b.staff_id, approved_by: b.approved_by || null }, 'sold_out')
        if (problem) throw httpError(403, problem)
        const [venue] = await tx`SELECT id, tenant_id, timezone FROM venues WHERE id = ${d.venue_id} AND tenant_id = ${d.tenant_id}`
        if (!venue) throw httpError(404, 'Venue not found')
        const res = await setSoldOut(tx, venue, req.params.itemId, b.sold_out)
        return { venue, res, ids: await soldOutItemIds(tx, d.tenant_id, venue.id) }
      })
      announceSoldOut(venue.id, req.params.itemId, res, ids)
      return res
    })

    // ── Card machines (migration 193, services/cardSvc.js) ─────────
    // The device asks, the server drives the card machine through its
    // provider and keeps the attempt; the payment reaches the check only as
    // payment.added naming the approved attempt (shared/pos/cards.js).
    scoped.post('/card/payments', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async req => {
      const d = req.posDevice
      if (!['terminal', 'kiosk'].includes(d.kind)) throw httpError(403, 'Only a till or a kiosk takes card payments')
      const b = z.object({
        check_id: CHECK_ID.nullable().optional(),
        payment_id: CHECK_ID,
        amount: z.number().int().min(1).max(10_000_000),
        tip: z.number().int().min(0).max(1_000_000).default(0),
        staff_id: UUID.nullable().optional(),
      }).parse(req.body)
      if (d.kind === 'kiosk' && b.tip) throw httpError(422, 'A kiosk takes no tips')
      const [own] = await withTenant(d.tenant_id, tx => tx`SELECT settings FROM pos_devices WHERE id = ${d.id} AND tenant_id = ${d.tenant_id}`)
      const device = { ...d, settings: own?.settings || {} }
      return startSale(device, { ...b, reference: d.kind === 'kiosk' ? 'Kiosk ' + (d.short_code || d.name || '') : (d.name || 'Till') })
    })

    scoped.get('/card/payments', async req => {
      const d = req.posDevice
      const check = req.query.check_id ? CHECK_ID.parse(req.query.check_id) : null
      return devicePayments(d, { check_id: check })
    })

    scoped.get('/card/payments/:id', async req => {
      const d = req.posDevice
      if (!UUID.safeParse(req.params.id).success) throw httpError(404, 'Card payment not found')
      const row = await devicePayment(d, req.params.id)
      if (d.kind === 'kiosk' && row.device_id !== d.id) throw httpError(404, 'Card payment not found')
      return paymentView(await refreshPayment(d.tenant_id, row.id))
    })

    scoped.post('/card/payments/:id/cancel', async req => {
      const d = req.posDevice
      if (!UUID.safeParse(req.params.id).success) throw httpError(404, 'Card payment not found')
      const row = await devicePayment(d, req.params.id)
      if (d.kind === 'kiosk' && row.device_id !== d.id) throw httpError(404, 'Card payment not found')
      return cancelSale(d, row.id)
    })

    scoped.post('/card/payments/:id/signature', async req => {
      const d = req.posDevice
      if (!UUID.safeParse(req.params.id).success) throw httpError(404, 'Card payment not found')
      const { accepted } = z.object({ accepted: z.boolean() }).parse(req.body)
      return answerSignature(d, req.params.id, accepted)
    })

    scoped.post('/card/payments/:id/test', async req => {
      const d = req.posDevice
      if (!UUID.safeParse(req.params.id).success) throw httpError(404, 'Card payment not found')
      const { result } = z.object({ result: z.enum(['approve', 'decline']) }).parse(req.body)
      const row = await devicePayment(d, req.params.id)
      if (d.kind === 'kiosk' && row.device_id !== d.id) throw httpError(404, 'Card payment not found')
      return simulateSale(d, row.id, result)
    })

    // Money back to the card: a refund (role permission refund) or taking a
    // card payment off an open check (permission void). The till records
    // refund.added / payment.voided naming the approved refund afterwards.
    scoped.post('/card/refunds', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async req => {
      const d = req.posDevice
      if (d.kind !== 'terminal') throw httpError(403, 'Only a till refunds')
      const b = z.object({
        sale_id: UUID,
        check_id: CHECK_ID,
        refund_id: CHECK_ID,
        amount: z.number().int().min(1).max(10_000_000),
        staff_id: UUID,
        approved_by: UUID.nullable().optional(),
        purpose: z.enum(['refund', 'void']).default('refund'),
      }).parse(req.body)
      await withTenant(d.tenant_id, async tx => {
        const staff = await loadTillStaff(tx, d.tenant_id, d.venue_id, { signIn: true })
        const problem = permissionProblem(Object.fromEntries(staff.map(s => [s.id, s])),
          { staff_id: b.staff_id, approved_by: b.approved_by || null }, b.purpose)
        if (problem) throw httpError(403, problem)
      })
      return startRefund(d, b)
    })

    scoped.get('/sync', async req => {
      const d = req.posDevice
      const since = fromSource(req) ? Math.max(0, Number(req.query.since) || 0) : 0
      return withTenant(d.tenant_id, async tx => {
        const [st] = await tx`SELECT last_seq, device_numbers FROM pos_venue_state WHERE venue_id = ${d.venue_id} AND tenant_id = ${d.tenant_id}`
        const seq = Number(st?.last_seq || 0)
        const day = await currentDay(tx, d.tenant_id, d.venue_id)
        const extra = { source: 'cloud', day, presence: presenceFor(d.venue_id), server_time: new Date().toISOString(), numbers: st?.device_numbers?.[d.id] || null }
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
      return takeEvents(req, d, events.map(raw => ({ raw, device: d })))
    })

    scoped.get('/checks', async req => {
      const d = req.posDevice
      const q = z.object({ status: z.enum(['open', 'closed', 'void']).default('closed'), limit: z.coerce.number().int().min(1).max(200).default(60) }).parse(req.query)
      return withTenant(d.tenant_id, tx => tx`
        SELECT id, number, number_code, order_no, mode, table_id, tab_name, covers, server_id, status, opened_at, closed_at, total, paid, refunded, day_id
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
          if (!day) return { day: null, figures: dayFigures([], null), waiting: await devicesWaiting(tx, d) }
          dayId = day.id
          return { ...(await dayReport(tx, d.tenant_id, d.venue_id, dayId)), waiting: await devicesWaiting(tx, d) }
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

    // Take queued jobs for printing: a venue hub the network printers', a
    // till or kitchen screen the ones plugged into it (pos_printers.connection,
    // migration 191). A job collected but never reported on is collected again.
    scoped.post('/print-jobs/claim', async req => {
      const d = req.posDevice
      if (!['hub', 'terminal', 'kds'].includes(d.kind)) throw httpError(403, 'This device doesn\'t print tickets')
      const body = z.object({ limit: z.number().int().min(1).max(50).default(20) }).parse(req.body || {})
      return withTenant(d.tenant_id, tx => tx`
        UPDATE pos_print_jobs SET status = 'printing', claimed_by = ${d.id}, claimed_at = now(), attempts = attempts + 1
         WHERE id IN (
           SELECT j.id FROM pos_print_jobs j
             JOIN pos_printers p ON p.id = j.printer_id AND p.tenant_id = j.tenant_id AND p.venue_id = j.venue_id
            WHERE j.tenant_id = ${d.tenant_id} AND j.venue_id = ${d.venue_id}
              AND (j.status = 'queued' OR (j.status = 'printing' AND j.claimed_at < now() - ${CLAIM_STALE}::interval))
              AND (${d.kind === 'hub'} AND p.connection = 'hub' OR p.connection = 'device' AND p.device_id = ${d.id})
            ORDER BY j.created_at LIMIT ${body.limit} FOR UPDATE OF j SKIP LOCKED)
        RETURNING id, printer_id, kind, title, ops, check_id, created_at`)
    })

    scoped.post('/print-jobs/:id/status', async req => {
      const d = req.posDevice
      const id = UUID.parse(req.params.id)
      const body = z.object({ status: z.enum(['printed', 'failed', 'cancelled']), error: z.string().max(300).nullable().optional() }).parse(req.body)
      // The device that collected it reports on it; a waiting one can be
      // marked printed from a till (printed there by hand, its printer down).
      const [row] = await withTenant(d.tenant_id, tx => tx`
        UPDATE pos_print_jobs
           SET status = ${body.status}, error = ${body.error ?? null},
               printed_at = ${body.status === 'printed' ? new Date() : null}
         WHERE id = ${id} AND tenant_id = ${d.tenant_id} AND venue_id = ${d.venue_id}
           AND (claimed_by = ${d.id} OR status = 'queued' AND ${d.kind === 'terminal'})
         RETURNING id, status`)
      if (!row) throw httpError(404, 'Print job not found')
      return row
    })

    // A venue hub's report (every minute): its version, how each of its
    // printers is (network printers and the USB printers plugged into it),
    // and what it says about itself (migration 195: computer, USB printers
    // found, updates), shown in Store tech -> Printers.
    scoped.post('/hub/status', async req => {
      const d = req.posDevice
      if (d.kind !== 'hub') throw httpError(403, 'Only a venue hub reports printers')
      const body = HubReport.parse(req.body || {})
      let latest = null
      try { latest = hubRelease().version } catch { /* no release on this server */ }
      await withTenant(d.tenant_id, async tx => {
        await tx`UPDATE pos_devices
                    SET last_seen_at = now(), app_version = COALESCE(${body.app_version ?? null}, app_version),
                        info = COALESCE(${body.info ? tx.json(body.info) : null}, info),
                        info_at = CASE WHEN ${!!body.info} THEN now() ELSE info_at END,
                        update_requested_at = CASE WHEN ${!!latest && body.app_version === latest} THEN NULL ELSE update_requested_at END
                  WHERE id = ${d.id} AND tenant_id = ${d.tenant_id}`
        for (const p of body.printers) {
          const status = { online: p.online, paper_low: p.paper_low, paper_out: p.paper_out, cover_open: p.cover_open, error: p.error ?? null }
          await tx`
            UPDATE pos_printers SET status = ${tx.json(status)}, status_at = now()
             WHERE id = ${p.id} AND tenant_id = ${d.tenant_id} AND venue_id = ${d.venue_id}
               AND (connection = 'hub' OR connection = 'device' AND device_id = ${d.id})`
        }
      })
      return { ok: true }
    })

    // ── Hub first (migration 218, docs/POS.md section 11) ──

    // What the hub decides with (services/hubFirstSvc.js hubContext()):
    // unchanged: true when its version matches.
    scoped.get('/hub/context', async req => {
      const d = req.posDevice
      if (d.kind !== 'hub') throw httpError(403, 'Only a venue hub asks for this')
      const ctx = await withTenant(d.tenant_id, tx => hubContext(tx, d.tenant_id, d.venue_id, d.id))
      if (req.query.version && req.query.version === ctx.version) return { unchanged: true, version: ctx.version }
      return ctx
    })

    // The cloud's log and state since the hub's last look (hubSync()).
    scoped.get('/hub/sync', async req => {
      const d = req.posDevice
      if (d.kind !== 'hub') throw httpError(403, 'Only a venue hub asks for this')
      const since = Math.max(0, Number(req.query.since) || 0)
      return withTenant(d.tenant_id, tx => hubSync(tx, d.tenant_id, d.venue_id, since, presenceFor(d.venue_id)))
    })

    // The events the hub decided first, in its order, each for the device that
    // made it: decided again here with the same device rules as POST /events,
    // at the hub's time. hub_printed: the hub printed the tickets (they are
    // kept as printed). rejections: changes the hub refused itself, for the
    // managers' Refused changes list.
    scoped.post('/hub/events', { bodyLimit: 4 * 1024 * 1024 }, async req => {
      const d = req.posDevice
      if (d.kind !== 'hub') throw httpError(403, 'Only a venue hub sends events for other devices')
      const body = z.object({
        events: z.array(z.record(z.any())).max(MAX_BATCH).default([]),
        rejections: z.array(z.object({
          event: z.record(z.any()),
          error: z.string().max(300),
          code: z.string().max(40).nullable().optional(),
        })).max(MAX_BATCH).default([]),
      }).parse(req.body || {})
      const rows = await withTenant(d.tenant_id, tx => tx`
        SELECT id, tenant_id, venue_id, kind, name, short_code, revoked_at FROM pos_devices
         WHERE tenant_id = ${d.tenant_id} AND venue_id = ${d.venue_id} AND kind = ANY(${HUB_DEVICE_KINDS}::text[])`)
      const devices = new Map(rows.map(r => [r.id, r]))
      const items = []
      const refused = []
      for (const raw of body.events) {
        const dev = devices.get(raw.device_id)
        // A device removed after it made the change still counts (the sale happened).
        if (!dev || (dev.revoked_at && hubTime(raw.hub_at) > dev.revoked_at)) {
          refused.push({ id: raw.id, ok: false, error: 'This device isn\'t one of the location\'s', code: 'device' })
          continue
        }
        items.push({ raw, device: dev })
      }
      const out = items.length ? await takeEvents(req, d, items, { hubId: d.id, kiosks: rows.filter(r => r.kind === 'kiosk') }) : { results: [], seq: null, checks: [], kitchen: [] }
      if (body.rejections.length) {
        await withTenant(d.tenant_id, async tx => {
          for (const { event: e, error, code } of body.rejections) {
            const dev = devices.get(e.device_id)
            if (!dev || typeof e.id !== 'string' || !e.id || e.id.length > 64) continue
            await tx`
              INSERT INTO pos_event_rejections (id, tenant_id, venue_id, check_id, device_id, staff_id, type, payload, client_at, error, code, hub_id)
              VALUES (${e.id}, ${d.tenant_id}, ${d.venue_id}, ${typeof e.check_id === 'string' ? e.check_id.slice(0, 64) : null}, ${dev.id},
                      ${UUID.safeParse(e.staff_id).success ? e.staff_id : null}, ${String(e.type || 'unknown').slice(0, 60)},
                      ${tx.json(e.payload && typeof e.payload === 'object' ? e.payload : {})}, ${validTime(e.client_at)}, ${error}, ${code ?? null}, ${d.id})
              ON CONFLICT (id) DO NOTHING`
          }
        })
      }
      const byId = new Map(out.results.map(r => [r.id, r]))
      return { ...out, results: body.events.map(e => byId.get(e.id) || refused.find(r => r.id === e.id)).filter(Boolean) }
    })
  })
}

const fromSource = req => !req.query.source || req.query.source === 'cloud'

function validTime(v) {
  const t = v ? new Date(v) : null
  return t && !Number.isNaN(t.getTime()) ? t.toISOString() : null
}

/**
 * Events for the venue's sequencer, in order: a device's own (POST /events)
 * or a venue hub's for its devices (POST /hub/events, `hubId`). The device
 * rules apply (deviceEvent(): each event belongs to its device whatever it
 * says, online orders reach the kitchen from the server only, a kiosk only
 * sends its own check events, nobody else acts as a kiosk), then the
 * sequencer decides it. After the batch: the venue's
 * devices are told, kitchen and loyalty follow-ups run.
 */
async function takeEvents(req, from, items, { hubId = null, kiosks = null } = {}) {
  const seqr = sequencer(from.tenant_id, from.venue_id, { deviceId: from.id, hubId })
  const results = []
  const byDevice = new Map()
  const changed = {}
  const kitchen = {}
  const kinds = new Set()
  let accepted = 0
  let printing = false
  let kioskIds = kiosks ? new Set(kiosks.map(k => k.id)) : null
  for (const { raw, device: d } of items) {
    // The device rules (shared/pos/deviceRules.js), the same at the venue hub.
    if (d.kind !== 'kiosk' && raw.staff_id && kioskIds === null) {
      kioskIds = new Set((await withTenant(from.tenant_id, tx => tx`
        SELECT id FROM pos_devices WHERE tenant_id = ${from.tenant_id} AND venue_id = ${from.venue_id} AND kind = 'kiosk'`)).map(r => r.id))
    }
    const ruled = deviceEvent(raw, d, from.venue_id, kioskIds)
    if (!ruled.event) {
      results.push({ id: raw.id, ok: false, error: ruled.error, code: ruled.code })
      continue
    }
    const e = ruled.event
    seqr.opts.deviceId = d.id
    seqr.opts.printed = !!(hubId && raw.hub_printed)
    const r = await seqr.submit(e, { now: hubId ? hubTime(raw.hub_at) : new Date() })
    if (!byDevice.has(d.id)) byDevice.set(d.id, { device: d, results: [] })
    byDevice.get(d.id).results.push(r)
    if (r.jobs?.length && !r.duplicate && !seqr.opts.printed) printing = true
    if (r.ok) {
      if (!r.duplicate) accepted++
      for (const [id, c] of Object.entries(r.checks || {})) { changed[id] = c; kinds.add('checks') }
      for (const [id, o] of Object.entries(r.kitchen || {})) { kitchen[id] = o; kinds.add('kitchen') }
      results.push({ id: e.id, ok: true, seq: r.seq, duplicate: !!r.duplicate, assigned: r.event?.assigned || null })
      if (e.type === 'day.closed' && !r.duplicate) afterZ(req, d, r.event.assigned?.day_id)
    } else {
      results.push({ id: e.id, ok: false, error: r.error, code: r.code, duplicate: !!r.duplicate })
    }
  }
  const [st] = await withTenant(from.tenant_id, tx => tx`SELECT last_seq FROM pos_venue_state WHERE venue_id = ${from.venue_id} AND tenant_id = ${from.tenant_id}`)
  const seq = Number(st?.last_seq || 0)
  if (accepted) {
    broadcast('pos:' + from.venue_id, { type: 'pos.seq', seq, from: from.id, kinds: kinds.size ? [...kinds] : ['checks'] })
    if (kinds.has('kitchen')) broadcast('screens:' + from.venue_id, { type: 'kitchen.board' })
  }
  // Tickets to print: whoever prints for those printers collects them now.
  if (printing) broadcast('pos:' + from.venue_id, { type: 'pos.print' })
  for (const { device, results: rs } of byDevice.values()) afterKitchen(req, device, rs)
  // A check that was paid or cancelled may have a kiosk receipt waiting to
  // be emailed (migration 210). The minute sweep catches anything missed.
  if (Object.values(changed).some(c => c?.status && c.status !== 'open')) {
    sendWaitingReceipts({ tenantId: from.tenant_id, venueId: from.venue_id, log: req.log })
      .catch(err => req.log.warn({ err }, 'kiosk receipts after payment failed'))
  }
  // Loyalty on the checks that changed: rewards used or put back, points
  // and stamps worked out again (migration 211; the minute sweep catches
  // anything missed).
  settleChangedChecks(from.tenant_id, from.venue_id, changed, req.log)
  return { results, seq, checks: Object.values(changed), kitchen: Object.values(kitchen) }
}

/**
 * After kitchen events: an online order the kitchen finished becomes ready
 * (the guest's "ready" email goes out), one handed over becomes collected,
 * when the venue wants it (pos_settings.kds_online_ready). A GloriaFood order
 * (migration 178) moves on the Online orders board the same way (our board
 * status only). Never fails the events.
 */
function afterKitchen(req, device, results) {
  const moves = onlineMoves(results)
  if (!moves.length) return
  ;(async () => {
    const [s] = await withTenant(device.tenant_id, tx => tx`
      SELECT kds_online_ready FROM pos_settings WHERE venue_id = ${device.venue_id} AND tenant_id = ${device.tenant_id}`)
    if (s && s.kds_online_ready === false) return
    let gfMoved = false
    for (const m of moves) {
      try {
        if (m.source === 'gloriafood') {
          const from = m.status === 'ready' ? ['accepted', 'preparing'] : ['accepted', 'preparing', 'ready']
          const [g] = await withTenant(device.tenant_id, tx => tx`
            UPDATE gloriafood_orders
               SET board_status = ${m.status}, board_status_by = ${'Kitchen screen ' + device.name},
                   board_status_at = now(), updated_at = now()
             WHERE id = ${m.order_id} AND tenant_id = ${device.tenant_id} AND venue_id = ${device.venue_id}
               AND status = 'accepted' AND received_via <> 'import' AND board_status = ANY(${from}::text[])
            RETURNING id`)
          if (g) gfMoved = true
          continue
        }
        const [o] = await withTenant(device.tenant_id, tx => tx`
          SELECT status FROM orders WHERE id = ${m.order_id} AND tenant_id = ${device.tenant_id} AND venue_id = ${device.venue_id}`)
        if (!o) continue
        const from = o.status
        if (m.status === 'ready' && !['accepted', 'preparing'].includes(from)) continue
        if (m.status === 'completed' && from !== 'ready') continue
        await changeStatus(device.tenant_id, m.order_id, m.status, { actor: 'Kitchen screen ' + device.name })
      } catch (err) {
        req.log.warn({ err, order: m.order_id }, 'kitchen: online order status change failed')
      }
    }
    if (gfMoved) broadcast(device.venue_id, { type: 'order.updated', source: 'gloriafood' })
  })().catch(err => req.log.warn({ err }, 'kitchen: online order moves failed'))
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

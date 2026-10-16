// src/config/ws.js
// WebSocket server attached to the Fastify HTTP server.
// Authenticates connections via JWT query param.
// Rooms are keyed by venue_id — each admin client subscribes to one venue.
// Broadcasts: booking.created | booking.updated | booking.deleted
//
// Usage from route handlers / webhook:
//   import { broadcast } from '../config/ws.js'
//   broadcast(venueId, { type: 'booking.created', data: booking })

//
// The API runs as several processes (PM2 cluster), and a client's socket is
// held by one of them. broadcast() delivers to this process's sockets and
// publishes on Redis; every other process relays it to its own sockets. If
// Redis is down, only this process's clients hear it (polling covers the rest).

import { WebSocketServer } from 'ws'
import IORedis from 'ioredis'
import { sql } from './db.js'
import { env } from './env.js'
import { isMember } from '../services/membershipSvc.js'
import { verifyDevice } from '../routes/posApi.js'
import { verifyScreen } from '../services/screenAuth.js'

const CLAIM_NS = 'https://macaroonie.com/claims/'

// Map<venueId, Set<WebSocket>>
const rooms = new Map()

let wss = null

// ── Cross-process relay ──────────────────────────────────────
const CHANNEL = 'macaroonie:ws'
const ORIGIN  = `${process.pid}-${Math.random().toString(36).slice(2, 10)}`
let pub = null

function startRelay() {
  if (pub || !env.REDIS_URL) return
  let warned = false
  const quiet = err => {
    if (!warned) console.warn('[ws] Redis relay unavailable, live updates reach this process only:', err.message)
    warned = true
  }
  // Publishes fail fast while Redis is down rather than queue stale messages.
  pub = new IORedis(env.REDIS_URL, { enableOfflineQueue: false, maxRetriesPerRequest: 1 })
  const sub = new IORedis(env.REDIS_URL)
  pub.on('error', quiet)
  sub.on('error', quiet)
  pub.on('ready', () => { warned = false })
  sub.subscribe(CHANNEL).catch(quiet)
  sub.on('message', (_channel, raw) => {
    let m
    try { m = JSON.parse(raw) } catch { return }
    if (!m || m.origin === ORIGIN || typeof m.room !== 'string') return
    deliver(m.room, m.payload)
  })
}

/**
 * Attach WS server to an existing Fastify server instance.
 * Call once from server.js after app.listen().
 */
export function attachWss(httpServer, jwtVerify) {
  startRelay()
  wss = new WebSocketServer({ server: httpServer, path: '/ws' })

  wss.on('connection', async (ws, req) => {
    const url    = new URL(req.url, `http://localhost`)

    // A paired till (docs/POS.md): /ws?pos_device=<id>&secret=<secret>.
    // Joins its venue's till room ('pos:<venueId>'), where the till API
    // announces new events ('pos.seq'), config changes and presence.
    const posDevice = url.searchParams.get('pos_device')
    if (posDevice) {
      const device = await verifyDevice(posDevice, url.searchParams.get('secret')).catch(() => null)
      if (!device) { ws.close(4003, 'Forbidden'); return }
      joinRoom(ws, 'pos:' + device.venue_id)
      ws.send(JSON.stringify({ type: 'connected', venueId: device.venue_id }))
      return
    }

    // A paired menu screen (migration 166): /ws?screen=<id>&secret=<secret>.
    // Its own room (identify, reload, removed, its settings changed), its
    // venue's screens (sold out), the tenant's screens (boards, playlists)
    // and the tenant's menus (published: menus.live).
    const screenId = url.searchParams.get('screen')
    if (screenId) {
      const screen = await verifyScreen(screenId, url.searchParams.get('secret')).catch(() => null)
      if (!screen) { ws.close(4003, 'Forbidden'); return }
      joinRooms(ws, ['screen:' + screen.id, 'screens:' + screen.venue_id, 'screens-t:' + screen.tenant_id, 'menus:' + screen.tenant_id])
      ws.send(JSON.stringify({ type: 'connected', screenId: screen.id }))
      return
    }

    const token  = url.searchParams.get('token')
    const venueId = url.searchParams.get('venue')

    if (!token || !venueId) {
      ws.close(4001, 'Missing token or venue')
      return
    }

    // Verify JWT + that this identity may see this venue's restaurant
    try {
      const payload = await jwtVerify(token)
      const sub     = payload.sub
      const email   = payload[`${CLAIM_NS}email`] ?? payload.email ?? null

      const [venue] = await sql`
        SELECT v.id, v.tenant_id FROM venues v WHERE v.id = ${venueId} LIMIT 1
      `
      if (!venue) { ws.close(4003, 'Forbidden'); return }

      const [platformAdmin] = await sql`
        SELECT id FROM platform_admins
         WHERE auth0_user_id = ${sub} AND is_active = true
         LIMIT 1
      `
      if (!platformAdmin) {
        const member = await isMember(sub, email, venue.tenant_id)
        if (!member) { ws.close(4003, 'Forbidden'); return }
      }

    } catch {
      ws.close(4001, 'Invalid token')
      return
    }

    joinRoom(ws, venueId)
    ws.send(JSON.stringify({ type: 'connected', venueId }))
  })

  return wss
}

function joinRoom(ws, room) {
  joinRooms(ws, [room])
}

function joinRooms(ws, list) {
  for (const room of list) {
    if (!rooms.has(room)) rooms.set(room, new Set())
    rooms.get(room).add(ws)
  }

  ws.on('close', () => {
    for (const room of list) {
      rooms.get(room)?.delete(ws)
      if (rooms.get(room)?.size === 0) rooms.delete(room)
    }
  })

  // Keepalive ping every 30s
  const ping = setInterval(() => {
    if (ws.readyState === ws.OPEN) ws.ping()
  }, 30_000)
  ws.on('close', () => clearInterval(ping))
}

function deliver(room, payload) {
  const clients = rooms.get(room)
  if (!clients) return
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(payload)
  }
}

/**
 * Broadcast a message to all clients subscribed to a venue (or room), on
 * every API process. Safe to call even when no clients are connected.
 */
export function broadcast(venueId, message) {
  const payload = JSON.stringify(message)
  deliver(venueId, payload)
  if (pub?.status === 'ready') {
    pub.publish(CHANNEL, JSON.stringify({ origin: ORIGIN, room: venueId, payload })).catch(() => {})
  }
}

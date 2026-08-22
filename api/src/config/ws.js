// src/config/ws.js
// WebSocket server attached to the Fastify HTTP server.
// Authenticates connections via JWT query param.
// Rooms are keyed by venue_id — each admin client subscribes to one venue.
// Broadcasts: booking.created | booking.updated | booking.deleted
//
// Usage from route handlers / webhook:
//   import { broadcast } from '../config/ws.js'
//   broadcast(venueId, { type: 'booking.created', data: booking })

import { WebSocketServer } from 'ws'
import { sql } from './db.js'
import { isMember } from '../services/membershipSvc.js'

const CLAIM_NS = 'https://macaroonie.com/claims/'

// Map<venueId, Set<WebSocket>>
const rooms = new Map()

let wss = null

/**
 * Attach WS server to an existing Fastify server instance.
 * Call once from server.js after app.listen().
 */
export function attachWss(httpServer, jwtVerify) {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' })

  wss.on('connection', async (ws, req) => {
    const url    = new URL(req.url, `http://localhost`)
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

    // Join room
    if (!rooms.has(venueId)) rooms.set(venueId, new Set())
    rooms.get(venueId).add(ws)

    ws.on('close', () => {
      rooms.get(venueId)?.delete(ws)
      if (rooms.get(venueId)?.size === 0) rooms.delete(venueId)
    })

    // Keepalive ping every 30s
    const ping = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.ping()
    }, 30_000)

    ws.on('close', () => clearInterval(ping))
    ws.send(JSON.stringify({ type: 'connected', venueId }))
  })

  return wss
}

/**
 * Broadcast a message to all clients subscribed to a venue.
 * Safe to call even when no clients are connected.
 */
export function broadcast(venueId, message) {
  const clients = rooms.get(venueId)
  if (!clients) return
  const payload = JSON.stringify(message)
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(payload)
  }
}

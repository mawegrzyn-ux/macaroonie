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
import { env } from './env.js'

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

    // Verify JWT + resolve tenant
    try {
      const payload = await jwtVerify(token)

      // Verify tenant owns this venue
      const [venue] = await sql`
        SELECT v.id FROM venues v
          JOIN tenants t ON t.id = v.tenant_id
         WHERE v.id = ${venueId}
           AND t.auth0_org_id = ${payload['https://' + env.AUTH0_DOMAIN + '/claims/tenant_id']}
      `
      if (!venue) { ws.close(4003, 'Forbidden'); return }

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
  const room = rooms.get(venueId)
  if (!room || room.size === 0) return
  const payload = JSON.stringify(message)
  for (const client of room) {
    if (client.readyState === 1 /* OPEN */) {
      client.send(payload)
    }
  }
}

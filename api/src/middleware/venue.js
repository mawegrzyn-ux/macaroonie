// src/middleware/venue.js
//
// requireOwnVenue(param): a preHandler that refuses (404) unless the venue
// id in the URL belongs to the caller's tenant. RLS isn't a tenant filter
// the app can rely on (CLAUDE.md, Common mistakes), and several older venue
// routes look rows up, or upsert them, by venue id alone (e.g. ON CONFLICT
// (venue_id) DO UPDATE), so without this one tenant could read or change
// another tenant's venue setup by its id. Register it after requireAuth:
//
//   app.addHook('preHandler', requireAuth)
//   app.addHook('preHandler', requireOwnVenue('venueId'))
//
// Routes without that param pass straight through.

import { sql } from '../config/db.js'
import { httpError } from './error.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function requireOwnVenue(param = 'venueId') {
  return async function (req) {
    const id = req.params?.[param]
    if (id === undefined) return
    if (!req.tenantId || !UUID_RE.test(String(id))) throw httpError(404, 'Venue not found')
    const [v] = await sql`SELECT 1 FROM venues WHERE id = ${id} AND tenant_id = ${req.tenantId}`
    if (!v) throw httpError(404, 'Venue not found')
  }
}

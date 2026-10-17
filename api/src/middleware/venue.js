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

// refuseOtherTenantsVenues: app.js adds it to every route, after the
// route's own preHandlers. It refuses (404) a request that names another
// tenant's venue in its query string or JSON body: any key venue_id /
// *_venue_id (one id) or venue_ids / *_venue_ids (a list), at any depth.
// Many routes insert a body venue_id as given, so without this one tenant
// could make rows (fridges, checklists, reviews ...) pointing at another
// tenant's venue. Ids that are no venue at all pass, for the route to deal
// with (a stale id in saved page blocks mustn't stop a save). Requests with
// no tenant (public pages, devices without one) are left alone.
const VENUE_KEY = /(^|_)venue_ids?$/
const MAX_NODES = 5000

function venueIdsIn(value, out, state, depth = 0) {
  if (value === null || typeof value !== 'object' || depth > 8 || ++state.nodes > MAX_NODES) return
  if (Array.isArray(value)) {
    for (const v of value) venueIdsIn(v, out, state, depth + 1)
    return
  }
  for (const [k, v] of Object.entries(value)) {
    if (VENUE_KEY.test(k)) {
      for (const id of [].concat(v)) if (typeof id === 'string' && UUID_RE.test(id)) out.add(id.toLowerCase())
    } else if (v && typeof v === 'object') {
      venueIdsIn(v, out, state, depth + 1)
    }
  }
}

export async function refuseOtherTenantsVenues(req) {
  if (!req.tenantId) return
  const ids = new Set()
  const state = { nodes: 0 }
  venueIdsIn(req.query, ids, state)
  venueIdsIn(req.body, ids, state)
  if (!ids.size) return
  const [other] = await sql`
    SELECT 1 FROM venues WHERE id = ANY(${[...ids]}::uuid[]) AND tenant_id <> ${req.tenantId} LIMIT 1
  `
  if (other) throw httpError(404, 'Venue not found')
}

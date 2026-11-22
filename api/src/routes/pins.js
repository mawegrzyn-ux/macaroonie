// src/routes/pins.js
//
// Each person's own pins on Home (migration 272, Pepper-first step 2a),
// mounted at /api/pins. Open to everyone signed in to a group: a person only
// ever reads and saves their own (user_sub), and only pages of their own menu
// (navTreeFor(), the tree /api/me sends).
//
//   GET /     -> { pins: [{ path, venue_id, tab, label }], max }
//                in the person's order; a pin whose page has left their menu
//                (a role or module change) is not sent
//   PUT /     { pins: [{ path, venue_id?, tab?, label? }] }  the whole list,
//                at most MAX_PINS (rule 13: the caller sends back every pin)
//                -> the saved list, as GET
//
// A venue and a tab are kept only where the page's address accepts them
// (shared/nav/links.js pageAccepts()); a venue must be one of the group's.
// The same page at the same venue and tab twice is kept once.

import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { withTenant } from '../config/db.js'
import { navTreeFor, navLinksOf } from '../services/navTree.js'
import { pageAccepts } from '../../../shared/nav/links.js'

export const MAX_PINS = 12
export const LABEL_MAX = 40

const Pin = z.object({
  path:     z.string().trim().min(1).max(100),
  venue_id: z.string().uuid().nullable().optional(),
  tab:      z.string().trim().max(40).nullable().optional(),
  label:    z.string().max(200).nullable().optional(),
})
const Body = z.object({ pins: z.array(Pin).max(MAX_PINS) })

/** The routes of the caller's own menu. */
async function menuRoutes(req) {
  return new Set(navLinksOf(await navTreeFor(req)).map(l => l.route))
}

/** A pin as it is sent: what the page accepts only, the name trimmed. */
export function cleanPin(p) {
  const { keys, tabs } = pageAccepts(p.path)
  const tab = p.tab ? String(p.tab).trim().toLowerCase() : ''
  const label = String(p.label ?? '').replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX)
  return {
    path: p.path,
    venue_id: keys.includes('venue') && p.venue_id ? String(p.venue_id).toLowerCase() : null,
    tab: keys.includes('tab') && tabs.includes(tab) ? tab : null,
    label: label || null,
  }
}

async function readPins(req) {
  const [rows, routes] = await Promise.all([
    withTenant(req.tenantId, tx => tx`
      SELECT path, venue_id, tab, label FROM home_pins
       WHERE tenant_id = ${req.tenantId} AND user_sub = ${req.user.sub}
       ORDER BY sort_order
    `),
    menuRoutes(req),
  ])
  return { pins: rows.filter(r => routes.has(r.path)).map(r => ({ ...r })), max: MAX_PINS }
}

export default async function pinsRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.get('/', async req => {
    if (!req.tenantId) throw httpError(400, 'Choose a restaurant group first')
    return readPins(req)
  })

  app.put('/', async req => {
    if (!req.tenantId) throw httpError(400, 'Choose a restaurant group first')
    const { pins } = Body.parse(req.body ?? {})
    const routes = await menuRoutes(req)
    const seen = new Set()
    const list = []
    for (const raw of pins) {
      if (!routes.has(raw.path)) throw httpError(400, 'A pin must be a page in your menu: ' + raw.path)
      const p = cleanPin(raw)
      const key = [p.path, p.venue_id, p.tab].join('|')
      if (seen.has(key)) continue
      seen.add(key)
      list.push(p)
    }
    await withTenant(req.tenantId, async tx => {
      // Every venue named must be the group's own (rule 4).
      const venueIds = [...new Set(list.map(p => p.venue_id).filter(Boolean))]
      if (venueIds.length) {
        const own = await tx`SELECT id FROM venues WHERE tenant_id = ${req.tenantId} AND id = ANY(${venueIds}::uuid[])`
        if (own.length !== venueIds.length) throw httpError(404, 'Venue not found')
      }
      await tx`DELETE FROM home_pins WHERE tenant_id = ${req.tenantId} AND user_sub = ${req.user.sub}`
      for (const [i, p] of list.entries()) {
        await tx`
          INSERT INTO home_pins (tenant_id, user_sub, sort_order, path, venue_id, tab, label)
          VALUES (${req.tenantId}, ${req.user.sub}, ${i}, ${p.path}, ${p.venue_id}, ${p.tab}, ${p.label})
        `
      }
    })
    return readPins(req)
  })
}

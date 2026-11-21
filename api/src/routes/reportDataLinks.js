// src/routes/reportDataLinks.js
//
// Data links (docs/REPORTS.md 15, migration 256): addresses other apps read a
// report's current figures from. The rules are src/reports/dataLinks.js.
//
// Mounted at /api/reports (owners and admins with Manage on Reports):
//   GET    /data-links?report=<id>        the group's links, or one report's
//   POST   /:id/data-links                make one: { name, params, open_params,
//                                         personal, rate_per_hour, expires_on }
//                                         answers the key once
//   PATCH  /data-links/:linkId            name, enabled, expires_on,
//                                         rate_per_hour, personal
//   POST   /data-links/:linkId/new-key    a new key (the old one stops)
//   DELETE /data-links/:linkId
//
// reportDataPublicRoutes, mounted at /api/report-data with no login:
//   GET    /:linkId   ?format=json|csv, ?cursor=, ?limit=, and the choices the
//                     link leaves open (?period=, ?venues=). The key goes in
//                     an Authorization: Bearer header, X-Report-Key or ?key=.
//                     Logged at warn only, so a key in the address isn't kept
//                     in request logs.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { loadTarget } from '../reports/target.js'
import { requestPerson } from '../reports/send.js'
import { starterByKey } from '../reports/starters/index.js'
import { officeOrigin } from '../services/platformHost.js'
import {
  makeLink, linkView, newKey, expiryOf, assertLinkMaker, serveLink, LINK_LIMITS,
} from '../reports/dataLinks.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STARTER_KEY = /^starter:[a-z0-9_]{1,60}$/

const Name = z.string().trim().min(1).max(LINK_LIMITS.name)
const Rate = z.number().int().min(1).max(LINK_LIMITS.rate)
const Day = z.string().max(10).nullable().optional()
const MakeBody = z.object({
  name: Name,
  params: z.record(z.any()).optional(),
  open_params: z.array(z.string().max(60)).max(20).optional(),
  personal: z.boolean().optional(),
  rate_per_hour: Rate.optional(),
  expires_on: Day,
})
const EditBody = z.object({
  name: Name.optional(),
  enabled: z.boolean().optional(),
  personal: z.boolean().optional(),
  rate_per_hour: Rate.optional(),
  expires_on: Day,
})

export const linkUrl = id => officeOrigin() + '/api/report-data/' + id

const notFound = () => httpError(404, 'Data link not found')

function nameOf(row) {
  if (row.report_id) return row.report_name ?? null
  return starterByKey(row.starter_key)?.name ?? row.starter_key
}

const viewOf = row => ({ ...linkView({ ...row, report_name: nameOf(row) }), url: linkUrl(row.id) })

async function ownRow(p, id) {
  if (!UUID_RE.test(String(id))) throw notFound()
  const [row] = await withTenant(p.tenantId, tx => tx`
    SELECT l.*, r.name AS report_name FROM report_data_links l
      LEFT JOIN reports r ON r.id = l.report_id AND r.tenant_id = l.tenant_id
     WHERE l.tenant_id = ${p.tenantId} AND l.id = ${String(id)}`)
  if (!row) throw notFound()
  return row
}

export default async function reportDataLinkRoutes(app) {
  app.addHook('preHandler', requireAuth)
  const manage = { preHandler: requirePermission('reports', 'manage') }

  app.get('/data-links', manage, async req => {
    const p = await requestPerson(req)
    assertLinkMaker(p)
    const ref = String(req.query?.report || '')
    const filter = UUID_RE.test(ref) ? { report_id: ref } : STARTER_KEY.test(ref) ? { starter_key: ref.slice(8) } : null
    if (ref && !filter) throw httpError(404, 'Report not found')
    const rows = await withTenant(p.tenantId, tx => tx`
      SELECT l.*, r.name AS report_name FROM report_data_links l
        LEFT JOIN reports r ON r.id = l.report_id AND r.tenant_id = l.tenant_id
       WHERE l.tenant_id = ${p.tenantId}
         ${filter?.report_id ? tx`AND l.report_id = ${filter.report_id}` : tx``}
         ${filter?.starter_key ? tx`AND l.starter_key = ${filter.starter_key}` : tx``}
       ORDER BY l.created_at DESC, l.id`)
    return { links: rows.map(viewOf), can_personal: !!p.isOwner }
  })

  app.post('/:id/data-links', manage, async (req, reply) => {
    const p = await requestPerson(req)
    assertLinkMaker(p)
    const body = MakeBody.parse(req.body || {})
    const target = await loadTarget(req.params.id, p)
    const { row, key } = await makeLink(p, target, body)
    reply.code(201)
    return { link: viewOf(row), key }
  })

  app.patch('/data-links/:linkId', manage, async req => {
    const p = await requestPerson(req)
    assertLinkMaker(p)
    const body = EditBody.parse(req.body || {})
    const before = await ownRow(p, req.params.linkId)
    if (body.personal && !before.personal && !p.isOwner) throw httpError(403, 'Only an owner can let a data link show people\'s details')
    const set = { updated_at: new Date() }
    if (body.name !== undefined) set.name = body.name
    if (body.enabled !== undefined) set.enabled = body.enabled
    if (body.personal !== undefined) set.personal = body.personal
    if (body.rate_per_hour !== undefined) set.rate_per_hour = body.rate_per_hour
    if (body.expires_on !== undefined) set.expires_at = expiryOf(body.expires_on)
    await withTenant(p.tenantId, tx => tx`
      UPDATE report_data_links SET ${tx(set, ...Object.keys(set))}
       WHERE tenant_id = ${p.tenantId} AND id = ${before.id}`)
    return { link: viewOf(await ownRow(p, before.id)) }
  })

  app.post('/data-links/:linkId/new-key', manage, async req => {
    const p = await requestPerson(req)
    assertLinkMaker(p)
    const before = await ownRow(p, req.params.linkId)
    const { key, hash, hint } = newKey()
    await withTenant(p.tenantId, tx => tx`
      UPDATE report_data_links SET key_hash = ${hash}, key_hint = ${hint}, updated_at = now()
       WHERE tenant_id = ${p.tenantId} AND id = ${before.id}`)
    return { link: viewOf(await ownRow(p, before.id)), key }
  })

  app.delete('/data-links/:linkId', manage, async req => {
    const p = await requestPerson(req)
    assertLinkMaker(p)
    const before = await ownRow(p, req.params.linkId)
    await withTenant(p.tenantId, tx => tx`DELETE FROM report_data_links WHERE tenant_id = ${p.tenantId} AND id = ${before.id}`)
    return { ok: true }
  })
}

// The key, from a header or the address.
function keyOf(req) {
  const auth = String(req.headers.authorization || '')
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim()
  if (req.headers['x-report-key']) return String(req.headers['x-report-key']).trim()
  return typeof req.query?.key === 'string' ? req.query.key : null
}

export async function reportDataPublicRoutes(app) {
  app.get('/:linkId', { logLevel: 'warn' }, async (req, reply) => {
    try {
      const out = await serveLink({
        linkId: req.params.linkId,
        key: keyOf(req),
        query: req.query || {},
        ifNoneMatch: req.headers['if-none-match'] || null,
        log: req.log,
      })
      reply.code(out.status).headers(out.headers)
      return out.status === 304 ? reply.send() : reply.send(out.body)
    } catch (e) {
      reply.header('cache-control', 'no-store').header('x-robots-tag', 'noindex')
      if (e.retryAfter) reply.header('retry-after', String(e.retryAfter))
      throw e
    }
  })
}

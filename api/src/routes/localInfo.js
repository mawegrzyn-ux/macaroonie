// src/routes/localInfo.js
//
// Local information (migration 240, shared/localInfo.js), mounted at
// /api/local-info: what's happening around each venue — weather, traffic,
// events and incidents captured on a schedule (services/localInfoSvc.js),
// plus events typed in by hand. Reads need Local info view, changes manage.
//
//   GET    /venues/:venueId/sources        the venue's captures
//   POST   /venues/:venueId/sources        add one (runs soon)
//   PATCH  /sources/:id                    change one (schedule changes run it again soon)
//   DELETE /sources/:id                    remove it and everything it captured
//   POST   /sources/:id/run                run it now (409 while a run holds it)
//   GET    /items?venue_id=&from=&to=      the items on those days (venue's own +
//                                          whole-group; no venue_id = the whole group)
//   POST   /items                          an event typed in (venue_id null = every venue)
//   PATCH  /items/:id                      hide/show a captured item; edit a typed-in one
//   DELETE /items/:id                      typed-in items only (hide captured ones instead)

import { z }          from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError }  from '../middleware/error.js'
import { claimSource, runClaimed, listItems } from '../services/localInfoSvc.js'
import { KINDS, SEVERITIES, FREQUENCIES, addDays } from '../../../shared/localInfo.js'
import { webLink } from '../../../shared/links.js'

const UUID = z.string().uuid()
const DAY  = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const MAX_SOURCES = 20   // per venue
const MAX_SPAN_DAYS = 400

const SourceFields = {
  kind:        z.enum(KINDS),
  frequency:   z.enum(FREQUENCIES),
  every_hours: z.number().int().min(1).max(24).nullable(),
  place:       z.string().trim().min(1).max(200),
  site:        z.string().trim().max(100).nullable(),
  query:       z.string().trim().max(300).nullable(),
  enabled:     z.boolean(),
}
const NewSource = z.object({
  ...SourceFields,
  frequency:   SourceFields.frequency.default('daily'),
  every_hours: SourceFields.every_hours.optional(),
  site:        SourceFields.site.optional(),
  query:       SourceFields.query.optional(),
  enabled:     SourceFields.enabled.optional(),
})
const EditSource = z.object(Object.fromEntries(Object.entries(SourceFields).map(([k, v]) => [k, v.optional()])))

const ItemFields = {
  kind:      z.enum(KINDS),
  title:     z.string().trim().min(1).max(200),
  details:   z.string().trim().max(1000).nullable(),
  place:     z.string().trim().max(200).nullable(),
  url:       z.string().trim().max(500).refine(u => !!webLink(u), 'Use a web address starting with https://').nullable(),
  starts_on: DAY,
  ends_on:   DAY.nullable(),
  time_text: z.string().trim().max(40).nullable(),
  severity:  z.enum(SEVERITIES),
}
const NewItem = z.object({
  venue_id:  UUID.nullable().optional(),
  ...ItemFields,
  kind:      ItemFields.kind.default('events'),
  details:   ItemFields.details.optional(),
  place:     ItemFields.place.optional(),
  url:       ItemFields.url.optional(),
  ends_on:   ItemFields.ends_on.optional(),
  time_text: ItemFields.time_text.optional(),
  severity:  ItemFields.severity.default('info'),
})
const EditItem = z.object({
  hidden: z.boolean().optional(),
  ...Object.fromEntries(Object.entries(ItemFields).map(([k, v]) => [k, v.optional()])),
})

const by = req => req.user?.email || req.user?.sub || null

/** A site is kept as a bare host ("bbc.co.uk"), whatever was pasted. */
function cleanSite(site) {
  if (site == null || site === '') return null
  const host = String(site).toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/^www\./, '')
  if (!/^[a-z0-9][a-z0-9.-]{1,98}\.[a-z]{2,}$/.test(host)) throw httpError(400, 'Type the site as its address, like bbc.co.uk')
  return host
}

function checkDates(starts, ends) {
  if (ends && ends <= starts) throw httpError(422, 'The last day must be after the first')
}

// A date column comes back as a JS Date (the date-column trap): 'YYYY-MM-DD' or null.
const dayOf = v => v == null ? null : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10)

async function ownVenue(tx, tenantId, venueId) {
  if (!UUID.safeParse(venueId).success) throw httpError(404, 'Venue not found')
  const [v] = await tx`SELECT id, name, timezone FROM venues WHERE id = ${venueId} AND tenant_id = ${tenantId}`
  if (!v) throw httpError(404, 'Venue not found')
  return v
}

const SOURCE_COLS = `id, venue_id, kind, enabled, frequency, every_hours, place, site, query,
  next_run_at, last_run_at, last_error,
  (running_until IS NOT NULL AND running_until > now()) AS running, created_at, updated_at`

async function loadSource(tx, tenantId, id) {
  if (!UUID.safeParse(id).success) throw httpError(404, 'Capture not found')
  const [row] = await tx`SELECT * FROM local_info_sources WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!row) throw httpError(404, 'Capture not found')
  return row
}

async function sourcesOf(tx, tenantId, venueId) {
  return tx`
    SELECT ${tx.unsafe(SOURCE_COLS)} FROM local_info_sources
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}
     ORDER BY kind, created_at`
}

export default async function localInfoRoutes(app) {
  app.addHook('preHandler', requireAuth)
  const canView = requirePermission('local_info', 'view')
  const canManage = requirePermission('local_info', 'manage')

  app.get('/venues/:venueId/sources', { preHandler: canView }, async req => withTenant(req.tenantId, async tx => {
    const venue = await ownVenue(tx, req.tenantId, req.params.venueId)
    return { venue: { id: venue.id, name: venue.name, timezone: venue.timezone || 'Europe/London' }, sources: await sourcesOf(tx, req.tenantId, venue.id) }
  }))

  app.post('/venues/:venueId/sources', { preHandler: canManage }, async req => {
    const b = NewSource.parse(req.body)
    const site = cleanSite(b.site)
    return withTenant(req.tenantId, async tx => {
      const venue = await ownVenue(tx, req.tenantId, req.params.venueId)
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM local_info_sources WHERE tenant_id = ${req.tenantId} AND venue_id = ${venue.id}`
      if (n >= MAX_SOURCES) throw httpError(422, `A venue can have at most ${MAX_SOURCES} captures`)
      const [row] = await tx`
        INSERT INTO local_info_sources (tenant_id, venue_id, kind, enabled, frequency, every_hours, place, site, query, next_run_at)
        VALUES (${req.tenantId}, ${venue.id}, ${b.kind}, ${b.enabled ?? true}, ${b.frequency},
                ${b.frequency === 'hours' ? (b.every_hours ?? 4) : null}, ${b.place}, ${site}, ${b.query ?? null}, now())
        RETURNING ${tx.unsafe(SOURCE_COLS)}`
      return { source: row }
    })
  })

  app.patch('/sources/:id', { preHandler: canManage }, async req => {
    const b = EditSource.parse(req.body)
    return withTenant(req.tenantId, async tx => {
      const before = await loadSource(tx, req.tenantId, req.params.id)
      const next = {
        kind: b.kind ?? before.kind,
        enabled: b.enabled ?? before.enabled,
        frequency: b.frequency ?? before.frequency,
        place: 'place' in b && b.place != null ? b.place : before.place,
        site: 'site' in b ? cleanSite(b.site) : before.site,
        query: 'query' in b ? (b.query || null) : before.query,
      }
      next.every_hours = next.frequency === 'hours'
        ? (b.every_hours ?? before.every_hours ?? 4)
        : null
      // A changed schedule, place or search runs again soon; the capture
      // re-geocodes itself when the place no longer matches the cached one.
      const changed = ['kind', 'frequency', 'every_hours', 'place', 'site', 'query'].some(k => String(next[k] ?? '') !== String(before[k] ?? ''))
        || (next.enabled && !before.enabled)
      const [row] = await tx`
        UPDATE local_info_sources
           SET kind = ${next.kind}, enabled = ${next.enabled}, frequency = ${next.frequency},
               every_hours = ${next.every_hours}, place = ${next.place}, site = ${next.site},
               query = ${next.query},
               next_run_at = ${changed && next.enabled ? tx`now()` : tx`next_run_at`},
               updated_at = now()
         WHERE id = ${before.id} AND tenant_id = ${req.tenantId}
         RETURNING ${tx.unsafe(SOURCE_COLS)}`
      return { source: row }
    })
  })

  app.delete('/sources/:id', { preHandler: canManage }, async req => withTenant(req.tenantId, async tx => {
    const row = await loadSource(tx, req.tenantId, req.params.id)
    await tx`DELETE FROM local_info_sources WHERE id = ${row.id} AND tenant_id = ${req.tenantId}`
    return { ok: true }
  }))

  app.post('/sources/:id/run', { preHandler: canManage }, async req => {
    await withTenant(req.tenantId, tx => loadSource(tx, req.tenantId, req.params.id))
    const claimed = await claimSource(req.tenantId, req.params.id)
    if (!claimed) throw httpError(409, 'This capture is already running. Give it a minute.')
    runClaimed(claimed, req.log).catch(err => req.log.warn({ err }, 'local info run-now failed'))
    return { started: true }
  })

  app.get('/items', { preHandler: canView }, async req => withTenant(req.tenantId, async tx => {
    const q = req.query || {}
    const venueId = q.venue_id ? UUID.parse(q.venue_id) : null
    const today = new Date().toISOString().slice(0, 10)
    const from = q.from ? DAY.parse(q.from) : addDays(today, -7)
    const to = q.to ? DAY.parse(q.to) : addDays(today, 60)
    if (to < from || addDays(from, MAX_SPAN_DAYS) < to) throw httpError(400, 'Pick a range of days up to about a year')
    const kinds = String(q.kinds || '').split(',').filter(k => KINDS.includes(k))
    const items = await listItems(tx, req.tenantId, {
      venueId, from, to, kinds: kinds.length ? kinds : null,
      includeHidden: q.include_hidden === '1',
    })
    return { from, to, items }
  }))

  app.post('/items', { preHandler: canManage }, async req => {
    const b = NewItem.parse(req.body)
    checkDates(b.starts_on, b.ends_on)
    return withTenant(req.tenantId, async tx => {
      if (b.venue_id) await ownVenue(tx, req.tenantId, b.venue_id)
      const [row] = await tx`
        INSERT INTO local_info_items (tenant_id, venue_id, kind, title, details, place, url,
                                      starts_on, ends_on, time_text, severity, created_by)
        VALUES (${req.tenantId}, ${b.venue_id ?? null}, ${b.kind}, ${b.title}, ${b.details ?? null},
                ${b.place ?? null}, ${b.url ?? null}, ${b.starts_on}, ${b.ends_on ?? null},
                ${b.time_text ?? null}, ${b.severity}, ${by(req)})
        RETURNING id`
      return { id: row.id }
    })
  })

  app.patch('/items/:id', { preHandler: canManage }, async req => {
    const b = EditItem.parse(req.body)
    return withTenant(req.tenantId, async tx => {
      if (!UUID.safeParse(req.params.id).success) throw httpError(404, 'Item not found')
      const [before] = await tx`SELECT * FROM local_info_items WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}`
      if (!before) throw httpError(404, 'Item not found')
      const edits = Object.keys(b).filter(k => k !== 'hidden')
      if (before.source_id && edits.length) {
        throw httpError(422, 'A captured item can\'t be edited — hide it, or change the capture')
      }
      const next = {
        kind: b.kind ?? before.kind,
        title: b.title ?? before.title,
        details: 'details' in b ? (b.details || null) : before.details,
        place: 'place' in b ? (b.place || null) : before.place,
        url: 'url' in b ? (b.url || null) : before.url,
        starts_on: b.starts_on ?? dayOf(before.starts_on),
        ends_on: 'ends_on' in b ? b.ends_on : dayOf(before.ends_on),
        time_text: 'time_text' in b ? (b.time_text || null) : before.time_text,
        severity: b.severity ?? before.severity,
        hidden: b.hidden ?? before.hidden,
      }
      checkDates(next.starts_on, next.ends_on)
      await tx`
        UPDATE local_info_items
           SET kind = ${next.kind}, title = ${next.title}, details = ${next.details},
               place = ${next.place}, url = ${next.url}, starts_on = ${next.starts_on},
               ends_on = ${next.ends_on}, time_text = ${next.time_text}, severity = ${next.severity},
               hidden = ${next.hidden}, updated_at = now()
         WHERE id = ${before.id} AND tenant_id = ${req.tenantId}`
      return { ok: true }
    })
  })

  app.delete('/items/:id', { preHandler: canManage }, async req => withTenant(req.tenantId, async tx => {
    if (!UUID.safeParse(req.params.id).success) throw httpError(404, 'Item not found')
    const [before] = await tx`SELECT id, source_id FROM local_info_items WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}`
    if (!before) throw httpError(404, 'Item not found')
    if (before.source_id) throw httpError(422, 'A captured item can\'t be deleted — hide it instead')
    await tx`DELETE FROM local_info_items WHERE id = ${before.id} AND tenant_id = ${req.tenantId}`
    return { ok: true }
  }))
}

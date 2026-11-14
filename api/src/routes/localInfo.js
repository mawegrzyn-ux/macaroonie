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
//   POST   /sources/:id/learn              Pepper learns from its items' flags now (search kinds)
//   DELETE /sources/:id/learned            forget what Pepper learned
//   GET    /items?venue_id=&from=&to=      the items on those days (venue's own +
//                                          whole-group; no venue_id = the whole group),
//                                          a captured one with its flags (feedback)
//   POST   /items                          an event typed in (venue_id null = every venue)
//   PATCH  /items/:id                      hide/show a captured item; edit a typed-in one
//   DELETE /items/:id                      typed-in items only (hide captured ones instead)
//   PUT    /items/:id/feedback             the person's flag on a captured item: relevant
//                                          true / false, or null to take it off (Local info view)
//   POST   /items/delete                   bulk delete (14 Nov 2026): entries starting from a day
//                                          (today on, never the past) until an optional day, by
//                                          venue or the whole group, capture, typed or captured,
//                                          kinds, severities and words; dry_run says what would go
//   POST   /items/:id/separate             Not the same (migration 249): a finding merged into
//                                          another entry becomes its own entry again, never merged
//
// One entry per real event (migration 249): a finding merged into another
// (merged_into) isn't listed, flagged, hidden or deleted on its own; it is
// shown under its entry as Also reported as (listItems' `also`).

import { z }          from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError }  from '../middleware/error.js'
import { claimSource, runClaimed, listItems, itemFeedback, learnNow, lockMerges } from '../services/localInfoSvc.js'
import { pepperOn } from '../services/aiJson.js'
import { KINDS, SEVERITIES, FREQUENCIES, addDays, localDateTime } from '../../../shared/localInfo.js'
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
  learn_auto:  z.boolean(),
}
const NewSource = z.object({
  ...SourceFields,
  frequency:   SourceFields.frequency.default('daily'),
  every_hours: SourceFields.every_hours.optional(),
  site:        SourceFields.site.optional(),
  query:       SourceFields.query.optional(),
  enabled:     SourceFields.enabled.optional(),
  learn_auto:  SourceFields.learn_auto.optional(),
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
const Feedback = z.object({ relevant: z.boolean().nullable() })

// Bulk delete (14 Nov 2026). Every criterion given must hold; an entry is in
// the days when it starts in them. venue_id = that venue's own entries (the
// whole group's aren't touched), group_wide = only the whole group's, neither
// = all of them.
const BulkDelete = z.object({
  from:       DAY.optional(),
  until:      DAY.nullable().optional(),
  venue_id:   UUID.nullable().optional(),
  group_wide: z.boolean().optional(),
  source_id:  UUID.nullable().optional(),
  origin:     z.enum(['any', 'typed', 'captured']).default('any'),
  kinds:      z.array(z.enum(KINDS)).max(KINDS.length).optional(),
  severities: z.array(z.enum(SEVERITIES)).max(SEVERITIES.length).optional(),
  words:      z.string().trim().max(100).optional(),
  dry_run:    z.boolean().default(false),
})
const DELETE_EXAMPLES = 10

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

// "Today" for a bulk delete: the venue's own day, else the earliest day at
// any of the group's venues (a day that is still today somewhere counts).
async function earliestToday(tx, tenantId, venueId) {
  const rows = venueId
    ? await tx`SELECT timezone FROM venues WHERE id = ${venueId} AND tenant_id = ${tenantId}`
    : await tx`SELECT DISTINCT timezone FROM venues WHERE tenant_id = ${tenantId}`
  const now = new Date()
  const days = rows.map(r => localDateTime(now, r.timezone || 'Europe/London').date).sort()
  return days[0] || now.toISOString().slice(0, 10)
}

// What a bulk delete does to an entry it matched. A typed-in event goes. A
// captured one goes too, except: one someone hid is kept (hidden, it stops
// its capture adding it again), and a finding people flagged is hidden
// instead, so Pepper keeps learning from the flags (only a finding of its
// capture's own kind teaches; a forecast teaches nothing, so it goes).
function deleteAction(it) {
  if (!it.source_id) return 'delete'
  if (it.hidden) return 'keep'
  if (it.flagged && it.kind !== 'weather' && it.kind === it.source_kind) return 'hide'
  return 'delete'
}

async function ownVenue(tx, tenantId, venueId) {
  if (!UUID.safeParse(venueId).success) throw httpError(404, 'Venue not found')
  const [v] = await tx`SELECT id, name, timezone FROM venues WHERE id = ${venueId} AND tenant_id = ${tenantId}`
  if (!v) throw httpError(404, 'Venue not found')
  return v
}

const MERGED_COPY = 'This finding is part of another entry: change that one, or say it isn\'t the same'

const SOURCE_COLS = `id, venue_id, kind, enabled, frequency, every_hours, place, site, query,
  next_run_at, last_run_at, last_error, learn_auto, learned, learned_at, learn_error, merge_error,
  (running_until IS NOT NULL AND running_until > now()) AS running,
  (flags_at IS NOT NULL AND (learned_at IS NULL OR flags_at > learned_at)) AS flags_changed,
  created_at, updated_at`

async function loadSource(tx, tenantId, id) {
  if (!UUID.safeParse(id).success) throw httpError(404, 'Capture not found')
  const [row] = await tx`SELECT * FROM local_info_sources WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!row) throw httpError(404, 'Capture not found')
  return row
}

// Each capture with the flags on what it found (of its own kind): how many
// relevant and not relevant, and (flags_changed) whether one was added,
// changed or taken off since Pepper last learned from them. A finding merged
// into another entry counts with that entry's flags (migration 249);
// `merged` is how many of its findings are in another entry.
async function sourcesOf(tx, tenantId, venueId) {
  return tx`
    SELECT s.id, s.venue_id, s.kind, s.enabled, s.frequency, s.every_hours, s.place, s.site, s.query,
           s.next_run_at, s.last_run_at, s.last_error, s.learn_auto, s.learned, s.learned_at, s.learn_error,
           s.merge_error,
           (s.running_until IS NOT NULL AND s.running_until > now()) AS running,
           (s.flags_at IS NOT NULL AND (s.learned_at IS NULL OR s.flags_at > s.learned_at)) AS flags_changed,
           s.created_at, s.updated_at,
           (SELECT json_build_object(
                     'relevant', count(*) FILTER (WHERE f.relevant),
                     'not_relevant', count(*) FILTER (WHERE NOT f.relevant))
              FROM local_info_feedback f
             WHERE f.tenant_id = s.tenant_id
               AND f.item_id IN (SELECT COALESCE(i.merged_into, i.id) FROM local_info_items i
                                  WHERE i.tenant_id = s.tenant_id AND i.source_id = s.id AND i.kind = s.kind)) AS flags,
           (SELECT count(*)::int FROM local_info_items i
             WHERE i.tenant_id = s.tenant_id AND i.source_id = s.id AND i.merged_into IS NOT NULL) AS merged
      FROM local_info_sources s
     WHERE s.tenant_id = ${tenantId} AND s.venue_id = ${venueId}
     ORDER BY s.kind, s.created_at`
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
        INSERT INTO local_info_sources (tenant_id, venue_id, kind, enabled, frequency, every_hours, place, site, query, learn_auto, next_run_at)
        VALUES (${req.tenantId}, ${venue.id}, ${b.kind}, ${b.enabled ?? true}, ${b.frequency},
                ${b.frequency === 'hours' ? (b.every_hours ?? 4) : null}, ${b.place}, ${site}, ${b.query ?? null},
                ${b.learn_auto ?? true}, now())
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
        learn_auto: b.learn_auto ?? before.learn_auto,
      }
      next.every_hours = next.frequency === 'hours'
        ? (b.every_hours ?? before.every_hours ?? 4)
        : null
      // A changed schedule, place or search runs again soon; the capture
      // re-geocodes itself when the place no longer matches the cached one.
      const changed = ['kind', 'frequency', 'every_hours', 'place', 'site', 'query'].some(k => String(next[k] ?? '') !== String(before[k] ?? ''))
        || (next.enabled && !before.enabled)
      // What Pepper learned is about the kind of thing searched for: another
      // kind starts afresh (flags on the old kind's findings stay, unused).
      const newKind = next.kind !== before.kind
      const [row] = await tx`
        UPDATE local_info_sources
           SET kind = ${next.kind}, enabled = ${next.enabled}, frequency = ${next.frequency},
               every_hours = ${next.every_hours}, place = ${next.place}, site = ${next.site},
               query = ${next.query}, learn_auto = ${next.learn_auto},
               learned = ${newKind ? null : tx`learned`}, learned_at = ${newKind ? null : tx`learned_at`},
               learn_error = ${newKind ? null : tx`learn_error`}, flags_at = ${newKind ? null : tx`flags_at`},
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

  // Pepper works out from the flags what this capture's search should look
  // for and leave out (one model call, counted for the person).
  app.post('/sources/:id/learn', { preHandler: canManage }, async req => {
    const row = await withTenant(req.tenantId, tx => loadSource(tx, req.tenantId, req.params.id))
    if (row.kind === 'weather') throw httpError(422, 'A weather forecast has no search to tune: flags on it are only shown.')
    if (row.learn_auto === false) throw httpError(422, 'Learning from flags is off for this capture: switch it on in Edit first.')
    await pepperOn(req.tenantId)
    const out = await learnNow(req.tenantId, row.id, { sub: req.user?.sub, email: req.user?.email })
    return out
  })

  app.delete('/sources/:id/learned', { preHandler: canManage }, async req => withTenant(req.tenantId, async tx => {
    const row = await loadSource(tx, req.tenantId, req.params.id)
    // Learned again only once flags change after this (flags_at and
    // learned_at both come from the API's clock).
    const [after] = await tx`
      UPDATE local_info_sources SET learned = NULL, learned_at = ${new Date()}, learn_error = NULL
       WHERE id = ${row.id} AND tenant_id = ${req.tenantId}
       RETURNING ${tx.unsafe(SOURCE_COLS)}`
    return { source: after }
  }))

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
      includeHidden: q.include_hidden === '1', userSub: req.user?.sub,
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
      if (before.merged_into) throw httpError(422, MERGED_COPY)
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

  // The person's own flag on a captured item: relevant, not relevant, or none
  // (null). A flag added, changed or taken off stamps the item's capture
  // (flags_at) so its next run learns again first, and the captures of the
  // findings merged into it; the same flag again changes nothing and stamps
  // nothing.
  app.put('/items/:id/feedback', { preHandler: canView }, async req => {
    const b = Feedback.parse(req.body)
    const sub = req.user?.sub
    if (!sub) throw httpError(403, 'Sign in to flag what a capture found')
    return withTenant(req.tenantId, async tx => {
      if (!UUID.safeParse(req.params.id).success) throw httpError(404, 'Item not found')
      const [item] = await tx`SELECT id, source_id, kind, merged_into FROM local_info_items WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}`
      if (!item) throw httpError(404, 'Item not found')
      if (!item.source_id) throw httpError(422, 'Only what a capture found takes a flag: a typed-in event is the group\'s own')
      if (item.merged_into) throw httpError(422, MERGED_COPY)
      const changed = b.relevant === null
        ? await tx`DELETE FROM local_info_feedback WHERE tenant_id = ${req.tenantId} AND item_id = ${item.id} AND user_sub = ${sub} RETURNING item_id`
        : await tx`
            INSERT INTO local_info_feedback (tenant_id, item_id, user_sub, relevant)
            VALUES (${req.tenantId}, ${item.id}, ${sub}, ${b.relevant})
            ON CONFLICT (item_id, user_sub) DO UPDATE SET relevant = EXCLUDED.relevant, updated_at = now()
             WHERE local_info_feedback.relevant IS DISTINCT FROM EXCLUDED.relevant
            RETURNING item_id`
      // Only a finding of the capture's own kind is something it learns from.
      if (changed.length) {
        await tx`UPDATE local_info_sources SET flags_at = ${new Date()}
                  WHERE tenant_id = ${req.tenantId} AND kind = ${item.kind}
                    AND id IN (SELECT source_id FROM local_info_items
                                WHERE tenant_id = ${req.tenantId} AND (id = ${item.id} OR merged_into = ${item.id})
                                  AND source_id IS NOT NULL)`
      }
      return { feedback: await itemFeedback(tx, req.tenantId, item.id, sub) }
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

  // Not the same (migration 249): a finding merged into another entry becomes
  // its own entry again, and is never merged again. Flags stay on the entry;
  // its capture learns again when they were what it learned from.
  app.post('/items/:id/separate', { preHandler: canManage }, async req => withTenant(req.tenantId, async tx => {
    if (!UUID.safeParse(req.params.id).success) throw httpError(404, 'Item not found')
    const [first] = await tx`SELECT venue_id, kind FROM local_info_items WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}`
    if (!first) throw httpError(404, 'Item not found')
    if (first.venue_id) await lockMerges(tx, first.venue_id, first.kind)
    const [item] = await tx`SELECT id, source_id, kind, merged_into FROM local_info_items WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}`
    if (!item?.merged_into) throw httpError(422, 'This entry isn\'t part of another')
    await tx`UPDATE local_info_items SET merged_into = NULL, keep_separate = true, merge_checked_at = now(), updated_at = now()
              WHERE id = ${item.id} AND tenant_id = ${req.tenantId}`
    const [{ flagged }] = await tx`
      SELECT EXISTS (SELECT 1 FROM local_info_feedback WHERE tenant_id = ${req.tenantId} AND item_id = ${item.merged_into}) AS flagged`
    if (flagged) {
      await tx`UPDATE local_info_sources SET flags_at = ${new Date()}
                WHERE id = ${item.source_id} AND tenant_id = ${req.tenantId} AND kind = ${item.kind}`
    }
    return { ok: true }
  }))

  // Bulk delete, from today on (the Captures window's Delete future entries,
  // and Pepper's delete_local_info). A later run of a capture can find some
  // of what it deletes again: hiding is what keeps one off for good.
  app.post('/items/delete', { preHandler: canManage }, async req => {
    const b = BulkDelete.parse(req.body)
    if (b.venue_id && b.group_wide) throw httpError(422, 'Pick one venue or the whole group, not both')
    return withTenant(req.tenantId, async tx => {
      if (b.venue_id) await ownVenue(tx, req.tenantId, b.venue_id)
      const source = b.source_id ? await loadSource(tx, req.tenantId, b.source_id) : null
      const today = await earliestToday(tx, req.tenantId, b.venue_id || source?.venue_id || null)
      const from = b.from || today
      if (from < today) throw httpError(422, 'Only entries from today on can be deleted in bulk: today is ' + today)
      const until = b.until || null
      if (until && until < from) throw httpError(422, 'The last day must be on or after the first')
      const pattern = b.words ? '%' + b.words.replace(/[\\%_]/g, m => '\\' + m) + '%' : null
      const rows = await tx`
        SELECT i.id, i.venue_id, i.source_id, i.kind, i.title, i.hidden,
               i.starts_on::text AS starts_on, i.ends_on::text AS ends_on, s.kind AS source_kind,
               EXISTS (SELECT 1 FROM local_info_feedback f
                        WHERE f.item_id = i.id AND f.tenant_id = i.tenant_id) AS flagged
          FROM local_info_items i
          LEFT JOIN local_info_sources s ON s.id = i.source_id AND s.tenant_id = i.tenant_id
         WHERE i.tenant_id = ${req.tenantId} AND i.merged_into IS NULL
           AND i.starts_on >= ${from}
           ${until ? tx`AND i.starts_on <= ${until}` : tx``}
           ${b.venue_id ? tx`AND i.venue_id = ${b.venue_id}` : tx``}
           ${b.group_wide ? tx`AND i.venue_id IS NULL` : tx``}
           ${source ? tx`AND i.source_id = ${source.id}` : tx``}
           ${b.origin === 'typed' ? tx`AND i.source_id IS NULL` : b.origin === 'captured' ? tx`AND i.source_id IS NOT NULL` : tx``}
           ${b.kinds?.length ? tx`AND i.kind = ANY(${b.kinds}::text[])` : tx``}
           ${b.severities?.length ? tx`AND i.severity = ANY(${b.severities}::text[])` : tx``}
           ${pattern ? tx`AND (i.title ILIKE ${pattern} OR i.details ILIKE ${pattern} OR i.place ILIKE ${pattern})` : tx``}
         ORDER BY i.starts_on, i.kind, i.title, i.id`
      const del = rows.filter(r => deleteAction(r) === 'delete').map(r => r.id)
      const hide = rows.filter(r => deleteAction(r) === 'hide').map(r => r.id)
      // Deleting one capture's entries leaves what other captures found of
      // the same events: the first of those becomes the entry instead.
      const others = source && del.length ? await tx`
        SELECT id, merged_into FROM local_info_items
         WHERE tenant_id = ${req.tenantId} AND merged_into = ANY(${del}::uuid[]) AND source_id <> ${source.id}
         ORDER BY merged_into, captured_at, id` : []
      const handedOver = new Set(others.map(r => r.merged_into))
      if (!b.dry_run && others.length) {
        await lockMerges(tx, source.venue_id, source.kind)
        const first = new Map()
        for (const r of others) if (!first.has(r.merged_into)) first.set(r.merged_into, r.id)
        for (const [old, next] of first) {
          await tx`UPDATE local_info_items SET merged_into = NULL, updated_at = now()
                    WHERE tenant_id = ${req.tenantId} AND id = ${next}`
          await tx`UPDATE local_info_items SET merged_into = ${next}, updated_at = now()
                    WHERE tenant_id = ${req.tenantId} AND merged_into = ${old} AND source_id <> ${source.id} AND id <> ${next}`
        }
      }
      if (!b.dry_run && del.length) {
        await tx`DELETE FROM local_info_items WHERE tenant_id = ${req.tenantId} AND id = ANY(${del}::uuid[])`
      }
      if (!b.dry_run && hide.length) {
        await tx`UPDATE local_info_items SET hidden = true, updated_at = now()
                  WHERE tenant_id = ${req.tenantId} AND id = ANY(${hide}::uuid[])`
      }
      return {
        dry_run: b.dry_run, today, from, until,
        deleted: del.length, hidden: hide.length, kept: rows.length - del.length - hide.length,
        handed_over: handedOver.size,
        examples: rows.filter(r => deleteAction(r) !== 'keep').slice(0, DELETE_EXAMPLES).map(r => ({
          id: r.id, title: r.title, kind: r.kind, starts_on: r.starts_on, ends_on: r.ends_on,
          venue_id: r.venue_id, captured: !!r.source_id, action: deleteAction(r),
        })),
      }
    })
  })
}

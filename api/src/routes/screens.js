// src/routes/screens.js
//
// Menu screens admin API, /api/screens (migration 166, module `screens`):
// reads need view, changes need manage.
//
//   GET    /screens                    { screens (online state, what they show), player_url }
//   POST   /screens/claim              { code, name, venue_id, ..., screen_id? } pair the
//                                      screen showing `code` (a new screen, or a new
//                                      device for an existing one)
//   PATCH  /screens/reorder            { ids }
//   PATCH  /screens/:id                { name, venue_id, width, height, rotation, fit,
//                                        design_id | playlist_id }
//   DELETE /screens/:id                (the device goes back to showing a code)
//   POST   /screens/:id/identify       name and number on the screen for 20 s (view)
//   POST   /screens/:id/reload         the screen reloads the player
//   GET    /designs                    boards, with what uses each
//   POST   /designs                    { name, width, height, copy_from? }
//   GET    /designs/:id
//   PUT    /designs/:id                { name, width, height, layout }
//   DELETE /designs/:id
//   GET    /playlists                  with their items
//   POST   /playlists                  { name }
//   PUT    /playlists/:id              { name, items: [{ design_id, duration_secs, schedule }] }
//   DELETE /playlists/:id
//   GET    /menu-data?version=&venue_id=   menus, tags and sold out for the designer
//
// Every change that a screen shows is announced to the tenant's screens
// ('screens-t:<tenant>' or 'screen:<id>'); they fetch their config again.

import { z } from 'zod'
import { sql, withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { broadcast } from '../config/ws.js'
import { sha256, normaliseScreenCode, forgetScreen } from '../services/screenAuth.js'
import { designerData, tenantRoom, screenRoom } from '../services/screenSvc.js'
import { screensOrigin } from '../services/platformHost.js'
import { normalizeBoard, MIN_SIZE, MAX_SIZE } from '../../../shared/screenLayout.js'

const PERM = {
  view:   [requirePermission('screens', 'view')],
  manage: [requirePermission('screens', 'manage')],
}

const UUID = z.string().uuid()
const SIZE = z.number().int().min(MIN_SIZE).max(MAX_SIZE)
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const ONLINE_MS = 150_000
const MAX_LAYOUT_BYTES = 500_000

const Schedule = z.object({
  from: DATE.nullable().optional(),
  until: DATE.nullable().optional(),
  times: z.array(z.object({
    days: z.array(z.number().int().min(0).max(6)).max(7),
    start: HHMM,
    end: HHMM,
  })).max(20).optional(),
}).nullable().optional()

function scheduleProblem(s) {
  if (!s) return null
  if (s.from && s.until && s.until < s.from) return 'The end date is before the start date'
  for (const t of s.times || []) {
    if (!t.days.length) return 'Pick at least one day for each time'
    if (t.end <= t.start) return 'A time must end after it starts (no overnight times)'
  }
  return null
}

function cleanSchedule(s) {
  if (!s) return null
  const out = { from: s.from || null, until: s.until || null, times: (s.times || []).map(t => ({ days: [...new Set(t.days)].sort(), start: t.start, end: t.end })) }
  return out.from || out.until || out.times.length ? out : null
}

function tell(room, message) {
  try { broadcast(room, message) } catch { /* no socket server */ }
}

async function ownVenue(tx, tenantId, venueId) {
  const [v] = await tx`SELECT id, name FROM venues WHERE id = ${venueId} AND tenant_id = ${tenantId}`
  if (!v) throw httpError(422, 'Pick one of your venues')
  return v
}

async function checkContent(tx, tenantId, { design_id, playlist_id }) {
  if (design_id && playlist_id) throw httpError(422, 'Pick a board or a playlist, not both')
  if (design_id) {
    const [d] = await tx`SELECT id FROM screen_designs WHERE id = ${design_id} AND tenant_id = ${tenantId}`
    if (!d) throw httpError(422, 'That board doesn\'t exist')
  }
  if (playlist_id) {
    const [p] = await tx`SELECT id FROM screen_playlists WHERE id = ${playlist_id} AND tenant_id = ${tenantId}`
    if (!p) throw httpError(422, 'That playlist doesn\'t exist')
  }
}

function screenView(s, names) {
  const online = !!s.last_seen_at && Date.now() - new Date(s.last_seen_at).getTime() < ONLINE_MS
  return {
    id: s.id, name: s.name, short_code: s.short_code, venue_id: s.venue_id, venue_name: s.venue_name,
    width: s.width, height: s.height, rotation: s.rotation, fit: s.fit,
    design_id: s.design_id, playlist_id: s.playlist_id,
    shows: s.playlist_id ? { kind: 'playlist', name: names.playlists.get(s.playlist_id) || null }
      : s.design_id ? { kind: 'board', name: names.designs.get(s.design_id) || null } : null,
    paired: !!s.secret_hash, paired_at: s.paired_at, last_seen_at: s.last_seen_at, online,
    app_version: s.app_version, device_info: s.device_info || {}, status: s.status || {},
    sort_order: s.sort_order,
  }
}

async function nextShortCode(tx, tenantId) {
  const rows = await tx`SELECT short_code FROM screens WHERE tenant_id = ${tenantId}`
  const used = new Set(rows.map(r => r.short_code))
  for (let i = 1; i < 10_000; i++) if (!used.has('S' + i)) return 'S' + i
  throw httpError(422, 'Too many screens')
}

async function loadScreens(tx, tenantId) {
  const [rows, designs, playlists] = await Promise.all([
    tx`SELECT s.*, v.name AS venue_name FROM screens s
         JOIN venues v ON v.id = s.venue_id AND v.tenant_id = s.tenant_id
        WHERE s.tenant_id = ${tenantId}
        ORDER BY s.sort_order, s.created_at`,
    tx`SELECT id, name FROM screen_designs WHERE tenant_id = ${tenantId}`,
    tx`SELECT id, name FROM screen_playlists WHERE tenant_id = ${tenantId}`,
  ])
  const names = { designs: new Map(designs.map(d => [d.id, d.name])), playlists: new Map(playlists.map(p => [p.id, p.name])) }
  return rows.map(s => screenView(s, names))
}

const LayoutBody = z.record(z.any())

export default async function screensRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // ── Screens ──────────────────────────────────────────────────────

  app.get('/screens', { preHandler: PERM.view }, async req => ({
    screens: await withTenant(req.tenantId, tx => loadScreens(tx, req.tenantId)),
    player_url: screensOrigin(),
  }))

  app.post('/screens/claim', { preHandler: PERM.manage, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async req => {
    const b = z.object({
      code: z.string().min(4).max(20),
      screen_id: UUID.nullable().optional(),       // a new device for this screen
      name: z.string().trim().min(1).max(80).optional(),
      venue_id: UUID.optional(),
      width: SIZE.optional(), height: SIZE.optional(),
      rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
      design_id: UUID.nullable().optional(),
      playlist_id: UUID.nullable().optional(),
    }).parse(req.body)
    const codeHash = sha256(normaliseScreenCode(b.code))
    const screen = await withTenant(req.tenantId, async tx => {
      // Pairings have no tenant until claimed; lock this one.
      const [p] = await tx`
        SELECT id, secret_hash, device_info, expires_at, screen_id FROM screen_pairings
         WHERE code_hash = ${codeHash} FOR UPDATE`
      if (!p || p.screen_id || new Date(p.expires_at) <= new Date()) {
        throw httpError(422, 'That code isn\'t right or has run out: check the screen shows the same code')
      }
      const info = p.device_info || {}
      let row
      if (b.screen_id) {
        ;[row] = await tx`
          UPDATE screens SET secret_hash = ${p.secret_hash}, paired_at = now(), last_seen_at = NULL,
                 device_info = ${tx.json(info)}, status = '{}'::jsonb, app_version = ${info.app_version || null}
           WHERE id = ${b.screen_id} AND tenant_id = ${req.tenantId}
           RETURNING id`
        if (!row) throw httpError(404, 'Screen not found')
      } else {
        if (!b.name || !b.venue_id) throw httpError(422, 'Give the screen a name and a venue')
        await ownVenue(tx, req.tenantId, b.venue_id)
        await checkContent(tx, req.tenantId, b)
        // The device's own size, the right way round, unless one was typed.
        const devW = Math.round((info.width || 0) * (info.dpr || 1))
        const devH = Math.round((info.height || 0) * (info.dpr || 1))
        const ok = n => n >= MIN_SIZE && n <= MAX_SIZE
        const width = b.width ?? (ok(devW) ? devW : 1920)
        const height = b.height ?? (ok(devH) ? devH : 1080)
        const [{ next }] = await tx`SELECT COALESCE(MAX(sort_order) + 1, 0) AS next FROM screens WHERE tenant_id = ${req.tenantId}`
        ;[row] = await tx`
          INSERT INTO screens (tenant_id, venue_id, name, short_code, width, height, rotation, design_id, playlist_id,
                               secret_hash, paired_at, device_info, app_version, sort_order)
          VALUES (${req.tenantId}, ${b.venue_id}, ${b.name}, ${await nextShortCode(tx, req.tenantId)}, ${width}, ${height},
                  ${b.rotation ?? 0}, ${b.design_id ?? null}, ${b.playlist_id ?? null},
                  ${p.secret_hash}, now(), ${tx.json(info)}, ${info.app_version || null}, ${next})
          RETURNING id`
      }
      await tx`UPDATE screen_pairings SET claimed_at = now(), screen_id = ${row.id}, tenant_id = ${req.tenantId} WHERE id = ${p.id}`
      const all = await loadScreens(tx, req.tenantId)
      return all.find(s => s.id === row.id)
    })
    forgetScreen(screen.id)
    // A replaced device finds its secret no longer works and shows a code.
    tell(screenRoom(screen.id), { type: 'screens.changed' })
    return screen
  })

  app.patch('/screens/reorder', { preHandler: PERM.manage }, async req => {
    const { ids } = z.object({ ids: z.array(UUID).max(500) }).parse(req.body)
    await withTenant(req.tenantId, async tx => {
      for (const [i, id] of ids.entries()) {
        await tx`UPDATE screens SET sort_order = ${i} WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      }
    })
    return { ok: true }
  })

  app.patch('/screens/:id', { preHandler: PERM.manage }, async req => {
    const id = UUID.parse(req.params.id)
    const b = z.object({
      name: z.string().trim().min(1).max(80).optional(),
      venue_id: UUID.optional(),
      width: SIZE.optional(), height: SIZE.optional(),
      rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
      fit: z.enum(['contain', 'cover', 'stretch']).optional(),
      design_id: UUID.nullable().optional(),
      playlist_id: UUID.nullable().optional(),
    }).parse(req.body)
    const screen = await withTenant(req.tenantId, async tx => {
      const [cur] = await tx`SELECT id, design_id, playlist_id FROM screens WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      if (!cur) throw httpError(404, 'Screen not found')
      if (b.venue_id) await ownVenue(tx, req.tenantId, b.venue_id)
      // Showing a board clears the playlist and the other way round.
      let content = null
      if (b.design_id && b.playlist_id) throw httpError(422, 'Pick a board or a playlist, not both')
      if ('design_id' in b || 'playlist_id' in b) {
        content = { design_id: cur.design_id, playlist_id: cur.playlist_id }
        if ('design_id' in b) { content.design_id = b.design_id ?? null; if (b.design_id) content.playlist_id = null }
        if ('playlist_id' in b) { content.playlist_id = b.playlist_id ?? null; if (b.playlist_id) content.design_id = null }
        await checkContent(tx, req.tenantId, content)
      }
      const { design_id: _d, playlist_id: _p, ...patch } = b
      const fields = Object.keys(patch).filter(k => patch[k] !== undefined)
      if (fields.length) await tx`UPDATE screens SET ${tx(patch, ...fields)} WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      if (content) {
        await tx`UPDATE screens SET design_id = ${content.design_id}, playlist_id = ${content.playlist_id}
                  WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      }
      return (await loadScreens(tx, req.tenantId)).find(s => s.id === id)
    })
    tell(screenRoom(id), { type: 'screens.changed' })
    return screen
  })

  app.delete('/screens/:id', { preHandler: PERM.manage }, async req => {
    const id = UUID.parse(req.params.id)
    const [row] = await withTenant(req.tenantId, tx =>
      tx`DELETE FROM screens WHERE id = ${id} AND tenant_id = ${req.tenantId} RETURNING id`)
    if (!row) throw httpError(404, 'Screen not found')
    forgetScreen(id)
    tell(screenRoom(id), { type: 'screen.removed' })
    return { ok: true }
  })

  app.post('/screens/:id/identify', { preHandler: PERM.view }, async req => {
    const id = UUID.parse(req.params.id)
    const [s] = await withTenant(req.tenantId, tx =>
      tx`SELECT id, name, short_code FROM screens WHERE id = ${id} AND tenant_id = ${req.tenantId}`)
    if (!s) throw httpError(404, 'Screen not found')
    tell(screenRoom(id), { type: 'screen.identify', seconds: 20 })
    return { ok: true }
  })

  app.post('/screens/:id/reload', { preHandler: PERM.manage }, async req => {
    const id = UUID.parse(req.params.id)
    const [s] = await withTenant(req.tenantId, tx =>
      tx`SELECT id FROM screens WHERE id = ${id} AND tenant_id = ${req.tenantId}`)
    if (!s) throw httpError(404, 'Screen not found')
    tell(screenRoom(id), { type: 'screen.reload' })
    return { ok: true }
  })

  // ── Boards ───────────────────────────────────────────────────────

  app.get('/designs', { preHandler: PERM.view }, async req => withTenant(req.tenantId, async tx => {
    const rows = await tx`
      SELECT d.id, d.name, d.width, d.height, d.updated_at, d.updated_by,
             jsonb_array_length(COALESCE(d.layout -> 'blocks', '[]'::jsonb)) AS block_count,
             (SELECT count(*)::int FROM screens s WHERE s.design_id = d.id AND s.tenant_id = d.tenant_id) AS screen_count,
             (SELECT count(DISTINCT i.playlist_id)::int FROM screen_playlist_items i WHERE i.design_id = d.id AND i.tenant_id = d.tenant_id) AS playlist_count
        FROM screen_designs d
       WHERE d.tenant_id = ${req.tenantId}
       ORDER BY d.name, d.created_at`
    return rows
  }))

  app.post('/designs', { preHandler: PERM.manage }, async req => {
    const b = z.object({
      name: z.string().trim().min(1).max(120),
      width: SIZE.optional(), height: SIZE.optional(),
      copy_from: UUID.nullable().optional(),
    }).parse(req.body)
    return withTenant(req.tenantId, async tx => {
      let width = b.width ?? 1920, height = b.height ?? 1080, layout = {}
      if (b.copy_from) {
        const [src] = await tx`SELECT width, height, layout FROM screen_designs WHERE id = ${b.copy_from} AND tenant_id = ${req.tenantId}`
        if (!src) throw httpError(404, 'Board not found')
        width = b.width ?? src.width; height = b.height ?? src.height; layout = src.layout || {}
      }
      const [row] = await tx`
        INSERT INTO screen_designs (tenant_id, name, width, height, layout, created_by, updated_by)
        VALUES (${req.tenantId}, ${b.name}, ${width}, ${height}, ${tx.json(layout)}, ${req.user?.email ?? null}, ${req.user?.email ?? null})
        RETURNING id, name, width, height, layout, updated_at`
      return row
    })
  })

  app.get('/designs/:id', { preHandler: PERM.view }, async req => {
    const id = UUID.parse(req.params.id)
    const [row] = await withTenant(req.tenantId, tx =>
      tx`SELECT id, name, width, height, layout, updated_at, updated_by FROM screen_designs WHERE id = ${id} AND tenant_id = ${req.tenantId}`)
    if (!row) throw httpError(404, 'Board not found')
    return row
  })

  app.put('/designs/:id', { preHandler: PERM.manage, bodyLimit: 2_000_000 }, async req => {
    const id = UUID.parse(req.params.id)
    const b = z.object({
      name: z.string().trim().min(1).max(120),
      width: SIZE, height: SIZE,
      layout: LayoutBody,
    }).parse(req.body)
    if (JSON.stringify(b.layout).length > MAX_LAYOUT_BYTES) throw httpError(413, 'This board is too big to save: remove some blocks')
    // Stored as the renderer reads it (unknown block types dropped, sizes clamped).
    const { width: _w, height: _h, ...layout } = normalizeBoard(b.layout, b.width, b.height)
    const row = await withTenant(req.tenantId, async tx => {
      const [r] = await tx`
        UPDATE screen_designs SET name = ${b.name}, width = ${b.width}, height = ${b.height}, layout = ${tx.json(layout)},
               updated_by = ${req.user?.email ?? null}
         WHERE id = ${id} AND tenant_id = ${req.tenantId}
         RETURNING id, name, width, height, layout, updated_at, updated_by`
      if (!r) throw httpError(404, 'Board not found')
      return r
    })
    tell(tenantRoom(req.tenantId), { type: 'screens.changed' })
    return row
  })

  app.delete('/designs/:id', { preHandler: PERM.manage }, async req => {
    const id = UUID.parse(req.params.id)
    const [row] = await withTenant(req.tenantId, tx =>
      tx`DELETE FROM screen_designs WHERE id = ${id} AND tenant_id = ${req.tenantId} RETURNING id`)
    if (!row) throw httpError(404, 'Board not found')
    tell(tenantRoom(req.tenantId), { type: 'screens.changed' })
    return { ok: true }
  })

  // ── Playlists ────────────────────────────────────────────────────

  async function loadPlaylists(tx, tenantId, id = null) {
    const [lists, items, screens] = await Promise.all([
      tx`SELECT id, name, updated_at FROM screen_playlists WHERE tenant_id = ${tenantId} ${id ? tx`AND id = ${id}` : tx``} ORDER BY name, created_at`,
      tx`SELECT i.id, i.playlist_id, i.design_id, i.duration_secs, i.schedule, i.sort_order, d.name AS design_name
           FROM screen_playlist_items i JOIN screen_designs d ON d.id = i.design_id AND d.tenant_id = i.tenant_id
          WHERE i.tenant_id = ${tenantId} ${id ? tx`AND i.playlist_id = ${id}` : tx``}
          ORDER BY i.sort_order, i.id`,
      tx`SELECT playlist_id, count(*)::int AS n FROM screens WHERE tenant_id = ${tenantId} AND playlist_id IS NOT NULL GROUP BY playlist_id`,
    ])
    const used = new Map(screens.map(s => [s.playlist_id, s.n]))
    return lists.map(l => ({
      ...l,
      screen_count: used.get(l.id) || 0,
      items: items.filter(i => i.playlist_id === l.id).map(({ playlist_id, ...i }) => ({ ...i, schedule: i.schedule || null })),
    }))
  }

  app.get('/playlists', { preHandler: PERM.view }, async req =>
    withTenant(req.tenantId, tx => loadPlaylists(tx, req.tenantId)))

  app.post('/playlists', { preHandler: PERM.manage }, async req => {
    const b = z.object({ name: z.string().trim().min(1).max(120) }).parse(req.body)
    return withTenant(req.tenantId, async tx => {
      const [row] = await tx`INSERT INTO screen_playlists (tenant_id, name) VALUES (${req.tenantId}, ${b.name}) RETURNING id`
      return (await loadPlaylists(tx, req.tenantId, row.id))[0]
    })
  })

  app.put('/playlists/:id', { preHandler: PERM.manage }, async req => {
    const id = UUID.parse(req.params.id)
    const b = z.object({
      name: z.string().trim().min(1).max(120),
      items: z.array(z.object({
        design_id: UUID,
        duration_secs: z.number().int().min(3).max(3600).default(15),
        schedule: Schedule,
      })).max(100),
    }).parse(req.body)
    for (const [i, it] of b.items.entries()) {
      const p = scheduleProblem(it.schedule)
      if (p) throw httpError(422, 'Board ' + (i + 1) + ': ' + p)
    }
    const playlist = await withTenant(req.tenantId, async tx => {
      const [cur] = await tx`SELECT id FROM screen_playlists WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      if (!cur) throw httpError(404, 'Playlist not found')
      const ids = [...new Set(b.items.map(i => i.design_id))]
      if (ids.length) {
        const found = await tx`SELECT id FROM screen_designs WHERE tenant_id = ${req.tenantId} AND id = ANY(${ids}::uuid[])`
        if (found.length !== ids.length) throw httpError(422, 'A board in the list doesn\'t exist')
      }
      await tx`UPDATE screen_playlists SET name = ${b.name} WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      await tx`DELETE FROM screen_playlist_items WHERE playlist_id = ${id} AND tenant_id = ${req.tenantId}`
      for (const [i, it] of b.items.entries()) {
        const sched = cleanSchedule(it.schedule)
        await tx`
          INSERT INTO screen_playlist_items (tenant_id, playlist_id, design_id, duration_secs, schedule, sort_order)
          VALUES (${req.tenantId}, ${id}, ${it.design_id}, ${it.duration_secs}, ${sched ? tx.json(sched) : null}, ${i})`
      }
      return (await loadPlaylists(tx, req.tenantId, id))[0]
    })
    tell(tenantRoom(req.tenantId), { type: 'screens.changed' })
    return playlist
  })

  app.delete('/playlists/:id', { preHandler: PERM.manage }, async req => {
    const id = UUID.parse(req.params.id)
    const [row] = await withTenant(req.tenantId, tx =>
      tx`DELETE FROM screen_playlists WHERE id = ${id} AND tenant_id = ${req.tenantId} RETURNING id`)
    if (!row) throw httpError(404, 'Playlist not found')
    tell(tenantRoom(req.tenantId), { type: 'screens.changed' })
    return { ok: true }
  })

  // ── Designer data ────────────────────────────────────────────────

  app.get('/menu-data', { preHandler: PERM.view }, async req => {
    const q = z.object({
      version: z.enum(['live', 'draft']).default('live'),
      venue_id: UUID.optional(),
    }).parse(req.query)
    return withTenant(req.tenantId, async tx => {
      if (q.venue_id) await ownVenue(tx, req.tenantId, q.venue_id)
      return designerData(tx, req.tenantId, { version: q.version, venueId: q.venue_id || null })
    })
  })
}

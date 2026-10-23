// src/services/menuReleases.js
//
// Menu publishing (migration 165). The menu tables are the draft; a release
// is a frozen copy of a menu (shared/menuDiff.js releaseContent()) with the
// time it goes live. The live version of a menu is its newest release
// whose goes_live_at has passed and that wasn't cancelled.
//
//   loadMenuVersion(tx, menuId, tenantId, { version, releaseId })
//       one menu in the shape loadMenuFull() returns: 'draft' (the tables),
//       'live' (default) or a given release. Tenant-wide parts are always
//       current: the tag list, the allergen notice, the print design choice.
//   loadMenuVersions(tx, tenantId, { menuIds, venueId, publishedOnly, version })
//       several menus at once, in menu order, filtered on the version's own
//       venue and "shown to guests" settings.
//   publishMenu / cancelRelease / releaseHistory / publishStatus / menuStatuses
//   announceDueReleases(log)   minute sweep: tells tills (and screens) about
//                              releases that went live since the last run
//   backfillFirstReleases(log) at start-up: a first release for menus that
//                              existed before publishing (needs_first_release)
//
// Releases never change after insert, so their content is cached in memory
// by id. Every reader of what guests or tills see goes through here; the
// admin editors (Menus page, allergen matrix, designer, AI change tools)
// read and write the draft.

import { createHash } from 'node:crypto'
import { sql, withTenant, systemSql } from '../config/db.js'
import { httpError } from '../middleware/error.js'
import { broadcast } from '../config/ws.js'
import { tillsMayNeedConfig } from './posNotify.js'
import { loadMenuFull, loadAllergenNotice } from '../routes/menus.js'
import { releaseContent, contentKey, diffMenus, withShownGroupNames } from '../../../shared/menuDiff.js'

export const VERSIONS = ['live', 'draft']
const MAX_AHEAD_DAYS = 400

// ── Content cache (release id -> content), small LRU ─────────────
const cache = new Map()
const CACHE_MAX = 300
function remember(id, content) {
  cache.delete(id)
  cache.set(id, content)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
}
function recall(id) {
  const c = cache.get(id)
  if (c) { cache.delete(id); cache.set(id, c) }
  return c
}

export const contentHash = content => createHash('sha256').update(contentKey(content)).digest('hex')

/** Release rows (no content) live at `at` (default now), one per menu. */
async function liveRows(tx, tenantId, menuIds = null, at = null) {
  return tx`
    SELECT DISTINCT ON (menu_id) id, menu_id, goes_live_at, content_hash
      FROM menu_releases
     WHERE tenant_id = ${tenantId} AND cancelled_at IS NULL
       AND goes_live_at <= COALESCE(${at}::timestamptz, now())
       ${menuIds ? tx`AND menu_id = ANY(${menuIds}::uuid[])` : tx``}
     ORDER BY menu_id, goes_live_at DESC, created_at DESC
  `
}

/** Content for release rows, from the cache or one query. */
async function contentsFor(tx, tenantId, rows) {
  const missing = rows.filter(r => !recall(r.id)).map(r => r.id)
  if (missing.length) {
    const found = await tx`
      SELECT id, snapshot FROM menu_releases
       WHERE tenant_id = ${tenantId} AND id = ANY(${missing}::uuid[])
    `
    for (const f of found) remember(f.id, f.snapshot)
  }
  return new Map(rows.map(r => [r.id, recall(r.id)]))
}

/** The live tenant-wide parts every version shows: tags, allergen notice, print designs. */
async function tenantExtras(tx, tenantId, menuIds) {
  const [tags, notice, rows] = await Promise.all([
    tx`SELECT * FROM menu_dietary_tags WHERE tenant_id = ${tenantId} ORDER BY kind = 'allergen', sort_order, label`,
    loadAllergenNotice(tx, tenantId),
    menuIds.length ? tx`
      SELECT m.id, m.print_design_id,
             (SELECT count(*)::int FROM menu_print_designs d WHERE d.menu_id = m.id) AS design_count
        FROM menus m WHERE m.tenant_id = ${tenantId} AND m.id = ANY(${menuIds}::uuid[])` : [],
  ])
  return { tags, notice, byMenu: new Map(rows.map(r => [r.id, r])) }
}

function withExtras(content, extras, release) {
  // A deep-ish copy: callers filter sections and items in place.
  const menu = {
    ...content,
    sections: (content.sections || []).map(s => ({ ...s, items: (s.items || []).map(i => ({ ...i })) })),
    callouts: (content.callouts || []).map(c => ({ ...c })),
  }
  const m = extras.byMenu.get(content.id)
  menu.dietary_tags = extras.tags
  menu.allergen_notice = extras.notice
  menu.print_design_id = m?.print_design_id ?? null
  menu.design_count = m?.design_count ?? 0
  menu.version = release ? 'live' : 'draft'
  if (release) {
    menu.release_id = release.id
    menu.release_goes_live_at = release.goes_live_at
  }
  return menu
}

/**
 * One menu, loadMenuFull()-shaped. version 'live' (default) = what guests
 * and tills see now; 'draft' = the menu tables; releaseId = that release
 * (a scheduled one, for print previews). null when there is none.
 */
export async function loadMenuVersion(tx, menuId, tenantId, { version = 'live', releaseId = null } = {}) {
  if (version === 'draft' && !releaseId) {
    // Option groups by their display names, as a release would have them.
    const full = withShownGroupNames(await loadMenuFull(tx, menuId, tenantId))
    if (full) full.version = 'draft'
    return full
  }
  let row
  if (releaseId) {
    ;[row] = await tx`
      SELECT id, menu_id, goes_live_at FROM menu_releases
       WHERE id = ${releaseId} AND menu_id = ${menuId} AND tenant_id = ${tenantId} AND cancelled_at IS NULL`
  } else {
    ;[row] = await liveRows(tx, tenantId, [menuId])
  }
  if (!row) return null
  const content = (await contentsFor(tx, tenantId, [row])).get(row.id)
  if (!content) return null
  const extras = await tenantExtras(tx, tenantId, [menuId])
  if (!extras.byMenu.has(menuId)) return null   // menu deleted
  return withExtras(content, extras, row)
}

/**
 * Several menus at once, sorted like the Menus page. Filters use the
 * version's own settings: venueId keeps menus for that venue or all
 * venues, publishedOnly keeps those shown to guests, menuIds keeps those.
 */
export async function loadMenuVersions(tx, tenantId, { menuIds = null, venueId = null, publishedOnly = false, version = 'live' } = {}) {
  let menus
  if (version === 'draft') {
    const rows = await tx`
      SELECT id FROM menus WHERE tenant_id = ${tenantId}
        ${menuIds ? tx`AND id = ANY(${menuIds}::uuid[])` : tx``}`
    menus = []
    for (const r of rows) {
      const full = withShownGroupNames(await loadMenuFull(tx, r.id, tenantId))
      if (full) { full.version = 'draft'; menus.push(full) }
    }
  } else {
    const rows = await liveRows(tx, tenantId, menuIds)
    if (!rows.length) return []
    const contents = await contentsFor(tx, tenantId, rows)
    const extras = await tenantExtras(tx, tenantId, rows.map(r => r.menu_id))
    menus = rows
      .filter(r => contents.get(r.id) && extras.byMenu.has(r.menu_id))
      .map(r => withExtras(contents.get(r.id), extras, r))
  }
  return menus
    .filter(m => !venueId || !m.venue_id || m.venue_id === venueId)
    .filter(m => !publishedOnly || m.is_published)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name).localeCompare(String(b.name)))
}

// ── Publishing ───────────────────────────────────────────────────

function releaseView(r, now = new Date()) {
  const live = !r.cancelled_at && new Date(r.goes_live_at) <= now
  return {
    id: r.id, goes_live_at: r.goes_live_at, note: r.note ?? null,
    published_by: r.published_by ?? null, created_at: r.created_at,
    cancelled_at: r.cancelled_at ?? null, cancelled_by: r.cancelled_by ?? null,
    state: r.cancelled_at ? 'cancelled' : live ? 'live_or_past' : 'scheduled',
  }
}

/**
 * Publish the draft: now (at empty or not in the future) or at `at`.
 * Refuses when the draft matches the live version (nothing to publish).
 * Returns { release, immediate }. The caller tells tills when immediate.
 */
export async function publishMenu(tx, tenantId, menuId, { at = null, note = null, by = null } = {}) {
  const draft = await loadMenuFull(tx, menuId, tenantId)
  if (!draft) throw httpError(404, 'Menu not found')
  const content = releaseContent(draft)
  const hash = contentHash(content)
  const now = new Date()
  let when = at ? new Date(at) : now
  if (isNaN(when)) throw httpError(400, 'Pick a valid date and time')
  if (when - now > MAX_AHEAD_DAYS * 86_400_000) throw httpError(400, 'Pick a time within the next year')
  const immediate = when <= new Date(now.getTime() + 30_000)
  if (immediate) when = now
  const [live] = await liveRows(tx, tenantId, [menuId])
  if (live && live.content_hash === hash) {
    throw httpError(422, 'Nothing to publish: the live menu already matches the draft.')
  }
  const [release] = await tx`
    INSERT INTO menu_releases (tenant_id, menu_id, snapshot, content_hash, goes_live_at, note, published_by, announced_at)
    VALUES (${tenantId}, ${menuId}, ${tx.json(content)}, ${hash}, ${when}, ${note || null}, ${by},
            ${immediate ? now : null})
    RETURNING id, menu_id, goes_live_at, note, published_by, created_at, cancelled_at, cancelled_by
  `
  await tx`UPDATE menus SET needs_first_release = false WHERE id = ${menuId} AND tenant_id = ${tenantId}`
  remember(release.id, content)
  return { release: releaseView(release), immediate }
}

/** Withdraw a scheduled release before it goes live. */
export async function cancelRelease(tx, tenantId, menuId, releaseId, by = null) {
  const [r] = await tx`
    SELECT id, goes_live_at, cancelled_at FROM menu_releases
     WHERE id = ${releaseId} AND menu_id = ${menuId} AND tenant_id = ${tenantId}`
  if (!r) throw httpError(404, 'Publish not found')
  if (r.cancelled_at) throw httpError(422, 'That publish was already cancelled')
  if (new Date(r.goes_live_at) <= new Date()) throw httpError(422, 'That publish has already gone live. Publish again to change the menu.')
  const [row] = await tx`
    UPDATE menu_releases SET cancelled_at = now(), cancelled_by = ${by}
     WHERE id = ${r.id} AND tenant_id = ${tenantId}
     RETURNING id, menu_id, goes_live_at, note, published_by, created_at, cancelled_at, cancelled_by`
  return releaseView(row)
}

/** A menu's publishes, newest first, with which one is live now. */
export async function releaseHistory(tx, tenantId, menuId, limit = 30) {
  const rows = await tx`
    SELECT id, menu_id, goes_live_at, note, published_by, created_at, cancelled_at, cancelled_by
      FROM menu_releases WHERE tenant_id = ${tenantId} AND menu_id = ${menuId}
     ORDER BY goes_live_at DESC, created_at DESC LIMIT ${limit}`
  const [live] = await liveRows(tx, tenantId, [menuId])
  return rows.map(r => {
    const v = releaseView(r)
    if (v.state === 'live_or_past') v.state = live && live.id === r.id ? 'live' : 'past'
    return v
  })
}

/**
 * For the menu editor: what is live, what is scheduled, and what the
 * draft changes compared with the live version.
 */
export async function publishStatus(tx, tenantId, menuId) {
  const draft = await loadMenuFull(tx, menuId, tenantId)
  if (!draft) throw httpError(404, 'Menu not found')
  const live = await loadMenuVersion(tx, menuId, tenantId)
  const history = await releaseHistory(tx, tenantId, menuId)
  const scheduled = history.filter(h => h.state === 'scheduled').sort((a, b) => new Date(a.goes_live_at) - new Date(b.goes_live_at))
  const changes = diffMenus(live ? releaseContent(live) : null, releaseContent(draft))
  const inSync = !!live && contentKey(live) === contentKey(draft)
  return {
    menu_id: menuId,
    live: live ? { release_id: live.release_id, goes_live_at: live.release_goes_live_at, is_published: !!live.is_published } : null,
    scheduled,
    in_sync: inSync,
    changes: inSync ? [] : changes,
    history,
  }
}

/** Menus page list: per menu { live_at, scheduled_at, changed } (draft vs live). */
export async function menuStatuses(tx, tenantId, menuIds) {
  if (!menuIds.length) return {}
  const live = await liveRows(tx, tenantId, menuIds)
  const liveBy = new Map(live.map(r => [r.menu_id, r]))
  const sched = await tx`
    SELECT menu_id, min(goes_live_at) AS next_at, count(*)::int AS n FROM menu_releases
     WHERE tenant_id = ${tenantId} AND menu_id = ANY(${menuIds}::uuid[])
       AND cancelled_at IS NULL AND goes_live_at > now()
     GROUP BY menu_id`
  const schedBy = new Map(sched.map(r => [r.menu_id, r]))
  const out = {}
  for (const id of menuIds) {
    const draft = await loadMenuFull(tx, id, tenantId)
    const l = liveBy.get(id)
    out[id] = {
      live_at: l?.goes_live_at ?? null,
      scheduled_at: schedBy.get(id)?.next_at ?? null,
      scheduled_count: schedBy.get(id)?.n ?? 0,
      changed: !l || !draft || l.content_hash !== contentHash(releaseContent(draft)),
    }
  }
  return out
}

// ── Telling devices ─────────────────────────────────────────────

/** Tills reload their config; screens (and anything else) get menus.live. */
export function announceMenus(tenantId, menuIds, log) {
  tillsMayNeedConfig(tenantId, log)
  try { broadcast('menus:' + tenantId, { type: 'menus.live', menu_ids: menuIds }) } catch { /* no socket server */ }
}

/** Minute sweep: releases that went live since the last run. */
export async function announceDueReleases(log) {
  const rows = await systemSql`
    UPDATE menu_releases SET announced_at = now()
     WHERE announced_at IS NULL AND cancelled_at IS NULL AND goes_live_at <= now()
     RETURNING tenant_id, menu_id`
  const byTenant = new Map()
  for (const r of rows) byTenant.set(r.tenant_id, [...(byTenant.get(r.tenant_id) || []), r.menu_id])
  for (const [tenantId, menuIds] of byTenant) announceMenus(tenantId, menuIds, log)
  return rows.length
}

/**
 * Start-up: releases whose content a migration rewrote (content_hash '',
 * migration 170) get their hash again, so an unchanged draft still reads
 * as published.
 */
export async function rehashReleases(log) {
  const rows = await systemSql`SELECT id, tenant_id, snapshot FROM menu_releases WHERE content_hash = ''`
  for (const r of rows) {
    try {
      await withTenant(r.tenant_id, tx => tx`
        UPDATE menu_releases SET content_hash = ${contentHash(r.snapshot)}
         WHERE id = ${r.id} AND tenant_id = ${r.tenant_id} AND content_hash = ''`)
    } catch (err) {
      log?.warn?.({ err, release: r.id }, 'Release re-hash failed')
    }
  }
  if (rows.length) log?.info?.({ releases: rows.length }, 'Re-hashed menu releases')
  return rows.length
}

/** Start-up: the first release of every menu made before publishing existed. */
export async function backfillFirstReleases(log) {
  await rehashReleases(log)
  const menus = await systemSql`SELECT id, tenant_id FROM menus WHERE needs_first_release`
  let made = 0
  for (const m of menus) {
    try {
      await withTenant(m.tenant_id, async tx => {
        const [locked] = await tx`
          SELECT id FROM menus WHERE id = ${m.id} AND tenant_id = ${m.tenant_id} AND needs_first_release
           FOR UPDATE SKIP LOCKED`
        if (!locked) return
        const [has] = await tx`SELECT 1 FROM menu_releases WHERE menu_id = ${m.id} AND tenant_id = ${m.tenant_id} LIMIT 1`
        if (!has) {
          const draft = await loadMenuFull(tx, m.id, m.tenant_id)
          if (draft) {
            const content = releaseContent(draft)
            await tx`
              INSERT INTO menu_releases (tenant_id, menu_id, snapshot, content_hash, goes_live_at, note, published_by, announced_at)
              VALUES (${m.tenant_id}, ${m.id}, ${tx.json(content)}, ${contentHash(content)}, now(),
                      'First publish (menu made before publishing)', 'system', now())`
            made++
          }
        }
        await tx`UPDATE menus SET needs_first_release = false WHERE id = ${m.id} AND tenant_id = ${m.tenant_id}`
      })
    } catch (err) {
      log?.warn?.({ err, menu: m.id }, 'First menu release failed')
    }
  }
  if (made) log?.info?.({ made }, 'Published existing menus (first releases)')
  return made
}

// src/services/screenSvc.js
//
// What a menu screen shows (migration 166, docs: Docs.jsx > Menu screens).
//
//   screenConfig(tx, tenantId, screenId)   everything the player needs, one
//       snapshot: the screen's settings, its wall and place in it (a wall's
//       board or playlist replaces the screen's own), its playlist (or
//       single board, with each board's transition),
//       the boards, the LIVE versions of the menus those boards point at
//       (menu_releases, so prices change when a menu is published), the
//       tags, the allergen notice and the venue's sold out dishes.
//       `version` changes whenever any of it does, so a screen only
//       downloads a new one when something changed.
//   designerData(tx, tenantId, { version, venueId })   the same menu data
//       for the admin board designer: every menu, live or draft.
//   playerVersion()   a hash of the player's files (screen/ and the shared
//       files it loads); in the config, so screens reload after a deploy.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadMenuVersions } from './menuReleases.js'
import { loadAllergenNotice } from '../routes/menus.js'
import { soldOutItemIds } from './soldOut.js'
import { sha256 } from './screenAuth.js'
import { boardMenuIds } from '../../../shared/screenLayout.js'
import { menuTags } from '../../../shared/menuTags.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const PLAYER_DIR = path.resolve(__dirname, '..', '..', '..', 'screen')
export const SHARED_DIR = path.resolve(__dirname, '..', '..', '..', 'shared')

// The shared files the player imports (served as /lib/<name> by
// routes/screenSite.js). screenLayout.js imports the others by relative
// path, so they must all be served from the same folder.
export const PLAYER_LIBS = ['screenLayout.js', 'fonts.js', 'menuTags.js', 'orderPricing.js', 'promotions.js', 'menuSchedule.js', 'combos.js']

let versionCache = null
export function playerVersion() {
  if (versionCache) return versionCache
  const h = []
  const walk = dir => {
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else h.push(e.name + ':' + sha256(fs.readFileSync(full)))
    }
  }
  walk(PLAYER_DIR)
  for (const f of PLAYER_LIBS) {
    try { h.push(f + ':' + sha256(fs.readFileSync(path.join(SHARED_DIR, f)))) } catch { /* missing */ }
  }
  versionCache = sha256(h.join('|')).slice(0, 12)
  return versionCache
}

// Only what boards read, to keep the download small.
function slimItem(it) {
  return {
    id: it.id, name: it.name, description: it.description || null, price_pence: it.price_pence ?? null,
    // Combos (migration 171): a board shows them as a menu line or as their steps.
    kind: it.kind === 'combo' ? 'combo' : 'dish', combo: it.kind === 'combo' ? (it.combo || null) : null,
    calories: it.calories ?? null, image_url: it.image_url || null, is_featured: !!it.is_featured,
    dietary: it.dietary || [], allergen_levels: it.allergen_levels || {},
    variants: (it.variants || []).map(v => ({ label: v.label, price_pence: v.price_pence ?? null })),
    variant_groups: (it.variant_groups || []).map(g => ({
      group_id: g.group_id, name: g.name, price_mode: g.price_mode, min_select: g.min_select, max_select: g.max_select,
      options: (g.options || []).map(o => ({ option_id: o.option_id, label: o.label, price_pence: o.price_pence ?? null })),
    })),
  }
}

export function slimMenu(m) {
  return {
    id: m.id, name: m.name, venue_id: m.venue_id || null, is_published: !!m.is_published,
    hide_unpriced_variants: !!m.hide_unpriced_variants, hide_zero_priced_variants: !!m.hide_zero_priced_variants,
    // Sections hidden everywhere never show (as on the printed menu).
    sections: (m.sections || []).filter(s => (s.visibility || 'show') !== 'hidden').map(s => ({
      id: s.id, title: s.title, subtitle: s.subtitle || null, image_url: s.image_url || null,
      items: (s.items || []).map(slimItem),
    })),
  }
}

function slimTags(tags) {
  return menuTags(tags || []).map(t => ({
    code: t.code, label: t.label, glyph: t.glyph, colour: t.colour, kind: t.kind, in_key: t.in_key !== false,
  }))
}

/**
 * The player's whole config for a screen, or null when it doesn't exist.
 * A screen in a wall (migration 167) shows the wall's board or playlist and
 * gets `wall` (its place in it) so it can show its own part.
 */
export async function screenConfig(tx, tenantId, screenId) {
  const [s] = await tx`
    SELECT s.id, s.name, s.short_code, s.width, s.height, s.rotation, s.fit, s.playlist_id, s.design_id, s.venue_id,
           s.wall_id, s.wall_col, s.wall_row,
           v.name AS venue_name, v.timezone
      FROM screens s
      JOIN venues v ON v.id = s.venue_id AND v.tenant_id = s.tenant_id
     WHERE s.id = ${screenId} AND s.tenant_id = ${tenantId}`
  if (!s) return null

  let wall = null
  let source = s
  if (s.wall_id) {
    const [w] = await tx`
      SELECT id, name, cols, rows, gap, playlist_id, design_id FROM screen_walls
       WHERE id = ${s.wall_id} AND tenant_id = ${tenantId}`
    if (w) {
      wall = { id: w.id, name: w.name, cols: w.cols, rows: w.rows, col: s.wall_col ?? 0, row: s.wall_row ?? 0, gap: w.gap }
      source = w
    }
  }

  let playlist = null
  let designIds = []
  if (source.playlist_id) {
    const [p] = await tx`SELECT id, name FROM screen_playlists WHERE id = ${source.playlist_id} AND tenant_id = ${tenantId}`
    if (p) {
      const items = await tx`
        SELECT id, design_id, duration_secs, schedule, transition, transition_ms FROM screen_playlist_items
         WHERE playlist_id = ${p.id} AND tenant_id = ${tenantId}
         ORDER BY sort_order, id`
      playlist = { id: p.id, name: p.name, items: items.map(i => ({ ...i, schedule: i.schedule || null })) }
      designIds = [...new Set(items.map(i => i.design_id))]
    }
  } else if (source.design_id) {
    designIds = [source.design_id]
  }

  const designs = designIds.length ? await tx`
    SELECT id, name, width, height, layout FROM screen_designs
     WHERE tenant_id = ${tenantId} AND id = ANY(${designIds}::uuid[])` : []
  const menuIds = [...new Set(designs.flatMap(d => boardMenuIds(d.layout)))]
  const menus = menuIds.length ? await loadMenuVersions(tx, tenantId, { menuIds }) : []
  const soldOut = await soldOutItemIds(tx, tenantId, s.venue_id)

  const config = {
    player_version: playerVersion(),
    screen: { id: s.id, name: s.name, short_code: s.short_code, width: s.width, height: s.height, rotation: s.rotation, fit: s.fit },
    venue: { id: s.venue_id, name: s.venue_name, timezone: s.timezone || 'Europe/London' },
    wall,
    playlist,
    design_id: playlist ? null : (designs[0]?.id ?? null),
    designs: Object.fromEntries(designs.map(d => [d.id, { id: d.id, name: d.name, width: d.width, height: d.height, layout: d.layout || {} }])),
    menus: menus.map(slimMenu),
    tags: slimTags(menus[0]?.dietary_tags),
    allergen_notice: menus[0]?.allergen_notice || null,
    sold_out: soldOut,
    // A board with an Order status block: the player fetches the order
    // numbers (/screen-api/orders) and refreshes them on kitchen.board.
    needs_orders: designs.some(d => (d.layout?.blocks || []).some(b => b?.type === 'order_status')),
  }
  config.version = sha256(JSON.stringify(config)).slice(0, 16)
  return config
}

/**
 * Menu data for the board designer: every menu (live versions, or the
 * drafts with version 'draft'), the tags, the notice and, for a venue, its
 * sold out dishes. `unpublished` lists menus with no live version yet.
 */
export async function designerData(tx, tenantId, { version = 'live', venueId = null } = {}) {
  const menus = await loadMenuVersions(tx, tenantId, { version })
  let unpublished = []
  if (version === 'live') {
    const all = await tx`SELECT id, name FROM menus WHERE tenant_id = ${tenantId} ORDER BY sort_order, name`
    const live = new Set(menus.map(m => m.id))
    unpublished = all.filter(m => !live.has(m.id)).map(m => ({ id: m.id, name: m.name }))
  }
  const tags = menus[0]?.dietary_tags
    || await tx`SELECT * FROM menu_dietary_tags WHERE tenant_id = ${tenantId} ORDER BY kind = 'allergen', sort_order, label`
  return {
    version,
    menus: menus.map(slimMenu),
    unpublished,
    tags: slimTags(tags),
    allergen_notice: menus[0]?.allergen_notice || await loadAllergenNotice(tx, tenantId),
    sold_out: venueId ? await soldOutItemIds(tx, tenantId, venueId) : [],
    // Order ready boards in the kitchen flows (Order status block: which board).
    order_boards: (await tx`
      SELECT DISTINCT trim(name) AS name FROM kds_stations
       WHERE tenant_id = ${tenantId} AND kind = 'board' AND is_active ORDER BY 1`).map(r => r.name),
  }
}

/** Tell a tenant's screens that boards, playlists or screens changed. */
export const tenantRoom = tenantId => 'screens-t:' + tenantId
export const screenRoom = screenId => 'screen:' + screenId

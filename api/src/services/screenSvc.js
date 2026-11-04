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
import { importClosure } from '../utils/importClosure.js'
import { boardMenuIds, BLOCK_DEFAULTS } from '../../../shared/screenLayout.js'
import { menuTags } from '../../../shared/menuTags.js'
import { statusOf } from '../../../shared/pos/kitchen.js'
import { pullTimes } from '../../../shared/pos/pullTimes.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const PLAYER_DIR = path.resolve(__dirname, '..', '..', '..', 'screen')
export const SHARED_DIR = path.resolve(__dirname, '..', '..', '..', 'shared')

// The shared files the player loads (served as /lib/<path> by
// routes/screenSite.js, kept offline by screen/sw.js): what screen/player.js
// imports from /lib/ and everything those import by relative path, worked out
// from the files themselves (utils/importClosure.js). They must all be served
// from the same folder as in shared/. A list kept by hand once missed two
// files orderPricing.js had started importing, and every screen stopped
// starting; the API test browser-modules.test.mjs follows the imports too.
function playerLibs() {
  let entries = []
  try {
    const src = fs.readFileSync(path.join(PLAYER_DIR, 'player.js'), 'utf8')
    entries = [...src.matchAll(/from\s*['"]\/lib\/([^'"]+)['"]/g)].map(m => m[1])
  } catch { entries = [] }
  if (!entries.length) entries = ['screenLayout.js', 'qr.js']
  try {
    return importClosure([...new Set(entries)].map(f => 'shared/' + f), path.dirname(SHARED_DIR), { who: 'The menu screen player' })
      .filter(f => f.startsWith('shared/'))
      .map(f => f.slice('shared/'.length))
      .sort()
  } catch (err) {
    // A shared file missing: serve what can be found (the API test fails on it).
    console.error('[screens] ' + err.message)
    return entries
  }
}
export const PLAYER_LIBS = playerLibs()

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
           v.name AS venue_name, v.timezone,
           ps.pull_screen_secs, ps.pull_board_secs
      FROM screens s
      JOIN venues v ON v.id = s.venue_id AND v.tenant_id = s.tenant_id
      LEFT JOIN pos_settings ps ON ps.venue_id = s.venue_id AND ps.tenant_id = s.tenant_id
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
    // How often the player asks for changes (migration 216, the location's
    // Store tech → Device updates; defaults when it has none).
    pull: (({ screen, board }) => ({ screen, board }))(pullTimes(s)),
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
    // Statuses from the Setters in the kitchen flows (one per name across the
    // locations, the first location's look): the Order status block's list.
    order_statuses: orderStatuses(await tx`
      SELECT id, name, kind, settings FROM kds_stations
       WHERE tenant_id = ${tenantId} AND kind = 'setter' AND is_active ORDER BY created_at`),
  }
}

function orderStatuses(rows) {
  const seen = new Map()
  for (const r of rows) {
    const k = r.name.trim().toLowerCase()
    if (!seen.has(k)) seen.set(k, statusOf(r))
  }
  return [...seen.values()].map(({ id: _id, ...s }) => s).sort((a, b) => a.name.localeCompare(b.name))
}

// ── Order ready boards in the live kitchen view ─────────────────
//
// Store tech > Kitchen screens > Live view (pos/src/kitchen/Live.jsx) shows
// the venue's order ready boards beside its kitchen screens: the real player
// (screen/player.js in live mode) in a frame each, its data by the view's
// signed link (routes/screenApi.js /live/*), never a screen's pairing.

const ONLINE_MS = 150_000   // as the Screens page says Online

const designHasOrders = d => (d?.layout?.blocks || []).some(b => b?.type === 'order_status')

/**
 * The venue's menu screens that show an Order status block (on their board,
 * one of their playlist's boards, or their wall's: the same rule as
 * screenConfig()'s needs_orders), in the Screens page's order, each with its
 * size, its wall, whether a device is linked and when it was last seen.
 */
export async function orderBoardScreens(tx, tenantId, venueId) {
  const screens = await tx`
    SELECT s.id, s.name, s.short_code, s.width, s.height, s.rotation, s.wall_id, w.name AS wall_name,
           CASE WHEN w.id IS NULL THEN s.design_id ELSE w.design_id END AS design_id,
           CASE WHEN w.id IS NULL THEN s.playlist_id ELSE w.playlist_id END AS playlist_id,
           s.secret_hash IS NOT NULL AS linked, s.last_seen_at, s.status
      FROM screens s
      LEFT JOIN screen_walls w ON w.id = s.wall_id AND w.tenant_id = s.tenant_id
     WHERE s.tenant_id = ${tenantId} AND s.venue_id = ${venueId}
     ORDER BY s.sort_order, s.created_at`
  if (!screens.length) return []
  const playlistIds = [...new Set(screens.map(s => s.playlist_id).filter(Boolean))]
  const items = playlistIds.length ? await tx`
    SELECT playlist_id, design_id FROM screen_playlist_items
     WHERE tenant_id = ${tenantId} AND playlist_id = ANY(${playlistIds}::uuid[])` : []
  const designIds = [...new Set([...screens.map(s => s.design_id), ...items.map(i => i.design_id)].filter(Boolean))]
  const designs = designIds.length ? await tx`
    SELECT id, layout FROM screen_designs WHERE tenant_id = ${tenantId} AND id = ANY(${designIds}::uuid[])` : []
  const withOrders = new Set(designs.filter(designHasOrders).map(d => d.id))
  const shows = s => withOrders.has(s.design_id) || items.some(i => i.playlist_id === s.playlist_id && withOrders.has(i.design_id))
  return screens.filter(shows).map(s => ({
    id: s.id, name: s.name, short_code: s.short_code, width: s.width, height: s.height, rotation: s.rotation,
    wall: s.wall_id ? { id: s.wall_id, name: s.wall_name } : null,
    linked: s.linked, last_seen_at: s.last_seen_at,
    online: !!s.last_seen_at && Date.now() - new Date(s.last_seen_at).getTime() < ONLINE_MS,
    showing: s.status?.showing?.name || null,
  }))
}

/** A venue's menu screen for the live view: its config, without the venue hub (the frame reads the cloud). */
export async function liveScreenConfig(tx, tenantId, venueId, screenId) {
  const config = await screenConfig(tx, tenantId, screenId)
  return config && config.venue?.id === venueId ? config : null
}

// The plain board's look: dark, one Order status block over the whole board.
const LIVE_BOARD = { width: 1920, height: 1080 }
function liveBoardLayout(board) {
  return {
    background: '#111111', text_color: '#ffffff', accent_color: '#2e8b57', muted_color: '#a1a1aa',
    blocks: [{
      id: 'orders', type: 'order_status', x: 40, y: 40, w: LIVE_BOARD.width - 80, h: LIVE_BOARD.height - 80,
      opts: { ...BLOCK_DEFAULTS.order_status.opts, board, columns: 3, max: 24, title_size: 64, number_size: 84 },
    }],
  }
}

/**
 * A plain order ready board for the live view (no menu screen needed): one
 * board station's numbers (stationId, the venue's own active board station;
 * the block names it, as a board's block does), or, with none, every counter
 * and online order (the Order status block with no board picked). The same
 * config shape as screenConfig(), so the player shows it as it would a screen.
 */
export async function liveBoardConfig(tx, tenantId, venueId, stationId = null) {
  const [v] = await tx`
    SELECT v.id, v.name, v.timezone, ps.pull_screen_secs, ps.pull_board_secs
      FROM venues v
      LEFT JOIN pos_settings ps ON ps.venue_id = v.id AND ps.tenant_id = v.tenant_id
     WHERE v.id = ${venueId} AND v.tenant_id = ${tenantId}`
  if (!v) return null
  let station = null
  if (stationId) {
    [station] = await tx`
      SELECT id, name FROM kds_stations
       WHERE id = ${stationId} AND tenant_id = ${tenantId} AND venue_id = ${venueId} AND kind = 'board' AND is_active`
    if (!station) return null
  }
  const id = 'live-board-' + (station?.id || 'all')
  const name = station ? station.name : 'Every order'
  const config = {
    player_version: playerVersion(),
    screen: { id: null, name, short_code: null, width: LIVE_BOARD.width, height: LIVE_BOARD.height, rotation: 0, fit: 'contain' },
    venue: { id: v.id, name: v.name, timezone: v.timezone || 'Europe/London' },
    wall: null,
    playlist: null,
    design_id: id,
    designs: { [id]: { id, name, width: LIVE_BOARD.width, height: LIVE_BOARD.height, layout: liveBoardLayout(station?.name || '') } },
    menus: [],
    tags: [],
    allergen_notice: null,
    sold_out: [],
    needs_orders: true,
    pull: (({ screen, board }) => ({ screen, board }))(pullTimes(v)),
  }
  config.version = sha256(JSON.stringify(config)).slice(0, 16)
  return config
}

/** Tell a tenant's screens that boards, playlists or screens changed. */
export const tenantRoom = tenantId => 'screens-t:' + tenantId
export const screenRoom = screenId => 'screen:' + screenId

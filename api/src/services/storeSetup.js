// src/services/storeSetup.js
//
// Creating a new location from a store opening plan (shared/storeOpening.js,
// migration 186), and summaries of the locations a tenant already has (what
// Pepper reads when it scopes a new one, and what the preview says a copy
// will bring).
//
//   venueSummary(tx, tenantId, venueId)   counts and words per area
//   tenantContext(tx, tenantId)           every location's summary + company-wide lists
//   createStore(tx, { tenantId, plan, by, allowed, today })
//       one transaction: the venue, then each area in an order that lets
//       later areas point at earlier ones (cash before the till's Cash Recon
//       map, the till's floor areas before tables, kitchen stations before
//       kitchen screens, checklists before dashboards). Returns
//       { venue, results: { area: { status, lines } } }.
//
// Copying works on whole rows: every column of the location's row is copied
// except its id, tenant, venue and timestamps, and every id inside it (uuid
// columns, uuid arrays, ids anywhere in a jsonb value) is moved to the copy's
// new id. An id of something that belongs to the location copied from but
// wasn't copied (an area left out, a dated closure in the past) is dropped
// (null, or left out of its array or object), so nothing in the new location
// ever points at the old one. Company-wide ids (menus, dishes, order types,
// tip pots, kiosk designs, suppliers) stay as they are.

import { randomUUID, randomBytes } from 'node:crypto'
import { httpError } from '../middleware/error.js'
import { ensureSettings } from './posSvc.js'
import { hoursText } from '../../../shared/storeOpening.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DROP = Symbol('drop')
const plural = (n, one, many = one + 's') => n + ' ' + (n === 1 ? one : many)
const hhmm = t => (t ? String(t).slice(0, 5) : null)
const dateStr = d => (d instanceof Date ? d.toISOString().slice(0, 10) : d == null ? null : String(d).slice(0, 10))

// Rows of these tables belong to a location (venue_id). Their ids are the
// ones a copy must never keep pointing at.
const OWNED_TABLES = [
  'venue_sections', 'tables', 'table_combinations', 'disallowed_table_pairs',
  'venue_schedule_templates', 'venue_sittings', 'sitting_slot_caps',
  'schedule_exceptions', 'exception_day_templates', 'exception_sittings', 'exception_sitting_slot_caps',
  'schedule_date_overrides', 'override_sittings', 'override_slot_caps',
  'booking_rules', 'deposit_rules',
  'cash_income_sources', 'cash_payment_channels', 'cash_sc_sources', 'cash_expense_categories', 'cash_staff',
  'pos_revenue_streams', 'floor_areas', 'pos_printers',
  'kds_stations', 'kds_flows', 'kds_flow_edges', 'pos_devices', 'pos_card_readers', 'screens', 'screen_walls',
  'checklist_templates', 'fs_equipment', 'fs_capture_times', 'fs_hold_stations', 'fs_hold_capture_times',
  'fs_cooking_sessions', 'fs_cooking_settings', 'fs_cooking_items', 'hs_dashboards',
  'website_config', 'website_pages', 'email_templates', 'venue_email_settings', 'menus', 'deliveroo_item_links',
]

// ── Copying rows ────────────────────────────────────────────────

const typeCache = new Map()
/** { column: 'uuid' | 'json' | 'array' | 'date' | 'text' | 'plain' } for a table. */
async function columnTypes(tx, table) {
  if (typeCache.has(table)) return typeCache.get(table)
  const rows = await tx`
    SELECT column_name, data_type, udt_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ${table}`
  if (!rows.length) throw new Error('Unknown table ' + table)
  const m = new Map(rows.map(r => [r.column_name,
    r.data_type === 'jsonb' || r.data_type === 'json' ? 'json'
      : r.data_type === 'ARRAY' ? 'array'
        : r.udt_name === 'uuid' ? 'uuid'
          : r.data_type === 'date' ? 'date'
            : r.data_type === 'text' ? 'text' : 'plain']))
  typeCache.set(table, m)
  return m
}

function remapId(s, v) {
  if (typeof v !== 'string' || !UUID_RE.test(v)) return v
  if (s.ids.has(v)) return s.ids.get(v)
  return s.owned.has(v) ? DROP : v
}

/** Every id in a json value moved to its copy, ids of things not copied left out. */
function remapDeep(s, v) {
  if (typeof v === 'string') return remapId(s, v)
  if (Array.isArray(v)) return v.map(x => remapDeep(s, x)).filter(x => x !== DROP)
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const out = {}
    for (const [k, val] of Object.entries(v)) {
      const key = remapId(s, k)
      if (key === DROP) continue
      const nv = remapDeep(s, val)
      if (nv === DROP) continue
      out[key] = nv
    }
    return out
  }
  return v
}

/**
 * Copies a table's rows of the location being copied to the new one.
 *   parentCol + parents   rows whose parentCol is one of these ids (tables without a venue_id)
 *   where(row)            only these rows
 *   need                  uuid columns that must point at something copied, else the row is skipped
 *   set                   { column: value | (row, copy) => value } after the copy
 *   edit(copy)            last changes to the copy
 * Returns the rows written (new shapes, ids included).
 */
async function copyTable(s, table, { parentCol = null, parents = null, where = null, need = [], set = {}, edit = null } = {}) {
  const { tx, tenantId } = s
  const types = await columnTypes(tx, table)
  let rows
  if (parentCol) {
    if (!parents?.length) return []
    // Parents are rows of this tenant already read; a table without a
    // tenant_id (table_combination_members) is found by them alone.
    rows = types.has('tenant_id')
      ? await tx`SELECT * FROM ${tx(table)} WHERE tenant_id = ${tenantId} AND ${tx(parentCol)} = ANY(${parents}::uuid[])`
      : await tx`SELECT * FROM ${tx(table)} WHERE ${tx(parentCol)} = ANY(${parents}::uuid[])`
  } else {
    rows = await tx`SELECT * FROM ${tx(table)} WHERE tenant_id = ${tenantId} AND venue_id = ${s.from}`
  }
  if (where) rows = rows.filter(where)
  const when = r => (r.created_at instanceof Date ? r.created_at.getTime() : 0)
  rows.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || when(a) - when(b))
  // Ids first, so rows can point at each other (a backup printer).
  if (types.has('id')) for (const r of rows) s.ids.set(r.id, randomUUID())
  const out = []
  for (const r of rows) {
    const row = {}
    let skip = false
    for (const [col, val] of Object.entries(r)) {
      if (col === 'created_at' || col === 'updated_at') continue
      if (col === 'id') { row.id = s.ids.get(val); continue }
      if (col === 'tenant_id') { row.tenant_id = tenantId; continue }
      if (col === 'venue_id') { row.venue_id = s.to; continue }
      const type = types.get(col)
      if (type === 'uuid') {
        const nv = remapId(s, val)
        if (nv === DROP) {
          if (need.includes(col)) { skip = true; break }
          row[col] = null
        } else {
          if (need.includes(col) && val && !s.ids.has(val) && s.owned.has(val)) { skip = true; break }
          row[col] = nv
        }
      } else if (type === 'array') row[col] = Array.isArray(val) ? remapDeep(s, val) : val
      else if (type === 'json') row[col] = val == null ? null : remapDeep(s, val)
      else if (type === 'date') row[col] = dateStr(val)
      else row[col] = val
    }
    if (skip) { if (row.id) s.ids.delete(r.id); continue }
    for (const [col, v] of Object.entries(set)) row[col] = typeof v === 'function' ? v(r, row) : v
    if (edit) edit(row)
    for (const [col, v] of Object.entries(row)) if (types.get(col) === 'json' && v != null) row[col] = tx.json(v)
    out.push(row)
    if (r.id) (s.copied[table] ||= []).push(r.id)
  }
  for (let i = 0; i < out.length; i += 400) {
    const chunk = out.slice(i, i + 400)
    await tx`INSERT INTO ${tx(table)} ${tx(chunk, Object.keys(chunk[0]))}`
  }
  return out
}

const idsOf = rows => rows.map(r => r.id)

// ── Summaries ───────────────────────────────────────────────────

/** What a location has, area by area: { id, name, ..., areas: { key: { text, count } }, links }. */
export async function venueSummary(tx, tenantId, venueId) {
  const [venue] = await tx`
    SELECT v.id, v.name, v.slug, v.timezone, v.currency, v.is_active, w.city, w.postcode
      FROM venues v LEFT JOIN website_config w ON w.venue_id = v.id AND w.tenant_id = v.tenant_id
     WHERE v.id = ${venueId} AND v.tenant_id = ${tenantId}`
  if (!venue) return null
  const V = venueId, T = tenantId
  const [
    days, sittings, sections, tables, combos, rules, deposit, site, pages, email, emailTpls, ordering,
    deliveroo, tax, pos, streams, floorAreas, printers, stations, flows, devices, screens, income, channels, sc, cats,
    equipment, times, holds, sessions, cookItems, checklists, dashboards, supplierVenues, lists, pars, staff, loyverse, gloria, cardMachines,
  ] = await Promise.all([
    tx`SELECT id, day_of_week, is_open, slot_interval_mins FROM venue_schedule_templates WHERE tenant_id = ${T} AND venue_id = ${V}`,
    tx`SELECT template_id, opens_at::text, closes_at::text, name FROM venue_sittings WHERE tenant_id = ${T} AND venue_id = ${V} ORDER BY opens_at`,
    tx`SELECT id, name FROM venue_sections WHERE tenant_id = ${T} AND venue_id = ${V} AND is_active ORDER BY sort_order`,
    tx`SELECT section_id, max_covers FROM tables WHERE tenant_id = ${T} AND venue_id = ${V} AND is_active AND NOT is_unallocated`,
    tx`SELECT count(*)::int AS n FROM table_combinations WHERE tenant_id = ${T} AND venue_id = ${V} AND is_active`,
    tx`SELECT slot_duration_mins, min_covers, max_covers, book_until_days FROM booking_rules WHERE tenant_id = ${T} AND venue_id = ${V}`,
    tx`SELECT requires_deposit, deposit_type, deposit_amount FROM deposit_rules WHERE tenant_id = ${T} AND venue_id = ${V}`,
    tx`SELECT id, jsonb_array_length(COALESCE(page_blocks, '[]'::jsonb))::int AS blocks FROM website_config WHERE tenant_id = ${T} AND venue_id = ${V}`,
    tx`SELECT count(*)::int AS n FROM website_pages WHERE tenant_id = ${T} AND venue_id = ${V} AND system_key IS NULL`,
    tx`SELECT email_provider, from_name FROM venue_email_settings WHERE tenant_id = ${T} AND venue_id = ${V}`,
    tx`SELECT count(*)::int AS n FROM email_templates WHERE tenant_id = ${T} AND venue_id = ${V}`,
    tx`SELECT is_enabled, menu_ids FROM ordering_settings WHERE tenant_id = ${T} AND venue_id = ${V}`,
    tx`SELECT price_uplift_pct FROM deliveroo_settings WHERE tenant_id = ${T} AND venue_id = ${V}`,
    tx`SELECT count(*)::int AS n FROM tax_rate_values WHERE tenant_id = ${T} AND venue_id = ${V}`,
    tx`SELECT receipt_name FROM pos_settings WHERE tenant_id = ${T} AND venue_id = ${V}`,
    tx`SELECT name FROM pos_revenue_streams WHERE tenant_id = ${T} AND venue_id = ${V} AND is_active ORDER BY sort_order`,
    tx`SELECT count(*)::int AS n FROM floor_areas WHERE tenant_id = ${T} AND venue_id = ${V}`,
    tx`SELECT count(*)::int AS n FROM pos_printers WHERE tenant_id = ${T} AND venue_id = ${V} AND is_active`,
    tx`SELECT name, kind FROM kds_stations WHERE tenant_id = ${T} AND venue_id = ${V} AND is_active ORDER BY sort_order`,
    tx`SELECT name FROM kds_flows WHERE tenant_id = ${T} AND venue_id = ${V} ORDER BY sort_order`,
    tx`SELECT kind, count(*)::int AS n FROM pos_devices WHERE tenant_id = ${T} AND venue_id = ${V} AND revoked_at IS NULL AND kind <> 'hub' GROUP BY kind`,
    tx`SELECT count(*)::int AS n FROM screens WHERE tenant_id = ${T} AND venue_id = ${V}`,
    tx`SELECT count(*)::int AS n FROM cash_income_sources WHERE tenant_id = ${T} AND venue_id = ${V} AND is_active`,
    tx`SELECT count(*)::int AS n FROM cash_payment_channels WHERE tenant_id = ${T} AND venue_id = ${V} AND is_active`,
    tx`SELECT count(*)::int AS n FROM cash_sc_sources WHERE tenant_id = ${T} AND venue_id = ${V} AND is_active`,
    tx`SELECT count(*)::int AS n FROM cash_expense_categories WHERE tenant_id = ${T} AND venue_id = ${V} AND is_active`,
    tx`SELECT equipment_type FROM fs_equipment WHERE tenant_id = ${T} AND venue_id = ${V} AND is_active`,
    tx`SELECT time_of_day::text FROM fs_capture_times WHERE tenant_id = ${T} AND venue_id = ${V} AND is_active ORDER BY time_of_day`,
    tx`SELECT count(*)::int AS n FROM fs_hold_stations WHERE tenant_id = ${T} AND venue_id = ${V} AND is_active`,
    tx`SELECT count(*)::int AS n FROM fs_cooking_sessions WHERE tenant_id = ${T} AND venue_id = ${V} AND is_active`,
    tx`SELECT count(*)::int AS n FROM fs_cooking_items WHERE tenant_id = ${T} AND venue_id = ${V} AND is_active`,
    tx`SELECT name FROM checklist_templates WHERE tenant_id = ${T} AND venue_id = ${V} AND is_active ORDER BY sort_order`,
    tx`SELECT kind, count(*)::int AS n FROM hs_dashboards WHERE tenant_id = ${T} AND venue_id = ${V} AND is_active GROUP BY kind`,
    tx`SELECT count(*)::int AS n FROM supplier_venues WHERE tenant_id = ${T} AND venue_id = ${V}`,
    tx`SELECT l.name FROM order_list_venues lv JOIN order_lists l ON l.id = lv.list_id AND l.tenant_id = lv.tenant_id WHERE lv.tenant_id = ${T} AND lv.venue_id = ${V} ORDER BY l.sort_order`,
    tx`SELECT count(*)::int AS n FROM order_list_pars WHERE tenant_id = ${T} AND venue_id = ${V}`,
    tx`SELECT count(*)::int AS n FROM cash_staff WHERE tenant_id = ${T} AND venue_id = ${V} AND is_active AND (left_on IS NULL OR left_on >= current_date)`,
    tx`SELECT 1 FROM loyverse_venue_links WHERE tenant_id = ${T} AND venue_id = ${V}`,
    tx`SELECT 1 FROM gloriafood_venue_links WHERE tenant_id = ${T} AND venue_id = ${V}`,
    tx`SELECT 1 FROM pos_card_readers WHERE tenant_id = ${T} AND venue_id = ${V} AND removed_at IS NULL AND provider <> 'test' LIMIT 1`,
  ])

  const byTemplate = new Map()
  for (const st of sittings) (byTemplate.get(st.template_id) || byTemplate.set(st.template_id, []).get(st.template_id)).push(st)
  const week = days.map(d => ({ day: d.day_of_week, open: d.is_open, sittings: d.is_open ? (byTemplate.get(d.id) || []).map(x => ({ opens_at: hhmm(x.opens_at), closes_at: hhmm(x.closes_at) })) : [] }))
  const seats = tables.reduce((n, t) => n + t.max_covers, 0)
  const dev = Object.fromEntries(devices.map(d => [d.kind, d.n]))
  const fr = equipment.filter(e => e.equipment_type === 'fridge').length
  const fz = equipment.filter(e => e.equipment_type === 'freezer').length
  const n = rows => rows[0]?.n || 0
  const words = (...parts) => parts.filter(Boolean).join(', ')
  const r = rules[0], dp = deposit[0]

  const areas = {
    hours: { count: week.filter(d => d.open).length, text: week.length ? hoursText(week) : '' },
    tables: { count: tables.length, text: tables.length ? words(plural(tables.length, 'table') + ' in ' + plural(Math.max(1, sections.length), 'room') + ' (' + seats + ' seats)', n(combos) && plural(n(combos), 'combination')) : '' },
    booking_rules: { count: r ? 1 : 0, text: r ? words(r.slot_duration_mins + '-minute bookings, parties of ' + r.min_covers + '-' + r.max_covers + ', up to ' + r.book_until_days + ' days ahead', dp?.requires_deposit && 'deposits on') : '' },
    website: { count: site.length, text: site.length ? words('location page' + (site[0].blocks ? ' with ' + plural(site[0].blocks, 'block') : ''), n(pages) && plural(n(pages), 'own page')) : '' },
    emails: { count: email.length + n(emailTpls), text: words(email[0] && 'sent by ' + (email[0].email_provider || 'the platform') + (email[0].from_name ? ' as "' + email[0].from_name + '"' : ''), n(emailTpls) && plural(n(emailTpls), 'own email')) },
    ordering: { count: ordering.length, text: ordering.length ? (ordering[0].is_enabled ? 'on' : 'set up, off') + ', ' + plural((ordering[0].menu_ids || []).length, 'menu') : '' },
    deliveroo: { count: deliveroo.length, text: deliveroo.length ? 'price uplift ' + Number(deliveroo[0].price_uplift_pct || 0) + '%' : '' },
    tax: { count: n(tax), text: n(tax) ? plural(n(tax), 'rate') + ' of its own' : '' },
    till: { count: pos.length + streams.length, text: pos.length || streams.length ? words(streams.length && 'revenue streams ' + streams.map(x => x.name).join(', '), n(floorAreas) && plural(n(floorAreas), 'floor area'), n(printers) && plural(n(printers), 'printer')) : '' },
    kitchen: { count: stations.length, text: stations.length ? words(plural(stations.length, 'station') + ' (' + stations.map(x => x.name).join(', ') + ')', flows.length && plural(flows.length, 'kitchen flow')) : '' },
    devices: { count: (dev.terminal || 0) + (dev.kds || 0) + (dev.kiosk || 0) + n(screens), text: words(dev.terminal && plural(dev.terminal, 'till'), dev.kds && plural(dev.kds, 'kitchen screen'), dev.kiosk && plural(dev.kiosk, 'kiosk'), n(screens) && plural(n(screens), 'menu screen')) },
    cash: { count: n(income) + n(channels), text: n(income) + n(channels) ? words(plural(n(income), 'income source'), plural(n(channels), 'payment channel'), n(sc) && plural(n(sc), 'tips source'), n(cats) && plural(n(cats), 'expense category', 'expense categories')) : '' },
    food_safety: { count: equipment.length + n(holds) + n(sessions), text: words(fr && plural(fr, 'fridge'), fz && plural(fz, 'freezer'), times.length && 'checks at ' + times.map(t => hhmm(t.time_of_day)).join(', '), n(holds) && plural(n(holds), 'hold station'), n(sessions) && plural(n(sessions), 'cooking session'), n(cookItems) && plural(n(cookItems), 'cooking dish', 'cooking dishes')) },
    checklists: { count: checklists.length, text: checklists.length ? checklists.map(c => c.name).join(', ') : '' },
    dashboards: { count: dashboards.reduce((x, d) => x + d.n, 0), text: dashboards.map(d => plural(d.n, (d.kind === 'hs' ? 'H&S' : d.kind) + ' dashboard')).join(', ') },
    purchasing: { count: n(supplierVenues) + lists.length, text: words(n(supplierVenues) && plural(n(supplierVenues), 'supplier') + ' with delivery settings', lists.length && 'order lists ' + lists.map(l => l.name).join(', '), n(pars) && plural(n(pars), 'par')) },
    staff: { count: n(staff), text: n(staff) ? plural(n(staff), 'person', 'people') + ' (not copied)' : '' },
  }
  return {
    id: venue.id, name: venue.name, slug: venue.slug, timezone: venue.timezone, currency: venue.currency,
    is_active: venue.is_active, city: venue.city || null, postcode: venue.postcode || null,
    areas,
    links: { loyverse: loyverse.length > 0, gloriafood: gloria.length > 0, card_machines: cardMachines.length > 0 },
  }
}

/** Everything Pepper reads before scoping a new location. */
export async function tenantContext(tx, tenantId) {
  const [tenant] = await tx`SELECT name FROM tenants WHERE id = ${tenantId}`
  const venues = await tx`SELECT id FROM venues WHERE tenant_id = ${tenantId} ORDER BY is_active DESC, name LIMIT 25`
  const [summaries, menus, taxRates, orderTypes, kioskDesigns, roles, suppliers, lists, screenDesigns] = await Promise.all([
    Promise.all(venues.map(v => venueSummary(tx, tenantId, v.id))),
    tx`SELECT m.name, m.venue_id, v.name AS venue_name, m.is_published FROM menus m LEFT JOIN venues v ON v.id = m.venue_id
        WHERE m.tenant_id = ${tenantId} ORDER BY m.sort_order, m.name LIMIT 40`,
    tx`SELECT name, rate::float8 AS rate, is_default FROM tax_rates WHERE tenant_id = ${tenantId} AND is_active ORDER BY sort_order`,
    tx`SELECT name FROM order_types WHERE tenant_id = ${tenantId} AND is_active ORDER BY sort_order`,
    tx`SELECT name FROM kiosk_designs WHERE tenant_id = ${tenantId} ORDER BY created_at LIMIT 10`,
    tx`SELECT name FROM staff_roles WHERE tenant_id = ${tenantId} AND is_active ORDER BY sort_order LIMIT 30`,
    tx`SELECT count(*)::int AS n FROM suppliers WHERE tenant_id = ${tenantId} AND is_active`,
    tx`SELECT name FROM order_lists WHERE tenant_id = ${tenantId} AND is_active ORDER BY sort_order LIMIT 20`,
    tx`SELECT name FROM screen_designs WHERE tenant_id = ${tenantId} ORDER BY name LIMIT 20`,
  ])
  return {
    company: tenant?.name || null,
    locations: summaries.filter(Boolean).map(s => ({
      id: s.id, name: s.name, slug: s.slug, timezone: s.timezone, currency: s.currency, active: s.is_active,
      city: s.city, postcode: s.postcode,
      setup: Object.fromEntries(Object.entries(s.areas).filter(([, a]) => a.text).map(([k, a]) => [k, a.text])),
      integrations: Object.entries(s.links).filter(([, on]) => on).map(([k]) => k),
    })),
    menus: menus.map(m => ({ name: m.name, location: m.venue_name || 'every location', published: m.is_published })),
    tax_rates: taxRates.map(t => t.name + ' ' + t.rate + '%' + (t.is_default ? ' (default)' : '')),
    order_types: orderTypes.map(o => o.name),
    kiosk_designs: kioskDesigns.map(k => k.name),
    staff_roles: roles.map(r => r.name),
    suppliers: suppliers[0]?.n || 0,
    order_lists: lists.map(l => l.name),
    menu_screen_designs: screenDesigns.map(d => d.name),
  }
}

// ── Creating ────────────────────────────────────────────────────

async function freeSlug(tx, tenantId, slug) {
  const taken = new Set((await tx`SELECT slug FROM venues WHERE tenant_id = ${tenantId} AND (slug = ${slug} OR slug LIKE ${slug + '-%'})`).map(r => r.slug))
  if (!taken.has(slug)) return slug
  for (let i = 2; i < 500; i++) if (!taken.has(slug + '-' + i)) return slug + '-' + i
  return slug + '-' + randomBytes(3).toString('hex')
}
export { freeSlug }

const DEFAULT_TEMPS = {
  fridge:    { target: 5,   min: -2,  max: 8 },
  freezer:   { target: -18, min: -30, max: -15 },
  hot_hold:  { target: 63,  min: 63,  max: 100 },
  cold_hold: { target: 5,   min: -2,  max: 8 },
}
const checkLabel = t => {
  const h = Number(t.slice(0, 2))
  return (h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening') + ' ' + t
}

async function nextScreenCode(tx, tenantId, used) {
  if (!used.size) for (const r of await tx`SELECT short_code FROM screens WHERE tenant_id = ${tenantId}`) used.add(r.short_code)
  for (let i = 1; i < 10_000; i++) if (!used.has('S' + i)) { used.add('S' + i); return 'S' + i }
  throw httpError(422, 'Too many menu screens')
}

const AREA_ORDER = [
  'tax', 'cash', 'till', 'tables', 'hours', 'booking_rules', 'kitchen', 'devices',
  'ordering', 'deliveroo', 'website', 'emails', 'food_safety', 'checklists', 'dashboards', 'purchasing', 'staff',
]

const AREAS = {
  // ── Tax ──
  async tax(s) {
    const rows = await copyTable(s, 'tax_rate_values')
    return [rows.length ? plural(rows.length, 'tax rate') + ' of its own' : 'No rates of its own: the company\'s rates apply']
  },

  // ── Cash Recon ──
  async cash(s, mode) {
    if (mode === 'copy') {
      await copyTable(s, 'cash_venue_settings')
      const inc = await copyTable(s, 'cash_income_sources')
      const ch = await copyTable(s, 'cash_payment_channels')
      const sc = await copyTable(s, 'cash_sc_sources')
      const cats = await copyTable(s, 'cash_expense_categories')
      return [plural(inc.length, 'income source') + ', ' + plural(ch.length, 'payment channel') + ', ' + plural(sc.length, 'tips source') + ', ' + plural(cats.length, 'expense category', 'expense categories')]
    }
    const { tx, tenantId, to } = s
    await tx`INSERT INTO cash_venue_settings (venue_id, tenant_id) VALUES (${to}, ${tenantId}) ON CONFLICT DO NOTHING`
    await tx`INSERT INTO cash_income_sources ${tx([
      { tenant_id: tenantId, venue_id: to, name: 'Food', type: 'pos', vat_rate: 20, vat_inclusive: true, sort_order: 0 },
      { tenant_id: tenantId, venue_id: to, name: 'Drink', type: 'pos', vat_rate: 20, vat_inclusive: true, sort_order: 1 },
    ])}`
    await tx`INSERT INTO cash_payment_channels ${tx([
      { tenant_id: tenantId, venue_id: to, name: 'Cash', type: 'cash', counts_as_cash: true, sort_order: 0 },
      { tenant_id: tenantId, venue_id: to, name: 'Card', type: 'card', counts_as_cash: false, sort_order: 1 },
    ])}`
    await tx`INSERT INTO cash_sc_sources (tenant_id, venue_id, name, type, sort_order) VALUES (${tenantId}, ${to}, 'Card tips', 'tips', 0)`
    await tx`INSERT INTO cash_expense_categories ${tx(['Cleaning', 'Supplies', 'Food', 'Repairs'].map((name, i) => ({ tenant_id: tenantId, venue_id: to, name, sort_order: i })))}`
    return ['Food and Drink income, Cash and Card takings, Card tips, 4 expense categories']
  },

  // ── Till ──
  async till(s, mode, plan) {
    const { tx, tenantId, to } = s
    const receiptName = plan.till.receipt_name || plan.venue.name
    // Receipt address lines: this location's, never the one copied from.
    const address = [plan.location.address_line1, plan.location.address_line2, [plan.location.city, plan.location.postcode].filter(Boolean).join(' ')].filter(Boolean)
    if (mode === 'copy') {
      const streams = await copyTable(s, 'pos_revenue_streams')
      const areas = await copyTable(s, 'floor_areas')
      // A printer plugged into one of the old location's devices waits for one
      // of the new location's (Till setup -> Printers); the hub's last report goes.
      const printers = await copyTable(s, 'pos_printers', { set: { device_id: null, local_id: null, status: null, status_at: null } })
      await copyTable(s, 'pos_settings', {
        set: {
          pin_salt: () => randomBytes(16).toString('hex'),
          receipt_name: receiptName,
          receipt_address: address,
          kds_active_flow_id: null, kds_flow_switched_at: null, kds_flow_switched_by: null, kds_gloriafood: false,
        },
      })
      await ensureSettings(tx, tenantId, to)
      // Which print design prints where, and the words it changes (designs are company wide).
      const printUses = await copyTable(s, 'print_design_uses')
      await copyTable(s, 'print_design_variations')
      return [
        'Receipts say "' + receiptName + '"',
        ...(printUses.length ? [plural(printUses.length, 'print design choice')] : []),
        streams.length ? 'Revenue streams: ' + streams.map(x => x.name).join(', ') : 'No revenue streams',
        plural(areas.length, 'floor area') + ', ' + plural(printers.length, 'printer') + ' (check each printer\'s address on site)',
      ]
    }
    await ensureSettings(tx, tenantId, to)
    await tx`UPDATE pos_settings SET receipt_name = ${receiptName}, receipt_address = ${address} WHERE venue_id = ${to} AND tenant_id = ${tenantId}`
    const streams = plan.till.streams.length ? plan.till.streams : [{ name: 'Restaurant', service_charge_percent: 0 }]
    await tx`INSERT INTO pos_revenue_streams ${tx(streams.map((x, i) => ({ tenant_id: tenantId, venue_id: to, name: x.name, service_charge_percent: x.service_charge_percent || 0, sort_order: i })))}`
    return ['Receipts say "' + receiptName + '"', 'Revenue streams: ' + streams.map(x => x.name).join(', ')]
  },

  // ── Tables ──
  async tables(s, mode, plan) {
    const { tx, tenantId, to } = s
    if (mode === 'copy') {
      const sections = await copyTable(s, 'venue_sections')
      const tables = await copyTable(s, 'tables')
      const combos = await copyTable(s, 'table_combinations')
      await copyTable(s, 'table_combination_members', { parentCol: 'combination_id', parents: s.copiedFrom('table_combinations'), need: ['combination_id', 'table_id'] })
      // The pair is stored lowest id first (dtp_ordered); the new ids may sort the other way.
      const pairs = await copyTable(s, 'disallowed_table_pairs', {
        need: ['table_id_a', 'table_id_b'],
        edit: row => { if (row.table_id_a > row.table_id_b) [row.table_id_a, row.table_id_b] = [row.table_id_b, row.table_id_a] },
      })
      const real = tables.filter(t => !t.is_unallocated)
      return [plural(real.length, 'table') + ' in ' + plural(sections.length, 'room') + ' (' + real.reduce((n, t) => n + t.max_covers, 0) + ' seats)', combos.length + pairs.length ? plural(combos.length, 'combination') + ', ' + plural(pairs.length, 'pair kept apart') : null].filter(Boolean)
    }
    let order = 0
    for (const [i, sec] of plan.tables.sections.entries()) {
      const [row] = await tx`INSERT INTO venue_sections (venue_id, tenant_id, name, sort_order) VALUES (${to}, ${tenantId}, ${sec.name}, ${i}) RETURNING id`
      await tx`INSERT INTO tables ${tx(sec.tables.map(t => ({ venue_id: to, tenant_id: tenantId, section_id: row.id, label: t.label, min_covers: t.min_covers, max_covers: t.max_covers, sort_order: order++ })))}`
    }
    const all = plan.tables.sections.flatMap(x => x.tables)
    return [plural(all.length, 'table') + ' in ' + plural(plan.tables.sections.length, 'room') + ' (' + all.reduce((n, t) => n + t.max_covers, 0) + ' seats)']
  },

  // ── Opening hours ──
  async hours(s, mode, plan) {
    const { tx, tenantId, to } = s
    if (mode === 'copy') {
      const days = await copyTable(s, 'venue_schedule_templates')
      await copyTable(s, 'venue_sittings', { need: ['template_id'] })
      await copyTable(s, 'sitting_slot_caps', { need: ['sitting_id'] })
      // Dated changes still to come (Christmas, a private hire) come along; past ones don't.
      const today = s.today
      const ex = await copyTable(s, 'schedule_exceptions', { where: r => dateStr(r.date_to) >= today })
      await copyTable(s, 'exception_day_templates', { need: ['exception_id'] })
      await copyTable(s, 'exception_sittings', { need: ['template_id'] })
      await copyTable(s, 'exception_sitting_slot_caps', { need: ['sitting_id'] })
      const ov = await copyTable(s, 'schedule_date_overrides', { where: r => dateStr(r.override_date) >= today })
      await copyTable(s, 'override_sittings', { need: ['override_id'] })
      await copyTable(s, 'override_slot_caps', { need: ['sitting_id'] })
      const lines = [plural(days.filter(d => d.is_open).length, 'day') + ' open each week']
      if (ex.length + ov.length) lines.push(plural(ex.length + ov.length, 'dated change') + ' still to come')
      return lines
    }
    for (let day = 0; day < 7; day++) {
      const d = plan.hours.days.find(x => x.day === day)
      const open = !!d?.open
      const [tmpl] = await tx`
        INSERT INTO venue_schedule_templates (venue_id, tenant_id, day_of_week, is_open, slot_interval_mins)
        VALUES (${to}, ${tenantId}, ${day}, ${open}, ${plan.hours.slot_interval_mins}) RETURNING id`
      if (!open) continue
      await tx`INSERT INTO venue_sittings ${tx(d.sittings.map((st, i) => ({
        template_id: tmpl.id, venue_id: to, tenant_id: tenantId, opens_at: st.opens_at, closes_at: st.closes_at,
        default_max_covers: st.max_covers, sort_order: i, name: st.name,
      })))}`
    }
    return [hoursText(plan.hours.days)]
  },

  // ── Booking rules ──
  async booking_rules(s, mode, plan) {
    const { tx, tenantId, to } = s
    if (mode === 'copy') {
      const rules = await copyTable(s, 'booking_rules')
      const dep = await copyTable(s, 'deposit_rules')
      return [rules.length ? 'Booking rules copied' : 'No booking rules to copy', dep.length ? 'Deposit rules copied' : null].filter(Boolean)
    }
    const b = plan.booking_rules
    await tx`
      INSERT INTO booking_rules (venue_id, tenant_id, slot_duration_mins, min_covers, max_covers, book_until_days, cutoff_before_mins)
      VALUES (${to}, ${tenantId}, ${b.slot_duration_mins}, ${b.min_covers}, ${b.max_covers}, ${b.book_until_days}, ${b.cutoff_before_mins})`
    return [b.slot_duration_mins + '-minute bookings, parties of ' + b.min_covers + '-' + b.max_covers + ', up to ' + b.book_until_days + ' days ahead']
  },

  // ── Kitchen ──
  async kitchen(s) {
    const { tx, tenantId, to } = s
    const stations = await copyTable(s, 'kds_stations')
    const flows = await copyTable(s, 'kds_flows')
    await copyTable(s, 'kds_flow_edges', { need: ['flow_id', 'to_station_id'] })
    await ensureSettings(tx, tenantId, to)
    const [tpl] = await tx`SELECT kds_active_flow_id, kds_online_orders, kds_online_ready, kds_gloriafood_types, kds_gloriafood_lead_mins
                             FROM pos_settings WHERE venue_id = ${s.from} AND tenant_id = ${tenantId}`
    if (tpl) {
      // The template's own flow in use becomes the copy's; a shared flow (migration 192) stays as it is.
      const [shared] = tpl.kds_active_flow_id ? await tx`
        SELECT id FROM kds_flows WHERE id = ${tpl.kds_active_flow_id} AND tenant_id = ${tenantId} AND venue_id IS NULL` : []
      const active = shared?.id || (tpl.kds_active_flow_id && s.ids.get(tpl.kds_active_flow_id))
      await tx`
        UPDATE pos_settings SET kds_active_flow_id = ${active || null}, kds_online_orders = ${tpl.kds_online_orders},
               kds_online_ready = ${tpl.kds_online_ready}, kds_gloriafood_types = ${tx.json(tpl.kds_gloriafood_types || {})},
               kds_gloriafood_lead_mins = ${tpl.kds_gloriafood_lead_mins}
         WHERE venue_id = ${to} AND tenant_id = ${tenantId}`
    }
    return [stations.length ? plural(stations.length, 'station') + ': ' + stations.map(x => x.name).join(', ') : 'No kitchen stations to copy', flows.length ? plural(flows.length, 'kitchen flow') : null].filter(Boolean)
  },

  // ── Devices ──
  async devices(s, mode, plan) {
    const { tx, tenantId, to, by } = s
    const lines = []
    const usedCodes = new Set()
    if (mode === 'copy') {
      const devs = await copyTable(s, 'pos_devices', {
        where: r => !r.revoked_at && r.kind !== 'hub',
        set: {
          secret_hash: null, pairing_code_hash: null, pairing_expires_at: null, paired_at: null, last_seen_at: null,
          app_version: null, user_agent: null, revoked_at: null, created_by: by,
        },
        // Card machines are paired to the template location: none here yet.
        edit: row => { if (row.settings?.card_reader) row.settings = { ...row.settings, card_reader: 'none' } },
      })
      const count = k => devs.filter(d => d.kind === k).length
      if (devs.length) lines.push([count('terminal') && plural(count('terminal'), 'till'), count('kds') && plural(count('kds'), 'kitchen screen'), count('kiosk') && plural(count('kiosk'), 'kiosk')].filter(Boolean).join(', ') + ' with the same settings, ready to link')
      if (s.allowedModule('screens')) {
        const tplScreens = await tx`SELECT short_code FROM screens WHERE tenant_id = ${tenantId} AND venue_id = ${s.from} ORDER BY sort_order`
        const codes = []
        for (let i = 0; i < tplScreens.length; i++) codes.push(await nextScreenCode(tx, tenantId, usedCodes))
        let i = 0
        const scr = await copyTable(s, 'screens', {
          set: {
            short_code: () => codes[i++], secret_hash: null, paired_at: null, last_seen_at: null, app_version: null,
            device_info: {}, status: {}, wall_id: null, wall_col: null, wall_row: null,
          },
        })
        if (scr.length) lines.push(plural(scr.length, 'menu screen') + ' showing the same boards, ready to link')
      } else if (plan.devices.menu_screens || (await tx`SELECT 1 FROM screens WHERE tenant_id = ${tenantId} AND venue_id = ${s.from} LIMIT 1`).length) {
        lines.push('Menu screens left out: they need Screens manage')
      }
      return lines.length ? lines : ['No devices to copy']
    }
    const d = plan.devices
    const rows = []
    const add = (kind, n, name, prefix, settings) => {
      for (let i = 1; i <= n; i++) rows.push({ tenant_id: tenantId, venue_id: to, kind, name: name + ' ' + i, short_code: prefix + i, settings, created_by: by })
    }
    const tableService = plan.modes.tables !== 'skip'
    add('terminal', d.tills, 'Till', 'T', { mode: tableService ? 'table' : 'counter' })
    add('kds', d.kitchen_screens, 'Kitchen screen', 'K', {})
    add('kiosk', d.kiosks, 'Kiosk', 'KS', { card_reader: 'none' })
    if (rows.length) {
      await tx`INSERT INTO pos_devices ${tx(rows.map(r => ({ ...r, settings: tx.json(r.settings) })))}`
      lines.push([d.tills && plural(d.tills, 'till'), d.kitchen_screens && plural(d.kitchen_screens, 'kitchen screen'), d.kiosks && plural(d.kiosks, 'kiosk')].filter(Boolean).join(', ') + ', ready to link')
    }
    if (d.menu_screens) {
      if (s.allowedModule('screens')) {
        for (let i = 1; i <= d.menu_screens; i++) {
          const code = await nextScreenCode(tx, tenantId, usedCodes)
          await tx`INSERT INTO screens (tenant_id, venue_id, name, short_code, sort_order) VALUES (${tenantId}, ${to}, ${'Menu screen ' + i}, ${code}, ${i})`
        }
        lines.push(plural(d.menu_screens, 'menu screen') + ', ready to link (pick their boards on the Screens page)')
      } else lines.push('Menu screens left out: they need Screens manage')
    }
    return lines
  },

  // ── Online ordering ──
  async ordering(s, mode, plan) {
    const { tx, tenantId, to } = s
    const enabled = plan.ordering.enabled && !s.opensLater
    if (mode === 'copy') {
      const [tpl] = await tx`SELECT menu_ids FROM ordering_settings WHERE venue_id = ${s.from} AND tenant_id = ${tenantId}`
      const rows = await copyTable(s, 'ordering_settings', { set: { is_enabled: enabled, is_paused: false } })
      if (!rows.length) {
        await tx`INSERT INTO ordering_settings (venue_id, tenant_id, is_enabled) VALUES (${to}, ${tenantId}, false)`
        return ['Nothing to copy: set up, switched off']
      }
      const lost = s.lostMenus(tpl?.menu_ids)
      return [(enabled ? 'Switched on' : 'Switched off until opening') + ', ' + plural((rows[0].menu_ids || []).length, 'menu'), lost ? lost + ' (a menu of the location copied from only) left out' : null].filter(Boolean)
    }
    await tx`INSERT INTO ordering_settings (venue_id, tenant_id, is_enabled) VALUES (${to}, ${tenantId}, false)`
    return ['Set up, switched off: pick its menus and hours in Ordering setup']
  },

  async deliveroo(s) {
    const rows = await copyTable(s, 'deliveroo_settings')
    const links = await copyTable(s, 'deliveroo_item_links')
    return [rows.length ? 'Price rules and allergen codes copied' : 'Nothing to copy', links.length ? plural(links.length, 'dish match', 'dish matches') : null].filter(Boolean)
  },

  // ── Website ──
  async website(s, mode, plan) {
    const { tx, tenantId, to } = s
    const L = plan.location
    const contact = {
      address_line1: L.address_line1, address_line2: L.address_line2, city: L.city, postcode: L.postcode,
      country: L.country, phone: L.phone, email: L.email, latitude: null, longitude: null, google_maps_embed_url: null,
    }
    if (mode === 'copy') {
      const cfg = await copyTable(s, 'website_config', { set: contact })
      if (!cfg.length) {
        await tx`INSERT INTO website_config ${tx({ tenant_id: tenantId, venue_id: to, ...contact })}`
        return ['Nothing to copy: a new location page with the address and contact details']
      }
      const parents = s.copiedFrom('website_config')
      await copyTable(s, 'website_opening_hours', { parentCol: 'website_config_id', parents, need: ['website_config_id'] })
      const gallery = await copyTable(s, 'website_gallery_images', { parentCol: 'website_config_id', parents, need: ['website_config_id'] })
      await copyTable(s, 'website_menu_documents', { parentCol: 'website_config_id', parents, need: ['website_config_id'] })
      await copyTable(s, 'website_allergen_info', { parentCol: 'website_config_id', parents, need: ['website_config_id'] })
      const pages = await copyTable(s, 'website_pages', { where: r => !r.system_key })
      return ['Location page with the same layout' + (gallery.length ? ', ' + plural(gallery.length, 'gallery picture') : '') + ' and this location\'s address', pages.length ? plural(pages.length, 'page') + ' of its own' : null].filter(Boolean)
    }
    await tx`INSERT INTO website_config ${tx({ tenant_id: tenantId, venue_id: to, ...contact })}`
    return ['A new location page with the address and contact details']
  },

  // ── Emails ──
  async emails(s, mode, plan) {
    const set = plan.emails.from_name ? { from_name: plan.emails.from_name } : {}
    const settings = await copyTable(s, 'venue_email_settings', { set })
    const tpls = await copyTable(s, 'email_templates')
    return [settings.length ? 'Sent the same way' + (settings[0].from_name ? ' as "' + settings[0].from_name + '"' : '') : 'No email settings to copy', tpls.length ? plural(tpls.length, 'email') + ' of its own' : null].filter(Boolean)
  },

  // ── Food safety ──
  async food_safety(s, mode, plan) {
    const { tx, tenantId, to } = s
    if (mode === 'copy') {
      const eq = await copyTable(s, 'fs_equipment')
      const times = await copyTable(s, 'fs_capture_times')
      const holds = await copyTable(s, 'fs_hold_stations')
      await copyTable(s, 'fs_hold_capture_times')
      const sessions = await copyTable(s, 'fs_cooking_sessions')
      await copyTable(s, 'fs_cooking_settings')
      const items = await copyTable(s, 'fs_cooking_items')
      return [[plural(eq.length, 'fridge or freezer', 'fridges and freezers'), plural(times.length, 'check time'), plural(holds.length, 'hold station'), plural(sessions.length, 'cooking session'), items.length && plural(items.length, 'cooking dish', 'cooking dishes')].filter(Boolean).join(', ')]
    }
    const f = plan.food_safety
    if (f.equipment.length) {
      await tx`INSERT INTO fs_equipment ${tx(f.equipment.map((e, i) => ({
        tenant_id: tenantId, venue_id: to, name: e.name, equipment_type: e.type,
        target_temp_c: DEFAULT_TEMPS[e.type].target, min_temp_c: DEFAULT_TEMPS[e.type].min, max_temp_c: DEFAULT_TEMPS[e.type].max, sort_order: i,
      })))}`
    }
    if (f.check_times.length) await tx`INSERT INTO fs_capture_times ${tx(f.check_times.map((t, i) => ({ tenant_id: tenantId, venue_id: to, label: checkLabel(t), time_of_day: t, sort_order: i })))}`
    if (f.hold_stations.length) {
      await tx`INSERT INTO fs_hold_stations ${tx(f.hold_stations.map((h, i) => ({
        tenant_id: tenantId, venue_id: to, name: h.name, hold_type: h.hold_type,
        target_temp_c: DEFAULT_TEMPS[h.hold_type].target, min_temp_c: DEFAULT_TEMPS[h.hold_type].min, max_temp_c: DEFAULT_TEMPS[h.hold_type].max, sort_order: i,
      })))}`
    }
    if (f.hold_check_times.length) await tx`INSERT INTO fs_hold_capture_times ${tx(f.hold_check_times.map((t, i) => ({ tenant_id: tenantId, venue_id: to, label: checkLabel(t), time_of_day: t, sort_order: i })))}`
    if (f.cooking_sessions.length) {
      await tx`INSERT INTO fs_cooking_sessions ${tx(f.cooking_sessions.map((c, i) => ({ tenant_id: tenantId, venue_id: to, label: c.label, time_of_day: c.time, required_items_count: c.required, sort_order: i })))}`
    }
    const fr = f.equipment.filter(e => e.type === 'fridge').length
    return [[fr && plural(fr, 'fridge'), f.equipment.length - fr && plural(f.equipment.length - fr, 'freezer'), f.check_times.length && 'checks at ' + f.check_times.join(', '), f.hold_stations.length && plural(f.hold_stations.length, 'hold station'), f.cooking_sessions.length && plural(f.cooking_sessions.length, 'cooking session')].filter(Boolean).join(', ')]
  },

  // ── Checklists ──
  async checklists(s, mode, plan) {
    const { tx, tenantId, to } = s
    if (mode === 'copy') {
      const tpls = await copyTable(s, 'checklist_templates')
      const items = await copyTable(s, 'checklist_template_items', { parentCol: 'template_id', parents: s.copiedFrom('checklist_templates'), need: ['template_id'] })
      return [tpls.length ? tpls.map(t => t.name).join(', ') + ' (' + plural(items.length, 'task') + ')' : 'No checklists to copy']
    }
    for (const [i, l] of plan.checklists.lists.entries()) {
      const [tpl] = await tx`
        INSERT INTO checklist_templates (tenant_id, venue_id, name, frequency, sort_order)
        VALUES (${tenantId}, ${to}, ${l.name}, ${l.frequency}, ${i}) RETURNING id`
      await tx`INSERT INTO checklist_template_items ${tx(l.tasks.map((label, j) => ({ tenant_id: tenantId, template_id: tpl.id, label, sort_order: j })))}`
    }
    return [plan.checklists.lists.map(l => l.name + ' (' + plural(l.tasks.length, 'task') + ')').join(', ')]
  },

  // ── Dashboards ──
  async dashboards(s) {
    const kinds = { hs: 'hs_dashboard', cash: 'cash_dashboard', rota: 'rota_dashboard', custom: 'custom_dashboard' }
    const dash = await copyTable(s, 'hs_dashboards', { where: r => s.allowedModule(kinds[r.kind]) })
    const widgets = await copyTable(s, 'hs_dashboard_widgets', { parentCol: 'dashboard_id', parents: s.copiedFrom('hs_dashboards'), need: ['dashboard_id', 'checklist_template_id'] })
    return [dash.length ? plural(dash.length, 'dashboard') + ' with ' + plural(widgets.length, 'widget') : 'No dashboards to copy']
  },

  // ── Purchasing ──
  async purchasing(s, mode, plan) {
    const pct = plan.purchasing.pars_percent
    const sv = await copyTable(s, 'supplier_venues', { set: { account_ref: null } })
    const lists = await copyTable(s, 'order_list_venues')
    const pars = await copyTable(s, 'order_list_pars', { set: { par_base: r => Math.max(0, Math.round(Number(r.par_base) * pct) / 100) } })
    const prices = await copyTable(s, 'inv_quote_venue_prices')
    await copyTable(s, 'inv_preferred')
    return [
      plural(sv.length, 'supplier') + ' with the same delivery days and cutoffs (account numbers left blank)',
      plural(lists.length, 'order list') + ', ' + plural(pars.length, 'par') + (pct !== 100 ? ' at ' + pct + '%' : ''),
      prices.length ? plural(prices.length, 'price') + ' of its own' : null,
    ].filter(Boolean)
  },

  // ── Team ──
  async staff(s, mode, plan) {
    const { tx, tenantId, to } = s
    const roles = await tx`SELECT id, name FROM staff_roles WHERE tenant_id = ${tenantId} AND is_active`
    const roleOf = name => roles.find(r => r.name.toLowerCase() === String(name || '').toLowerCase())?.id || null
    const people = plan.staff.people
    await tx`INSERT INTO cash_staff ${tx(people.map((p, i) => ({
      tenant_id: tenantId, venue_id: to, name: p.name, role_id: roleOf(p.role), pay_type: p.pay_type,
      default_rate: p.rate || null, sort_order: i,
    })))}`
    const unmatched = people.filter(p => p.role && !roleOf(p.role)).map(p => p.role)
    return [plural(people.length, 'person', 'people') + ' added', unmatched.length ? 'Roles not found (pick them on the Staff page): ' + [...new Set(unmatched)].join(', ') : null].filter(Boolean)
  },
}

/**
 * Creates the location. `allowed(areaKey)` / `allowedModule(module)` say what
 * the person may set up; an area they can't is left out (status no_access).
 * Throws (and the transaction rolls back) if any area fails, naming it.
 */
export async function createStore(tx, { tenantId, plan, by, allowed, allowedModule, today }) {
  const from = plan.template_venue_id
  if (from) {
    const [tpl] = await tx`SELECT id FROM venues WHERE id = ${from} AND tenant_id = ${tenantId}`
    if (!tpl) throw httpError(404, 'The location to copy from wasn\'t found')
  }
  const slug = await freeSlug(tx, tenantId, plan.venue.slug)
  const [venue] = await tx`
    INSERT INTO venues (tenant_id, name, slug, timezone, currency)
    VALUES (${tenantId}, ${plan.venue.name}, ${slug}, ${plan.venue.timezone}, ${plan.venue.currency})
    RETURNING *`

  const owned = new Set()
  const ids = new Map()
  if (from) {
    ids.set(from, venue.id)
    for (const table of OWNED_TABLES) {
      for (const r of await tx`SELECT id FROM ${tx(table)} WHERE tenant_id = ${tenantId} AND venue_id = ${from}`) owned.add(r.id)
    }
  }
  const venueMenus = from ? new Set((await tx`SELECT id FROM menus WHERE tenant_id = ${tenantId} AND venue_id = ${from}`).map(r => r.id)) : new Set()
  const s = {
    tx, tenantId, from, to: venue.id, ids, owned, by, today, allowedModule,
    opensLater: !!plan.opening_date && plan.opening_date > today,
    // The ids (of the location copied from) each table's copies were made from.
    copied: {},
    copiedFrom: table => s.copied[table] || [],
    // How many of these menu ids were the copied location's own (left out of the copy).
    lostMenus: menuIds => (menuIds || []).filter(id => venueMenus.has(id)).length,
    venueMenus,
  }

  const results = {}
  for (const key of AREA_ORDER) {
    const mode = plan.modes[key]
    if (!mode || mode === 'skip') { results[key] = { status: 'skipped', lines: [] }; continue }
    if (!allowed(key)) { results[key] = { status: 'no_access', lines: ['Left out: your role can\'t set this up'] }; continue }
    if (mode === 'copy' && !from) { results[key] = { status: 'skipped', lines: ['Nothing to copy from'] }; continue }
    try {
      const lines = await AREAS[key](s, mode, plan)
      results[key] = { status: 'done', mode, lines: lines.filter(Boolean) }
    } catch (err) {
      if (err.statusCode) throw err
      const e = httpError(422, 'Setting up ' + key.replace('_', ' ') + ' didn\'t work: ' + (err.message || 'unknown error').slice(0, 200))
      e.area = key
      throw e
    }
  }

  // Not open yet: closed for bookings until the opening day.
  if (s.opensLater && plan.modes.hours !== 'skip' && allowed('hours')) {
    const d = new Date(plan.opening_date + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() - 1)
    const until = d.toISOString().slice(0, 10)
    await tx`
      INSERT INTO schedule_exceptions (venue_id, tenant_id, name, date_from, date_to, is_closed, priority)
      VALUES (${venue.id}, ${tenantId}, 'Not open yet', ${today}, ${until}, true, 100)`
    results.hours.lines.push('Closed for bookings until ' + plan.opening_date)
  }
  return { venue, results }
}

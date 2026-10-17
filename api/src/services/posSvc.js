// src/services/posSvc.js
//
// The till (POS), cloud side. docs/POS.md has the design.
//
//   tillConfig()      everything a till needs to work offline (menus, option
//                     groups, meal deals, tables, staff with PIN hashes,
//                     revenue streams, order types, tax rates, courses,
//                     printers, promotions)
//   sequencer()       shared/pos/sequencer.js over Postgres: the cloud puts a
//                     venue's events in order until the venue hub takes over
//   loadDayChecks()   checks a trading day's figures are made from
//   fillReconFromDay() the Z report into Cash Recon (services/reconFill.js)
//   pairing codes, device secrets, PIN hashing
//
// Every query filters tenant_id itself (RLS alone isn't enough here).

import crypto from 'node:crypto'
import { withTenant } from '../config/db.js'
import { httpError } from '../middleware/error.js'
import { loadMenuVersions } from './menuReleases.js'
import { venuePromotions, publicPromotion } from './promoSvc.js'
import { fillReconDay, reconFields } from './reconFill.js'
import { createSequencer } from '../../../shared/pos/sequencer.js'
import { checkTotals, isActiveLine, lineGross } from '../../../shared/pos/pricing.js'
import { dayFigures } from '../../../shared/pos/reports.js'
import { normalisePermissions, DEFAULT_POS_ROLES } from '../../../shared/pos/permissions.js'
import { TENDERS } from '../../../shared/pos/checks.js'
import { kioskStaff } from '../../../shared/kiosk.js'
import { venueNow } from '../../../shared/promotions.js'
import { soldOutRows } from './soldOut.js'
import { loadKitchenConfig, activeFlowSetting } from './kitchenSvc.js'
import { ensureTaxDefaults, loadTaxRates, loadOrderTypes, loadStreams, taxForVenue } from './taxSvc.js'

export const DEFAULT_COURSES = [
  { name: 'Drinks', short_name: 'DR', hold_by_default: false },
  { name: 'Starters', short_name: 'ST', hold_by_default: false },
  { name: 'Mains', short_name: 'MN', hold_by_default: true },
  { name: 'Desserts', short_name: 'DS', hold_by_default: true },
]

/** Till roles and courses for a new tenant (existing tenants got them from migration 156). */
export async function seedPosDefaults(tx, tenantId) {
  const [{ roles }] = await tx`SELECT count(*)::int AS roles FROM pos_roles WHERE tenant_id = ${tenantId}`
  if (!roles) {
    for (const [i, r] of DEFAULT_POS_ROLES.entries()) {
      await tx`INSERT INTO pos_roles (tenant_id, name, permissions, sort_order) VALUES (${tenantId}, ${r.name}, ${tx.json(normalisePermissions(r.permissions))}, ${i})`
    }
  }
  const [{ courses }] = await tx`SELECT count(*)::int AS courses FROM pos_courses WHERE tenant_id = ${tenantId}`
  if (!courses) {
    for (const [i, c] of DEFAULT_COURSES.entries()) {
      await tx`INSERT INTO pos_courses (tenant_id, name, short_name, hold_by_default, sort_order) VALUES (${tenantId}, ${c.name}, ${c.short_name}, ${c.hold_by_default}, ${i})`
    }
  }
}

// ── Secrets ──────────────────────────────────────────────────────

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const PAIRING_MINUTES = 30

export const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex')

/** A one-time pairing code: 8 characters, shown as ABCD-EFGH. */
export function newPairingCode() {
  const bytes = crypto.randomBytes(8)
  let out = ''
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length]
  return out.slice(0, 4) + '-' + out.slice(4)
}

export const normaliseCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

export function newDeviceSecret() {
  return crypto.randomBytes(32).toString('base64url')
}

// ── Settings ─────────────────────────────────────────────────────

const DEFAULT_TENDERS = TENDERS.map(t => ({ key: t.key, label: t.label, enabled: ['cash', 'card_external'].includes(t.key) }))

/** The venue's till settings, created with defaults the first time. */
export async function ensureSettings(tx, tenantId, venueId) {
  await tx`
    INSERT INTO pos_settings (venue_id, tenant_id, tenders)
    VALUES (${venueId}, ${tenantId}, ${tx.json(DEFAULT_TENDERS)})
    ON CONFLICT (venue_id) DO NOTHING
  `
  const [s] = await tx`SELECT * FROM pos_settings WHERE venue_id = ${venueId} AND tenant_id = ${tenantId}`
  return s
}

export function settingsView(s) {
  const tenders = TENDERS.map(t => {
    const saved = (s.tenders || []).find(x => x.key === t.key)
    return { key: t.key, label: saved?.label || t.label, enabled: saved ? !!saved.enabled : ['cash', 'card_external'].includes(t.key) }
  })
  return {
    day_starts_at: s.day_starts_at,
    vat_number: s.vat_number, receipt_name: s.receipt_name, receipt_address: s.receipt_address || [],
    receipt_footer: s.receipt_footer, bill_footer: s.bill_footer, service_charge_label: s.service_charge_label,
    tenders, tips_enabled: s.tips_enabled, require_covers: s.require_covers,
    order_no_start: s.order_no_start, auto_logout_secs: s.auto_logout_secs,
    recon_map: s.recon_map || {}, recon_auto_fill: s.recon_auto_fill,
    kds_online_orders: s.kds_online_orders ?? true, kds_online_ready: s.kds_online_ready ?? true,
    kds_gloriafood: !!s.kds_gloriafood, kds_gloriafood_types: s.kds_gloriafood_types || {},
    kds_gloriafood_lead_mins: s.kds_gloriafood_lead_mins ?? 20,
  }
}

export async function ownVenue(tx, tenantId, venueId) {
  const [v] = await tx`SELECT id, tenant_id, name, timezone FROM venues WHERE id = ${venueId} AND tenant_id = ${tenantId}`
  if (!v) throw httpError(404, 'Venue not found')
  return v
}

// ── Staff ────────────────────────────────────────────────────────

/** Active staff of a venue with their till permissions. `signIn` leaves out
 *  people past their last working day (cash_staff.left_on, migration 164), so
 *  the till's sign-in list drops them; the sequencer still knows them, so
 *  orders taken on their last day and synced later aren't refused. */
export async function loadTillStaff(tx, tenantId, venueId, { signIn = false } = {}) {
  const rows = await tx`
    SELECT s.id, s.name, s.is_active, s.pos_pin_hash, s.pos_role_id, r.name AS role_name, r.permissions
      FROM cash_staff s
      LEFT JOIN pos_roles r ON r.id = s.pos_role_id AND r.tenant_id = s.tenant_id
     WHERE s.tenant_id = ${tenantId} AND s.venue_id = ${venueId} AND s.is_active = true
       AND (${!signIn} OR s.left_on IS NULL OR s.left_on >= CURRENT_DATE)
     ORDER BY s.sort_order, s.name
  `
  return rows.map(r => ({
    id: r.id, name: r.name, is_active: r.is_active, pin_hash: r.pos_pin_hash || null,
    role_id: r.pos_role_id, role_name: r.role_name || null, permissions: normalisePermissions(r.permissions || {}),
  }))
}

// ── Till config ──────────────────────────────────────────────────

/**
 * The menus a venue's till shows, live versions (migration 165): those its
 * revenue streams name, else every menu shown to guests that it can use.
 */
async function tillMenus(tx, tenantId, venueId, streams) {
  const named = [...new Set(streams.flatMap(r => r.menu_ids || []))]
  return named.length
    ? loadMenuVersions(tx, tenantId, { menuIds: named, venueId })
    : loadMenuVersions(tx, tenantId, { venueId, publishedOnly: true })
}

/**
 * The menus of these revenue streams as a till or kiosk carries them:
 * { menus: [{ id, name, sections: [{ id, title, ..., item_ids }] }], items: { id: item },
 *   section_items, dietary }. Sections hidden everywhere stay off. `guest`
 * (a kiosk, services/kioskSvc.js): sections hidden on the website stay off
 * too, and dishes carry what guests see (photo, calories, featured).
 * Tax settings travel with each dish (dish, section, menu), trimmed to this
 * venue; the till works the rate out per check (shared/tax.js), since the
 * order type and revenue stream decide it.
 */
export async function tillMenuData(tx, tenantId, venueId, streams, { guest = false, allStreams = streams } = {}) {
  const menus = []
  const items = {}
  let dietary = []
  const streamIds = new Set(allStreams.map(r => r.id))
  for (const full of await tillMenus(tx, tenantId, venueId, streams)) {
    const menuTax = taxForVenue(full.tax, venueId, streamIds)
    dietary = full.dietary_tags || dietary
    const sections = []
    for (const s of full.sections || []) {
      const visibility = s.visibility || 'show'
      if (visibility === 'hidden' || (guest && visibility !== 'show')) continue
      const sectionTax = taxForVenue(s.tax, venueId, streamIds)
      const ids = []
      for (const it of s.items || []) {
        ids.push(it.id)
        if (items[it.id]) continue
        items[it.id] = {
          id: it.id, name: it.name, kitchen_name: it.kitchen_name || null, section_id: s.id,
          price_pence: it.price_pence ?? null, kind: it.kind || 'dish',
          course_id: it.pos_course_id || s.pos_course_id || null,
          colour: it.pos_colour || s.pos_colour || null,
          tax: [taxForVenue(it.tax, venueId, streamIds), sectionTax, menuTax],
          variants: it.variants || [], variant_groups: it.variant_groups || [],
          combo: it.combo || null,
          dietary: it.dietary || [], allergen_levels: it.allergen_levels || {},
          description: it.description || null,
          ...(guest ? { image_url: it.image_url || null, calories: it.calories ?? null, is_featured: !!it.is_featured } : {}),
        }
      }
      sections.push({
        id: s.id, title: s.title, colour: s.pos_colour || null, course_id: s.pos_course_id || null, item_ids: ids,
        ...(guest ? { subtitle: s.subtitle || null, image_url: s.image_url || null } : {}),
      })
    }
    menus.push({ id: full.id, name: full.name, sections })
  }
  // Combos (shared/combos.js) find a section option's dishes through this:
  // every dish of the section the till knows.
  const sectionItems = {}
  for (const m of menus) for (const s of m.sections) sectionItems[s.id] = [...new Set([...(sectionItems[s.id] || []), ...s.item_ids])]
  return { menus, items, section_items: sectionItems, dietary }
}

/**
 * Everything a till needs, one snapshot. `version` changes whenever any of
 * it does, so a till only downloads a new one when something changed.
 */
export async function tillConfig(tx, tenantId, venueId) {
  const venue = await ownVenue(tx, tenantId, venueId)
  const settings = await ensureSettings(tx, tenantId, venueId)
  await ensureTaxDefaults(tx, tenantId)
  const [streams, orderTypes, taxRates, courses, areas, tables, roles, printers, routes, groups, devices] = await Promise.all([
    loadStreams(tx, tenantId, venueId, { activeOnly: true }),
    loadOrderTypes(tx, tenantId),
    loadTaxRates(tx, tenantId),
    tx`SELECT id, name, short_name, hold_by_default, colour, sort_order FROM pos_courses
        WHERE tenant_id = ${tenantId} AND is_active ORDER BY sort_order, name`,
    tx`SELECT id, name, width, height, revenue_stream_id, decor, sort_order FROM floor_areas
        WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} ORDER BY sort_order, name`,
    tx`SELECT id, label, min_covers, max_covers, section_id, floor_area_id,
              pos_x::float8 AS x, pos_y::float8 AS y, pos_w::float8 AS w, pos_h::float8 AS h, shape, rotation, sort_order
         FROM tables WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND is_active AND NOT COALESCE(is_unallocated, false)
        ORDER BY sort_order, label`,
    tx`SELECT id, name, permissions, sort_order FROM pos_roles WHERE tenant_id = ${tenantId} ORDER BY sort_order, name`,
    tx`SELECT id, name, kind, host, port, columns, backup_printer_id, sort_order FROM pos_printers
        WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND is_active ORDER BY sort_order, name`,
    tx`SELECT printer_id, target_kind, target_id FROM pos_print_routes WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`,
    tx`SELECT g.id, g.name, g.price_mode, g.min_select, g.max_select, g.pos_prefixes, g.allow_repeat, g.on_request,
              COALESCE(json_agg(json_build_object('id', o.id, 'label', o.label, 'price_pence', o.price_pence, 'child_group_id', o.child_group_id)
                ORDER BY o.sort_order, o.label) FILTER (WHERE o.id IS NOT NULL), '[]') AS options
         FROM menu_variant_groups g
         LEFT JOIN menu_variant_options o ON o.group_id = g.id AND o.tenant_id = g.tenant_id
        WHERE g.tenant_id = ${tenantId}
        GROUP BY g.id`,
    tx`SELECT id, name, kind, short_code, settings FROM pos_devices
        WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND revoked_at IS NULL`,
  ])
  const staff = await loadTillStaff(tx, tenantId, venueId, { signIn: true })
  const { menus, items, section_items: sectionItems, dietary } = await tillMenuData(tx, tenantId, venueId, streams)

  const tz = venue.timezone || 'Europe/London'
  // Dishes sold out at the venue now (services/soldOut.js), with when they
  // come back (null = until someone puts them back).
  const soldOut = (await soldOutRows(tx, tenantId, venueId)).map(r => ({ item_id: r.item_id, until: r.sold_out_until }))
  const promotions = (await venuePromotions(tx, { id: venueId, tenant_id: tenantId }, venueNow(tz).date, 'pos'))
    .map(p => ({ ...publicPromotion(p, { withCode: true }), max_uses: p.max_uses ?? null }))

  const config = {
    venue: { id: venue.id, name: venue.name, timezone: tz },
    settings: settingsView(settings),
    pin_salt: settings.pin_salt,
    revenue_streams: streams,
    order_types: orderTypes,
    tax_rates: taxRates.map(r => ({ ...r, values: r.values[venueId] != null ? { [venueId]: r.values[venueId] } : {} })),
    courses,
    floor_areas: areas.map(a => ({ ...a, decor: a.decor || [] })),
    tables,
    roles: roles.map(r => ({ id: r.id, name: r.name, permissions: normalisePermissions(r.permissions || {}) })),
    staff,
    menus,
    items,
    section_items: sectionItems,
    groups: Object.fromEntries(groups.map(g => [g.id, g])),
    dietary_tags: (dietary || []).map(t => ({ code: t.code, label: t.label, kind: t.kind, colour: t.colour, glyph: t.glyph })),
    printers,
    routes,
    promotions,
    sold_out: soldOut,
    // A kiosk's orders name the kiosk as their server (shared/kiosk.js), so
    // the till shows its name from here.
    devices: devices.map(d => ({ id: d.id, name: d.name, kind: d.kind, short_code: d.short_code, settings: d.settings || {} })),
  }
  config.version = sha256(JSON.stringify(config)).slice(0, 16)
  return config
}

/** The printing config the sequencer gives shared/pos/printing.js. */
async function printConfig(tx, tenantId, venueId) {
  const venue = await ownVenue(tx, tenantId, venueId)
  const settings = settingsView(await ensureSettings(tx, tenantId, venueId))
  const [printers, routes, tables, staff, courses, devices, orderTypes] = await Promise.all([
    tx`SELECT id, name, kind, columns FROM pos_printers WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND is_active`,
    tx`SELECT printer_id, target_kind, target_id FROM pos_print_routes WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`,
    tx`SELECT id, label FROM tables WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`,
    tx`SELECT id, name FROM cash_staff WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`,
    tx`SELECT id, name, sort_order FROM pos_courses WHERE tenant_id = ${tenantId}`,
    tx`SELECT id, name, kind, settings FROM pos_devices WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`,
    tx`SELECT id, name FROM order_types WHERE tenant_id = ${tenantId}`,
  ])
  const by = (rows, f = r => r) => Object.fromEntries(rows.map(r => [r.id, f(r)]))
  return {
    venue: { name: venue.name },
    settings,
    printers: by(printers),
    routes,
    tables: by(tables),
    // A kiosk order's server is the kiosk.
    staff: { ...by(devices.filter(d => d.kind === 'kiosk'), d => ({ name: d.name })), ...by(staff) },
    courses: by(courses),
    order_types: by(orderTypes),
    devices: by(devices, d => ({ receipt_printer_id: d.settings?.receipt_printer_id || null })),
    timezone: venue.timezone || 'Europe/London',
  }
}

// ── Projections ──────────────────────────────────────────────────

async function saveCheck(tx, tenantId, venueId, c, seq) {
  const t = checkTotals(c)
  await tx`
    INSERT INTO pos_checks (id, tenant_id, venue_id, day_id, number, order_no, mode, table_id, tab_name, covers,
                            server_id, revenue_stream_id, order_type_id, tent, status, opened_at, closed_at,
                            subtotal, discount, service_charge, total, vat, paid, tips, refunded, state, last_seq, updated_at)
    VALUES (${c.id}, ${tenantId}, ${venueId}, ${c.day_id}, ${c.number}, ${c.order_no}, ${c.mode}, ${c.table_id}, ${c.tab_name},
            ${c.covers}, ${c.server_id}, ${c.revenue_stream_id ?? null}, ${c.order_type_id ?? null}, ${c.tent ?? null},
            ${c.status}, ${c.opened_at}, ${c.closed_at},
            ${t.subtotal}, ${t.discount}, ${t.service_charge}, ${t.total}, ${t.vat_total}, ${t.paid}, ${t.tips}, ${t.refunded},
            ${tx.json(c)}, ${seq}, now())
    ON CONFLICT (id) DO UPDATE SET
      number = EXCLUDED.number, order_no = EXCLUDED.order_no, mode = EXCLUDED.mode, table_id = EXCLUDED.table_id,
      tab_name = EXCLUDED.tab_name, covers = EXCLUDED.covers, server_id = EXCLUDED.server_id,
      revenue_stream_id = EXCLUDED.revenue_stream_id, order_type_id = EXCLUDED.order_type_id, tent = EXCLUDED.tent,
      status = EXCLUDED.status, closed_at = EXCLUDED.closed_at,
      subtotal = EXCLUDED.subtotal, discount = EXCLUDED.discount, service_charge = EXCLUDED.service_charge,
      total = EXCLUDED.total, vat = EXCLUDED.vat, paid = EXCLUDED.paid, tips = EXCLUDED.tips, refunded = EXCLUDED.refunded,
      state = EXCLUDED.state, last_seq = EXCLUDED.last_seq, updated_at = now()
    WHERE pos_checks.tenant_id = ${tenantId}
  `
  await tx`DELETE FROM pos_check_lines WHERE tenant_id = ${tenantId} AND check_id = ${c.id}`
  await tx`DELETE FROM pos_payments WHERE tenant_id = ${tenantId} AND check_id = ${c.id}`
  const byLine = Object.fromEntries(t.lines.map(l => [l.id, l]))
  for (const l of c.lines) {
    const lt = byLine[l.id]
    const gross = lineGross(l)
    await tx`
      INSERT INTO pos_check_lines (id, tenant_id, venue_id, check_id, day_id, item_id, section_id, name, qty, gross, discount, net,
                                   vat_rate, vat, tax_rate_id, revenue_stream_id, course_id, seat, status, added_by, voided_by,
                                   void_reason, void_day_id, sent_at)
      VALUES (${l.id}, ${tenantId}, ${venueId}, ${c.id}, ${c.day_id}, ${l.item_id}, ${l.section_id}, ${l.name}, ${l.qty},
              ${gross}, ${lt ? lt.discount : 0}, ${lt ? lt.net : 0}, ${l.vat_rate}, ${lt ? lt.vat : 0}, ${l.tax_rate_id ?? null},
              ${l.revenue_stream_id ?? c.revenue_stream_id ?? null}, ${l.course_id}, ${l.seat}, ${l.status}, ${l.added_by},
              ${l.voided?.by ?? null}, ${l.voided?.reason ?? null}, ${l.voided?.day_id ?? null}, ${l.sent_at})
      ON CONFLICT (id) DO NOTHING
    `
  }
  for (const p of c.payments) {
    await tx`
      INSERT INTO pos_payments (id, tenant_id, venue_id, check_id, day_id, kind, tender, amount, tip, staff_id, voided, reason, at)
      VALUES (${p.id}, ${tenantId}, ${venueId}, ${c.id}, ${p.day_id}, 'payment', ${p.tender}, ${p.amount}, ${p.tip || 0},
              ${p.by}, ${!!p.voided}, ${p.void_reason ?? null}, ${p.at})
      ON CONFLICT (id) DO NOTHING
    `
  }
  for (const r of c.refunds || []) {
    await tx`
      INSERT INTO pos_payments (id, tenant_id, venue_id, check_id, day_id, kind, tender, amount, tip, staff_id, voided, reason, at)
      VALUES (${r.id}, ${tenantId}, ${venueId}, ${c.id}, ${r.day_id}, 'refund', ${r.tender}, ${r.amount}, 0,
              ${r.by}, false, ${r.reason}, ${r.at})
      ON CONFLICT (id) DO NOTHING
    `
  }
}

/** Every check a day's figures need: opened that day, or with money or a void that day. */
export async function loadDayChecks(tx, tenantId, venueId, dayId) {
  const rows = await tx`
    SELECT state FROM pos_checks c
     WHERE c.tenant_id = ${tenantId} AND c.venue_id = ${venueId}
       AND (c.day_id = ${dayId}
            OR EXISTS (SELECT 1 FROM pos_payments p WHERE p.check_id = c.id AND p.tenant_id = ${tenantId} AND p.day_id = ${dayId})
            OR EXISTS (SELECT 1 FROM pos_check_lines l WHERE l.check_id = c.id AND l.tenant_id = ${tenantId} AND l.void_day_id = ${dayId}))
  `
  return rows.map(r => r.state)
}

// ── Sequencer over Postgres ──────────────────────────────────────

/**
 * A sequencer for one venue. The cloud is the venue's sequencer until a hub
 * is installed (docs/POS.md): every event goes through here, one at a time
 * per venue (advisory lock), each in its own transaction.
 */
export function sequencer(tenantId, venueId, { deviceId = null } = {}) {
  let tx = null
  let ctxCache = null

  const store = {
    run: (_venue, fn) => withTenant(tenantId, async t => {
      await t`SELECT pg_advisory_xact_lock(hashtext(${'pos:' + venueId}))`
      tx = t
      try { return await fn() } finally { tx = null }
    }),
    async findEvent(id) {
      const [e] = await tx`SELECT id, seq, type, check_id, assigned FROM pos_events WHERE id = ${id} AND tenant_id = ${tenantId}`
      return e ? { ...e, seq: Number(e.seq) } : null
    },
    async findRejection(id) {
      const [r] = await tx`SELECT error, code FROM pos_event_rejections WHERE id = ${id} AND tenant_id = ${tenantId}`
      return r || null
    },
    async context() {
      // Cached for the batch, except the kitchen flow in use: a switch made
      // between two events of the batch (switchFlow() takes the same lock)
      // counts from the next one.
      if (ctxCache?.kitchen?.enabled && await activeFlowSetting(tx, tenantId, venueId) !== ctxCache.kitchen.active_setting) {
        ctxCache = { ...ctxCache, kitchen: await loadKitchenConfig(tx, tenantId, venueId) }
      }
      if (ctxCache) return ctxCache
      const staff = await loadTillStaff(tx, tenantId, venueId)
      // Self-order kiosks are known by their device id, with the kiosk rules
      // (shared/pos/checks.js) and no permissions.
      const kiosks = await tx`
        SELECT id, name FROM pos_devices
         WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND kind = 'kiosk' AND revoked_at IS NULL`
      const print = await printConfig(tx, tenantId, venueId)
      const settings = print.settings
      ctxCache = {
        staffById: Object.fromEntries([...kiosks.map(kioskStaff), ...staff].map(s => [s.id, s])),
        print, settings, timezone: print.timezone,
        kitchen: await loadKitchenConfig(tx, tenantId, venueId),
      }
      return ctxCache
    },
    async venueState() {
      await tx`
        INSERT INTO pos_venue_state (venue_id, tenant_id) VALUES (${venueId}, ${tenantId})
        ON CONFLICT (venue_id) DO NOTHING
      `
      const [s] = await tx`SELECT * FROM pos_venue_state WHERE venue_id = ${venueId} AND tenant_id = ${tenantId}`
      const [day] = await tx`
        SELECT id, business_date::text AS business_date FROM pos_days
         WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND closed_at IS NULL LIMIT 1`
      return { last_seq: Number(s.last_seq), next_check_no: s.next_check_no, next_order_no: s.next_order_no, day: day || null }
    },
    async openDay({ business_date, at }) {
      const [day] = await tx`
        INSERT INTO pos_days (tenant_id, venue_id, business_date, opened_at)
        VALUES (${tenantId}, ${venueId}, ${business_date}::date, ${at})
        RETURNING id, business_date::text AS business_date`
      return day
    },
    async loadChecks(ids) {
      if (!ids.length) return {}
      const rows = await tx`SELECT id, state FROM pos_checks WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND id = ANY(${ids}::text[])`
      return Object.fromEntries(rows.map(r => [r.id, r.state]))
    },
    async openCheckCount() {
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM pos_checks WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND status = 'open'`
      return n
    },
    async saveEvent(e) {
      await tx`
        INSERT INTO pos_events (id, tenant_id, venue_id, seq, day_id, check_id, device_id, staff_id, approved_by, type, payload, assigned, client_at)
        VALUES (${e.id}, ${tenantId}, ${venueId}, ${e.seq}, ${e.assigned?.day_id ?? null}, ${e.check_id ?? null},
                ${e.device_id ?? deviceId}, ${e.staff_id ?? null}, ${e.approved_by ?? null}, ${e.type}, ${tx.json(e.payload || {})},
                ${tx.json(e.assigned || {})}, ${e.client_at ?? null})`
    },
    async saveChecks(changed, e) {
      for (const c of Object.values(changed)) await saveCheck(tx, tenantId, venueId, c, e.seq)
    },
    // ── Kitchen screens (shared/pos/kitchen.js) ──
    async loadKitchenOrders(ids) {
      if (!ids.length) return {}
      const rows = await tx`SELECT id, state FROM kds_orders WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND id = ANY(${ids}::text[])`
      return Object.fromEntries(rows.map(r => [r.id, r.state]))
    },
    async saveKitchenOrders(changed, e) {
      for (const o of Object.values(changed)) {
        await tx`
          INSERT INTO kds_orders (id, tenant_id, venue_id, source, check_id, order_id, status, created_at, ready_at, collected_at, state, last_seq, updated_at)
          VALUES (${o.id}, ${tenantId}, ${venueId}, ${o.source}, ${o.check_id}, ${o.order_id}, ${o.status},
                  ${o.created_at}, ${o.ready_at}, ${o.collected_at}, ${tx.json(o)}, ${e.seq}, now())
          ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status, ready_at = EXCLUDED.ready_at, collected_at = EXCLUDED.collected_at,
            state = EXCLUDED.state, last_seq = EXCLUDED.last_seq, updated_at = now()
          WHERE kds_orders.tenant_id = ${tenantId}`
      }
    },
    async saveKitchenLog(rows, e, orders) {
      const o = Object.values(orders || {})[0] || {}
      for (const r of rows) {
        if (r.kind === 'recall') {
          await tx`UPDATE kds_log SET recalled_at = ${e.received_at} WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND event_id = ${r.bump_event_id}`
          continue
        }
        await tx`
          INSERT INTO kds_log (tenant_id, venue_id, kind, kitchen_order_id, event_id, station_id, station_name, station_kind, at,
                               seconds, items, item_name, reason, order_source, order_type, order_number)
          VALUES (${tenantId}, ${venueId}, ${r.kind}, ${o.id || ''}, ${e.id}, ${r.station?.id || null}, ${r.station?.name || null},
                  ${r.station?.kind || null}, ${r.at}, ${r.seconds ?? null}, ${r.items ?? null}, ${r.item_name ?? null},
                  ${r.reason ?? null}, ${o.source || null}, ${o.type_name || null}, ${o.number || null})`
      }
    },
    async saveJobs(jobs, e) {
      for (const j of jobs) {
        await tx`
          INSERT INTO pos_print_jobs (tenant_id, venue_id, printer_id, event_id, check_id, kind, title, ops)
          VALUES (${tenantId}, ${venueId}, ${j.printer_id}, ${e.id}, ${j.check_id}, ${j.kind}, ${j.title || null}, ${tx.json(j.ops)})`
      }
    },
    async saveRejection(e, error, code) {
      await tx`
        INSERT INTO pos_event_rejections (id, tenant_id, venue_id, check_id, device_id, staff_id, type, payload, client_at, error, code)
        VALUES (${String(e.id || crypto.randomUUID())}, ${tenantId}, ${venueId}, ${e.check_id ?? null}, ${e.device_id ?? deviceId},
                ${/^[0-9a-f-]{36}$/i.test(e.staff_id || '') ? e.staff_id : null}, ${String(e.type || 'unknown')},
                ${tx.json(e.payload || {})}, ${validTime(e.client_at)}, ${error}, ${code})
        ON CONFLICT (id) DO NOTHING`
    },
    async saveVenueState(v) {
      await tx`
        UPDATE pos_venue_state
           SET last_seq = ${v.last_seq}, next_check_no = ${v.next_check_no}, next_order_no = ${v.next_order_no}, updated_at = now()
         WHERE venue_id = ${venueId} AND tenant_id = ${tenantId}`
    },
    async closeDay(day, e) {
      const checks = await loadDayChecks(tx, tenantId, venueId, day.id)
      const figures = dayFigures(checks, day.id)
      const [s] = await tx`SELECT next_z_number FROM pos_venue_state WHERE venue_id = ${venueId} AND tenant_id = ${tenantId}`
      await tx`
        UPDATE pos_days
           SET closed_at = now(), closed_by = ${e.staff_id}, declared_cash = ${e.payload?.declared_cash ?? null},
               close_notes = ${e.payload?.notes ?? null}, figures = ${tx.json(figures)}, z_number = ${s.next_z_number}
         WHERE id = ${day.id} AND tenant_id = ${tenantId}`
      await tx`UPDATE pos_venue_state SET next_z_number = next_z_number + 1 WHERE venue_id = ${venueId} AND tenant_id = ${tenantId}`
    },
  }
  return createSequencer(store)
}

function validTime(v) {
  const d = v ? new Date(v) : null
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null
}

// ── Cash Recon feed ──────────────────────────────────────────────

/**
 * The Cash Recon fields a day fills (pos_settings.recon_map):
 *   income  { sourceId: [revenue stream ids | 'all' | '-refunds'] }  sales after discounts
 *   takings { channelId: [tender keys] }                             money in, tips included, refunds out
 *   sc      { sourceId: ['service_charge' | 'tips'] }
 * Amounts in pounds.
 */
export function reconValues(figures, map, fields) {
  const out = []
  const pounds = p => Math.round(p) / 100
  for (const src of fields.income) {
    const terms = map.income?.[src.id] || []
    if (!terms.length) continue
    let p = 0
    for (const rs of figures.revenue_streams) if (terms.includes('all') || terms.includes(rs.id)) p += rs.net
    if (terms.includes('-refunds')) p -= figures.refunds.amount
    out.push({ group: 'income', id: src.id, name: src.name, source: src, amount: pounds(p) })
  }
  for (const ch of fields.takings) {
    const terms = map.takings?.[ch.id] || []
    if (!terms.length) continue
    const p = figures.tenders.filter(t => terms.includes(t.tender)).reduce((s, t) => s + t.amount + t.tips - t.refunds, 0)
    out.push({ group: 'takings', id: ch.id, name: ch.name, amount: pounds(p) })
  }
  for (const sc of fields.sc) {
    const terms = map.sc?.[sc.id] || []
    if (!terms.length) continue
    let p = 0
    if (terms.includes('service_charge')) p += figures.sales.service_charge
    if (terms.includes('tips')) p += figures.tips
    out.push({ group: 'sc', id: sc.id, name: sc.name, amount: pounds(p) })
  }
  return out
}

/** Write a closed day's figures into Cash Recon. Returns { filled, skipped, fields }. */
export async function fillReconFromDay(tenantId, venueId, dayId, by) {
  return withTenant(tenantId, async tx => {
    const [day] = await tx`
      SELECT id, business_date::text AS business_date, figures, closed_at FROM pos_days
       WHERE id = ${dayId} AND tenant_id = ${tenantId} AND venue_id = ${venueId}`
    if (!day) throw httpError(404, 'Trading day not found')
    const figures = day.figures || dayFigures(await loadDayChecks(tx, tenantId, venueId, day.id), day.id)
    const settings = await ensureSettings(tx, tenantId, venueId)
    const fields = reconValues(figures, settings.recon_map || {}, await reconFields(tx, tenantId, venueId))
    if (!fields.length) {
      await tx`UPDATE pos_days SET recon_error = 'Nothing is mapped to Cash Recon yet' WHERE id = ${day.id} AND tenant_id = ${tenantId}`
      return { filled: false, skipped: 'not_mapped', fields }
    }
    const r = await fillReconDay(tx, { tenantId, venueId, date: day.business_date, fields, source: 'pos', by })
    await tx`
      UPDATE pos_days SET recon_filled_at = ${r.filled ? new Date() : null},
             recon_error = ${r.skipped ? 'The Cash Recon day is already submitted' : null}
       WHERE id = ${day.id} AND tenant_id = ${tenantId}`
    return { filled: !!r.filled, skipped: r.skipped || null, date: day.business_date, fields }
  })
}

/** Figures for a day: the stored Z for a closed day, worked out now for the open one. */
export async function dayReport(tx, tenantId, venueId, dayId) {
  const [day] = await tx`
    SELECT id, business_date::text AS business_date, z_number, opened_at, closed_at, closed_by, declared_cash, close_notes,
           figures, recon_filled_at, recon_error
      FROM pos_days WHERE id = ${dayId} AND tenant_id = ${tenantId} AND venue_id = ${venueId}`
  if (!day) throw httpError(404, 'Trading day not found')
  const figures = day.figures || dayFigures(await loadDayChecks(tx, tenantId, venueId, day.id), day.id)
  return { ...day, figures, live: !day.figures }
}

export { isActiveLine }

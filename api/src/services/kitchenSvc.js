// src/services/kitchenSvc.js
//
// Kitchen screens (KDS), cloud side. docs/POS.md section 9; the rules are in
// shared/pos/kitchen.js and run inside the sequencer (services/posSvc.js).
//
//   loadKitchenConfig()     what the sequencer's kitchen rules need (stations,
//                           the flow in use, courses, tables, staff, revenue
//                           centres)
//   kdsConfig()             what a kitchen screen downloads (/pos-api/config)
//   loadFlows() / ensureFlows() / activeFlowOf()
//                           a venue's kitchen flows (migration 177) and the one
//                           in use (pos_settings.kds_active_flow_id, else the
//                           first)
//   switchFlow()            put another flow in use (Till setup, or a kitchen
//                           screen's flow button): dishes sent after it follow
//                           it, dishes already sent keep their way (item.route)
//   kitchenSync()           kitchen orders since a sequence number
//   submitServerEvent()     a kitchen event made by the server (online orders)
//   kitchenOnOnlineOrder()  called by orderSvc after an online order changes:
//                           accepted -> into the kitchen, ready / completed /
//                           cancelled -> the kitchen follows
//   kitchenOnGloriaFood()   the same for GloriaFood orders (migration 178),
//                           called after orders are stored (push, poll) and
//                           after a board move; gloriaFoodTypes() is which
//                           order type each GloriaFood type goes to
//   kitchenPrintsDue()      the minute sweep: orders for later print at the
//                           kitchen printers when their time comes (migration 191)
//   announceKitchen()       tell the venue's screens to sync
//   boardFor()              order ready board numbers for a venue (all
//                           counter / online orders, and per board station)
//   kitchenTestToken() / readKitchenTestToken() / kitchenTestData()
//                           the kitchen test bench's signed link and what it
//                           works from (pos/src/kitchen/Bench.jsx)
//
// Every query filters tenant_id itself.

import { withTenant, systemSql } from '../config/db.js'
import { broadcast } from '../config/ws.js'
import { httpError } from '../middleware/error.js'
import { ulid } from '../../../shared/pos/ids.js'
import { onlineOrderId, gloriaFoodOrderId, stationSettings, boardNumbers, STALE_HOURS, BUMP_KINDS } from '../../../shared/pos/kitchen.js'
import { typeLabel as gfTypeLabel, TYPE_LABELS as GF_TYPE_LABELS } from '../../../shared/gloriafood.js'
import { createHash } from 'node:crypto'
import { makeLink, readLink } from './previewLinks.js'
import { printLayouts } from './printDesignSvc.js'
import { hasPrinters, printsDue } from '../../../shared/pos/kitchenPrint.js'

const by = (rows, f = r => r) => Object.fromEntries(rows.map(r => [r.id, f(r)]))

export async function loadStations(tx, tenantId, venueId, { activeOnly = true } = {}) {
  return tx`
    SELECT id, name, kind, colour, settings, sort_order, is_active FROM kds_stations
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} ${activeOnly ? tx`AND is_active` : tx``}
     ORDER BY sort_order, name`
}

/** A venue's kitchen flows, in their order: [{ id, name, layout, sort_order, off_station_ids }]. */
export async function loadFlows(tx, tenantId, venueId) {
  return tx`
    SELECT id, name, layout, sort_order, off_station_ids FROM kds_flows
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}
     ORDER BY sort_order, created_at`
}

/** The venue's flows, making the first one ("Main flow") when it has none. */
export async function ensureFlows(tx, tenantId, venueId) {
  const flows = await loadFlows(tx, tenantId, venueId)
  if (flows.length) return flows
  await tx`
    INSERT INTO kds_flows (tenant_id, venue_id, name) VALUES (${tenantId}, ${venueId}, 'Main flow')
    ON CONFLICT DO NOTHING`
  return loadFlows(tx, tenantId, venueId)
}

/** The flow in use: the one pos_settings names, else the first. */
export function activeFlowOf(flows, activeId) {
  return flows.find(f => f.id === activeId) || flows[0] || null
}

/** A flow's links between the given stations: [{ id, from, to, targets }]. */
export async function loadFlow(tx, tenantId, flowId, stations) {
  if (!flowId) return []
  const live = new Set(stations.map(s => s.id))
  const rows = await tx`
    SELECT id, from_station_id AS "from", to_station_id AS "to", targets
      FROM kds_flow_edges WHERE tenant_id = ${tenantId} AND flow_id = ${flowId}
     ORDER BY sort_order, created_at`
  return rows.filter(l => live.has(l.to) && (!l.from || live.has(l.from)))
}

async function flowSetting(tx, tenantId, venueId) {
  const [s] = await tx`
    SELECT kds_active_flow_id, kds_flow_switched_at, kds_flow_switched_by FROM pos_settings
     WHERE venue_id = ${venueId} AND tenant_id = ${tenantId}`
  return s || {}
}

const stationView = s => ({ id: s.id, name: s.name, kind: s.kind, colour: s.colour, settings: stationSettings(s) })
// Stations that make a venue have a kitchen: something to bump, or a kitchen
// printer in the flow (migration 191).
const KITCHEN_KINDS = [...BUMP_KINDS, 'printer']

/**
 * The sequencer's kitchen config. enabled = the venue has an active station
 * with something to bump (prep, expo or runner) or a kitchen printer. A
 * printer box whose printer is gone or switched off prints nothing
 * (settings.printer_id null); ticket_layout = the venue's kitchen ticket
 * design (print designs, migration 190). A station switched off is
 * left out, so dishes pass straight through it. flow = the links of the flow
 * in use (flow_id); active_setting = pos_settings.kds_active_flow_id as read,
 * so the sequencer can tell a switch happened (activeFlowSetting()).
 */
export async function loadKitchenConfig(tx, tenantId, venueId) {
  const stations = await loadStations(tx, tenantId, venueId)
  const setting = await flowSetting(tx, tenantId, venueId)
  const active_setting = setting.kds_active_flow_id || null
  if (!stations.some(s => KITCHEN_KINDS.includes(s.kind))) return { enabled: false, stations: {}, flow: [], flow_id: null, active_setting }
  const flows = await loadFlows(tx, tenantId, venueId)
  const active = activeFlowOf(flows, active_setting)
  const [flow, courses, tables, staff, types, printers, layouts] = await Promise.all([
    loadFlow(tx, tenantId, active?.id, stations),
    tx`SELECT id, name, sort_order FROM pos_courses WHERE tenant_id = ${tenantId}`,
    tx`SELECT id, label FROM tables WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`,
    tx`SELECT id, name FROM cash_staff WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`,
    tx`SELECT id, name FROM order_types WHERE tenant_id = ${tenantId}`,
    stations.some(s => s.kind === 'printer')
      ? tx`SELECT id FROM pos_printers WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND is_active`
      : [],
    stations.some(s => s.kind === 'printer') ? printLayouts(tx, tenantId, venueId) : {},
  ])
  const live = new Set(printers.map(p => p.id))
  const view = s => {
    const v = stationView(s)
    if (v.kind === 'printer' && !live.has(v.settings.printer_id)) v.settings = { ...v.settings, printer_id: null }
    return v
  }
  return {
    enabled: true,
    stations: by(stations, view),
    ticket_layout: layouts.kitchen || null,
    flow,
    flow_id: active?.id || null,
    active_setting,
    courses: by(courses, c => ({ name: c.name, sort_order: c.sort_order })),
    tables: by(tables, t => ({ label: t.label })),
    staff: by(staff, s => ({ name: s.name })),
    order_types: by(types, t => ({ name: t.name })),
  }
}

/** pos_settings.kds_active_flow_id now (one row): has the flow been switched since a config was read? */
export async function activeFlowSetting(tx, tenantId, venueId) {
  return (await flowSetting(tx, tenantId, venueId)).kds_active_flow_id || null
}

/**
 * Put another of the venue's flows in use. Dishes sent from now follow it;
 * dishes already sent keep their way. Takes the venue's till lock, so it
 * falls between two sequenced events, never inside one. by = a kitchen
 * screen's name or a person. Returns { flow_id, name, switched_at,
 * switched_by, changed } (changed false: it was already in use).
 */
export async function switchFlow(tx, tenantId, venueId, flowId, by) {
  const { ensureSettings } = await import('./posSvc.js')
  await tx`SELECT pg_advisory_xact_lock(hashtext(${'pos:' + venueId}))`
  const [flow] = await tx`SELECT id, name FROM kds_flows WHERE id = ${flowId} AND tenant_id = ${tenantId} AND venue_id = ${venueId}`
  if (!flow) throw httpError(404, 'Kitchen flow not found')
  const settings = await ensureSettings(tx, tenantId, venueId)
  const flows = await loadFlows(tx, tenantId, venueId)
  if (activeFlowOf(flows, settings.kds_active_flow_id)?.id === flow.id) {
    // Already in use: write it down if it was only the default (the first).
    if (settings.kds_active_flow_id !== flow.id) {
      await tx`UPDATE pos_settings SET kds_active_flow_id = ${flow.id} WHERE venue_id = ${venueId} AND tenant_id = ${tenantId}`
    }
    return { flow_id: flow.id, name: flow.name, switched_at: settings.kds_flow_switched_at, switched_by: settings.kds_flow_switched_by, changed: false }
  }
  const [s] = await tx`
    UPDATE pos_settings
       SET kds_active_flow_id = ${flow.id}, kds_flow_switched_at = now(), kds_flow_switched_by = ${String(by || '').slice(0, 120) || null},
           updated_at = now()
     WHERE venue_id = ${venueId} AND tenant_id = ${tenantId}
     RETURNING kds_flow_switched_at, kds_flow_switched_by`
  return { flow_id: flow.id, name: flow.name, switched_at: s.kds_flow_switched_at, switched_by: s.kds_flow_switched_by, changed: true }
}

/** What a kitchen screen needs: its venue, the stations, its own settings. */
export async function kdsConfig(tx, tenantId, venueId) {
  const [venue] = await tx`SELECT id, name, timezone FROM venues WHERE id = ${venueId} AND tenant_id = ${tenantId}`
  const [settings] = await tx`
    SELECT day_starts_at, kds_online_orders, kds_online_ready, kds_active_flow_id, kds_flow_switched_at, kds_flow_switched_by
      FROM pos_settings
     WHERE venue_id = ${venueId} AND tenant_id = ${tenantId}`
  const stations = await loadStations(tx, tenantId, venueId)
  const courses = await tx`SELECT id, name, short_name, colour, sort_order FROM pos_courses WHERE tenant_id = ${tenantId} AND is_active ORDER BY sort_order, name`
  // The tenant's order types (migration 170): the screen's filters and ticket badges.
  const orderTypes = await tx`SELECT id, name, colour, sort_order FROM order_types WHERE tenant_id = ${tenantId} AND is_active ORDER BY sort_order, name`
  // The venue's flows (migration 177) for the flow button: each with the
  // stations it sends dishes to, and the one in use.
  const flows = await loadFlows(tx, tenantId, venueId)
  const active = activeFlowOf(flows, settings?.kds_active_flow_id)
  const live = new Set(stations.map(s => s.id))
  const edges = flows.length ? await tx`
    SELECT flow_id, from_station_id AS "from", to_station_id AS "to" FROM kds_flow_edges
     WHERE tenant_id = ${tenantId} AND flow_id = ANY(${flows.map(f => f.id)}::uuid[])` : []
  const order = Object.fromEntries(stations.map((s, i) => [s.id, i]))
  const config = {
    kind: 'kds',
    venue: { id: venue?.id, name: venue?.name, timezone: venue?.timezone || 'Europe/London' },
    settings: {
      day_starts_at: settings?.day_starts_at || '04:00',
      kds_online_orders: settings?.kds_online_orders ?? true,
      kds_online_ready: settings?.kds_online_ready ?? true,
    },
    stations: stations.map(stationView),
    // The screen draws where dishes come from and go to; their ways are
    // worked out when they are sent (item.route), not on the screen.
    flow: await loadFlow(tx, tenantId, active?.id, stations),
    flows: flows.map(f => ({
      id: f.id, name: f.name,
      station_ids: [...new Set(edges.filter(e => e.flow_id === f.id && live.has(e.to) && (!e.from || live.has(e.from))).map(e => e.to))]
        .sort((a, b) => order[a] - order[b]),
    })),
    active_flow_id: active?.id || null,
    flow_switched_at: settings?.kds_flow_switched_at || null,
    flow_switched_by: settings?.kds_flow_switched_by || null,
    courses,
    order_types: orderTypes,
    // Printers plugged into kitchen screens (migration 191): a screen prints
    // the tickets queued for its own (pos pos/src/lib/devicePrint.js).
    printers: await tx`
      SELECT p.id, p.name, p.connection, p.device_id, p.columns, p.is_active FROM pos_printers p
        JOIN pos_devices d ON d.id = p.device_id AND d.tenant_id = p.tenant_id AND d.kind = 'kds'
       WHERE p.tenant_id = ${tenantId} AND p.venue_id = ${venueId} AND p.connection = 'device' AND p.is_active
       ORDER BY p.sort_order, p.name`,
  }
  config.version = createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 16)
  return config
}

// ── The kitchen test bench ───────────────────────────────────────
//
// Till setup > Kitchen screens > Test the kitchen opens a page on the till
// app (pos/src/kitchen/Bench.jsx) with every kitchen screen of a venue side
// by side. The bench runs its own pretend kitchen in the browser with the
// shared rules (shared/pos/kitchen.js): test orders never reach the real
// screens, the sequencer or the reports. The signed link is the key (no
// pairing), and only reads.

const BENCH_HOURS = 8

export function kitchenTestToken({ tenantId, venueId }) {
  return makeLink('kitchen_test', { t: tenantId, v: venueId }, BENCH_HOURS)
}

export async function readKitchenTestToken(token) {
  const p = await readLink('kitchen_test', token)
  return p ? { tenantId: p.t, venueId: p.v, expiresAt: p.expires_at } : null
}

/**
 * What the bench works from: the kitchen screen's config (stations, order
 * types, courses), every flow with its links, the venue's kitchen screens,
 * tables, revenue streams and the live menus' dishes (names and where they
 * sit, no prices).
 */
export async function kitchenTestData(tx, tenantId, venueId) {
  const { tillMenuData } = await import('./posSvc.js')
  const { loadStreams } = await import('./taxSvc.js')
  const base = await kdsConfig(tx, tenantId, venueId)
  if (!base.venue?.id) throw httpError(404, 'Venue not found')
  const stations = await loadStations(tx, tenantId, venueId)
  const flows = await loadFlows(tx, tenantId, venueId)
  const links = await Promise.all(flows.map(f => loadFlow(tx, tenantId, f.id, stations)))
  const [screens, tables, streams] = await Promise.all([
    tx`SELECT id, name, short_code, settings FROM pos_devices
        WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND kind = 'kds' AND revoked_at IS NULL
        ORDER BY created_at`,
    tx`SELECT id, label FROM tables WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND NOT is_unallocated ORDER BY sort_order, label`,
    loadStreams(tx, tenantId, venueId, { activeOnly: true }),
  ])
  const { menus, items, section_items } = await tillMenuData(tx, tenantId, venueId, streams, { allStreams: streams })
  const dish = it => ({
    id: it.id, name: it.name, kitchen_name: it.kitchen_name, section_id: it.section_id,
    course_id: it.course_id, kind: it.kind, combo: it.combo,
  })
  return {
    venue: base.venue,
    settings: base.settings,
    stations: base.stations,
    courses: base.courses,
    order_types: base.order_types,
    flows: flows.map((f, i) => ({ id: f.id, name: f.name, station_ids: base.flows[i]?.station_ids || [], links: links[i] })),
    active_flow_id: base.active_flow_id,
    screens: screens.map(s => ({ id: s.id, name: s.name, short_code: s.short_code, settings: s.settings || {} })),
    tables: tables.map(t => ({ id: t.id, label: t.label })),
    streams: streams.map(r => ({ id: r.id, name: r.name })),
    menus: menus.map(m => ({ id: m.id, name: m.name, sections: m.sections.map(s => ({ id: s.id, title: s.title, item_ids: s.item_ids })) })),
    items: Object.fromEntries(Object.values(items).map(it => [it.id, dish(it)])),
    section_items,
  }
}

/**
 * Kitchen orders for a screen. since = 0 (or a sequence the server doesn't
 * know): everything still in the kitchen plus the last STALE_HOURS (for
 * bringing tickets back and the speed figures); else what changed since.
 */
export async function kitchenSync(tx, tenantId, venueId, since) {
  const [st] = await tx`SELECT last_seq FROM pos_venue_state WHERE venue_id = ${venueId} AND tenant_id = ${tenantId}`
  const seq = Number(st?.last_seq || 0)
  const server_time = new Date().toISOString()
  if (!since || since > seq) {
    const rows = await tx`
      SELECT state FROM kds_orders
       WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}
         AND (status = 'active' OR updated_at > now() - make_interval(hours => ${STALE_HOURS}))
       ORDER BY created_at DESC LIMIT 800`
    return { reset: true, seq, orders: rows.map(r => r.state), server_time }
  }
  if (since === seq) return { seq, orders: [], server_time }
  const rows = await tx`
    SELECT state FROM kds_orders
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND last_seq > ${since}
     ORDER BY last_seq LIMIT 800`
  return { seq, orders: rows.map(r => r.state), server_time }
}

/** Tell the venue's tills and kitchen screens that kitchen orders changed. */
export function announceKitchen(venueId, seq, from = null) {
  broadcast('pos:' + venueId, { type: 'pos.seq', seq, from, kinds: ['kitchen'] })
  broadcast('screens:' + venueId, { type: 'kitchen.board' })
}

/** A kitchen event made by the server (no device, no staff). */
export async function submitServerEvent(tenantId, venueId, type, payload) {
  const { sequencer } = await import('./posSvc.js')
  const e = { id: ulid(), venue_id: venueId, device_id: null, staff_id: null, type, payload, client_at: new Date().toISOString() }
  const r = await sequencer(tenantId, venueId).submit(e)
  if (r.ok && !r.duplicate && !r.nothing) announceKitchen(venueId, r.seq)
  // Kitchen printer tickets: whoever prints for those printers collects them.
  if (r.ok && r.jobs?.length && !r.duplicate) broadcast('pos:' + venueId, { type: 'pos.print' })
  return r
}

/**
 * The minute sweep (jobs/queues.js): at each venue with a kitchen printer,
 * when a dish waiting for its time (an order for later) has come due for a
 * printer, send kitchen.print_due so the sequencer prints it. Returns how
 * many venues printed; never throws.
 */
export async function kitchenPrintsDue(log = console) {
  let n = 0
  try {
    const venues = await systemSql`
      SELECT DISTINCT s.tenant_id, s.venue_id FROM kds_stations s
        JOIN kds_orders o ON o.tenant_id = s.tenant_id AND o.venue_id = s.venue_id AND o.status IN ('active', 'ready')
       WHERE s.kind = 'printer' AND s.is_active AND s.settings->>'printer_id' IS NOT NULL
         AND o.created_at > now() - make_interval(hours => ${STALE_HOURS})`
    for (const v of venues) {
      try {
        const due = await withTenant(v.tenant_id, async tx => {
          const cfg = await loadKitchenConfig(tx, v.tenant_id, v.venue_id)
          if (!hasPrinters(cfg)) return false
          const rows = await tx`
            SELECT id, state FROM kds_orders
             WHERE tenant_id = ${v.tenant_id} AND venue_id = ${v.venue_id} AND status IN ('active', 'ready')
               AND created_at > now() - make_interval(hours => ${STALE_HOURS})`
          return printsDue(Object.fromEntries(rows.map(r => [r.id, r.state])), cfg, new Date().toISOString())
        })
        if (!due) continue
        const r = await submitServerEvent(v.tenant_id, v.venue_id, 'kitchen.print_due', {})
        if (r.ok && r.jobs?.length) n++
      } catch (e) {
        log.warn?.({ err: e, venue: v.venue_id }, 'kitchen print sweep failed for a venue')
      }
    }
  } catch (e) {
    log.warn?.({ err: e }, 'kitchen print sweep failed')
  }
  return n
}

const firstName = s => String(s || '').trim().split(/\s+/)[0]?.slice(0, 40) || null

/** The kitchen's copy of an online order (kitchen.order_in payload). */
async function onlineSnapshot(tx, order) {
  const items = await tx`
    SELECT id, menu_item_id, name, options, parts, qty, note FROM order_items
     WHERE order_id = ${order.id} AND tenant_id = ${order.tenant_id} ORDER BY sort_order`
  const ids = [...new Set(items.map(i => i.menu_item_id).filter(Boolean))]
  const sections = ids.length
    ? await tx`SELECT id, section_id FROM menu_items WHERE tenant_id = ${order.tenant_id} AND id = ANY(${ids}::uuid[])`
    : []
  const sectionOf = Object.fromEntries(sections.map(s => [s.id, s.section_id]))
  let fireAt = null
  if (!order.is_asap && order.promised_at) {
    const [s] = await tx`SELECT lead_time_mins FROM ordering_settings WHERE venue_id = ${order.venue_id} AND tenant_id = ${order.tenant_id}`
    const lead = Number(s?.lead_time_mins ?? 20)
    const t = new Date(order.promised_at).getTime() - lead * 60000
    if (t > Date.now()) fireAt = new Date(t).toISOString()
  }
  const [type] = order.order_type_id
    ? await tx`SELECT id, name FROM order_types WHERE id = ${order.order_type_id} AND tenant_id = ${order.tenant_id}`
    : []
  return {
    id: onlineOrderId(order.id), order_id: order.id,
    number: String(order.order_number ?? ''),
    guest: firstName(order.guest_name),
    type: type?.id || null,
    type_name: type ? String(type.name).slice(0, 40) : null,
    promised_at: order.promised_at ? new Date(order.promised_at).toISOString() : null,
    fire_at: fireAt,
    note: order.notes ? String(order.notes).slice(0, 500) : null,
    allergy: order.allergy_note ? String(order.allergy_note).slice(0, 500) : null,
    items: items.map(i => ({
      id: String(i.id), item_id: i.menu_item_id || null, section_id: sectionOf[i.menu_item_id] || null,
      revenue_stream_id: order.revenue_stream_id || null,
      name: String(i.name).slice(0, 200), qty: Number(i.qty) || 1,
      options: (Array.isArray(i.options) ? i.options : []).map(o => ({ label: String(o.label || '').slice(0, 120), mode: o.mode || null })),
      // A combo's picks (migration 171).
      parts: Array.isArray(i.parts) && i.parts.length ? i.parts.slice(0, 60).map(p => ({
        name: String(p.name || 'Item').slice(0, 200), kitchen_name: p.kitchen_name ? String(p.kitchen_name).slice(0, 60) : null,
        item_id: p.item_id || null, section_id: p.section_id || null,
        options: (Array.isArray(p.options) ? p.options : []).map(o => ({ label: String(o.label || '').slice(0, 120), mode: o.mode || null })),
      })) : null,
      note: i.note ? String(i.note).slice(0, 300) : null,
    })),
  }
}

const ONLINE_TO_KITCHEN = { ready: 'ready', completed: 'collected', cancelled: 'cancelled', rejected: 'cancelled' }

/**
 * After an online order changes (orderSvc afterPlaced / afterStatus). Never
 * throws: the kitchen copy is best effort, the order itself is already saved.
 */
export async function kitchenOnOnlineOrder(order) {
  try {
    if (!order?.tenant_id || !order?.venue_id) return
    const tenantId = order.tenant_id
    const venueId = order.venue_id
    const kid = onlineOrderId(order.id)
    const plan = await withTenant(tenantId, async tx => {
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM kds_stations WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND is_active AND kind = ANY(${KITCHEN_KINDS})`
      if (!n) return null
      const [s] = await tx`SELECT kds_online_orders FROM pos_settings WHERE venue_id = ${venueId} AND tenant_id = ${tenantId}`
      const [existing] = await tx`SELECT status FROM kds_orders WHERE id = ${kid} AND tenant_id = ${tenantId}`
      if (['accepted', 'preparing'].includes(order.status)) {
        if (existing || s?.kds_online_orders === false) return null
        return { type: 'kitchen.order_in', payload: { order: await onlineSnapshot(tx, order) } }
      }
      const to = ONLINE_TO_KITCHEN[order.status]
      if (!existing || !to || existing.status === to || ['collected', 'cancelled', 'merged'].includes(existing.status)) return null
      return { type: 'kitchen.order_status', payload: { order_id: kid, status: to } }
    })
    if (!plan) return
    if (plan.type === 'kitchen.order_in' && !plan.payload.order.items.length) return
    const r = await submitServerEvent(tenantId, venueId, plan.type, plan.payload)
    if (!r.ok && r.code !== 'duplicate') console.warn('[kitchen] online order', order.id, r.error)
  } catch (err) {
    console.warn('[kitchen] online order failed', order?.id, err.message)
  }
}

/**
 * Online and GloriaFood orders the kitchen just finished (or handed over) in
 * these sequencer results: [{ source: 'online' | 'gloriafood', order_id,
 * status: 'ready' | 'completed' }]. The caller moves the order on
 * (orderSvc.changeStatus, or the GloriaFood board status) when the venue
 * wants it (pos_settings.kds_online_ready).
 */
export function onlineMoves(results) {
  const out = []
  for (const r of results) {
    if (!r.ok || r.duplicate) continue
    for (const o of Object.values(r.kitchen || {})) {
      if (!['online', 'gloriafood'].includes(o.source) || !o.order_id) continue
      if (o.status === 'ready' && o.ready_event === r.event?.id) out.push({ source: o.source, order_id: o.order_id, status: 'ready' })
      if (o.status === 'collected' && o.collected_event === r.event?.id) out.push({ source: o.source, order_id: o.order_id, status: 'completed' })
    }
  }
  return out
}

// ── GloriaFood orders (migration 178) ────────────────────────────

// The names an order type is matched by for each GloriaFood order type when
// Till setup hasn't picked one (pos_settings.kds_gloriafood_types).
const GF_TYPE_NAMES = {
  pickup:            ['collection', 'take out', 'takeaway'],
  delivery:          ['delivery'],
  dine_in:           ['eat in', 'dine in'],
  order_ahead:       ['collection', 'take out', 'takeaway'],
  table_reservation: ['eat in', 'dine in'],
}
export const GF_TYPES = Object.keys(GF_TYPE_LABELS)
// An order whose time is further behind us than this isn't sent: a push or
// poll that comes very late, or an old order sent again because it changed.
const GF_LATE_HOURS = 2
const GF_TO_KITCHEN = { ready: 'ready', completed: 'collected' }

/**
 * Which of the tenant's order types each GloriaFood order type goes to:
 * { [gloriafood type]: order type id | null }. A type Till setup picked (or
 * set to none) stays; one it left out is matched by name.
 */
export async function gloriaFoodTypes(tx, tenantId, saved = {}) {
  const types = await tx`SELECT id, name, is_active FROM order_types WHERE tenant_id = ${tenantId} ORDER BY sort_order, name`
  const out = {}
  for (const k of GF_TYPES) {
    if (saved && Object.hasOwn(saved, k)) {
      out[k] = types.some(t => t.id === saved[k]) ? saved[k] : null
      continue
    }
    const active = types.filter(t => t.is_active)
    const hit = (GF_TYPE_NAMES[k] || []).map(n => active.find(t => t.name.trim().toLowerCase() === n)).find(Boolean)
    out[k] = hit?.id || null
  }
  return { map: out, names: Object.fromEntries(types.map(t => [t.id, t.name])) }
}

const dishKey = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * GloriaFood dishes carry only a name: find the venue's menu dish with the
 * same name (live menus, case and spaces ignored), so dish and section links
 * in the kitchen flow apply to it, and it shows under the menu's own name
 * (kitchen name if set), as till orders do. name -> { item_id, section_id, name } | null
 */
async function dishMatcher(tx, tenantId, venueId) {
  const { loadMenuVersions } = await import('./menuReleases.js')
  const menus = await loadMenuVersions(tx, tenantId, { venueId })
  const map = new Map()
  for (const m of menus) {
    for (const s of m.sections || []) {
      for (const i of s.items || []) {
        const k = dishKey(i.name)
        if (k && !map.has(k)) map.set(k, { item_id: i.id, section_id: s.id, name: i.kitchen_name || i.name })
      }
    }
  }
  return name => map.get(dishKey(name)) || null
}

/** The kitchen's copy of a stored GloriaFood order (kitchen.order_in payload). */
function gloriaFoodSnapshot(r, { map, names, match, leadMins }) {
  const typeId = r.order_type ? map[r.order_type] || null : null
  let fireAt = null
  if (r.for_later && r.fulfill_at) {
    const t = new Date(r.fulfill_at).getTime() - Number(leadMins ?? 20) * 60000
    if (t > Date.now()) fireAt = new Date(t).toISOString()
  }
  const test = r.source === 'admin'
  const note = [test ? 'GloriaFood test order' : null, r.instructions].filter(Boolean).join(': ')
  return {
    id: gloriaFoodOrderId(r.id), order_id: r.id,
    number: String(r.gf_order_id).slice(0, 20),
    guest: firstName(r.client_name),
    table: r.table_number ? String(r.table_number).slice(0, 20) : null,
    type: typeId,
    type_name: (typeId ? names[typeId] : r.order_type ? gfTypeLabel(r.order_type) : null)?.slice(0, 40) || null,
    promised_at: r.fulfill_at ? new Date(r.fulfill_at).toISOString() : null,
    fire_at: fireAt,
    note: note ? note.slice(0, 500) : null,
    allergy: null,
    items: (r.items || []).slice(0, 200).map((d, i) => {
      const hit = match(d.name)
      return {
        id: String(i), item_id: hit?.item_id || null, section_id: hit?.section_id || null, revenue_stream_id: null,
        name: String(hit?.name || d.name || 'Item').slice(0, 200),
        qty: Math.min(999, Math.max(1, Math.round(Number(d.qty) || 1))),
        options: (d.options || []).slice(0, 40)
          .map(o => ({ label: ((Number(o.qty) > 1 ? o.qty + ' x ' : '') + (o.name || '')).slice(0, 120), mode: null }))
          .filter(o => o.label),
        note: d.note ? String(d.note).slice(0, 300) : null,
      }
    }),
  }
}

/**
 * After GloriaFood orders are stored (push, poll) or moved on the Online
 * orders board (ids = gloriafood_orders ids). An accepted order goes into the
 * kitchen when the venue sends GloriaFood orders there
 * (pos_settings.kds_gloriafood); for one already in the kitchen, a
 * cancellation in GloriaFood or Ready / Collected on the board is copied
 * there. One venue at a time (advisory lock), so an order and its
 * cancellation arriving together land in that order. Imported orders never
 * go. Returns [{ id, type }] of the events sent; never throws.
 */
export async function kitchenOnGloriaFood(tenantId, venueId, ids) {
  const sent = []
  if (!tenantId || !venueId || !ids?.length) return sent
  try {
    await withTenant(tenantId, async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtext('gf-kitchen:' || ${venueId}::text))`
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM kds_stations WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND is_active AND kind = ANY(${KITCHEN_KINDS})`
      if (!n) return
      const [s] = await tx`
        SELECT kds_gloriafood, kds_gloriafood_types, kds_gloriafood_lead_mins FROM pos_settings
         WHERE venue_id = ${venueId} AND tenant_id = ${tenantId}`
      const rows = await tx`
        SELECT * FROM gloriafood_orders
         WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND id = ANY(${ids}::uuid[])
           AND received_via <> 'import'
         ORDER BY accepted_at NULLS LAST, gf_order_id`
      if (!rows.length) return
      const kids = rows.map(r => gloriaFoodOrderId(r.id))
      const have = by(await tx`
        SELECT id, status FROM kds_orders
         WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND id = ANY(${kids}::text[])`)
      let ctx = null
      for (const r of rows) {
        const kid = gloriaFoodOrderId(r.id)
        const k = have[kid]
        let plan = null
        if (k) {
          if (['collected', 'cancelled', 'merged'].includes(k.status)) continue
          const to = ['canceled', 'cancelled'].includes(r.status) ? 'cancelled' : GF_TO_KITCHEN[r.board_status]
          if (!to || to === k.status) continue
          plan = { type: 'kitchen.order_status', payload: { order_id: kid, status: to } }
        } else {
          if (!s?.kds_gloriafood || r.status !== 'accepted' || ['ready', 'completed'].includes(r.board_status)) continue
          const when = r.fulfill_at || r.accepted_at
          if (when && new Date(when).getTime() < Date.now() - GF_LATE_HOURS * 3600_000) continue
          ctx ||= {
            ...(await gloriaFoodTypes(tx, tenantId, s.kds_gloriafood_types)),
            match: await dishMatcher(tx, tenantId, venueId),
            leadMins: s.kds_gloriafood_lead_mins,
          }
          const order = gloriaFoodSnapshot(r, ctx)
          if (!order.items.length) continue
          plan = { type: 'kitchen.order_in', payload: { order } }
        }
        const res = await submitServerEvent(tenantId, venueId, plan.type, plan.payload)
        if (res.ok) sent.push({ id: r.id, type: plan.type })
        else if (res.code !== 'duplicate') console.warn('[kitchen] GloriaFood order', r.id, res.error)
      }
    })
  } catch (err) {
    console.warn('[kitchen] GloriaFood orders failed', venueId, err.message)
  }
  return sent
}

/**
 * Order ready board numbers for a venue (menu screens' Order status block):
 *   { preparing, ready }   every counter and online order
 *   boards: { [board station name, lower case]: { preparing, ready } }
 *                          per order ready board in the kitchen flow (the
 *                          block picks one by name, so one board design can
 *                          serve "ORB 1" at every venue)
 */
export async function boardFor(tenantId, venueId, { clearMins = 10 } = {}) {
  const { rows, cfg } = await withTenant(tenantId, async tx => {
    const stations = await loadStations(tx, tenantId, venueId)
    const rows = await tx`
      SELECT state FROM kds_orders
       WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}
         AND status IN ('active', 'ready') AND updated_at > now() - make_interval(hours => ${STALE_HOURS})
       ORDER BY created_at DESC LIMIT 300`
    return { rows, cfg: { stations: by(stations, stationView) } }
  })
  const orders = Object.fromEntries(rows.map(r => [r.state.id, r.state]))
  const now = new Date().toISOString()
  const out = boardNumbers(orders, now, { clearMins, max: 40 })
  out.boards = {}
  for (const s of Object.values(cfg.stations)) {
    if (s.kind !== 'board') continue
    out.boards[s.name.trim().toLowerCase()] = boardNumbers(orders, now, { clearMins, max: 40, boardId: s.id, cfg })
  }
  return out
}

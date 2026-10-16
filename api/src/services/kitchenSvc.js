// src/services/kitchenSvc.js
//
// Kitchen screens (KDS), cloud side. docs/POS.md section 9; the rules are in
// shared/pos/kitchen.js and run inside the sequencer (services/posSvc.js).
//
//   loadKitchenConfig()     what the sequencer's kitchen rules need (stations,
//                           the flow, courses, tables, staff, revenue centres)
//   kdsConfig()             what a kitchen screen downloads (/pos-api/config)
//   kitchenSync()           kitchen orders since a sequence number
//   submitServerEvent()     a kitchen event made by the server (online orders)
//   kitchenOnOnlineOrder()  called by orderSvc after an online order changes:
//                           accepted -> into the kitchen, ready / completed /
//                           cancelled -> the kitchen follows
//   announceKitchen()       tell the venue's screens to sync
//   boardFor()              order ready board numbers for a venue (all
//                           counter / online orders, and per board station)
//
// Every query filters tenant_id itself.

import { withTenant } from '../config/db.js'
import { broadcast } from '../config/ws.js'
import { ulid } from '../../../shared/pos/ids.js'
import { onlineOrderId, stationSettings, boardNumbers, STALE_HOURS, BUMP_KINDS } from '../../../shared/pos/kitchen.js'
import { createHash } from 'node:crypto'

const by = (rows, f = r => r) => Object.fromEntries(rows.map(r => [r.id, f(r)]))

export async function loadStations(tx, tenantId, venueId, { activeOnly = true } = {}) {
  return tx`
    SELECT id, name, kind, colour, settings, sort_order, is_active FROM kds_stations
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} ${activeOnly ? tx`AND is_active` : tx``}
     ORDER BY sort_order, name`
}

/** The flow between the active stations: [{ id, from, to, targets }]. */
export async function loadFlow(tx, tenantId, venueId, stations) {
  const live = new Set(stations.map(s => s.id))
  const rows = await tx`
    SELECT id, from_station_id AS "from", to_station_id AS "to", targets
      FROM kds_flow_edges WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}
     ORDER BY sort_order, created_at`
  return rows.filter(l => live.has(l.to) && (!l.from || live.has(l.from)))
}

const stationView = s => ({ id: s.id, name: s.name, kind: s.kind, colour: s.colour, settings: stationSettings(s) })

/**
 * The sequencer's kitchen config. enabled = the venue has an active station
 * with something to bump (prep, expo or runner). A station switched off is
 * left out, so dishes pass straight through it.
 */
export async function loadKitchenConfig(tx, tenantId, venueId) {
  const stations = await loadStations(tx, tenantId, venueId)
  if (!stations.some(s => BUMP_KINDS.includes(s.kind))) return { enabled: false, stations: {}, flow: [] }
  const [flow, courses, tables, staff, types] = await Promise.all([
    loadFlow(tx, tenantId, venueId, stations),
    tx`SELECT id, name, sort_order FROM pos_courses WHERE tenant_id = ${tenantId}`,
    tx`SELECT id, label FROM tables WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`,
    tx`SELECT id, name FROM cash_staff WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`,
    tx`SELECT id, name FROM order_types WHERE tenant_id = ${tenantId}`,
  ])
  return {
    enabled: true,
    stations: by(stations, stationView),
    flow,
    courses: by(courses, c => ({ name: c.name, sort_order: c.sort_order })),
    tables: by(tables, t => ({ label: t.label })),
    staff: by(staff, s => ({ name: s.name })),
    order_types: by(types, t => ({ name: t.name })),
  }
}

/** What a kitchen screen needs: its venue, the stations, its own settings. */
export async function kdsConfig(tx, tenantId, venueId) {
  const [venue] = await tx`SELECT id, name, timezone FROM venues WHERE id = ${venueId} AND tenant_id = ${tenantId}`
  const [settings] = await tx`
    SELECT day_starts_at, kds_online_orders, kds_online_ready FROM pos_settings
     WHERE venue_id = ${venueId} AND tenant_id = ${tenantId}`
  const stations = await loadStations(tx, tenantId, venueId)
  const courses = await tx`SELECT id, name, short_name, colour, sort_order FROM pos_courses WHERE tenant_id = ${tenantId} AND is_active ORDER BY sort_order, name`
  // The tenant's order types (migration 170): the screen's filters and ticket badges.
  const orderTypes = await tx`SELECT id, name, colour, sort_order FROM order_types WHERE tenant_id = ${tenantId} AND is_active ORDER BY sort_order, name`
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
    flow: await loadFlow(tx, tenantId, venueId, stations),
    courses,
    order_types: orderTypes,
  }
  config.version = createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 16)
  return config
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
  if (r.ok && !r.duplicate) announceKitchen(venueId, r.seq)
  return r
}

const firstName = s => String(s || '').trim().split(/\s+/)[0]?.slice(0, 40) || null

/** The kitchen's copy of an online order (kitchen.order_in payload). */
async function onlineSnapshot(tx, order) {
  const items = await tx`
    SELECT id, menu_item_id, name, options, qty, note FROM order_items
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
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM kds_stations WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND is_active AND kind <> 'board'`
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
 * Online orders the kitchen just finished (or handed over) in these
 * sequencer results: [{ order_id, status: 'ready' | 'completed' }]. The
 * caller moves the online order on (orderSvc.changeStatus) when the venue
 * wants it (pos_settings.kds_online_ready).
 */
export function onlineMoves(results) {
  const out = []
  for (const r of results) {
    if (!r.ok || r.duplicate) continue
    for (const o of Object.values(r.kitchen || {})) {
      if (o.source !== 'online' || !o.order_id) continue
      if (o.status === 'ready' && o.ready_event === r.event?.id) out.push({ order_id: o.order_id, status: 'ready' })
      if (o.status === 'collected' && o.collected_event === r.event?.id) out.push({ order_id: o.order_id, status: 'completed' })
    }
  }
  return out
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

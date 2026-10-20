// src/routes/posSetup.js
//
// Till (POS) setup and reports for the admin portal, /api/pos. docs/POS.md.
//
//   GET    /venues/:venueId/setup                 everything the setup page shows
//   PATCH  /venues/:venueId/settings              till settings (receipt, VAT number, tenders, Cash Recon map, ...)
//   POST   /venues/:venueId/revenue-streams       + PATCH/DELETE /revenue-streams/:id, PUT /venues/:venueId/revenue-streams/order
//                                                 (a stream's order types: on/off, ask for a name / tent number;
//                                                 the order types themselves are tenant-wide, routes/taxSetup.js)
//   POST   /venues/:venueId/printers              + PATCH/DELETE /printers/:id (migration 191: connection 'hub'
//                                                 = a network printer the venue hub prints to, 'device' = plugged
//                                                 into a till or kitchen screen, printed by its browser). Kitchen
//                                                 tickets go where the kitchen flow's printer boxes are
//   POST   /venues/:venueId/link                  { code, device_id? | name, kind?, settings? } link a device
//                                                 showing a code (migration 184): a new till, kitchen screen,
//                                                 kiosk or venue hub (hub/), or a new device for one already
//                                                 here. The only way a device is added: Till setup and the
//                                                 installer app
//   PATCH  /devices/:id                           name, settings (mode, revenue stream, receipt printer, floor area;
//                                                 a kiosk's design and card reader)
//   DELETE /devices/:id                           revoke
//   Self-order kiosks (docs/POS.md section 10; shared/kiosk.js; the kiosks themselves are devices of kind 'kiosk'):
//   GET    /kiosk-designs  POST /kiosk-designs  PUT/DELETE /kiosk-designs/:id   tenant-wide designs
//   POST   /kiosk-designs/:id/preview             { venue_id, revenue_stream_id, menu? 'live' | 'draft' } -> a signed
//                                                  preview link + menus_changed (menus with changes not published)
//   PUT    /kiosk-designs/:id/share               { venue_id, revenue_stream_id?, menu?, expires_on? } a lasting link
//                                                  for people outside the group (migrations 187, 188)
//   POST   /kiosk-designs/:id/share/new-link      a new link; the old one stops working
//   DELETE /kiosk-designs/:id/share               stop sharing
//   POST   /venues/:venueId/floor-areas           + PATCH/DELETE /floor-areas/:id
//   PUT    /floor-areas/:id/layout                tables' positions + decor in one save
//   PUT    /venues/:venueId/staff/:staffId/pos    PIN (or null to remove) and POS role
//   GET    /roles  POST /roles  PATCH/DELETE /roles/:id       POS roles (tenant-wide)
//   GET    /courses  POST /courses  PATCH/DELETE /courses/:id  PUT /courses/order
//   Reports (pos_reports):
//   GET    /venues/:venueId/days                  trading days (Z reports), newest first
//   GET    /venues/:venueId/days/:dayId           figures (live for the open day)
//   POST   /venues/:venueId/days/:dayId/fill-recon  write the day into Cash Recon
//   GET    /venues/:venueId/checks?day_id=&status=
//   GET    /checks/:id                            the check with its events
//   GET    /venues/:venueId/conflicts             refused till events
//   PATCH  /conflicts/:id                         mark resolved with a note
//   GET    /venues/:venueId/print-jobs            the print queue
//   POST   /print-jobs/:id/again                  print a failed job again
//   Kitchen screens (docs/POS.md section 9; shared/pos/kitchen.js):
//   POST   /venues/:venueId/kds-stations          + PATCH/DELETE /kds-stations/:id, PUT /venues/:venueId/kds-stations/order
//   POST   /venues/:venueId/kds-flows             a kitchen flow (empty, or a copy of another; migration 177)
//   PATCH  /kds-flows/:id                         rename;  DELETE /kds-flows/:id (not the one in use)
//   PUT    /kds-flows/:id                         a flow's links + where the designer draws each box
//                                                 + the stations it leaves out (off_station_ids, migration 182)
//   PUT    /venues/:venueId/kds-flows/order       the flows' order (the kitchen screen's flow list)
//   PUT    /venues/:venueId/kds-flows/active      put a flow in use (also from a kitchen screen: PUT /pos-api/kitchen/flow)
//   POST   /venues/:venueId/kitchen-test          a signed link to the kitchen test bench (every screen on one page)
//   GET    /venues/:venueId/kitchen-report?from=&to=   speed of service per station, by hour, remakes
//   GET    /venues/:venueId/kitchen-report.csv?from=&to=  every bump and remake, for spreadsheets / BI
//   (kitchen screens themselves are devices of kind 'kds', added by POST /venues/:venueId/link)
//
// Setup needs pos_setup (view to read, manage to change); reports need
// pos_reports. Every query filters tenant_id itself.

import { z } from 'zod'
import { randomBytes, randomUUID } from 'node:crypto'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission, permissionLevel } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { broadcast } from '../config/ws.js'
import {
  ensureSettings, settingsView, ownVenue,
  dayReport, fillReconFromDay, DEFAULT_COURSES,
} from '../services/posSvc.js'
import { reconFields } from '../services/reconFill.js'
import {
  stationSettings, flowProblems, flowWarnings, boxProblems, resolveSharedFlow, shareFlow, flowName,
  STATION_KINDS, FLOW_TARGET_KINDS, BUMP_KINDS, NAMED_TARGET_KINDS, KIND_LABELS,
} from '../../../shared/pos/kitchen.js'
import { deviceOrigin, installerOrigin } from '../services/platformHost.js'
import { linkCodeHash } from '../services/linkCodes.js'
import { forgetDevice } from './posApi.js'
import {
  ensureFlows, loadFlows, activeFlowOf, switchFlow, flowPlace, pinActiveFlows, gloriaFoodTypes, GF_TYPES, kitchenTestToken,
} from '../services/kitchenSvc.js'
import { checkDesign, ownDesign, previewToken, menuChanges } from '../services/kioskSvc.js'
import { normaliseDesign } from '../../../shared/kiosk.js'
import { DEFAULT_POS_ROLES, PERMISSION_KEYS, normalisePermissions } from '../../../shared/pos/permissions.js'
import { hashPin, PIN_PATTERN, weakPin } from '../../../shared/pos/pin.js'
import { TENDER_KEYS } from '../../../shared/pos/checks.js'
import { ensureTaxDefaults, loadOrderTypes, loadStreams } from '../services/taxSvc.js'

const UUID = z.string().uuid()
const TIME = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)
const COLOUR = z.string().max(20).nullable().optional()
const by = req => req.user?.email ?? null

const canSetupView = requirePermission('pos_setup', 'view')
const canSetup = requirePermission('pos_setup', 'manage')
const canReports = requirePermission('pos_reports', 'view')
const canReportsManage = requirePermission('pos_reports', 'manage')

/** Tell the venue's tills their config changed (they download it again). */
function configChanged(venueId) {
  broadcast('pos:' + venueId, { type: 'pos.config' })
}

/** A kiosk design changed: every venue with a kiosk downloads its config again. */
async function kiosksChanged(tx, tenantId) {
  const rows = await tx`SELECT DISTINCT venue_id FROM pos_devices WHERE tenant_id = ${tenantId} AND kind = 'kiosk' AND revoked_at IS NULL`
  for (const r of rows) configChanged(r.venue_id)
}

const SettingsBody = z.object({
  day_starts_at:             TIME.optional(),
  vat_number:                z.string().max(40).nullable().optional(),
  receipt_name:              z.string().max(80).nullable().optional(),
  receipt_address:           z.array(z.string().max(80)).max(6).optional(),
  service_charge_label:      z.string().max(60).nullable().optional(),
  tenders:                   z.array(z.object({ key: z.enum(TENDER_KEYS), label: z.string().min(1).max(30), enabled: z.boolean() })).optional(),
  tips_enabled:              z.boolean().optional(),
  require_covers:            z.boolean().optional(),
  order_no_start:            z.number().int().min(1).max(900).optional(),
  auto_logout_secs:          z.number().int().min(0).max(3600).optional(),
  recon_map:                 z.object({
    income:  z.record(UUID, z.array(z.string().max(40)).max(20)).default({}),
    takings: z.record(UUID, z.array(z.enum(TENDER_KEYS)).max(10)).default({}),
    sc:      z.record(UUID, z.array(z.enum(['service_charge', 'tips'])).max(2)).default({}),
  }).optional(),
  recon_auto_fill:           z.boolean().optional(),
  kds_online_orders:         z.boolean().optional(),
  kds_online_ready:          z.boolean().optional(),
  // GloriaFood orders on the kitchen screens (migration 178).
  kds_gloriafood:            z.boolean().optional(),
  kds_gloriafood_types:      z.record(z.enum(GF_TYPES), UUID.nullable()).optional(),
  kds_gloriafood_lead_mins:  z.number().int().min(0).max(240).optional(),
})

// Ask for a customer name / tent number when the order type is picked:
// off, ask (can be skipped) or required.
const PROMPTS = ['off', 'ask', 'required']
const StreamOrderType = z.object({
  order_type_id: UUID,
  enabled:       z.boolean(),
  ask_name:      z.enum(PROMPTS).default('off'),
  ask_tent:      z.enum(PROMPTS).default('off'),
})
const StreamBody = z.object({
  name:                      z.string().trim().min(1).max(60),
  menu_ids:                  z.array(UUID).max(20).default([]),
  service_charge_percent:    z.number().min(0).max(50).default(0),
  service_charge_min_covers: z.number().int().min(0).max(100).default(0),
  colour:                    COLOUR,
  is_active:                 z.boolean().default(true),
  default_order_type_id:     UUID.nullable().optional(),
  order_types:               z.array(StreamOrderType).max(50).optional(),
})

const PrinterBody = z.object({
  name:              z.string().trim().min(1).max(60),
  kind:              z.enum(['station', 'receipt']).default('station'),
  // 'hub': a network printer (host, port) the venue hub prints to; 'device':
  // plugged into a till or kitchen screen (device_id), printed by its browser.
  connection:        z.enum(['hub', 'device']).default('hub'),
  device_id:         UUID.nullable().optional(),
  host:              z.string().trim().max(120).nullable().optional(),
  port:              z.number().int().min(1).max(65535).default(9100),
  columns:           z.number().int().min(24).max(64).default(42),
  backup_printer_id: UUID.nullable().optional(),
  is_active:         z.boolean().default(true),
})

const DeviceSettings = z.object({
  mode:               z.enum(['table', 'counter']).default('table'),
  revenue_stream_id:  UUID.nullable().optional(),
  receipt_printer_id: UUID.nullable().optional(),
  floor_area_id:      UUID.nullable().optional(),
  // Kitchen screens (kind 'kds'): which stations it shows (it can switch
  // between them), the view it opens on, tickets across, text size, beep.
  station_ids:        z.array(UUID).max(12).optional(),
  view:               z.enum(['tickets', 'on_order']).optional(),
  columns:            z.number().int().min(3).max(10).optional(),
  text_size:          z.enum(['normal', 'large', 'xl']).optional(),
  sound:              z.boolean().optional(),
  // Its flow button may put another kitchen flow in use (absent = yes).
  can_switch_flow:    z.boolean().optional(),
  // What a ticket's title shows (shared/orderInfo.js): 'auto' = the table or
  // the name, else the order number, tent, table or customer name picked.
  ticket_main:        z.enum(['auto', 'number', 'tent', 'table', 'name']).optional(),
  // Self-order kiosks (kind 'kiosk', shared/kiosk.js): its design (null = the
  // tenant's first) and its card reader ('test' takes no money; real
  // terminals come as adapters later, docs/POS.md section 10).
  design_id:          UUID.nullable().optional(),
  card_reader:        z.enum(['none', 'test']).optional(),
}).default({})

// What a device showing a link code can become, in the words the refusals use.
const LINK_KINDS = ['terminal', 'kds', 'kiosk', 'hub']
const LINK_KIND_NAME = { terminal: 'a till', kds: 'a kitchen screen', kiosk: 'a self-order kiosk', hub: 'a venue hub' }

const KioskDesignBody = z.object({
  name:     z.string().trim().min(1).max(80),
  settings: z.record(z.any()).default({}),
})

const SummaryMember = z.object({
  kind:  z.enum(['dish', 'option']),
  id:    UUID.nullable().optional(),
  label: z.string().trim().min(1).max(120),
  qty:   z.number().int().min(1).max(100).default(1),
})

const StationSettings = z.object({
  target_mins:    z.number().int().min(1).max(120).default(8),
  late_mins:      z.number().int().min(1).max(240).default(12),
  show_held:      z.boolean().default(true),
  // Show orders before their dishes reach this station (default: the pass
  // only; stationSettings()). Expo / runner: their bump finishes them.
  show_upcoming:  z.boolean().optional(),
  summary_groups: z.array(z.object({
    id:      z.string().min(1).max(40),
    name:    z.string().trim().min(1).max(40),
    members: z.array(SummaryMember).max(60).default([]),
  })).max(12).default([]),
  // A Balance box's pieces (migration 183): what a dish counts when it
  // shares tickets between stations (a dish counts its quantity otherwise).
  pieces: z.array(SummaryMember).max(60).default([]),
  // A Balance box's big tickets: null keeps each ticket on one station; N
  // shares a ticket's dishes between them when more than N pieces reach it.
  split_above: z.number().int().min(0).max(999).nullable().default(null),
  // A kitchen printer box (migration 191): the printer its dishes print on.
  printer_id: UUID.nullable().optional(),
}).refine(s => s.late_mins >= s.target_mins, { message: 'Late must be the same as or after the target time', path: ['late_mins'] })

const StationBody = z.object({
  name:      z.string().trim().min(1).max(40),
  kind:      z.enum(STATION_KINDS).default('prep'),
  colour:    COLOUR,
  settings:  StationSettings.default({}),
  is_active: z.boolean().default(true),
})

// The kitchen flow: links from Orders in (from null) or a station to a
// station, each with an optional filter (shared/pos/kitchen.js itemRoute()),
// and where the designer draws each box ('start' = Orders in).
const FlowTarget = z.object({
  kind: z.enum(FLOW_TARGET_KINDS),
  id:   z.string().max(40).nullable().optional(),
  // A shared flow's revenue streams and tills / kiosks, by name (migration 192).
  name: z.string().trim().max(60).nullable().optional(),
})
const FlowName = z.string().trim().min(1).max(40)
const NewFlowBody = z.object({
  name:      FlowName,
  // Start from a copy of this flow's links and layout: one of the venue's own
  // or a shared one (either way round).
  copy_from: UUID.nullable().optional(),
  // Shared by every location (migration 192), else the venue's own.
  shared:    z.boolean().default(false),
})
const FlowLayout = z.record(z.string().max(40), z.object({
  x: z.number().min(-2000).max(20000),
  y: z.number().min(-2000).max(20000),
})).default({})
// A shared flow: named boxes (each location's station of that name) and links between them.
const SharedFlowBody = z.object({
  boxes: z.array(z.object({
    id:   UUID,
    name: z.string().trim().min(1).max(40),
    kind: z.enum(STATION_KINDS),
  })).max(80),
  links: z.array(z.object({
    from:    UUID.nullable(),
    to:      UUID,
    targets: z.array(FlowTarget).max(300).default([]),
  })).max(400),
  layout: FlowLayout,
})
const KdsFlowBody = z.object({
  // The venue's stations this flow leaves out (migration 182).
  off_station_ids: z.array(UUID).max(300).default([]),
  links: z.array(z.object({
    from:    UUID.nullable(),
    to:      UUID,
    targets: z.array(FlowTarget).max(300).default([]),
  })).max(400),
  layout: FlowLayout,
})

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const AreaBody = z.object({
  name:              z.string().trim().min(1).max(60),
  width:             z.number().int().min(6).max(80).default(24),
  height:            z.number().int().min(4).max(60).default(16),
  revenue_stream_id: UUID.nullable().optional(),
  sort_order:        z.number().int().optional(),
})

const Decor = z.object({
  id:   z.string().max(40),
  kind: z.enum(['label', 'wall', 'bar', 'plant']),
  x: z.number().min(0).max(80), y: z.number().min(0).max(60),
  w: z.number().min(0.2).max(80), h: z.number().min(0.2).max(60),
  text: z.string().max(40).nullable().optional(),
})

const LayoutBody = z.object({
  tables: z.array(z.object({
    id: UUID,
    x: z.number().min(0).max(80), y: z.number().min(0).max(60),
    w: z.number().min(0.5).max(20), h: z.number().min(0.5).max(20),
    shape: z.enum(['rect', 'round']).default('rect'),
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
  })).max(300),
  decor: z.array(Decor).max(200).default([]),
})

const StaffPosBody = z.object({
  pin:         z.string().regex(PIN_PATTERN, 'A PIN is 4 to 6 digits').nullable().optional(),
  pos_role_id: UUID.nullable().optional(),
})

const RoleBody = z.object({
  name:        z.string().trim().min(1).max(60),
  permissions: z.record(z.string(), z.union([z.boolean(), z.number()])).default({}),
})

const CourseBody = z.object({
  name:            z.string().trim().min(1).max(40),
  short_name:      z.string().trim().max(6).nullable().optional(),
  hold_by_default: z.boolean().default(false),
  colour:          COLOUR,
  is_active:       z.boolean().default(true),
})

const OrderBody = z.object({ ids: z.array(UUID).max(200) })

async function ownRow(tx, table, tenantId, id, what) {
  const [row] = await tx`SELECT * FROM ${tx(table)} WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!row) throw httpError(404, what + ' not found')
  return row
}

/** A flow's links, in the shape shared/pos/kitchen.js uses. */
export async function loadFlowLinks(tx, tenantId, flowId) {
  return tx`
    SELECT id, from_station_id AS "from", to_station_id AS "to", targets
      FROM kds_flow_edges WHERE tenant_id = ${tenantId} AND flow_id = ${flowId}
     ORDER BY sort_order, created_at`
}

/** A flow as the setup page shows it: a venue's own with its links, a shared one with its boxes. */
function flowView(f, links = []) {
  return f.shared || f.venue_id === null
    ? { id: f.id, name: f.name, sort_order: f.sort_order, layout: f.layout || {}, shared: true, off_station_ids: [], boxes: f.boxes || [], links: f.box_links || [] }
    : { id: f.id, name: f.name, sort_order: f.sort_order, layout: f.layout || {}, shared: false, off_station_ids: f.off_station_ids || [], links }
}

/**
 * Every location's stations (a shared flow's boxes are matched by name), and
 * the revenue stream and till / kiosk names in use anywhere (a shared flow's
 * filters name them).
 */
async function sharedPlaces(tx, tenantId) {
  const [venues, stations, streams, devices, flows, settings] = await Promise.all([
    tx`SELECT id, name FROM venues WHERE tenant_id = ${tenantId} ORDER BY name`,
    tx`SELECT id, venue_id, name, kind, is_active FROM kds_stations WHERE tenant_id = ${tenantId} ORDER BY sort_order, name`,
    tx`SELECT name FROM pos_revenue_streams WHERE tenant_id = ${tenantId} AND is_active ORDER BY sort_order, name`,
    tx`SELECT name FROM pos_devices WHERE tenant_id = ${tenantId} AND kind IN ('terminal', 'kiosk') AND revoked_at IS NULL ORDER BY created_at`,
    tx`SELECT id, venue_id FROM kds_flows WHERE tenant_id = ${tenantId} ORDER BY (venue_id IS NULL), sort_order, created_at`,
    tx`SELECT venue_id, kds_active_flow_id FROM pos_settings WHERE tenant_id = ${tenantId}`,
  ])
  // Each location's flow in use (the one its settings name, else its first), as loadFlows() + activeFlowOf().
  const setting = Object.fromEntries(settings.map(s => [s.venue_id, s.kds_active_flow_id]))
  const activeAt = venueId => activeFlowOf(flows.filter(f => f.venue_id === venueId || f.venue_id === null), setting[venueId])?.id || null
  const distinct = rows => {
    const seen = new Set()
    const out = []
    for (const r of rows) {
      const name = String(r.name || '').trim().replace(/\s+/g, ' ')
      if (name && !seen.has(flowName(name))) { seen.add(flowName(name)); out.push(name) }
    }
    return out
  }
  return {
    kds_locations: venues.map(v => ({
      id: v.id, name: v.name, active_flow_id: activeAt(v.id),
      stations: stations.filter(st => st.venue_id === v.id).map(st => ({ id: st.id, name: st.name, kind: st.kind, is_active: st.is_active })),
    })),
    kds_shared_names: { revenue_stream: distinct(streams), device: distinct(devices) },
  }
}

/** The venue's flows (its own, then shared ones) with their links, the one in use and the last switch (the setup page). */
async function flowsView(tx, tenantId, venueId, settings) {
  const flows = await ensureFlows(tx, tenantId, venueId)
  const own = flows.filter(f => !f.shared)
  const links = own.length ? await tx`
    SELECT id, flow_id, from_station_id AS "from", to_station_id AS "to", targets
      FROM kds_flow_edges WHERE tenant_id = ${tenantId} AND flow_id = ANY(${own.map(f => f.id)}::uuid[])
     ORDER BY sort_order, created_at` : []
  return {
    kds_flows: flows.map(f => flowView(f, links.filter(l => l.flow_id === f.id).map(({ flow_id, ...l }) => l))),
    kds_active_flow_id: activeFlowOf(flows, settings.kds_active_flow_id)?.id || null,
    kds_flow_switched_at: settings.kds_flow_switched_at || null,
    kds_flow_switched_by: settings.kds_flow_switched_by || null,
    ...await sharedPlaces(tx, tenantId),
  }
}

/** A flow of the tenant's (a venue's own, or shared: venue_id null), or 404. */
async function ownFlow(tx, tenantId, id) {
  const [f] = await tx`
    SELECT id, venue_id, name, layout, sort_order, off_station_ids, boxes, box_links, venue_id IS NULL AS shared
      FROM kds_flows WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!f) throw httpError(404, 'Kitchen flow not found')
  return f
}

/**
 * Is the name taken? A venue's own flow can't share a name with its other
 * flows or a shared one (kitchen screens list them together); a shared flow
 * (venueId null) with any flow anywhere.
 */
async function flowNameTaken(tx, tenantId, venueId, name, exceptId = null) {
  const [hit] = await tx`
    SELECT 1 FROM kds_flows
     WHERE tenant_id = ${tenantId} AND lower(btrim(name)) = lower(btrim(${name}))
       ${venueId ? tx`AND (venue_id = ${venueId} OR venue_id IS NULL)` : tx``}
       ${exceptId ? tx`AND id <> ${exceptId}` : tx``}`
  return !!hit
}

/** Shared flows changed: every venue's tills and kitchen screens download their config again. */
async function everyVenueChanged(tx, tenantId) {
  const rows = await tx`SELECT id FROM venues WHERE tenant_id = ${tenantId}`
  return () => rows.forEach(r => configChanged(r.id))
}

/**
 * A link's filters, checked. Dishes and sections are collected for one
 * check (menuIds); order types are the company's. A venue's own flow names
 * revenue streams and tills / kiosks by id (the venue's); a shared flow by
 * name (each location's own).
 */
function cleanTargets(list, { shared, streams, devices, orderTypes, menuIds }) {
  const isUuid = v => typeof v === 'string' && UUID.safeParse(v).success
  const seen = new Set()
  const out = []
  for (const t of list) {
    let target
    if (t.kind === 'default') target = { kind: 'default' }
    else if (shared && NAMED_TARGET_KINDS.includes(t.kind)) {
      const name = String(t.name || '').trim().replace(/\s+/g, ' ')
      if (!name) throw httpError(422, t.kind === 'device' ? 'A link filter needs a till or kiosk name' : 'A link filter needs a revenue stream name')
      target = { kind: t.kind, name }
    } else {
      target = { kind: t.kind, id: t.id || null }
      if (!target.id) throw httpError(422, 'A link filter needs a dish, section, till, revenue stream or order type')
      if (!isUuid(target.id)) throw httpError(422, 'A link filter wasn\'t found')
      if (t.kind === 'revenue_stream' && !streams.has(target.id)) throw httpError(422, 'Revenue stream not found')
      if (t.kind === 'device' && !devices.has(target.id)) throw httpError(422, 'Till or kiosk not found')
      if (t.kind === 'order_type' && !orderTypes.has(target.id)) throw httpError(422, 'Order type not found')
      if (t.kind === 'item' || t.kind === 'section') menuIds.add(target.id)
    }
    const key = target.kind + ':' + (target.id || flowName(target.name) || '')
    if (!seen.has(key)) { seen.add(key); out.push(target) }
  }
  return out
}

async function checkMenuTargets(tx, tenantId, menuIds) {
  const ids = [...menuIds]
  if (!ids.length) return
  const found = await tx`
    SELECT id FROM menu_items WHERE tenant_id = ${tenantId} AND id = ANY(${ids}::uuid[])
    UNION SELECT id FROM menu_sections WHERE tenant_id = ${tenantId} AND id = ANY(${ids}::uuid[])`
  if (found.length !== ids.length) throw httpError(422, 'A dish or section wasn\'t found')
}

/** Something a flow filter names is gone: take it out of every filter. A link
 *  left with no filter at all named only that, so it goes too (an empty
 *  filter would mean every dish). */
async function dropFlowTarget(tx, tenantId, kind, id) {
  const rows = await tx`
    SELECT id, targets FROM kds_flow_edges
     WHERE tenant_id = ${tenantId} AND targets @> ${tx.json([{ kind, id }])}`
  for (const r of rows) {
    const left = r.targets.filter(t => !(t.kind === kind && t.id === id))
    if (left.length) await tx`UPDATE kds_flow_edges SET targets = ${tx.json(left)} WHERE id = ${r.id} AND tenant_id = ${tenantId}`
    else await tx`DELETE FROM kds_flow_edges WHERE id = ${r.id} AND tenant_id = ${tenantId}`
  }
}

/** A kitchen printer box prints on one of the venue's printers (not one plugged into a kiosk). */
async function checkStationPrinter(tx, tenantId, venueId, settings) {
  if (!settings.printer_id) return
  const [p] = await tx`
    SELECT p.id, d.kind AS device_kind FROM pos_printers p
      LEFT JOIN pos_devices d ON d.id = p.device_id AND d.tenant_id = p.tenant_id
     WHERE p.id = ${settings.printer_id} AND p.tenant_id = ${tenantId} AND p.venue_id = ${venueId}`
  if (!p) throw httpError(422, 'Printer not found')
  if (p.device_kind === 'kiosk') throw httpError(422, 'A printer plugged into a kiosk prints that kiosk\'s receipts only')
}

/**
 * A printer plugged into a device: one of the venue's tills or kitchen
 * screens (they collect its tickets), or a kiosk (its own receipts only).
 */
async function checkPrinterDevice(tx, tenantId, venueId, body) {
  if (body.connection !== 'device') return null
  if (!body.device_id) throw httpError(422, 'Pick the till or kitchen screen the printer is plugged into')
  const [d] = await tx`
    SELECT id, kind FROM pos_devices
     WHERE id = ${body.device_id} AND tenant_id = ${tenantId} AND venue_id = ${venueId} AND revoked_at IS NULL`
  if (!d) throw httpError(422, 'Device not found')
  if (!['terminal', 'kds', 'kiosk'].includes(d.kind)) throw httpError(422, 'A printer can be plugged into a till, a kitchen screen or a kiosk')
  return d.id
}

/** A Balance box's pieces name the tenant's own dishes. */
async function checkPieces(tx, tenantId, settings) {
  const ids = [...new Set((settings.pieces || []).filter(m => m.kind === 'dish').map(m => m.id).filter(Boolean))]
  if (!ids.length) return
  const found = await tx`SELECT id FROM menu_items WHERE tenant_id = ${tenantId} AND id = ANY(${ids}::uuid[])`
  if (found.length !== ids.length) throw httpError(422, 'Dish not found')
  for (const m of settings.pieces) if (m.kind === 'dish' && !m.id) throw httpError(422, 'Pick the dish that counts')
}

/**
 * A station that is (now) a Balance box: off every kitchen screen, and its
 * links out of every flow go only to stations that bump, with no filters.
 */
async function tidyBalanceBox(tx, tenantId, venueId, stationId) {
  await tx`
    DELETE FROM kds_flow_edges e USING kds_stations t
     WHERE e.tenant_id = ${tenantId} AND e.from_station_id = ${stationId} AND t.id = e.to_station_id
       AND t.kind <> ALL(${BUMP_KINDS})`
  await tx`UPDATE kds_flow_edges SET targets = '[]'::jsonb WHERE tenant_id = ${tenantId} AND from_station_id = ${stationId} AND targets <> '[]'::jsonb`
  await dropDeviceStation(tx, tenantId, venueId, stationId)
}

/** Kitchen screens that showed a station: take it off their list. */
async function dropDeviceStation(tx, tenantId, venueId, stationId) {
  const devices = await tx`SELECT id, settings FROM pos_devices WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND kind = 'kds'`
  for (const d of devices) {
    const ids = (d.settings?.station_ids || []).filter(x => x !== stationId)
    if (ids.length !== (d.settings?.station_ids || []).length) {
      await tx`UPDATE pos_devices SET settings = ${tx.json({ ...d.settings, station_ids: ids })} WHERE id = ${d.id} AND tenant_id = ${tenantId}`
    }
  }
}

function deviceView(d) {
  return {
    id: d.id, name: d.name, kind: d.kind, short_code: d.short_code, settings: d.settings || {},
    paired: !!d.secret_hash, paired_at: d.paired_at, last_seen_at: d.last_seen_at,
    app_version: d.app_version, user_agent: d.user_agent, revoked_at: d.revoked_at,
    created_at: d.created_at,
  }
}

// A kiosk design's lasting preview link (migration 187; share_menu 188).
const SHARE_COLS = ['share_token', 'share_venue_id', 'share_stream_id', 'share_menu', 'share_expires_at', 'share_created_at', 'share_created_by', 'share_views', 'share_last_viewed_at']
const newShareToken = () => randomBytes(24).toString('base64url')
function shareView(d) {
  if (!d?.share_token) return null
  return {
    url: deviceOrigin('kiosk') + '/?kiosk_share=' + d.share_token,
    venue_id: d.share_venue_id,
    revenue_stream_id: d.share_stream_id,
    menu: d.share_menu === 'draft' ? 'draft' : 'live',
    expires_at: d.share_expires_at,
    expired: !!d.share_expires_at && new Date(d.share_expires_at) <= new Date(),
    created_at: d.share_created_at,
    created_by: d.share_created_by,
    views: d.share_views || 0,
    last_viewed_at: d.share_last_viewed_at,
  }
}

async function nextShortCode(tx, tenantId, venueId, kind) {
  const rows = await tx`SELECT short_code FROM pos_devices WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`
  const used = new Set(rows.map(r => r.short_code))
  const prefix = kind === 'hub' ? 'H' : kind === 'kds' ? 'K' : kind === 'kiosk' ? 'KS' : 'T'
  for (let n = 1; n < 1000; n++) if (!used.has(prefix + n)) return prefix + n
  return prefix + rows.length + 1
}

export default async function posSetupRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // ── Setup snapshot ──────────────────────────────────────────────
  app.get('/venues/:venueId/setup', { preHandler: canSetupView }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    const tenantId = req.tenantId
    return withTenant(tenantId, async tx => {
      const venue = await ownVenue(tx, tenantId, venueId)
      const settings = await ensureSettings(tx, tenantId, venueId)
      await ensureTaxDefaults(tx, tenantId)
      const [streams, orderTypes, printers, devices, areas, tables, staff, roles, courses, menus, kdsStations, kdsFlows, kioskDesigns, jobCounts] = await Promise.all([
        loadStreams(tx, tenantId, venueId),
        loadOrderTypes(tx, tenantId),
        tx`SELECT id, name, kind, connection, device_id, host, port, columns, backup_printer_id, sort_order, is_active, status, status_at
             FROM pos_printers WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} ORDER BY sort_order, name`,
        tx`SELECT * FROM pos_devices WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} ORDER BY revoked_at NULLS FIRST, created_at`,
        tx`SELECT id, name, width, height, revenue_stream_id, decor, sort_order FROM floor_areas
            WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} ORDER BY sort_order, name`,
        tx`SELECT id, label, min_covers, max_covers, section_id, floor_area_id, pos_x::float8 AS x, pos_y::float8 AS y,
                  pos_w::float8 AS w, pos_h::float8 AS h, shape, rotation, sort_order
             FROM tables WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND is_active AND NOT COALESCE(is_unallocated, false)
            ORDER BY sort_order, label`,
        tx`SELECT id, name, pos_role_id, (pos_pin_hash IS NOT NULL) AS has_pin, is_active
             FROM cash_staff WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND is_active ORDER BY sort_order, name`,
        tx`SELECT id, name, permissions, sort_order FROM pos_roles WHERE tenant_id = ${tenantId} ORDER BY sort_order, name`,
        tx`SELECT id, name, short_name, hold_by_default, colour, sort_order, is_active FROM pos_courses
            WHERE tenant_id = ${tenantId} ORDER BY sort_order, name`,
        tx`SELECT id, name, venue_id, is_published FROM menus WHERE tenant_id = ${tenantId} AND (venue_id IS NULL OR venue_id = ${venueId})
            ORDER BY sort_order, name`,
        tx`SELECT id, name, kind, colour, settings, sort_order, is_active FROM kds_stations
            WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} ORDER BY sort_order, name`,
        flowsView(tx, tenantId, venueId, settings),
        tx`SELECT id, name, settings, updated_at, share_token IS NOT NULL AS shared FROM kiosk_designs WHERE tenant_id = ${tenantId} ORDER BY created_at`,
        // Each printer's waiting and failed tickets (the last day).
        tx`SELECT printer_id, count(*) FILTER (WHERE status IN ('queued', 'printing'))::int AS waiting,
                  count(*) FILTER (WHERE status = 'failed')::int AS failed
             FROM pos_print_jobs
            WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND created_at > now() - interval '1 day' AND printer_id IS NOT NULL
            GROUP BY printer_id`,
      ])
      const jobsOf = Object.fromEntries(jobCounts.map(j => [j.printer_id, { waiting: j.waiting, failed: j.failed }]))
      // A GloriaFood link (migration 159): its orders can go to the kitchen
      // screens (migration 178), each GloriaFood order type to one of ours.
      const [gfLink] = await tx`SELECT show_on_board FROM gloriafood_venue_links WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`
      const gloriafood = gfLink
        ? { show_on_board: gfLink.show_on_board, types: (await gloriaFoodTypes(tx, tenantId, settings.kds_gloriafood_types)).map }
        : null
      // Sections and dishes, for the kitchen flow's link filters.
      const menuIds = menus.map(m => m.id)
      const [sections, items] = await Promise.all([
        tx`SELECT id, menu_id, title FROM menu_sections
            WHERE tenant_id = ${tenantId} AND menu_id = ANY(${menuIds}::uuid[]) ORDER BY sort_order, title`,
        tx`SELECT i.id, i.section_id, i.name FROM menu_items i
             JOIN menu_sections s ON s.id = i.section_id AND s.tenant_id = i.tenant_id
            WHERE i.tenant_id = ${tenantId} AND s.menu_id = ANY(${menuIds}::uuid[]) ORDER BY i.sort_order, i.name`,
      ])
      return {
        venue: { id: venue.id, name: venue.name },
        settings: settingsView(settings),
        revenue_streams: streams, order_types: orderTypes,
        printers: printers.map(p => ({ ...p, jobs: jobsOf[p.id] || { waiting: 0, failed: 0 } })),
        devices: devices.map(deviceView),
        floor_areas: areas.map(a => ({ ...a, decor: a.decor || [] })),
        tables, staff,
        roles: roles.map(r => ({ ...r, permissions: normalisePermissions(r.permissions || {}) })),
        courses, menus, sections, items,
        kds_stations: kdsStations.map(s => ({ ...s, settings: stationSettings(s) })),
        ...kdsFlows,
        kiosk_designs: kioskDesigns.map(d => ({ id: d.id, name: d.name, settings: normaliseDesign(d.settings), updated_at: d.updated_at, shared: d.shared })),
        recon_fields: await reconFields(tx, tenantId, venueId),
        gloriafood,
        till_url: deviceOrigin('terminal'),
        installer_url: installerOrigin(),
        device_urls: { terminal: deviceOrigin('terminal'), kds: deviceOrigin('kds'), kiosk: deviceOrigin('kiosk') },
      }
    })
  })

  // ── Settings ────────────────────────────────────────────────────
  app.patch('/venues/:venueId/settings', { preHandler: canSetup }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    const body = SettingsBody.parse(req.body)
    const out = await withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      await ensureSettings(tx, req.tenantId, venueId)
      const set = { ...body, updated_at: new Date() }
      if (body.tenders) set.tenders = tx.json(body.tenders)
      if (body.recon_map) set.recon_map = tx.json(body.recon_map)
      if (body.kds_gloriafood_types) {
        const ids = [...new Set(Object.values(body.kds_gloriafood_types).filter(Boolean))]
        const known = ids.length ? await tx`SELECT id FROM order_types WHERE tenant_id = ${req.tenantId} AND id = ANY(${ids}::uuid[])` : []
        if (known.length !== ids.length) throw httpError(422, 'Order type not found')
        set.kds_gloriafood_types = tx.json(body.kds_gloriafood_types)
      }
      const keys = Object.keys(set)
      const [row] = await tx`
        UPDATE pos_settings SET ${tx(set, ...keys)}
         WHERE venue_id = ${venueId} AND tenant_id = ${req.tenantId}
         RETURNING *`
      return settingsView(row)
    })
    configChanged(venueId)
    return out
  })

  // ── Revenue streams ─────────────────────────────────────────────
  async function checkMenus(tx, tenantId, venueId, ids) {
    if (!ids.length) return
    const rows = await tx`SELECT id FROM menus WHERE tenant_id = ${tenantId} AND id = ANY(${ids}::uuid[]) AND (venue_id IS NULL OR venue_id = ${venueId})`
    if (rows.length !== new Set(ids).size) throw httpError(422, 'A chosen menu isn\'t available at this venue')
  }

  // A stream's order types: the list sent (else, for a new stream, every
  // active type on with nothing asked) and a default that is one of them.
  async function writeStreamTypes(tx, tenantId, streamId, body, isNew) {
    const types = await tx`SELECT id, is_active FROM order_types WHERE tenant_id = ${tenantId} ORDER BY sort_order, name`
    const known = new Set(types.map(t => t.id))
    let list = body.order_types
    if (!list && isNew) list = types.filter(t => t.is_active).map(t => ({ order_type_id: t.id, enabled: true, ask_name: 'off', ask_tent: 'off' }))
    if (list) {
      if (list.some(x => !known.has(x.order_type_id))) throw httpError(422, 'Order type not found')
      await tx`DELETE FROM pos_stream_order_types WHERE stream_id = ${streamId} AND tenant_id = ${tenantId}`
      for (const x of list) {
        await tx`
          INSERT INTO pos_stream_order_types (stream_id, order_type_id, tenant_id, enabled, ask_name, ask_tent)
          VALUES (${streamId}, ${x.order_type_id}, ${tenantId}, ${x.enabled}, ${x.ask_name}, ${x.ask_tent})
          ON CONFLICT (stream_id, order_type_id) DO UPDATE SET enabled = EXCLUDED.enabled, ask_name = EXCLUDED.ask_name, ask_tent = EXCLUDED.ask_tent`
      }
    }
    const on = (await tx`SELECT order_type_id FROM pos_stream_order_types WHERE stream_id = ${streamId} AND tenant_id = ${tenantId} AND enabled`)
      .map(r => r.order_type_id)
    let def = body.default_order_type_id !== undefined ? body.default_order_type_id
      : (await tx`SELECT default_order_type_id FROM pos_revenue_streams WHERE id = ${streamId} AND tenant_id = ${tenantId}`)[0]?.default_order_type_id
    if (def && !on.includes(def)) {
      if (body.default_order_type_id) throw httpError(422, 'The default order type must be one the stream offers')
      def = null
    }
    if (!def) def = types.find(t => on.includes(t.id))?.id ?? null
    await tx`UPDATE pos_revenue_streams SET default_order_type_id = ${def} WHERE id = ${streamId} AND tenant_id = ${tenantId}`
  }

  async function streamOut(tx, tenantId, venueId, id) {
    return (await loadStreams(tx, tenantId, venueId)).find(x => x.id === id)
  }

  app.post('/venues/:venueId/revenue-streams', { preHandler: canSetup }, async (req, reply) => {
    const venueId = UUID.parse(req.params.venueId)
    const body = StreamBody.parse(req.body)
    const row = await withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      await ensureTaxDefaults(tx, req.tenantId)
      await checkMenus(tx, req.tenantId, venueId, body.menu_ids)
      const [{ n }] = await tx`SELECT COALESCE(MAX(sort_order), -1)::int + 1 AS n FROM pos_revenue_streams WHERE tenant_id = ${req.tenantId} AND venue_id = ${venueId}`
      const [rs] = await tx`
        INSERT INTO pos_revenue_streams (tenant_id, venue_id, name, menu_ids, service_charge_percent, service_charge_min_covers, colour, sort_order, is_active)
        VALUES (${req.tenantId}, ${venueId}, ${body.name}, ${body.menu_ids}, ${body.service_charge_percent},
                ${body.service_charge_min_covers}, ${body.colour ?? null}, ${n}, ${body.is_active})
        RETURNING id`
      await writeStreamTypes(tx, req.tenantId, rs.id, body, true)
      return streamOut(tx, req.tenantId, venueId, rs.id)
    })
    configChanged(venueId)
    return reply.code(201).send(row)
  })

  app.patch('/revenue-streams/:id', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    const body = StreamBody.parse(req.body)
    const row = await withTenant(req.tenantId, async tx => {
      const rs = await ownRow(tx, 'pos_revenue_streams', req.tenantId, id, 'Revenue stream')
      await checkMenus(tx, req.tenantId, rs.venue_id, body.menu_ids)
      await tx`
        UPDATE pos_revenue_streams
           SET name = ${body.name}, menu_ids = ${body.menu_ids},
               service_charge_percent = ${body.service_charge_percent}, service_charge_min_covers = ${body.service_charge_min_covers},
               colour = ${body.colour ?? null}, is_active = ${body.is_active}
         WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      await writeStreamTypes(tx, req.tenantId, id, body, false)
      return { ...(await streamOut(tx, req.tenantId, rs.venue_id, id)), venue_id: rs.venue_id }
    })
    configChanged(row.venue_id)
    return row
  })

  app.delete('/revenue-streams/:id', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    const rs = await withTenant(req.tenantId, async tx => {
      const row = await ownRow(tx, 'pos_revenue_streams', req.tenantId, id, 'Revenue stream')
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM pos_check_lines WHERE tenant_id = ${req.tenantId} AND revenue_stream_id = ${id}`
      // Sales already posted to it keep pointing at it: switch it off instead.
      if (n) await tx`UPDATE pos_revenue_streams SET is_active = false WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      else await tx`DELETE FROM pos_revenue_streams WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      await dropFlowTarget(tx, req.tenantId, 'revenue_stream', id)
      return { ...row, switched_off: n > 0 }
    })
    configChanged(rs.venue_id)
    return { ok: true, switched_off: rs.switched_off }
  })

  app.put('/venues/:venueId/revenue-streams/order', { preHandler: canSetup }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    const { ids } = OrderBody.parse(req.body)
    await withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      for (const [i, id] of ids.entries()) {
        await tx`UPDATE pos_revenue_streams SET sort_order = ${i} WHERE id = ${id} AND tenant_id = ${req.tenantId} AND venue_id = ${venueId}`
      }
    })
    configChanged(venueId)
    return { ok: true }
  })

  // ── Printers and routing ────────────────────────────────────────
  async function checkBackup(tx, tenantId, venueId, backupId, selfId = null) {
    if (!backupId) return null
    if (backupId === selfId) throw httpError(422, 'A printer can\'t be its own backup')
    const [p] = await tx`SELECT id FROM pos_printers WHERE id = ${backupId} AND tenant_id = ${tenantId} AND venue_id = ${venueId}`
    if (!p) throw httpError(422, 'Backup printer not found')
    return p.id
  }

  app.post('/venues/:venueId/printers', { preHandler: canSetup }, async (req, reply) => {
    const venueId = UUID.parse(req.params.venueId)
    const body = PrinterBody.parse(req.body)
    const row = await withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      const backup = await checkBackup(tx, req.tenantId, venueId, body.backup_printer_id)
      const deviceId = await checkPrinterDevice(tx, req.tenantId, venueId, body)
      const [{ n }] = await tx`SELECT COALESCE(MAX(sort_order), -1)::int + 1 AS n FROM pos_printers WHERE tenant_id = ${req.tenantId} AND venue_id = ${venueId}`
      const [p] = await tx`
        INSERT INTO pos_printers (tenant_id, venue_id, name, kind, connection, device_id, host, port, columns, backup_printer_id, sort_order, is_active)
        VALUES (${req.tenantId}, ${venueId}, ${body.name}, ${body.kind}, ${body.connection}, ${deviceId}, ${body.host || null}, ${body.port},
                ${body.columns}, ${backup}, ${n}, ${body.is_active})
        RETURNING *`
      return p
    })
    configChanged(venueId)
    return reply.code(201).send(row)
  })

  app.patch('/printers/:id', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    const body = PrinterBody.parse(req.body)
    const row = await withTenant(req.tenantId, async tx => {
      const p = await ownRow(tx, 'pos_printers', req.tenantId, id, 'Printer')
      const backup = await checkBackup(tx, req.tenantId, p.venue_id, body.backup_printer_id, id)
      const deviceId = await checkPrinterDevice(tx, req.tenantId, p.venue_id, body)
      const moved = body.connection !== p.connection || deviceId !== p.device_id
      const [out] = await tx`
        UPDATE pos_printers
           SET name = ${body.name}, kind = ${body.kind}, connection = ${body.connection}, device_id = ${deviceId},
               host = ${body.host || null}, port = ${body.port},
               columns = ${body.columns}, backup_printer_id = ${backup}, is_active = ${body.is_active},
               status = CASE WHEN ${moved} THEN NULL ELSE status END,
               status_at = CASE WHEN ${moved} THEN NULL ELSE status_at END
         WHERE id = ${id} AND tenant_id = ${req.tenantId}
         RETURNING *`
      // Tickets waiting for it go to whoever prints for it now.
      if (moved) {
        await tx`UPDATE pos_print_jobs SET status = 'queued', claimed_by = NULL, claimed_at = NULL
                  WHERE tenant_id = ${req.tenantId} AND printer_id = ${id} AND status = 'printing'`
      }
      return out
    })
    configChanged(row.venue_id)
    return row
  })

  app.delete('/printers/:id', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    const p = await withTenant(req.tenantId, async tx => {
      const row = await ownRow(tx, 'pos_printers', req.tenantId, id, 'Printer')
      await tx`DELETE FROM pos_printers WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      // Nothing may keep printing to it: kitchen printer boxes and devices' receipt printer.
      await tx`
        UPDATE kds_stations SET settings = settings - 'printer_id'
         WHERE tenant_id = ${req.tenantId} AND venue_id = ${row.venue_id} AND settings->>'printer_id' = ${id}`
      await tx`
        UPDATE pos_devices SET settings = settings - 'receipt_printer_id'
         WHERE tenant_id = ${req.tenantId} AND venue_id = ${row.venue_id} AND settings->>'receipt_printer_id' = ${id}`
      return row
    })
    configChanged(p.venue_id)
    return { ok: true }
  })

  // ── Devices ─────────────────────────────────────────────────────
  async function checkDeviceSettings(tx, tenantId, venueId, s) {
    if (s.revenue_stream_id) {
      const [r] = await tx`SELECT id FROM pos_revenue_streams WHERE id = ${s.revenue_stream_id} AND tenant_id = ${tenantId} AND venue_id = ${venueId}`
      if (!r) throw httpError(422, 'Revenue stream not found')
    }
    if (s.receipt_printer_id) {
      const [p] = await tx`SELECT id FROM pos_printers WHERE id = ${s.receipt_printer_id} AND tenant_id = ${tenantId} AND venue_id = ${venueId}`
      if (!p) throw httpError(422, 'Printer not found')
    }
    if (s.floor_area_id) {
      const [a] = await tx`SELECT id FROM floor_areas WHERE id = ${s.floor_area_id} AND tenant_id = ${tenantId} AND venue_id = ${venueId}`
      if (!a) throw httpError(422, 'Floor area not found')
    }
    if (s.station_ids?.length) {
      const ids = [...new Set(s.station_ids)]
      const found = await tx`SELECT id FROM kds_stations WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND kind = ANY(${BUMP_KINDS}) AND id = ANY(${ids}::uuid[])`
      if (found.length !== ids.length) throw httpError(422, 'Kitchen station not found (order ready boards and Balance boxes aren\'t shown on a kitchen screen)')
    }
    if (s.design_id) await checkDesign(tx, tenantId, s.design_id)
  }

  // The one way a till, kitchen screen or kiosk is set up: the device shows a
  // code of its own (POST /pos-api/pairings, migration 184) and someone signed
  // in types it here, from Till setup or the installer app. A new device at
  // this venue, or a new device for one already here (the old device stops
  // working). The address the code was shown on decides the kind.
  app.post('/venues/:venueId/link', { preHandler: canSetup, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const venueId = UUID.parse(req.params.venueId)
    const body = z.object({
      code:      z.string().min(4).max(20),
      device_id: UUID.nullable().optional(),
      kind:      z.enum(LINK_KINDS).optional(),
      name:      z.string().trim().min(1).max(60).optional(),
      settings:  DeviceSettings.optional(),
    }).parse(req.body)
    const out = await withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      // Codes have no tenant until linked; lock this one.
      const [p] = await tx`
        SELECT id, app, secret_hash, device_info, expires_at, device_id FROM pos_pairings
         WHERE code_hash = ${linkCodeHash(body.code)} FOR UPDATE`
      if (!p || p.device_id || new Date(p.expires_at) <= new Date()) {
        throw httpError(422, 'That code isn\'t right or has run out: check the device shows the same code')
      }
      const kind = p.app || body.kind || 'terminal'
      if (p.app && body.kind && body.kind !== p.app) {
        throw httpError(422, `That code is on ${LINK_KIND_NAME[p.app]}: link it as one`)
      }
      const info = p.device_info || {}
      let id
      if (body.device_id) {
        const [d] = await tx`SELECT id, kind, venue_id, revoked_at FROM pos_devices WHERE id = ${body.device_id} AND tenant_id = ${req.tenantId}`
        if (!d || d.venue_id !== venueId) throw httpError(404, 'Device not found')
        if (d.revoked_at) throw httpError(422, 'That device was removed')
        if (d.kind !== kind) throw httpError(422, `That code is on ${LINK_KIND_NAME[kind]}, not ${LINK_KIND_NAME[d.kind] || 'that device'}`)
        await tx`
          UPDATE pos_devices
             SET secret_hash = ${p.secret_hash}, pairing_code_hash = NULL, pairing_expires_at = NULL, paired_at = now(),
                 last_seen_at = NULL, app_version = ${info.app_version || null}, user_agent = ${info.ua || null}
           WHERE id = ${d.id} AND tenant_id = ${req.tenantId}`
        id = d.id
      } else {
        if (!body.name) throw httpError(422, 'Give the device a name')
        const settings = body.settings || DeviceSettings.parse(undefined)
        await checkDeviceSettings(tx, req.tenantId, venueId, settings)
        const short = await nextShortCode(tx, req.tenantId, venueId, kind)
        const [d] = await tx`
          INSERT INTO pos_devices (tenant_id, venue_id, kind, name, short_code, settings, created_by,
                                   secret_hash, paired_at, app_version, user_agent)
          VALUES (${req.tenantId}, ${venueId}, ${kind}, ${body.name}, ${short}, ${tx.json(settings)}, ${by(req)},
                  ${p.secret_hash}, now(), ${info.app_version || null}, ${info.ua || null})
          RETURNING id`
        id = d.id
      }
      await tx`UPDATE pos_pairings SET claimed_at = now(), device_id = ${id}, tenant_id = ${req.tenantId} WHERE id = ${p.id}`
      const [fresh] = await tx`SELECT * FROM pos_devices WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      return { device: deviceView(fresh), replaced: !!body.device_id }
    })
    // A replaced device's old secret stops working (here at once, elsewhere within the device cache's 30 s).
    forgetDevice(out.device.id)
    configChanged(venueId)
    return reply.code(out.replaced ? 200 : 201).send({ device: out.device })
  })

  app.patch('/devices/:id', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    const body = z.object({ name: z.string().trim().min(1).max(60).optional(), settings: DeviceSettings.optional() }).parse(req.body)
    const out = await withTenant(req.tenantId, async tx => {
      const d = await ownRow(tx, 'pos_devices', req.tenantId, id, 'Till')
      if (body.settings) await checkDeviceSettings(tx, req.tenantId, d.venue_id, body.settings)
      const [row] = await tx`
        UPDATE pos_devices
           SET name = ${body.name ?? d.name}, settings = ${tx.json(body.settings ?? d.settings ?? {})}
         WHERE id = ${id} AND tenant_id = ${req.tenantId}
         RETURNING *`
      return row
    })
    configChanged(out.venue_id)
    return deviceView(out)
  })

  app.delete('/devices/:id', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    const d = await withTenant(req.tenantId, async tx => {
      await ownRow(tx, 'pos_devices', req.tenantId, id, 'Till')
      const [row] = await tx`
        UPDATE pos_devices SET revoked_at = now(), secret_hash = NULL, pairing_code_hash = NULL
         WHERE id = ${id} AND tenant_id = ${req.tenantId} RETURNING *`
      return row
    })
    broadcast('pos:' + d.venue_id, { type: 'pos.revoked', device_id: id })
    return { ok: true }
  })

  // ── Self-order kiosk designs (tenant-wide; shared/kiosk.js) ─────
  // A design is how kiosks look and behave; each kiosk picks one in its
  // settings (design_id; none = the tenant's first). Saved settings are
  // always normalised, so kiosks never get a value they don't know.
  app.get('/kiosk-designs', { preHandler: canSetupView }, async req => {
    const rows = await withTenant(req.tenantId, tx => tx`
      SELECT id, name, settings, created_at, updated_at, ${tx(SHARE_COLS)} FROM kiosk_designs WHERE tenant_id = ${req.tenantId} ORDER BY created_at`)
    return rows.map(d => ({ id: d.id, name: d.name, settings: normaliseDesign(d.settings), created_at: d.created_at, updated_at: d.updated_at, share: shareView(d) }))
  })

  app.post('/kiosk-designs', { preHandler: canSetup }, async (req, reply) => {
    const body = KioskDesignBody.extend({ copy_from: UUID.nullable().optional() }).parse(req.body)
    const row = await withTenant(req.tenantId, async tx => {
      const from = body.copy_from ? await checkDesign(tx, req.tenantId, body.copy_from) : null
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM kiosk_designs WHERE tenant_id = ${req.tenantId}`
      if (n >= 50) throw httpError(422, 'A restaurant can have up to 50 kiosk designs')
      const [d] = await tx`
        INSERT INTO kiosk_designs (tenant_id, name, settings, created_by)
        VALUES (${req.tenantId}, ${body.name}, ${tx.json(await ownDesign(tx, req.tenantId, from ? from.settings : body.settings))}, ${by(req)})
        RETURNING id, name, settings, created_at, updated_at`
      return d
    })
    return reply.code(201).send(row)
  })

  app.put('/kiosk-designs/:id', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    const body = KioskDesignBody.parse(req.body)
    return withTenant(req.tenantId, async tx => {
      await checkDesign(tx, req.tenantId, id)
      const [d] = await tx`
        UPDATE kiosk_designs SET name = ${body.name}, settings = ${tx.json(await ownDesign(tx, req.tenantId, body.settings))}, updated_at = now()
         WHERE id = ${id} AND tenant_id = ${req.tenantId}
         RETURNING id, name, settings, created_at, updated_at`
      await kiosksChanged(tx, req.tenantId)
      return d
    })
  })

  app.delete('/kiosk-designs/:id', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    return withTenant(req.tenantId, async tx => {
      await checkDesign(tx, req.tenantId, id)
      const using = await tx`
        SELECT name FROM pos_devices
         WHERE tenant_id = ${req.tenantId} AND kind = 'kiosk' AND revoked_at IS NULL AND settings->>'design_id' = ${id}`
      if (using.length) {
        throw httpError(422, (using.length === 1 ? using[0].name + ' uses' : using.map(u => u.name).join(', ') + ' use')
          + ' this design: pick another design for ' + (using.length === 1 ? 'it' : 'them') + ' first')
      }
      await tx`DELETE FROM kiosk_designs WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      await kiosksChanged(tx, req.tenantId)
      return { ok: true }
    })
  })

  // A link to the kiosk app showing this design at a venue, for the
  // editor's live preview (the app takes unsaved changes by postMessage).
  // menu 'draft' shows the menus with changes saved and not published yet;
  // menus_changed lists the menus the preview shows that have such changes.
  app.post('/kiosk-designs/:id/preview', { preHandler: canSetupView }, async req => {
    const id = UUID.parse(req.params.id)
    const body = z.object({
      venue_id: UUID,
      revenue_stream_id: UUID.nullable().optional(),
      menu: z.enum(['live', 'draft']).optional(),
    }).parse(req.body || {})
    const menusChanged = await withTenant(req.tenantId, async tx => {
      await checkDesign(tx, req.tenantId, id)
      await ownVenue(tx, req.tenantId, body.venue_id)
      if (body.revenue_stream_id) {
        const [r] = await tx`SELECT id FROM pos_revenue_streams WHERE id = ${body.revenue_stream_id} AND tenant_id = ${req.tenantId} AND venue_id = ${body.venue_id}`
        if (!r) throw httpError(422, 'Revenue stream not found')
      }
      return menuChanges(tx, req.tenantId, body.venue_id, body.revenue_stream_id || null)
    })
    const menu = body.menu || 'live'
    const token = await previewToken({ tenantId: req.tenantId, venueId: body.venue_id, designId: id, streamId: body.revenue_stream_id || null, menu })
    return { token, url: deviceOrigin('kiosk') + '/?kiosk_preview=' + encodeURIComponent(token), menu, menus_changed: menusChanged }
  })

  // A lasting preview link for people outside the group (migration 187):
  // the design as saved, with this venue's menu (as published, or with its
  // changes not published yet: menu 'draft', migration 188), opened at
  // kiosk.<domain>/?kiosk_share=<token> (GET /pos-api/kiosk-share). It never
  // orders anything. Making it, moving it and stopping it need Manage.
  app.put('/kiosk-designs/:id/share', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    const body = z.object({
      venue_id: UUID,
      revenue_stream_id: UUID.nullable().optional(),
      menu: z.enum(['live', 'draft']).optional(),
      expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    }).parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const d = await checkDesign(tx, req.tenantId, id)
      await ownVenue(tx, req.tenantId, body.venue_id)
      if (body.revenue_stream_id) {
        const [r] = await tx`SELECT id FROM pos_revenue_streams WHERE id = ${body.revenue_stream_id} AND tenant_id = ${req.tenantId} AND venue_id = ${body.venue_id}`
        if (!r) throw httpError(422, 'Revenue stream not found')
      }
      // The link ends at the end of the day it is set to (UTC, a day's grace).
      const expires = body.expires_on ? new Date(body.expires_on + 'T23:59:59Z') : null
      if (expires && expires <= new Date()) throw httpError(422, 'Pick an end date after today')
      const [row] = await tx`
        UPDATE kiosk_designs
           SET share_token = COALESCE(share_token, ${newShareToken()}),
               share_created_at = COALESCE(share_created_at, now()),
               share_created_by = COALESCE(share_created_by, ${by(req)}),
               share_venue_id = ${body.venue_id}, share_stream_id = ${body.revenue_stream_id || null},
               share_menu = ${body.menu || 'live'},
               share_expires_at = ${expires}
         WHERE id = ${d.id} AND tenant_id = ${req.tenantId}
         RETURNING ${tx(SHARE_COLS)}`
      return shareView(row)
    })
  })

  app.post('/kiosk-designs/:id/share/new-link', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    return withTenant(req.tenantId, async tx => {
      await checkDesign(tx, req.tenantId, id)
      const [row] = await tx`
        UPDATE kiosk_designs
           SET share_token = ${newShareToken()}, share_created_at = now(), share_created_by = ${by(req)},
               share_views = 0, share_last_viewed_at = NULL
         WHERE id = ${id} AND tenant_id = ${req.tenantId} AND share_token IS NOT NULL
         RETURNING ${tx(SHARE_COLS)}`
      if (!row) throw httpError(422, 'This design isn\'t shared yet')
      return shareView(row)
    })
  })

  app.delete('/kiosk-designs/:id/share', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    return withTenant(req.tenantId, async tx => {
      await checkDesign(tx, req.tenantId, id)
      await tx`
        UPDATE kiosk_designs
           SET share_token = NULL, share_venue_id = NULL, share_stream_id = NULL, share_menu = 'live', share_expires_at = NULL,
               share_created_at = NULL, share_created_by = NULL, share_views = 0, share_last_viewed_at = NULL
         WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      return { ok: true }
    })
  })

  // A link to the kitchen test bench: every kitchen screen of the venue on
  // one page, with a pretend kitchen the test orders go through (nothing
  // reaches the real screens). View is enough: the bench changes nothing.
  app.post('/venues/:venueId/kitchen-test', { preHandler: canSetupView }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    await withTenant(req.tenantId, tx => ownVenue(tx, req.tenantId, venueId))
    const token = await kitchenTestToken({ tenantId: req.tenantId, venueId })
    return { token, url: deviceOrigin('kds') + '/?kitchen_test=' + encodeURIComponent(token) }
  })

  // ── Kitchen screens: stations and routing ───────────────────────
  // A change reaches the sequencer straight away (it reads the stations per
  // event) and the kitchen screens through pos.config.
  app.post('/venues/:venueId/kds-stations', { preHandler: canSetup }, async (req, reply) => {
    const venueId = UUID.parse(req.params.venueId)
    const body = StationBody.parse(req.body)
    const row = await withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      await checkPieces(tx, req.tenantId, body.settings)
      await checkStationPrinter(tx, req.tenantId, venueId, body.settings)
      const [{ n }] = await tx`SELECT COALESCE(MAX(sort_order), -1)::int + 1 AS n FROM kds_stations WHERE tenant_id = ${req.tenantId} AND venue_id = ${venueId}`
      const [s] = await tx`
        INSERT INTO kds_stations (tenant_id, venue_id, name, kind, colour, settings, sort_order, is_active)
        VALUES (${req.tenantId}, ${venueId}, ${body.name}, ${body.kind}, ${body.colour || null}, ${tx.json(body.settings)}, ${n}, ${body.is_active})
        RETURNING *`
      return s
    })
    configChanged(venueId)
    return reply.code(201).send({ ...row, settings: stationSettings(row) })
  })

  app.patch('/kds-stations/:id', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    const body = StationBody.parse(req.body)
    const row = await withTenant(req.tenantId, async tx => {
      const was = await ownRow(tx, 'kds_stations', req.tenantId, id, 'Kitchen station')
      await checkPieces(tx, req.tenantId, body.settings)
      await checkStationPrinter(tx, req.tenantId, was.venue_id, body.settings)
      const [s] = await tx`
        UPDATE kds_stations
           SET name = ${body.name}, kind = ${body.kind}, colour = ${body.colour || null},
               settings = ${tx.json(body.settings)}, is_active = ${body.is_active}
         WHERE id = ${id} AND tenant_id = ${req.tenantId}
         RETURNING *`
      // An order ready board passes nothing on and isn't on any kitchen screen.
      if (body.kind === 'board') {
        await tx`DELETE FROM kds_flow_edges WHERE tenant_id = ${req.tenantId} AND from_station_id = ${id}`
        await dropDeviceStation(tx, req.tenantId, s.venue_id, id)
      }
      if (body.kind === 'balance') await tidyBalanceBox(tx, req.tenantId, s.venue_id, id)
      // A kitchen printer isn't on any kitchen screen.
      if (body.kind === 'printer') await dropDeviceStation(tx, req.tenantId, s.venue_id, id)
      // Stations that stop bumping can't take a Balance box's dishes.
      if (!BUMP_KINDS.includes(body.kind)) {
        await tx`
          DELETE FROM kds_flow_edges e USING kds_stations b
           WHERE e.tenant_id = ${req.tenantId} AND e.to_station_id = ${id} AND b.id = e.from_station_id AND b.kind = 'balance'`
      }
      return s
    })
    configChanged(row.venue_id)
    return { ...row, settings: stationSettings(row) }
  })

  app.delete('/kds-stations/:id', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    const s = await withTenant(req.tenantId, async tx => {
      const row = await ownRow(tx, 'kds_stations', req.tenantId, id, 'Kitchen station')
      // Its links go with it (ON DELETE CASCADE).
      await tx`DELETE FROM kds_stations WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      await dropDeviceStation(tx, req.tenantId, row.venue_id, id)
      return row
    })
    configChanged(s.venue_id)
    return { ok: true }
  })

  app.put('/venues/:venueId/kds-stations/order', { preHandler: canSetup }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    const { ids } = OrderBody.parse(req.body)
    await withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      for (const [i, id] of ids.entries()) {
        await tx`UPDATE kds_stations SET sort_order = ${i} WHERE id = ${id} AND tenant_id = ${req.tenantId} AND venue_id = ${venueId}`
      }
    })
    configChanged(venueId)
    return { ok: true }
  })

  // ── Kitchen flows (migrations 177, 192) ──────────────────────────
  // A venue has one or more named flows of its own, and every venue lists
  // the shared flows (venue_id NULL) too; one is in use per venue. Dishes
  // follow the flow in use when they are sent and keep that way (item.route),
  // so a switch or a saved change counts for dishes sent after it.

  /** What a venue's stations, streams and tills are called, by id. */
  async function venueNames(tx, tenantId, venueId) {
    const [streams, devices] = await Promise.all([
      tx`SELECT id, name FROM pos_revenue_streams WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`,
      tx`SELECT id, name FROM pos_devices WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND kind IN ('terminal', 'kiosk') AND revoked_at IS NULL`,
    ])
    const byId = rows => Object.fromEntries(rows.map(r => [r.id, r.name]))
    return { revenue_stream: byId(streams), device: byId(devices) }
  }

  app.post('/venues/:venueId/kds-flows', { preHandler: canSetup }, async (req, reply) => {
    const venueId = UUID.parse(req.params.venueId)
    const body = NewFlowBody.parse(req.body)
    const tenantId = req.tenantId
    let after = () => configChanged(venueId)
    const flow = await withTenant(tenantId, async tx => {
      await ownVenue(tx, tenantId, venueId)
      await ensureFlows(tx, tenantId, venueId)
      if (await flowNameTaken(tx, tenantId, body.shared ? null : venueId, body.name)) throw httpError(422, 'There is already a flow called ' + body.name)
      // A copy is of one of this venue's own flows or a shared one.
      const from = body.copy_from ? await ownFlow(tx, tenantId, body.copy_from) : null
      if (from && !from.shared && from.venue_id !== venueId) throw httpError(404, 'Kitchen flow not found')
      let layout = from?.layout || {}
      let off = []
      let boxes = []
      let boxLinks = []
      let edges = []
      const stations = await tx`SELECT id, name, kind, is_active FROM kds_stations WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} ORDER BY sort_order, name`
      if (from && body.shared && from.shared) {
        boxes = from.boxes
        boxLinks = from.box_links
      } else if (from && body.shared) {
        // This venue's flow for every location: its stations become boxes
        // (box id = station id, so the layout carries over), its stream and
        // till filters names.
        const inFlow = stations.filter(st => !(from.off_station_ids || []).includes(st.id))
        const shared = shareFlow(await loadFlowLinks(tx, tenantId, from.id), inFlow, await venueNames(tx, tenantId, venueId))
        boxes = shared.boxes
        boxLinks = shared.links
      } else if (from && from.shared) {
        // A shared flow as this venue's own: its boxes become the venue's
        // stations of those names; stations it has no box for are left out.
        const r = resolveSharedFlow({ boxes: from.boxes, links: from.box_links }, await flowPlace(tx, tenantId, venueId, stations))
        edges = r.links.flatMap(l => {
          const targets = l.targets.filter(t => !NAMED_TARGET_KINDS.includes(t.kind) || t.id)
          return (l.targets.length && !targets.length) ? [] : [{ ...l, targets }]
        })
        const matched = new Set(Object.values(r.matches))
        off = stations.filter(st => !matched.has(st.id)).map(st => st.id)
        layout = Object.fromEntries(Object.entries(from.layout || {}).flatMap(([k, p]) => (k === 'start' ? [[k, p]] : r.matches[k] ? [[r.matches[k], p]] : [])))
      } else if (from) {
        edges = await loadFlowLinks(tx, tenantId, from.id)
        off = from.off_station_ids || []
      }
      if (body.shared) {
        await pinActiveFlows(tx, tenantId)
        after = await everyVenueChanged(tx, tenantId)
      }
      const [{ n }] = body.shared
        ? await tx`SELECT COALESCE(MAX(sort_order), -1)::int + 1 AS n FROM kds_flows WHERE tenant_id = ${tenantId} AND venue_id IS NULL`
        : await tx`SELECT COALESCE(MAX(sort_order), -1)::int + 1 AS n FROM kds_flows WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`
      const [f] = await tx`
        INSERT INTO kds_flows (tenant_id, venue_id, name, layout, sort_order, off_station_ids, boxes, box_links)
        VALUES (${tenantId}, ${body.shared ? null : venueId}, ${body.name}, ${tx.json(layout)}, ${n}, ${off},
                ${tx.json(boxes)}, ${tx.json(boxLinks)})
        RETURNING id, venue_id, name, layout, sort_order, off_station_ids, boxes, box_links, venue_id IS NULL AS shared`
      for (const [i, l] of edges.entries()) {
        await tx`
          INSERT INTO kds_flow_edges (tenant_id, venue_id, flow_id, from_station_id, to_station_id, targets, sort_order)
          VALUES (${tenantId}, ${venueId}, ${f.id}, ${l.from || null}, ${l.to}, ${tx.json(l.targets || [])}, ${i})`
      }
      return flowView(f, f.shared ? [] : await loadFlowLinks(tx, tenantId, f.id))
    })
    after()
    return reply.code(201).send(flow)
  })

  app.patch('/kds-flows/:id', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    const { name } = z.object({ name: FlowName }).parse(req.body)
    let after = () => {}
    const row = await withTenant(req.tenantId, async tx => {
      const f = await ownFlow(tx, req.tenantId, id)
      if (await flowNameTaken(tx, req.tenantId, f.venue_id, name, id)) throw httpError(422, 'There is already a flow called ' + name)
      const [out] = await tx`
        UPDATE kds_flows SET name = ${name}, updated_at = now()
         WHERE id = ${id} AND tenant_id = ${req.tenantId}
         RETURNING id, venue_id, name, sort_order, venue_id IS NULL AS shared`
      after = out.shared ? await everyVenueChanged(tx, req.tenantId) : () => configChanged(out.venue_id)
      return out
    })
    after()
    return row
  })

  app.delete('/kds-flows/:id', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    let after = () => {}
    await withTenant(req.tenantId, async tx => {
      const f = await ownFlow(tx, req.tenantId, id)
      if (f.shared) {
        // In use at any location: no. Venues using "the first flow" are written down first.
        await pinActiveFlows(tx, req.tenantId)
        const using = await tx`
          SELECT v.name FROM pos_settings ps JOIN venues v ON v.id = ps.venue_id AND v.tenant_id = ps.tenant_id
           WHERE ps.tenant_id = ${req.tenantId} AND ps.kds_active_flow_id = ${id} ORDER BY v.name`
        if (using.length) throw httpError(422, 'This flow is in use at ' + using.map(u => u.name).join(', ') + ': put another flow in use there first')
        after = await everyVenueChanged(tx, req.tenantId)
      } else {
        // The flow in use can't go: dishes would quietly start following another.
        await tx`SELECT pg_advisory_xact_lock(hashtext(${'pos:' + f.venue_id}))`
        const flows = await loadFlows(tx, req.tenantId, f.venue_id)
        const [s] = await tx`SELECT kds_active_flow_id FROM pos_settings WHERE venue_id = ${f.venue_id} AND tenant_id = ${req.tenantId}`
        if (activeFlowOf(flows, s?.kds_active_flow_id)?.id === id) throw httpError(422, 'This flow is in use: put another flow in use first')
        after = () => configChanged(f.venue_id)
      }
      await tx`DELETE FROM kds_flows WHERE id = ${id} AND tenant_id = ${req.tenantId}`
    })
    after()
    return { ok: true }
  })

  app.put('/venues/:venueId/kds-flows/order', { preHandler: canSetup }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    const { ids } = OrderBody.parse(req.body)
    await withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      // The flow in use may be "the first": keep it in use whatever the order.
      const flows = await loadFlows(tx, req.tenantId, venueId)
      const [s] = await tx`SELECT kds_active_flow_id FROM pos_settings WHERE venue_id = ${venueId} AND tenant_id = ${req.tenantId}`
      const active = activeFlowOf(flows, s?.kds_active_flow_id)
      if (s && active && s.kds_active_flow_id !== active.id) {
        await tx`UPDATE pos_settings SET kds_active_flow_id = ${active.id} WHERE venue_id = ${venueId} AND tenant_id = ${req.tenantId}`
      }
      for (const [i, id] of ids.entries()) {
        await tx`UPDATE kds_flows SET sort_order = ${i} WHERE id = ${id} AND tenant_id = ${req.tenantId} AND venue_id = ${venueId}`
      }
    })
    configChanged(venueId)
    return { ok: true }
  })

  // The shared flows' order (every location lists them after its own).
  app.put('/kds-flows/shared/order', { preHandler: canSetup }, async req => {
    const { ids } = OrderBody.parse(req.body)
    const after = await withTenant(req.tenantId, async tx => {
      await pinActiveFlows(tx, req.tenantId)
      for (const [i, id] of ids.entries()) {
        await tx`UPDATE kds_flows SET sort_order = ${i} WHERE id = ${id} AND tenant_id = ${req.tenantId} AND venue_id IS NULL`
      }
      return everyVenueChanged(tx, req.tenantId)
    })
    after()
    return { ok: true }
  })

  app.put('/venues/:venueId/kds-flows/active', { preHandler: canSetup }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    const { flow_id } = z.object({ flow_id: UUID }).parse(req.body)
    const out = await withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      return switchFlow(tx, req.tenantId, venueId, flow_id, by(req) || 'Till setup')
    })
    if (out.changed) configChanged(venueId)
    return out
  })

  app.put('/kds-flows/:id', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    const tenantId = req.tenantId
    let after = () => {}
    const out = await withTenant(tenantId, async tx => {
      const flow = await ownFlow(tx, tenantId, id)
      const orderTypes = new Set((await tx`SELECT id FROM order_types WHERE tenant_id = ${tenantId}`).map(r => r.id))
      const menuIds = new Set()
      const layoutOf = (raw, known) => Object.fromEntries(Object.entries(raw).filter(([k]) => known.has(k))
        .map(([k, p]) => [k, { x: Math.round(p.x), y: Math.round(p.y) }]))

      if (flow.shared) {
        // A shared flow: boxes by name, each location's station of that name.
        const body = SharedFlowBody.parse(req.body)
        const boxes = body.boxes.map(b => ({ id: b.id, name: b.name.replace(/\s+/g, ' '), kind: b.kind }))
        const ids = new Set(boxes.map(b => b.id))
        if (ids.size !== boxes.length) throw httpError(422, 'Two boxes have the same id')
        const bp = boxProblems(boxes)
        if (bp.length) throw httpError(422, bp[0])
        const links = body.links.map(l => ({
          id: randomUUID(),
          from: l.from || null,
          to: l.to,
          targets: cleanTargets(l.targets, { shared: true, streams: new Set(), devices: new Set(), orderTypes, menuIds }),
        }))
        for (const l of links) {
          if (!ids.has(l.to) || (l.from && !ids.has(l.from))) throw httpError(422, 'A link goes to a box that isn\'t in this flow')
        }
        const problems = flowProblems(boxes, links)
        if (problems.length) throw httpError(422, problems[0])
        await checkMenuTargets(tx, tenantId, menuIds)
        const layout = layoutOf(body.layout, new Set(['start', ...ids]))
        await tx`
          UPDATE kds_flows SET boxes = ${tx.json(boxes)}, box_links = ${tx.json(links)}, layout = ${tx.json(layout)}, updated_at = now()
           WHERE id = ${id} AND tenant_id = ${tenantId}`
        // Which locations lack which boxes (their links are left out there).
        const { kds_locations } = await sharedPlaces(tx, tenantId)
        const missing = []
        for (const v of kds_locations) {
          const r = resolveSharedFlow({ boxes, links }, { stations: v.stations })
          if (r.missing.length && v.stations.length) missing.push(v.name + ' has no ' + r.missing.map(b => b.name).join(', ') + ': its links don\'t apply there.')
          for (const d of r.differs) missing.push('At ' + v.name + ', ' + d.station.name + ' is set up as ' + KIND_LABELS[d.station.kind] + ', not ' + KIND_LABELS[d.box.kind] + ': it works as ' + KIND_LABELS[d.station.kind] + ' there.')
        }
        after = await everyVenueChanged(tx, tenantId)
        return { id, shared: true, boxes, links, layout, warnings: [...flowWarnings(boxes, links), ...missing] }
      }

      const body = KdsFlowBody.parse(req.body)
      const venueId = flow.venue_id
      const stations = await tx`SELECT id, name, kind, is_active FROM kds_stations WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`
      const streams = new Set((await tx`SELECT id FROM pos_revenue_streams WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`).map(r => r.id))
      const devices = new Set((await tx`
        SELECT id FROM pos_devices WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND kind IN ('terminal', 'kiosk') AND revoked_at IS NULL`).map(r => r.id))
      const links = body.links.map(l => ({
        from: l.from || null,
        to: l.to,
        targets: cleanTargets(l.targets, { shared: false, streams, devices, orderTypes, menuIds }),
      }))
      // Stations left out of this flow: the venue's own, and nothing links to them.
      const stationIds = new Set(stations.map(s => s.id))
      const off = new Set(body.off_station_ids)
      for (const sid of off) if (!stationIds.has(sid)) throw httpError(422, 'Station not found')
      for (const l of links) {
        const out = [l.from, l.to].find(sid => sid && off.has(sid))
        if (out) throw httpError(422, stations.find(s => s.id === out).name + ' is out of this flow: put it back before linking it')
      }
      const inFlow = stations.filter(s => !off.has(s.id))
      const problems = flowProblems(stations, links)
      if (problems.length) throw httpError(422, problems[0])
      await checkMenuTargets(tx, tenantId, menuIds)
      const layout = layoutOf(body.layout, new Set(['start', ...stations.map(s => s.id)]))
      await tx`DELETE FROM kds_flow_edges WHERE tenant_id = ${tenantId} AND flow_id = ${id}`
      for (const [i, l] of links.entries()) {
        await tx`
          INSERT INTO kds_flow_edges (tenant_id, venue_id, flow_id, from_station_id, to_station_id, targets, sort_order)
          VALUES (${tenantId}, ${venueId}, ${id}, ${l.from}, ${l.to}, ${tx.json(l.targets)}, ${i})`
      }
      await tx`
        UPDATE kds_flows SET layout = ${tx.json(layout)}, off_station_ids = ${[...off]}, updated_at = now()
         WHERE id = ${id} AND tenant_id = ${tenantId}`
      const saved = await loadFlowLinks(tx, tenantId, id)
      after = () => configChanged(venueId)
      return { id, links: saved, layout, off_station_ids: [...off], warnings: flowWarnings(inFlow, saved) }
    })
    after()
    return out
  })

  // ── Kitchen report (speed of service) ───────────────────────────
  async function kitchenRange(tx, req) {
    const venueId = UUID.parse(req.params.venueId)
    const q = z.object({ from: DATE, to: DATE }).parse(req.query)
    if (q.to < q.from) throw httpError(422, 'The end date is before the start date')
    const venue = await ownVenue(tx, req.tenantId, venueId)
    const tz = venue.timezone || 'Europe/London'
    return { venueId, tz, from: q.from, to: q.to }
  }

  app.get('/venues/:venueId/kitchen-report', { preHandler: canReports }, async req => {
    return withTenant(req.tenantId, async tx => {
      const { venueId, tz, from, to } = await kitchenRange(tx, req)
      const range = tx`l.at >= (${from}::date)::timestamp AT TIME ZONE ${tz} AND l.at < ((${to}::date) + 1)::timestamp AT TIME ZONE ${tz}`
      const [stations, hours, remakes, days] = await Promise.all([
        tx`
          SELECT l.station_id, COALESCE(s.name, l.station_name) AS name, COALESCE(s.kind, l.station_kind) AS kind,
                 COALESCE((s.settings->>'target_mins')::int, 8) AS target_mins,
                 count(*)::int AS tickets, COALESCE(sum(l.items), 0)::int AS items,
                 round(avg(l.seconds))::int AS avg_secs,
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY l.seconds)::int AS median_secs,
                 percentile_cont(0.9) WITHIN GROUP (ORDER BY l.seconds)::int AS p90_secs,
                 max(l.seconds)::int AS max_secs,
                 count(*) FILTER (WHERE l.seconds <= COALESCE((s.settings->>'target_mins')::int, 8) * 60)::int AS on_time,
                 count(*) FILTER (WHERE l.seconds > COALESCE((s.settings->>'late_mins')::int, 12) * 60)::int AS late
            FROM kds_log l
            LEFT JOIN kds_stations s ON s.id = l.station_id AND s.tenant_id = l.tenant_id
           WHERE l.tenant_id = ${req.tenantId} AND l.venue_id = ${venueId} AND l.kind = 'bump' AND l.recalled_at IS NULL AND ${range}
           GROUP BY 1, 2, 3, 4
           ORDER BY min(COALESCE(s.sort_order, 999)), 2`,
        tx`
          SELECT l.station_id, extract(hour FROM l.at AT TIME ZONE ${tz})::int AS hour,
                 count(*)::int AS tickets, round(avg(l.seconds))::int AS avg_secs
            FROM kds_log l
           WHERE l.tenant_id = ${req.tenantId} AND l.venue_id = ${venueId} AND l.kind = 'bump' AND l.recalled_at IS NULL AND ${range}
           GROUP BY 1, 2 ORDER BY 2`,
        tx`
          SELECT l.item_name, COALESCE(s.name, l.station_name) AS station, l.reason, l.at, l.order_number
            FROM kds_log l
            LEFT JOIN kds_stations s ON s.id = l.station_id AND s.tenant_id = l.tenant_id
           WHERE l.tenant_id = ${req.tenantId} AND l.venue_id = ${venueId} AND l.kind = 'remake' AND ${range}
           ORDER BY l.at DESC LIMIT 200`,
        tx`
          SELECT (l.at AT TIME ZONE ${tz})::date::text AS date, l.station_id,
                 count(*)::int AS tickets, round(avg(l.seconds))::int AS avg_secs
            FROM kds_log l
           WHERE l.tenant_id = ${req.tenantId} AND l.venue_id = ${venueId} AND l.kind = 'bump' AND l.recalled_at IS NULL AND ${range}
           GROUP BY 1, 2 ORDER BY 1`,
      ])
      return { from, to, timezone: tz, stations, hours, days, remakes }
    })
  })

  app.get('/venues/:venueId/kitchen-report.csv', { preHandler: canReports }, async (req, reply) => {
    const { rows, from, to } = await withTenant(req.tenantId, async tx => {
      const { venueId, tz, from, to } = await kitchenRange(tx, req)
      const rows = await tx`
        SELECT to_char(l.at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS date, to_char(l.at AT TIME ZONE ${tz}, 'HH24:MI:SS') AS time,
               l.kind, COALESCE(s.name, l.station_name) AS station, l.station_kind, l.order_number, l.order_source, l.order_type,
               l.seconds, l.items, l.item_name, l.reason, (l.recalled_at IS NOT NULL) AS recalled
          FROM kds_log l
          LEFT JOIN kds_stations s ON s.id = l.station_id AND s.tenant_id = l.tenant_id
         WHERE l.tenant_id = ${req.tenantId} AND l.venue_id = ${venueId}
           AND l.at >= (${from}::date)::timestamp AT TIME ZONE ${tz} AND l.at < ((${to}::date) + 1)::timestamp AT TIME ZONE ${tz}
         ORDER BY l.at
         LIMIT 100000`
      return { rows, from, to }
    })
    const cell = v => {
      const s = v == null ? '' : String(v)
      return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
    }
    const head = ['date', 'time', 'kind', 'station', 'station_kind', 'order_number', 'order_source', 'order_type', 'seconds', 'items', 'item', 'reason', 'recalled']
    const lines = [head.join(',')]
    for (const r of rows) {
      lines.push([r.date, r.time, r.kind, r.station, r.station_kind, r.order_number, r.order_source, r.order_type, r.seconds, r.items, r.item_name, r.reason, r.recalled ? 'yes' : ''].map(cell).join(','))
    }
    reply.header('content-type', 'text/csv; charset=utf-8')
    reply.header('content-disposition', `attachment; filename="kitchen-${from}-to-${to}.csv"`)
    return lines.join('\r\n') + '\r\n'
  })

  // ── Floor plan ──────────────────────────────────────────────────
  app.post('/venues/:venueId/floor-areas', { preHandler: canSetup }, async (req, reply) => {
    const venueId = UUID.parse(req.params.venueId)
    const body = AreaBody.parse(req.body)
    const row = await withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      if (body.revenue_stream_id) await ownRow(tx, 'pos_revenue_streams', req.tenantId, body.revenue_stream_id, 'Revenue stream')
      const [{ n }] = await tx`SELECT COALESCE(MAX(sort_order), -1)::int + 1 AS n FROM floor_areas WHERE tenant_id = ${req.tenantId} AND venue_id = ${venueId}`
      const [a] = await tx`
        INSERT INTO floor_areas (tenant_id, venue_id, name, width, height, revenue_stream_id, sort_order)
        VALUES (${req.tenantId}, ${venueId}, ${body.name}, ${body.width}, ${body.height}, ${body.revenue_stream_id ?? null}, ${body.sort_order ?? n})
        RETURNING *`
      return a
    })
    configChanged(venueId)
    return reply.code(201).send(row)
  })

  app.patch('/floor-areas/:id', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    const body = AreaBody.parse(req.body)
    const row = await withTenant(req.tenantId, async tx => {
      const a = await ownRow(tx, 'floor_areas', req.tenantId, id, 'Floor area')
      if (body.revenue_stream_id) await ownRow(tx, 'pos_revenue_streams', req.tenantId, body.revenue_stream_id, 'Revenue stream')
      const [out] = await tx`
        UPDATE floor_areas
           SET name = ${body.name}, width = ${body.width}, height = ${body.height},
               revenue_stream_id = ${body.revenue_stream_id ?? null}, sort_order = ${body.sort_order ?? a.sort_order}
         WHERE id = ${id} AND tenant_id = ${req.tenantId}
         RETURNING *`
      return out
    })
    configChanged(row.venue_id)
    return row
  })

  app.delete('/floor-areas/:id', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    const a = await withTenant(req.tenantId, async tx => {
      const row = await ownRow(tx, 'floor_areas', req.tenantId, id, 'Floor area')
      await tx`DELETE FROM floor_areas WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      return row
    })
    configChanged(a.venue_id)
    return { ok: true }
  })

  app.put('/floor-areas/:id/layout', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    const body = LayoutBody.parse(req.body)
    const area = await withTenant(req.tenantId, async tx => {
      const a = await ownRow(tx, 'floor_areas', req.tenantId, id, 'Floor area')
      const ids = body.tables.map(t => t.id)
      if (ids.length) {
        const own = await tx`SELECT id FROM tables WHERE tenant_id = ${req.tenantId} AND venue_id = ${a.venue_id} AND id = ANY(${ids}::uuid[])`
        if (own.length !== new Set(ids).size) throw httpError(422, 'A table wasn\'t found at this venue')
      }
      // Tables no longer on this plan come off it.
      await tx`
        UPDATE tables SET floor_area_id = NULL, pos_x = NULL, pos_y = NULL, pos_w = NULL, pos_h = NULL
         WHERE tenant_id = ${req.tenantId} AND floor_area_id = ${id} AND NOT (id = ANY(${ids}::uuid[]))`
      for (const t of body.tables) {
        await tx`
          UPDATE tables
             SET floor_area_id = ${id}, pos_x = ${t.x}, pos_y = ${t.y}, pos_w = ${t.w}, pos_h = ${t.h},
                 shape = ${t.shape}, rotation = ${t.rotation}
           WHERE id = ${t.id} AND tenant_id = ${req.tenantId}`
      }
      await tx`UPDATE floor_areas SET decor = ${tx.json(body.decor)} WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      return a
    })
    configChanged(area.venue_id)
    return { ok: true }
  })

  // ── Staff PINs and roles ────────────────────────────────────────
  app.put('/venues/:venueId/staff/:staffId/pos', { preHandler: canSetup }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    const staffId = UUID.parse(req.params.staffId)
    const body = StaffPosBody.parse(req.body)
    const out = await withTenant(req.tenantId, async tx => {
      const [s] = await tx`SELECT id FROM cash_staff WHERE id = ${staffId} AND tenant_id = ${req.tenantId} AND venue_id = ${venueId}`
      if (!s) throw httpError(404, 'Staff member not found')
      if (body.pos_role_id) await ownRow(tx, 'pos_roles', req.tenantId, body.pos_role_id, 'Till role')
      const settings = await ensureSettings(tx, req.tenantId, venueId)
      let hash
      if (body.pin) {
        const weak = weakPin(body.pin)
        if (weak) throw httpError(422, 'That PIN is too easy to guess (' + weak.toLowerCase() + ')')
        hash = await hashPin(body.pin, settings.pin_salt)
        const [taken] = await tx`
          SELECT id FROM cash_staff WHERE tenant_id = ${req.tenantId} AND venue_id = ${venueId} AND pos_pin_hash = ${hash} AND id <> ${staffId}`
        if (taken) throw httpError(422, 'Someone else at this venue has that PIN: choose another')
      }
      const [row] = await tx`
        UPDATE cash_staff
           SET pos_pin_hash = ${body.pin === undefined ? tx`pos_pin_hash` : (hash ?? null)},
               pos_role_id = ${body.pos_role_id === undefined ? tx`pos_role_id` : body.pos_role_id}
         WHERE id = ${staffId} AND tenant_id = ${req.tenantId}
         RETURNING id, name, pos_role_id, (pos_pin_hash IS NOT NULL) AS has_pin`
      return row
    })
    configChanged(venueId)
    return out
  })

  app.get('/roles', { preHandler: canSetupView }, async req => {
    return withTenant(req.tenantId, async tx => {
      const rows = await tx`SELECT id, name, permissions, sort_order FROM pos_roles WHERE tenant_id = ${req.tenantId} ORDER BY sort_order, name`
      return rows.map(r => ({ ...r, permissions: normalisePermissions(r.permissions || {}) }))
    })
  })

  const cleanPerms = p => {
    const out = {}
    for (const k of PERMISSION_KEYS) out[k] = !!p[k]
    out.discount_max_pct = Math.max(0, Math.min(100, Math.round(Number(p.discount_max_pct) || 0)))
    return out
  }

  app.post('/roles', { preHandler: canSetup }, async (req, reply) => {
    const body = RoleBody.parse(req.body)
    const row = await withTenant(req.tenantId, async tx => {
      const [{ n }] = await tx`SELECT COALESCE(MAX(sort_order), -1)::int + 1 AS n FROM pos_roles WHERE tenant_id = ${req.tenantId}`
      const [r] = await tx`
        INSERT INTO pos_roles (tenant_id, name, permissions, sort_order)
        VALUES (${req.tenantId}, ${body.name}, ${tx.json(cleanPerms(body.permissions))}, ${n})
        RETURNING *`
      return r
    })
    return reply.code(201).send({ ...row, permissions: normalisePermissions(row.permissions) })
  })

  app.post('/roles/defaults', { preHandler: canSetup }, async req => {
    return withTenant(req.tenantId, async tx => {
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM pos_roles WHERE tenant_id = ${req.tenantId}`
      if (n) return { added: 0 }
      for (const [i, r] of DEFAULT_POS_ROLES.entries()) {
        await tx`INSERT INTO pos_roles (tenant_id, name, permissions, sort_order) VALUES (${req.tenantId}, ${r.name}, ${tx.json(cleanPerms(r.permissions))}, ${i})`
      }
      return { added: DEFAULT_POS_ROLES.length }
    })
  })

  app.patch('/roles/:id', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    const body = RoleBody.parse(req.body)
    const row = await withTenant(req.tenantId, async tx => {
      await ownRow(tx, 'pos_roles', req.tenantId, id, 'Till role')
      const [r] = await tx`
        UPDATE pos_roles SET name = ${body.name}, permissions = ${tx.json(cleanPerms(body.permissions))}
         WHERE id = ${id} AND tenant_id = ${req.tenantId} RETURNING *`
      const venues = await tx`SELECT DISTINCT venue_id FROM cash_staff WHERE tenant_id = ${req.tenantId} AND pos_role_id = ${id}`
      return { r, venues: venues.map(v => v.venue_id) }
    })
    for (const v of row.venues) configChanged(v)
    return { ...row.r, permissions: normalisePermissions(row.r.permissions) }
  })

  app.delete('/roles/:id', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    await withTenant(req.tenantId, async tx => {
      await ownRow(tx, 'pos_roles', req.tenantId, id, 'Till role')
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM cash_staff WHERE tenant_id = ${req.tenantId} AND pos_role_id = ${id} AND is_active`
      if (n) throw httpError(422, n === 1 ? 'One person has this role: give them another first' : n + ' people have this role: give them another first')
      await tx`DELETE FROM pos_roles WHERE id = ${id} AND tenant_id = ${req.tenantId}`
    })
    return { ok: true }
  })

  // ── Courses ─────────────────────────────────────────────────────
  app.get('/courses', { preHandler: canSetupView }, async req => {
    return withTenant(req.tenantId, tx => tx`
      SELECT id, name, short_name, hold_by_default, colour, sort_order, is_active FROM pos_courses
       WHERE tenant_id = ${req.tenantId} ORDER BY sort_order, name`)
  })

  app.post('/courses', { preHandler: canSetup }, async (req, reply) => {
    const body = CourseBody.parse(req.body)
    const row = await withTenant(req.tenantId, async tx => {
      const [{ n }] = await tx`SELECT COALESCE(MAX(sort_order), -1)::int + 1 AS n FROM pos_courses WHERE tenant_id = ${req.tenantId}`
      const [c] = await tx`
        INSERT INTO pos_courses (tenant_id, name, short_name, hold_by_default, colour, sort_order, is_active)
        VALUES (${req.tenantId}, ${body.name}, ${body.short_name || null}, ${body.hold_by_default}, ${body.colour ?? null}, ${n}, ${body.is_active})
        RETURNING *`
      return c
    })
    return reply.code(201).send(row)
  })

  app.post('/courses/defaults', { preHandler: canSetup }, async req => {
    return withTenant(req.tenantId, async tx => {
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM pos_courses WHERE tenant_id = ${req.tenantId}`
      if (n) return { added: 0 }
      for (const [i, c] of DEFAULT_COURSES.entries()) {
        await tx`INSERT INTO pos_courses (tenant_id, name, short_name, hold_by_default, sort_order) VALUES (${req.tenantId}, ${c.name}, ${c.short_name}, ${c.hold_by_default}, ${i})`
      }
      return { added: DEFAULT_COURSES.length }
    })
  })

  app.patch('/courses/:id', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    const body = CourseBody.parse(req.body)
    return withTenant(req.tenantId, async tx => {
      await ownRow(tx, 'pos_courses', req.tenantId, id, 'Course')
      const [c] = await tx`
        UPDATE pos_courses SET name = ${body.name}, short_name = ${body.short_name || null}, hold_by_default = ${body.hold_by_default},
               colour = ${body.colour ?? null}, is_active = ${body.is_active}
         WHERE id = ${id} AND tenant_id = ${req.tenantId} RETURNING *`
      return c
    })
  })

  app.delete('/courses/:id', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    await withTenant(req.tenantId, async tx => {
      await ownRow(tx, 'pos_courses', req.tenantId, id, 'Course')
      // Dishes and sections that used it go back to no course.
      await tx`UPDATE menu_items SET pos_course_id = NULL WHERE tenant_id = ${req.tenantId} AND pos_course_id = ${id}`
      await tx`UPDATE menu_sections SET pos_course_id = NULL WHERE tenant_id = ${req.tenantId} AND pos_course_id = ${id}`
      await tx`DELETE FROM pos_courses WHERE id = ${id} AND tenant_id = ${req.tenantId}`
    })
    return { ok: true }
  })

  app.put('/courses/order', { preHandler: canSetup }, async req => {
    const { ids } = OrderBody.parse(req.body)
    await withTenant(req.tenantId, async tx => {
      for (const [i, id] of ids.entries()) await tx`UPDATE pos_courses SET sort_order = ${i} WHERE id = ${id} AND tenant_id = ${req.tenantId}`
    })
    return { ok: true }
  })

  // ── Reports ─────────────────────────────────────────────────────
  app.get('/venues/:venueId/days', { preHandler: canReports }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 60))
    return withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      return tx`
        SELECT d.id, d.business_date::text AS business_date, d.z_number, d.opened_at, d.closed_at, d.declared_cash,
               d.recon_filled_at, d.recon_error,
               (d.figures->'sales'->>'total')::int AS total,
               (d.figures->>'takings')::int AS takings,
               (d.figures->>'cash_expected')::int AS cash_expected,
               (SELECT count(*)::int FROM pos_checks c WHERE c.day_id = d.id AND c.tenant_id = ${req.tenantId}) AS checks
          FROM pos_days d
         WHERE d.tenant_id = ${req.tenantId} AND d.venue_id = ${venueId}
         ORDER BY d.opened_at DESC
         LIMIT ${limit}`
    })
  })

  app.get('/venues/:venueId/days/:dayId', { preHandler: canReports }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    const dayId = UUID.parse(req.params.dayId)
    return withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      const day = await dayReport(tx, req.tenantId, venueId, dayId)
      // A kiosk's orders name the kiosk as their server (shared/kiosk.js kioskStaff()).
      const [staff, kiosks, streams, types, rates] = await Promise.all([
        tx`SELECT id, name FROM cash_staff WHERE tenant_id = ${req.tenantId} AND venue_id = ${venueId}`,
        tx`SELECT id, name FROM pos_devices WHERE tenant_id = ${req.tenantId} AND venue_id = ${venueId} AND kind = 'kiosk'`,
        tx`SELECT id, name FROM pos_revenue_streams WHERE tenant_id = ${req.tenantId} AND venue_id = ${venueId}`,
        tx`SELECT id, name FROM order_types WHERE tenant_id = ${req.tenantId}`,
        tx`SELECT id, name FROM tax_rates WHERE tenant_id = ${req.tenantId}`,
      ])
      const names = rows => Object.fromEntries(rows.map(r => [r.id, r.name]))
      return {
        ...day,
        names: { staff: names([...kiosks, ...staff]), revenue_streams: names(streams), order_types: names(types), tax_rates: names(rates) },
      }
    })
  })

  app.post('/venues/:venueId/days/:dayId/fill-recon', { preHandler: canReportsManage }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    const dayId = UUID.parse(req.params.dayId)
    if ((await permissionLevel(req, 'cash_recon')) !== 'manage') throw httpError(403, 'Filling Cash Recon needs Cash reconciliation manage')
    await withTenant(req.tenantId, tx => ownVenue(tx, req.tenantId, venueId))
    return fillReconFromDay(req.tenantId, venueId, dayId, by(req))
  })

  app.get('/venues/:venueId/checks', { preHandler: canReports }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    const q = z.object({
      day_id: UUID.optional(),
      status: z.enum(['open', 'closed', 'void', 'merged']).optional(),
      limit:  z.coerce.number().int().min(1).max(500).default(200),
    }).parse(req.query)
    return withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      return tx`
        SELECT c.id, c.number, c.order_no, c.mode, c.table_id, t.label AS table_label, c.tab_name, c.covers,
               c.server_id, COALESCE(s.name, k.name) AS server_name, c.revenue_stream_id, c.order_type_id, o.name AS order_type_name, c.tent, c.status, c.opened_at, c.closed_at,
               c.subtotal, c.discount, c.service_charge, c.total, c.paid, c.tips, c.refunded, c.day_id
          FROM pos_checks c
          LEFT JOIN tables t ON t.id = c.table_id AND t.tenant_id = c.tenant_id
          LEFT JOIN cash_staff s ON s.id = c.server_id AND s.tenant_id = c.tenant_id
          LEFT JOIN pos_devices k ON k.id = c.server_id AND k.tenant_id = c.tenant_id AND k.kind = 'kiosk'
          LEFT JOIN order_types o ON o.id = c.order_type_id AND o.tenant_id = c.tenant_id
         WHERE c.tenant_id = ${req.tenantId} AND c.venue_id = ${venueId}
           ${q.day_id ? tx`AND c.day_id = ${q.day_id}` : tx``}
           ${q.status ? tx`AND c.status = ${q.status}` : tx``}
         ORDER BY c.opened_at DESC NULLS LAST
         LIMIT ${q.limit}`
    })
  })

  app.get('/checks/:id', { preHandler: canReports }, async req => {
    const id = z.string().regex(/^[0-9A-Z]{26}$/).parse(req.params.id)
    return withTenant(req.tenantId, async tx => {
      const [c] = await tx`SELECT id, venue_id, state, total, status FROM pos_checks WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      if (!c) throw httpError(404, 'Check not found')
      const events = await tx`
        SELECT e.id, e.seq, e.type, e.payload, e.assigned, e.client_at, e.created_at, e.device_id, e.staff_id, e.approved_by,
               COALESCE(s.name, k.name) AS staff_name, a.name AS approver_name
          FROM pos_events e
          LEFT JOIN cash_staff s ON s.id = e.staff_id AND s.tenant_id = e.tenant_id
          LEFT JOIN pos_devices k ON k.id = e.staff_id AND k.tenant_id = e.tenant_id AND k.kind = 'kiosk'
          LEFT JOIN cash_staff a ON a.id = e.approved_by AND a.tenant_id = e.tenant_id
         WHERE e.tenant_id = ${req.tenantId}
           AND (e.check_id = ${id} OR e.payload->>'to_check_id' = ${id} OR e.payload->>'into_check_id' = ${id})
         ORDER BY e.seq`
      const [streams, types] = await Promise.all([
        tx`SELECT id, name FROM pos_revenue_streams WHERE tenant_id = ${req.tenantId} AND venue_id = ${c.venue_id}`,
        tx`SELECT id, name FROM order_types WHERE tenant_id = ${req.tenantId}`,
      ])
      const names = rows => Object.fromEntries(rows.map(r => [r.id, r.name]))
      return {
        check: c.state,
        events: events.map(e => ({ ...e, seq: Number(e.seq) })),
        names: { revenue_streams: names(streams), order_types: names(types) },
      }
    })
  })

  app.get('/venues/:venueId/conflicts', { preHandler: canReports }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    const open = req.query.all !== '1'
    return withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      return tx`
        SELECT r.id, r.check_id, r.device_id, r.staff_id, COALESCE(s.name, k.name) AS staff_name, r.type, r.payload, r.client_at,
               r.error, r.code, r.created_at, r.resolved_at, r.resolved_by, r.resolution,
               c.number AS check_number, c.status AS check_status
          FROM pos_event_rejections r
          LEFT JOIN cash_staff s ON s.id = r.staff_id AND s.tenant_id = r.tenant_id
          LEFT JOIN pos_devices k ON k.id = r.staff_id AND k.tenant_id = r.tenant_id AND k.kind = 'kiosk'
          LEFT JOIN pos_checks c ON c.id = r.check_id AND c.tenant_id = r.tenant_id
         WHERE r.tenant_id = ${req.tenantId} AND r.venue_id = ${venueId}
           AND r.type NOT LIKE 'kitchen.%'
           ${open ? tx`AND r.resolved_at IS NULL` : tx``}
         ORDER BY r.created_at DESC
         LIMIT 300`
    })
  })

  app.patch('/conflicts/:id', { preHandler: canReportsManage }, async req => {
    const id = z.string().max(40).parse(req.params.id)
    const body = z.object({ resolution: z.string().trim().min(1).max(300) }).parse(req.body)
    return withTenant(req.tenantId, async tx => {
      const [row] = await tx`
        UPDATE pos_event_rejections SET resolved_at = now(), resolved_by = ${by(req)}, resolution = ${body.resolution}
         WHERE id = ${id} AND tenant_id = ${req.tenantId} RETURNING id, resolved_at, resolution`
      if (!row) throw httpError(404, 'Not found')
      return row
    })
  })

  app.get('/venues/:venueId/print-jobs', { preHandler: canReports }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    return withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      return tx`
        SELECT j.id, j.printer_id, p.name AS printer_name, j.kind, j.title, j.status, j.attempts, j.error, j.created_at, j.printed_at, j.check_id, j.ops
          FROM pos_print_jobs j
          LEFT JOIN pos_printers p ON p.id = j.printer_id AND p.tenant_id = j.tenant_id
         WHERE j.tenant_id = ${req.tenantId} AND j.venue_id = ${venueId}
         ORDER BY j.created_at DESC
         LIMIT 200`
    })
  })

  // A ticket that didn't print (printer off, out of paper): queue it again
  // for whoever prints for that printer now.
  app.post('/print-jobs/:id/again', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    const row = await withTenant(req.tenantId, async tx => {
      const [j] = await tx`
        UPDATE pos_print_jobs SET status = 'queued', error = NULL, claimed_by = NULL, claimed_at = NULL
         WHERE id = ${id} AND tenant_id = ${req.tenantId} AND status IN ('failed', 'cancelled')
         RETURNING id, venue_id, status`
      if (!j) {
        const [any] = await tx`SELECT id FROM pos_print_jobs WHERE id = ${id} AND tenant_id = ${req.tenantId}`
        throw any ? httpError(422, 'That ticket is printing or has printed') : httpError(404, 'Print job not found')
      }
      return j
    })
    broadcast('pos:' + row.venue_id, { type: 'pos.print' })
    return { id: row.id, status: row.status }
  })
}

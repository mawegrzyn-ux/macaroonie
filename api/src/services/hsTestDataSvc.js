// src/services/hsTestDataSvc.js
//
// Test data tool for Health & Safety: fills a past date range for one venue
// with believable records, so dashboards, tiles and reports can be tried
// against history. Everything it creates is flagged is_generated
// (migration 139) and `clearGenerated()` removes only those rows.
//
// What it makes, per date (closed days skipped unless asked otherwise):
//   temps      — one fridge/freezer reading per equipment per check time
//   holds      — one hold reading per station per hold check time
//   cooking    — each cooking session's required number of checks, dishes
//                picked at random from the venue's published menus
//   orders     — past order sheets from templates with delivery days set
//                (status placed, random quantities around the suggested ones)
//   deliveries — one delivery check per placed order sheet delivered that
//                day: supplier = template name, items = the order's lines,
//                product temperature by item category (chilled / frozen)
//   checklists — past daily / weekly / monthly checklists (audits included)
//                marked complete with every task ticked
//
// Readings land inside each unit's limits (a margin away from the edge).
// `issue_pct` turns that share of readings into out-of-range ones with a
// corrective action, as a real log would have. Slots that already hold a
// reading are left alone, so running it twice doesn't double anything.
// Runs inside the caller's withTenant() transaction; dry_run returns the
// counts without writing.

import { randomUUID } from 'node:crypto'
import { periodStartFor } from '../utils/checklistPeriod.js'
import { openDatesOrNull } from './openDays.js'
import { zonedToUtc } from './orderSvc.js'

export const HS_KINDS = ['temps', 'holds', 'cooking', 'orders', 'deliveries', 'checklists']

// Same fallbacks the Food safety page offers when a unit has no limits.
const DEFAULT_TEMPS = {
  fridge:    { min: -2,   max: 8 },
  freezer:   { min: -30,  max: -15 },
  hot_hold:  { min: 63,   max: null },
  cold_hold: { min: -2,   max: 8 },
  other:     { min: null, max: null },
}

// Delivery acceptance (SFBB): chilled at or below 8°C, frozen at or below -15°C.
const CHILLED_MAX = 8
const FROZEN_MAX  = -15
const CHILLED_RE  = /meat|poultry|fish|seafood|dairy|egg|chill|fresh/i
const FROZEN_RE   = /frozen|freezer|ice cream/i

const COOK_MIN = 75

const FIXES = {
  cold: [
    'Door left ajar, closed and rechecked after 30 min: back in range',
    'Just restocked, rechecked after 30 min: back in range',
    'Defrost cycle, rechecked after 20 min: back in range',
  ],
  hot: [
    'Food reheated to 75°C and returned to hold',
    'Temperature turned up, food rechecked after 15 min: back in range',
  ],
  cook: [
    'Returned to cook, rechecked: above 75°C',
    'Cooked for a further 2 min, rechecked: above 75°C',
  ],
  delivery: [
    'Chilled items over temperature, rejected and credit requested',
    'Frozen items softening, rejected and credit requested',
  ],
}

const DAY_MS = 86_400_000

// ── Small helpers ───────────────────────────────────────────

const rand    = (lo, hi) => lo + Math.random() * (hi - lo)
const randInt = (lo, hi) => Math.floor(rand(lo, hi + 1))
const pick    = arr => arr[Math.floor(Math.random() * arr.length)]
const round1  = n => Math.round(n * 10) / 10
const num     = v => (v == null ? null : Number(v))
const hhmm    = t => (t ? String(t).slice(0, 5) : null)

function shuffled(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function datesBetween(from, to) {
  const out = []
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

function addDays(dateStr, n) {
  return new Date(Date.parse(dateStr + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10)
}

/** A UTC instant for a venue-local date + HH:MM, moved by `jitterMins`. */
function at(dateStr, time, tz, jitterMins = 0) {
  return new Date(zonedToUtc(dateStr, time, tz).getTime() + Math.round(jitterMins) * 60_000)
}

function withinRange(temp, min, max) {
  if (min != null && temp < min) return false
  if (max != null && temp > max) return false
  return true
}

/**
 * A reading for a unit with limits [min, max]: inside them, kept 1.5°C off
 * the limit that matters (the top for cold units, the bottom for hot ones),
 * or, when `issue` is set, 0.5-3°C past it.
 */
function reading({ min, max, hot, issue }) {
  if (hot) {
    const lo = (min ?? 63)
    if (issue) return round1(lo - rand(0.5, 3))
    const a = lo + 1.5
    return round1(rand(a, max != null ? Math.min(max - 1, a + 12) : a + 12))
  }
  if (max != null) {
    if (issue) return round1(max + rand(0.5, 3))
    const b = max - 1.5
    const a = min != null ? Math.max(min + 0.5, b - 5) : b - 5
    return round1(rand(Math.min(a, b), b))
  }
  if (min != null) return round1(issue ? min - rand(0.5, 3) : rand(min + 1.5, min + 6))
  return round1(rand(18, 22))
}

// ── Main ────────────────────────────────────────────────────

/**
 * Generates (or, with dryRun, counts) H&S records for one venue.
 * opts: { dateFrom, dateTo, kinds: string[], issuePct, skipClosed,
 *         checklistTemplateIds: string[] | null, fallbackRecorder, dryRun }
 */
export async function generateHsData(tx, tenantId, venueId, opts) {
  const kinds = new Set(opts.kinds)
  const issueRate = Math.max(0, Math.min(30, opts.issuePct ?? 0)) / 100
  const issue = () => Math.random() < issueRate
  const dates = datesBetween(opts.dateFrom, opts.dateTo)

  const [venue] = await tx`
    SELECT id, timezone FROM venues WHERE id = ${venueId} AND tenant_id = ${tenantId}
  `
  if (!venue) return null
  const tz = venue.timezone || 'UTC'

  // Days to fill: every day, or only the venue's open ones (an unscheduled
  // venue counts as open every day, same rule as everywhere else).
  let open = dates
  if (opts.skipClosed) {
    const openList = await openDatesOrNull(tx, tenantId, venueId, dates)
    if (openList) open = openList
  }
  const openSet = new Set(open)

  // Who recorded it: the venue's staff names, else the person running the tool.
  const staff = (await tx`
    SELECT name FROM cash_staff
     WHERE venue_id = ${venueId} AND tenant_id = ${tenantId} AND is_active = true
  `).map(s => s.name).filter(Boolean)
  const who = () => (staff.length ? pick(staff) : opts.fallbackRecorder ?? null)

  const out = {
    days_total: dates.length,
    days_filled: open.length,
    temps: 0, holds: 0, cooking: 0, orders: 0, deliveries: 0,
    checklists: 0, checklists_completed_existing: 0,
    out_of_range: 0,
    notes: [],
  }
  const rows = { temps: [], holds: [], cooking: [], orders: [], orderItems: [], deliveries: [], checklists: [], checklistItems: [] }

  // ── Fridge / freezer temps ──
  if (kinds.has('temps')) {
    const equipment = await tx`
      SELECT id, equipment_type, min_temp_c, max_temp_c FROM fs_equipment
       WHERE venue_id = ${venueId} AND tenant_id = ${tenantId} AND is_active = true
    `
    const times = await tx`
      SELECT id, time_of_day FROM fs_capture_times
       WHERE venue_id = ${venueId} AND tenant_id = ${tenantId} AND is_active = true
       ORDER BY time_of_day
    `
    const have = new Set((await tx`
      SELECT equipment_id, log_date::text AS d, capture_time_id FROM fs_temp_logs
       WHERE venue_id = ${venueId} AND tenant_id = ${tenantId}
         AND log_date BETWEEN ${opts.dateFrom}::date AND ${opts.dateTo}::date
    `).map(r => `${r.equipment_id}|${r.d}|${r.capture_time_id ?? ''}`))
    if (!equipment.length) out.notes.push('No fridges or freezers set up')
    // No check times set: one reading a day at 09:00, if the day has none.
    const slots = times.length ? times.map(t => ({ id: t.id, time: hhmm(t.time_of_day) })) : [{ id: null, time: '09:00' }]

    for (const d of open) {
      for (const eq of equipment) {
        const def = DEFAULT_TEMPS[eq.equipment_type] ?? DEFAULT_TEMPS.other
        const min = num(eq.min_temp_c), max = num(eq.max_temp_c)
        const hot = eq.equipment_type === 'hot_hold'
        for (const slot of slots) {
          if (have.has(`${eq.id}|${d}|${slot.id ?? ''}`)) continue
          if (!slot.id && [...have].some(k => k.startsWith(`${eq.id}|${d}|`))) continue
          const bad = issue()
          const t = reading({ min: min ?? def.min, max: max ?? def.max, hot, issue: bad })
          const ok = withinRange(t, min, max)
          if (!ok) out.out_of_range++
          rows.temps.push({
            tenant_id: tenantId, venue_id: venueId, equipment_id: eq.id, capture_time_id: slot.id,
            log_date: d, recorded_at: at(d, slot.time, tz, rand(-5, 15)),
            temperature_c: t, is_within_range: ok,
            corrective_action: ok ? null : pick(hot ? FIXES.hot : FIXES.cold),
            recorded_by: who(), is_generated: true,
          })
        }
      }
    }
    out.temps = rows.temps.length
  }

  // ── Hot / cold hold checks ──
  if (kinds.has('holds')) {
    const stations = await tx`
      SELECT id, hold_type, min_temp_c, max_temp_c FROM fs_hold_stations
       WHERE venue_id = ${venueId} AND tenant_id = ${tenantId} AND is_active = true
    `
    const times = await tx`
      SELECT id, time_of_day FROM fs_hold_capture_times
       WHERE venue_id = ${venueId} AND tenant_id = ${tenantId} AND is_active = true
       ORDER BY time_of_day
    `
    const have = new Set((await tx`
      SELECT station_id, check_date::text AS d, capture_time_id FROM fs_hold_checks
       WHERE venue_id = ${venueId} AND tenant_id = ${tenantId}
         AND check_date BETWEEN ${opts.dateFrom}::date AND ${opts.dateTo}::date
    `).map(r => `${r.station_id}|${r.d}|${r.capture_time_id ?? ''}`))
    if (!stations.length) out.notes.push('No hold stations set up')
    const slots = times.length ? times.map(t => ({ id: t.id, time: hhmm(t.time_of_day) })) : [{ id: null, time: '12:00' }]

    for (const d of open) {
      for (const st of stations) {
        const def = DEFAULT_TEMPS[st.hold_type]
        const min = num(st.min_temp_c), max = num(st.max_temp_c)
        const hot = st.hold_type === 'hot_hold'
        for (const slot of slots) {
          if (have.has(`${st.id}|${d}|${slot.id ?? ''}`)) continue
          if (!slot.id && [...have].some(k => k.startsWith(`${st.id}|${d}|`))) continue
          const bad = issue()
          const t = reading({ min: min ?? def.min, max: max ?? def.max, hot, issue: bad })
          const ok = withinRange(t, min, max)
          if (!ok) out.out_of_range++
          rows.holds.push({
            tenant_id: tenantId, venue_id: venueId, station_id: st.id, capture_time_id: slot.id,
            check_date: d, recorded_at: at(d, slot.time, tz, rand(-5, 15)),
            temperature_c: t, is_within_range: ok,
            corrective_action: ok ? null : pick(hot ? FIXES.hot : FIXES.cold),
            recorded_by: who(), is_generated: true,
          })
        }
      }
    }
    out.holds = rows.holds.length
  }

  // ── Cooking checks ──
  if (kinds.has('cooking')) {
    const sessions = await tx`
      SELECT id, time_of_day, required_items_count FROM fs_cooking_sessions
       WHERE venue_id = ${venueId} AND tenant_id = ${tenantId} AND is_active = true
       ORDER BY sort_order, time_of_day
    `
    // Same dish list the Food safety page's cooking picker shows.
    const dishes = await tx`
      SELECT i.id, i.name
        FROM menu_items i
        JOIN menu_sections s ON s.id = i.section_id
        JOIN menus m ON m.id = s.menu_id
       WHERE i.tenant_id = ${tenantId}
         AND m.tenant_id = ${tenantId}
         AND m.is_published = true
         AND (m.venue_id = ${venueId} OR m.venue_id IS NULL)
    `
    const existing = await tx`
      SELECT check_date::text AS d, session_id, count(*)::int AS n FROM fs_cooking_checks
       WHERE venue_id = ${venueId} AND tenant_id = ${tenantId}
         AND check_date BETWEEN ${opts.dateFrom}::date AND ${opts.dateTo}::date
       GROUP BY 1, 2
    `
    const haveCount = new Map(existing.map(r => [`${r.d}|${r.session_id ?? ''}`, r.n]))
    const dayHasAny = new Set(existing.map(r => r.d))

    if (!dishes.length) {
      out.notes.push('No dishes on a published menu, so no cooking checks')
    } else {
      // No sessions set up: two checks a day (lunch, dinner), if the day has none.
      const plan = sessions.length
        ? sessions.map(s => ({ id: s.id, time: hhmm(s.time_of_day) ?? '12:00', need: s.required_items_count }))
        : [{ id: null, time: '12:00', need: 1 }, { id: null, time: '18:00', need: 1 }]
      for (const d of open) {
        if (!sessions.length && dayHasAny.has(d)) continue
        for (const s of plan) {
          const have = sessions.length ? (haveCount.get(`${d}|${s.id}`) ?? 0) : 0
          if (have >= s.need) continue
          // A fresh session sometimes logs one more than required, as a busy shift would.
          const want = s.need - have + (have === 0 && Math.random() < 0.3 ? 1 : 0)
          let mins = rand(0, 20)
          for (const dish of shuffled(dishes).slice(0, want)) {
            const bad = issue()
            const t = bad ? round1(rand(68, COOK_MIN - 0.5)) : round1(rand(COOK_MIN + 1, 92))
            if (bad) out.out_of_range++
            rows.cooking.push({
              tenant_id: tenantId, venue_id: venueId, check_date: d,
              recorded_at: at(d, s.time, tz, mins),
              session_id: s.id, menu_item_id: dish.id, dish_name: dish.name,
              core_temp_c: t, is_within_range: !bad,
              corrective_action: bad ? pick(FIXES.cook) : null,
              recorded_by: who(), is_generated: true,
            })
            mins += rand(8, 30)
          }
        }
      }
    }
    out.cooking = rows.cooking.length
  }

  // ── Past order sheets (from templates with delivery days) ──
  // Deliveries below are matched to these as well as to real orders.
  const newOrders = []
  if (kinds.has('orders')) {
    const templates = await tx`
      SELECT t.id, t.name, t.delivery_days
        FROM order_sheet_templates t
        JOIN order_sheet_template_venues tv ON tv.template_id = t.id AND tv.venue_id = ${venueId}
       WHERE t.tenant_id = ${tenantId} AND t.is_active = true
         AND cardinality(t.delivery_days) > 0
    `
    const tplIds = templates.map(t => t.id)
    const items = tplIds.length ? await tx`
      SELECT i.id, i.template_id, i.name, i.unit, i.price, c.name AS category, q.qty AS suggested
        FROM order_sheet_items i
        JOIN order_sheet_templates t ON t.id = i.template_id AND t.tenant_id = ${tenantId}
        LEFT JOIN order_sheet_categories c ON c.id = i.category_id
        LEFT JOIN order_sheet_suggested_qty q ON q.item_id = i.id AND q.venue_id = ${venueId}
       WHERE i.template_id = ANY(${tplIds}::uuid[]) AND i.is_active = true
       ORDER BY i.sort_order
    ` : []
    const haveOrder = new Set((await tx`
      SELECT template_id, delivery_date::text AS d FROM order_sheets
       WHERE venue_id = ${venueId} AND tenant_id = ${tenantId}
         AND delivery_date BETWEEN ${opts.dateFrom}::date AND ${opts.dateTo}::date
    `).map(r => `${r.template_id}|${r.d}`))
    if (!templates.length) out.notes.push('No order sheet templates with delivery days for this venue')

    for (const d of open) {
      const dow = new Date(d + 'T12:00:00Z').getUTCDay()
      for (const t of templates) {
        if (!t.delivery_days.includes(dow) || haveOrder.has(`${t.id}|${d}`)) continue
        const tItems = items.filter(i => i.template_id === t.id)
        if (!tItems.length) continue
        // Most of the sheet, not all of it: 60-85% of the lines.
        const chosen = shuffled(tItems).slice(0, Math.max(1, Math.round(tItems.length * rand(0.6, 0.85))))
        const id = randomUUID()
        const placedAt = at(addDays(d, -1), '14:00', tz, rand(0, 120))
        const lines = chosen.map(i => {
          const sug = num(i.suggested)
          const qty = sug && sug > 0
            ? Math.max(sug < 2 ? 0.5 : 1, Math.round(sug * rand(0.7, 1.3) * 2) / 2)
            : randInt(1, 6)
          return { order_id: id, item_id: i.id, qty, unit_price: i.price, _item: i }
        })
        newOrders.push({
          row: {
            id, tenant_id: tenantId, template_id: t.id, venue_id: venueId, delivery_date: d,
            status: 'placed', ready_at: new Date(placedAt.getTime() - randInt(10, 60) * 60_000),
            placed_at: placedAt, is_generated: true,
          },
          vendor: t.name, lines,
        })
      }
    }
    for (const o of newOrders) {
      rows.orders.push(o.row)
      for (const l of o.lines) rows.orderItems.push({ order_id: l.order_id, item_id: l.item_id, qty: l.qty, unit_price: l.unit_price })
    }
    out.orders = rows.orders.length
  }

  // ── Delivery checks, one per placed order delivered in the range ──
  if (kinds.has('deliveries')) {
    const orders = await tx`
      SELECT o.id, o.delivery_date::text AS d, t.name AS vendor
        FROM order_sheets o
        JOIN order_sheet_templates t ON t.id = o.template_id
       WHERE o.venue_id = ${venueId} AND o.tenant_id = ${tenantId}
         AND o.status = 'placed'
         AND o.delivery_date BETWEEN ${opts.dateFrom}::date AND ${opts.dateTo}::date
         AND NOT EXISTS (SELECT 1 FROM fs_delivery_checks c WHERE c.order_sheet_id = o.id)
    `
    const orderIds = orders.map(o => o.id)
    const lines = orderIds.length ? await tx`
      SELECT oi.order_id, oi.qty, i.name, i.unit, c.name AS category
        FROM order_sheet_order_items oi
        JOIN order_sheet_items i ON i.id = oi.item_id
        LEFT JOIN order_sheet_categories c ON c.id = i.category_id
       WHERE oi.order_id = ANY(${orderIds}::uuid[]) AND oi.qty > 0
       ORDER BY i.sort_order
    ` : []
    // A check typed in by hand for the same supplier and day counts as done.
    const haveVendorDay = new Set((await tx`
      SELECT lower(vendor_name) AS v, delivery_date::text AS d FROM fs_delivery_checks
       WHERE venue_id = ${venueId} AND tenant_id = ${tenantId}
         AND delivery_date BETWEEN ${opts.dateFrom}::date AND ${opts.dateTo}::date
    `).map(r => `${r.v}|${r.d}`))

    const all = [
      ...orders.map(o => ({
        id: o.id, d: o.d, vendor: o.vendor,
        lines: lines.filter(l => l.order_id === o.id).map(l => ({ name: l.name, unit: l.unit, qty: num(l.qty), category: l.category })),
      })),
      ...newOrders.map(o => ({
        id: o.row.id, d: o.row.delivery_date, vendor: o.vendor,
        lines: o.lines.map(l => ({ name: l._item.name, unit: l._item.unit, qty: l.qty, category: l._item.category })),
      })),
    ]
    if (!all.length) out.notes.push('No placed order sheets left without a delivery check in this range')

    for (const o of all) {
      if (!o.lines.length || haveVendorDay.has(`${o.vendor.toLowerCase()}|${o.d}`)) continue
      const bad = issue()
      let anyChilled = false, anyFrozen = false
      const items = o.lines.map(l => {
        const text = `${l.category ?? ''} ${l.name}`
        const frozen  = FROZEN_RE.test(text)
        const chilled = !frozen && CHILLED_RE.test(text)
        anyFrozen  ||= frozen
        anyChilled ||= chilled
        const temp_c = frozen ? round1(rand(-22, FROZEN_MAX - 3)) : chilled ? round1(rand(1, 5)) : null
        return { name: l.name, qty: l.qty, unit: l.unit, category: l.category ?? null, ...(temp_c != null ? { temp_c } : {}) }
      })
      // The probe reading on the form: the chilled goods if any, else frozen.
      let productTemp = anyChilled ? round1(rand(1, 5)) : anyFrozen ? round1(rand(-22, FROZEN_MAX - 3)) : null
      const tempIssue = bad && productTemp != null
      if (tempIssue) {
        productTemp = anyChilled ? round1(rand(CHILLED_MAX + 0.5, CHILLED_MAX + 4)) : round1(rand(FROZEN_MAX + 1, FROZEN_MAX + 6))
        out.out_of_range++
      }
      rows.deliveries.push({
        tenant_id: tenantId, venue_id: venueId, delivery_date: o.d,
        recorded_at: at(o.d, '07:00', tz, rand(0, 240)),
        vendor_name: o.vendor,
        packaging_ok: true, damage_ok: true, quality_ok: true,
        temp_ok: !tempIssue,
        product_temp_c: productTemp,
        items: tx.json(items),
        accepted: !tempIssue,
        corrective_action: tempIssue ? (anyChilled ? FIXES.delivery[0] : FIXES.delivery[1]) : null,
        notes: `${items.length} line${items.length === 1 ? '' : 's'} checked against the order sheet`,
        recorded_by: who(), order_sheet_id: o.id, is_generated: true,
      })
    }
    out.deliveries = rows.deliveries.length
  }

  // ── Checklists and audits: complete, every task ticked ──
  if (kinds.has('checklists')) {
    const templates = (await tx`
      SELECT id, frequency, name FROM checklist_templates
       WHERE venue_id = ${venueId} AND tenant_id = ${tenantId} AND is_active = true
    `).filter(t => !opts.checklistTemplateIds || opts.checklistTemplateIds.includes(t.id))
    const tIds = templates.map(t => t.id)
    const items = tIds.length ? await tx`
      SELECT id, template_id FROM checklist_template_items
       WHERE template_id = ANY(${tIds}::uuid[]) AND tenant_id = ${tenantId} AND is_active = true
    ` : []
    const instances = tIds.length ? await tx`
      SELECT id, template_id, period_start::text AS p, status FROM checklist_instances
       WHERE template_id = ANY(${tIds}::uuid[]) AND tenant_id = ${tenantId}
    ` : []
    const instByKey = new Map(instances.map(i => [`${i.template_id}|${i.p}`, i]))
    if (!templates.length) out.notes.push('No checklists for this venue')

    const toComplete = []
    for (const t of templates) {
      const tItems = items.filter(i => i.template_id === t.id)
      // The periods the range touches, each with the last date of it in the
      // range (when the checklist is signed off). Daily ones skip closed days.
      const periods = new Map()
      for (const d of dates) {
        if (t.frequency === 'daily' && !openSet.has(d)) continue
        periods.set(periodStartFor(t.frequency, d), d)
      }
      for (const [p, lastDay] of periods) {
        const existing = instByKey.get(`${t.id}|${p}`)
        if (existing?.status === 'completed') continue
        const completedAt = at(lastDay, '10:00', tz, rand(0, 11 * 60))
        if (existing) {
          toComplete.push({ id: existing.id, completedAt, items: tItems })
          continue
        }
        const id = randomUUID()
        rows.checklists.push({
          id, tenant_id: tenantId, venue_id: venueId, template_id: t.id, period_start: p,
          status: 'completed', completed_by: who(), completed_at: completedAt, is_generated: true,
        })
        for (const it of tItems) {
          rows.checklistItems.push({ tenant_id: tenantId, instance_id: id, template_item_id: it.id, is_checked: true })
        }
      }
    }
    out.checklists = rows.checklists.length
    out.checklists_completed_existing = toComplete.length

    if (!opts.dryRun) {
      // A checklist someone had started: complete it and tick the rest. It
      // stays the operator's row (not is_generated), so clearing keeps it.
      for (const c of toComplete) {
        await tx`
          UPDATE checklist_instances
             SET status = 'completed', completed_by = ${who()}, completed_at = ${c.completedAt}, updated_at = now()
           WHERE id = ${c.id} AND tenant_id = ${tenantId}
        `
        if (c.items.length) {
          await tx`
            INSERT INTO checklist_instance_items ${tx(c.items.map(it => ({
              tenant_id: tenantId, instance_id: c.id, template_item_id: it.id, is_checked: true,
            })))}
            ON CONFLICT (instance_id, template_item_id) DO UPDATE SET is_checked = true
          `
        }
      }
    }
  }

  if (!opts.dryRun) {
    await insertAll(tx, 'fs_temp_logs', rows.temps)
    await insertAll(tx, 'fs_hold_checks', rows.holds)
    await insertAll(tx, 'fs_cooking_checks', rows.cooking)
    await insertAll(tx, 'order_sheets', rows.orders)
    await insertAll(tx, 'order_sheet_order_items', rows.orderItems)
    await insertAll(tx, 'fs_delivery_checks', rows.deliveries)
    await insertAll(tx, 'checklist_instances', rows.checklists)
    await insertAll(tx, 'checklist_instance_items', rows.checklistItems)
  }

  return out
}

async function insertAll(tx, table, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    await tx`INSERT INTO ${tx(table)} ${tx(rows.slice(i, i + 500))}`
  }
}

/**
 * Deletes the generated rows (is_generated) of the given kinds whose date
 * falls in the range, or counts them with dryRun. Never touches a record
 * someone entered.
 */
export async function clearGenerated(tx, tenantId, venueId, { dateFrom, dateTo, kinds, dryRun }) {
  const k = new Set(kinds)
  const where = col => tx`
    venue_id = ${venueId} AND tenant_id = ${tenantId} AND is_generated = true
    AND ${tx(col)} BETWEEN ${dateFrom}::date AND ${dateTo}::date`
  const targets = [
    ['temps',      'fs_temp_logs',        'log_date'],
    ['holds',      'fs_hold_checks',      'check_date'],
    ['cooking',    'fs_cooking_checks',   'check_date'],
    ['deliveries', 'fs_delivery_checks',  'delivery_date'],
    ['orders',     'order_sheets',        'delivery_date'],
    ['checklists', 'checklist_instances', 'period_start'],
  ]
  const out = {}
  for (const [kind, table, col] of targets) {
    if (!k.has(kind)) continue
    if (dryRun) {
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM ${tx(table)} WHERE ${where(col)}`
      out[kind] = n
    } else {
      // A generated order with a real (not generated) delivery check keeps
      // the check; the link goes (ON DELETE SET NULL).
      const res = await tx`DELETE FROM ${tx(table)} WHERE ${where(col)}`
      out[kind] = res.count
    }
  }
  return out
}

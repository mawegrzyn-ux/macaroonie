// src/services/hsStatus.js
//
// Combined Checklists + Food safety status per venue per day. One
// implementation for the Overview page's hs_today_status / hs_week_status
// tiles (GET /api/dashboard-tiles/hs-status) and the staff AI assistant's
// H&S tools (src/ai/tools/hs.js), so both always agree on what is done,
// missing or unresolved on a day.

import { periodStartFor, mondayOf, monthStartOf } from '../utils/checklistPeriod.js'
import { hsClosedDates, hsFollowsOpeningDays } from './openDays.js'

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function dateRange(from, to) {
  const dates = []
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d)
  return dates
}

// A colour from what is due, done and unresolved (the Overview tiles; reports too).
export function deriveStatus(expected, completed, unresolved) {
  if (unresolved > 0) return 'red'
  if (expected === 0) return 'grey'
  if (completed >= expected) return 'green'
  if (completed > 0) return 'amber'
  return 'red'
}

// Combined Checklists + Food safety status per venue per day, for the
// hs_today_status / hs_week_status tiles. "Expected" is standing
// configuration (active checklist templates, equipment x capture times,
// hold stations x capture times, cooking sessions' required counts) —
// it doesn't vary by date, so future dates always compute a real
// expected/completed pair; the caller overrides status to 'upcoming' for
// any date after `today`.
//
// When the tenant follows opening days (tenants.hs_follow_opening_days), a
// venue's closed days (services/openDays.js) expect no daily checklists and
// no fridge / hold / cooking checks; weekly and monthly checklists and any
// out-of-range reading still count. A venue-day left with nothing expected
// and nothing unresolved gets status 'closed' (future days included).
//
// `venueIds` (optional) limits it to those venues (reports ask for some).
export async function computeHsStatus(tx, tenantId, from, to, today, { venueIds = null } = {}) {
  const venues = await tx`
    SELECT id, name FROM venues
     WHERE tenant_id = ${tenantId} AND is_active = true
       ${venueIds ? tx`AND id = ANY(${venueIds}::uuid[])` : tx``}
     ORDER BY name`
  // Rows of the venues asked for only (reports name some; the tiles want them all).
  const ids = venues.map(v => v.id)
  const atVenues = () => tx`AND venue_id = ANY(${ids}::uuid[])`
  const dates = dateRange(from, to)
  const follows = await hsFollowsOpeningDays(tx, tenantId)
  const closedByVenue = new Map()
  for (const v of venues) closedByVenue.set(v.id, await hsClosedDates(tx, tenantId, v.id, dates, follows))

  const templates = await tx`
    SELECT id, venue_id, name, frequency FROM checklist_templates
     WHERE tenant_id = ${tenantId} AND is_active = true
       ${atVenues()}
  `
  const minPeriodStart = [mondayOf(from), monthStartOf(from), from].sort()[0]
  const instances = await tx`
    SELECT template_id, period_start::text AS period_start, status FROM checklist_instances
     WHERE tenant_id = ${tenantId} AND period_start >= ${minPeriodStart} AND period_start <= ${to}
       ${atVenues()}
  `
  const instanceMap = new Map(instances.map(i => [`${i.template_id}|${i.period_start}`, i.status]))

  const equipment    = await tx`SELECT id, venue_id FROM fs_equipment WHERE tenant_id = ${tenantId} AND is_active = true ${atVenues()}`
  const captureTimes = await tx`SELECT id, venue_id FROM fs_capture_times WHERE tenant_id = ${tenantId} AND is_active = true ${atVenues()}`
  const tempLogs      = await tx`
    SELECT venue_id, log_date::text AS log_date, equipment_id, capture_time_id, is_within_range, corrective_action
      FROM fs_temp_logs WHERE tenant_id = ${tenantId} AND log_date BETWEEN ${from} AND ${to} ${atVenues()}
  `

  const holdStations     = await tx`SELECT id, venue_id FROM fs_hold_stations WHERE tenant_id = ${tenantId} AND is_active = true ${atVenues()}`
  const holdCaptureTimes = await tx`SELECT id, venue_id FROM fs_hold_capture_times WHERE tenant_id = ${tenantId} AND is_active = true ${atVenues()}`
  const holdChecks        = await tx`
    SELECT venue_id, check_date::text AS check_date, station_id, capture_time_id, is_within_range, corrective_action
      FROM fs_hold_checks WHERE tenant_id = ${tenantId} AND check_date BETWEEN ${from} AND ${to} ${atVenues()}
  `

  const cookingSessions = await tx`SELECT id, venue_id, required_items_count FROM fs_cooking_sessions WHERE tenant_id = ${tenantId} AND is_active = true ${atVenues()}`
  const cookingChecks    = await tx`
    SELECT venue_id, check_date::text AS check_date, session_id, is_within_range, corrective_action
      FROM fs_cooking_checks WHERE tenant_id = ${tenantId} AND check_date BETWEEN ${from} AND ${to} ${atVenues()}
  `

  const deliveryChecks = await tx`
    SELECT venue_id, delivery_date::text AS delivery_date,
           (packaging_ok AND damage_ok AND quality_ok AND temp_ok AND accepted) AS passed,
           corrective_action
      FROM fs_delivery_checks WHERE tenant_id = ${tenantId} AND delivery_date BETWEEN ${from} AND ${to} ${atVenues()}
  `

  const byVenue = (rows) => {
    const m = new Map()
    for (const r of rows) {
      if (!m.has(r.venue_id)) m.set(r.venue_id, [])
      m.get(r.venue_id).push(r)
    }
    return m
  }
  // A day's readings by venue and day, looked up per venue-day (filtering the
  // whole range for each one made long ranges slow).
  const byVenueDay = (rows, col) => {
    const m = new Map()
    for (const r of rows) {
      const k = r.venue_id + '|' + r[col]
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(r)
    }
    return m
  }
  const tempLogsByDay      = byVenueDay(tempLogs, 'log_date')
  const holdChecksByDay    = byVenueDay(holdChecks, 'check_date')
  const cookingChecksByDay = byVenueDay(cookingChecks, 'check_date')
  const deliveriesByDay    = byVenueDay(deliveryChecks, 'delivery_date')
  const templatesByVenue    = byVenue(templates)
  const equipmentByVenue    = byVenue(equipment)
  const captureTimesByVenue = byVenue(captureTimes)
  const holdStationsByVenue = byVenue(holdStations)
  const holdCaptureByVenue  = byVenue(holdCaptureTimes)
  const sessionsByVenue     = byVenue(cookingSessions)
  const idSets = byV => new Map(venues.map(v => [v.id, new Set((byV.get(v.id) ?? []).map(r => r.id))]))
  const equipIds       = idSets(equipmentByVenue)
  const captureIds     = idSets(captureTimesByVenue)
  const stationIds     = idSets(holdStationsByVenue)
  const holdCaptureIds = idSets(holdCaptureByVenue)

  const days = dates.map(date => {
    const isUpcoming = date > today
    const venueResults = venues.map(v => {
      const closed = closedByVenue.get(v.id).has(date)
      const vTemplates = templatesByVenue.get(v.id) ?? []
      const checklistBreakdown = vTemplates.map(t => ({
        id: t.id,
        name: t.name,
        frequency: t.frequency,
        completed: instanceMap.get(`${t.id}|${periodStartFor(t.frequency, date)}`) === 'completed',
        not_required: closed && t.frequency === 'daily',
      }))
      const required = checklistBreakdown.filter(c => !c.not_required)
      const checklistExpected = required.length
      const checklistCompleted = required.filter(c => c.completed).length

      const vEquip = equipmentByVenue.get(v.id) ?? []
      const vCaptures = captureTimesByVenue.get(v.id) ?? []
      const equipExpected = closed ? 0 : vEquip.length * vCaptures.length
      const dayTempLogs = tempLogsByDay.get(v.id + '|' + date) ?? []
      // A check done is a reading of a fridge set up now at a check time set
      // up now: one of a fridge or check time taken out since doesn't count
      // (it made past days look done, or more than done, when a fridge was removed).
      const equipCompleted = closed ? 0 : new Set(
        dayTempLogs.filter(l => l.capture_time_id && equipIds.get(v.id).has(l.equipment_id) && captureIds.get(v.id).has(l.capture_time_id))
          .map(l => `${l.equipment_id}|${l.capture_time_id}`)
      ).size
      const equipUnresolved = dayTempLogs.filter(l => l.is_within_range === false && !l.corrective_action).length

      const vStations = holdStationsByVenue.get(v.id) ?? []
      const vHoldCaptures = holdCaptureByVenue.get(v.id) ?? []
      const holdExpected = closed ? 0 : vStations.length * vHoldCaptures.length
      const dayHoldChecks = holdChecksByDay.get(v.id + '|' + date) ?? []
      const holdCompleted = closed ? 0 : new Set(
        dayHoldChecks.filter(h => h.capture_time_id && stationIds.get(v.id).has(h.station_id) && holdCaptureIds.get(v.id).has(h.capture_time_id))
          .map(h => `${h.station_id}|${h.capture_time_id}`)
      ).size
      const holdUnresolved = dayHoldChecks.filter(h => h.is_within_range === false && !h.corrective_action).length

      const vSessions = sessionsByVenue.get(v.id) ?? []
      const cookingExpected = closed ? 0 : vSessions.reduce((s, sess) => s + sess.required_items_count, 0)
      const dayCookingChecks = cookingChecksByDay.get(v.id + '|' + date) ?? []
      const cookingCompleted = closed ? 0 : vSessions.reduce((sum, sess) => {
        const count = dayCookingChecks.filter(c => c.session_id === sess.id).length
        return sum + Math.min(count, sess.required_items_count)
      }, 0)
      const cookingUnresolved = dayCookingChecks.filter(c => c.is_within_range === false && !c.corrective_action).length

      // Deliveries aren't scheduled, so there's no "expected" count — they
      // only ever raise the day's status (a failed check with no corrective
      // action is unresolved), never count toward expected/completed.
      const dayDeliveries = deliveriesByDay.get(v.id + '|' + date) ?? []
      const deliveryUnresolved = dayDeliveries.filter(d => !d.passed && !d.corrective_action).length

      const expected  = checklistExpected + equipExpected + holdExpected + cookingExpected
      const completed = checklistCompleted + equipCompleted + holdCompleted + cookingCompleted
      const unresolved = equipUnresolved + holdUnresolved + cookingUnresolved + deliveryUnresolved
      const status = closed && expected === 0 && unresolved === 0 ? 'closed'
        : isUpcoming ? 'upcoming' : deriveStatus(expected, completed, unresolved)

      // Per-check-type breakdown for the hs_today_status tile's expanded
      // view — checklists individually (they only have a done/not-done
      // state, no "unresolved" concept), the other three check types as
      // one aggregate line each (their own individual readings are too
      // granular for a small tile — see Equipment/Holds/Cooking pages for
      // that level of detail).
      const categories = [
        (equipExpected > 0 || equipUnresolved > 0) && {
          key: 'equipment', label: 'Fridge/freezer checks',
          expected: equipExpected, completed: equipCompleted, unresolved: equipUnresolved,
          status: isUpcoming ? 'upcoming' : deriveStatus(equipExpected, equipCompleted, equipUnresolved),
        },
        (holdExpected > 0 || holdUnresolved > 0) && {
          key: 'hold', label: 'Hot/cold hold checks',
          expected: holdExpected, completed: holdCompleted, unresolved: holdUnresolved,
          status: isUpcoming ? 'upcoming' : deriveStatus(holdExpected, holdCompleted, holdUnresolved),
        },
        (cookingExpected > 0 || cookingUnresolved > 0) && {
          key: 'cooking', label: 'Cooking checks',
          expected: cookingExpected, completed: cookingCompleted, unresolved: cookingUnresolved,
          status: isUpcoming ? 'upcoming' : deriveStatus(cookingExpected, cookingCompleted, cookingUnresolved),
        },
        dayDeliveries.length > 0 && {
          key: 'delivery', label: 'Delivery checks',
          expected: dayDeliveries.length, completed: dayDeliveries.length, unresolved: deliveryUnresolved,
          summary: `${dayDeliveries.length} logged${deliveryUnresolved ? ` · ${deliveryUnresolved} issue${deliveryUnresolved > 1 ? 's' : ''}` : ''}`,
          status: isUpcoming ? 'upcoming' : (deliveryUnresolved > 0 ? 'red' : 'green'),
        },
      ].filter(Boolean)

      return {
        venue_id: v.id, venue_name: v.name, status, closed, expected, completed, unresolved,
        checklists: checklistBreakdown, categories,
      }
    })

    const expected   = venueResults.reduce((s, v) => s + v.expected, 0)
    const completed  = venueResults.reduce((s, v) => s + v.completed, 0)
    const unresolved = venueResults.reduce((s, v) => s + v.unresolved, 0)
    const closed = venueResults.some(v => v.closed)
    const status = closed && expected === 0 && unresolved === 0 ? 'closed'
      : isUpcoming ? 'upcoming' : deriveStatus(expected, completed, unresolved)

    return { date, status, closed, expected, completed, unresolved, venues: venueResults }
  })

  return { venues, days }
}

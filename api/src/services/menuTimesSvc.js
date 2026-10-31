// src/services/menuTimesSvc.js
//
// Menu times (migration 230, shared/menuTimes.js): reading a venue's rows
// for the channels that use them.
//
//   loadMenuTimes(tx, tenantId, venueId)        { menuId: row } (tidied, stored rows only)
//   channelMenuTimes(tx, tenantId, venueId, ch) { menuId: times | false } for 'till' / 'kiosk' / 'web'
//   webSchedules(tx, venueId)                   { menuId: schedule } of the menus online ordering
//                                               gives times to (services/orderSvc.js loadSettings())
//
// Online ordering's on / off is ordering_settings.menu_ids; a stored web
// cell only says when.

import { cleanRow, channelTimes } from '../../../shared/menuTimes.js'

/** A venue's stored rows, tidied, by menu id. */
export async function loadMenuTimes(tx, tenantId, venueId) {
  const rows = await tx`
    SELECT menu_id, times, web, kiosk, till, updated_at, updated_by FROM menu_times
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`
  return Object.fromEntries(rows.map(r => [r.menu_id, { ...cleanRow(r), updated_at: r.updated_at, updated_by: r.updated_by }]))
}

/**
 * The times each menu follows on a channel at this venue: a schedule, null
 * for any time, false when the menu is off there. Menus with no row are any
 * time (left out of the map: read it with `?? null`).
 */
export async function channelMenuTimes(tx, tenantId, venueId, channel) {
  const rows = await loadMenuTimes(tx, tenantId, venueId)
  return Object.fromEntries(Object.entries(rows).map(([id, r]) => [id, channelTimes(r, channel)]))
}

/**
 * Online ordering's schedules: { menuId: schedule } for the menus whose web
 * cell gives them times (the menu's own, or the website's own). The venue's
 * tenant is read from the venue row, so the rows can't be another tenant's.
 */
export async function webSchedules(tx, venueId) {
  const rows = await tx`
    SELECT t.menu_id, t.times, t.web FROM menu_times t
      JOIN venues v ON v.id = t.venue_id AND v.tenant_id = t.tenant_id
     WHERE t.venue_id = ${venueId}`
  const out = {}
  for (const r of rows) {
    const times = channelTimes(cleanRow(r), 'web')
    if (times) out[r.menu_id] = times
  }
  return out
}

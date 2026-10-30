// The till's or kiosk's own numbers (shared/pos/numbers.js, migration 217):
// every check this device opens gets its next check number (T2-47) and, for
// a counter order, the next order number from the device's own range, here
// on the device, so it never waits for the server and never clashes with
// another device. Kept in localStorage per device; the server's copy (sync and
// config replies) is merged in, so a device that lost its storage carries on.

import { nextNumbers, mergeNumbers, cleanNumbers } from '@shared/pos/numbers.js'
import { businessDate } from '@shared/pos/reports.js'

const key = id => 'pos_numbers_' + id

export function loadNumbers(deviceId) {
  try { return cleanNumbers(JSON.parse(localStorage.getItem(key(deviceId)) || 'null')) } catch { return null }
}

function saveNumbers(deviceId, n) {
  try { localStorage.setItem(key(deviceId), JSON.stringify(n)) } catch { /* private mode: counts from the server's */ }
}

/** What the server saw from this device (a sync or config reply's numbers). */
export function keepServerNumbers(deviceId, server) {
  if (!deviceId || !server) return
  const merged = mergeNumbers(loadNumbers(deviceId), server)
  if (merged) saveNumbers(deviceId, merged)
}

/**
 * Numbers for a check this device opens now: { number, order_no?, number_code },
 * for the check.opened payload. counter: a counter order (gets an order number).
 * day: the open trading day's date as the server last said (the till's sync,
 * a kiosk's config), so a day not closed by the next morning keeps counting;
 * none known (closed, never heard): today's by this device's clock.
 */
export function takeNumbers(device, config, { counter = false, day = null } = {}) {
  const date = day || businessDate(new Date(), config?.venue?.timezone || 'Europe/London', config?.settings?.day_starts_at)
  const range = config?.device?.settings?.order_numbers || null
  const r = nextNumbers(loadNumbers(device.id), { date, counter, range })
  saveNumbers(device.id, r.numbers)
  return { number: r.number, ...(r.order_no != null ? { order_no: r.order_no } : {}), number_code: config?.device?.short_code || device.short_code || null }
}

// Taps on the till layout's buttons (OUTSTANDING 44.8, migration 266;
// shared/pos/tillTaps.js): each tap on a counted zone's button adds one to
// today's count for the person signed in, the layout, the zone and the
// button. Counts are kept on the till (localStorage, so a reload or an
// offline spell loses none) and sent every minute, and when the till is put
// away, to POST /pos-api/till-taps; what was sent comes off the queue. Only
// counts: nothing about the order, never the time of a tap.
import { TAP_ZONES, TAP_BATCH_MAX, tapCell, addTaps, takeTaps } from '@shared/pos/tillTaps.js'

const STORE_KEY = 'maca_till_taps'
const SEND_MS = 60_000
// A till that can't send for a long time keeps at most this many counts.
const QUEUE_MAX = 3000

let queue = load()
let saveTimer = null
let sending = false
let started = null

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {} } catch { return {} }
}
function save() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(queue)) } catch { /* private mode or full */ }
  }, 1500)
}
const localDay = () => {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

/** One tap on a zone's button. who: the person signed in (or null). */
export function countTap({ layoutId, zone, key, label, staffId }) {
  // Only a saved layout (the built-in screen has no id) and a counted zone.
  if (!/^[0-9a-f-]{36}$/i.test(layoutId || '') || !zone?.id || !TAP_ZONES.includes(zone.type)) return
  if (Object.keys(queue).length >= QUEUE_MAX) return
  queue = addTaps(queue, [{
    day: localDay(), staff_id: staffId || null, layout_id: layoutId, zone_id: zone.id, zone_type: zone.type,
    cell: tapCell(key), label: label || '', n: 1,
  }])
  save()
}

/** Send what is waiting. post(path, body) is the till's transport. */
export async function sendTaps(post) {
  if (sending) return
  const rows = Object.values(queue).slice(0, TAP_BATCH_MAX)
  if (!rows.length) return
  sending = true
  try {
    await post('/pos-api/till-taps', { taps: rows })
    queue = takeTaps(queue, rows)
    save()
  } catch (e) {
    // Offline: tried again next time. Refused (an old layout, a removed
    // person): those counts can never be kept, so they go.
    if (e?.status && e.status < 500 && e.status !== 401) { queue = takeTaps(queue, rows); save() }
  } finally {
    sending = false
  }
}

/** Start sending every minute (once), and when the page is hidden. */
export function startTapUpload(post) {
  if (started) return
  const tick = () => sendTaps(post).catch(() => {})
  started = setInterval(tick, SEND_MS)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') tick() })
}

/** For tests: what is waiting. */
export const waitingTaps = () => Object.values(queue)

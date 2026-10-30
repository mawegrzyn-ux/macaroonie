// Printers plugged into this device (migration 191): a till or kitchen
// screen collects the tickets queued for them (kitchen tickets from the
// kitchen flow's printer boxes, bills and receipts sent to them from another
// till) and prints them through the browser (lib/print.js). With Chrome
// started with --kiosk-printing they print without the print dialog.
//
// It collects when the cloud says there is something to print (pos.print on
// the socket) and every 20 seconds while this device has a printer, then
// tells the cloud each one printed. A ticket collected but never reported
// (the device went off mid-way) is collected again after two minutes.
//
// At a hub-first location (docs/POS.md section 11) the venue hub keeps the
// tickets of the events it decided itself (ids starting hub-): the device
// collects from the hub as well as from the cloud, and reports each to
// whichever gave it (lib/transport.js sends hub- ids to the hub).

import { printTickets } from './print.js'

/** Does this device have a printer plugged into it? config.printers carry connection + device_id. */
export function hasOwnPrinter(config, deviceId) {
  return !!deviceId && (config?.printers || []).some(p => p.connection === 'device' && p.device_id === deviceId && p.is_active !== false)
}

/**
 * Start collecting. api: { post(path, body, opts), onHub() } from the
 * device's transport; own(): whether it has a printer now (the config can
 * change). Returns { nudge(), stop() }.
 */
export function startDevicePrinting(api, own, { everyMs = 20000 } = {}) {
  let busy = false
  let again = false
  async function collect() {
    if (!own()) return
    if (busy) { again = true; return }
    busy = true
    try {
      for (let round = 0; round < 5; round++) {
        again = false
        const fromCloud = await api.post('/pos-api/print-jobs/claim', { limit: 10 }, { via: 'cloud' }).catch(() => [])
        const fromHub = api.onHub?.() ? await api.post('/pos-api/print-jobs/claim', { limit: 10 }, { via: 'hub' }).catch(() => []) : []
        const jobs = [...(fromHub || []), ...(fromCloud || [])]
        if (!jobs.length) break
        // One print for the lot: one dialog at most on a tablet without silent printing.
        try {
          printTickets(jobs.map(j => j.ops))
          for (const j of jobs) await api.post(`/pos-api/print-jobs/${j.id}/status`, { status: 'printed' }).catch(() => {})
        } catch (e) {
          for (const j of jobs) await api.post(`/pos-api/print-jobs/${j.id}/status`, { status: 'failed', error: String(e?.message || e).slice(0, 300) }).catch(() => {})
        }
        if (!again && (fromCloud || []).length < 10 && (fromHub || []).length < 10) break
      }
    } catch {
      // Offline or refused: the next nudge or tick tries again.
    } finally {
      busy = false
    }
  }
  const timer = setInterval(collect, everyMs)
  collect()
  return { nudge: collect, stop: () => clearInterval(timer) }
}

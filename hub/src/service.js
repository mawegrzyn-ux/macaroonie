// hub/src/service.js
//
// The venue hub's print loop: every couple of seconds it collects the print
// jobs queued for the venue's network printers (POST /pos-api/print-jobs/claim:
// kitchen tickets from the kitchen flow, bills and receipts), turns each into
// ESC/POS (escpos.js) and sends it to its printer (printer.js), then tells
// the cloud it printed or why not. Every minute it asks each printer how it
// is and reports that (and its own version) so Till setup can show it.
// The venue's printers (address, port, columns) come from the hub's config
// (GET /pos-api/config), fetched again when the cloud says it changed.

import { render } from './escpos.js'
import { print as sendToPrinter, printerStatus as askPrinter } from './printer.js'

export const VERSION = '1.0.0'

/**
 * Start the loop. Returns { stop(), tick(), report() } (tick and report for tests).
 *   cloud     cloudClient() from cloud.js
 *   log       (line) => void
 *   pollMs    how often to collect jobs
 *   statusMs  how often to report printers
 *   print / printerStatus  stand-ins for tests
 */
export function startHub({ cloud, log = () => {}, pollMs = 2000, statusMs = 60000, print = sendToPrinter, printerStatus = askPrinter }) {
  let printers = new Map()
  let configVersion = null
  let stopped = false
  let busy = false
  let lastConfigAt = 0
  const timers = []

  async function loadConfig(force = false) {
    if (!force && Date.now() - lastConfigAt < 60000) return
    const c = await cloud.config()
    lastConfigAt = Date.now()
    if (c.version !== configVersion) {
      printers = new Map((c.printers || []).map(p => [p.id, p]))
      configVersion = c.version
      log(`Printers: ${[...printers.values()].map(p => p.name + ' (' + p.host + ':' + p.port + ')').join(', ') || 'none with an address yet'}`)
    }
  }

  const send = p => job => print({ host: p.host, port: p.port || 9100, data: render(job.ops, { cols: p.columns || 42 }) })

  async function printJob(job) {
    const p = printers.get(job.printer_id)
    if (!p || !p.host) {
      await cloud.done(job.id, 'failed', 'The hub doesn\'t know this printer\'s address')
      log(`Not printed: ${job.title || job.kind} (no address for its printer)`)
      return
    }
    try {
      await send(p)(job)
      await cloud.done(job.id, 'printed')
      log(`Printed ${job.title || job.kind} on ${p.name}`)
    } catch (e) {
      // Its backup printer (Till setup > Printers), when it has one.
      const b = p.backup_printer_id && printers.get(p.backup_printer_id)
      if (b?.host) {
        try {
          await send(b)(job)
          await cloud.done(job.id, 'printed', `${p.name} didn't answer: printed on ${b.name}`)
          log(`Printed ${job.title || job.kind} on ${b.name} (backup for ${p.name}: ${e.message})`)
          return
        } catch { /* the backup is down too: report the first printer's reason */ }
      }
      await cloud.done(job.id, 'failed', String(e.message || e).slice(0, 300))
      log(`Not printed: ${job.title || job.kind} on ${p.name}: ${e.message}`)
    }
  }

  /** Collect and print what's waiting. */
  async function tick() {
    if (busy || stopped) return
    busy = true
    try {
      await loadConfig()
      const jobs = await cloud.claim(20)
      // A job for a printer added since the last config: load it again first.
      if (jobs.some(j => !printers.has(j.printer_id))) await loadConfig(true)
      for (const job of jobs) await printJob(job)
    } catch (e) {
      log('Couldn\'t reach the cloud: ' + e.message)
    } finally {
      busy = false
    }
  }

  /** Ask every printer how it is and tell the cloud. */
  async function report() {
    try {
      await loadConfig()
      const list = []
      for (const p of printers.values()) {
        if (!p.host) continue
        try {
          const s = await printerStatus({ host: p.host, port: p.port || 9100 })
          // No answer to the status question (some clones): reachable, state unknown.
          list.push(s
            ? { id: p.id, online: !!s.online, paper_low: !!s.paperNearEnd, paper_out: !!s.paperOut, cover_open: !!s.coverOpen, error: null }
            : { id: p.id, online: true, paper_low: false, paper_out: false, cover_open: false, error: null })
        } catch (e) {
          list.push({ id: p.id, online: false, paper_low: false, paper_out: false, cover_open: false, error: String(e.message || e).slice(0, 200) })
        }
      }
      await cloud.report({ app_version: VERSION, printers: list })
    } catch (e) {
      log('Couldn\'t report the printers: ' + e.message)
    }
  }

  timers.push(setInterval(tick, pollMs))
  timers.push(setInterval(report, statusMs))
  tick()
  report()
  return {
    tick, report,
    forceConfig: () => loadConfig(true),
    stop() { stopped = true; for (const t of timers) clearInterval(t) },
  }
}

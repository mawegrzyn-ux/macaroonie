// hub/src/service.js
//
// The venue hub's print loop: every couple of seconds it collects the print
// jobs queued for its printers (POST /pos-api/print-jobs/claim: kitchen
// tickets from the kitchen flow, bills and receipts), turns each into
// ESC/POS (escpos.js) and sends it to its printer, then tells the cloud it
// printed or why not. Its printers are the venue's network printers
// (printer.js, TCP 9100) and the USB printers plugged into this computer
// (usb.js). Every minute it asks each printer how it is and reports that,
// with what it knows about itself (version, computer, USB printers found,
// updates), so Store tech can show it. The venue's printers come from the
// hub's config (GET /pos-api/config), fetched again when it changed; the
// config also names the hub's latest version, which the updater installs
// at a quiet moment (update.js).

import os from 'node:os'
import { render } from './escpos.js'
import { print as sendToPrinter, printerStatus as askPrinter } from './printer.js'
import { findPrinters, printLocal, localStatus, usbSystem } from './usb.js'
import { VERSION } from './version.js'

export { VERSION }

const RECENT = 20

/** The computer the hub runs on, for Store tech and the status page. */
export function computerInfo(statusPort = null) {
  const addresses = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) addresses.push(a.address)
  }
  return {
    hostname: os.hostname(),
    os: os.type() + ' ' + os.release(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    addresses,
    status_port: statusPort,
  }
}

/** The shared state the status page and the cloud report read. */
export function newState(extra = {}) {
  return {
    phase: 'starting', version: VERSION, name: null, venue_name: null, api: null,
    link: null, cloud: { ok: null, at: null, error: null },
    computer: computerInfo(), printers: [], local_printers: [], recent: [], update: null,
    ...extra,
  }
}

/**
 * Start the loop. Returns { stop(), tick(), report(), forceConfig() } (the last three for tests).
 *   cloud     cloudClient() from cloud.js
 *   log       (line) => void
 *   state     newState(): what the status page shows (changed in place)
 *   updater   createUpdater() from update.js, or null
 *   onUnlinked  called once when the cloud says this hub was removed (401)
 *   pollMs    how often to collect jobs
 *   statusMs  how often to report printers
 *   print / printerStatus / local  stand-ins for tests
 */
export function startHub({
  cloud, log = () => {}, state = newState(), updater = null, version = VERSION, statusPort = null, onUnlinked = null,
  pollMs = 2000, statusMs = 60000,
  print = sendToPrinter, printerStatus = askPrinter,
  local = { find: findPrinters, print: printLocal, status: localStatus, sys: usbSystem() },
}) {
  let printers = new Map()
  let configVersion = null
  let lastConfig = null
  let stopped = false
  let busy = false
  let lastConfigAt = 0
  let lastUpdateCheck = 0
  const timers = []
  state.phase = 'running'
  state.version = version

  const address = p => p.interface === 'usb' ? null : (p.host ? p.host + ':' + (p.port || 9100) : null)

  async function loadConfig(force = false) {
    if (!force && Date.now() - lastConfigAt < 60000) return
    const c = await cloud.config()
    lastConfigAt = Date.now()
    lastConfig = c
    if (c.version !== configVersion) {
      printers = new Map((c.printers || []).map(p => [p.id, p]))
      configVersion = c.version
      const known = new Map(state.printers.map(p => [p.id, p]))
      state.printers = [...printers.values()].map(p => ({
        id: p.id, name: p.name, interface: p.interface || 'network', address: address(p),
        state: known.get(p.id)?.state ?? null, error: known.get(p.id)?.error ?? null, checked_at: known.get(p.id)?.checked_at ?? null,
      }))
      if (c.venue?.name) state.venue_name = c.venue.name
      log(`Printers: ${[...printers.values()].map(p => p.name + ' (' + (p.interface === 'usb' ? 'USB' : p.host + ':' + p.port) + ')').join(', ') || 'none yet'}`)
    }
  }

  const ready = p => p && (p.interface === 'usb' ? !!p.local_id : !!p.host)

  function send(p, job) {
    const data = render(job.ops, { cols: p.columns || 42 })
    return p.interface === 'usb'
      ? local.print({ id: p.local_id, data, sys: local.sys })
      : print({ host: p.host, port: p.port || 9100, data })
  }

  function remember(job, p, ok, error = null) {
    state.recent.unshift({ at: new Date().toISOString(), kind: job.kind, printer: p?.name || 'unknown printer', ok, error })
    state.recent.length = Math.min(state.recent.length, RECENT)
  }

  async function printJob(job) {
    const p = printers.get(job.printer_id)
    if (!ready(p)) {
      const why = !p ? 'The hub doesn\'t know this printer' : p.interface === 'usb' ? 'Pick the USB printer in Store tech' : 'The hub doesn\'t know this printer\'s address'
      await cloud.done(job.id, 'failed', why)
      remember(job, p, false, why)
      log(`Not printed: ${job.title || job.kind} (${why})`)
      return
    }
    try {
      await send(p, job)
      await cloud.done(job.id, 'printed')
      remember(job, p, true)
      log(`Printed ${job.title || job.kind} on ${p.name}`)
    } catch (e) {
      // Its backup printer (Store tech > Printers), when it has one.
      const b = p.backup_printer_id && printers.get(p.backup_printer_id)
      if (ready(b)) {
        try {
          await send(b, job)
          await cloud.done(job.id, 'printed', `${p.name} didn't answer: printed on ${b.name}`)
          remember(job, b, true)
          log(`Printed ${job.title || job.kind} on ${b.name} (backup for ${p.name}: ${e.message})`)
          return
        } catch { /* the backup is down too: report the first printer's reason */ }
      }
      const error = String(e.message || e).slice(0, 300)
      await cloud.done(job.id, 'failed', error)
      remember(job, p, false, error)
      log(`Not printed: ${job.title || job.kind} on ${p.name}: ${e.message}`)
    }
  }

  /** At a quiet moment (nothing printed this round): install a newer version when there is one. */
  async function maybeUpdate() {
    if (!updater || !lastConfig?.release || Date.now() - lastUpdateCheck < 30000) return
    lastUpdateCheck = Date.now()
    await updater.check(lastConfig.release, lastConfig.update || {})
    state.update = updater.state()
  }

  /** Collect and print what's waiting. */
  async function tick() {
    if (busy || stopped) return
    busy = true
    try {
      await loadConfig()
      const jobs = await cloud.claim(20)
      state.cloud = { ok: true, at: new Date().toISOString(), error: null }
      // A job for a printer added since the last config: load it again first.
      if (jobs.some(j => !printers.has(j.printer_id))) await loadConfig(true)
      for (const job of jobs) await printJob(job)
      if (!jobs.length) await maybeUpdate()
    } catch (e) {
      if (e.status === 401 && onUnlinked && !stopped) { onUnlinked(); return }
      state.cloud = { ok: false, at: state.cloud.at, error: e.message }
      log('Couldn\'t reach the cloud: ' + e.message)
    } finally {
      busy = false
    }
  }

  /** Ask every printer how it is and tell the cloud, with what the hub knows about itself. */
  async function report() {
    try {
      await loadConfig()
      const found = await local.find(local.sys)
      state.local_printers = found.map(({ id, name, make, model, escpos, path }) => ({ id, name, make, model, escpos, path }))
      state.computer = computerInfo(statusPort)
      if (updater) state.update = updater.state()
      const list = []
      for (const p of printers.values()) {
        if (!ready(p)) continue
        const shown = state.printers.find(x => x.id === p.id)
        let entry
        try {
          const s = p.interface === 'usb'
            ? await local.status({ id: p.local_id, sys: local.sys, found })
            : await printerStatus({ host: p.host, port: p.port || 9100 })
          // No answer to the status question (some clones, some USB links): reachable, state unknown.
          entry = s
            ? { id: p.id, online: !!s.online, paper_low: !!s.paperNearEnd, paper_out: !!s.paperOut, cover_open: !!s.coverOpen, error: s.error || null }
            : { id: p.id, online: true, paper_low: false, paper_out: false, cover_open: false, error: null }
          if (shown) Object.assign(shown, { state: s || null, error: null, checked_at: new Date().toISOString() })
        } catch (e) {
          entry = { id: p.id, online: false, paper_low: false, paper_out: false, cover_open: false, error: String(e.message || e).slice(0, 200) }
          if (shown) Object.assign(shown, { state: null, error: entry.error, checked_at: new Date().toISOString() })
        }
        list.push(entry)
      }
      await cloud.report({
        app_version: version,
        printers: list,
        info: {
          ...state.computer,
          local_printers: state.local_printers.map(({ id, name, model, escpos, path }) => ({ id, name, model, escpos, path })),
          update: state.update || { updates: 'manual', state: 'idle' },
        },
      })
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

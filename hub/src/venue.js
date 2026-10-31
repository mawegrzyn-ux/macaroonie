// hub/src/venue.js
//
// Hub first (docs/POS.md section 11): the hub's copy of its venue, kept on
// this computer and up to date with the cloud. Tills, kiosks and kitchen
// screens on the venue network send their events here (lan.js); the copy
// (shared/pos/mirror.js) decides them with the same sequencer as the cloud,
// prints what they make straight away and keeps them to send up. Then:
//
//   upload   the events the cloud hasn't taken yet, in order, each for the
//            device that made it (POST /pos-api/hub/events), and the changes
//            the hub refused itself (for the managers' Refused changes list)
//   follow   the cloud's log since the last look (GET /pos-api/hub/sync):
//            whatever else happened (tills straight to the cloud, online
//            orders, the server's own kitchen events), after which the copy is
//            the cloud's state with the hub's own events still waiting on top
//   context  what the hub decides with and who may use it
//            (GET /pos-api/hub/context, every 30 s)
//
// Every 2 s while something waits to go up, else every 5 s. With the
// internet down the venue keeps trading here; when it is back, everything
// goes up in order.
//
// On disk (beside hub.json): venue.json, the copy's snapshot (written every
// 10 s when it changed, atomically), and venue.log, each event taken since,
// one JSON line each with the hub's id, written and flushed before the device
// hears back. On a restart the snapshot is read and the log decided again on
// top, so nothing a device was told it had is lost. Both belong to one link:
// a snapshot or log line of another hub id is never used, and link.js deletes
// them when the computer is linked elsewhere.
//
// Events that need the cloud to decide them (a card machine payment, a
// loyalty reward: both reserved in the cloud) pass through: the hub sends
// what waits first, then this one, and answers with the cloud's result.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createMirror } from '../../shared/pos/mirror.js'
import { deviceEvent } from '../../shared/pos/deviceRules.js'
import { boardFeed } from '../../shared/pos/kitchen.js'
import { ulid } from '../../shared/pos/ids.js'

const SNAPSHOT_V = 1
// Tickets for printers plugged into a till or kitchen screen wait this long for it.
const DEVICE_JOB_HOURS = 6
// A ticket collected but not reported on is handed out again after this.
const CLAIM_STALE_MS = 2 * 60 * 1000

/** Write a file so that a crash leaves either the old one or the new one. */
function writeDurable(file, text) {
  const tmp = file + '.' + process.pid + '.tmp'
  const fd = fs.openSync(tmp, 'w', 0o600)
  try {
    fs.writeSync(fd, text)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, file)
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex')

function sameKey(a, b) {
  if (!a || !b || a.length !== b.length) return false
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

/**
 * Start the venue copy. opts:
 *   cloud      cloudClient() (hubContext, hubSync, hubEvents)
 *   hubId      this hub's device id
 *   dir        where venue.json and venue.log live
 *   onJobs     (jobs) => void: print tickets the copy just made
 *   onChange   () => void: the copy changed (devices polling see it next time)
 *   log        (line) => void
 */
export function startVenue({
  cloud, hubId, dir, onJobs = () => {}, onChange = () => {}, log = () => {},
  idleMs = 5000, busyMs = 2000, contextMs = 30000, snapshotMs = 10000,
}) {
  const snapFile = path.join(dir, 'venue.json')
  const logFile = path.join(dir, 'venue.log')
  const saved = readJson(snapFile)
  const own = saved?.v === SNAPSHOT_V && saved.hub_id === hubId ? saved : null
  let lan = own?.lan || null          // { hub_first, primary, devices, screens, board_clear_mins, version }
  let deviceJobs = own?.device_jobs || []
  const mirror = createMirror({ hubId, snapshot: own?.snapshot || null })
  const state = {
    cloud_ok: null, last_upload_at: null, last_follow_at: null, last_context_at: null, error: null,
    seen: new Map(),   // device id -> { at, name, kind }
  }
  let stopped = false
  let timer = null
  let snapTimer = null
  let ctxTimer = null
  let dirty = !own
  let rev = mirror.rev
  let busy = null
  // The log can't be decided again before the hub has the venue's set-up
  // (restarted with the internet down and no set-up saved): kept until it has.
  let logHeld = false

  const changed = () => {
    dirty = true
    if (mirror.rev !== rev) { rev = mirror.rev; onChange() }
  }

  async function writeSnapshot() {
    if (!dirty) return
    await mirror.exclusive(() => {
      const body = { v: SNAPSHOT_V, hub_id: hubId, at: new Date().toISOString(), lan, device_jobs: deviceJobs, snapshot: mirror.snapshot() }
      writeDurable(snapFile, JSON.stringify(body))
      // Everything in the log is in the snapshot now.
      if (!logHeld) writeDurable(logFile, '')
      dirty = false
    })
  }

  function appendLog(entry) {
    const fd = fs.openSync(logFile, 'a', 0o600)
    try {
      fs.writeSync(fd, JSON.stringify(entry) + '\n')
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
  }

  /** After a restart: the events taken since the last snapshot, decided again on top. */
  async function replayLog() {
    let text = ''
    try { text = fs.readFileSync(logFile, 'utf8') } catch { return 0 }
    if (!mirror.hasContext) {
      logHeld = !!text.trim()
      return 0
    }
    logHeld = false
    let n = 0
    for (const lineText of text.split('\n')) {
      if (!lineText.trim()) continue
      let entry
      try { entry = JSON.parse(lineText) } catch { continue }   // a line cut short by a crash: never answered
      // Only this hub's own events: a computer linked to another venue since
      // (link.js) must never decide that venue's events here.
      if (entry?.hub ? entry.hub !== hubId : !own) continue
      if (!entry?.event?.id || mirror.holds(entry.event.id)) continue
      const r = await mirror.submit(entry.event, { now: new Date(entry.at), printed: entry.printed })
      if (r.ok) n++
    }
    if (n) { dirty = true; log(`Venue copy: ${n} event(s) from before the restart`) }
    return n
  }

  const ready = (async () => {
    await mirror.ready
    await replayLog()
    await writeSnapshot().catch(e => log('Couldn\'t save the venue copy: ' + e.message))
  })()

  // ── The cloud ──

  async function loadContext() {
    try {
      const c = await cloud.hubContext(lan?.version || null)
      state.last_context_at = new Date().toISOString()
      if (c.unchanged) return
      const before = JSON.stringify(mirror.context)
      lan = {
        venue_id: c.venue_id, hub_first: c.hub_first !== false, primary: !!c.primary, version: c.version,
        devices: c.devices || [], screens: c.screens || [], board_clear_mins: c.board_clear_mins || 120,
      }
      if (JSON.stringify(c.context) !== before) await mirror.setContext(c.context)
      if (logHeld) await replayLog()
      changed()
      dirty = true
      // Kept at once: after a power cut the hub serves the venue from it.
      await writeSnapshot().catch(e => log('Couldn\'t save the venue copy: ' + e.message))
      log(`Venue copy: set-up ${c.version}${lan.hub_first ? '' : ' (hub first is off)'}${lan.primary ? '' : ' (another hub takes the events)'}`)
    } catch (e) {
      if (e.status === 401) throw e
      state.error = 'Set-up: ' + e.message
    }
  }

  async function follow() {
    for (let i = 0; i < 20; i++) {
      const r = await cloud.hubSync(mirror.cloudSeq)
      const refused = await mirror.applyCloud(r)
      for (const x of refused) log(`Venue copy: a change from ${deviceName(x.event.device_id)} no longer applies (${x.error})`)
      state.last_follow_at = new Date().toISOString()
      if (!r.reset && !(r.events || []).length) break
    }
    changed()
  }

  async function upload() {
    for (let i = 0; i < 50; i++) {
      const events = mirror.toSend(100)
      const out = mirror.refusalsOut()
      if (!events.length && !out.list.length) return
      const r = await cloud.hubEvents({ events, rejections: out.list })
      out.drop()
      await mirror.confirm(r.results || [])
      state.last_upload_at = new Date().toISOString()
      for (const x of (r.results || []).filter(x => !x.ok)) log(`Venue copy: the cloud refused a change (${x.error})`)
      changed()
    }
  }

  /** One round: send what waits, then follow the cloud. Only one at a time. */
  function round() {
    if (busy) return busy
    busy = (async () => {
      try {
        await upload()
        await follow()
        state.cloud_ok = true
        state.error = null
      } catch (e) {
        if (e.status === 401) throw e
        state.cloud_ok = false
        state.error = e.message
      } finally {
        busy = null
      }
    })()
    return busy
  }

  function schedule(ms) {
    if (stopped) return
    clearTimeout(timer)
    timer = setTimeout(async () => {
      await round().catch(() => {})
      schedule(mirror.status().to_send ? busyMs : idleMs)
    }, ms)
  }

  /** Something to send now (a till is waiting for nothing: this only hurries the upload). */
  const kick = () => schedule(150)

  // ── Devices on the venue network ──

  const deviceName = id => lan?.devices?.find(d => d.id === id)?.name || 'a device'

  /**
   * Who is asking: `Lan <id>.<key>` checked against the keys' sha256 the
   * cloud gave. { kind: 'device', device } | { kind: 'screen', screen } | null.
   */
  function who(header) {
    const m = /^Lan ([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,})$/i.exec(header || '')
    if (!m || !lan) return null
    const hash = sha256(m[2])
    const d = lan.devices.find(x => x.id === m[1])
    if (d && sameKey(hash, d.key_hash)) {
      state.seen.set(d.id, { at: Date.now(), name: d.name, kind: d.kind })
      return { kind: 'device', device: d }
    }
    const s = lan.screens.find(x => x.id === m[1])
    if (s && sameKey(hash, s.key_hash)) {
      state.seen.set(s.id, { at: Date.now(), name: s.name, kind: 'screen' })
      return { kind: 'screen', screen: s }
    }
    return null
  }

  /** Whether the hub takes events now (hub first on, the hub devices use, the set-up known). */
  const taking = () => !!(lan?.hub_first && lan?.primary && mirror.hasContext)

  const kioskIds = () => new Set((lan?.devices || []).filter(d => d.kind === 'kiosk').map(d => d.id))

  /** A device's events (as the cloud's POST /pos-api/events): { results, seq, checks, kitchen, source }. */
  async function takeEvents(device, events) {
    await ready
    const results = []
    const checks = {}
    const kitchen = {}
    const kiosks = kioskIds()
    for (const raw of events) {
      const ruled = deviceEvent(raw, device, lan?.venue_id || raw.venue_id, kiosks)
      if (!ruled.event) { results.push({ id: raw.id, ok: false, error: ruled.error, code: ruled.code }); continue }
      const e = ruled.event
      if (mirror.needsCloud(e)) {
        results.push(await throughCloud(e))
        continue
      }
      const at = new Date()
      const r = await mirror.submit(e, { now: at, printed: true })
      if (r.ok && !r.duplicate) {
        appendLog({ hub: hubId, event: e, at: at.toISOString(), printed: !!r.jobs?.length })
        if (r.jobs?.length) onJobs(r.jobs)
      }
      if (r.ok) {
        for (const [id, c] of Object.entries(r.checks || {})) checks[id] = c
        for (const [id, o] of Object.entries(r.kitchen || {})) kitchen[id] = o
        results.push({ id: e.id, ok: true, seq: r.seq, duplicate: !!r.duplicate, assigned: r.event?.assigned || null })
      } else {
        results.push({ id: e.id, ok: false, error: r.error, code: r.code, duplicate: !!r.duplicate })
      }
    }
    changed()
    kick()
    return { results, seq: mirror.rev, checks: Object.values(checks), kitchen: Object.values(kitchen), source: mirror.source }
  }

  /** An event the cloud must decide: what waits goes first, then this one, then the copy follows. */
  async function throughCloud(e) {
    const why = String(e.type).startsWith('discount.')
      ? { error: 'Loyalty rewards need the internet', code: 'loyalty' }
      : { error: 'Card machine payments need the internet', code: 'card' }
    try {
      await round()
      if (mirror.status().to_send) return { id: e.id, ok: false, ...why }
      const r = await cloud.hubEvents({ events: [{ ...e, hub_at: new Date().toISOString() }] })
      await follow()
      changed()
      return r.results?.[0] || { id: e.id, ok: false, ...why }
    } catch {
      return { id: e.id, ok: false, ...why }
    }
  }

  // Tickets for a printer plugged into a till or kitchen screen: they collect them here.
  function queueForDevice(job, deviceId) {
    deviceJobs.push({ ...job, id: 'hub-' + ulid(), device_id: deviceId, status: 'queued', created_at: new Date().toISOString(), claimed_at: null })
    const cut = Date.now() - DEVICE_JOB_HOURS * 3600 * 1000
    deviceJobs = deviceJobs.filter(j => Date.parse(j.created_at) > cut)
    dirty = true
  }

  function claimJobs(deviceId, limit = 20) {
    const now = Date.now()
    const out = []
    for (const j of deviceJobs) {
      if (out.length >= limit) break
      if (j.device_id !== deviceId) continue
      if (j.status === 'queued' || (j.status === 'printing' && now - Date.parse(j.claimed_at) > CLAIM_STALE_MS)) {
        j.status = 'printing'
        j.claimed_at = new Date(now).toISOString()
        out.push({ id: j.id, printer_id: j.printer_id, kind: j.kind, title: j.title || null, ops: j.ops, check_id: j.check_id || null, created_at: j.created_at })
      }
    }
    if (out.length) dirty = true
    return out
  }

  function jobDone(id, deviceId, status) {
    const j = deviceJobs.find(x => x.id === id && x.device_id === deviceId)
    if (!j) return null
    deviceJobs = deviceJobs.filter(x => x !== j)
    dirty = true
    return { id, status }
  }

  /** A printer of the venue, from the set-up. */
  const printerOf = id => mirror.context?.print?.printers?.[id] || null

  /** Numbers for the order ready boards (as GET /screen-api/orders). */
  function board() {
    const orders = Object.fromEntries(mirror.kitchenOrders().map(o => [o.id, o]))
    return boardFeed(orders, new Date().toISOString(), { clearMins: lan?.board_clear_mins || 120, max: 40, cfg: mirror.context?.kitchen || null })
  }

  function status() {
    const m = mirror.status()
    const cut = Date.now() - 2 * 60 * 1000
    const seen = [...state.seen.entries()].filter(([, v]) => v.at > cut).map(([id, v]) => ({ id, name: v.name, kind: v.kind }))
    return {
      on: taking(), hub_first: lan?.hub_first ?? null, primary: lan?.primary ?? null,
      rev: m.rev, cloud_seq: m.cloud_seq, pending: m.pending, to_send: m.to_send, conflicts: m.conflicts,
      day: m.day ? { id: m.day.id, business_date: m.day.business_date } : null,
      devices: seen, device_jobs: deviceJobs.length,
      cloud_ok: state.cloud_ok, last_upload_at: state.last_upload_at, last_follow_at: state.last_follow_at, error: state.error,
    }
  }

  const start = async () => {
    await ready
    await loadContext()
    ctxTimer = setInterval(() => loadContext().catch(() => {}), contextMs)
    snapTimer = setInterval(() => writeSnapshot().catch(e => log('Couldn\'t save the venue copy: ' + e.message)), snapshotMs)
    schedule(0)
  }
  const started = start()

  return {
    ready, started, mirror, who, taking, takeEvents, queueForDevice, claimJobs, jobDone, printerOf, board, status, round,
    /** Load the set-up again now (the hub's first report told the cloud its venue network port). */
    refresh: () => loadContext().catch(() => {}),
    sync: q => mirror.sync(q),
    kitchenSync: q => mirror.kitchenSync(q),
    dayReport: () => ({ ...mirror.dayReport(), source: mirror.source }),
    listChecks: q => mirror.listChecks(q),
    getCheck: id => mirror.getCheck(id),
    loadContext, writeSnapshot,
    /** Stop the loops without saving (tests: the power going off). */
    halt() {
      stopped = true
      clearTimeout(timer)
      clearInterval(snapTimer)
      clearInterval(ctxTimer)
    },
    async stop() {
      stopped = true
      clearTimeout(timer)
      clearInterval(snapTimer)
      clearInterval(ctxTimer)
      await (busy || Promise.resolve()).catch(() => {})
      await writeSnapshot().catch(() => {})
    },
  }
}

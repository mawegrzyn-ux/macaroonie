// hub/src/link.js
//
// The hub's link to its venue: hub.json (the device id and its secret, the
// names it was linked under) and the files of that venue kept beside it
// (venue.json and venue.log, the hub-first copy; printers.json, the last
// config; state.json, what the status page shows). One computer is one hub
// for one venue of one restaurant group at a time.
//
//   linkInfo()  what this computer is linked to, asked of the cloud when it
//               answers (GET /pos-api/me): the installer shows it and asks
//               whether to keep it, link it elsewhere or remove the hub
//   unlink()    takes the computer off its venue: sends up whatever the venue
//               copy still holds, tells the cloud (POST /pos-api/disconnect,
//               Store tech then shows the hub Not linked), and deletes every
//               file of that venue, so the next link starts clean and never
//               sees the last restaurant's sales
//   forgetVenue()  just the deleting (a hub removed in Store tech: the cloud
//               refuses it anyway)
//
// Run with the hub stopped: the installer stops the service first.

import fs from 'node:fs'
import path from 'node:path'
import { cloudClient } from './cloud.js'
import { startVenue } from './venue.js'

/** The files of the venue a link belongs to, beside hub.json. */
export const VENUE_FILES = ['venue.json', 'venue.log', 'printers.json', 'state.json']

export function readLink(configPath) {
  try {
    const c = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    return c && typeof c === 'object' ? c : {}
  } catch { return {} }
}

export function writeLink(configPath, c) {
  fs.writeFileSync(configPath, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 })
}

const linked = c => !!(c.device_id && c.secret && c.api)

/** Delete the venue's files (and half-written copies of them) beside hub.json. */
export function forgetVenue(dir) {
  const gone = []
  let names = []
  try { names = fs.readdirSync(dir) } catch { return gone }
  for (const name of names) {
    if (VENUE_FILES.includes(name) || VENUE_FILES.some(f => name.startsWith(f + '.') && name.endsWith('.tmp'))) {
      try { fs.rmSync(path.join(dir, name), { force: true }); gone.push(name) } catch { /* nothing to delete */ }
    }
  }
  return gone
}

/** Lines in venue.log: events taken since the last snapshot (not counted as sent). */
function logLines(dir) {
  try { return fs.readFileSync(path.join(dir, 'venue.log'), 'utf8').split('\n').filter(l => l.trim()).length } catch { return 0 }
}

/**
 * What this computer is linked to.
 *   { linked: false }
 *   { linked: true, same_api, api, device_id, name, venue_name, tenant_name, status }
 * status: 'linked' (the cloud knows it), 'removed' (the cloud refuses it: removed
 * or unlinked in Store tech), 'offline' (no answer: the names are those saved
 * when it was linked), 'other_api' (linked to another server, not asked).
 */
export async function linkInfo({ configPath, api = null, fetchImpl = fetch }) {
  const c = readLink(configPath)
  if (!linked(c)) return { linked: false }
  const out = {
    linked: true, api: c.api, same_api: !api || c.api === api, device_id: c.device_id,
    name: c.name || null, venue_name: c.venue_name || null, tenant_name: c.tenant_name || null, status: 'offline',
  }
  if (!out.same_api) return { ...out, status: 'other_api' }
  try {
    const me = await cloudClient({ api: c.api, deviceId: c.device_id, secret: c.secret, fetchImpl }).me()
    return { ...out, status: 'linked', name: me.name ?? out.name, venue_name: me.venue_name ?? out.venue_name, tenant_name: me.tenant_name ?? out.tenant_name }
  } catch (e) {
    return { ...out, status: e.status === 401 || e.status === 403 ? 'removed' : 'offline', error: e.status ? null : e.message }
  }
}

/**
 * Take this computer off its venue. With anything the cloud hasn't had yet
 * (sales taken on the hub while the internet was down) and no answer from the
 * cloud, it stops and changes nothing unless force: those sales would be lost.
 *   { ok, linked, unsent, disconnected, removed, was: { name, venue_name, tenant_name }, error }
 */
export async function unlink({ configPath, force = false, fetchImpl = fetch, log = () => {} }) {
  const dir = path.dirname(configPath)
  const c = readLink(configPath)
  if (!linked(c)) {
    forgetVenue(dir)
    try { fs.rmSync(configPath, { force: true }) } catch { /* not there */ }
    return { ok: true, linked: false, unsent: 0, disconnected: false, removed: false, was: null }
  }
  const was = { name: c.name || null, venue_name: c.venue_name || null, tenant_name: c.tenant_name || null }
  const cloud = cloudClient({ api: c.api, deviceId: c.device_id, secret: c.secret, fetchImpl })
  let removed = false
  let error = null
  let unsent = 0

  // 1. Whatever the venue copy holds goes up first (the same upload as when running).
  const hasCopy = fs.existsSync(path.join(dir, 'venue.json')) || logLines(dir) > 0
  if (hasCopy) {
    const hour = 3_600_000
    const venue = startVenue({ cloud, hubId: c.device_id, dir, log, idleMs: hour, busyMs: hour, contextMs: hour, snapshotMs: hour })
    try {
      await venue.started
      await venue.round()
    } catch (e) {
      if (e.status === 401 || e.status === 403) removed = true
      else error = e.message
    }
    const st = venue.status()
    await venue.stop()
    if (st.cloud_ok === false && st.error) error = error || st.error
    // What the copy still has to send, plus events in the log it couldn't decide
    // again (restarted without the internet and without the venue's set-up).
    unsent = (st.to_send || 0) + logLines(dir)
  }
  if (unsent && !removed && !force) {
    return { ok: false, linked: true, unsent, disconnected: false, removed, was, error }
  }

  // 2. The cloud: the hub leaves its venue (Store tech shows it Not linked).
  let disconnected = false
  if (!removed) {
    try {
      await cloud.disconnect()
      disconnected = true
    } catch (e) {
      if (e.status === 401 || e.status === 403) removed = true
      else error = error || e.message
    }
  }

  // 3. This computer forgets the venue.
  forgetVenue(dir)
  try { fs.rmSync(configPath, { force: true }) } catch { /* not there */ }
  return { ok: true, linked: true, unsent, disconnected, removed, was, error }
}

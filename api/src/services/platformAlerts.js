// src/services/platformAlerts.js
//
// Alerts when the platform turns red (22 Nov 2026, the follow-up to
// OUTSTANDING 45): one API process (PM2 instance 0) checks platformStatus()
// every CHECK_MS and emails the active platform admins when
//   down      for DOWN_AFTER checks in a row (the database can't be reached)
//   degraded  for SLOW_AFTER_MS (Redis down, a job late, the disk nearly full)
//   up        again after either was sent
// Each is sent once per spell. The admins' addresses are kept from the last
// good read, so a database outage can still be told. What was last sent is
// kept in Redis (when it answers) for the Platform page and so a restart
// doesn't send it again. Emails go through the platform's own provider
// (SENDGRID_API_KEY); there is no push for platform admins.
//
//   nextAlert(mem, { state, reasons, at })  the rule: { mem, send }
//   startPlatformAlerts(log)                 call once after listen; returns stop()
//   lastAlert()                              what was last sent, or null

import IORedis from 'ioredis'
import { systemSql } from '../config/db.js'
import { env } from '../config/env.js'
import { sendEmail, emailCredentials } from './emailSvc.js'
import { platformStatus } from './platformStatus.js'
import { officeOrigin } from './platformHost.js'

export const CHECK_MS = 60_000
export const DOWN_AFTER = 2
export const SLOW_AFTER_MS = 30 * 60_000
const KEY = 'mac:status:alert'

export const FRESH = { alerted: null, downRun: 0, slowSince: null }

/**
 * The rule: given what was remembered and the latest check, what to
 * remember and what (if anything) to send: { kind: 'down' | 'degraded' |
 * 'up', reasons } or null.
 */
export function nextAlert(mem, { state, reasons = [], at = Date.now() }) {
  const m = { ...FRESH, ...(mem || {}) }
  if (state === 'up') {
    const send = m.alerted ? { kind: 'up', reasons: [] } : null
    return { mem: { ...FRESH }, send }
  }
  if (state === 'down') {
    const downRun = m.downRun + 1
    const slowSince = m.slowSince ?? at
    if (downRun >= DOWN_AFTER && m.alerted !== 'down') return { mem: { alerted: 'down', downRun, slowSince }, send: { kind: 'down', reasons } }
    return { mem: { ...m, downRun, slowSince }, send: null }
  }
  // Degraded: told once it has lasted SLOW_AFTER_MS; after a down alert, not
  // again until it is up.
  const slowSince = m.slowSince ?? at
  if (!m.alerted && at - slowSince >= SLOW_AFTER_MS) return { mem: { alerted: 'degraded', downRun: 0, slowSince }, send: { kind: 'degraded', reasons } }
  return { mem: { ...m, downRun: 0, slowSince }, send: null }
}

const SUBJECTS = {
  down: 'Macaroonie is down',
  degraded: 'Macaroonie is running slow',
  up: 'Macaroonie is back up',
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

/** The alert email's body. */
export function alertHtml(send, at = new Date()) {
  const head = {
    down: 'The platform isn\'t answering properly. Tills keep trading offline and send their sales when it is back.',
    degraded: 'The platform has been running slow or partly for ' + Math.round(SLOW_AFTER_MS / 60_000) + ' minutes: live updates, emails or background work may be late.',
    up: 'Everything is working again.',
  }[send.kind]
  const reasons = send.reasons.length ? '<ul>' + send.reasons.map(r => '<li>' + esc(r) + '</li>').join('') + '</ul>' : ''
  return '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111827">'
    + '<p><strong>' + esc(SUBJECTS[send.kind]) + '</strong></p><p>' + esc(head) + '</p>' + reasons
    + '<p style="color:#6b7280;font-size:13px">Checked ' + esc(at.toISOString().replace('T', ' ').slice(0, 16)) + ' UTC. '
    + 'See Platform → Services: <a href="' + esc(officeOrigin() + '/platform') + '">' + esc(officeOrigin() + '/platform') + '</a></p></div>'
}

let redis = null
function client() {
  if (!redis) {
    redis = new IORedis(env.REDIS_URL, { enableOfflineQueue: false, maxRetriesPerRequest: 1 })
    redis.on('error', () => {})
  }
  return redis
}

/** What was last sent: { kind, at, to } or null (Redis not answering: null). */
export async function lastAlert() {
  try {
    const raw = await client().get(KEY + ':last')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

/** Starts the checks in one process of the cluster (instance 0; never under tests). */
export function startPlatformAlerts(log = null) {
  if (env.NODE_ENV === 'test' || (process.env.NODE_APP_INSTANCE ?? '0') !== '0') return () => {}
  let mem = { ...FRESH }
  let admins = []
  let loaded = false
  const check = async () => {
    if (!loaded) {
      loaded = true
      try { const kept = await client().get(KEY + ':mem'); if (kept) mem = { ...FRESH, ...JSON.parse(kept) } } catch { /* fresh */ }
    }
    let status
    try { status = await platformStatus() } catch (err) { status = { state: 'down', reasons: [String(err?.message || err).slice(0, 200)] } }
    try {
      const rows = await systemSql`SELECT email FROM platform_admins WHERE is_active ORDER BY created_at`
      admins = rows.map(r => r.email).filter(Boolean)
    } catch { /* the database is down: keep the last list */ }
    const r = nextAlert(mem, { state: status.state, reasons: status.reasons || [], at: Date.now() })
    mem = r.mem
    client().set(KEY + ':mem', JSON.stringify(mem)).catch(() => {})
    if (!r.send) return
    const at = new Date()
    log?.[r.send.kind === 'up' ? 'info' : 'error']?.({ alert: r.send.kind, reasons: r.send.reasons }, 'platform status alert')
    if (!admins.length) return
    const { provider, credentials } = emailCredentials(null, env)
    const html = alertHtml(r.send, at)
    let sent = 0
    for (const to of admins) {
      try {
        await sendEmail({ provider, credentials, from: { name: 'Macaroonie status', email: env.EMAIL_FROM }, to, subject: SUBJECTS[r.send.kind], html })
        sent++
      } catch (err) { log?.warn?.({ err }, 'a platform alert email wasn\'t sent') }
    }
    client().set(KEY + ':last', JSON.stringify({ kind: r.send.kind, at: at.toISOString(), to: sent, of: admins.length })).catch(() => {})
  }
  const timer = setInterval(() => { check().catch(err => log?.warn?.({ err }, 'platform alert check failed')) }, CHECK_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}

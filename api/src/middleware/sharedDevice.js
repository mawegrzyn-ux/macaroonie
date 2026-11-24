// src/middleware/sharedDevice.js
//
// Shared devices and the person switch (Pepper-first step 6a, migration 280;
// docs/PEPPER_FIRST.md 13, decisions 6 and 9). A device an admin marked as
// shared for a venue sends its token as X-Shared-Device on every request.
// Before any change on it, someone says who they are with a PIN
// (POST /api/shared-devices/act) and the device then sends that person's
// short-lived token as X-Acting-Person. The server is the judge:
//
//   sharedDeviceGuard()  runs at the end of requireAuth, so every route that
//                        signs people in runs it. A read (GET) passes as the
//                        signed-in account (with the person's limits when
//                        one is switched in). A change needs a person:
//                        403 code 'person_needed' without one. A till PIN is
//                        enough only on a route marked config.sharedDevice
//                        'check' (logging food safety readings, checklist
//                        ticks, corrective actions), or one whose
//                        config.sharedDevice.till(req) says yes (Pepper's
//                        Confirm on a check card); anywhere else 403 code
//                        'office_pin_needed'. A route marked 'free' is not a
//                        change (the chat, the switch itself, Lock).
//   req.acting           { id, kind: 'till' | 'office', name, userId, sub,
//                        role, staffId, deviceId }: permissionLevel() and
//                        requireRole() (auth.js) hold an office PIN person to
//                        the lower of their own role and the account's.
//   whoDid(req, said)    the name a change is recorded under: the person on
//                        a shared device (whatever the body says), else what
//                        the body says, else the account's email.
//
// One person at a time per device. The switch ends on Lock, after
// ACT_IDLE_SECONDS with no change and no "still here" from the device, or
// ACT_MAX_MINUTES after it started.

import { createHash } from 'node:crypto'
import { withTenant } from '../config/db.js'

export const DEVICE_HEADER = 'x-shared-device'
export const ACT_HEADER = 'x-acting-person'
export const DEVICE_TOKEN_PREFIX = 'sd_'
export const ACT_TOKEN_PREFIX = 'sp_'
/** The person switch lasts this long without a change or a "still here". */
export const ACT_IDLE_SECONDS = 120
/** ...and never longer than this from the PIN. */
export const ACT_MAX_MINUTES = 30
/** Wrong PINs for one person on one device before that person is locked there. */
export const PIN_TRIES = 5
/** How long that lock lasts (and the window wrong tries are counted in). */
export const PIN_LOCK_MINUTES = 5
/** Wrong PINs on one device, whoever for, before the whole device waits. */
export const DEVICE_TRIES = 15

/** What a route says about shared devices (config.sharedDevice). */
export const FREE = 'free'
export const CHECK = 'check'

const READS = new Set(['GET', 'HEAD', 'OPTIONS'])
const TOKEN_RE = /^(sd|sp)_[0-9a-f]{64}$/

export const hashToken = token => createHash('sha256').update(String(token)).digest('hex')

function headerOf(req, name) {
  const v = req.headers[name]
  return typeof v === 'string' && TOKEN_RE.test(v) ? v : null
}

/** The device a token names, in this tenant only (another tenant's is not found). */
export async function findDevice(tenantId, token) {
  if (!tenantId || !token || !token.startsWith(DEVICE_TOKEN_PREFIX)) return null
  const [d] = await withTenant(tenantId, tx => tx`
    SELECT d.id, d.name, d.kind, d.venue_id, v.name AS venue_name
      FROM shared_devices d
      JOIN venues v ON v.id = d.venue_id AND v.tenant_id = d.tenant_id
     WHERE d.tenant_id = ${tenantId} AND d.token_hash = ${hashToken(token)}
     LIMIT 1`)
  return d || null
}

/**
 * The person switched in on this device, or null when the token is unknown,
 * ended, idle too long or too old. `touch` counts this as use (a change, or
 * the device's "still here"), which keeps the switch going.
 */
export async function findPerson(tenantId, deviceId, token, { touch = false } = {}) {
  if (!token || !token.startsWith(ACT_TOKEN_PREFIX)) return null
  const hash = hashToken(token)
  const rows = await withTenant(tenantId, async tx => {
    const found = await tx`
      SELECT p.id, p.kind, p.name, p.user_id, p.staff_id, p.device_id, p.last_used_at,
             u.auth0_user_id, u.role::text AS role, u.is_active AS user_active,
             s.is_active AS staff_active
        FROM shared_device_people p
        LEFT JOIN users u ON u.id = p.user_id AND u.tenant_id = p.tenant_id
        LEFT JOIN cash_staff s ON s.id = p.staff_id AND s.tenant_id = p.tenant_id
       WHERE p.tenant_id = ${tenantId} AND p.device_id = ${deviceId} AND p.token_hash = ${hash}
         AND p.ended_at IS NULL
         AND p.last_used_at > now() - make_interval(secs => ${ACT_IDLE_SECONDS})
         AND p.started_at > now() - make_interval(mins => ${ACT_MAX_MINUTES})
       LIMIT 1`
    if (touch && found[0]) await tx`UPDATE shared_device_people SET last_used_at = now() WHERE id = ${found[0].id} AND tenant_id = ${tenantId}`
    return found
  })
  const p = rows[0]
  if (!p) return null
  if (p.kind === 'office' && (!p.user_active || !p.auth0_user_id)) return null
  if (p.kind === 'till' && p.staff_active === false) return null
  return {
    id: p.id, kind: p.kind, name: p.name, deviceId: p.device_id,
    userId: p.user_id || null, sub: p.kind === 'office' ? p.auth0_user_id : null,
    role: p.kind === 'office' ? p.role : null, staffId: p.staff_id || null,
    lastUsedAt: p.last_used_at,
  }
}

const personNeeded = (reply, device) => reply.code(403).send({
  error: 'This is a shared device: say who you are with your PIN before making a change.',
  code: 'person_needed', device: { id: device.id, name: device.name },
})

/**
 * The check every change runs on a shared device (see the top of this file).
 * Called at the end of requireAuth; runs once per request.
 */
export async function sharedDeviceGuard(req, reply) {
  if (req.sharedDeviceChecked) return
  req.sharedDeviceChecked = true
  const deviceToken = headerOf(req, DEVICE_HEADER)
  if (!deviceToken || !req.tenantId) return
  const isChange = !READS.has(req.method)
  const actToken = headerOf(req, ACT_HEADER)
  // A plain read on a shared device is the signed-in account's own.
  if (!isChange && !actToken) return
  const mode = req.routeOptions?.config?.sharedDevice ?? null
  const device = await findDevice(req.tenantId, deviceToken)
  if (!device) {
    if (!isChange) return
    return reply.code(404).send({ error: 'This device is no longer set up as shared.', code: 'shared_device_unknown' })
  }
  req.sharedDevice = device
  const free = mode === FREE
  const person = actToken ? await findPerson(req.tenantId, device.id, actToken, { touch: isChange && !free }) : null
  if (person) req.acting = person
  if (!isChange || free) return
  if (!person) return personNeeded(reply, device)
  if (person.kind === 'till') {
    const allowed = mode === CHECK || (typeof mode?.till === 'function' && await mode.till(req))
    if (!allowed) {
      return reply.code(403).send({
        error: 'A till PIN is enough for logging checks only. Use your office PIN for this change.',
        code: 'office_pin_needed', device: { id: device.id, name: device.name },
      })
    }
  }
}

/**
 * The name a change is recorded under (a check's "logged by", a checklist's
 * "completed by", an action's "created by"): the person on a shared device,
 * else `said` (what the form sent), else the signed-in account's email.
 */
export function whoDid(req, said = null) {
  if (req.acting) return req.acting.name
  return said ?? req.user?.email ?? null
}

/** The person for a task log or an audit row: { sub, name } of whoever made the change. */
export function actingPerson(req) {
  if (!req.acting) return null
  return { sub: req.acting.sub, name: req.acting.name, kind: req.acting.kind, deviceId: req.acting.deviceId }
}

/**
 * onResponse: each change made on a shared device, the person it was made
 * as and how it went (shared_device_changes). Never fails a request.
 */
export async function recordSharedChange(req, reply) {
  if (!req.sharedDevice || READS.has(req.method) || !req.tenantId) return
  if (req.routeOptions?.config?.sharedDevice === FREE) return
  const p = req.acting || null
  const route = String(req.routeOptions?.url || req.url || '').slice(0, 300)
  try {
    await withTenant(req.tenantId, tx => tx`
      INSERT INTO shared_device_changes (tenant_id, device_id, person_id, person_kind, person_name, method, route, status)
      VALUES (${req.tenantId}, ${req.sharedDevice.id}, ${p?.id ?? null}, ${p?.kind ?? null}, ${p?.name ?? null},
              ${req.method}, ${route}, ${reply.statusCode})`)
  } catch (err) {
    req.log?.warn({ err: err?.message }, 'shared device change not recorded')
  }
}

/** The shared-device headers of a request, to pass on to in-process calls (ai/context.js callApi). */
export function sharedHeaders(req) {
  const out = {}
  const d = headerOf(req, DEVICE_HEADER)
  const a = headerOf(req, ACT_HEADER)
  if (d) out[DEVICE_HEADER] = d
  if (a) out[ACT_HEADER] = a
  return out
}

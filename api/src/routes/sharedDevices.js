// src/routes/sharedDevices.js
//
// /api/shared-devices: shared devices and the person switch (Pepper-first
// step 6a, migration 280; the check every change runs is in
// middleware/sharedDevice.js).
//
//   GET    /                list the group's shared devices (Settings View),
//                           each with can_stop for the signed-in account
//   POST   /                mark this device shared for a venue (Settings
//                           Manage): the token is in the answer, once
//   DELETE /:id             stop a device being shared: Settings Manage or
//                           the person who shared it, also from the device
//                           itself (stopRefusal() below); sign_out: true when
//                           the device stopped itself with nobody proving
//                           who they are, and the page then signs out
//   GET    /this            the device this request came from, who is
//                           switched in and can_stop (X-Shared-Device; 404
//                           when unknown)
//   GET    /people          who can switch in here: the venue's staff with a
//                           till PIN, the group's people with an office PIN
//   POST   /act             { person: 'staff:<id>' | 'user:<id>', pin }: the
//                           person switch. A short-lived token for
//                           X-Acting-Person. PIN_TRIES wrong locks that person
//                           on this device for PIN_LOCK_MINUTES; DEVICE_TRIES
//                           wrong on the device, whoever for, the whole device.
//                           A wrong name and a wrong PIN get the same answer.
//   POST   /lock            end the switch now (one tap)
//   POST   /still-here      the device is in use: keep the switch going
//   GET|PUT|DELETE /my-pin  the signed-in person's own office PIN (never on
//                           a shared device)

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission, permissionLevel } from '../middleware/auth.js'
import { permissionAtLeast } from '../config/modules.js'
import { httpError } from '../middleware/error.js'
import {
  DEVICE_HEADER, ACT_HEADER, DEVICE_TOKEN_PREFIX, ACT_TOKEN_PREFIX, ACT_IDLE_SECONDS, ACT_MAX_MINUTES,
  PIN_TRIES, PIN_LOCK_MINUTES, DEVICE_TRIES, FREE, hashToken, findDevice, findPerson,
} from '../middleware/sharedDevice.js'
import { hashPin, PIN_PATTERN, weakPin } from '../../../shared/pos/pin.js'

const NAME_MAX = 60

const MarkBody = z.object({
  venue_id: z.string().uuid(),
  name:     z.string().trim().min(1).max(NAME_MAX),
  kind:     z.enum(['browser', 'office_app']).default('browser'),
})
const ActBody = z.object({
  person: z.string().regex(/^(staff|user):[0-9a-f-]{36}$/i),
  pin:    z.string().max(12),
})
const PinBody = z.object({ pin: z.string().regex(PIN_PATTERN, 'A PIN is 4 to 6 digits') })

const deviceView = d => ({ id: d.id, name: d.name, kind: d.kind, venue_id: d.venue_id, venue_name: d.venue_name })
const personView = p => p ? { kind: p.kind, name: p.name, idle_seconds: ACT_IDLE_SECONDS } : null

function sameHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

/** The device this request came from, or a 404 (another tenant's token is not found). */
async function thisDevice(req) {
  const token = req.headers[DEVICE_HEADER]
  const d = typeof token === 'string' ? await findDevice(req.tenantId, token) : null
  if (!d) throw httpError(404, 'This device is not set up as shared.', { code: 'shared_device_unknown' })
  return d
}

async function locks(tx, req, deviceId, key) {
  const rows = await tx`
    SELECT person_key, locked_until FROM shared_device_pin_tries
     WHERE device_id = ${deviceId} AND tenant_id = ${req.tenantId}
       AND person_key IN (${key}, '*') AND locked_until > now()`
  return rows
}

/** One wrong PIN: counted for the person and the device; the lock when either is reached. */
async function countWrong(tx, req, deviceId, key) {
  const left = {}
  for (const [k, limit] of [[key, PIN_TRIES], ['*', DEVICE_TRIES]]) {
    const [r] = await tx`
      INSERT INTO shared_device_pin_tries (device_id, tenant_id, person_key, failures, first_failed_at)
      VALUES (${deviceId}, ${req.tenantId}, ${k}, 1, now())
      ON CONFLICT (device_id, person_key) DO UPDATE SET
        failures = CASE WHEN shared_device_pin_tries.first_failed_at IS NULL
                          OR shared_device_pin_tries.first_failed_at < now() - make_interval(mins => ${PIN_LOCK_MINUTES})
                        THEN 1 ELSE shared_device_pin_tries.failures + 1 END,
        first_failed_at = CASE WHEN shared_device_pin_tries.first_failed_at IS NULL
                                 OR shared_device_pin_tries.first_failed_at < now() - make_interval(mins => ${PIN_LOCK_MINUTES})
                               THEN now() ELSE shared_device_pin_tries.first_failed_at END
      RETURNING failures`
    if (r.failures >= limit) {
      await tx`
        UPDATE shared_device_pin_tries
           SET locked_until = now() + make_interval(mins => ${PIN_LOCK_MINUTES}), failures = 0, first_failed_at = NULL
         WHERE device_id = ${deviceId} AND tenant_id = ${req.tenantId} AND person_key = ${k}`
      left[k] = 0
    } else left[k] = limit - r.failures
  }
  return left
}

/** Is `pin` this person's? Returns { name, staffId | userId } or null; never says which part was wrong. */
async function checkPin(tx, req, device, kind, id, pin) {
  if (!PIN_PATTERN.test(pin)) return null
  if (kind === 'staff') {
    const [s] = await tx`
      SELECT s.id, s.name, s.pos_pin_hash, ps.pin_salt
        FROM cash_staff s
        JOIN pos_settings ps ON ps.venue_id = s.venue_id AND ps.tenant_id = s.tenant_id
       WHERE s.id = ${id} AND s.tenant_id = ${req.tenantId} AND s.venue_id = ${device.venue_id}
         AND s.is_active = true AND (s.left_on IS NULL OR s.left_on >= current_date)
         AND s.pos_pin_hash IS NOT NULL
       LIMIT 1`
    if (!s) return null
    return sameHash(await hashPin(pin, s.pin_salt), s.pos_pin_hash) ? { name: s.name, staffId: s.id } : null
  }
  const [u] = await tx`
    SELECT u.id, COALESCE(NULLIF(btrim(u.full_name), ''), u.email) AS name, p.pin_hash, p.salt
      FROM user_office_pins p
      JOIN users u ON u.id = p.user_id AND u.tenant_id = p.tenant_id
     WHERE p.user_id = ${id} AND p.tenant_id = ${req.tenantId}
       AND u.is_active = true AND u.auth0_user_id IS NOT NULL
     LIMIT 1`
  if (!u) return null
  return sameHash(await hashPin(pin, u.salt), u.pin_hash) ? { name: u.name, userId: u.id } : null
}

/** Was this device shared by one of these (its created_by: the account's email, or its sub without one)? */
const sharedBy = (d, ...names) => !!d.created_by && names.some(n => n && n === d.created_by)

/** May the signed-in account stop this device being shared (Settings Manage, or it shared it)? */
async function accountMayStop(req, d) {
  if (sharedBy(d, req.user?.email, req.user?.sub)) return true
  // (With an office PIN person switched in, held to theirs too: permissionLevel().)
  return permissionAtLeast(await permissionLevel(req, 'settings'), 'manage')
}

/**
 * Why stopping device `d` being shared is refused, or null when it may go.
 * The route is config.sharedDevice FREE and judges itself, because the
 * person check every other change runs refused the owner on their own
 * shared phone: nobody could be switched in as them without an office PIN,
 * and one can't be set on a shared device.
 *
 *   An office PIN person switched in   answers for themselves: Settings
 *                                      Manage (held to the account's, as
 *                                      everywhere) or they shared it.
 *   Otherwise (off a shared device,    the signed-in account answers:
 *   nobody or a till PIN switched in)  Settings Manage or it shared it. On a
 *                                      shared device, an account that has an
 *                                      office PIN says who it is first, so
 *                                      someone else at the device can't stop
 *                                      it as them. Stopping another device
 *                                      from a shared one always needs an
 *                                      office PIN person.
 *
 * With no office PIN switched in, anyone holding the device can be the one
 * stopping it, and the device would then run as the account with nobody's
 * PIN asked: so a device that stops itself that way answers sign_out: true
 * and the page signs out (lib/api.js callers: SharedDeviceSettings), and
 * getting back in needs the account's own sign-in.
 */
async function stopRefusal(req, d) {
  const refused = { status: 403, body: { error: 'Only someone with Settings Manage, or the person who shared it, can stop a device being shared.' } }
  if (req.acting?.kind === 'office') {
    if (permissionAtLeast(await permissionLevel(req, 'settings'), 'manage')) return null
    const [u] = await withTenant(req.tenantId, tx => tx`
      SELECT email, auth0_user_id FROM users WHERE id = ${req.acting.userId} AND tenant_id = ${req.tenantId} LIMIT 1`)
    return u && sharedBy(d, u.email, u.auth0_user_id) ? null : refused
  }
  if (!(await accountMayStop(req, d))) return refused
  if (!req.sharedDevice) return null
  const device = { id: req.sharedDevice.id, name: req.sharedDevice.name }
  // Another device, from a shared one: only an office PIN person may (the
  // sign-out below protects this device, not that one).
  if (req.sharedDevice.id !== d.id) {
    return req.acting
      ? { status: 403, body: { error: 'A till PIN is enough for logging checks only. Use your office PIN for this change.', code: 'office_pin_needed', device } }
      : { status: 403, body: { error: 'This is a shared device: say who you are with your PIN before making a change.', code: 'person_needed', device } }
  }
  const [pin] = await withTenant(req.tenantId, tx => tx`
    SELECT 1 FROM user_office_pins p
      JOIN users u ON u.id = p.user_id AND u.tenant_id = p.tenant_id
     WHERE p.tenant_id = ${req.tenantId} AND u.auth0_user_id = ${req.user.sub} LIMIT 1`)
  if (!pin) return null
  return req.acting
    ? { status: 403, body: { error: 'A till PIN is enough for logging checks only. Use your office PIN for this change.', code: 'office_pin_needed', device } }
    : { status: 403, body: { error: 'This is a shared device: say who you are with your PIN before making a change.', code: 'person_needed', device } }
}

function refuseOnSharedDevice(req) {
  if (req.headers[DEVICE_HEADER]) throw httpError(409, 'Set your own PIN on your own phone or computer, not on a shared device.')
}

export default async function sharedDeviceRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.get('/', { preHandler: requirePermission('settings', 'view') }, async req => {
    const rows = await withTenant(req.tenantId, tx => tx`
      SELECT d.id, d.name, d.kind, d.venue_id, v.name AS venue_name, d.created_at, d.last_seen_at, d.created_by,
             (SELECT p.name FROM shared_device_people p
               WHERE p.device_id = d.id AND p.tenant_id = d.tenant_id AND p.ended_at IS NULL
                 AND p.last_used_at > now() - make_interval(secs => ${ACT_IDLE_SECONDS})
                 AND p.started_at > now() - make_interval(mins => ${ACT_MAX_MINUTES})
               ORDER BY p.started_at DESC LIMIT 1) AS person_name
        FROM shared_devices d
        JOIN venues v ON v.id = d.venue_id AND v.tenant_id = d.tenant_id
       WHERE d.tenant_id = ${req.tenantId}
       ORDER BY v.name, d.name`)
    const manage = await accountMayStop(req, {})
    return rows.map(({ created_by, ...d }) => ({ ...d, can_stop: manage || sharedBy({ created_by }, req.user?.email, req.user?.sub) }))
  })

  app.post('/', { preHandler: requirePermission('settings', 'manage') }, async (req, reply) => {
    const body = MarkBody.parse(req.body ?? {})
    const token = DEVICE_TOKEN_PREFIX + randomBytes(32).toString('hex')
    const row = await withTenant(req.tenantId, async tx => {
      const [v] = await tx`SELECT id, name FROM venues WHERE id = ${body.venue_id} AND tenant_id = ${req.tenantId}`
      if (!v) throw httpError(404, 'Venue not found')
      const [d] = await tx`
        INSERT INTO shared_devices (tenant_id, venue_id, name, kind, token_hash, created_by, last_seen_at)
        VALUES (${req.tenantId}, ${v.id}, ${body.name}, ${body.kind}, ${hashToken(token)}, ${req.user.email || req.user.sub}, now())
        RETURNING id, name, kind, venue_id`
      return { ...d, venue_name: v.name }
    })
    return reply.code(201).send({ device: deviceView(row), token })
  })

  // FREE: the person check is stopRefusal()'s, not sharedDeviceGuard()'s.
  app.delete('/:id', { config: { sharedDevice: FREE } }, async (req, reply) => {
    if (!req.tenantId) throw httpError(400, 'No tenant context')
    const id = z.string().uuid().safeParse(req.params.id)
    if (!id.success) throw httpError(404, 'Device not found')
    const [d] = await withTenant(req.tenantId, tx => tx`
      SELECT id, created_by FROM shared_devices WHERE id = ${id.data} AND tenant_id = ${req.tenantId}`)
    if (!d) throw httpError(404, 'Device not found')
    const refused = await stopRefusal(req, d)
    if (refused) return reply.code(refused.status).send(refused.body)
    await withTenant(req.tenantId, tx => tx`DELETE FROM shared_devices WHERE id = ${d.id} AND tenant_id = ${req.tenantId}`)
    // Stopped from the device itself with nobody proving who they are: sign it out.
    const signOut = req.sharedDevice?.id === d.id && req.acting?.kind !== 'office'
    req.log.info({ device: d.id, by: req.acting?.name || req.user?.email || req.user?.sub, from: req.sharedDevice?.id ?? null, sign_out: signOut }, 'shared device stopped')
    return { ok: true, sign_out: signOut }
  })

  app.get('/this', async req => {
    const device = await thisDevice(req)
    const token = req.headers[ACT_HEADER]
    const person = typeof token === 'string' ? await findPerson(req.tenantId, device.id, token) : null
    withTenant(req.tenantId, tx => tx`UPDATE shared_devices SET last_seen_at = now() WHERE id = ${device.id} AND tenant_id = ${req.tenantId}`)
      .catch(() => {})
    const [row] = await withTenant(req.tenantId, tx => tx`SELECT created_by FROM shared_devices WHERE id = ${device.id} AND tenant_id = ${req.tenantId}`)
    return { device: deviceView(device), person: personView(person), idle_seconds: ACT_IDLE_SECONDS, can_stop: await accountMayStop(req, row || {}) }
  })

  app.get('/people', async req => {
    const device = await thisDevice(req)
    return withTenant(req.tenantId, async tx => {
      const staff = await tx`
        SELECT id, name FROM cash_staff
         WHERE tenant_id = ${req.tenantId} AND venue_id = ${device.venue_id}
           AND is_active = true AND (left_on IS NULL OR left_on >= current_date)
           AND pos_pin_hash IS NOT NULL
         ORDER BY sort_order, name`
      const users = await tx`
        SELECT u.id, COALESCE(NULLIF(btrim(u.full_name), ''), u.email) AS name
          FROM user_office_pins p
          JOIN users u ON u.id = p.user_id AND u.tenant_id = p.tenant_id
         WHERE p.tenant_id = ${req.tenantId} AND u.is_active = true AND u.auth0_user_id IS NOT NULL
         ORDER BY 2`
      return {
        device: deviceView(device),
        people: [
          ...users.map(u => ({ key: 'user:' + u.id, name: u.name, pin: 'office' })),
          ...staff.map(s => ({ key: 'staff:' + s.id, name: s.name, pin: 'till' })),
        ],
      }
    })
  })

  app.post('/act', { config: { sharedDevice: FREE } }, async (req, reply) => {
    const device = await thisDevice(req)
    const body = ActBody.safeParse(req.body ?? {})
    if (!body.success) throw httpError(422, 'Pick your name and type your PIN.')
    const [kind, id] = body.data.person.split(':')
    const key = (kind === 'staff' ? 'staff:' : 'user:') + id.toLowerCase()
    const token = ACT_TOKEN_PREFIX + randomBytes(32).toString('hex')
    const out = await withTenant(req.tenantId, async tx => {
      const locked = await locks(tx, req, device.id, key)
      if (locked.length) {
        const until = locked.map(l => new Date(l.locked_until)).sort((a, b) => b - a)[0]
        const mins = Math.max(1, Math.ceil((until - Date.now()) / 60000))
        return { status: 429, body: { error: 'Too many wrong PINs on this device. Try again in ' + mins + (mins === 1 ? ' minute.' : ' minutes.'), code: 'pin_locked', minutes: mins } }
      }
      const who = await checkPin(tx, req, device, kind, id, body.data.pin)
      if (!who) {
        const left = await countWrong(tx, req, device.id, key)
        const tries = Math.min(left[key], left['*'])
        return { status: 403, body: tries > 0
          ? { error: 'That name and PIN don\'t match.', code: 'pin_wrong', tries_left: tries }
          : { error: 'Too many wrong PINs on this device. Try again in ' + PIN_LOCK_MINUTES + ' minutes.', code: 'pin_locked', minutes: PIN_LOCK_MINUTES } }
      }
      await tx`DELETE FROM shared_device_pin_tries WHERE device_id = ${device.id} AND tenant_id = ${req.tenantId} AND person_key = ${key}`
      // One person at a time: whoever was switched in is switched out.
      await tx`UPDATE shared_device_people SET ended_at = now() WHERE device_id = ${device.id} AND tenant_id = ${req.tenantId} AND ended_at IS NULL`
      await tx`
        INSERT INTO shared_device_people (tenant_id, device_id, kind, user_id, staff_id, name, token_hash)
        VALUES (${req.tenantId}, ${device.id}, ${kind === 'staff' ? 'till' : 'office'}, ${who.userId ?? null}, ${who.staffId ?? null},
                ${who.name}, ${hashToken(token)})`
      await tx`UPDATE shared_devices SET last_seen_at = now() WHERE id = ${device.id} AND tenant_id = ${req.tenantId}`
      return { status: 200, body: { token, person: { kind: kind === 'staff' ? 'till' : 'office', name: who.name, idle_seconds: ACT_IDLE_SECONDS } } }
    })
    return reply.code(out.status).send(out.body)
  })

  app.post('/lock', { config: { sharedDevice: FREE } }, async req => {
    const device = await thisDevice(req)
    const token = req.headers[ACT_HEADER]
    await withTenant(req.tenantId, tx => tx`
      UPDATE shared_device_people SET ended_at = now()
       WHERE device_id = ${device.id} AND tenant_id = ${req.tenantId} AND ended_at IS NULL
         AND (${typeof token !== 'string'} OR token_hash = ${typeof token === 'string' ? hashToken(token) : ''})`)
    return { ok: true }
  })

  app.post('/still-here', { config: { sharedDevice: FREE } }, async req => {
    const device = await thisDevice(req)
    const token = req.headers[ACT_HEADER]
    const person = typeof token === 'string' ? await findPerson(req.tenantId, device.id, token, { touch: true }) : null
    return { person: personView(person) }
  })

  // ── The person's own office PIN ───────────────────────────
  app.get('/my-pin', async req => {
    if (!req.tenantId) throw httpError(400, 'No tenant context')
    const [row] = await withTenant(req.tenantId, tx => tx`
      SELECT p.set_at FROM user_office_pins p
        JOIN users u ON u.id = p.user_id AND u.tenant_id = p.tenant_id
       WHERE p.tenant_id = ${req.tenantId} AND u.auth0_user_id = ${req.user.sub} LIMIT 1`)
    return { set: !!row, set_at: row?.set_at ?? null }
  })

  app.put('/my-pin', async req => {
    if (!req.tenantId) throw httpError(400, 'No tenant context')
    refuseOnSharedDevice(req)
    const { pin } = PinBody.parse(req.body ?? {})
    const weak = weakPin(pin)
    if (weak) throw httpError(422, 'That PIN is too easy to guess (' + weak.toLowerCase() + ')')
    const salt = randomBytes(16).toString('hex')
    const hash = await hashPin(pin, salt)
    const set = await withTenant(req.tenantId, async tx => {
      const [u] = await tx`SELECT id FROM users WHERE tenant_id = ${req.tenantId} AND auth0_user_id = ${req.user.sub} AND is_active = true LIMIT 1`
      if (!u) throw httpError(403, 'Only a member of this group can set an office PIN here.')
      const [row] = await tx`
        INSERT INTO user_office_pins (user_id, tenant_id, pin_hash, salt, set_at)
        VALUES (${u.id}, ${req.tenantId}, ${hash}, ${salt}, now())
        ON CONFLICT (user_id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, salt = EXCLUDED.salt, set_at = now()
        RETURNING set_at`
      // A new PIN ends any switch made with the old one.
      await tx`UPDATE shared_device_people SET ended_at = now() WHERE tenant_id = ${req.tenantId} AND user_id = ${u.id} AND ended_at IS NULL`
      return row
    })
    return { set: true, set_at: set.set_at }
  })

  app.delete('/my-pin', async req => {
    if (!req.tenantId) throw httpError(400, 'No tenant context')
    refuseOnSharedDevice(req)
    await withTenant(req.tenantId, async tx => {
      const [u] = await tx`SELECT id FROM users WHERE tenant_id = ${req.tenantId} AND auth0_user_id = ${req.user.sub} LIMIT 1`
      if (!u) return
      await tx`DELETE FROM user_office_pins WHERE user_id = ${u.id} AND tenant_id = ${req.tenantId}`
      await tx`UPDATE shared_device_people SET ended_at = now() WHERE tenant_id = ${req.tenantId} AND user_id = ${u.id} AND ended_at IS NULL`
    })
    return { set: false }
  })
}

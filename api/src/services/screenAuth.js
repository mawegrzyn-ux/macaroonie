// src/services/screenAuth.js
//
// How a menu screen signs in (migration 166). A screen is a paired device,
// not a person: it sends `Authorization: Screen <screen id>.<secret>` (and
// the same pair on the WebSocket). The secret is made by the API when the
// screen asks for a pairing code and kept only on the screen; the API keeps
// its sha256, first on the pairing row, then on the screen once someone
// types the code into Screens.
//
// Kept apart from screenSvc.js (which loads menus) so config/ws.js can
// import it without pulling in the menu code.

import crypto from 'node:crypto'
import { sql } from '../config/db.js'

export const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex')
export const newSecret = () => crypto.randomBytes(32).toString('base64url')

// Codes are typed from across the room: no 0/O, 1/I/L.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const PAIRING_MINUTES = 15

/** A six-character pairing code, shown as ABC-DEF. */
export function newScreenCode() {
  const bytes = crypto.randomBytes(6)
  let out = ''
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length]
  return out.slice(0, 3) + '-' + out.slice(3)
}

export const normaliseScreenCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

export function sameHash(a, b) {
  if (!a || !b || a.length !== b.length) return false
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// id -> { screen, at }. Short, so a removed screen stops within seconds;
// forgetScreen() clears it at once on this process.
const cache = new Map()
const CACHE_MS = 15_000

export function forgetScreen(id) { cache.delete(id) }

async function loadScreen(id) {
  const hit = cache.get(id)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.screen
  const [s] = await sql`
    SELECT s.id, s.tenant_id, s.venue_id, s.name, s.short_code, s.secret_hash,
           t.is_active AS tenant_active,
           COALESCE((SELECT m.is_enabled FROM tenant_modules m WHERE m.tenant_id = s.tenant_id AND m.module_key = 'screens'), true) AS screens_enabled
      FROM screens s
      JOIN tenants t ON t.id = s.tenant_id
     WHERE s.id = ${id}
     LIMIT 1`
  if (s) cache.set(id, { screen: s, at: Date.now() })
  else cache.delete(id)
  return s || null
}

/** The paired screen for an id and secret, or null. */
export async function verifyScreen(id, secret) {
  if (!UUID_RE.test(String(id || '')) || !secret) return null
  const s = await loadScreen(id)
  if (!s || !s.secret_hash || !s.tenant_active) return null
  if (!sameHash(sha256(secret), s.secret_hash)) return null
  return s
}

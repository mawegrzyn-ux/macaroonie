// src/services/previewLinks.js
//
// Signed links into the till app that need no pairing: the kiosk design
// editor's live preview (services/kioskSvc.js) and the kitchen test bench
// (services/kitchenSvc.js kitchenTestData()). The link is the key, so it
// names its kind, its tenant and venue, and runs out after a few hours.
//
//   makeLink(kind, data, hours)   'payload.signature' (base64url)
//   readLink(kind, token)         the data for a valid, unexpired link of
//                                 that kind, else null (a kiosk link never
//                                 opens the kitchen bench, and back)
//
// The signing key is made once and kept sealed in platform_secrets.

import crypto from 'node:crypto'
import { sql } from '../config/db.js'
import { seal, unseal } from './vault.js'

// The key kept its first name (kiosk previews came first).
const SECRET_NAME = 'kiosk_preview_key'
let secretCache = null

async function secret() {
  if (secretCache) return secretCache
  const [row] = await sql`SELECT value FROM platform_secrets WHERE name = ${SECRET_NAME}`
  if (row) return (secretCache = unseal(row.value))
  const value = crypto.randomBytes(32).toString('base64url')
  await sql`
    INSERT INTO platform_secrets (name, value, hint, updated_by)
    VALUES (${SECRET_NAME}, ${seal(value)}, 'preview links', 'system')
    ON CONFLICT (name) DO NOTHING`
  const [again] = await sql`SELECT value FROM platform_secrets WHERE name = ${SECRET_NAME}`
  return (secretCache = unseal(again.value))
}

const sign = (key, payload) => crypto.createHmac('sha256', key).update(payload).digest('base64url')

/** A link token of this kind carrying `data` (small: ids only), good for `hours`. */
export async function makeLink(kind, data, hours) {
  const payload = Buffer.from(JSON.stringify({ ...data, k: kind, e: Date.now() + hours * 3600_000 })).toString('base64url')
  return payload + '.' + sign(await secret(), payload)
}

/** The data of a valid, unexpired link of this kind (with `expires_at`), else null. */
export async function readLink(kind, token) {
  const m = /^([A-Za-z0-9_-]{20,600})\.([A-Za-z0-9_-]{40,60})$/.exec(String(token || ''))
  if (!m) return null
  const want = sign(await secret(), m[1])
  if (want.length !== m[2].length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(m[2]))) return null
  let p
  try { p = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')) } catch { return null }
  if (!p || p.k !== kind || !(p.e > Date.now())) return null
  const { k, e, ...data } = p
  return { ...data, expires_at: new Date(e).toISOString() }
}

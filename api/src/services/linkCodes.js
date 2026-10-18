// src/services/linkCodes.js
//
// Codes a device shows until someone links it from the installer app
// (installer.<root>, admin/src/pages/installer) or the admin: menu screens
// (screen_pairings, migration 166) and tills, kitchen screens and kiosks
// (pos_pairings, migration 184). Both are six characters from one alphabet
// and a code is never live in both tables at once, so a code typed into the
// installer finds one device. The API makes the device's secret with the
// code, gives it to the device only and keeps its hash; linking copies the
// hash onto the screen or till, which then signs in with the secret it kept.

import { newScreenCode, normaliseScreenCode, sha256 } from './screenAuth.js'
import { installerOrigin } from './platformHost.js'

export const LINK_MINUTES = 15
export const newLinkCode = newScreenCode
export const linkCodeHash = code => sha256(normaliseScreenCode(code))

/** The installer app's page for a code: what the device's QR code opens. */
export function linkUrl(code) {
  return installerOrigin() + '/link/' + encodeURIComponent(code)
}

/** Is this code (hash) live in either table? `db` runs in system mode. */
export async function linkCodeTaken(db, hash) {
  const [hit] = await db`
    SELECT 1 FROM screen_pairings WHERE code_hash = ${hash} AND claimed_at IS NULL AND expires_at > now()
    UNION ALL
    SELECT 1 FROM pos_pairings WHERE code_hash = ${hash} AND claimed_at IS NULL AND expires_at > now()
    LIMIT 1`
  return !!hit
}

/**
 * What a typed code belongs to, in a tenant's transaction (unclaimed codes
 * are every tenant's to find): { type: 'screen' | 'device', app, device_info,
 * expires_at, claimed } or null.
 */
export async function findLinkCode(tx, code) {
  const hash = linkCodeHash(code)
  const [s] = await tx`SELECT device_info, expires_at, claimed_at FROM screen_pairings WHERE code_hash = ${hash}`
  if (s) return { type: 'screen', app: null, device_info: s.device_info || {}, expires_at: s.expires_at, claimed: !!s.claimed_at }
  const [p] = await tx`SELECT app, device_info, expires_at, claimed_at FROM pos_pairings WHERE code_hash = ${hash}`
  if (p) return { type: 'device', app: p.app, device_info: p.device_info || {}, expires_at: p.expires_at, claimed: !!p.claimed_at }
  return null
}

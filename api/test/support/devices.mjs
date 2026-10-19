// Tills, kitchen screens and kiosks are set up one way (migration 184): the
// device asks for a code to show (POST /pos-api/pairings, no sign-in),
// someone signed in links that code at a venue (POST /api/pos/venues/:id/link,
// from Till setup or the installer app), and the device then signs in as
// `Device <id>.<the secret it was given with its code>`.
import { getApp, ok } from './app.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../../src/middleware/auth.js'

/** The code a device shows: { id, code, secret, expires_at, link_url }. `kind` = the address it runs on. */
export async function showCode(kind, device = {}) {
  const app = await getApp()
  const res = await app.inject({
    method: 'POST', url: '/pos-api/pairings',
    headers: { 'content-type': 'application/json', [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET },
    payload: JSON.stringify({ ...(kind ? { app: kind } : {}), device }),
  })
  if (res.statusCode !== 200) throw new Error('device code failed: ' + res.statusCode + ' ' + res.body)
  return res.json()
}

/**
 * A device showing a code, linked by `client` at `venueId`: a new device
 * (name, settings) or a new device for one already there (deviceId).
 * Returns { device, id, device_id, secret } (device_id + secret sign it in).
 */
export async function linkDevice(client, venueId, { kind = 'terminal', name, settings = {}, deviceId = null } = {}) {
  const shown = await showCode(kind)
  const body = deviceId ? { code: shown.code, device_id: deviceId } : { code: shown.code, name, settings }
  const out = await ok(client.post(`/api/pos/venues/${venueId}/link`, body), 'link ' + (name || kind))
  return { device: out.device, id: out.device.id, device_id: out.device.id, secret: shown.secret }
}

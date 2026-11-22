// src/services/weatherKey.js
//
// The Open-Meteo API key for the Local info weather captures (22 Nov 2026).
// Open-Meteo's free API is for non-commercial use; with a paid plan's key
// saved on the Platform page (Services tab) the captures go to Open-Meteo's
// customer hosts and send the key. Without one they use the free hosts. The
// key is stored sealed in platform_secrets as 'open_meteo_key' (vault.js)
// and never sent back: the admin sees its last four characters. Each API
// process keeps it for KEY_TTL_MS, so a key saved in one reaches the others
// within that time.
//
//   weatherKey()                 the saved key, or null
//   meteoUrl(base, path, query, key)  the address for a call: the customer
//                                host and &apikey= when there is a key
//   weatherKeyInfo()             { saved: { hint, updated_by, updated_at } | null }
//   checkWeatherKey(key)         { ok, message? }: one small call with the key
//   saveWeatherKey(key, by), removeWeatherKey()

import { sql } from '../config/db.js'
import { env } from '../config/env.js'
import { seal, unseal } from './vault.js'

const SECRET = 'open_meteo_key'
const KEY_TTL_MS = 15_000

let cached = null   // { key, at }

export async function weatherKey() {
  if (cached && Date.now() - cached.at < KEY_TTL_MS) return cached.key
  const [row] = await sql`SELECT value FROM platform_secrets WHERE name = ${SECRET}`
  cached = { key: row ? unseal(row.value) : null, at: Date.now() }
  return cached.key
}

const forget = () => { cached = null }

/** Open-Meteo's free hosts have a paid twin, used with a key; any other host (a stand-in) is kept. */
export function meteoUrl(base, path, query, key = null) {
  let host = String(base || '').replace(/\/+$/, '')
  if (key) {
    host = host.replace('://api.open-meteo.com', '://customer-api.open-meteo.com')
      .replace('://geocoding-api.open-meteo.com', '://customer-geocoding-api.open-meteo.com')
  }
  return host + path + '?' + query + (key ? '&apikey=' + encodeURIComponent(key) : '')
}

export async function weatherKeyInfo() {
  const [row] = await sql`SELECT hint, updated_by, updated_at FROM platform_secrets WHERE name = ${SECRET}`
  return { saved: row ? { hint: row.hint, updated_by: row.updated_by, updated_at: row.updated_at } : null }
}

/** Asks Open-Meteo for one temperature with the key. */
export async function checkWeatherKey(key) {
  const url = meteoUrl(env.OPEN_METEO_URL, '/v1/forecast', 'latitude=51.5&longitude=0&current=temperature_2m', key)
  let res
  try {
    res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
  } catch {
    return { ok: false, message: 'Couldn\'t reach Open-Meteo to check the key. Try again in a moment.' }
  }
  if (res.ok) return { ok: true }
  let reason = ''
  try { reason = String((await res.json())?.reason || '') } catch { /* not JSON */ }
  return { ok: false, message: 'Open-Meteo refused this key' + (reason ? ': ' + reason.slice(0, 200) : ' (' + res.status + ')') + '.' }
}

export async function saveWeatherKey(key, updatedBy) {
  await sql`
    INSERT INTO platform_secrets (name, value, hint, updated_by)
    VALUES (${SECRET}, ${seal(key)}, ${key.slice(-4)}, ${updatedBy})
    ON CONFLICT (name) DO UPDATE SET
      value = EXCLUDED.value, hint = EXCLUDED.hint, updated_by = EXCLUDED.updated_by, updated_at = now()`
  forget()
}

export async function removeWeatherKey() {
  await sql`DELETE FROM platform_secrets WHERE name = ${SECRET}`
  forget()
}

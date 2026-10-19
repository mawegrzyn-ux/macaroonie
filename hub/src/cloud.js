// hub/src/cloud.js
//
// The hub's side of the cloud's /pos-api (api/src/routes/posApi.js): asking
// for a link code (shown in the hub's window, typed in Till setup →
// Printers), waiting for it to be linked, then calling the API as the
// linked device (`Authorization: Device <id>.<secret>`).

const UA = 'macaroonie-hub'

async function call(fetchImpl, url, { method = 'GET', headers = {}, body, timeoutMs = 15000 } = {}) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, {
      method, signal: ctl.signal,
      headers: { 'user-agent': UA, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const err = new Error(data?.error || ('The cloud answered ' + res.status))
      err.status = res.status
      throw err
    }
    return data
  } finally {
    clearTimeout(t)
  }
}

/** A new link code for this hub: { id, code, secret, expires_at, link_url }. */
export function requestCode(api, { fetchImpl = fetch, version = null } = {}) {
  return call(fetchImpl, api + '/pos-api/pairings', { method: 'POST', body: { app: 'hub', device: { app_version: version, ua: UA } } })
}

/** Whether the code was linked: { status: 'waiting' | 'paired' | 'expired', device_id, name, venue_name }. */
export async function codeStatus(api, pairing, { fetchImpl = fetch } = {}) {
  try {
    return await call(fetchImpl, api + '/pos-api/pairings/' + pairing.id, { headers: { authorization: 'Pairing ' + pairing.secret } })
  } catch (e) {
    if (e.status === 404) return { status: 'expired' }
    throw e
  }
}

/** The API as a linked hub. */
export function cloudClient({ api, deviceId, secret, fetchImpl = fetch }) {
  const auth = { authorization: 'Device ' + deviceId + '.' + secret }
  const req = (method, path, body) => call(fetchImpl, api + path, { method, headers: auth, body })
  return {
    config: () => req('GET', '/pos-api/config'),
    claim: (limit = 20) => req('POST', '/pos-api/print-jobs/claim', { limit }),
    done: (id, status, error = null) => req('POST', '/pos-api/print-jobs/' + id + '/status', { status, error }),
    report: body => req('POST', '/pos-api/hub/status', body),
  }
}

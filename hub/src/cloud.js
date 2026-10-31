// hub/src/cloud.js
//
// The hub's side of the cloud's /pos-api (api/src/routes/posApi.js): asking
// for a link code (shown in the hub's window, typed in Store tech →
// Venue hub), waiting for it to be linked, then calling the API as the
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

/** Whether the code was linked: { status: 'waiting' | 'paired' | 'expired', device_id, name, venue_name, tenant_name }. */
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
  const req = (method, path, body, timeoutMs) => call(fetchImpl, api + path, { method, headers: auth, body, timeoutMs })
  return {
    deviceId,
    config: () => req('GET', '/pos-api/config'),
    // What this hub is: its name, venue and restaurant group (link.js, the installer).
    me: () => req('GET', '/pos-api/me', undefined, 8000),
    // The hub leaves its venue (link.js unlink()): Store tech shows it Not linked.
    disconnect: () => req('POST', '/pos-api/disconnect', {}, 8000),
    claim: (limit = 20) => req('POST', '/pos-api/print-jobs/claim', { limit }),
    done: (id, status, error = null) => req('POST', '/pos-api/print-jobs/' + id + '/status', { status, error }),
    report: body => req('POST', '/pos-api/hub/status', body),
    // Hub first (docs/POS.md section 11): the venue's copy.
    hubContext: version => req('GET', '/pos-api/hub/context' + (version ? '?version=' + encodeURIComponent(version) : '')),
    hubSync: since => req('GET', '/pos-api/hub/sync?since=' + (Number(since) || 0), undefined, 10000),
    hubEvents: body => req('POST', '/pos-api/hub/events', body, 20000),
  }
}

// Where the till sends its events and gets other tills' changes.
//
// Now: the cloud (/pos-api on this same host). Later (docs/POS.md): the
// venue hub serves the same API on the LAN; the till will try the hub first
// and fall back to the cloud. Everything else in the till talks to this
// module only, so adding the hub changes nothing else.

export const APP_VERSION = '1.0.0'

export class OfflineError extends Error {
  constructor() { super('No connection'); this.offline = true }
}

export function createTransport(device) {
  // Provision for the hub: a device setting will hold its LAN address.
  const bases = [device?.hub_url, ''].filter(v => v !== undefined && v !== null)

  async function request(method, path, body, { timeoutMs = 12000, headers: extra = null } = {}) {
    const headers = { 'X-Pos-Version': APP_VERSION }
    if (device?.id && device?.secret) headers.Authorization = 'Device ' + device.id + '.' + device.secret
    if (extra) Object.assign(headers, extra)
    if (body !== undefined) headers['content-type'] = 'application/json'
    let lastErr = null
    for (const base of bases) {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeoutMs)
      let res
      try {
        res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ctrl.signal })
      } catch {
        lastErr = new OfflineError()
        continue
      } finally {
        clearTimeout(timer)
      }
      const text = await res.text()
      let data = null
      try { data = text ? JSON.parse(text) : null } catch { data = { error: text } }
      if (!res.ok) {
        const err = new Error(data?.error || res.statusText || 'Request failed')
        err.status = res.status
        err.code = data?.code || null
        err.details = Array.isArray(data?.errors) ? data.errors : null
        throw err
      }
      return data
    }
    throw lastErr || new OfflineError()
  }

  function socketUrl() {
    if (!device?.id) return null
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return proto + '//' + location.host + '/ws?pos_device=' + encodeURIComponent(device.id) + '&secret=' + encodeURIComponent(device.secret)
  }

  return {
    get: (p, o) => request('GET', p, undefined, o),
    post: (p, b, o) => request('POST', p, b ?? {}, o),
    put: (p, b, o) => request('PUT', p, b ?? {}, o),
    socketUrl,
  }
}

// Where a till, kiosk or kitchen screen sends its events and gets the
// venue's changes.
//
// The cloud (/pos-api on this same host) always works. At a hub-first
// location (docs/POS.md section 11) the device's config names the venue hub
// on the venue network (config.hub: { id, urls, lan_key }); the calls the hub
// serves (events, sync, kitchen sync, the day's figures, checks, presence)
// go to the hub first, with a short timeout, and to the cloud when it
// doesn't answer. After a failure the hub is asked again only by a quiet
// check every 30 s (GET /lan/ping), so a hub that is off never slows the
// device down. Everything else (config, prices, card machines, loyalty) goes
// to the cloud.
//
// The hub serves plain http on the venue network, which an https page in a
// browser may not call (mixed content): hub first works inside the
// Macaroonie Android app (its WebView allows it), or on a device served over
// http; anywhere else the device simply uses the cloud.

import { IN_APP } from './nativeApp.js'

export const APP_VERSION = '1.0.0'

export class OfflineError extends Error {
  constructor() { super('No connection'); this.offline = true }
}

// The calls the hub serves (hub/src/lan.js).
const HUB_PATHS = [
  /^\/pos-api\/events$/,
  /^\/pos-api\/sync(\?|$)/,
  /^\/pos-api\/kitchen\/sync(\?|$)/,
  /^\/pos-api\/reports\/day$/,
  /^\/pos-api\/checks(\?|\/|$)/,
  /^\/pos-api\/presence$/,
]
// Tickets the hub queued for a printer plugged into this device: only the hub knows them.
const HUB_ONLY = /^\/pos-api\/print-jobs\/hub-/
export const HUB_TIMEOUT_MS = 2500
export const HUB_RETRY_MS = 30000
// A hub that doesn't know this device yet (just linked: it loads the set-up
// again when asked by a key it doesn't know) is asked again sooner.
export const HUB_RETRY_UNKNOWN_MS = 5000

/** May this page call the hub at all (see above)? */
export function hubAllowed() {
  return IN_APP || (typeof location !== 'undefined' && location.protocol === 'http:')
}

// opts.pending(): how many changes the device hasn't sent yet, told to the
// server on every call (X-Pos-Pending) so closing the day can say which
// devices still have some (migration 217).
// opts.hub(): the device's config.hub, or null (read on every call: the
// config can change). opts.onHub(state): the hub became usable or not.
export function createTransport(device, { pending = null, hub = null, onHub = null } = {}) {
  const hubState = { ok: null, url: null, key: null, probe: null }

  function hubCfg() {
    const h = hub?.()
    if (!h?.lan_key || !h?.urls?.length || !device?.id || !hubAllowed()) return null
    const key = h.lan_key + '|' + h.urls.join(',')
    if (hubState.key !== key) {
      // Another hub, address or key: start again.
      hubState.key = key
      hubState.ok = null
      hubState.url = null
      clearTimeout(hubState.probe)
      hubState.probe = null
    }
    return h
  }

  function setHub(ok, url = hubState.url, retryMs = HUB_RETRY_MS) {
    const was = hubState.ok
    hubState.ok = ok
    hubState.url = url
    if (!ok && !hubState.probe) hubState.probe = setTimeout(probe, retryMs)
    if (was !== ok) onHub?.({ ok, url })
  }

  function headersFor(extra, body, lan) {
    const headers = { 'X-Pos-Version': APP_VERSION }
    if (lan) headers.Authorization = 'Lan ' + device.id + '.' + lan
    else if (device?.id && device?.secret) headers.Authorization = 'Device ' + device.id + '.' + device.secret
    if (pending) headers['X-Pos-Pending'] = String(Number(pending()) || 0)
    if (extra) Object.assign(headers, extra)
    if (body !== undefined) headers['content-type'] = 'application/json'
    return headers
  }

  async function send(url, method, headers, body, timeoutMs) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    let res
    try {
      res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ctrl.signal })
    } catch {
      throw new OfflineError()
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
      err.data = data
      throw err
    }
    return data
  }

  /** The hub, at whichever of its addresses answers (the last good one first). */
  async function viaHub(h, method, path, body, extra) {
    const urls = hubState.url ? [hubState.url, ...h.urls.filter(u => u !== hubState.url)] : h.urls
    let last = new OfflineError()
    for (const base of urls) {
      try {
        const data = await send(base + path, method, headersFor(extra, body, h.lan_key), body, HUB_TIMEOUT_MS)
        if (hubState.ok !== true || hubState.url !== base) setHub(true, base)
        return data
      } catch (e) {
        last = e
        if (!e.offline) break
      }
    }
    throw last
  }

  /** A quiet check while the hub is out of use: back in use when it answers and takes events. */
  async function probe() {
    hubState.probe = null
    const h = hubCfg()
    if (!h) return false
    try {
      const r = await viaHub(h, 'GET', '/lan/ping')
      if (r?.on) return true
      setHub(false)
    } catch (e) {
      setHub(false, hubState.url, e.status === 401 ? HUB_RETRY_UNKNOWN_MS : HUB_RETRY_MS)
    }
    return false
  }

  async function request(method, path, body, { timeoutMs = 12000, headers: extra = null, via = 'auto' } = {}) {
    const h = via === 'cloud' ? null : hubCfg()
    if (h && (via === 'hub' || HUB_ONLY.test(path))) return viaHub(h, method, path, body, extra)
    if (h && hubState.ok !== false && HUB_PATHS.some(re => re.test(path.split('#')[0]))) {
      try {
        return await viaHub(h, method, path, body, extra)
      } catch (e) {
        // Not answering, switched off (409) or not knowing this device yet
        // (401): the cloud instead. Any other answer is the hub's own.
        if (!(e.offline || e.status === 409 || e.status === 401)) throw e
        setHub(false, hubState.url, e.status === 401 ? HUB_RETRY_UNKNOWN_MS : HUB_RETRY_MS)
      }
    }
    return send(path, method, headersFor(extra, body, null), body, timeoutMs)
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
    /** { configured, ok (true in use, false not answering, null not tried yet), url } */
    hubStatus: () => ({ configured: !!hubCfg(), ok: hubState.ok, url: hubState.url }),
    /** Ask the hub now (a connection check): true when it takes events. */
    pingHub: async () => (hubCfg() ? probe() : false),
    /** Whether the hub is in use now. */
    onHub: () => !!hubCfg() && hubState.ok === true,
  }
}

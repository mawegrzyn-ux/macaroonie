// Which device app this address runs. One build is served on three addresses
// (api/src/routes/posSite.js): pos.{root} the till, kitchen.{root} the kitchen
// screens (kds.{root} forwards there), kiosk.{root} the self-order kiosks.
// Each address keeps its own pairing (browser storage is per address) and
// installs as its own app. Any other address (local, tests) takes any kind.
//
// Also: moving a device paired on another address to its own (POST
// /pos-api/move hands out a one-time code, carried in #pair=), and
// disconnecting one from its settings (POST /pos-api/disconnect).

const HOST = location.hostname.toLowerCase()
const LABEL = HOST.split('.')[0]
const ROOT = HOST.split('.').slice(1).join('.')

/** 'terminal' | 'kds' | 'kiosk', or null where any kind may be paired. */
export const HOST_APP = { pos: 'terminal', kitchen: 'kds', kds: 'kds', kiosk: 'kiosk' }[LABEL] || null

const SUBDOMAIN = { terminal: 'pos', kds: 'kitchen', kiosk: 'kiosk' }
export const APP_NAMES = { terminal: 'till', kds: 'kitchen screen', kiosk: 'kiosk' }

/** The address a device of this kind opens (same scheme and port), or null off the platform's hosts. */
export function addressFor(kind) {
  if (!HOST_APP || !SUBDOMAIN[kind]) return null
  return location.protocol + '//' + SUBDOMAIN[kind] + '.' + ROOT + (location.port ? ':' + location.port : '')
}

/** The address without https:// for showing (kitchen.macaroonie.com). */
export const shortAddress = url => String(url || '').replace(/^https?:\/\//, '')

/** Does a device of this kind belong on this address? */
export const belongsHere = kind => !HOST_APP || HOST_APP === (kind || 'terminal')

// Set the page title for the address (the build's own is the till's).
if (HOST_APP === 'kds') document.title = 'Macaroonie Kitchen'
else if (HOST_APP === 'kiosk') document.title = 'Macaroonie Kiosk'
if (HOST_APP && HOST_APP !== 'terminal') {
  const meta = document.querySelector('meta[name="apple-mobile-web-app-title"]')
  if (meta) meta.setAttribute('content', HOST_APP === 'kds' ? 'Kitchen' : 'Kiosk')
}

/**
 * A pairing code handed over by a move (#pair=CODE), taken out of the
 * address at once so it isn't left in the history.
 */
export function takePairCode() {
  const m = /^#pair=([A-Za-z0-9-]{4,20})$/.exec(location.hash || '')
  if (!m) return null
  history.replaceState(null, '', location.pathname + location.search)
  return m[1]
}

const MOVED_KEY = 'maca_moved_to'

/** Where this address's device went (so an old start page still finds it). */
export function movedTo() {
  try { return localStorage.getItem(MOVED_KEY) || null } catch { return null }
}
export function setMovedTo(url) {
  try { url ? localStorage.setItem(MOVED_KEY, url) : localStorage.removeItem(MOVED_KEY) } catch { /* private mode */ }
}

/**
 * Move a device to its own address: ask for a one-time code, then open the
 * address with it. Returns { ok: false, error } when it can't (offline).
 * The caller forgets the device here once this returns ok.
 */
export async function moveDevice(api, kind) {
  try {
    const res = await api.post('/pos-api/move', {})
    const url = addressFor(res.kind || kind)
    if (!url) return { ok: false, error: 'This device has no address of its own' }
    return { ok: true, url, go: () => location.assign(url + '/#pair=' + encodeURIComponent(res.code)) }
  } catch (err) {
    return { ok: false, error: err?.offline ? 'No connection: the move needs the internet' : err?.message || 'The move didn\'t work' }
  }
}

/**
 * Tell Macaroonie this device is disconnecting (its pairing stops working).
 * Returns true when it was told; offline, the device still forgets itself and
 * Till setup can remove it or make it a new code.
 */
export async function tellDisconnect(api) {
  try { await api.post('/pos-api/disconnect', {}); return true } catch { return false }
}

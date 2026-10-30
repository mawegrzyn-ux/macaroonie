// hub/src/lan.js
//
// Hub first (docs/POS.md section 11): the part of the till API the hub
// serves on the venue network, http://<hub>:9181, from its copy of the venue
// (venue.js). Tills, kiosks and kitchen screens send their events here first
// and read the venue from here; order ready boards read their numbers. The
// same paths and answers as the cloud's /pos-api, so the devices' code is the
// same either way; anything else they ask the cloud.
//
//   GET  /lan/ping               { hub_id, on, cloud_ok, rev }: may this device use the hub now
//   POST /pos-api/events         { events } a device's events, decided here
//   GET  /pos-api/sync?since=&source=        the checks (source hub:<id>: a cursor
//   GET  /pos-api/kitchen/sync?since=&source=  from the cloud starts again)
//   GET  /pos-api/reports/day    the trading day's figures (X), with the internet down too
//   GET  /pos-api/checks?status=closed | /pos-api/checks/:id
//   POST /pos-api/presence       { check_id, staff_id } who has which check open
//   POST /pos-api/print-jobs/claim | /pos-api/print-jobs/:id/status   tickets for a
//                                printer plugged into the till or kitchen screen asking
//   GET  /screen-api/orders      an order ready board's numbers
//
// No TLS on the venue network: a device proves itself with
// `Authorization: Lan <id>.<key>`, the key from its config (the cloud gives
// the hub only its sha256). Browsers on the device addresses (https) may call
// it: CORS and Chrome's Private Network Access are answered. While hub first
// is off, or another hub takes the events, every call but /lan/ping is
// answered 409 (code hub_off) and devices use the cloud.

import http from 'node:http'

export const LAN_PORT = 9181
const MAX_BODY = 4 * 1024 * 1024
const PRESENCE_MS = 45_000
const REFRESH_MS = 10_000

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, x-pos-pending, x-pos-version',
  'access-control-max-age': '600',
}

function send(res, status, body) {
  res.writeHead(status, { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const parts = []
    req.on('data', c => {
      size += c.length
      if (size > MAX_BODY) { reject(Object.assign(new Error('Too big'), { status: 413 })); req.destroy(); return }
      parts.push(c)
    })
    req.on('end', () => {
      if (!parts.length) return resolve({})
      try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8'))) } catch { reject(Object.assign(new Error('Not JSON'), { status: 400 })) }
    })
    req.on('error', reject)
  })
}

/**
 * Serve the venue network. opts: venue (startVenue()), port (0 = any free
 * one), host, log. Resolves to { port, close() }, or null when the port is
 * taken (the hub still prints; devices use the cloud).
 */
export function startLan({ venue, port = LAN_PORT, host = '0.0.0.0', log = () => {} }) {
  const presence = new Map()   // device id -> { check_id, staff_id, at, device_name }
  let lastRefresh = 0

  function presenceList() {
    const now = Date.now()
    const out = []
    for (const [deviceId, p] of presence) {
      if (now - p.at > PRESENCE_MS) { presence.delete(deviceId); continue }
      if (p.check_id) out.push({ device_id: deviceId, ...p })
    }
    return out
  }

  async function handle(req, res) {
    if (req.method === 'OPTIONS') {
      // Chrome asks before a public page calls a private address.
      res.writeHead(204, { ...CORS, 'access-control-allow-private-network': 'true' })
      return res.end()
    }
    const url = new URL(req.url, 'http://hub')
    const p = url.pathname
    const me = venue.who(req.headers.authorization)
    if (!me) {
      // Perhaps just linked (or linked again): load the venue's set-up now
      // rather than at the next half-minute, at most every 10 s.
      if (req.headers.authorization && Date.now() - lastRefresh > REFRESH_MS) { lastRefresh = Date.now(); venue.refresh?.() }
      return send(res, 401, { error: 'This device isn\'t one of this hub\'s', code: 'lan_key' })
    }

    if (p === '/lan/ping' && req.method === 'GET') {
      const s = venue.status()
      return send(res, 200, { hub_id: venue.mirror.source.slice(4), on: venue.taking(), cloud_ok: s.cloud_ok, rev: s.rev, server_time: new Date().toISOString() })
    }
    if (!venue.taking()) return send(res, 409, { error: 'This hub isn\'t taking the venue\'s events', code: 'hub_off' })

    if (me.kind === 'screen') {
      if (p === '/screen-api/orders' && req.method === 'GET') return send(res, 200, { orders: venue.board(), server_time: new Date().toISOString(), source: venue.mirror.source })
      return send(res, 404, { error: 'Not on the hub', code: 'not_on_hub' })
    }

    const d = me.device
    if (p === '/pos-api/events' && req.method === 'POST') {
      const body = await readBody(req)
      const events = Array.isArray(body.events) ? body.events.filter(e => e && typeof e === 'object').slice(0, 200) : []
      if (!events.length) return send(res, 400, { error: 'No events' })
      return send(res, 200, await venue.takeEvents(d, events))
    }
    if (p === '/pos-api/sync' && req.method === 'GET') {
      return send(res, 200, venue.sync({
        since: Math.max(0, Number(url.searchParams.get('since')) || 0), source: url.searchParams.get('source'),
        deviceId: d.id, presence: presenceList(),
      }))
    }
    if (p === '/pos-api/kitchen/sync' && req.method === 'GET') {
      return send(res, 200, venue.kitchenSync({ since: Math.max(0, Number(url.searchParams.get('since')) || 0), source: url.searchParams.get('source') }))
    }
    if (p === '/pos-api/reports/day' && req.method === 'GET' && !url.searchParams.get('day_id')) {
      return send(res, 200, { ...venue.dayReport(), waiting: [] })
    }
    if (p === '/pos-api/checks' && req.method === 'GET') {
      const status = ['open', 'closed', 'void'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'closed'
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 60))
      return send(res, 200, venue.listChecks({ status, limit }))
    }
    const one = /^\/pos-api\/checks\/([0-9A-HJKMNP-TV-Z]{26})$/.exec(p)
    if (one && req.method === 'GET') {
      const c = venue.getCheck(one[1])
      return c ? send(res, 200, c) : send(res, 404, { error: 'Check not found' })
    }
    if (p === '/pos-api/presence' && req.method === 'POST') {
      const body = await readBody(req)
      presence.set(d.id, { check_id: typeof body.check_id === 'string' ? body.check_id : null, staff_id: typeof body.staff_id === 'string' ? body.staff_id : null, at: Date.now(), device_name: d.name })
      const cloud = venue.sync({ since: venue.mirror.rev, source: venue.mirror.source, presence: [] }).presence
      return send(res, 200, { presence: [...cloud.filter(x => !presence.has(x.device_id)), ...presenceList()] })
    }
    if (p === '/pos-api/print-jobs/claim' && req.method === 'POST') {
      const body = await readBody(req)
      return send(res, 200, venue.claimJobs(d.id, Math.min(50, Math.max(1, Number(body.limit) || 20))))
    }
    const job = /^\/pos-api\/print-jobs\/(hub-[0-9A-HJKMNP-TV-Z]{26})\/status$/.exec(p)
    if (job && req.method === 'POST') {
      const body = await readBody(req)
      const r = venue.jobDone(job[1], d.id, ['printed', 'failed', 'cancelled'].includes(body.status) ? body.status : 'printed')
      return r ? send(res, 200, r) : send(res, 404, { error: 'Print job not found' })
    }
    return send(res, 404, { error: 'Not on the hub', code: 'not_on_hub' })
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(e => {
      if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'The hub couldn\'t do that' })
      if (!e.status) log('Venue network: ' + (e.stack || e.message))
    })
  })
  // Keep-alive connections from tills polling every couple of seconds.
  server.keepAliveTimeout = 30_000
  return new Promise(resolve => {
    server.once('error', e => {
      log(`The venue network port ${port} is taken (${e.code}): devices use the cloud`)
      resolve(null)
    })
    server.listen(port, host, () => {
      const actual = server.address().port
      log(`Venue network: http://<this computer>:${actual}`)
      resolve({ port: actual, close: () => new Promise(r => server.close(() => r())), server })
    })
  })
}

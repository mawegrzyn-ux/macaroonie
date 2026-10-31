// hub/test/windows/standin.mjs
//
// A stand-in cloud for the Windows installer check (.github/workflows/
// hub-windows.yml, install-test.ps1): serves the real installer and the hub's
// real release from this checkout (api/src/services/hubRelease.js), hands out
// link codes that are never linked, answers a linked hub's "who am I" and
// "disconnect", and refuses everything else with 503 (the hub carries on and
// tries again). GET /__calls says what it was asked.
//
//   node hub/test/windows/standin.mjs [port]

import http from 'node:http'
import { hubRelease, installScript } from '../../../api/src/services/hubRelease.js'

const port = Number(process.argv[2]) || 8790
const calls = { pairings: 0, me: 0, disconnect: 0, install: 0, release: 0 }
let codes = 0

const server = http.createServer((req, res) => {
  const origin = 'http://' + (req.headers.host || '127.0.0.1:' + port)
  const url = new URL(req.url, origin)
  const send = (status, body, type = 'application/json') => {
    const data = Buffer.isBuffer(body) ? body : Buffer.from(type === 'application/json' ? JSON.stringify(body) : String(body))
    res.writeHead(status, { 'content-type': type, 'content-length': data.length })
    res.end(data)
  }
  const p = url.pathname
  console.log(new Date().toISOString(), req.method, p)
  if (p === '/__calls') return send(200, calls)
  if (p === '/pos-api/hub/install.ps1') { calls.install++; return send(200, installScript('ps1', origin), 'text/plain; charset=utf-8') }
  if (p === '/pos-api/hub/release') {
    calls.release++
    const r = hubRelease()
    return send(200, { version: r.version, sha256: r.sha256, size: r.size, url: '/pos-api/hub/release.tgz' })
  }
  if (p === '/pos-api/hub/release.tgz') return send(200, hubRelease().buffer, 'application/gzip')
  if (p === '/pos-api/pairings' && req.method === 'POST') {
    calls.pairings++
    codes++
    const code = 'WIN' + String(codes).padStart(3, '0')
    return send(200, { id: 'p' + codes, code, secret: 's'.repeat(32), expires_at: new Date(Date.now() + 15 * 60_000).toISOString(), link_url: origin + '/link/' + code })
  }
  if (p.startsWith('/pos-api/pairings/')) return send(200, { status: 'waiting' })
  const linked = (req.headers.authorization || '').startsWith('Device ')
  if (p === '/pos-api/me' && linked) { calls.me++; return send(200, { name: 'Windows test hub', venue_name: 'Ware', tenant_name: 'WingVibes' }) }
  if (p === '/pos-api/disconnect' && req.method === 'POST' && linked) { calls.disconnect++; return send(200, { ok: true }) }
  return send(503, { error: 'Not here (stand-in cloud)' })
})

server.listen(port, '127.0.0.1', () => console.log('Stand-in cloud on http://127.0.0.1:' + port))

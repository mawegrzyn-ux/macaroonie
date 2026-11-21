// src/services/webPush.js
//
// Posting a report to a web address (docs/REPORTS.md 15, migration 256): a
// schedule's push. Each post is JSON, signed so the receiver can check it
// came from us and wasn't changed:
//
//   X-Macaroonie-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">
//
// with the schedule's own secret (sealed in report_schedules.push_secret,
// shown once when it is made).
//
// The address is checked before every post, not only when it is saved: https
// only, no user name or password in it, and every address its host resolves
// to must be a public one (no loopback, private, link-local, carrier or
// multicast ranges), so a schedule can't be pointed at the server's own
// network. The connection goes to the address that was checked (a custom
// lookup), so a name that resolves differently a moment later can't slip
// past, and redirects aren't followed.
//
//   pushUrlProblem(url)       a sentence, or null
//   isPrivateAddress(ip)      true for addresses a push may not reach
//   newPushSecret()           'mps_' + 32 random bytes
//   signature(secret, t, body)
//   postSigned(url, body, secret)  { ok, status, error, transient }
//   pushHooks.send            the transport (tests replace it)

import https from 'node:https'
import dns from 'node:dns/promises'
import net from 'node:net'
import { createHmac, randomBytes } from 'node:crypto'

export const PUSH_TIMEOUT_MS = 10000
export const SIGNATURE_HEADER = 'x-macaroonie-signature'

export function newPushSecret() {
  return 'mps_' + randomBytes(32).toString('base64url')
}

export function signature(secret, t, body) {
  return 't=' + t + ',v1=' + createHmac('sha256', secret).update(t + '.' + body).digest('hex')
}

export function pushUrlProblem(raw) {
  let u
  try { u = new URL(String(raw || '')) } catch { return 'Give the web address in full, starting with https://' }
  if (u.protocol !== 'https:') return 'The web address must start with https://'
  if (u.username || u.password) return 'Leave the user name and password out of the web address'
  if (String(raw).length > 500) return 'That web address is too long'
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(host) && isPrivateAddress(host)) return 'That web address is on a private network'
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) return 'That web address is on a private network'
  return null
}

const V4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]
const v4num = ip => ip.split('.').reduce((n, x) => (n * 256) + Number(x), 0)

export function isPrivateAddress(ip) {
  const s = String(ip).toLowerCase()
  if (net.isIPv4(s)) {
    const n = v4num(s)
    return V4_BLOCKED.some(([base, bits]) => {
      const size = 2 ** (32 - bits)
      const b = v4num(base)
      return n >= b && n < b + size
    })
  }
  if (net.isIPv6(s)) {
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateAddress(mapped[1])
    return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s) || /^2001:db8:/.test(s) || /^64:ff9b:/.test(s)
  }
  return true
}

// The real transport: resolve, check every address, post to the one checked.
async function httpsSend(url, body, headers) {
  const u = new URL(url)
  const host = u.hostname.replace(/^\[|\]$/g, '')
  const addrs = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await dns.lookup(host, { all: true })
  if (!addrs.length || addrs.some(a => isPrivateAddress(a.address))) {
    const e = new Error('That web address is on a private network'); e.refused = true; throw e
  }
  const pick = addrs[0]
  return new Promise((resolve, reject) => {
    const req = https.request({
      method: 'POST', hostname: host, port: u.port || 443, path: u.pathname + u.search,
      servername: net.isIP(host) ? undefined : host,
      lookup: (_name, _opts, cb) => cb(null, pick.address, pick.family),
      headers: { ...headers, 'content-length': Buffer.byteLength(body) },
      timeout: PUSH_TIMEOUT_MS,
    }, res => {
      res.resume()
      res.on('end', () => resolve({ status: res.statusCode }))
    })
    req.on('timeout', () => req.destroy(new Error('The web address didn\'t answer in time')))
    req.on('error', reject)
    req.end(body)
  })
}

export const pushHooks = { send: httpsSend }

/** Post `payload` (an object) to `url`, signed with `secret`. Never throws. */
export async function postSigned(url, payload, secret) {
  const bad = pushUrlProblem(url)
  if (bad) return { ok: false, status: null, error: bad, transient: false }
  const body = JSON.stringify(payload)
  const t = Math.floor(Date.now() / 1000)
  try {
    const { status } = await pushHooks.send(url, body, {
      'content-type': 'application/json',
      'user-agent': 'Macaroonie-Reports/1',
      [SIGNATURE_HEADER]: signature(secret, t, body),
    })
    if (status >= 200 && status < 300) return { ok: true, status, error: null, transient: false }
    // Redirects aren't followed: a moved address is the receiver's to fix.
    return {
      ok: false, status,
      error: 'The web address answered ' + status,
      transient: status === 408 || status === 429 || status >= 500,
    }
  } catch (e) {
    return { ok: false, status: null, error: String(e?.message || 'The post failed').slice(0, 200), transient: !e?.refused }
  }
}

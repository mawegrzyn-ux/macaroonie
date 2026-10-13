// Optional password on a tenant's staging site (migration 158).
//
// The password is stored as an scrypt hash in staging_access. Signing in on
// the staging host sets a cookie; the Website admin's Staging buttons open a
// short-lived signed link instead, so staff don't have to type it. Both are
// HMACs keyed by the stored hash (which never leaves the server and has its
// own random salt), so changing or removing the password ends every cookie
// and link at once, and a cookie for one tenant means nothing to another.
//
//   cookie        mcrn_staging = <issued at, seconds>.<sig>   (30 days)
//   preview link  ?staging_key=<expires, seconds>.<sig>       (10 minutes)

import crypto from 'node:crypto'
import { promisify } from 'node:util'
import { withTenant } from '../config/db.js'
import { env } from '../config/env.js'

const scrypt = promisify(crypto.scrypt)

export const STAGING_COOKIE = 'mcrn_staging'
export const COOKIE_DAYS = 30
export const LINK_MINUTES = 10
export const MIN_PASSWORD = 6

const b64 = buf => Buffer.from(buf).toString('base64url')

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = await scrypt(String(password), salt, 32)
  return `s1$${b64(salt)}$${b64(hash)}`
}

export async function checkPassword(password, stored) {
  const [v, salt, hash] = String(stored || '').split('$')
  if (v !== 's1' || !salt || !hash) return false
  const want = Buffer.from(hash, 'base64url')
  const got = await scrypt(String(password ?? ''), Buffer.from(salt, 'base64url'), want.length)
  return crypto.timingSafeEqual(want, got)
}

/** The tenant's staging_access row, or null when staging has no password. */
export async function loadStagingAccess(tenantId) {
  const [row] = await withTenant(tenantId, tx => tx`
    SELECT tenant_id, password_hash, updated_by, updated_at
      FROM staging_access WHERE tenant_id = ${tenantId}
  `)
  return row || null
}

function sign(hash, msg) {
  return crypto.createHmac('sha256', hash).update(msg).digest('base64url')
}

function sameSig(a, b) {
  const x = Buffer.from(String(a || ''))
  const y = Buffer.from(String(b || ''))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

const now = () => Math.floor(Date.now() / 1000)

export function cookieValue(tenantId, hash, issuedAt = now()) {
  return `${issuedAt}.${sign(hash, `cookie:${tenantId}:${issuedAt}`)}`
}

export function cookieOk(value, tenantId, hash) {
  const [iat, sig] = String(value || '').split('.')
  const at = Number(iat)
  if (!Number.isInteger(at) || !sig) return false
  const age = now() - at
  if (age < -300 || age > COOKIE_DAYS * 86400) return false
  return sameSig(sig, sign(hash, `cookie:${tenantId}:${at}`))
}

export function previewKey(tenantId, hash, expiresAt = now() + LINK_MINUTES * 60) {
  return `${expiresAt}.${sign(hash, `link:${tenantId}:${expiresAt}`)}`
}

export function previewKeyOk(key, tenantId, hash) {
  const [exp, sig] = String(key || '').split('.')
  const at = Number(exp)
  if (!Number.isInteger(at) || !sig) return false
  if (at < now() || at > now() + LINK_MINUTES * 60 + 60) return false
  return sameSig(sig, sign(hash, `link:${tenantId}:${at}`))
}

/** The Set-Cookie header for a signed-in staging visitor (host-only). */
export function setCookieHeader(value) {
  return [
    `${STAGING_COOKIE}=${value}`,
    'Path=/',
    `Max-Age=${COOKIE_DAYS * 86400}`,
    'HttpOnly',
    'SameSite=Lax',
    env.PUBLIC_SITE_SCHEME === 'https' ? 'Secure' : null,
  ].filter(Boolean).join('; ')
}

export function readCookie(req, name = STAGING_COOKIE) {
  const raw = req.headers.cookie || ''
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return null
}

export function stagingOrigin(slug) {
  return `${env.PUBLIC_SITE_SCHEME}://staging-${slug}.${env.PUBLIC_ROOT_DOMAIN}`
}

/**
 * Where to send someone after signing in: a path on the same host only
 * ("/x", never "//evil.com" or a full URL), else the home page.
 */
export function safeNext(next) {
  const s = String(next || '')
  if (!s.startsWith('/') || s.startsWith('//') || s.startsWith('/\\')) return '/'
  if (/[\r\n]/.test(s)) return '/'
  return s.slice(0, 2000)
}

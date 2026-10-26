// src/services/walletSvc.js
//
// Loyalty cards in Apple Wallet and Google Wallet (migration 211). Macaroonie
// has one Apple Pass Type ID and one Google Wallet issuer, saved on the
// Platform page (platform_secrets 'wallet_apple' / 'wallet_google', sealed
// JSON); a tenant may save its own instead (loyalty_wallet_settings, sealed).
// Every card is in the tenant's brand either way.
//
//   walletStatus(tx, tenantId)          which accounts a tenant's cards use
//   saveWalletAccount(...)              check and store an Apple or Google account
//   applePass(tx, member, ...)          the member's .pkpass (zip + PKCS#7
//                                       signature by openssl, no dependencies)
//   googleSaveUrl(tx, member, ...)      the Add to Google Wallet link (RS256 JWT)
//   pushWalletUpdates({ log })          the sweep: members whose card changed
//                                       get an APNs push (Apple fetches the
//                                       pass again) and a Google object update
//
// Apple's pass web service (routes/loyaltyApi.js /loyalty-api/apple/v1/...)
// finds a pass by its serial (the member id) and checks its token
// (loyalty_members.wallet_token, sealed).

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http2 from 'node:http2'
import zlib from 'node:zlib'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { sql, systemSql, withTenant } from '../config/db.js'
import { env } from '../config/env.js'
import { httpError } from '../middleware/error.js'
import { seal, unseal } from './vault.js'
import { cardCode, formatMemberNo, pointsText, stampProgress, normaliseProgramme } from '../../../shared/loyalty.js'
import { officeOrigin } from './platformHost.js'

const run = promisify(execFile)
const APPLE = 'wallet_apple'
const GOOGLE = 'wallet_google'

// ── Accounts ────────────────────────────────────────────────────────────────

async function platformSecret(name) {
  const [row] = await sql`SELECT value, hint, updated_at FROM platform_secrets WHERE name = ${name}`
  if (!row) return null
  try { return { ...JSON.parse(unseal(row.value)), hint: row.hint, updated_at: row.updated_at } } catch { return null }
}

function checkApple(a) {
  const passTypeId = String(a.pass_type_id || '').trim()
  const teamId = String(a.team_id || '').trim()
  if (!/^pass\.[A-Za-z0-9.-]{3,200}$/.test(passTypeId)) throw httpError(400, 'The Pass Type ID looks like pass.com.example.loyalty')
  if (!/^[A-Z0-9]{10}$/.test(teamId)) throw httpError(400, 'The Team ID is 10 letters and digits')
  let cert, key, wwdr
  try { cert = new crypto.X509Certificate(a.cert_pem) } catch { throw httpError(400, 'The pass certificate isn\'t a PEM certificate') }
  try { key = crypto.createPrivateKey(a.key_pem) } catch { throw httpError(400, 'The private key isn\'t a PEM key (without a password)') }
  try { wwdr = new crypto.X509Certificate(a.wwdr_pem) } catch { throw httpError(400, 'The Apple WWDR certificate isn\'t a PEM certificate') }
  if (!cert.checkPrivateKey(key)) throw httpError(400, 'The private key doesn\'t belong to the pass certificate')
  if (new Date(cert.validTo) < new Date()) throw httpError(400, 'The pass certificate has run out')
  return {
    pass_type_id: passTypeId, team_id: teamId, cert_pem: a.cert_pem.trim(), key_pem: a.key_pem.trim(), wwdr_pem: a.wwdr_pem.trim(),
    valid_to: new Date(cert.validTo).toISOString(), hint: passTypeId,
  }
}

function checkGoogle(g) {
  const issuerId = String(g.issuer_id || '').trim()
  if (!/^\d{6,25}$/.test(issuerId)) throw httpError(400, 'The issuer ID is the number on the Google Pay & Wallet Console')
  let sa
  try { sa = typeof g.service_account === 'string' ? JSON.parse(g.service_account) : g.service_account } catch { throw httpError(400, 'Paste the service account key file (JSON)') }
  if (!sa?.client_email || !sa?.private_key) throw httpError(400, 'The key file needs client_email and private_key')
  try { crypto.createPrivateKey(sa.private_key) } catch { throw httpError(400, 'The key file\'s private key can\'t be read') }
  return { issuer_id: issuerId, client_email: sa.client_email, private_key: sa.private_key, hint: issuerId + ' / ' + sa.client_email }
}

/** Store Macaroonie's Apple or Google account (Platform page). */
export async function savePlatformWallet(kind, body, by) {
  const value = kind === 'apple' ? checkApple(body) : checkGoogle(body)
  const name = kind === 'apple' ? APPLE : GOOGLE
  await sql`
    INSERT INTO platform_secrets (name, value, hint, updated_by)
    VALUES (${name}, ${seal(JSON.stringify(value))}, ${value.hint}, ${by || null})
    ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, hint = EXCLUDED.hint, updated_by = EXCLUDED.updated_by, updated_at = now()`
  return platformWalletStatus()
}

export async function removePlatformWallet(kind) {
  await sql`DELETE FROM platform_secrets WHERE name = ${kind === 'apple' ? APPLE : GOOGLE}`
  return platformWalletStatus()
}

export async function platformWalletStatus() {
  const [a, g] = await Promise.all([platformSecret(APPLE), platformSecret(GOOGLE)])
  return {
    apple: a ? { set: true, hint: a.hint, valid_to: a.valid_to || null, updated_at: a.updated_at } : { set: false },
    google: g ? { set: true, hint: g.hint, updated_at: g.updated_at } : { set: false },
  }
}

/** Store (or stop using) a tenant's own account. */
export async function saveTenantWallet(tx, tenantId, kind, body, by) {
  await tx`INSERT INTO loyalty_wallet_settings (tenant_id) VALUES (${tenantId}) ON CONFLICT DO NOTHING`
  if (kind === 'apple') {
    if (body.own === false) {
      await tx`UPDATE loyalty_wallet_settings SET apple_own = false, apple_pass_type_id = NULL, apple_team_id = NULL, apple_cert_pem = NULL,
                 apple_key_pem = NULL, apple_wwdr_pem = NULL, apple_hint = NULL, updated_by = ${by}, updated_at = now() WHERE tenant_id = ${tenantId}`
    } else {
      const a = checkApple(body)
      await tx`
        UPDATE loyalty_wallet_settings
           SET apple_own = true, apple_pass_type_id = ${a.pass_type_id}, apple_team_id = ${a.team_id}, apple_cert_pem = ${seal(a.cert_pem)},
               apple_key_pem = ${seal(a.key_pem)}, apple_wwdr_pem = ${seal(a.wwdr_pem)}, apple_hint = ${a.hint}, updated_by = ${by}, updated_at = now()
         WHERE tenant_id = ${tenantId}`
    }
  } else if (body.own === false) {
    await tx`UPDATE loyalty_wallet_settings SET google_own = false, google_issuer_id = NULL, google_service_account = NULL, google_hint = NULL,
               updated_by = ${by}, updated_at = now() WHERE tenant_id = ${tenantId}`
  } else {
    const g = checkGoogle(body)
    await tx`
      UPDATE loyalty_wallet_settings
         SET google_own = true, google_issuer_id = ${g.issuer_id},
             google_service_account = ${seal(JSON.stringify({ client_email: g.client_email, private_key: g.private_key }))},
             google_hint = ${g.hint}, updated_by = ${by}, updated_at = now()
       WHERE tenant_id = ${tenantId}`
  }
  return walletStatus(tx, tenantId)
}

/** The Apple account a tenant's passes are signed with, or null. */
export async function appleAccount(tx, tenantId) {
  const [own] = await tx`SELECT * FROM loyalty_wallet_settings WHERE tenant_id = ${tenantId}`
  if (own?.apple_own && own.apple_cert_pem) {
    return {
      source: 'own', pass_type_id: own.apple_pass_type_id, team_id: own.apple_team_id,
      cert_pem: unseal(own.apple_cert_pem), key_pem: unseal(own.apple_key_pem), wwdr_pem: unseal(own.apple_wwdr_pem),
    }
  }
  const p = await platformSecret(APPLE)
  return p ? { source: 'platform', ...p } : null
}

export async function googleAccount(tx, tenantId) {
  const [own] = await tx`SELECT * FROM loyalty_wallet_settings WHERE tenant_id = ${tenantId}`
  if (own?.google_own && own.google_service_account) {
    const sa = JSON.parse(unseal(own.google_service_account))
    return { source: 'own', issuer_id: own.google_issuer_id, ...sa }
  }
  const p = await platformSecret(GOOGLE)
  return p ? { source: 'platform', ...p } : null
}

/** What the admin shows: per wallet, set / which account / own hint. Never a key. */
export async function walletStatus(tx, tenantId) {
  const [own] = await tx`SELECT * FROM loyalty_wallet_settings WHERE tenant_id = ${tenantId}`
  const platform = await platformWalletStatus()
  const side = (ownOn, ownHint, plat) => ({
    available: !!(ownOn || plat.set),
    source: ownOn ? 'own' : plat.set ? 'platform' : null,
    own: ownOn ? { hint: ownHint } : null,
    platform: plat.set,
  })
  return {
    apple: side(own?.apple_own && own?.apple_cert_pem, own?.apple_hint, platform.apple),
    google: side(own?.google_own && own?.google_service_account, own?.google_hint, platform.google),
  }
}

// ── Colours ─────────────────────────────────────────────────────────────────

const HEX = /^#[0-9a-f]{6}$/i
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function lum(hex) {
  const [r, g, b] = rgb(hex).map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** The card's colours: the programme's, else the brand's, with readable words. */
export function cardColours(settings, brandColors = {}) {
  const bg = (settings?.card?.background && HEX.test(settings.card.background) && settings.card.background)
    || (HEX.test(brandColors.primary || '') && brandColors.primary) || '#1f2937'
  const text = (settings?.card?.text && HEX.test(settings.card.text) && settings.card.text) || (lum(bg) > 0.45 ? '#111111' : '#ffffff')
  const accent = (settings?.card?.accent && HEX.test(settings.card.accent) && settings.card.accent)
    || (HEX.test(brandColors.accent || '') && brandColors.accent) || text
  return { background: bg, text, accent }
}
const rgbText = hex => 'rgb(' + rgb(hex).join(',') + ')'

// ── A small PNG (the pass icon) ─────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
export function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A square PNG in one colour with a ring in another (no image library needed). */
export function iconPng(size, bgHex, fgHex) {
  const [br, bgc, bb] = rgb(bgHex)
  const [fr, fgc, fb] = rgb(fgHex)
  const raw = Buffer.alloc(size * (size * 3 + 1))
  const r1 = size * 0.28, r2 = size * 0.36, c = (size - 1) / 2
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c)
      const on = d >= r1 && d <= r2
      const o = y * (size * 3 + 1) + 1 + x * 3
      raw[o] = on ? fr : br; raw[o + 1] = on ? fgc : bgc; raw[o + 2] = on ? fb : bb
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── A zip (the .pkpass) ─────────────────────────────────────────────────────

/** files: [{ name, data: Buffer }] -> a zip with each file deflated. */
export function zip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8')
    const data = zlib.deflateRawSync(f.data)
    const crc = crc32(f.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8)
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12)
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(f.data.length, 22)
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28)
    locals.push(local, name, data)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(f.data.length, 24)
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + data.length
  }
  const centralBuf = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBuf, end])
}

/** A PKCS#7 detached signature (DER) of `data`, by openssl. */
async function smimeSign(data, account) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pkpass-'))
  try {
    const p = n => path.join(dir, n)
    await Promise.all([
      fs.writeFile(p('manifest.json'), data), fs.writeFile(p('cert.pem'), account.cert_pem),
      fs.writeFile(p('key.pem'), account.key_pem, { mode: 0o600 }), fs.writeFile(p('wwdr.pem'), account.wwdr_pem),
    ])
    await run('openssl', ['smime', '-binary', '-sign', '-certfile', p('wwdr.pem'), '-signer', p('cert.pem'), '-inkey', p('key.pem'),
      '-in', p('manifest.json'), '-out', p('signature'), '-outform', 'DER'], { timeout: 15_000 })
    return await fs.readFile(p('signature'))
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// ── Apple Wallet ────────────────────────────────────────────────────────────

/** What a member's card shows: points, stamps and the rewards they hold. */
export async function cardContent(tx, member, programme) {
  const s = programme.settings
  const cards = s.features.stamps
    ? await tx`SELECT id, data FROM loyalty_stamp_cards WHERE tenant_id = ${member.tenant_id} AND is_active ORDER BY sort_order`
    : []
  const totals = cards.length ? await tx`
    SELECT stamp_card_id, COALESCE(sum(stamps), 0)::int AS total FROM loyalty_ledger
     WHERE tenant_id = ${member.tenant_id} AND member_id = ${member.id} AND stamp_card_id IS NOT NULL GROUP BY stamp_card_id` : []
  const by = Object.fromEntries(totals.map(t => [t.stamp_card_id, t.total]))
  const [{ n: held }] = await tx`
    SELECT count(*)::int AS n FROM loyalty_member_rewards
     WHERE tenant_id = ${member.tenant_id} AND member_id = ${member.id} AND status = 'available' AND (expires_at IS NULL OR expires_at > now())`
  return {
    points: s.features.points ? pointsText(member.points, s) : null,
    points_value: member.points,
    stamps: cards.map(c => {
      const pr = stampProgress({ stamps_needed: Number(c.data?.stamps_needed) || 8 }, Math.max(0, by[c.id] || 0))
      return { id: c.id, name: String(c.data?.name || 'Stamps').slice(0, 30), text: pr.count + ' / ' + pr.needed }
    }),
    rewards: held,
  }
}

/** The member's Apple Wallet pass (.pkpass bytes). */
export async function applePass(tx, member, programme, site, token) {
  const account = await appleAccount(tx, member.tenant_id)
  if (!account) throw httpError(422, 'Apple Wallet isn\'t set up yet')
  const s = programme.settings
  const colours = cardColours(s, site?.colors)
  const content = await cardContent(tx, member, programme)
  const origin = site?.origin || officeOrigin()
  const pass = {
    formatVersion: 1,
    passTypeIdentifier: account.pass_type_id,
    teamIdentifier: account.team_id,
    serialNumber: member.id,
    organizationName: String(site?.name || s.name).slice(0, 60),
    description: s.name + ' card',
    logoText: s.name,
    foregroundColor: rgbText(colours.text),
    labelColor: rgbText(colours.accent),
    backgroundColor: rgbText(colours.background),
    webServiceURL: origin + '/loyalty-api/apple',
    authenticationToken: token,
    sharingProhibited: true,
    barcodes: [{ format: 'PKBarcodeFormatQR', message: cardCode(member.card_token), messageEncoding: 'iso-8859-1', altText: formatMemberNo(member.member_no) }],
    storeCard: {
      headerFields: content.points ? [{ key: 'points', label: s.points.label.toUpperCase(), value: member.points, changeMessage: 'You have %@ ' + s.points.label }] : [],
      primaryFields: [{ key: 'name', label: 'MEMBER', value: member.name || '' }],
      secondaryFields: content.stamps.slice(0, 2).map(x => ({ key: 'stamps_' + x.id.slice(0, 8), label: x.name.toUpperCase(), value: x.text })),
      auxiliaryFields: content.rewards ? [{ key: 'rewards', label: 'REWARDS', value: content.rewards + ' ready', changeMessage: 'You have %@' }] : [],
      backFields: [
        { key: 'no', label: 'Member number', value: formatMemberNo(member.member_no) },
        { key: 'web', label: 'Your card', value: origin + '/loyalty', attributedValue: '<a href="' + origin + '/loyalty">' + origin.replace(/^https?:\/\//, '') + '/loyalty</a>' },
      ],
    },
  }
  const files = [
    { name: 'pass.json', data: Buffer.from(JSON.stringify(pass)) },
    { name: 'icon.png', data: iconPng(29, colours.background, colours.text) },
    { name: 'icon@2x.png', data: iconPng(58, colours.background, colours.text) },
    { name: 'icon@3x.png', data: iconPng(87, colours.background, colours.text) },
  ]
  const manifest = Object.fromEntries(files.map(f => [f.name, crypto.createHash('sha1').update(f.data).digest('hex')]))
  const manifestBuf = Buffer.from(JSON.stringify(manifest))
  const signature = await smimeSign(manifestBuf, account)
  return { bytes: zip([...files, { name: 'manifest.json', data: manifestBuf }, { name: 'signature', data: signature }]), pass_type_id: account.pass_type_id }
}

/** An APNs push (empty payload) to one device: Wallet then fetches the pass again. */
async function apnsPush(account, pushToken) {
  return new Promise((resolve) => {
    let client
    try {
      client = http2.connect(env.APPLE_APNS_URL, { cert: account.cert_pem, key: account.key_pem })
    } catch (err) { resolve({ ok: false, error: err.message }); return }
    client.on('error', err => { resolve({ ok: false, error: err.message }); client.close() })
    const req = client.request({ ':method': 'POST', ':path': '/3/device/' + pushToken, 'apns-topic': account.pass_type_id, 'content-type': 'application/json' })
    let status = 0
    req.on('response', h => { status = h[':status'] })
    req.setTimeout(10_000, () => { req.close(); resolve({ ok: false, error: 'timeout' }) })
    req.on('end', () => { client.close(); resolve({ ok: status === 200, status }) })
    req.on('error', err => { client.close(); resolve({ ok: false, error: err.message }) })
    req.resume()
    req.end('{}')
  })
}

// ── Google Wallet ───────────────────────────────────────────────────────────

const b64url = v => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url')
function signJwt(payload, privateKey) {
  const head = b64url({ alg: 'RS256', typ: 'JWT' })
  const body = b64url(payload)
  const sig = crypto.sign('RSA-SHA256', Buffer.from(head + '.' + body), privateKey).toString('base64url')
  return head + '.' + body + '.' + sig
}

const googleId = s => String(s).replace(/[^A-Za-z0-9._-]/g, '_')

function googleObjects(account, member, programme, site, content) {
  const s = programme.settings
  const colours = cardColours(s, site?.colors)
  const origin = site?.origin || officeOrigin()
  const logo = site?.logo_url ? new URL(site.logo_url, origin).href : officeOrigin() + '/pwa-512x512.png'
  const classId = account.issuer_id + '.' + googleId('loyalty-' + member.tenant_id)
  const loyaltyClass = {
    id: classId,
    issuerName: String(site?.name || s.name).slice(0, 60),
    programName: s.name,
    programLogo: { sourceUri: { uri: logo } },
    hexBackgroundColor: colours.background,
    reviewStatus: 'UNDER_REVIEW',
  }
  const loyaltyObject = {
    id: account.issuer_id + '.' + googleId(member.id),
    classId,
    state: 'ACTIVE',
    accountId: member.member_no,
    accountName: member.name || '',
    ...(content.points ? { loyaltyPoints: { label: s.points.label, balance: { int: member.points } } } : {}),
    barcode: { type: 'QR_CODE', value: cardCode(member.card_token), alternateText: formatMemberNo(member.member_no) },
    textModulesData: [
      ...content.stamps.map(x => ({ id: googleId('stamps_' + x.id.slice(0, 8)), header: x.name, body: x.text })),
      ...(content.rewards ? [{ id: 'rewards', header: 'Rewards', body: content.rewards + ' ready to use' }] : []),
    ],
    linksModuleData: { uris: [{ uri: origin + '/loyalty', description: 'Your card' }] },
  }
  return { loyaltyClass, loyaltyObject }
}

/** The Add to Google Wallet link for a member. */
export async function googleSaveUrl(tx, member, programme, site) {
  const account = await googleAccount(tx, member.tenant_id)
  if (!account) throw httpError(422, 'Google Wallet isn\'t set up yet')
  const content = await cardContent(tx, member, programme)
  const { loyaltyClass, loyaltyObject } = googleObjects(account, member, programme, site, content)
  const jwt = signJwt({
    iss: account.client_email, aud: 'google', typ: 'savetowallet', iat: Math.floor(Date.now() / 1000),
    origins: site?.origin ? [site.origin] : [],
    payload: { loyaltyClasses: [loyaltyClass], loyaltyObjects: [loyaltyObject] },
  }, account.private_key)
  return 'https://pay.google.com/gp/v/save/' + jwt
}

const tokenCache = new Map()
async function googleToken(account) {
  const hit = tokenCache.get(account.client_email)
  if (hit && hit.exp > Date.now() + 60_000) return hit.token
  const now = Math.floor(Date.now() / 1000)
  const assertion = signJwt({
    iss: account.client_email, scope: 'https://www.googleapis.com/auth/wallet_object.issuer',
    aud: env.GOOGLE_OAUTH_TOKEN_URL, iat: now, exp: now + 3600,
  }, account.private_key)
  const res = await fetch(env.GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error('Google token ' + res.status)
  const j = await res.json()
  tokenCache.set(account.client_email, { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 })
  return j.access_token
}

async function updateGoogleObject(account, member, programme, site, content) {
  const { loyaltyObject } = googleObjects(account, member, programme, site, content)
  const token = await googleToken(account)
  const res = await fetch(env.GOOGLE_WALLET_API_URL + '/walletobjects/v1/loyaltyObject/' + encodeURIComponent(loyaltyObject.id), {
    method: 'PATCH',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ loyaltyPoints: loyaltyObject.loyaltyPoints, textModulesData: loyaltyObject.textModulesData, accountName: loyaltyObject.accountName, barcode: loyaltyObject.barcode }),
    signal: AbortSignal.timeout(10_000),
  })
  // 404: the member hasn't saved the card yet.
  return res.ok || res.status === 404
}

/**
 * The sweep: every member whose card changed since it was last pushed gets
 * an APNs push to each device holding the pass, and the Google object updated.
 */
export async function pushWalletUpdates({ log, siteOf } = {}) {
  let pushed = 0
  const members = await systemSql`
    SELECT m.* FROM loyalty_members m
     WHERE m.status = 'active' AND m.wallet_updated_at > COALESCE(m.wallet_pushed_at, 'epoch'::timestamptz)
       AND (m.google_saved_at IS NOT NULL OR EXISTS (SELECT 1 FROM loyalty_wallet_devices d WHERE d.member_id = m.id))
     ORDER BY m.wallet_updated_at LIMIT 100`
  for (const m of members) {
    try {
      await withTenant(m.tenant_id, async tx => {
        const [p] = await tx`SELECT * FROM loyalty_programmes WHERE tenant_id = ${m.tenant_id} AND scope = 'tenant'`
        if (!p) return
        const programme = { id: p.id, enabled: p.enabled, settings: normaliseProgramme(p.settings) }
        const devices = await tx`SELECT * FROM loyalty_wallet_devices WHERE tenant_id = ${m.tenant_id} AND member_id = ${m.id}`
        if (devices.length) {
          const apple = await appleAccount(tx, m.tenant_id)
          if (apple) {
            for (const d of devices) {
              const r = await apnsPush(apple, unseal(d.push_token))
              // 410: the device no longer has the pass.
              if (r.status === 410) await tx`DELETE FROM loyalty_wallet_devices WHERE id = ${d.id} AND tenant_id = ${m.tenant_id}`
              else if (!r.ok) log?.warn({ status: r.status, error: r.error }, 'apple wallet push failed')
            }
          }
        }
        if (m.google_saved_at) {
          const google = await googleAccount(tx, m.tenant_id)
          if (google) {
            const site = siteOf ? await siteOf(tx, m.tenant_id) : null
            await updateGoogleObject(google, m, programme, site, await cardContent(tx, m, programme))
              .catch(err => log?.warn({ err: err.message }, 'google wallet update failed'))
          }
        }
        await tx`UPDATE loyalty_members SET wallet_pushed_at = now() WHERE id = ${m.id} AND tenant_id = ${m.tenant_id}`
      })
      pushed++
    } catch (err) {
      log?.warn({ err }, 'wallet update failed')
    }
  }
  return pushed
}

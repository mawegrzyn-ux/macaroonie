// Loyalty wallet cards (migration 211, services/walletSvc.js): Macaroonie's
// Apple and Google accounts checked and stored sealed on the Platform page;
// a tenant's own account used instead; the Apple pass a zip with a manifest
// and a PKCS#7 signature that openssl verifies against the WWDR certificate;
// Apple's pass web service (register, list changed passes, fetch, refuse a
// wrong token); the Google save link a JWT signed with the service account's
// key; and the sweep pushing changed cards (APNs and Google, both stand-ins).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http2 from 'node:http2'
import zlib from 'node:zlib'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B, PLATFORM } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { env } from '../src/config/env.js'
import { pushWalletUpdates, zip, crc32 } from '../src/services/walletSvc.js'
import { tenantSite } from '../src/services/loyaltySvc.js'

const run = promisify(execFile)
let ids, owner, dir, apple, apple2, google, session, member
const sent = []
const googleCalls = []
const realFetch = globalThis.fetch
const SLUG = 'zqx-site'

async function call(method, url, { body, headers = {} } = {}) {
  const app = await getApp()
  const res = await app.inject({
    method, url,
    headers: { [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    payload: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = res.json() } catch { json = null }
  return { status: res.statusCode, json, body: res.body, raw: res.rawPayload, headers: res.headers }
}
const guest = (method, p, body) => call(method, '/loyalty-api/t/' + SLUG + p, { body, headers: session ? { authorization: 'Loyalty ' + session } : {} })

/** A pass certificate signed by a stand-in WWDR certificate authority. */
async function makeAppleAccount(name) {
  const p = n => path.join(dir, name + '-' + n)
  await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', p('ca.key'), '-out', p('ca.pem'), '-days', '2', '-subj', '/CN=Test WWDR ' + name])
  await run('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', p('pass.key'), '-out', p('pass.csr'), '-subj', '/CN=Pass Type ID: pass.test.' + name])
  await run('openssl', ['x509', '-req', '-in', p('pass.csr'), '-CA', p('ca.pem'), '-CAkey', p('ca.key'), '-CAcreateserial', '-out', p('pass.pem'), '-days', '2'])
  return {
    pass_type_id: 'pass.test.' + name, team_id: 'ABCDE12345',
    cert_pem: await fs.readFile(p('pass.pem'), 'utf8'), key_pem: await fs.readFile(p('pass.key'), 'utf8'), wwdr_pem: await fs.readFile(p('ca.pem'), 'utf8'),
    files: { ca: p('ca.pem') },
  }
}

/** The files of a zip (deflated or stored). */
function unzip(buf) {
  const out = {}
  let i = 0
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8)
    const size = buf.readUInt32LE(i + 18)
    const nameLen = buf.readUInt16LE(i + 26)
    const extra = buf.readUInt16LE(i + 28)
    const name = buf.slice(i + 30, i + 30 + nameLen).toString()
    const data = buf.slice(i + 30 + nameLen + extra, i + 30 + nameLen + extra + size)
    out[name] = method === 8 ? zlib.inflateRawSync(data) : data
    i += 30 + nameLen + extra + size
  }
  return out
}

async function code(email) {
  const end = Date.now() + 4000
  while (Date.now() < end) {
    const m = [...sent].reverse().find(x => x.personalizations[0].to[0].email === email)
    if (m) return /(\d{6})/.exec(m.content[0].value.replace(/<[^>]+>/g, ' '))[1]
    await new Promise(r => setTimeout(r, 30))
  }
  throw new Error('no code')
}

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wallet-test-'))
  ids = await resetAndSeed()
  const mine = await fillTenant(A.owner, ids.a)
  assert.deepEqual(mine.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  apple = await makeAppleAccount('macaroonie')
  apple2 = await makeAppleAccount('own')
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  google = { issuer_id: '3388000000012345678', service_account: JSON.stringify({ client_email: 'wallet@test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }) }
  await ok(owner.post(`/api/email-templates/settings/${mine.ids.venue}`, { email_provider: 'sendgrid', provider_api_key: 'SG.wallet', from_email: 'hi@ware.example' }))
  env.GOOGLE_OAUTH_TOKEN_URL = 'https://oauth.test/token'
  env.GOOGLE_WALLET_API_URL = 'https://wallet.test'
  globalThis.fetch = async (url, opts) => {
    const u = String(url)
    if (u.startsWith('https://api.sendgrid.com/')) { sent.push(JSON.parse(opts.body)); return new Response('', { status: 202 }) }
    if (u === 'https://oauth.test/token') { googleCalls.push({ kind: 'token', body: String(opts.body) }); return Response.json({ access_token: 'g-token', expires_in: 3600 }) }
    if (u.startsWith('https://wallet.test/')) { googleCalls.push({ kind: 'patch', url: u, auth: opts.headers.authorization, body: JSON.parse(opts.body) }); return Response.json({}) }
    return realFetch(url, opts)
  }
  await ok(owner.put('/api/loyalty/programme', { enabled: true, settings: {
    name: 'Zqx Club', points: { per_pound: 1 }, features: { points: true, web_app: true, wallet_apple: true, wallet_google: true },
    card: { background: '#123456' },
  } }))
  session = null
  await guest('POST', '/code', { email: 'wally@zqx.test' })
  const v = await guest('POST', '/verify', { email: 'wally@zqx.test', code: await code('wally@zqx.test') })
  const j = await guest('POST', '/join', { join_ticket: v.json.join_ticket, email: 'wally@zqx.test', name: 'Wally Wallet', agreed: true })
  assert.equal(j.status, 201, JSON.stringify(j.json))
  session = j.json.session
  member = j.json.member
})
after(async () => { globalThis.fetch = realFetch; await closeApp(); await fs.rm(dir, { recursive: true, force: true }) })

test('platform accounts: checked, stored sealed, never returned; only platform admins', async () => {
  const pa = as(PLATFORM, ids.a)
  assert.equal((await owner.put('/api/loyalty/platform/wallet/apple', apple)).status, 403)
  const bad = await pa.put('/api/loyalty/platform/wallet/apple', { ...apple, key_pem: apple2.key_pem })
  assert.equal(bad.status, 400)
  assert.match(bad.json.error, /doesn't belong/)
  assert.equal((await pa.put('/api/loyalty/platform/wallet/apple', { ...apple, team_id: 'x' })).status, 400)
  const okApple = await ok(pa.put('/api/loyalty/platform/wallet/apple', apple))
  assert.equal(okApple.apple.set, true)
  assert.equal(okApple.apple.hint, apple.pass_type_id)
  await ok(pa.put('/api/loyalty/platform/wallet/google', google))
  const [row] = await sql`SELECT value FROM platform_secrets WHERE name = 'wallet_apple'`
  assert.match(row.value, /^v1:/, 'sealed')
  assert.ok(!row.value.includes('BEGIN'))
  const status = await ok(owner.get('/api/loyalty/wallet'))
  assert.deepEqual([status.apple.source, status.google.source], ['platform', 'platform'])
  assert.ok(!JSON.stringify(status).includes('PRIVATE KEY'))
  const info = await guest('GET', '')
  assert.deepEqual(info.json.wallet, { apple: true, google: true })
})

let pkpass
test('the Apple pass: a signed zip in the brand, its QR code the card; the download link runs out', async () => {
  const link = await guest('POST', '/me/wallet/apple')
  assert.equal(link.status, 200, JSON.stringify(link.json))
  assert.match(link.json.url, /^\/loyalty-api\/pass\/loyalty\.pkpass\?t=.+$/)
  const res = await call('GET', link.json.url)
  assert.equal(res.status, 200, res.body)
  assert.equal(res.headers['content-type'], 'application/vnd.apple.pkpass')
  pkpass = res.raw
  const files = unzip(pkpass)
  assert.deepEqual(Object.keys(files).sort(), ['icon.png', 'icon@2x.png', 'icon@3x.png', 'manifest.json', 'pass.json', 'signature'])
  const pass = JSON.parse(files['pass.json'])
  assert.equal(pass.passTypeIdentifier, apple.pass_type_id)
  assert.equal(pass.serialNumber, member.id)
  assert.equal(pass.barcodes[0].message, member.card_code)
  assert.equal(pass.backgroundColor, 'rgb(18,52,86)')
  assert.equal(pass.storeCard.primaryFields[0].value, 'Wally Wallet')
  assert.match(pass.webServiceURL, /\/loyalty-api\/apple$/)
  assert.ok(pass.authenticationToken.length >= 16)
  const manifest = JSON.parse(files['manifest.json'])
  for (const [n, sha] of Object.entries(manifest)) assert.equal(crypto.createHash('sha1').update(files[n]).digest('hex'), sha, n)
  // The signature verifies against the WWDR certificate.
  const p = n => path.join(dir, 'v-' + n)
  await fs.writeFile(p('manifest.json'), files['manifest.json'])
  await fs.writeFile(p('signature'), files.signature)
  await run('openssl', ['smime', '-verify', '-binary', '-inform', 'DER', '-in', p('signature'), '-content', p('manifest.json'), '-CAfile', apple.files.ca, '-purpose', 'any', '-out', '/dev/null'])
  assert.equal(files['icon.png'].slice(1, 4).toString(), 'PNG')
  // Another link kind, or a broken one, doesn't open it.
  assert.equal((await call('GET', '/loyalty-api/pass/loyalty.pkpass?t=abc')).status, 410)
  // The zip helper's CRC matches a known value.
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926)
  assert.ok(unzip(zip([{ name: 'a.txt', data: Buffer.from('hello') }]))['a.txt'].toString() === 'hello')
})

test('Apple\'s pass web service: register, list changed passes, fetch with the token, refuse a wrong one', async () => {
  const files = unzip(pkpass)
  const pass = JSON.parse(files['pass.json'])
  const auth = { authorization: 'ApplePass ' + pass.authenticationToken }
  const base = `/loyalty-api/apple/v1/devices/devlib0001/registrations/${pass.passTypeIdentifier}/${member.id}`
  assert.equal((await call('POST', base, { body: { pushToken: 'abc123def456' }, headers: { authorization: 'ApplePass wrong-token-0000000' } })).status, 401)
  assert.equal((await call('POST', base, { body: { pushToken: 'abc123def456' }, headers: auth })).status, 201)
  assert.equal((await call('POST', base, { body: { pushToken: 'abc123def456' }, headers: auth })).status, 200, 'already registered')
  const [d] = await sql`SELECT push_token FROM loyalty_wallet_devices WHERE member_id = ${member.id}`
  assert.match(d.push_token, /^v1:/, 'push token sealed')
  const list = await call('GET', `/loyalty-api/apple/v1/devices/devlib0001/registrations/${pass.passTypeIdentifier}?passesUpdatedSince=0`)
  assert.equal(list.status, 200)
  assert.deepEqual(list.json.serialNumbers, [member.id])
  const none = await call('GET', `/loyalty-api/apple/v1/devices/devlib0001/registrations/${pass.passTypeIdentifier}?passesUpdatedSince=${Number(list.json.lastUpdated) + 1000}`)
  assert.equal(none.status, 204)
  const fetched = await call('GET', `/loyalty-api/apple/v1/passes/${pass.passTypeIdentifier}/${member.id}`, { headers: auth })
  assert.equal(fetched.status, 200)
  assert.equal(JSON.parse(unzip(fetched.raw)['pass.json']).serialNumber, member.id)
  const later = await call('GET', `/loyalty-api/apple/v1/passes/${pass.passTypeIdentifier}/${member.id}`, { headers: { ...auth, 'if-modified-since': new Date(Date.now() + 60_000).toUTCString() } })
  assert.equal(later.status, 304)
  assert.equal((await call('GET', `/loyalty-api/apple/v1/passes/${pass.passTypeIdentifier}/${member.id}`)).status, 401)
  assert.equal((await call('POST', '/loyalty-api/apple/v1/log', { body: { logs: ['x'] } })).status, 200)
})

test('Google Wallet: a save link signed with the service account key, the card in the brand', async () => {
  const res = await guest('POST', '/me/wallet/google')
  assert.equal(res.status, 200, JSON.stringify(res.json))
  const jwt = res.json.url.replace('https://pay.google.com/gp/v/save/', '')
  const [h, b, s] = jwt.split('.')
  const pub = crypto.createPublicKey(JSON.parse(google.service_account).private_key)
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(h + '.' + b), pub, Buffer.from(s, 'base64url')), 'signature')
  const payload = JSON.parse(Buffer.from(b, 'base64url'))
  assert.equal(payload.aud, 'google')
  assert.equal(payload.typ, 'savetowallet')
  const obj = payload.payload.loyaltyObjects[0]
  assert.equal(obj.id, google.issuer_id + '.' + member.id)
  assert.equal(obj.barcode.value, member.card_code)
  assert.equal(obj.loyaltyPoints.balance.int, 0)
  assert.equal(payload.payload.loyaltyClasses[0].hexBackgroundColor, '#123456')
})

test('the sweep pushes changed cards: an APNs push per device, the Google object updated', async () => {
  const pushes = []
  const server = http2.createServer()
  server.on('stream', (stream, headers) => {
    pushes.push({ path: headers[':path'], topic: headers['apns-topic'] })
    stream.respond({ ':status': 200 })
    stream.end()
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  env.APPLE_APNS_URL = 'http://127.0.0.1:' + server.address().port
  try {
    await ok(owner.post(`/api/loyalty/members/${member.id}/adjust`, { points: 40, note: 'Welcome gift' }))
    const n = await pushWalletUpdates({ siteOf: tenantSite })
    assert.equal(n, 1)
    assert.deepEqual(pushes, [{ path: '/3/device/abc123def456', topic: apple.pass_type_id }])
    const patch = googleCalls.find(c => c.kind === 'patch')
    assert.ok(patch, 'Google object updated')
    assert.equal(patch.body.loyaltyPoints.balance.int, 40)
    assert.equal(patch.auth, 'Bearer g-token')
    // Nothing changed: nothing pushed.
    assert.equal(await pushWalletUpdates({ siteOf: tenantSite }), 0)
  } finally {
    server.close()
  }
})

test('a tenant\'s own Apple account is used instead of Macaroonie\'s; owners only; back to Macaroonie\'s', async () => {
  assert.equal((await as(A.operator, ids.a).put('/api/loyalty/wallet/apple', apple2)).status, 403)
  const st = await ok(owner.put('/api/loyalty/wallet/apple', apple2))
  assert.equal(st.apple.source, 'own')
  const link = await guest('POST', '/me/wallet/apple')
  const files = unzip((await call('GET', link.json.url)).raw)
  assert.equal(JSON.parse(files['pass.json']).passTypeIdentifier, apple2.pass_type_id)
  const [row] = await sql`SELECT apple_key_pem FROM loyalty_wallet_settings WHERE tenant_id = ${ids.a}`
  assert.match(row.apple_key_pem, /^v1:/)
  const back = await ok(owner.put('/api/loyalty/wallet/apple', { own: false }))
  assert.equal(back.apple.source, 'platform')
  // Tenant B never sees A's own account.
  const b = await ok(as(B.owner, ids.b).get('/api/loyalty/wallet'))
  assert.equal(b.apple.source, 'platform')
})

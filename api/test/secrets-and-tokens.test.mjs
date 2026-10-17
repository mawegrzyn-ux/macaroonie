// Stored keys sealed, connector tokens with an expiry and read-only, and the
// staff connector listing only the tools a person can use (migration 179).
// Checked here: email provider keys, the GloriaFood poll key (against a
// stand-in GloriaFood), Loyverse tokens (a stand-in Loyverse) and the
// Anthropic key are stored sealed, never sent back, and used as typed;
// keys saved before 179 are sealed at start; tokens expire, read-only ones
// list and run only reading tools; the tool list follows the person's role.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { env } from '../src/config/env.js'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { emailCredentials } from '../src/services/emailSvc.js'
import { seal, unseal, isSealed, sealStoredSecrets } from '../src/services/vault.js'
import { saveKey, activeKey, removeKey } from '../src/ai/apiKey.js'
import { pollVenue } from '../src/services/gloriafoodSvc.js'
import { audienceTools } from '../src/ai/tools/index.js'

let ids, owner, V, standIn, seen = []

const GF_KEY = 'gf-poll-key-77aa'
const LV_TOKEN = 'lv-token-abcdef9911'

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  // A stand-in GloriaFood (pop) and Loyverse (merchant, stores) that record
  // the key they were sent.
  standIn = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization })
    res.setHeader('content-type', 'application/json')
    if (req.url.startsWith('/pos/order/pop')) {
      if (req.headers.authorization !== GF_KEY) { res.statusCode = 401; return res.end('{}') }
      return res.end(JSON.stringify({ count: 0, orders: [] }))
    }
    if (req.headers.authorization !== 'Bearer ' + LV_TOKEN) { res.statusCode = 401; return res.end('{}') }
    if (req.url.startsWith('/merchant')) return res.end(JSON.stringify({ id: 'm1', business_name: 'Zqx Loyverse', currency: { code: 'GBP' } }))
    if (req.url.startsWith('/stores')) return res.end(JSON.stringify({ stores: [{ id: 'st1', name: 'Ware' }] }))
    return res.end(JSON.stringify({}))
  })
  await new Promise(r => standIn.listen(0, '127.0.0.1', r))
  const base = 'http://127.0.0.1:' + standIn.address().port
  env.GLORIAFOOD_API_URL = base
  env.LOYVERSE_API_URL = base
})
after(async () => {
  standIn?.close()
  await closeApp()
})

async function rawCol(sqlText) {
  return (await sql.unsafe(sqlText))[0]
}

test('email provider keys: stored sealed, never sent back, used as typed; kept, replaced or removed', async () => {
  const url = `/api/email-templates/settings/${V}`
  const saved = await ok(owner.patch(url, { email_provider: 'ses', provider_api_key: 'AKIATEST0001', provider_secret: 'ses-secret-9z9z', provider_region: 'eu-west-1' }))
  assert.equal(saved.provider_api_key, null, 'the save answer has no key')
  assert.equal(saved.provider_secret, null)
  assert.equal(saved.provider_secret_hint, '9z9z')
  const [row] = await sql`SELECT * FROM venue_email_settings WHERE venue_id = ${V}`
  assert.ok(isSealed(row.provider_api_key) && isSealed(row.provider_secret), 'sealed at rest')
  assert.ok(!row.provider_secret.includes('ses-secret'), 'not readable in the table')
  const { credentials } = emailCredentials(row, env)
  assert.equal(credentials.accessKeyId, 'AKIATEST0001')
  assert.equal(credentials.secretAccessKey, 'ses-secret-9z9z', 'the SES secret has its own column now')

  const got = await ok(owner.get(url))
  assert.equal(got.provider_api_key, null)
  assert.equal(got.provider_api_key_hint, '0001')
  // A role with View on Booking emails (none by default but owner and admin).
  const roles = await ok(owner.get('/api/access/roles'))
  const opRole = roles.find(r => r.key === 'operator')
  await ok(owner.patch('/api/access/roles/' + opRole.id, { permissions: { ...opRole.permissions, email_templates: 'view' } }))
  const viewer = await ok(as(A.operator, ids.a).get(url))
  assert.equal(viewer.provider_api_key, null)
  assert.equal(viewer.provider_api_key_hint, undefined, 'View: no hints')
  assert.equal(viewer.secrets_hidden, true)
  assert.equal((await as(A.operator, ids.a).patch(url, { provider_api_key: 'x' })).status, 403)

  await ok(owner.patch(url, { from_name: 'Zqx Thai', provider_api_key: '' }))
  const [kept] = await sql`SELECT provider_api_key FROM venue_email_settings WHERE venue_id = ${V}`
  assert.equal(unseal(kept.provider_api_key), 'AKIATEST0001', 'left empty: kept')
  await ok(owner.patch(url, { provider_api_key: 'AKIATEST0002' }))
  const [rep] = await sql`SELECT provider_api_key FROM venue_email_settings WHERE venue_id = ${V}`
  assert.equal(unseal(rep.provider_api_key), 'AKIATEST0002', 'typed: replaced')
  await ok(owner.patch(url, { provider_api_key: null }))
  const [gone] = await sql`SELECT provider_api_key FROM venue_email_settings WHERE venue_id = ${V}`
  assert.equal(gone.provider_api_key, null, 'null: removed')
})

test('the GloriaFood poll key: sealed, checked and polled with the key as typed', async () => {
  seen = []
  const put = await ok(owner.put(`/api/gloriafood/venues/${V}/link`, { method: 'poll', poll_key: GF_KEY, show_on_board: true }))
  assert.equal(put.link.poll_key_hint, '77aa')
  assert.ok(seen.some(s => s.auth === GF_KEY), 'the check poll sent the real key')
  const [row] = await sql`SELECT poll_key FROM gloriafood_venue_links WHERE venue_id = ${V}`
  assert.ok(isSealed(row.poll_key) && !row.poll_key.includes(GF_KEY))
  seen = []
  await ok(owner.put(`/api/gloriafood/venues/${V}/link`, { method: 'poll', poll_key: GF_KEY, show_on_board: true }))
  assert.equal(seen.length, 0, 'the same key typed again isn\'t checked again')
  await pollVenue(ids.a, V)
  assert.ok(seen.some(s => s.auth === GF_KEY), 'the minute poll unseals it')
  const wrong = await owner.put(`/api/gloriafood/venues/${V}/link`, { method: 'poll', poll_key: 'wrong-key-0000', show_on_board: true })
  assert.equal(wrong.status, 422, 'a rejected key is refused')
  const [still] = await sql`SELECT poll_key FROM gloriafood_venue_links WHERE venue_id = ${V}`
  assert.equal(unseal(still.poll_key), GF_KEY, 'and the saved one is put back')
})

test('Loyverse tokens: sealed, never sent back, used for every Loyverse call', async () => {
  seen = []
  const c = await ok(owner.post('/api/loyverse/connections', { name: 'Zqx Loyverse', access_token: LV_TOKEN }))
  assert.equal(c.token_hint, '9911')
  assert.equal(JSON.stringify(c).includes(LV_TOKEN), false)
  const [row] = await sql`SELECT access_token FROM loyverse_connections WHERE id = ${c.id}`
  assert.ok(isSealed(row.access_token) && !row.access_token.includes(LV_TOKEN))
  const test1 = await ok(owner.post(`/api/loyverse/connections/${c.id}/test`, {}))
  assert.equal(test1.ok, true, 'the stored token works')
  const list = await ok(owner.get('/api/loyverse/connections'))
  assert.equal(JSON.stringify(list).includes(LV_TOKEN), false)
})

test('the Anthropic key: sealed in platform_secrets, the chats get it as saved', async () => {
  await saveKey('sk-ant-test-key-5150', 'tests')
  const [row] = await sql`SELECT value, hint FROM platform_secrets WHERE name = 'anthropic_api_key'`
  assert.ok(isSealed(row.value) && !row.value.includes('sk-ant'))
  assert.equal(row.hint, '5150')
  assert.equal((await activeKey()).key, 'sk-ant-test-key-5150')
  await removeKey()
})

test('keys saved before sealing are sealed at start, once', async () => {
  const [conn] = await sql`
    INSERT INTO loyverse_connections (tenant_id, name, access_token, token_hint)
    VALUES (${ids.a}, 'Zqx Old', 'plain-old-token-1234', '1234') RETURNING id`
  await sql`UPDATE venue_email_settings SET smtp_pass = 'plain-smtp-pass' WHERE venue_id = ${V}`
  const n = await sealStoredSecrets()
  assert.ok(n >= 2, 'sealed ' + n)
  const [lv] = await sql`SELECT access_token FROM loyverse_connections WHERE id = ${conn.id}`
  const [em] = await sql`SELECT smtp_pass FROM venue_email_settings WHERE venue_id = ${V}`
  assert.equal(unseal(lv.access_token), 'plain-old-token-1234')
  assert.equal(unseal(em.smtp_pass), 'plain-smtp-pass')
  assert.equal(await sealStoredSecrets(), 0, 'nothing left to seal')
  assert.ok(seal('x') !== seal('x'), 'a fresh iv each time')
})

// ── Connector tokens ─────────────────────────────────────────────

async function mcp(token, method, params = {}) {
  const app = await getApp()
  const res = await app.inject({
    method: 'POST', url: '/mcp/staff/thai-house',
    headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream',
      authorization: 'Bearer ' + token, [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET,
    },
    payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  let json = null
  try { json = res.json() } catch { json = null }
  return { status: res.statusCode, json, body: res.body }
}
const toolNames = r => (r.json?.result?.tools || []).map(t => t.name)

test('tokens: an expiry, read-only lists and runs only reading tools, an expired one is refused', async () => {
  const bad = await owner.post('/api/ai/tokens', { name: 'Odd', expires_in_days: 45 })
  assert.equal(bad.status, 400)
  const full = await ok(owner.post('/api/ai/tokens', { name: 'Full' }))
  const days = (Date.parse(full.expires_at) - Date.now()) / 86_400_000
  assert.ok(days > 89 && days <= 90, 'ninety days unless chosen: ' + days)
  const ro = await ok(owner.post('/api/ai/tokens', { name: 'Read', expires_in_days: 30, read_only: true }))
  assert.equal(ro.read_only, true)

  const all = audienceTools('staff')
  const fullList = toolNames(await mcp(full.token, 'tools/list'))
  assert.equal(fullList.length, all.length, 'the owner sees every tool')
  const roList = toolNames(await mcp(ro.token, 'tools/list'))
  const changers = new Set(all.filter(t => t.confirm).map(t => t.name))
  assert.ok(roList.length > 20 && roList.every(n => !changers.has(n)), 'read only: no change tools')
  const call = await mcp(ro.token, 'tools/call', { name: 'set_sold_out', arguments: { venue: 'Ware', dish: 'x', sold_out: true } })
  assert.equal(call.json?.result?.isError, true)
  assert.match(call.json.result.content[0].text, /can only read/)
  const read = await mcp(ro.token, 'tools/call', { name: 'list_venues', arguments: {} })
  assert.notEqual(read.json?.result?.isError, true, read.body.slice(0, 200))

  const tokens = await ok(owner.get('/api/ai/tokens'))
  assert.equal(tokens.find(t => t.id === ro.id).read_only, true)
  await sql`UPDATE ai_access_tokens SET expires_at = now() - interval '1 minute' WHERE id = ${ro.id}`
  const expired = await mcp(ro.token, 'tools/list')
  assert.equal(expired.status, 401)
  assert.match(expired.body, /expired/)
  assert.equal((await ok(owner.get('/api/ai/tokens'))).find(t => t.id === ro.id).expired, true)
})

test('the tool list follows the person\'s role', async () => {
  // Viewers have no Pepper by default: give the role View on it.
  const roles = await ok(owner.get('/api/access/roles'))
  const viewerRole = roles.find(r => r.key === 'viewer')
  await ok(owner.patch('/api/access/roles/' + viewerRole.id, { permissions: { ...viewerRole.permissions, ai_assistant: 'view' } }))
  const listFor = async sub => {
    const made = await ok(as(sub, ids.a).post('/api/ai/tokens', { name: 'For ' + sub }))
    return toolNames(await mcp(made.token, 'tools/list'))
  }
  const op = await listFor(A.operator)
  const view = await listFor(A.viewer)
  const all = audienceTools('staff')
  assert.ok(op.length < all.length && op.length > view.length, `operator ${op.length}, viewer ${view.length}, all ${all.length}`)
  const changers = new Set(all.filter(t => t.confirm).map(t => t.name))
  assert.ok(view.every(n => !changers.has(n)), 'a viewer manages nothing, so no change tools')
  assert.ok(view.includes('open_page') && view.includes('list_venues'))
  assert.ok(!view.includes('cash_day'), 'no cash tools without Cash reconciliation')
})

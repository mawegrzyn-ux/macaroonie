// Capture to For review (Pepper-first step 6b, migration 281): a photo (the
// chat's own upload checks), a voice note's words or a typed line, kept with
// who, when and the venue; listed on For review's Waiting tab; Open in Pepper
// hands the words and the photo to a new chat; Dismiss takes it off. No model
// call when a capture is made. Another group's captures are not found.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, closeApp, sql, getApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { DEVICE_HEADER, ACT_HEADER } from '../src/middleware/sharedDevice.js'

let ids, owner, operator, viewer, other, V

// A 1 x 1 PNG.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex')

async function upload(sub, tenantId, { name, data, fields = {}, headers = {} }) {
  const boundary = '----cap' + Math.random().toString(16).slice(2)
  const parts = []
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`))
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n\r\n`), data, Buffer.from(`\r\n--${boundary}--\r\n`))
  const res = await (await getApp()).inject({
    method: 'POST', url: '/api/ai/captures', payload: Buffer.concat(parts),
    headers: {
      authorization: 'Bearer test:' + sub, 'x-tenant-id': tenantId,
      'content-type': `multipart/form-data; boundary=${boundary}`, [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET, ...headers,
    },
  })
  let json = null
  try { json = res.json() } catch { json = null }
  return { status: res.statusCode, json, headers: res.headers, body: res.rawPayload }
}

const waiting = async who => (await ok(who.get('/api/ai/review'))).items.filter(i => i.kind === 'capture')

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  other = as(B.owner, ids.b)
  V = filled.ids.venue
})
after(closeApp)

test('a typed line and a voice note wait on For review, with who, when and the venue; no model call', async () => {
  const [{ n: before }] = await sql`SELECT count(*)::int AS n FROM ai_requests WHERE tenant_id = ${ids.a}`
  const line = await ok(owner.post('/api/ai/captures', { venue_id: V, kind: 'text', note: 'Walk-in door seal is torn' }))
  assert.equal(line.status, 'waiting')
  assert.ok(line.person_name)
  const voice = await ok(operator.post('/api/ai/captures', { venue_id: V, kind: 'voice', note: 'Fresh Co delivered two boxes short' }))
  const [{ n: afterCount }] = await sql`SELECT count(*)::int AS n FROM ai_requests WHERE tenant_id = ${ids.a}`
  assert.equal(afterCount, before, 'no model call')
  const mine = await waiting(operator)
  assert.ok(mine.some(i => i.id === voice.id), 'the operator sees their own')
  assert.ok(!mine.some(i => i.id === line.id), 'and not someone else\'s without Manage')
  const all = await waiting(owner)
  const v = all.find(i => i.id === voice.id)
  assert.ok(v, 'a manager of Pepper sees everyone\'s')
  assert.equal(v.capture, 'voice')
  assert.match(v.source, /Captured by /)
  assert.deepEqual(v.lines, ['Fresh Co delivered two boxes short'])
  assert.equal(v.venue_id, V)
  assert.equal((await owner.post('/api/ai/captures', { venue_id: V, kind: 'text', note: '   ' })).status, 422, 'nothing said')
  assert.equal((await viewer.post('/api/ai/captures', { venue_id: V, kind: 'text', note: 'x' })).status, 403, 'no access to Pepper')
})

test('a photo goes through the chat\'s upload checks and is shown to whoever may see it', async () => {
  const res = await upload(A.owner, ids.a, { name: 'invoice.png', data: PNG, fields: { venue_id: V, note: 'Fresh Co invoice' } })
  assert.equal(res.status, 201, JSON.stringify(res.json))
  assert.equal(res.json.has_photo, true)
  const item = (await waiting(owner)).find(i => i.id === res.json.id)
  assert.equal(item.capture, 'photo')
  assert.equal(item.photo, '/ai/captures/' + res.json.id + '/photo')
  const photo = await owner.get('/api/ai/captures/' + res.json.id + '/photo')
  assert.equal(photo.status, 200)
  assert.equal(photo.headers['content-type'], 'image/png')
  assert.equal((await operator.get('/api/ai/captures/' + res.json.id + '/photo')).status, 404, 'not the operator\'s')
  const pdf = await upload(A.owner, ids.a, { name: 'x.pdf', data: Buffer.from('%PDF-1.4 test'), fields: { venue_id: V } })
  assert.equal(pdf.status, 422, 'a capture is a photo')
  const fake = await upload(A.owner, ids.a, { name: 'x.png', data: Buffer.from('not a picture'), fields: { venue_id: V } })
  assert.equal(fake.status, 422, 'checked by its bytes, not its name')
  // A day later, an unsent chat file is cleared; a capture's photo waits with its capture.
  await sql`UPDATE ai_attachments SET created_at = now() - interval '2 days' WHERE tenant_id = ${ids.a}`
  await upload(A.owner, ids.a, { name: 'second.png', data: PNG, fields: { venue_id: V } })
  assert.equal((await owner.get('/api/ai/captures/' + res.json.id + '/photo')).status, 200, 'still there')
})

test('Open in Pepper hands over the words and the photo; Dismiss takes it off the list', async () => {
  const res = await upload(A.owner, ids.a, { name: 'note.png', data: PNG, fields: { venue_id: V, note: 'Delivery note' } })
  const opened = await ok(owner.post('/api/ai/captures/' + res.json.id + '/open', {}))
  assert.match(opened.text, /A photo captured for .* by .*Delivery note/)
  assert.equal(opened.files.length, 1)
  const [copy] = await sql`SELECT user_sub, conversation_id, kind FROM ai_attachments WHERE id = ${opened.files[0].id}`
  assert.deepEqual(copy, { user_sub: A.owner, conversation_id: null, kind: 'image' }, 'the opener\'s own unsent file, for the chat to attach')
  assert.ok(!(await waiting(owner)).some(i => i.id === res.json.id), 'opened: off the list')
  const line = await ok(owner.post('/api/ai/captures', { venue_id: V, kind: 'text', note: 'Order more napkins' }))
  await ok(owner.post('/api/ai/captures/' + line.id + '/dismiss', {}))
  const [row] = await sql`SELECT status, handled_by FROM ai_captures WHERE id = ${line.id}`
  assert.equal(row.status, 'dismissed')
  assert.ok(row.handled_by)
  assert.equal((await owner.post('/api/ai/captures/' + line.id + '/open', {})).status, 409)
})

test('another group\'s captures are not found', async () => {
  const line = await ok(owner.post('/api/ai/captures', { venue_id: V, kind: 'text', note: 'Zqx private' }))
  assert.equal((await other.post('/api/ai/captures/' + line.id + '/open', {})).status, 404)
  assert.equal((await other.post('/api/ai/captures/' + line.id + '/dismiss', {})).status, 404)
  assert.equal((await other.get('/api/ai/captures/' + line.id + '/photo')).status, 404)
  assert.ok(!(await waiting(other)).some(i => i.id === line.id))
  assert.equal((await other.post('/api/ai/captures', { venue_id: V, kind: 'text', note: 'x' })).status, 404, 'nor made at their venue')
})

test('on a shared device a capture is the person\'s, and needs their office PIN', async () => {
  const device = await ok(owner.post('/api/shared-devices', { venue_id: V, name: 'Pass phone' }))
  await ok(operator.put('/api/shared-devices/my-pin', { pin: '7391' }))
  const [op] = await sql`SELECT id FROM users WHERE tenant_id = ${ids.a} AND auth0_user_id = ${A.operator}`
  const on = { [DEVICE_HEADER]: device.token }
  assert.equal((await owner.post('/api/ai/captures', { venue_id: V, kind: 'text', note: 'x' }, on)).json.code, 'person_needed')
  const sw = await ok(owner.post('/api/shared-devices/act', { person: 'user:' + op.id, pin: '7391' }, on))
  const made = await ok(owner.post('/api/ai/captures', { venue_id: V, kind: 'text', note: 'Hand sink has no soap' }, { ...on, [ACT_HEADER]: sw.token }))
  assert.equal(made.person_name, A.operator + '@test.local')
  const item = (await waiting(owner)).find(i => i.id === made.id)
  assert.match(item.source, /on Pass phone/)
  const photo = await upload(A.owner, ids.a, { name: 'p.png', data: PNG, fields: { venue_id: V }, headers: { [DEVICE_HEADER]: device.token, [ACT_HEADER]: sw.token } })
  assert.equal(photo.status, 201)
})

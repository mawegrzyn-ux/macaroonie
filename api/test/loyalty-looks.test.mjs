// Card looks members pick (migration 264, OUTSTANDING 44.4): the programme
// offers looks (settings.themes, normaliseProgramme()), the web app lists
// them, a member picks one for their own card (PATCH /me theme), a look not
// offered is refused, a look taken away leaves its members on the standard
// one, and the member's look is in their data export.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { memberCardColours } from '../../shared/loyalty.js'

let ids, owner, mine, session
const sent = []
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
  return { status: res.statusCode, json }
}
const guest = (method, path, body) => call(method, '/loyalty-api/t/' + SLUG + path, { body, headers: session ? { authorization: 'Loyalty ' + session } : {} })

async function lastCode(email) {
  const end = Date.now() + 4000
  while (Date.now() < end) {
    const m = [...sent].reverse().find(x => x.body.personalizations[0].to[0].email === email)
    if (m) return /(\d{6})/.exec(m.body.content[0].value.replace(/<[^>]+>/g, ' '))?.[1]
    await new Promise(r => setTimeout(r, 30))
  }
  return null
}

before(async () => {
  ids = await resetAndSeed()
  mine = await fillTenant(A.owner, ids.a)
  assert.deepEqual(mine.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  await ok(owner.post(`/api/email-templates/settings/${mine.ids.venue}`, { email_provider: 'sendgrid', provider_api_key: 'SG.looks-test', from_name: 'Ware', from_email: 'hello@ware.example' }))
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.sendgrid.com/')) {
      sent.push({ body: JSON.parse(opts.body) })
      return new Response('', { status: 202, headers: { 'x-message-id': 'sg' + sent.length } })
    }
    return realFetch(url, opts)
  }
  // The programme offers two looks; one is sent with no id and gets one from its name.
  const prog = (await ok(owner.get('/api/loyalty/programme'))).programme
  await ok(owner.put('/api/loyalty/programme', { enabled: true, settings: { ...prog.settings, features: { ...prog.settings.features, web_app: true }, themes: [
    { id: 'look-ocean', name: 'Ocean', background: '#0E7490', text: null, accent: '#fde68a' },
    { name: 'Rose garden', background: '#fce7f3', text: '#831843' },
    { name: 'Bad colour', background: 'blue' },
  ] } }))
  // A member, joined through the web app.
  const email = 'looks@zqx.test'
  assert.equal((await guest('POST', '/code', { email })).status, 200)
  const v = await guest('POST', '/verify', { email, code: await lastCode(email) })
  const j = await guest('POST', '/join', { join_ticket: v.json.join_ticket, email, name: 'Lou Looks', agreed: true, marketing: false })
  assert.equal(j.status, 201, JSON.stringify(j.json))
  session = j.json.session
})
after(async () => { globalThis.fetch = realFetch; await closeApp() })

test('the programme keeps valid looks, ids kept or made from the name', async () => {
  const prog = (await ok(owner.get('/api/loyalty/programme'))).programme
  assert.deepEqual(prog.settings.themes.map(t => [t.id, t.name, t.background, t.text, t.accent]), [
    ['look-ocean', 'Ocean', '#0e7490', null, '#fde68a'],
    ['rose-garden', 'Rose garden', '#fce7f3', '#831843', null],
  ], 'a look without a valid background is dropped')
})

test('the web app lists the looks in full; a member picks one; a look not offered is refused', async () => {
  const info = (await guest('GET', '')).json
  assert.deepEqual(info.card.themes.map(t => t.id), ['look-ocean', 'rose-garden'])
  const ocean = info.card.themes[0]
  assert.equal(ocean.text, '#ffffff', 'words worked out on a dark background')
  assert.equal(info.card.themes[1].accent, '#831843', 'highlights fall back to the words')
  assert.match(info.card.standard.background, /^#[0-9a-f]{6}$/)

  let me = (await guest('GET', '/me')).json
  assert.equal(me.card_theme, null, 'the standard look to begin with')
  me = (await guest('PATCH', '/me', { theme: 'look-ocean' })).json
  assert.equal(me.card_theme, 'look-ocean')
  const [row] = await sql`SELECT card_theme, wallet_updated_at FROM loyalty_members WHERE tenant_id = ${ids.a} AND email = 'looks@zqx.test'`
  assert.equal(row.card_theme, 'look-ocean')
  assert.ok(row.wallet_updated_at, 'wallet cards are updated with the new look')
  const bad = await guest('PATCH', '/me', { theme: 'look-gone' })
  assert.equal(bad.status, 422)
  assert.match(bad.json.error, /isn't offered/)
  const exported = (await guest('GET', '/me/export')).json
  assert.equal(exported.member.card_theme, 'look-ocean', 'the pick is in their data export')
})

test('a look taken away puts its members back on the standard look', async () => {
  const prog = (await ok(owner.get('/api/loyalty/programme'))).programme
  await ok(owner.put('/api/loyalty/programme', { enabled: prog.enabled, settings: { ...prog.settings, themes: prog.settings.themes.filter(t => t.id !== 'look-ocean') } }))
  const me = (await guest('GET', '/me')).json
  assert.equal(me.card_theme, null, 'not offered: the standard look')
  const settings = (await ok(owner.get('/api/loyalty/programme'))).programme.settings
  assert.deepEqual(memberCardColours(settings, {}, 'look-ocean'), memberCardColours(settings, {}, null), 'the colours are the standard ones')
  assert.equal((await guest('PATCH', '/me', { theme: null })).status, 200, 'back to standard by choice')
})

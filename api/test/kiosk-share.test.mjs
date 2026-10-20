// A kiosk design's lasting preview link for people outside the group
// (migration 187): making it, the public preview it opens, a new link, an end
// date, stopping it, permissions and other tenants.
import test from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'

let ids, owner, venue, venue2, stream, design, venueB

async function pub(url) {
  const app = await getApp()
  const res = await app.inject({ method: 'GET', url, headers: { [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET } })
  let json = null
  try { json = res.json() } catch { json = null }
  return { status: res.statusCode, json, body: res.body }
}
const tokenOf = url => new URL(url).searchParams.get('kiosk_share')

test.before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  venue = await ok(owner.post('/api/venues', { name: 'Ware', slug: 'ware', timezone: 'Europe/London' }))
  venue2 = await ok(owner.post('/api/venues', { name: 'Hertford', slug: 'hertford', timezone: 'Europe/London' }))
  stream = await ok(owner.post(`/api/pos/venues/${venue.id}/revenue-streams`, { name: 'Takeaway' }))
  design = await ok(owner.post('/api/pos/kiosk-designs', { name: 'Summer look', settings: {} }))
  venueB = await ok(as(B.owner, ids.b).post('/api/venues', { name: 'Elsewhere', slug: 'elsewhere', timezone: 'Europe/London' }))
})
test.after(closeApp)

let token

test('a link: made once, opens without signing in, counts its views', async () => {
  const list0 = await ok(owner.get('/api/pos/kiosk-designs'))
  assert.equal(list0.find(d => d.id === design.id).share, null)
  const share = await ok(owner.put(`/api/pos/kiosk-designs/${design.id}/share`, { venue_id: venue.id, revenue_stream_id: stream.id }))
  assert.match(share.url, /^https?:\/\/kiosk\.[^/]+\/\?kiosk_share=[A-Za-z0-9_-]{32}$/)
  token = tokenOf(share.url)
  assert.equal(share.views, 0)
  // Saving again keeps the same link.
  const again = await ok(owner.put(`/api/pos/kiosk-designs/${design.id}/share`, { venue_id: venue2.id }))
  assert.equal(tokenOf(again.url), token)
  assert.equal(again.venue_id, venue2.id)
  await ok(owner.put(`/api/pos/kiosk-designs/${design.id}/share`, { venue_id: venue.id, revenue_stream_id: stream.id }))
  // A design save leaves it alone.
  await ok(owner.put(`/api/pos/kiosk-designs/${design.id}`, { name: 'Summer look 2', settings: {} }))

  const res = await pub('/pos-api/kiosk-share?token=' + token)
  assert.equal(res.status, 200, res.body)
  assert.equal(res.json.share.design, 'Summer look 2')
  assert.equal(res.json.share.venue, 'Ware')
  assert.equal(res.json.device.settings.revenue_stream_id, stream.id, 'orders as the stream picked')
  assert.equal(res.json.device.settings.card_reader, 'preview', 'a shared preview never takes a card')
  await pub('/pos-api/kiosk-share?token=' + token)
  const list = await ok(owner.get('/api/pos/kiosk-designs'))
  const s = list.find(d => d.id === design.id).share
  assert.equal(s.views, 2)
  assert.ok(s.last_viewed_at)
  const setup = await ok(owner.get(`/api/pos/venues/${venue.id}/setup`))
  assert.equal(setup.kiosk_designs.find(d => d.id === design.id).shared, true)
})

test('bad links, a new link, an end date, stopping', async () => {
  assert.equal((await pub('/pos-api/kiosk-share?token=short')).status, 404)
  assert.equal((await pub('/pos-api/kiosk-share?token=' + 'x'.repeat(32))).status, 404)
  assert.equal((await pub('/pos-api/kiosk-share')).status, 404)

  const fresh = await ok(owner.post(`/api/pos/kiosk-designs/${design.id}/share/new-link`, {}))
  const next = tokenOf(fresh.url)
  assert.notEqual(next, token)
  assert.equal(fresh.views, 0)
  assert.equal((await pub('/pos-api/kiosk-share?token=' + token)).status, 404, 'the old link stops')
  assert.equal((await pub('/pos-api/kiosk-share?token=' + next)).status, 200)

  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  assert.equal((await owner.put(`/api/pos/kiosk-designs/${design.id}/share`, { venue_id: venue.id, expires_on: yesterday })).status, 422)
  const later = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
  const dated = await ok(owner.put(`/api/pos/kiosk-designs/${design.id}/share`, { venue_id: venue.id, expires_on: later }))
  assert.equal(String(dated.expires_at).slice(0, 10), later)
  assert.equal((await pub('/pos-api/kiosk-share?token=' + next)).json.share.expires_at.slice(0, 10), later)
  await sql`UPDATE kiosk_designs SET share_expires_at = now() - interval '1 minute' WHERE id = ${design.id}`
  const ran = await pub('/pos-api/kiosk-share?token=' + next)
  assert.equal(ran.status, 410)
  assert.match(ran.json.error, /run out/)
  const list = await ok(owner.get('/api/pos/kiosk-designs'))
  assert.equal(list.find(d => d.id === design.id).share.expired, true)

  await ok(owner.delete(`/api/pos/kiosk-designs/${design.id}/share`))
  assert.equal((await pub('/pos-api/kiosk-share?token=' + next)).status, 404)
  assert.equal((await ok(owner.get('/api/pos/kiosk-designs'))).find(d => d.id === design.id).share, null)
  assert.equal((await owner.post(`/api/pos/kiosk-designs/${design.id}/share/new-link`, {})).status, 422, 'nothing to renew')
})

test('another tenant, other tenants\' venues and people without access', async () => {
  const b = as(B.owner, ids.b)
  assert.equal((await b.put(`/api/pos/kiosk-designs/${design.id}/share`, { venue_id: venueB.id })).status, 404)
  assert.equal((await b.delete(`/api/pos/kiosk-designs/${design.id}/share`)).status, 404)
  assert.equal((await b.post(`/api/pos/kiosk-designs/${design.id}/share/new-link`, {})).status, 404)
  assert.equal((await owner.put(`/api/pos/kiosk-designs/${design.id}/share`, { venue_id: venueB.id })).status, 404, 'another tenant\'s venue')
  const streamB = await ok(owner.post(`/api/pos/venues/${venue2.id}/revenue-streams`, { name: 'Bar' }))
  assert.equal((await owner.put(`/api/pos/kiosk-designs/${design.id}/share`, { venue_id: venue.id, revenue_stream_id: streamB.id })).status, 422, 'a stream of another venue')
  for (const who of [A.operator, A.viewer]) {
    assert.equal((await as(who, ids.a).put(`/api/pos/kiosk-designs/${design.id}/share`, { venue_id: venue.id })).status, 403, who)
  }
  // A venue removed after sharing: the link says so.
  const share = await ok(owner.put(`/api/pos/kiosk-designs/${design.id}/share`, { venue_id: venue2.id }))
  await sql`UPDATE kiosk_designs SET share_venue_id = NULL WHERE id = ${design.id}`
  assert.equal((await pub('/pos-api/kiosk-share?token=' + tokenOf(share.url))).status, 404)
})

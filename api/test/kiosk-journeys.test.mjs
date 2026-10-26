// Kiosk journeys (migration 208): a kiosk sends the visits it recorded, they
// are stored once each with the kiosk's own pairing, summed up, reported on
// (Kiosk analytics) and opened for playback; other devices, other tenants
// and people without Till reports are refused; old playbacks are cleared.
import test from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { readPreviewToken } from '../src/services/kioskSvc.js'
import { cleanUpJourneys } from '../src/services/kioskJourneySvc.js'
import { ulid } from '../../shared/pos/ids.js'

let ids, owner, venue, stream, design, design2, kiosk, till, venueB, kioskB, designB

async function device(d, method, url, body) {
  const app = await getApp()
  const res = await app.inject({
    method, url,
    headers: {
      ...(d ? { authorization: `Device ${d.device_id}.${d.secret}` } : {}),
      [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    payload: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = res.json() } catch { json = null }
  return { status: res.statusCode, json }
}

const today = () => new Date().toISOString().slice(0, 10)
const DISH = '11111111-1111-4111-8111-111111111111'
const START = { screen: 'start', section: null, orderType: null, lang: 'en', reach: false, prefs: { avoid: [], diet: [] }, basket: [], builder: null, details: { name: 0, tent: 0 }, value: 0, result: null }

function visit({ started = new Date(Date.now() - 600_000), ordered = true, extra = {} } = {}) {
  const basket = [{ key: 'A', item_id: DISH, qty: 2, selection: {} }]
  const events = [
    { t: 0, k: 'vp', w: 1080, h: 1920 },
    { t: 0, k: 'v', p: START },
    { t: 50, k: 'tap', x: 540, y: 1500, el: 'Start order', id: 'k-type', hit: 1 },
    { t: 120, k: 'v', p: { screen: 'menu', section: 'home' } },
    { t: 4000, k: 'v', p: { builder: { item_id: DISH, key: null, qty: 1, selection: {} } } },
    { t: 9000, k: 'v', p: { builder: null, basket, value: 1700 } },
    { t: 9500, k: 'tap', x: 10, y: 10, el: 'the screen', hit: 0 },
    { t: 12000, k: 'v', p: { screen: 'basket' } },
    ...(ordered
      ? [{ t: 15000, k: 'v', p: { screen: 'done', result: { order_no: 17, provisional: 'KS-0001', pending: false, total: 1700, check: 'CHECK1' } } },
        { t: 20000, k: 'v', p: { ...START } }, { t: 20000, k: 'end', why: 'done' }]
      : [{ t: 70000, k: 'v', p: { 'ui:idle': 20 } }, { t: 90000, k: 'v', p: { ...START }, d: ['ui:idle'] }, { t: 90000, k: 'end', why: 'timeout' }]),
  ]
  return {
    id: ulid(), started_at: started.toISOString(), ended_at: new Date(started.getTime() + 1).toISOString(),
    design_id: design.id, stream_id: stream.id, config_version: 'v1', app_version: '1.0.0',
    names: { [DISH]: 'Wings' }, events, ...extra,
  }
}

test.before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  venue = await ok(owner.post('/api/venues', { name: 'Ware', slug: 'ware', timezone: 'Europe/London' }))
  stream = await ok(owner.post(`/api/pos/venues/${venue.id}/revenue-streams`, { name: 'Kiosk' }))
  design = await ok(owner.post('/api/pos/kiosk-designs', { name: 'Bright', settings: {} }))
  design2 = await ok(owner.post('/api/pos/kiosk-designs', { name: 'Calm', settings: {} }))
  kiosk = await linkDevice(owner, venue.id, { kind: 'kiosk', name: 'Kiosk 1', settings: { design_id: design.id, revenue_stream_id: stream.id } })
  till = await linkDevice(owner, venue.id, { kind: 'terminal', name: 'Till 1', settings: { revenue_stream_id: stream.id } })
  const bOwner = as(B.owner, ids.b)
  venueB = await ok(bOwner.post('/api/venues', { name: 'Elsewhere', slug: 'elsewhere', timezone: 'Europe/London' }))
  designB = await ok(bOwner.post('/api/pos/kiosk-designs', { name: 'Theirs', settings: {} }))
  kioskB = await linkDevice(bOwner, venueB.id, { kind: 'kiosk', name: 'Their kiosk', settings: { design_id: designB.id } })
})
test.after(closeApp)

let ordered, timedOut

test('a kiosk sends its visits: stored once each, with its own pairing, summed up', async () => {
  ordered = visit()
  timedOut = visit({ ordered: false, extra: { stream_id: null } })
  const r = await device(kiosk, 'POST', '/pos-api/kiosk/journeys', { sessions: [ordered, timedOut] })
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.deepEqual(r.json.accepted.sort(), [ordered.id, timedOut.id].sort())
  assert.equal(r.json.saved, 2)
  // Sent again (the reply was lost): nothing doubles.
  const again = await device(kiosk, 'POST', '/pos-api/kiosk/journeys', { sessions: [ordered] })
  assert.equal(again.json.saved, 0)
  assert.deepEqual(again.json.accepted, [ordered.id])
  const rows = await sql`SELECT * FROM kiosk_sessions WHERE tenant_id = ${ids.a} ORDER BY started_at`
  assert.equal(rows.length, 2)
  const o = rows.find(x => x.id === ordered.id)
  assert.equal(o.device_id, kiosk.device_id)
  assert.equal(o.venue_id, venue.id)
  assert.equal(o.design_id, design.id)
  assert.equal(o.revenue_stream_id, stream.id)
  assert.equal(o.outcome, 'ordered')
  assert.equal(o.order_no, '17')
  assert.equal(o.check_id, 'CHECK1')
  assert.equal(o.total_pence, 1700)
  assert.equal(o.items_added, 2)
  assert.equal(o.taps, 2)
  assert.equal(o.dead_taps, 1)
  assert.equal(o.duration_ms, 20000)
  // Ended when its last event was, whatever the kiosk said.
  assert.equal(new Date(o.ended_at).getTime() - new Date(o.started_at).getTime(), 20000)
  assert.deepEqual(o.viewport, { w: 1080, h: 1920 })
  assert.equal(o.summary.furthest, 'ordered')
  assert.equal(o.names[DISH], 'Wings')
  assert.equal(o.events.length, ordered.events.length)
  const t = rows.find(x => x.id === timedOut.id)
  assert.equal(t.outcome, 'timed_out')
  assert.equal(t.last_screen, 'basket')
  assert.equal(t.basket_value_pence, 1700)
  assert.equal(t.revenue_stream_id, null)
})

test('what a kiosk sends is checked: bad visits refused (and forgotten), events trimmed', async () => {
  const theirs = visit({ extra: { design_id: designB.id, stream_id: '22222222-2222-4222-8222-222222222222' } })
  const old = visit({ started: new Date(Date.now() - 40 * 86_400_000) })
  const empty = { ...visit(), events: [] }
  const noId = { ...visit(), id: 'not-a-ulid' }
  const messy = visit({
    extra: {
      events: [
        { t: 0, k: 'v', p: START },
        { t: 500, k: 'tap', x: 99999, y: -5, el: 'x'.repeat(300), id: 'k-item', hit: 7, extra: 'dropped' },
        { t: 200, k: 'scroll', s: '0/1/2', y: 300 },
        { t: 300, k: 'scroll', s: '../etc', y: 300 },
        { t: 400, k: 'mystery', anything: true },
        { t: 450, k: 'vp', w: 768, h: 1024, b: [96, 0, 576, 1024] },
        { t: 460, k: 'vp', w: 768, h: 1024, b: [96, 0, 99999, 'x'] },
        { t: 470, k: 'vp', w: 768, h: 1024, b: [-5, 2000, 99999, 0] },
        { t: 'soon', k: 'end', why: 'because' },
      ],
    },
  })
  const r = await device(kiosk, 'POST', '/pos-api/kiosk/journeys', { sessions: [theirs, old, empty, noId, messy] })
  assert.equal(r.status, 200)
  assert.equal(r.json.saved, 2)
  assert.deepEqual(r.json.refused.map(x => x.id).sort(), [old.id, empty.id, null].sort())
  // Refused visits with an id are accepted too: the kiosk forgets them.
  assert.ok(r.json.accepted.includes(old.id) && r.json.accepted.includes(empty.id))
  const [row] = await sql`SELECT design_id, revenue_stream_id FROM kiosk_sessions WHERE tenant_id = ${ids.a} AND id = ${theirs.id}`
  assert.equal(row.design_id, null, 'another tenant\'s design isn\'t kept')
  assert.equal(row.revenue_stream_id, null, 'an unknown stream isn\'t kept')
  const [m] = await sql`SELECT events, outcome FROM kiosk_sessions WHERE tenant_id = ${ids.a} AND id = ${messy.id}`
  assert.deepEqual(m.events.map(e => e.k), ['v', 'tap', 'scroll', 'vp', 'vp', 'vp', 'end'])
  // The kiosk's box in the window comes with a window size, kept inside it; a broken one is left off.
  const [vp1, vp2, vp3] = m.events.filter(e => e.k === 'vp')
  assert.deepEqual(vp1.b, [96, 0, 576, 1024])
  assert.equal(vp2.b, undefined)
  assert.deepEqual(vp3.b, [0, 1024, 768, 1])
  const tap = m.events[1]
  assert.equal(tap.x, 20000)
  assert.equal(tap.y, 0)
  assert.equal(tap.el.length, 80)
  assert.equal(tap.hit, 1)
  assert.equal(tap.extra, undefined)
  // In time order: the scroll sent with an earlier time takes the tap's.
  assert.equal(m.events[2].t, 500)
  assert.equal(m.events[6].why, 'interrupted')
  assert.equal(m.outcome, 'interrupted')
  await sql`DELETE FROM kiosk_sessions WHERE tenant_id = ${ids.a} AND id IN (${theirs.id}, ${messy.id})`

  // Too many at once, a till, no pairing.
  const many = Array.from({ length: 11 }, () => visit())
  assert.equal((await device(kiosk, 'POST', '/pos-api/kiosk/journeys', { sessions: many })).status, 400)
  assert.equal((await device(till, 'POST', '/pos-api/kiosk/journeys', { sessions: [visit()] })).status, 403)
  assert.equal((await device(null, 'POST', '/pos-api/kiosk/journeys', { sessions: [visit()] })).status, 401)
  // Another tenant's kiosk stores under its own tenant and venue, whatever it says.
  const b = await device(kioskB, 'POST', '/pos-api/kiosk/journeys', { sessions: [visit({ extra: { design_id: design.id } })] })
  assert.equal(b.json.saved, 1)
  const [rb] = await sql`SELECT tenant_id, venue_id, design_id FROM kiosk_sessions WHERE tenant_id = ${ids.b}`
  assert.equal(rb.venue_id, venueB.id)
  assert.equal(rb.design_id, null)
})

test('the report: figures for the days, filters, and who may see it', async () => {
  const day = today()
  const r = await ok(owner.get(`/api/pos/kiosk-analytics/venues/${venue.id}?from=${day}&to=${day}`))
  assert.equal(r.overview.sessions, 2)
  assert.equal(r.overview.ordered, 1)
  assert.equal(r.overview.conversion, 0.5)
  assert.equal(r.overview.revenue, 1700)
  assert.equal(r.overview.abandoned_value, 1700)
  assert.equal(r.overview.outcomes.timed_out, 1)
  assert.equal(r.overview.funnel.find(f => f.stage === 'basket').sessions, 2)
  assert.equal(r.overview.items.find(x => x.id === DISH).name, 'Wings')
  assert.deepEqual(r.devices.map(d => d.name), ['Kiosk 1'])
  assert.deepEqual(r.designs.map(d => d.name).sort(), ['Bright', 'Calm'])
  assert.equal(r.overview.by_device[0].device_id, kiosk.device_id)
  // Filters.
  const byDevice = await ok(owner.get(`/api/pos/kiosk-analytics/venues/${venue.id}?from=${day}&to=${day}&device_id=${till.device_id}`))
  assert.equal(byDevice.overview.sessions, 0)
  const byDesign = await ok(owner.get(`/api/pos/kiosk-analytics/venues/${venue.id}?from=${day}&to=${day}&design_id=${design.id}`))
  assert.equal(byDesign.overview.sessions, 2)
  const before = await ok(owner.get(`/api/pos/kiosk-analytics/venues/${venue.id}?from=2026-01-01&to=2026-01-02`))
  assert.equal(before.overview.sessions, 0)
  assert.equal((await owner.get(`/api/pos/kiosk-analytics/venues/${venue.id}?from=2026-01-01&to=2026-06-30`)).status, 422)
  assert.equal((await owner.get(`/api/pos/kiosk-analytics/venues/${venue.id}?from=${day}&to=2026-01-01`)).status, 422)
  assert.equal((await owner.get(`/api/pos/kiosk-analytics/venues/${venue.id}`)).status, 400)
  // Till reports view: an operator may, a viewer may not; another tenant's venue is not found.
  assert.equal((await as(A.operator, ids.a).get(`/api/pos/kiosk-analytics/venues/${venue.id}?from=${day}&to=${day}`)).status, 200)
  assert.equal((await as(A.viewer, ids.a).get(`/api/pos/kiosk-analytics/venues/${venue.id}?from=${day}&to=${day}`)).status, 403)
  assert.equal((await as(B.owner, ids.b).get(`/api/pos/kiosk-analytics/venues/${venue.id}?from=${day}&to=${day}`)).status, 404)
})

test('the visits, newest first, by outcome', async () => {
  const day = today()
  const all = await ok(owner.get(`/api/pos/kiosk-analytics/venues/${venue.id}/sessions?from=${day}&to=${day}`))
  assert.equal(all.total, 2)
  assert.equal(all.sessions.length, 2)
  assert.ok(new Date(all.sessions[0].started_at) >= new Date(all.sessions[1].started_at))
  assert.equal(all.sessions[0].events, undefined, 'the list carries no events')
  assert.equal(all.sessions[0].device_name, 'Kiosk 1')
  assert.equal(all.sessions[0].design_name, 'Bright')
  assert.equal(all.sessions[0].has_events, true)
  const only = await ok(owner.get(`/api/pos/kiosk-analytics/venues/${venue.id}/sessions?from=${day}&to=${day}&outcome=timed_out`))
  assert.deepEqual(only.sessions.map(s => s.id), [timedOut.id])
  const paged = await ok(owner.get(`/api/pos/kiosk-analytics/venues/${venue.id}/sessions?from=${day}&to=${day}&limit=1&offset=1`))
  assert.equal(paged.sessions.length, 1)
  assert.equal(paged.total, 2)
  assert.equal((await owner.get(`/api/pos/kiosk-analytics/venues/${venue.id}/sessions?from=${day}&to=${day}&outcome=bored`)).status, 400)
})

test('one visit: its events and a playback link on the kiosk mock-up', async () => {
  const r = await ok(owner.get(`/api/pos/kiosk-analytics/sessions/${ordered.id}`))
  assert.equal(r.session.id, ordered.id)
  assert.equal(r.session.venue_name, 'Ware')
  assert.equal(r.events.length, ordered.events.length)
  assert.equal(r.names[DISH], 'Wings')
  assert.equal(r.summary.outcome, 'ordered')
  const url = new URL(r.replay.url)
  assert.equal(url.searchParams.get('replay'), '1')
  const p = await readPreviewToken(url.searchParams.get('kiosk_preview'))
  assert.equal(p.designId, design.id)
  assert.equal(p.venueId, venue.id)
  assert.equal(p.streamId, stream.id)
  assert.equal(p.menuVersion, 'live')
  assert.ok(r.notes.some(n => /menu is now/.test(n)))
  // The link opens the kiosk's preview config.
  const app = await getApp()
  const cfg = await app.inject({ method: 'GET', url: '/pos-api/kiosk-preview?token=' + encodeURIComponent(url.searchParams.get('kiosk_preview')), headers: { [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET } })
  assert.equal(cfg.statusCode, 200)
  assert.equal(cfg.json().design.id, design.id)

  // The design changed since the visit: said so.
  await ok(owner.put(`/api/pos/kiosk-designs/${design.id}`, { name: 'Bright', settings: { brand: { radius: 4 } } }))
  const changed = await ok(owner.get(`/api/pos/kiosk-analytics/sessions/${ordered.id}`))
  assert.ok(changed.notes.some(n => /changed since/.test(n)))

  // Its design deleted: the kiosk's own design now, else no playback.
  await ok(owner.patch(`/api/pos/devices/${kiosk.device_id}`, { settings: { design_id: design2.id, revenue_stream_id: stream.id } }))
  await ok(owner.delete(`/api/pos/kiosk-designs/${design.id}`))
  const moved = await ok(owner.get(`/api/pos/kiosk-analytics/sessions/${ordered.id}`))
  assert.equal(moved.session.design_id, null)
  assert.equal(moved.replay.design_id, design2.id)
  assert.ok(moved.notes.some(n => /plays back with Calm/.test(n)))
  await ok(owner.patch(`/api/pos/devices/${kiosk.device_id}`, { settings: { design_id: null, revenue_stream_id: stream.id } }))
  const none = await ok(owner.get(`/api/pos/kiosk-analytics/sessions/${ordered.id}`))
  assert.equal(none.replay, null)
  assert.ok(none.notes.some(n => /can't be played back/.test(n)))

  // Others.
  assert.equal((await as(B.owner, ids.b).get(`/api/pos/kiosk-analytics/sessions/${ordered.id}`)).status, 404)
  assert.equal((await as(A.viewer, ids.a).get(`/api/pos/kiosk-analytics/sessions/${ordered.id}`)).status, 403)
  assert.equal((await owner.get('/api/pos/kiosk-analytics/sessions/nope')).status, 400)
  assert.equal((await owner.get(`/api/pos/kiosk-analytics/sessions/${ulid()}`)).status, 404)
})

test('clean-up: playbacks go after 90 days, visits after 400', async () => {
  await sql`UPDATE kiosk_sessions SET started_at = now() - interval '100 days' WHERE tenant_id = ${ids.a} AND id = ${ordered.id}`
  await sql`UPDATE kiosk_sessions SET started_at = now() - interval '401 days' WHERE tenant_id = ${ids.a} AND id = ${timedOut.id}`
  const r = await cleanUpJourneys()
  assert.ok(r.cleared >= 1 && r.removed >= 1)
  const rows = await sql`SELECT id, events, events_cleared_at, summary FROM kiosk_sessions WHERE tenant_id = ${ids.a}`
  assert.deepEqual(rows.map(x => x.id), [ordered.id])
  assert.equal(rows[0].events, null)
  assert.ok(rows[0].events_cleared_at)
  assert.equal(rows[0].summary.outcome, 'ordered', 'the summary stays')
  const d = await ok(owner.get(`/api/pos/kiosk-analytics/sessions/${ordered.id}`))
  assert.equal(d.replay, null)
  assert.deepEqual(d.events, [])
  assert.ok(d.notes.some(n => /older than 90 days/.test(n)))
})

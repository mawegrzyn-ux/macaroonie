// Local info (migration 240): captures per venue (weather through a stand-in
// Open-Meteo, the search kinds through a stand-in Claude with the web search
// tool), the schedule (claimed once across processes, next run worked out,
// errors kept on the source), dedupe (a capture run again updates its rows and
// a hidden item stays hidden), typed-in events (whole group or one venue, with
// the captured/manual edit rules), the venue and tenant guards, and the whole
// path through the staff connector (local_info, add_local_event,
// run_local_capture), including a read-only token.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { startFakeClaude } from './support/fake-claude.mjs'

// Crafted forecast days 0..6: each day proves one severity rule.
const CODES  = [61, 0, 95, 63, 45, 2, 3]
const TMIN   = [3.4, 2, 10, 6, 4, 5, 6]
const TMAX   = [8.6, 9, 22, 12, 10, 11, 12]
const PRECIP = [25, 0, 2, 5, 0, 0, 0]
const WIND   = [20, 10, 30, 20, 10, 61, 10]
const SEVS   = ['warning', 'info', 'warning', 'notice', 'notice', 'warning', 'info']
const TITLES = ['Light rain', 'Clear', 'Thunderstorm', 'Rain', 'Fog', 'Partly cloudy', 'Overcast']

async function startFakeMeteo() {
  const calls = { search: 0, forecast: 0 }
  const urls = []
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    urls.push(req.url)
    res.writeHead(200, { 'content-type': 'application/json' })
    if (u.pathname === '/v1/search') {
      calls.search++
      const name = u.searchParams.get('name') || ''
      return res.end(JSON.stringify(/nowhereville/i.test(name) ? { results: [] }
        : { results: [{ latitude: 51.81, longitude: -0.03, name }] }))
    }
    calls.forecast++
    res.end(JSON.stringify({ daily: {
      time: CODES.map((_, i) => LI.addDays(today, i)),
      weather_code: CODES, temperature_2m_min: TMIN, temperature_2m_max: TMAX,
      precipitation_sum: PRECIP, wind_speed_10m_max: WIND,
    } }))
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = 'http://127.0.0.1:' + server.address().port
  process.env.OPEN_METEO_URL = base
  process.env.OPEN_METEO_GEOCODE_URL = base
  return { calls, urls, close: () => new Promise(r => server.close(r)) }
}

const claude = await startFakeClaude()
const meteo = await startFakeMeteo()
const { as, getApp, sql, ok, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } = await import('../src/middleware/auth.js')
const { claimDue, claimSource, runClaimed } = await import('../src/services/localInfoSvc.js')
const LI = await import('../../shared/localInfo.js')

const today = LI.localDateTime(new Date(), 'Europe/London').date
const day = n => LI.addDays(today, n)

let ids, owner, viewer, operator, other, V, V2, BV
let weatherS = null, eventsS = null

const SRC = v => `/api/local-info/venues/${v}/sources`
const items = (c, q = '') => ok(c.get('/api/local-info/items' + q)).then(r => r.items)

before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  viewer = as(A.viewer, ids.a)
  operator = as(A.operator, ids.a)
  other = as(B.owner, ids.b)
  V  = (await ok(owner.post('/api/venues', { name: 'Zqx Ware', slug: 'zqx-ware-li', timezone: 'Europe/London' }))).id
  V2 = (await ok(owner.post('/api/venues', { name: 'Zqx Hertford', slug: 'zqx-hertford-li', timezone: 'Europe/London' }))).id
  BV = (await ok(other.post('/api/venues', { name: 'Wvb Ware', slug: 'wvb-ware-li', timezone: 'Europe/London' }))).id
})
after(async () => { await closeApp(); await claude.close(); await meteo.close() })

test('captures: add, edit, the site cleaned to a bare host, who may, whose venue', async () => {
  const made = await ok(owner.post(SRC(V), { kind: 'events', place: 'Ware, Hertfordshire', site: 'https://www.hertsad.example/news/' }))
  const s = made.source
  assert.equal(s.site, 'hertsad.example', 'the pasted address is kept as a bare host')
  assert.deepEqual({ kind: s.kind, frequency: s.frequency, every_hours: s.every_hours, enabled: s.enabled },
    { kind: 'events', frequency: 'daily', every_hours: null, enabled: true })
  assert.ok(s.next_run_at, 'a new capture runs soon')
  assert.equal(s.running, false)

  const bad = await owner.post(SRC(V), { kind: 'events', place: 'Ware', site: 'not a site!!' })
  assert.equal(bad.status, 400)
  assert.match(bad.json.error, /bbc\.co\.uk/)

  const hourly = (await ok(owner.post(SRC(V), { kind: 'weather', place: 'Ware', frequency: 'hours', every_hours: 3 }))).source
  assert.equal(hourly.every_hours, 3)

  // Frequency changes carry every_hours with them (hours defaults to 4, anything else clears it).
  let row = (await ok(owner.patch('/api/local-info/sources/' + s.id, { frequency: 'hours' }))).source
  assert.equal(row.every_hours, 4)
  row = (await ok(owner.patch('/api/local-info/sources/' + s.id, { frequency: 'daily' }))).source
  assert.equal(row.every_hours, null)

  // Disabling keeps the schedule; re-enabling runs it again soon.
  row = (await ok(owner.patch('/api/local-info/sources/' + s.id, { enabled: false }))).source
  assert.equal(row.enabled, false)
  row = (await ok(owner.patch('/api/local-info/sources/' + s.id, { enabled: true }))).source
  assert.ok(Math.abs(new Date(row.next_run_at) - Date.now()) < 5000, 're-enabled runs soon')

  const seen = await ok(viewer.get(SRC(V)))
  assert.equal(seen.sources.length, 2)
  assert.equal(seen.venue.name, 'Zqx Ware')
  assert.equal((await viewer.post(SRC(V), { kind: 'events', place: 'Ware' })).status, 403, 'view can look, not change')
  const opMade = await ok(operator.post(SRC(V), { kind: 'traffic', place: 'Ware' }), 'operator adds a capture')

  assert.equal((await other.get(SRC(V))).status, 404, 'another tenant cannot see the venue')
  assert.equal((await other.patch('/api/local-info/sources/' + s.id, { place: 'Elsewhere' })).status, 404)
  assert.equal((await other.delete('/api/local-info/sources/' + s.id)).status, 404)

  // Cleared up, so the sweep tests below see only their own due sources.
  for (const id of [s.id, hourly.id, opMade.source.id]) await ok(owner.delete('/api/local-info/sources/' + id))
  assert.equal((await ok(owner.get(SRC(V)))).sources.length, 0)
})

test('weather capture: claimed once, geocoded once, seven days, dedupe, hidden stays hidden', async () => {
  weatherS = (await ok(owner.post(SRC(V), { kind: 'weather', place: 'Ware, Hertfordshire' }))).source.id

  const due = await claimDue()
  assert.equal(due.length, 1, 'the new capture is due')
  assert.equal(due[0].id, weatherS)
  assert.equal((await claimDue()).length, 0, 'a claimed capture is not handed out twice')

  const run1 = await runClaimed(due[0])
  assert.equal(run1.error, null)
  assert.deepEqual(meteo.calls, { search: 1, forecast: 1 })
  assert.match(meteo.urls.find(u => u.includes('/v1/forecast')), /forecast_days=7/)
  assert.match(decodeURIComponent(meteo.urls.find(u => u.includes('/v1/forecast'))), /timezone=Europe\/London/)

  let weather = (await items(owner, '?venue_id=' + V)).filter(i => i.kind === 'weather')
  assert.equal(weather.length, 7)
  assert.deepEqual(weather.map(i => i.severity), SEVS, 'each day\'s severity follows the rules')
  assert.deepEqual(weather.map(i => i.title), TITLES)
  const d0 = weather[0]
  assert.deepEqual(
    { starts: d0.starts_on, details: d0.details, key: d0.external_key, code: d0.data.weather_code },
    { starts: today, details: 'Light rain, 3 to 9°C, 25 mm', key: 'weather:' + today, code: 61 })
  assert.ok(d0.source_id, 'captured items name their capture')

  // Run again: the place is already geocoded, and the days land on their rows.
  const run2 = await runClaimed(await claimSource(ids.a, weatherS))
  assert.equal(run2.error, null)
  assert.deepEqual(meteo.calls, { search: 1, forecast: 2 }, 'the geocode is cached')
  weather = (await items(owner, '?venue_id=' + V)).filter(i => i.kind === 'weather')
  assert.equal(weather.length, 7, 'a capture run again updates, never repeats')

  // Hiding an item survives the next capture; a new place re-geocodes.
  await ok(owner.patch('/api/local-info/items/' + weather[1].id, { hidden: true }))
  await ok(owner.patch('/api/local-info/sources/' + weatherS, { place: 'Hertford' }))
  const due3 = await claimDue()
  assert.equal(due3.length, 1, 'the changed capture runs again soon')
  await runClaimed(due3[0])
  assert.deepEqual(meteo.calls, { search: 2, forecast: 3 }, 'a changed place is geocoded again')
  weather = (await items(owner, '?venue_id=' + V)).filter(i => i.kind === 'weather')
  assert.equal(weather.length, 6, 'the hidden day stays hidden')
  assert.equal(weather[0].place, 'Hertford', 'the capture freshened its rows')
  const all = (await items(owner, '?venue_id=' + V + '&include_hidden=1')).filter(i => i.kind === 'weather')
  assert.equal(all.length, 7)
  assert.equal(all.filter(i => i.hidden).length, 1)

  const src = (await ok(owner.get(SRC(V)))).sources.find(s => s.id === weatherS)
  assert.ok(src.last_run_at)
  assert.equal(src.last_error, null)
  assert.equal(src.running, false)
  assert.ok(new Date(src.next_run_at) > new Date(), 'the next run is ahead')
})

test('a place the map does not know: the error kept on the capture, the schedule carries on', async () => {
  const s = (await ok(owner.post(SRC(V), { kind: 'weather', place: 'Nowhereville' }))).source
  const run = await runClaimed(await claimSource(ids.a, s.id))
  assert.match(run.error, /Couldn't find "Nowhereville"/)
  const row = (await ok(owner.get(SRC(V)))).sources.find(x => x.id === s.id)
  assert.match(row.last_error, /Couldn't find/)
  assert.ok(new Date(row.next_run_at) > new Date(), 'a failed capture still gets its next run')
  assert.equal(row.running, false)
})

test('search capture: the web search through Claude, only dated findings kept, dedupe', async () => {
  eventsS = (await ok(owner.post(SRC(V), { kind: 'events', place: 'Ware, Hertfordshire', site: 'hertsad.example', query: 'markets' }))).source.id

  // While a run holds the capture, run-now says so.
  const held = await claimSource(ids.a, eventsS)
  assert.ok(held)
  assert.equal((await ok(owner.get(SRC(V)))).sources.find(s => s.id === eventsS).running, true)
  const busy = await owner.post('/api/local-info/sources/' + eventsS + '/run')
  assert.equal(busy.status, 409)
  assert.match(busy.json.error, /already running/)
  await sql`UPDATE local_info_sources SET running_until = NULL WHERE id = ${eventsS}`

  const FOUND = [
    { title: 'Hertford castle fireworks', details: 'Fireworks night', place: 'Hertford Castle', url: 'https://hertsad.example/fireworks', starts_on: day(3), ends_on: '', time_text: '19:00', severity: 'warning' },
    { title: 'A414 roadworks', details: 'Lane closures', place: '', url: 'not-a-url', starts_on: day(1), ends_on: day(5), time_text: '', severity: 'notice' },
    { title: 'Street market', details: '', place: '', url: '', starts_on: day(7), ends_on: '', time_text: '', severity: 'silly' },
    { title: '', details: 'no title', place: '', url: '', starts_on: day(2), ends_on: '', time_text: '', severity: 'info' },
    { title: 'Old thing', details: '', place: '', url: '', starts_on: day(-30), ends_on: '', time_text: '', severity: 'info' },
    { title: 'Bad date', details: '', place: '', url: '', starts_on: 'next Tuesday', ends_on: '', time_text: '', severity: 'info' },
  ]
  const base = claude.requests.length
  claude.script.push(() => ({ stop_reason: 'pause_turn', content: [
    { type: 'server_tool_use', id: 'srvtoolu_01', name: 'web_search', input: { query: 'Ware events' } },
  ] }))
  claude.script.push(() => ({ stop_reason: 'end_turn', content: [
    { type: 'text', text: 'Here is what I found: ' + JSON.stringify({ items: FOUND }) },
  ] }))
  const run = await runClaimed(await claimSource(ids.a, eventsS))
  assert.equal(run.error, null)

  // What reached Claude: the web search tool held to the site, the schema in
  // the system prompt, the place and today's date in the ask.
  const r1 = claude.requests[base].body
  assert.deepEqual(
    { type: r1.tools[0].type, name: r1.tools[0].name, max: r1.tools[0].max_uses, domains: r1.tools[0].allowed_domains },
    { type: 'web_search_20250305', name: 'web_search', max: 5, domains: ['hertsad.example'] })
  assert.match(r1.system[0].text, /JSON schema/)
  assert.match(r1.system[0].text, /"items"/)
  for (const bit of ['Today is ' + today, 'Ware, Hertfordshire', 'Also look for: markets', 'Search only hertsad.example']) {
    assert.ok(r1.messages[0].content.includes(bit), 'the ask says: ' + bit)
  }
  // The paused turn carried on with the content so far.
  const r2 = claude.requests[base + 1].body
  assert.equal(r2.messages.length, 2)
  assert.equal(r2.messages[1].role, 'assistant')
  assert.equal(r2.messages[1].content[0].type, 'server_tool_use')

  let events = await items(owner, '?venue_id=' + V + '&kinds=events')
  assert.equal(events.length, 3, 'no title, a bad date and an old date are left out')
  // The old finding must not be stored at all, not merely out of the default
  // listing range: list a span that would show it.
  const wide = await items(owner, `?venue_id=${V}&kinds=events&from=${day(-40)}&to=${day(90)}`)
  assert.ok(!wide.some(i => i.title === 'Old thing'), 'a finding older than two weeks is never stored')
  const fire = events.find(i => i.title === 'Hertford castle fireworks')
  assert.deepEqual({ sev: fire.severity, url: fire.url, time: fire.time_text }, { sev: 'warning', url: 'https://hertsad.example/fireworks', time: '19:00' })
  const works = events.find(i => i.title === 'A414 roadworks')
  assert.deepEqual({ starts: works.starts_on, ends: works.ends_on, url: works.url }, { starts: day(1), ends: day(5), url: null })
  assert.equal(events.find(i => i.title === 'Street market').severity, 'info', 'a severity the schema does not know reads as info')

  // A multi-day finding sits on every day it covers.
  const midweek = await items(owner, `?venue_id=${V}&kinds=events&from=${day(4)}&to=${day(4)}`)
  assert.deepEqual(midweek.map(i => i.title), ['A414 roadworks'])

  // The same search again: the rows freshen, nothing repeats.
  claude.script.push(() => ({ stop_reason: 'end_turn', content: [
    { type: 'text', text: JSON.stringify({ items: FOUND.map(f => f.title === 'A414 roadworks' ? { ...f, details: 'Lane closures both ways' } : f) }) },
  ] }))
  await runClaimed(await claimSource(ids.a, eventsS))
  events = await items(owner, '?venue_id=' + V + '&kinds=events')
  assert.equal(events.length, 3)
  assert.equal(events.find(i => i.title === 'A414 roadworks').details, 'Lane closures both ways')

  // Scheduled runs count the tenant's allowance.
  const usage = await sql`SELECT channel FROM ai_usage WHERE tenant_id = ${ids.a}`
  assert.ok(usage.some(u => u.channel === 'staff_chat'), 'the search counted the AI allowance')
})

test('typed-in events: whole group or one venue, edited and deleted; captured items only hide', async () => {
  const G = (await ok(owner.post('/api/local-info/items', { title: 'Zqx group push', starts_on: day(10) }))).id
  const Q = (await ok(owner.post('/api/local-info/items', {
    venue_id: V, title: 'Zqx quiz night', starts_on: day(2), ends_on: day(4),
    time_text: 'evening', severity: 'notice', details: 'Weekly quiz', place: 'The bar', url: 'https://example.com/quiz',
  }))).id

  const mine = await items(owner, '?venue_id=' + V)
  assert.ok(mine.some(i => i.id === G), 'a whole-group event shows at the venue')
  const quiz = mine.find(i => i.id === Q)
  assert.equal(quiz.created_by, 'a-owner@test.local')
  assert.equal(quiz.source_id, null)

  const atV2 = await items(owner, '?venue_id=' + V2)
  assert.ok(atV2.some(i => i.id === G) && !atV2.some(i => i.id === Q), 'a venue event stays off the other venue')

  assert.equal((await owner.get('/api/local-info/items?venue_id=' + BV)).status, 404, 'another tenant\'s venue is a 404')
  assert.equal((await items(other)).filter(i => String(i.title).startsWith('Zqx')).length, 0, 'the other tenant sees nothing')

  assert.equal((await viewer.get('/api/local-info/items')).status, 200)
  assert.equal((await viewer.post('/api/local-info/items', { title: 'No', starts_on: day(1) })).status, 403)
  const opItem = await ok(operator.post('/api/local-info/items', { venue_id: V, title: 'Zqx op event', starts_on: day(1) }))
  await ok(operator.delete('/api/local-info/items/' + opItem.id))

  const badDates = await owner.post('/api/local-info/items', { title: 'Backwards', starts_on: day(5), ends_on: day(5) })
  assert.equal(badDates.status, 422)
  assert.equal((await owner.patch('/api/local-info/items/' + Q, { ends_on: day(1) })).status, 422)
  await ok(owner.patch('/api/local-info/items/' + Q, { title: 'Zqx quiz night (moved)', starts_on: day(3), ends_on: null }))
  const moved = (await items(owner, '?venue_id=' + V)).find(i => i.id === Q)
  assert.deepEqual({ title: moved.title, starts: moved.starts_on, ends: moved.ends_on }, { title: 'Zqx quiz night (moved)', starts: day(3), ends: null })

  // Captured items: hide yes, edit and delete no.
  const captured = (await items(owner, '?venue_id=' + V)).find(i => i.source_id)
  const edit = await owner.patch('/api/local-info/items/' + captured.id, { title: 'Nope' })
  assert.equal(edit.status, 422)
  assert.match(edit.json.error, /hide it/)
  assert.equal((await owner.patch('/api/local-info/items/' + captured.id, { hidden: true, title: 'Nope' })).status, 422, 'hidden rides alone')
  const del = await owner.delete('/api/local-info/items/' + captured.id)
  assert.equal(del.status, 422)
  assert.match(del.json.error, /hide it instead/)
  await ok(owner.delete('/api/local-info/items/' + G))

  // The default range is a week back to two months ahead; asking further works, silly ranges do not.
  const far = (await ok(owner.post('/api/local-info/items', { venue_id: V, title: 'Zqx far festival', starts_on: day(80) }))).id
  assert.ok(!(await items(owner, '?venue_id=' + V)).some(i => i.id === far), 'outside the default range')
  assert.ok((await items(owner, `?venue_id=${V}&to=${day(90)}`)).some(i => i.id === far))
  assert.equal((await owner.get(`/api/local-info/items?from=${day(5)}&to=${day(1)}`)).status, 400)
  assert.equal((await owner.get(`/api/local-info/items?from=${today}&to=${day(401)}`)).status, 400)
})

test('the staff connector: local_info, add_local_event and run_local_capture', async () => {
  const mcp = async (token, method, params = {}) => {
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
  const toolResult = r => JSON.parse(r.json.result.content[0].text)

  const { token } = await ok(owner.post('/api/ai/tokens', { name: 'Pepper' }))
  const names = (await mcp(token, 'tools/list')).json.result.tools.map(t => t.name)
  for (const n of ['local_info', 'add_local_event', 'run_local_capture']) assert.ok(names.includes(n), n + ' on the connector')

  const read = await mcp(token, 'tools/call', { name: 'local_info', arguments: { venue: 'Zqx Ware' } })
  assert.notEqual(read.json?.result?.isError, true, read.body.slice(0, 300))
  const out = toolResult(read)
  assert.equal(out.venue, 'Zqx Ware')
  const quiz = out.items.find(i => i.title === 'Zqx quiz night (moved)')
  assert.deepEqual({ kind: quiz.kind, typed: quiz.typed_in, sev: quiz.severity }, { kind: 'Events', typed: true, sev: 'notice' })
  assert.ok(out.items.some(i => i.kind === 'Weather'), 'the captured weather is in the answer')
  assert.ok(!out.items.some(i => i.title === 'Zqx far festival'), 'the tool reads two weeks ahead')
  assert.equal(out.captures.length, 3, 'the venue\'s captures are named')

  const added = await mcp(token, 'tools/call', { name: 'add_local_event', arguments: { venue: 'Zqx Ware', title: 'Zqx Pepper fair', starts_on: day(5) } })
  assert.notEqual(added.json?.result?.isError, true, added.body.slice(0, 300))
  const row = await sql`SELECT venue_id, created_by FROM local_info_items WHERE tenant_id = ${ids.a} AND title = 'Zqx Pepper fair'`
  assert.equal(row.length, 1)
  assert.equal(row[0].venue_id, V)

  // Run the events capture now; the run finishes in the background.
  const before = (await ok(owner.get(SRC(V)))).sources.find(s => s.id === eventsS).last_run_at
  claude.script.push(() => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"items": []}' }] }))
  const ran = await mcp(token, 'tools/call', { name: 'run_local_capture', arguments: { venue: 'Zqx Ware', kind: 'events' } })
  assert.notEqual(ran.json?.result?.isError, true, ran.body.slice(0, 300))
  assert.equal(toolResult(ran).started.length, 1)
  let after = before
  for (let i = 0; i < 50 && after === before; i++) {
    await new Promise(r => setTimeout(r, 100))
    after = (await ok(owner.get(SRC(V)))).sources.find(s => s.id === eventsS).last_run_at
  }
  assert.notEqual(after, before, 'the run-now capture ran')

  const ro = await ok(owner.post('/api/ai/tokens', { name: 'Read', read_only: true }))
  const roNames = (await mcp(ro.token, 'tools/list')).json.result.tools.map(t => t.name)
  assert.ok(roNames.includes('local_info') && !roNames.includes('add_local_event') && !roNames.includes('run_local_capture'),
    'a read-only token reads, never changes or runs')
})

test('deleting a capture takes what it captured with it', async () => {
  const weather = (await items(owner, '?venue_id=' + V + '&kinds=weather&include_hidden=1'))
  assert.equal(weather.length, 7)
  await ok(owner.delete('/api/local-info/sources/' + weatherS))
  assert.equal((await items(owner, '?venue_id=' + V + '&kinds=weather&include_hidden=1')).length, 0)
  const manual = await items(owner, '?venue_id=' + V)
  assert.ok(manual.some(i => i.title === 'Zqx quiz night (moved)'), 'typed-in events stay')
})

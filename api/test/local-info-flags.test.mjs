// Local info flags (migration 248): staff flag what a capture found as
// relevant or not relevant, and Pepper learns from the flags to tune that
// capture's web search. Here: each person's own flag with everyone's counts,
// the same flag again changing nothing, typed-in events refused, the
// capture's flags_at stamped on every real change (taking a flag off too);
// Learn now through a stand-in Claude (the flagged findings sent as data,
// what came back clipped and stored, counted for the person); the next
// search carrying the learned line; a run learning first only when flags
// changed, forgetting when every flag is gone, keeping a failure and
// carrying on; learning switched off; Forget; a new kind starting afresh;
// who may, whose capture; and Pepper's local_info tool showing it all.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { as, getApp, sql, ok, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } = await import('../src/middleware/auth.js')
const { claimSource, runClaimed, learnedLine, hasNewFlags, LEARN_MAX, LEARN_PHRASE } = await import('../src/services/localInfoSvc.js')
const { env } = await import('../src/config/env.js')
const LI = await import('../../shared/localInfo.js')

const today = LI.localDateTime(new Date(), 'Europe/London').date
const day = n => LI.addDays(today, n)

let ids, owner, viewer, other, V, BV, S, W, BS
const items = {}

const SRC = v => `/api/local-info/venues/${v}/sources`
const FLAG = id => `/api/local-info/items/${id}/feedback`
const sourceRow = async (c, venueId, id) => (await ok(c.get(SRC(venueId)))).sources.find(s => s.id === id)
const listed = async (c, q = '') => (await ok(c.get('/api/local-info/items?venue_id=' + V + q))).items
const stamp = async id => (await sql`SELECT flags_at, learned_at FROM local_info_sources WHERE id = ${id}`)[0]

// The stand-in Claude: one search answer, one learning answer.
const searchReply = found => () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ items: found }) }] })
const learnReply = out => () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(out) }] })
const isLearning = body => /You tune a scheduled web search/.test(body.system?.[0]?.text || '')
const askText = body => typeof body.messages[0].content === 'string' ? body.messages[0].content : body.messages[0].content.map(b => b.text || '').join('')

const FOUND = [
  { title: 'Ware farmers market', details: 'Local produce, Saturday mornings', place: 'Ware High Street', url: 'https://hertsad.example/market', starts_on: day(2), ends_on: '', time_text: '09:00', severity: 'notice' },
  { title: 'London marathon', details: 'Road closures in central London', place: 'London', url: '', starts_on: day(4), ends_on: '', time_text: '', severity: 'info' },
  { title: 'Hertford castle fireworks', details: 'Fireworks night', place: 'Hertford Castle', url: '', starts_on: day(6), ends_on: '', time_text: '19:00', severity: 'warning' },
]

before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  viewer = as(A.viewer, ids.a)
  other = as(B.owner, ids.b)
  V  = (await ok(owner.post('/api/venues', { name: 'Zqx Ware', slug: 'zqx-ware-lif', timezone: 'Europe/London' }))).id
  BV = (await ok(other.post('/api/venues', { name: 'Wvb Ware', slug: 'wvb-ware-lif', timezone: 'Europe/London' }))).id

  // An events capture with three findings, a weather capture with one day
  // (written straight in: the weather run itself is tested in local-info),
  // and an event typed in.
  S = (await ok(owner.post(SRC(V), { kind: 'events', place: 'Ware, Hertfordshire', query: 'markets' }))).source.id
  claude.script.push(searchReply(FOUND))
  assert.equal((await runClaimed(await claimSource(ids.a, S))).error, null)
  for (const it of await listed(owner, '&kinds=events')) items[it.title] = it.id
  assert.equal(Object.keys(items).length, 3)

  W = (await ok(owner.post(SRC(V), { kind: 'weather', place: 'Ware', enabled: false }))).source.id
  const [w] = await sql`
    INSERT INTO local_info_items (tenant_id, venue_id, source_id, kind, title, starts_on, severity, external_key)
    VALUES (${ids.a}, ${V}, ${W}, 'weather', 'Light rain', ${day(1)}, 'info', ${'weather:' + day(1)}) RETURNING id`
  items.weather = w.id
  items.typed = (await ok(owner.post('/api/local-info/items', { venue_id: V, title: 'Zqx quiz night', starts_on: day(3) }))).id

  BS = (await ok(other.post(SRC(BV), { kind: 'events', place: 'Ware', enabled: false }))).source.id
})
after(async () => { await closeApp(); await claude.close() })

test('flags: each person their own, everyone\'s counts, the same again changes nothing, taken off', async () => {
  const market = items['Ware farmers market']
  const before0 = await stamp(S)
  assert.equal(before0.flags_at, null, 'no flags yet')

  let r = await ok(owner.put(FLAG(market), { relevant: true }))
  assert.deepEqual(r.feedback, { mine: true, relevant: 1, not_relevant: 0 })
  const first = (await stamp(S)).flags_at
  assert.ok(first, 'a new flag stamps the capture')

  r = await ok(viewer.put(FLAG(market), { relevant: false }))
  assert.deepEqual(r.feedback, { mine: false, relevant: 1, not_relevant: 1 }, 'view can flag')
  const second = (await stamp(S)).flags_at
  assert.ok(second > first)

  // The same flag again: nothing changes, nothing is stamped.
  r = await ok(owner.put(FLAG(market), { relevant: true }))
  assert.deepEqual(r.feedback, { mine: true, relevant: 1, not_relevant: 1 })
  assert.equal(+(await stamp(S)).flags_at, +second, 'the same flag again stamps nothing')

  // Each person sees their own flag in the list, and everyone's counts.
  const mine = (await listed(owner)).find(i => i.id === market)
  assert.deepEqual(mine.feedback, { mine: true, relevant: 1, not_relevant: 1 })
  const theirs = (await listed(viewer)).find(i => i.id === market)
  assert.deepEqual(theirs.feedback, { mine: false, relevant: 1, not_relevant: 1 })
  const unflagged = (await listed(owner)).find(i => i.id === items['London marathon'])
  assert.deepEqual(unflagged.feedback, { mine: null, relevant: 0, not_relevant: 0 })
  assert.equal((await listed(owner)).find(i => i.id === items.typed).feedback, null, 'a typed-in event carries no flags')

  // Changing a flag and taking it off both stamp the capture.
  r = await ok(viewer.put(FLAG(market), { relevant: true }))
  assert.deepEqual(r.feedback, { mine: true, relevant: 2, not_relevant: 0 })
  const third = (await stamp(S)).flags_at
  assert.ok(third > second, 'a changed flag stamps the capture')
  r = await ok(viewer.put(FLAG(market), { relevant: null }))
  assert.deepEqual(r.feedback, { mine: null, relevant: 1, not_relevant: 0 })
  const fourth = (await stamp(S)).flags_at
  assert.ok(fourth > third, 'a flag taken off stamps the capture')
  await ok(viewer.put(FLAG(market), { relevant: null }))
  assert.equal(+(await stamp(S)).flags_at, +fourth, 'taking off a flag that isn\'t there stamps nothing')

  // A forecast takes flags too: its own capture is stamped, not the search's.
  await ok(owner.put(FLAG(items.weather), { relevant: false }))
  assert.ok((await stamp(W)).flags_at)
  assert.equal(+(await stamp(S)).flags_at, +fourth)

  // Refusals.
  const typed = await owner.put(FLAG(items.typed), { relevant: true })
  assert.equal(typed.status, 422)
  assert.match(typed.json.error, /typed-in event/)
  assert.equal((await owner.put(FLAG(items.weather), { relevant: 'yes' })).status, 400)
  assert.equal((await owner.put(FLAG(items.weather), {})).status, 400)
  assert.equal((await owner.put(FLAG('not-an-id'), { relevant: true })).status, 404)
  assert.equal((await other.put(FLAG(market), { relevant: false })).status, 404, 'another tenant\'s item is a 404')
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM local_info_feedback WHERE tenant_id = ${ids.b}`
  assert.equal(n, 0, 'nothing was written for the other tenant')

  // The capture's counts are of its own findings only.
  const s = await sourceRow(owner, V, S)
  assert.deepEqual(s.flags, { relevant: 1, not_relevant: 0 })
  assert.equal(s.flags_changed, true)
  assert.equal(s.learned, null)
  assert.deepEqual((await sourceRow(owner, V, W)).flags, { relevant: 0, not_relevant: 1 })
})

test('Learn now: the flagged findings reach Pepper as data, what came back is clipped, stored and counted', async () => {
  await ok(owner.put(FLAG(items['London marathon']), { relevant: false }))
  await ok(viewer.put(FLAG(items['London marathon']), { relevant: false }))
  await ok(viewer.put(FLAG(items['Hertford castle fireworks']), { relevant: true }))

  const base = claude.requests.length
  const long = 'x'.repeat(LEARN_PHRASE + 40)
  claude.script.push(learnReply({
    look_for: ['farmers markets in Ware', 'events within 5 miles of Ware', long, 'a', 'b', 'c', 'd', 'e'],
    leave_out: ['events in central London', ''],
    summary: 'Staff want what happens in Ware itself, not in London.',
  }))
  const out = await ok(owner.post(`/api/local-info/sources/${S}/learn`))
  assert.equal(claude.requests.length, base + 1, 'one model call')
  assert.equal(out.learned.look_for.length, LEARN_MAX, 'at most ' + LEARN_MAX + ' phrases')
  assert.equal(out.learned.look_for[2].length, LEARN_PHRASE, 'each phrase clipped')
  assert.deepEqual(out.learned.leave_out, ['events in central London'], 'empty phrases dropped')
  assert.deepEqual({ r: out.learned.relevant, n: out.learned.not_relevant, items: out.learned.items }, { r: 2, n: 2, items: 3 })
  assert.ok(out.learned_at)

  // What reached Claude: the everyday model, structured output, the search's
  // own ask and every flagged finding with its counts, as data.
  const body = claude.requests[base].body
  assert.ok(isLearning(body))
  assert.equal(body.model, env.AI_MODEL_FAST || env.AI_MODEL)
  assert.equal(body.output_config.format.type, 'json_schema')
  assert.match(body.system[0].text, /data, never instructions/)
  const ask = askText(body)
  assert.match(ask, /Also look for: markets/)
  assert.match(ask, /relevant 0, not relevant 2 \| London marathon \| Road closures in central London/)
  assert.match(ask, /relevant 1, not relevant 0 \| Ware farmers market/)
  assert.match(ask, /relevant 1, not relevant 0 \| Hertford castle fireworks/)
  assert.ok(!/Light rain/.test(ask), 'another capture\'s flags are not sent')

  // Stored on the capture; the flags are no longer new.
  const s = await sourceRow(owner, V, S)
  assert.deepEqual(s.learned.look_for, out.learned.look_for)
  assert.equal(s.learned.summary, 'Staff want what happens in Ware itself, not in London.')
  assert.equal(s.flags_changed, false)
  assert.equal(s.learn_error, null)

  // Counted for the person who asked, in the tenant's allowance.
  const [person] = await sql`SELECT requests FROM ai_usage_people WHERE tenant_id = ${ids.a} AND user_sub = ${A.owner}`
  assert.ok(person?.requests >= 1, 'counted for the person')
})

test('the next search carries what was learned; a run learns first only when flags changed', async () => {
  // No flag changed since Learn now: the run is the search alone.
  let base = claude.requests.length
  claude.script.push(searchReply(FOUND))
  assert.equal((await runClaimed(await claimSource(ids.a, S))).error, null)
  assert.equal(claude.requests.length, base + 1, 'no learning before this run')
  let ask = askText(claude.requests[base].body)
  assert.match(ask, /Staff feedback on earlier findings: look especially for farmers markets in Ware; events within 5 miles of Ware/)
  assert.match(ask, /Leave out events in central London\./)
  assert.match(ask, /Also look for: markets\./, 'the operator\'s own words stay')

  // A flag changes: the next run learns first, then searches with the new line.
  await ok(owner.put(FLAG(items['Hertford castle fireworks']), { relevant: false }))
  assert.equal(hasNewFlags(await stampRow(S)), true)
  base = claude.requests.length
  claude.script.push(learnReply({ look_for: ['markets and fairs in Ware'], leave_out: ['fireworks', 'London'], summary: 'Fewer fireworks.' }))
  claude.script.push(searchReply(FOUND))
  assert.equal((await runClaimed(await claimSource(ids.a, S))).error, null)
  assert.equal(claude.requests.length, base + 2)
  assert.ok(isLearning(claude.requests[base].body), 'learning first')
  ask = askText(claude.requests[base + 1].body)
  assert.match(ask, /look especially for markets and fairs in Ware\. Leave out fireworks; London\./)
  let s = await sourceRow(owner, V, S)
  assert.deepEqual(s.learned.leave_out, ['fireworks', 'London'])
  assert.equal(s.flags_changed, false)

  // A scheduled run's learning counts no one's daily share.
  const [nobody] = await sql`SELECT count(*)::int AS n FROM ai_usage_people WHERE tenant_id = ${ids.a} AND user_sub <> ${A.owner}`
  assert.equal(nobody.n, 0)

  // Taking a flag off is a change too.
  await ok(viewer.put(FLAG(items['Hertford castle fireworks']), { relevant: null }))
  base = claude.requests.length
  claude.script.push(learnReply({ look_for: ['markets in Ware'], leave_out: [], summary: 'Markets.' }))
  claude.script.push(searchReply(FOUND))
  assert.equal((await runClaimed(await claimSource(ids.a, S))).error, null)
  assert.equal(claude.requests.length, base + 2, 'a flag taken off makes the run learn again')
  assert.match(askText(claude.requests[base + 1].body), /look especially for markets in Ware\.(?! Leave out)/)

  // Every flag taken off: the run forgets what it learned, with no model call.
  for (const c of [owner, viewer]) {
    for (const t of ['Ware farmers market', 'London marathon', 'Hertford castle fireworks']) await ok(c.put(FLAG(items[t]), { relevant: null }))
  }
  base = claude.requests.length
  claude.script.push(searchReply(FOUND))
  assert.equal((await runClaimed(await claimSource(ids.a, S))).error, null)
  assert.equal(claude.requests.length, base + 1, 'nothing to learn from: no learning call')
  assert.ok(!/Staff feedback/.test(askText(claude.requests[base].body)))
  s = await sourceRow(owner, V, S)
  assert.equal(s.learned, null)
  assert.ok(s.learned_at)
  assert.equal(s.flags_changed, false)
  assert.equal(s.learn_error, null)
})

test('a learning that fails is kept on the capture and the run carries on', async () => {
  await ok(owner.put(FLAG(items['Ware farmers market']), { relevant: true }))
  let base = claude.requests.length
  claude.script.push(() => ({ stop_reason: 'refusal', content: [] }))
  claude.script.push(searchReply(FOUND))
  const run = await runClaimed(await claimSource(ids.a, S))
  assert.equal(run.error, null, 'the search still ran')
  assert.equal(claude.requests.length, base + 2)
  let s = await sourceRow(owner, V, S)
  assert.equal(s.learn_error, 'Pepper couldn\'t learn from these flags.')
  assert.equal(s.flags_changed, true, 'the flags are still to learn from')
  assert.equal(s.last_error, null)

  // The next run tries again; success clears the error.
  base = claude.requests.length
  claude.script.push(learnReply({ look_for: ['farmers markets'], leave_out: [], summary: 'Markets.' }))
  claude.script.push(searchReply(FOUND))
  await runClaimed(await claimSource(ids.a, S))
  assert.equal(claude.requests.length, base + 2)
  s = await sourceRow(owner, V, S)
  assert.equal(s.learn_error, null)
  assert.deepEqual(s.learned.look_for, ['farmers markets'])
})

test('learning switched off: no learning, no line, what was learned kept for later', async () => {
  let s = (await ok(owner.patch('/api/local-info/sources/' + S, { learn_auto: false }))).source
  assert.equal(s.learn_auto, false)
  assert.equal(learnedLine(s), '', 'the search leaves the learned line out')
  const refused = await owner.post(`/api/local-info/sources/${S}/learn`)
  assert.equal(refused.status, 422)
  assert.match(refused.json.error, /switch it on/)

  await ok(viewer.put(FLAG(items['London marathon']), { relevant: false }))
  let base = claude.requests.length
  claude.script.push(searchReply(FOUND))
  await runClaimed(await claimSource(ids.a, S))
  assert.equal(claude.requests.length, base + 1, 'no learning while it is off')
  assert.ok(!/Staff feedback/.test(askText(claude.requests[base].body)))
  s = await sourceRow(owner, V, S)
  assert.deepEqual(s.learned.look_for, ['farmers markets'], 'kept for when it goes back on')

  // Back on: the flags changed meanwhile, so the next run learns first.
  await ok(owner.patch('/api/local-info/sources/' + S, { learn_auto: true }))
  base = claude.requests.length
  claude.script.push(learnReply({ look_for: ['farmers markets'], leave_out: ['marathons'], summary: 'No marathons.' }))
  claude.script.push(searchReply(FOUND))
  await runClaimed(await claimSource(ids.a, S))
  assert.equal(claude.requests.length, base + 2)
  assert.match(askText(claude.requests[base + 1].body), /Leave out marathons\./)
})

test('Forget, a new kind, weather, who may and whose capture', async () => {
  // Forget: the search uses the operator's words only until flags change.
  assert.equal((await viewer.delete(`/api/local-info/sources/${S}/learned`)).status, 403, 'view can\'t forget')
  assert.equal((await other.delete(`/api/local-info/sources/${S}/learned`)).status, 404)
  const forgot = (await ok(owner.delete(`/api/local-info/sources/${S}/learned`))).source
  assert.equal(forgot.learned, null)
  assert.equal(forgot.flags_changed, false, 'flags before Forget are not new')
  let base = claude.requests.length
  claude.script.push(searchReply(FOUND))
  await runClaimed(await claimSource(ids.a, S))
  assert.equal(claude.requests.length, base + 1)
  assert.ok(!/Staff feedback/.test(askText(claude.requests[base].body)))

  // Who may learn, and whose capture.
  assert.equal((await viewer.post(`/api/local-info/sources/${S}/learn`)).status, 403)
  assert.equal((await other.post(`/api/local-info/sources/${S}/learn`)).status, 404)
  assert.equal((await owner.post(`/api/local-info/sources/${BS}/learn`)).status, 404)
  const weather = await owner.post(`/api/local-info/sources/${W}/learn`)
  assert.equal(weather.status, 422)
  assert.match(weather.json.error, /weather forecast/)

  // A run holds the capture: Learn now waits for it.
  assert.ok(await claimSource(ids.a, S))
  const busy = await owner.post(`/api/local-info/sources/${S}/learn`)
  assert.equal(busy.status, 409)
  await sql`UPDATE local_info_sources SET running_until = NULL WHERE id = ${S}`

  // Pepper switched off for the group.
  await ok(owner.patch('/api/ai/settings', { staff_enabled: false }))
  try {
    const off = await owner.post(`/api/local-info/sources/${S}/learn`)
    assert.equal(off.status, 403)
  } finally {
    await ok(owner.patch('/api/ai/settings', { staff_enabled: true }))
  }

  // Learned something, then the capture becomes another kind: it starts afresh.
  claude.script.push(learnReply({ look_for: ['farmers markets'], leave_out: [], summary: 'Markets.' }))
  await ok(owner.post(`/api/local-info/sources/${S}/learn`))
  await ok(owner.put(FLAG(items['Ware farmers market']), { relevant: false }))
  const moved = (await ok(owner.patch('/api/local-info/sources/' + S, { kind: 'traffic' }))).source
  assert.deepEqual({ learned: moved.learned, at: moved.learned_at, error: moved.learn_error, changed: moved.flags_changed },
    { learned: null, at: null, error: null, changed: false })
  const traffic = await sourceRow(owner, V, S)
  assert.deepEqual(traffic.flags, { relevant: 0, not_relevant: 0 }, 'the events flags aren\'t this kind\'s')
  const none = await owner.post(`/api/local-info/sources/${S}/learn`)
  assert.equal(none.status, 422)
  assert.match(none.json.error, /Nobody has flagged anything/)
  // A flag on an events finding no longer stamps the (now traffic) capture.
  await ok(viewer.put(FLAG(items['Ware farmers market']), { relevant: true }))
  assert.equal((await stamp(S)).flags_at, null)
  await ok(owner.patch('/api/local-info/sources/' + S, { kind: 'events' }))
})

test('Pepper\'s local_info tool shows the flags and what a capture learned', async () => {
  claude.script.push(learnReply({ look_for: ['farmers markets in Ware'], leave_out: ['London'], summary: 'Ware only.' }))
  await ok(viewer.put(FLAG(items['London marathon']), { relevant: false }))
  await ok(owner.post(`/api/local-info/sources/${S}/learn`))

  const { token } = await ok(owner.post('/api/ai/tokens', { name: 'Pepper' }))
  const app = await getApp()
  const res = await app.inject({
    method: 'POST', url: '/mcp/staff/thai-house',
    headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream',
      authorization: 'Bearer ' + token, [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET,
    },
    payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'local_info', arguments: { venue: 'Zqx Ware' } } }),
  })
  const out = JSON.parse(res.json().result.content[0].text)
  const marathon = out.items.find(i => i.title === 'London marathon')
  assert.deepEqual(marathon.staff_flags, { relevant: 0, not_relevant: 1 })
  assert.ok(!('staff_flags' in out.items.find(i => i.title === 'Zqx quiz night')), 'typed-in events carry none')
  const capture = out.captures.find(c => c.startsWith('Events'))
  assert.match(capture, /learned from flags: look for farmers markets in Ware, leave out London/)
})

test('reports count each item\'s flags as the Local info page does, and say what each capture learned', async () => {
  const { runner } = await import('./support/reports.mjs')
  const run = runner(ids.a)
  const here = { field: 'venue', op: 'in', value: [V] }
  const byId = res => Object.fromEntries(res.rows.filter(r => r.kind === 'row')
    .map(r => [r.id, Object.fromEntries(res.columns.map((c, i) => [c.key, r.cells[i]]))]))

  const rows = byId(await run({ subject: 'local.items', kind: 'list', rows: ['title', 'flagged_relevant', 'flagged_not_relevant'], filters: [here] }))
  const page = (await listed(owner)).filter(i => i.venue_id === V)
  assert.deepEqual(Object.keys(rows).sort(), page.map(i => i.id).sort(), 'the same items')
  for (const it of page) {
    const r = rows[it.id]
    assert.deepEqual([Number(r.flagged_relevant), Number(r.flagged_not_relevant)],
      [it.feedback?.relevant ?? 0, it.feedback?.not_relevant ?? 0], it.title)
  }
  const flagged = page.filter(i => i.feedback?.relevant || i.feedback?.not_relevant)
  assert.ok(flagged.length >= 2, 'flags to count')
  assert.deepEqual([Number(rows[items.typed].flagged_relevant), Number(rows[items.typed].flagged_not_relevant)], [0, 0])

  // Added up through a capture's findings: its own items only.
  const sums = await run({ subject: 'local.captures', kind: 'summary', rows: ['kind'], filters: [here],
    values: [{ key: 'r', agg: 'sum', field: 'items.flagged_relevant' }, { key: 'n', agg: 'sum', field: 'items.flagged_not_relevant' }] })
  const events = sums.rows.find(r => r.kind === 'row' && r.cells[0] === 'events')
  const own = page.filter(i => i.source_id === S)
  assert.deepEqual([Number(events.cells[1]), Number(events.cells[2])],
    [own.reduce((n, i) => n + (i.feedback?.relevant ?? 0), 0), own.reduce((n, i) => n + (i.feedback?.not_relevant ?? 0), 0)])

  // Each capture: whether it learns, what it learned, and any problem.
  const caps = byId(await run({ subject: 'local.captures', kind: 'list', rows: ['kind', 'learns', 'learned', 'learned_at', 'learn_problem'], filters: [here] }))
  for (const id of [S, W]) {
    const s = await sourceRow(owner, V, id)
    assert.equal(caps[id].learns, s.learn_auto && s.kind !== 'weather', s.kind)
    assert.equal(caps[id].learned, s.learned?.summary ?? null, s.kind)
    assert.equal(caps[id].learn_problem, s.learn_error ?? null, s.kind)
  }
  assert.equal(caps[S].learned, 'Ware only.')
  assert.ok(caps[S].learned_at)
  assert.equal(caps[W].learns, false, 'a weather capture never learns')
})

async function stampRow(id) {
  const [row] = await sql`SELECT * FROM local_info_sources WHERE id = ${id}`
  return row
}

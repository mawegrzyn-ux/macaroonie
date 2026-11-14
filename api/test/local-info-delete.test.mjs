// Local info bulk delete (14 Nov 2026): POST /api/local-info/items/delete
// takes what the calendar shows from a day on (today at the earliest), until
// an optional day, by venue (its own entries) or the whole group's, capture,
// typed or captured, kinds, severities and words, and says first what it
// would do (dry_run). A finding someone hid is kept (it stops its capture
// adding it again); one people flagged is hidden instead, so its capture
// keeps learning from the flags (not a forecast's, which nothing learns
// from, and not one of another kind than its capture now has). Here: the
// counts for each criterion, nothing written by a dry run, refusals, a real
// run and what the capture's next run does with what was deleted and hidden,
// and Pepper's delete_local_info on the staff connector and as a chat card.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { as, getApp, sql, ok, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } = await import('../src/middleware/auth.js')
const { claimSource, runClaimed } = await import('../src/services/localInfoSvc.js')
const LI = await import('../../shared/localInfo.js')

const today = LI.localDateTime(new Date(), 'Europe/London').date
const day = n => LI.addDays(today, n)

let ids, owner, operator, viewer, other, V, V2, BV, S, W, BS
const items = {}

const SRC = v => `/api/local-info/venues/${v}/sources`
const DEL = '/api/local-info/items/delete'
const dry = (c, body) => ok(c.post(DEL, { ...body, dry_run: true }))
const counts = r => ({ deleted: r.deleted, hidden: r.hidden, kept: r.kept })
const searchReply = found => () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ items: found }) }] })
const allItems = async tenant => (await sql`SELECT id, hidden FROM local_info_items WHERE tenant_id = ${tenant}`)
const hiddenOf = async id => (await sql`SELECT hidden FROM local_info_items WHERE id = ${id}`)[0]?.hidden

const FOUND = [
  { title: 'Ware old fair', details: 'Last week', place: 'Ware', url: '', starts_on: day(-2), ends_on: '', time_text: '', severity: 'info' },
  { title: 'Ware car boot', details: 'Every Sunday', place: 'Priory field', url: '', starts_on: day(0), ends_on: '', time_text: '08:00', severity: 'info' },
  { title: 'Ware farmers market', details: 'Local produce', place: 'Ware High Street', url: '', starts_on: day(2), ends_on: '', time_text: '09:00', severity: 'notice' },
  { title: 'London marathon', details: 'Road closures in central London', place: 'London', url: '', starts_on: day(3), ends_on: '', time_text: '', severity: 'info' },
  { title: 'Hertford castle fireworks', details: 'Fireworks night', place: 'Hertford Castle', url: '', starts_on: day(5), ends_on: '', time_text: '19:00', severity: 'warning' },
  { title: 'Ware winter festival', details: 'In the town centre', place: 'Ware', url: '', starts_on: day(40), ends_on: '', time_text: '', severity: 'notice' },
]

before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  other = as(B.owner, ids.b)
  V  = (await ok(owner.post('/api/venues', { name: 'Zqx Ware', slug: 'zqx-ware-lid', timezone: 'Europe/London' }))).id
  V2 = (await ok(owner.post('/api/venues', { name: 'Zqx Hertford', slug: 'zqx-hertford-lid', timezone: 'Europe/London' }))).id
  BV = (await ok(other.post('/api/venues', { name: 'Wvb Ware', slug: 'wvb-ware-lid', timezone: 'Europe/London' }))).id

  // An events capture run once through a stand-in Claude; one of its
  // findings flagged, one hidden, and one of another kind (as after the
  // capture's kind changed) flagged too.
  S = (await ok(owner.post(SRC(V), { kind: 'events', place: 'Ware, Hertfordshire', query: 'markets', learn_auto: false }))).source.id
  claude.script.push(searchReply(FOUND))
  // The market and the marathon are a day apart: the merge step after the
  // run asks whether they are the same event (migration 249). They aren't.
  claude.script.push(() => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"groups": []}' }] }))
  assert.equal((await runClaimed(await claimSource(ids.a, S))).error, null)
  assert.equal(claude.script.length, 0, 'the search and the merge step each asked once')
  for (const it of (await ok(owner.get(`/api/local-info/items?venue_id=${V}&from=${day(-7)}&to=${day(60)}&kinds=events`))).items) items[it.title] = it.id
  assert.equal(Object.keys(items).length, FOUND.length, 'every finding stored')
  await ok(viewer.put(`/api/local-info/items/${items['Ware farmers market']}/feedback`, { relevant: true }))
  await ok(owner.patch(`/api/local-info/items/${items['London marathon']}`, { hidden: true }))
  const [odd] = await sql`
    INSERT INTO local_info_items (tenant_id, venue_id, source_id, kind, title, starts_on, severity, external_key)
    VALUES (${ids.a}, ${V}, ${S}, 'traffic', 'Zqx A10 roadworks', ${day(1)}, 'warning', 'zqx-odd') RETURNING id`
  items.odd = odd.id
  await sql`INSERT INTO local_info_feedback (tenant_id, item_id, user_sub, relevant) VALUES (${ids.a}, ${odd.id}, ${A.owner}, false)`

  // A weather capture with two days, one of them flagged.
  W = (await ok(owner.post(SRC(V), { kind: 'weather', place: 'Ware', enabled: false }))).source.id
  for (const n of [1, 2]) {
    const [w] = await sql`
      INSERT INTO local_info_items (tenant_id, venue_id, source_id, kind, title, starts_on, severity, external_key)
      VALUES (${ids.a}, ${V}, ${W}, 'weather', ${'Rain ' + n}, ${day(n)}, 'info', ${'weather:' + day(n)}) RETURNING id`
    items['weather' + n] = w.id
  }
  await ok(owner.put(`/api/local-info/items/${items.weather1}/feedback`, { relevant: false }))

  // Events typed in: the venue's own, the whole group's, another venue's,
  // one in the past, and one with a % in it.
  const typed = async (venue_id, title, starts_on, extra = {}) =>
    (await ok(owner.post('/api/local-info/items', { venue_id, title, starts_on, ...extra }))).id
  items.quiz = await typed(V, 'Zqx quiz night', day(1))
  items.fair = await typed(null, 'Zqx group fair', day(2), { severity: 'warning' })
  items.fete = await typed(V2, 'Zqx Hertford fete', day(2))
  items.past = await typed(V, 'Zqx past quiz', day(-1))
  items.offer = await typed(V, 'Zqx 50% off night', day(4))

  // The other group's own.
  BS = (await ok(other.post(SRC(BV), { kind: 'events', place: 'Ware', enabled: false }))).source.id
  items.theirs = (await ok(other.post('/api/local-info/items', { venue_id: BV, title: 'Wvb quiz night', starts_on: day(1) }))).id
})
after(async () => { await closeApp(); await claude.close() })

test('a dry run counts what each set of criteria takes, and changes nothing', async () => {
  const before = JSON.stringify(await allItems(ids.a))

  // What the events capture found from today on: the car boot sale, the
  // fireworks, the winter festival and the roadworks (flagged, but not of the
  // capture's kind) go; the market people flagged is hidden instead; the
  // marathon someone hid stays as it is; last week's fair isn't counted.
  let r = await dry(owner, { source_id: S })
  assert.deepEqual(counts(r), { deleted: 4, hidden: 1, kept: 1 })
  assert.equal(r.dry_run, true)
  assert.equal(r.from, today, 'from leaves out to today')
  assert.equal(r.until, null)
  assert.deepEqual(r.examples.map(e => [e.title, e.action]), [
    ['Ware car boot', 'delete'], ['Zqx A10 roadworks', 'delete'], ['Ware farmers market', 'hide'],
    ['Hertford castle fireworks', 'delete'], ['Ware winter festival', 'delete'],
  ], 'in day order, without the one kept')
  assert.ok(r.examples.every(e => e.captured && e.venue_id === V))

  // Until a day: the winter festival is past it.
  assert.deepEqual(counts(await dry(owner, { source_id: S, until: day(5) })), { deleted: 3, hidden: 1, kept: 1 })
  assert.deepEqual(counts(await dry(owner, { source_id: S, from: day(3), until: day(5) })), { deleted: 1, hidden: 0, kept: 1 })

  // A venue's own entries: its two captures and what was typed in for it,
  // never the whole group's or another venue's. A flagged forecast is deleted.
  r = await dry(owner, { venue_id: V })
  assert.deepEqual(counts(r), { deleted: 4 + 2 + 2, hidden: 1, kept: 1 })
  assert.ok(r.examples.some(e => e.title === 'Rain 1' && e.action === 'delete'), 'a flagged forecast goes')
  assert.ok(!r.examples.some(e => e.title === 'Zqx group fair' || e.title === 'Zqx Hertford fete'))
  assert.deepEqual(counts(await dry(owner, { group_wide: true })), { deleted: 1, hidden: 0, kept: 0 })
  assert.deepEqual(counts(await dry(owner, { venue_id: V2 })), { deleted: 1, hidden: 0, kept: 0 })
  assert.deepEqual(counts(await dry(owner, {})), { deleted: 10, hidden: 1, kept: 1 }, 'everything from today on, never the other group\'s')

  // Typed in or captured, kinds, severities, words.
  assert.deepEqual(counts(await dry(owner, { origin: 'typed' })), { deleted: 4, hidden: 0, kept: 0 })
  assert.deepEqual(counts(await dry(owner, { origin: 'captured' })), { deleted: 6, hidden: 1, kept: 1 })
  assert.deepEqual(counts(await dry(owner, { kinds: ['weather'] })), { deleted: 2, hidden: 0, kept: 0 })
  assert.deepEqual(counts(await dry(owner, { kinds: ['events', 'traffic'], severities: ['warning'] })), { deleted: 3, hidden: 0, kept: 0 },
    'the fireworks, the roadworks and the group fair')
  r = await dry(owner, { words: 'priory' })
  assert.deepEqual(r.examples.map(e => e.title), ['Ware car boot'], 'words in the place count too, any case')
  assert.deepEqual((await dry(owner, { words: 'TOWN centre' })).examples.map(e => e.title), ['Ware winter festival'], 'and in the details')
  assert.deepEqual((await dry(owner, { words: '%' })).examples.map(e => e.title), ['Zqx 50% off night'], 'a % is a %, not "anything"')
  assert.deepEqual(counts(await dry(owner, { words: 'nothing like this' })), { deleted: 0, hidden: 0, kept: 0 })

  assert.equal(JSON.stringify(await allItems(ids.a)), before, 'a dry run writes nothing')
})

test('refusals: the past, days the wrong way round, a venue and the group, other groups, View', async () => {
  let r = await owner.post(DEL, { from: day(-1) })
  assert.equal(r.status, 422)
  assert.match(r.json.error, /from today on/)
  assert.match(r.json.error, new RegExp(today))
  r = await owner.post(DEL, { from: day(3), until: day(2) })
  assert.equal(r.status, 422)
  assert.match(r.json.error, /last day must be on or after the first/)
  r = await owner.post(DEL, { venue_id: V, group_wide: true })
  assert.equal(r.status, 422)
  assert.match(r.json.error, /not both/)
  assert.equal((await owner.post(DEL, { venue_id: BV })).status, 404, 'another group\'s venue')
  r = await owner.post(DEL, { source_id: BS })
  assert.equal(r.status, 404)
  assert.match(r.json.error, /Capture not found/)
  assert.equal((await owner.post(DEL, { kinds: ['parties'] })).status, 400)
  assert.equal((await owner.post(DEL, { from: 'tomorrow' })).status, 400)
  assert.equal((await owner.post(DEL, { words: 'x'.repeat(101) })).status, 400)
  assert.equal((await viewer.post(DEL, { dry_run: true })).status, 403, 'View can\'t')

  // The other group deleting everything it has touches nothing of ours.
  const ours = (await allItems(ids.a)).length
  const theirs = await ok(other.post(DEL, {}))
  assert.equal(theirs.deleted, 1)
  assert.equal((await allItems(ids.a)).length, ours)
  assert.equal((await sql`SELECT count(*)::int AS n FROM local_info_items WHERE id = ${items.theirs}`)[0].n, 0)
})

test('deleting for real: gone, hidden instead with its flags, kept, and what the capture\'s next run brings back', async () => {
  const r = await ok(operator.post(DEL, { source_id: S, until: day(5) }))
  assert.deepEqual(counts(r), { deleted: 3, hidden: 1, kept: 1 })
  assert.equal(r.dry_run, false)
  const left = new Set((await sql`SELECT id FROM local_info_items WHERE tenant_id = ${ids.a}`).map(x => x.id))
  for (const t of ['Ware car boot', 'Hertford castle fireworks']) assert.ok(!left.has(items[t]), t + ' deleted')
  assert.ok(!left.has(items.odd), 'a finding of another kind than its capture goes, flags and all')
  assert.equal((await sql`SELECT count(*)::int AS n FROM local_info_feedback WHERE item_id = ${items.odd}`)[0].n, 0)
  assert.equal(await hiddenOf(items['Ware farmers market']), true, 'the flagged finding is hidden')
  assert.equal((await sql`SELECT count(*)::int AS n FROM local_info_feedback WHERE item_id = ${items['Ware farmers market']}`)[0].n, 1, 'with its flag')
  assert.equal(await hiddenOf(items['London marathon']), true, 'the hidden one stays hidden')
  assert.equal(await hiddenOf(items['Ware old fair']), false, 'past days are never touched')
  assert.equal(await hiddenOf(items['Ware winter festival']), false, 'after the last day: kept')
  assert.equal(await hiddenOf(items.quiz), false, 'another capture\'s or typed-in: kept')

  // The capture's next run: what was deleted can come back, what was hidden doesn't.
  claude.script.push(searchReply(FOUND))
  assert.equal((await runClaimed(await claimSource(ids.a, S))).error, null)
  const now = await sql`SELECT title, hidden FROM local_info_items WHERE source_id = ${S} AND starts_on >= ${today} ORDER BY starts_on`
  assert.deepEqual(now.map(x => [x.title, x.hidden]), [
    ['Ware car boot', false], ['Ware farmers market', true], ['London marathon', true],
    ['Hertford castle fireworks', false], ['Ware winter festival', false],
  ])
  for (const it of now.filter(x => !x.hidden)) {
    items[it.title] = (await sql`SELECT id FROM local_info_items WHERE source_id = ${S} AND title = ${it.title}`)[0].id
  }
})

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
async function call(token, args) {
  const r = await mcp(token, 'tools/call', { name: 'delete_local_info', arguments: args })
  assert.ok(r.json?.result, r.body.slice(0, 300))
  const text = r.json.result.content[0].text
  return r.json.result.isError ? { error: text } : { out: JSON.parse(text) }
}

test('Pepper on the staff connector: delete_local_info by venue, capture, words; refusals; read-only tokens never see it', async () => {
  const { token } = await ok(owner.post('/api/ai/tokens', { name: 'Pepper' }))
  assert.ok((await mcp(token, 'tools/list')).json.result.tools.some(t => t.name === 'delete_local_info'))
  const ro = await ok(owner.post('/api/ai/tokens', { name: 'Read', read_only: true }))
  assert.ok(!(await mcp(ro.token, 'tools/list')).json.result.tools.some(t => t.name === 'delete_local_info'), 'read-only tokens never get it')

  // One venue's own entries, by its name.
  let r = await call(token, { venue: 'Zqx Hertford' })
  assert.deepEqual([r.out.deleted, r.out.days], [1, today + ' on'], JSON.stringify(r))
  assert.equal(await hiddenOf(items.fete), undefined, 'the fete is gone')
  assert.equal(await hiddenOf(items.fair), false, 'the whole group\'s fair stays')

  // What one capture found, by its words on the Captures list, until a day.
  r = await call(token, { capture: 'weather', venue: 'Zqx Ware', until: day(1) })
  assert.equal(r.out.deleted, 1, JSON.stringify(r))
  assert.equal(await hiddenOf(items.weather1), undefined, 'the flagged forecast went')
  assert.equal(await hiddenOf(items.weather2), false, 'the day after stays')

  // Nothing left to match says so; the past and two matching captures are refused.
  r = await call(token, { words: 'no such thing at all' })
  assert.deepEqual([r.out.deleted, r.out.message], [0, 'Nothing on the calendar matched, so nothing changed.'])
  r = await call(token, { from: day(-1), words: 'quiz' })
  assert.match(r.error, /from today on/)
  assert.equal(await hiddenOf(items.past), false)
  const S2 = (await ok(owner.post(SRC(V), { kind: 'traffic', place: 'Ware bypass', enabled: false }))).source.id
  r = await call(token, { capture: 'Ware' })
  assert.match(r.error, /More than one capture matches "Ware"/)
  r = await call(token, { capture: 'nothing of the sort' })
  assert.match(r.error, /No capture called/)
  r = await call(token, { venue: 'Zqx Ware', group_wide: true })
  assert.match(r.error, /not both/)
  await ok(owner.delete('/api/local-info/sources/' + S2))

  const [audit] = await sql`SELECT tool, input, ok FROM ai_actions WHERE tenant_id = ${ids.a} AND tool = 'delete_local_info' ORDER BY created_at LIMIT 1`
  assert.equal(audit.ok, true)
  assert.equal(audit.input.venue, 'Zqx Hertford')
})

test('Pepper in the chat: a card from the dry run, pinned to its day and capture, and Confirm deletes exactly that', async () => {
  const text = s => [{ type: 'text', text: s }]

  // Nothing matches: no card, the model hears why.
  claude.script.push(
    () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_d0', name: 'delete_local_info', input: { words: 'zzz none' } }] }),
    () => ({ stop_reason: 'end_turn', content: text('Nothing to delete.') }),
  )
  let r = await ok(owner.post('/api/ai/chat', { message: 'Delete the zzz none entries' }))
  assert.equal((await sql`SELECT count(*)::int AS n FROM ai_pending_actions WHERE conversation_id = ${r.conversation_id}`)[0].n, 0)
  const answered = claude.requests[claude.requests.length - 1].body.messages
  const result = answered[answered.length - 1].content.find(b => b.type === 'tool_result')
  assert.equal(result.is_error, true)
  assert.match(JSON.stringify(result.content), /Nothing on the calendar matches that/)

  // What the events capture found, as a card: the car boot sale found again
  // and now flagged is hidden instead, the market and the marathon (hidden)
  // stay, the fireworks and the winter festival go.
  await ok(viewer.put(`/api/local-info/items/${items['Ware car boot']}/feedback`, { relevant: false }))
  claude.script.push(
    () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_d1', name: 'delete_local_info', input: { capture: 'markets', venue: 'Zqx Ware' } }] }),
    () => ({ stop_reason: 'end_turn', content: text('Press Delete them on the card.') }),
  )
  r = await ok(owner.post('/api/ai/chat', { message: 'Clear what the markets capture found from today' }))
  const [card] = await sql`SELECT id, input, card FROM ai_pending_actions WHERE conversation_id = ${r.conversation_id} AND tool = 'delete_local_info'`
  assert.ok(card, 'a card, nothing deleted yet')
  assert.equal(card.card.title, 'Delete 3 local info entries?', card.card.lines.join('\n'))
  assert.equal(card.card.confirmLabel, 'Delete them')
  const lines = card.card.lines.join('\n')
  assert.match(lines, /What the capture Events: Ware, Hertfordshire \(markets\) found, starting \d{4}-\d{2}-\d{2} or later\./)
  assert.match(lines, /2 entries will be deleted\./)
  assert.match(lines, /1 finding people flagged will be hidden instead/)
  assert.match(lines, /2 findings someone hid stay as they are\./)
  assert.match(lines, /Ware car boot \(Zqx Ware, hidden instead\); \S+ Hertford castle fireworks \(Zqx Ware\); \S+ Ware winter festival \(Zqx Ware\)\./)
  assert.match(lines, /A later run of a capture can find some of them again\./)
  assert.deepEqual([card.input.from, card.input.source_id, card.input.venue], [today, S, V], 'the day, the capture and the venue are pinned')
  assert.equal(await hiddenOf(items['Ware car boot']), false, 'nothing deleted before Confirm')

  await ok(owner.post(`/api/ai/actions/${card.id}/confirm`, {}))
  const [action] = await sql`SELECT status, result FROM ai_pending_actions WHERE id = ${card.id}`
  assert.equal(action.status, 'done', JSON.stringify(action))
  assert.deepEqual([action.result.deleted, action.result.hidden_instead, action.result.kept_hidden], [2, 1, 2])
  assert.equal(await hiddenOf(items['Ware car boot']), true, 'the flagged one is hidden')
  assert.equal(await hiddenOf(items['Hertford castle fireworks']), undefined)
  assert.equal(await hiddenOf(items['Ware winter festival']), undefined)
  assert.equal(await hiddenOf(items['Ware farmers market']), true)
  assert.equal(await hiddenOf(items.quiz), false, 'typed-in entries aren\'t the capture\'s')
})

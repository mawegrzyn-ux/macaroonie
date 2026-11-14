// Local info duplicates (migration 249): after each search capture's run,
// Pepper is asked which of a venue's findings of that kind are the same real
// event, and those go into one entry. Here, through a stand-in Claude: the
// ask (the everyday model, refs and words only, the venue's own findings of
// that kind, new ones marked, nothing a day or more apart from anything new
// asked about); one entry kept by severity with the others under it; flags
// moving to the entry (each person's newest) and the captures stamped so
// they learn again; learning reading the entries; an answer grouping days a
// week apart making two entries; a hidden entry staying hidden with what
// joins it; Not the same (an entry of its own, never asked about again);
// copies refused on their own; Pepper's local_info tool and the reports
// showing it; bulk delete handing a deleted entry's other reports on; and a
// failed ask kept on the capture and tried again after the next run.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { as, getApp, sql, ok, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } = await import('../src/middleware/auth.js')
const { claimSource, runClaimed, learnFromFlags } = await import('../src/services/localInfoSvc.js')
const { env } = await import('../src/config/env.js')
const LI = await import('../../shared/localInfo.js')

const today = LI.localDateTime(new Date(), 'Europe/London').date
const day = n => LI.addDays(today, n)

let ids, owner, operator, viewer, other, V, V2, BV, S1, S2, T, S3

const SRC = v => `/api/local-info/venues/${v}/sources`
const ITEM = id => `/api/local-info/items/${id}`
const FLAG = id => `/api/local-info/items/${id}/feedback`
const SEP = id => `/api/local-info/items/${id}/separate`
const DELETE = '/api/local-info/items/delete'
const sourceRow = async id => (await ok(owner.get(SRC(V)))).sources.find(s => s.id === id)
const listed = async (c = owner, q = '') => (await ok(c.get('/api/local-info/items?venue_id=' + V + '&kinds=events' + q))).items
const entry = (items, title) => items.find(i => i.title === title)
const alsoOf = (items, title) => (entry(items, title)?.also || []).map(a => a.title)
const stamp = async id => (await sql`SELECT flags_at FROM local_info_sources WHERE id = ${id}`)[0].flags_at
const flagsOn = async id => Object.fromEntries((await sql`
  SELECT user_sub, relevant FROM local_info_feedback WHERE item_id = ${id}`).map(r => [r.user_sub, r.relevant]))
// Every events row at the venue, by title (the titles here are all different).
const db = async () => Object.fromEntries((await sql`
  SELECT id, title, source_id, merged_into, keep_separate, hidden, merge_checked_at
    FROM local_info_items WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND kind = 'events'`).map(r => [r.title, r]))

const found = (title, n, extra = {}) => ({ title, details: '', place: '', url: '', starts_on: day(n), ends_on: '', time_text: '', severity: 'info', ...extra })
const searchReply = items => () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ items }) }] })
const learnReply = out => () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(out) }] })
const askText = body => typeof body.messages[0].content === 'string' ? body.messages[0].content : body.messages[0].content.map(b => b.text || '').join('')
const isMerge = r => JSON.stringify(r.body.system || '').includes('You tidy a restaurant')
const linesOf = body => askText(body).split('\n').slice(1)
const fieldsByTitle = body => Object.fromEntries(linesOf(body).map(l => { const f = l.split(' | '); return [f[1], f] }))
// Pepper's answer, by title: each title becomes the ref its line had (an
// unknown one goes as it is). Never throws (see Common mistakes).
const mergeReply = (...groups) => body => {
  const refs = Object.fromEntries(Object.entries(fieldsByTitle(body)).map(([t, f]) => [t, f[0]]))
  return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({
    groups: groups.map(g => ({ same: g.map(t => refs[t] || t), why: 'the same event' })) }) }] }
}

// A capture's run with the stand-in's replies: the search, then what follows.
async function runWith(id, items, ...replies) {
  const base = claude.requests.length
  claude.script.push(searchReply(items), ...replies)
  const out = await runClaimed(await claimSource(ids.a, id))
  const left = claude.script.length
  claude.script.length = 0
  assert.equal(out.error, null, 'the run went fine')
  assert.equal(left, 0, 'every reply was asked for')
  return claude.requests.slice(base)
}

before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  other = as(B.owner, ids.b)
  V  = (await ok(owner.post('/api/venues', { name: 'Zqx Ware', slug: 'zqx-ware-lim', timezone: 'Europe/London' }))).id
  V2 = (await ok(owner.post('/api/venues', { name: 'Zqx Hertford', slug: 'zqx-hertford-lim', timezone: 'Europe/London' }))).id
  BV = (await ok(other.post('/api/venues', { name: 'Wvb Ware', slug: 'wvb-ware-lim', timezone: 'Europe/London' }))).id

  // Two events captures at the venue (learning off, so a run makes no
  // learning call), and findings that must never be asked about: another
  // kind, another venue, another group's, and an event typed in.
  S1 = (await ok(owner.post(SRC(V), { kind: 'events', place: 'Ware, Hertfordshire', query: 'events', learn_auto: false }))).source.id
  S2 = (await ok(owner.post(SRC(V), { kind: 'events', place: 'Hertford', query: 'whats on', learn_auto: false }))).source.id
  T  = (await ok(owner.post(SRC(V), { kind: 'traffic', place: 'Ware', enabled: false }))).source.id
  S3 = (await ok(owner.post(SRC(V2), { kind: 'events', place: 'Hertford', enabled: false }))).source.id
  const BS = (await ok(other.post(SRC(BV), { kind: 'events', place: 'Ware', enabled: false }))).source.id
  await sql`
    INSERT INTO local_info_items (tenant_id, venue_id, source_id, kind, title, starts_on, severity, external_key)
    VALUES (${ids.a}, ${V}, ${T}, 'traffic', 'Ware lights road closure', ${day(3)}, 'info', 'traffic:lights'),
           (${ids.a}, ${V2}, ${S3}, 'events', 'Hertford lights parade', ${day(3)}, 'info', 'events:parade'),
           (${ids.b}, ${BV}, ${BS}, 'events', 'Wvb lights evening', ${day(3)}, 'info', 'events:wvb')`
  await ok(owner.post('/api/local-info/items', { venue_id: V, kind: 'events', title: 'Zqx lights quiz', starts_on: day(3) }))
})
after(async () => { await closeApp(); await claude.close() })

test('a run puts the same event found by two captures into one entry, and its flags move with it', async () => {
  // The first capture: three findings days apart, nothing to ask about.
  let asks = await runWith(S1, [
    found('Christmas lights switch on', 3, { details: 'Lights on at 5pm', url: 'https://www.wareonline.example/lights', severity: 'notice' }),
    found('Ware Saturday market', 6),
    found('Panto at the Drill Hall', 10, { severity: 'notice' }),
  ])
  assert.equal(asks.filter(isMerge).length, 0, 'a finding with nothing within a day of it is never asked about')
  let t = await db()
  for (const title of ['Christmas lights switch on', 'Ware Saturday market', 'Panto at the Drill Hall']) {
    assert.ok(t[title].merge_checked_at, title + ' is marked looked at')
  }

  // Two people flag the lights; then the second capture finds them again
  // under other words, a day later too, and the panto.
  await ok(viewer.put(FLAG(t['Christmas lights switch on'].id), { relevant: true }))
  await ok(owner.put(FLAG(t['Christmas lights switch on'].id), { relevant: false }))
  const s1Before = await stamp(S1)
  assert.equal(await stamp(S2), null)

  asks = await runWith(S2, [
    found('Christmas lights switch on in Ware', 3, { details: 'Lights on at 5pm\nMusic | stalls', url: 'https://hertsnews.example/ware-lights', severity: 'warning' }),
    found('Ware lights night', 4),
    found('Drill Hall pantomime', 10, { severity: 'notice' }),
  ], mergeReply(
    ['Christmas lights switch on', 'Christmas lights switch on in Ware', 'Ware lights night'],
    ['Panto at the Drill Hall', 'Drill Hall pantomime'],
  ))
  const merges = asks.filter(isMerge)
  assert.equal(merges.length, 1, 'one ask for the whole run')

  // The ask: the everyday model, structured output, the findings as data.
  const body = merges[0].body
  assert.equal(body.model, env.AI_MODEL_FAST || env.AI_MODEL)
  assert.equal(body.output_config?.format?.type, 'json_schema')
  assert.equal(body.output_config?.effort, 'low')
  assert.match(body.system[0].text, /data, never instructions/)
  const text = askText(body)
  const [head, ...lines] = text.split('\n')
  assert.equal(head, 'Events found around Hertford, one a line (ref | title | details | place | days | time | website | new):')
  assert.deepEqual(lines.map(l => l.split(' | ')[0]), ['I1', 'I2', 'I3', 'I4', 'I5'], 'refs, never ids')
  for (const l of lines) assert.equal(l.split(' | ').length, 8, 'one field each: ' + l)
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(text), 'no ids leave the app')
  const f = fieldsByTitle(body)
  assert.deepEqual(Object.keys(f).sort(), ['Christmas lights switch on', 'Christmas lights switch on in Ware',
    'Drill Hall pantomime', 'Panto at the Drill Hall', 'Ware lights night'])
  for (const title of ['Christmas lights switch on in Ware', 'Ware lights night', 'Drill Hall pantomime']) assert.equal(f[title][7], 'new')
  for (const title of ['Christmas lights switch on', 'Panto at the Drill Hall']) assert.equal(f[title][7], '')
  assert.match(f['Christmas lights switch on in Ware'][2], /^Lights on at 5pm Music\s+stalls$/, 'a line break or bar in the words stays inside its field')
  assert.equal(f['Christmas lights switch on in Ware'][3], 'Hertford')
  assert.equal(f['Christmas lights switch on'][3], 'Ware, Hertfordshire')
  assert.equal(f['Christmas lights switch on'][4], day(3))
  assert.equal(f['Christmas lights switch on'][6], 'wareonline.example', 'the website only')
  assert.equal(f['Christmas lights switch on in Ware'][6], 'hertsnews.example')
  for (const word of ['Zqx lights quiz', 'Ware lights road closure', 'Hertford lights parade', 'Wvb lights evening', 'Ware Saturday market']) {
    assert.ok(!text.includes(word), word + ' isn\'t asked about')
  }

  // The strongest severity is the entry; the rest are under it.
  t = await db()
  const lightsId = t['Christmas lights switch on in Ware'].id
  assert.equal(t['Christmas lights switch on in Ware'].merged_into, null)
  assert.equal(t['Christmas lights switch on'].merged_into, lightsId)
  assert.equal(t['Ware lights night'].merged_into, lightsId)
  assert.equal(t['Drill Hall pantomime'].merged_into, t['Panto at the Drill Hall'].id, 'the same severity: the first found stays')
  assert.equal(t['Ware Saturday market'].merged_into, null)
  for (const title of ['Christmas lights switch on in Ware', 'Ware lights night', 'Drill Hall pantomime']) {
    assert.ok(t[title].merge_checked_at, title + ' is marked looked at')
  }

  // The page lists entries only, each with its other reports, oldest first.
  const items = await listed()
  const titles = items.map(i => i.title)
  for (const copy of ['Christmas lights switch on', 'Ware lights night', 'Drill Hall pantomime']) assert.ok(!titles.includes(copy), copy + ' isn\'t listed on its own')
  assert.deepEqual(alsoOf(items, 'Christmas lights switch on in Ware'), ['Christmas lights switch on', 'Ware lights night'])
  const first = entry(items, 'Christmas lights switch on in Ware').also[0]
  assert.deepEqual({ source: first.source_id, url: first.url, day: first.starts_on }, { source: S1, url: 'https://www.wareonline.example/lights', day: day(3) })
  assert.deepEqual(alsoOf(items, 'Panto at the Drill Hall'), ['Drill Hall pantomime'])
  assert.deepEqual(alsoOf(items, 'Ware Saturday market'), [])
  assert.deepEqual(alsoOf(items, 'Zqx lights quiz'), [], 'a typed-in event is never merged')

  // The flags went to the entry, and both captures learn again.
  assert.deepEqual(await flagsOn(lightsId), { [A.viewer]: true, [A.owner]: false })
  assert.deepEqual(await flagsOn(t['Christmas lights switch on'].id), {})
  assert.deepEqual(entry(items, 'Christmas lights switch on in Ware').feedback, { mine: false, relevant: 1, not_relevant: 1 })
  assert.ok(await stamp(S1) > s1Before, 'the first capture learns again')
  assert.ok(await stamp(S2), 'the second capture learns from the entry\'s flags too')
  const [r1, r2] = [await sourceRow(S1), await sourceRow(S2)]
  assert.deepEqual([r1.merged, r2.merged], [1, 2], 'how many of each capture\'s findings are in another entry')
  assert.deepEqual(r1.flags, { relevant: 1, not_relevant: 1 }, 'a finding in another entry counts with its flags')
  assert.deepEqual(r2.flags, { relevant: 1, not_relevant: 1 })

  // Learning reads the entry the finding is in.
  claude.script.push(learnReply({ look_for: ['lights'], leave_out: [], summary: 'Lights.' }))
  const [row] = await sql`SELECT * FROM local_info_sources WHERE id = ${S1}`
  await learnFromFlags(row)
  const learnAsk = askText(claude.requests.at(-1).body)
  assert.ok(learnAsk.includes('- relevant 1, not relevant 1 | Christmas lights switch on in Ware'), learnAsk)
  assert.equal(learnAsk.split('\n').filter(l => l.startsWith('- relevant')).length, 1)
})

test('one answer grouping days a week apart makes two entries, each around its own days', async () => {
  const asks = await runWith(S2, [
    found('Ware quiz league', 20, { severity: 'warning' }),
    found('Quiz league in Ware', 21),
    found('Ware quiz league night', 27),
    found('Quiz league Ware', 28, { severity: 'notice' }),
  ], mergeReply(
    ['Ware quiz league', 'Quiz league in Ware', 'Ware quiz league night', 'Quiz league Ware', 'I99'],
    ['Ware quiz league'],
    ['Quiz league in Ware', 'Quiz league in Ware'],
  ))
  const merge = asks.filter(isMerge)
  assert.equal(merge.length, 1)
  assert.equal(linesOf(merge[0].body).length, 4, 'the new findings and nothing a day or more away from them')
  const t = await db()
  assert.equal(t['Quiz league in Ware'].merged_into, t['Ware quiz league'].id)
  assert.equal(t['Ware quiz league night'].merged_into, t['Quiz league Ware'].id)
  assert.equal(t['Ware quiz league'].merged_into, null)
  assert.equal(t['Quiz league Ware'].merged_into, null)
  const items = await listed()
  assert.deepEqual(alsoOf(items, 'Ware quiz league'), ['Quiz league in Ware'])
  assert.deepEqual(alsoOf(items, 'Quiz league Ware'), ['Ware quiz league night'])
})

test('a hidden entry stays the entry, and what joins it stays hidden with it', async () => {
  let t = await db()
  await ok(owner.patch(ITEM(t['Ware Saturday market'].id), { hidden: true }))
  const asks = await runWith(S2, [found('Saturday market in Ware', 6, { severity: 'warning' })],
    mergeReply(['Ware Saturday market', 'Saturday market in Ware']))
  assert.deepEqual(Object.keys(fieldsByTitle(asks.find(isMerge).body)).sort(), ['Saturday market in Ware', 'Ware Saturday market'],
    'a hidden finding is still asked about')
  t = await db()
  assert.equal(t['Saturday market in Ware'].merged_into, t['Ware Saturday market'].id, 'hidden beats a stronger severity')
  const shown = (await listed()).map(i => i.title)
  assert.ok(!shown.includes('Ware Saturday market') && !shown.includes('Saturday market in Ware'), 'neither comes back on the calendar')
  const all = await listed(owner, '&include_hidden=1')
  assert.equal(entry(all, 'Ware Saturday market').hidden, true)
  assert.deepEqual(alsoOf(all, 'Ware Saturday market'), ['Saturday market in Ware'])
})

test('two people\'s flags on two reports of one event: each person\'s newest flag stays on the entry', async () => {
  let asks = await runWith(S1, [found('Ware fun run', 15, { severity: 'notice' })])
  assert.equal(asks.filter(isMerge).length, 0)
  asks = await runWith(S2, [found('Fun run in Ware', 15)], mergeReply())
  assert.equal(asks.filter(isMerge).length, 1)
  let t = await db()
  const run1 = t['Ware fun run'].id, run2 = t['Fun run in Ware'].id
  assert.equal(t['Fun run in Ware'].merged_into, null, 'Pepper said they aren\'t the same')
  assert.ok(t['Fun run in Ware'].merge_checked_at)

  await ok(owner.put(FLAG(run2), { relevant: false }))   // the owner's older flag
  await ok(owner.put(FLAG(run1), { relevant: true }))    // ... and newer, on the entry
  await ok(viewer.put(FLAG(run1), { relevant: true }))   // the viewer's older flag
  await ok(viewer.put(FLAG(run2), { relevant: false }))  // ... and newer, on the other report
  const [s1b, s2b] = [await stamp(S1), await stamp(S2)]

  asks = await runWith(S2, [found('Ware charity fun run', 15)],
    mergeReply(['Ware fun run', 'Fun run in Ware', 'Ware charity fun run']))
  assert.equal(linesOf(asks.find(isMerge).body).length, 3)
  t = await db()
  assert.equal(t['Fun run in Ware'].merged_into, run1)
  assert.equal(t['Ware charity fun run'].merged_into, run1)
  assert.deepEqual(await flagsOn(run1), { [A.owner]: true, [A.viewer]: false })
  assert.deepEqual(await flagsOn(run2), {})
  assert.ok(await stamp(S1) > s1b && await stamp(S2) > s2b, 'the entry\'s flags changed: every capture in it learns again')
  // Each capture counts the flags of the entries its findings are in.
  assert.deepEqual((await sourceRow(S1)).flags, { relevant: 2, not_relevant: 2 })
  assert.deepEqual((await sourceRow(S2)).flags, { relevant: 2, not_relevant: 2 })
})

test('Not the same: a report becomes an entry of its own and is never asked about again', async () => {
  let t = await db()
  const s2Before = await stamp(S2)
  assert.deepEqual(await ok(operator.post(SEP(t['Drill Hall pantomime'].id))), { ok: true }, 'Manage on Local info is enough')
  t = await db()
  assert.equal(t['Drill Hall pantomime'].merged_into, null)
  assert.equal(t['Drill Hall pantomime'].keep_separate, true)
  assert.ok(t['Drill Hall pantomime'].merge_checked_at)
  assert.equal(+(await stamp(S2)), +s2Before, 'no flags on the entry it left: nothing to learn again')

  const s1Before = await stamp(S1)
  await ok(owner.post(SEP(t['Christmas lights switch on'].id)))
  assert.ok(await stamp(S1) > s1Before, 'it left an entry with flags: its capture learns again')
  t = await db()
  assert.deepEqual(await flagsOn(t['Christmas lights switch on in Ware'].id), { [A.viewer]: true, [A.owner]: false }, 'the flags stay on the entry')
  assert.deepEqual(await flagsOn(t['Christmas lights switch on'].id), {})

  let items = await listed()
  assert.deepEqual(alsoOf(items, 'Panto at the Drill Hall'), [])
  assert.deepEqual(alsoOf(items, 'Drill Hall pantomime'), [])
  assert.deepEqual(alsoOf(items, 'Christmas lights switch on in Ware'), ['Ware lights night'])
  assert.ok(entry(items, 'Christmas lights switch on'))

  // A new report of the panto is asked about beside the entry, not the one kept apart.
  const asks = await runWith(S2, [found('Drill Hall panto matinee', 11)], mergeReply())
  const asked = Object.keys(fieldsByTitle(asks.find(isMerge).body)).sort()
  assert.deepEqual(asked, ['Drill Hall panto matinee', 'Panto at the Drill Hall'])

  // Refusals.
  const notCopy = await owner.post(SEP(t['Christmas lights switch on in Ware'].id))
  assert.equal(notCopy.status, 422)
  assert.match(notCopy.json.error, /isn't part of another/)
  assert.equal((await owner.post(SEP(t['Drill Hall pantomime'].id))).status, 422, 'already its own')
  assert.equal((await viewer.post(SEP(t['Ware lights night'].id))).status, 403)
  assert.equal((await other.post(SEP(t['Ware lights night'].id))).status, 404, 'another group\'s finding')
  assert.equal((await owner.post(SEP('not-an-id'))).status, 404)
  assert.equal((await owner.post(SEP('00000000-0000-0000-0000-000000000000'))).status, 404)
  items = await listed()
  assert.deepEqual(alsoOf(items, 'Christmas lights switch on in Ware'), ['Ware lights night'], 'nothing changed')
})

test('Pepper\'s local_info tool shows an entry\'s other reports and a capture that couldn\'t merge', async () => {
  await sql`UPDATE local_info_sources SET merge_error = 'Pepper couldn''t compare these findings.' WHERE id = ${S2}`
  try {
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
    const lights = out.items.find(i => i.title === 'Christmas lights switch on in Ware')
    assert.deepEqual(lights.also_reported_as, [{ title: 'Ware lights night', day: day(4) }])
    assert.ok(!out.items.some(i => i.title === 'Ware lights night'), 'a report in an entry isn\'t an item of its own')
    assert.ok(!('also_reported_as' in out.items.find(i => i.title === 'Zqx lights quiz')))
    const failing = out.captures.filter(c => /couldn't put the same events together after its last run: Pepper couldn't compare these findings\./.test(c))
    assert.equal(failing.length, 1, out.captures.join(' / '))
  } finally {
    await sql`UPDATE local_info_sources SET merge_error = NULL WHERE id = ${S2}`
  }
})

test('reports count an entry\'s other reports, say which are kept apart, and a capture\'s merge problem', async () => {
  const { runner } = await import('./support/reports.mjs')
  const run = runner(ids.a)
  const here = { field: 'venue', op: 'in', value: [V] }
  const byId = res => Object.fromEntries(res.rows.filter(r => r.kind === 'row')
    .map(r => [r.id, Object.fromEntries(res.columns.map((c, i) => [c.key, r.cells[i]]))]))

  const rows = byId(await run({ subject: 'local.items', kind: 'list', rows: ['title', 'other_reports', 'kept_apart'], filters: [here] }))
  const page = (await ok(owner.get('/api/local-info/items?venue_id=' + V))).items.filter(i => i.venue_id === V)
  assert.deepEqual(Object.keys(rows).sort(), page.map(i => i.id).sort(), 'the entries the page lists, never a report inside one')
  const t = await db()
  for (const it of page) {
    assert.equal(Number(rows[it.id].other_reports), it.also.length, it.title)
    const kept = Object.values(t).find(r => r.id === it.id)?.keep_separate ?? false
    assert.equal(rows[it.id].kept_apart, kept, it.title)
  }
  assert.equal(Number(rows[t['Christmas lights switch on in Ware'].id].other_reports), 1)
  assert.equal(rows[t['Drill Hall pantomime'].id].kept_apart, true)
  assert.equal(rows[t['Christmas lights switch on'].id].kept_apart, true)

  await sql`UPDATE local_info_sources SET merge_error = 'Pepper couldn''t compare these findings.' WHERE id = ${S2}`
  try {
    const caps = byId(await run({ subject: 'local.captures', kind: 'list', rows: ['kind', 'merge_problem'], filters: [here] }))
    assert.equal(caps[S2].merge_problem, 'Pepper couldn\'t compare these findings.')
    assert.equal(caps[S1].merge_problem, null)
  } finally {
    await sql`UPDATE local_info_sources SET merge_error = NULL WHERE id = ${S2}`
  }
})

test('a report inside an entry is changed through the entry, and bulk delete hands an entry on', async () => {
  let t = await db()
  const copy = t['Ware lights night'].id
  let r = await owner.patch(ITEM(copy), { hidden: true })
  assert.equal(r.status, 422)
  assert.match(r.json.error, /part of another entry/)
  r = await owner.put(FLAG(copy), { relevant: true })
  assert.equal(r.status, 422)
  assert.match(r.json.error, /part of another entry/)
  r = await owner.delete(ITEM(copy))
  assert.equal(r.status, 422)
  assert.match(r.json.error, /hide it instead/)

  // A venue's entries deleted by their words take the reports in them along.
  r = await ok(owner.post(DELETE, { venue_id: V, words: 'quiz league', dry_run: true }))
  assert.deepEqual([r.deleted, r.hidden, r.kept, r.handed_over], [2, 0, 0, 0], 'entries are counted, not the reports in them')
  await ok(owner.post(DELETE, { venue_id: V, words: 'quiz league' }))
  t = await db()
  for (const title of ['Ware quiz league', 'Quiz league in Ware', 'Ware quiz league night', 'Quiz league Ware']) assert.ok(!t[title], title + ' is gone')

  // One capture's entry with another capture's reports in it.
  let asks = await runWith(S2, [found('Ware beer festival', 30, { severity: 'warning' })])
  assert.equal(asks.filter(isMerge).length, 0)
  asks = await runWith(S1, [found('Beer festival, Ware', 30), found('Ware ale festival', 31)],
    mergeReply(['Ware beer festival', 'Beer festival, Ware', 'Ware ale festival']))
  t = await db()
  assert.equal(t['Beer festival, Ware'].merged_into, t['Ware beer festival'].id)
  assert.equal(t['Ware ale festival'].merged_into, t['Ware beer festival'].id)

  // Delete future entries of the second capture: its flagged entry is hidden,
  // the rest go, and the beer festival's other reports become an entry.
  const shape = rows => Object.fromEntries(Object.values(rows).map(x => [x.title, [x.merged_into, x.hidden]]))
  const before = shape(t)
  r = await ok(owner.post(DELETE, { source_id: S2, dry_run: true }))
  assert.deepEqual([r.deleted, r.hidden, r.kept, r.handed_over], [3, 1, 0, 1])
  assert.deepEqual(shape(await db()), before, 'a dry run changes nothing')
  // Pepper's card from the same dry run says so too.
  claude.script.push(
    () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_m8', name: 'delete_local_info', input: { source_id: S2 } }] }),
    () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Press Delete them on the card.' }] }),
  )
  const chat = await ok(owner.post('/api/ai/chat', { message: 'Clear what the Hertford events capture found' }))
  const [card] = await sql`SELECT card FROM ai_pending_actions WHERE conversation_id = ${chat.conversation_id} AND tool = 'delete_local_info'`
  assert.ok(card, 'a card')
  assert.match(card.card.lines.join('\n'), /1 entry was also found by another capture: that report stays on the calendar instead\./)
  assert.deepEqual(shape(await db()), before, 'a card changes nothing')
  r = await ok(owner.post(DELETE, { source_id: S2 }))
  assert.equal(r.handed_over, 1)
  t = await db()
  for (const title of ['Drill Hall pantomime', 'Drill Hall panto matinee', 'Ware beer festival']) assert.ok(!t[title], title + ' is gone')
  assert.equal(t['Christmas lights switch on in Ware'].hidden, true, 'flagged: hidden, so its flags keep teaching')
  assert.equal(t['Ware lights night'].merged_into, t['Christmas lights switch on in Ware'].id, 'its own report stays inside it')
  assert.equal(t['Beer festival, Ware'].merged_into, null, 'the first other report found is the entry now')
  assert.equal(t['Ware ale festival'].merged_into, t['Beer festival, Ware'].id)
  for (const title of ['Fun run in Ware', 'Ware charity fun run', 'Saturday market in Ware']) {
    assert.ok(t[title]?.merged_into, title + ': the capture\'s reports inside other captures\' entries are left alone')
  }
  const items = await listed()
  assert.deepEqual(alsoOf(items, 'Beer festival, Ware'), ['Ware ale festival'])
})

test('a failed ask is kept on the capture, the run carries on, and the next run asks again', async () => {
  let asks = await runWith(S1, [found('Christmas market Ware', 40, { severity: 'notice' })])
  assert.equal(asks.filter(isMerge).length, 0)
  asks = await runWith(S2, [found('Ware Christmas market', 40)], () => ({ stop_reason: 'refusal', content: [] }))
  assert.equal(asks.filter(isMerge).length, 1)
  let s2 = await sourceRow(S2)
  assert.equal(s2.merge_error, 'Pepper couldn\'t compare these findings.')
  assert.equal(s2.last_error, null, 'the capture itself ran fine')
  let t = await db()
  assert.equal(t['Ware Christmas market'].merge_checked_at, null, 'looked at again after the next run')
  assert.equal(t['Ware Christmas market'].merged_into, null)

  asks = await runWith(S2, [found('Ware Christmas market', 40)], mergeReply(['Christmas market Ware', 'Ware Christmas market']))
  assert.equal(asks.filter(isMerge).length, 1)
  s2 = await sourceRow(S2)
  assert.equal(s2.merge_error, null, 'a pass that works clears the problem')
  t = await db()
  assert.equal(t['Ware Christmas market'].merged_into, t['Christmas market Ware'].id)
  assert.equal((await sourceRow(S1)).merge_error, null)
})

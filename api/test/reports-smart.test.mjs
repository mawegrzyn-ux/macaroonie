// The smart builder (POST /api/ai/reports/build, docs/REPORTS.md 10) against
// a stand-in Claude and real till sales (support/tillDays.mjs):
// what Pepper is shown (refs, never table or column names; only what the
// person's role sees), the answer made into a definition through the
// builder's edits and run as the person, venue names and names in the data
// found in the group's own rows (several matches become questions with the
// report for each choice), an answer that can't be used sent back once with
// the reasons, a subject listed in a line shown in full on the second ask,
// changes to a report built before, files, the usage counted, and refusals.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { as, ok, sql, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { fillTenant } = await import('./support/fixtures.mjs')
const { sellTwoDays } = await import('./support/tillDays.mjs')
const { env } = await import('../src/config/env.js')
const { forgetReportResults } = await import('../src/reports/run.js')

let ids, filled, owner, admin, operator, viewer, ownerB

const BUILD = '/api/ai/reports/build'
const lastBody = () => claude.requests[claude.requests.length - 1].body
const userText = body => body.messages[0].content.filter(b => b.type === 'text').map(b => b.text).join('\n')

/** A full answer: everything the schema asks for, empty unless given. */
const answer = (a = {}) => ({
  subject: '', kind: 'summary', rows: [], columns: [], values: [], filters: [],
  period: { relative: '', n: 0, from: '', to: '' }, venues: [], sort: [],
  limit: { which: 'none', n: 0, by: '', rest: '' }, compare: 'none',
  chart: { kind: 'table', x: '', y: [], line: '', stacked: false, sideways: false },
  name: '', assumed: [], couldnt: [], questions: [], ...a,
})
const reply = a => () => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify(answer(a)) }],
  usage: { input_tokens: 9000, output_tokens: 700 },
})
const row = (ref, bucket = '') => ({ ref, bucket, label: '' })
const value = (name, ref, extra = {}) => ({ name, ref, agg: '', calc: '', label: '', format: '', ...extra })
const filter = (ref, op, values, extra = {}) => ({ ref, bucket: '', op, values, ask: false, label: '', ...extra })

/**
 * The subjects Pepper was shown, by label: { ref, detailed, figures, fields,
 * things } (each a Map of the name as shown to its F ref; a subject's own
 * fields come first, so its own name wins over a linked one).
 */
function shown(body) {
  const subjects = new Map()
  let cur = null, section = null
  for (const line of body.system[1].text.split('\n')) {
    let m = line.match(/^(S\d+) ([^:]+): /)
    if (m) { cur = { ref: m[1], detailed: false, figures: new Map(), fields: new Map(), things: new Map() }; subjects.set(m[2], cur); section = null; continue }
    if (!cur) continue
    if (line === ' Figures:') { section = 'figures'; continue }
    if (line === ' Fields:') { section = 'fields'; continue }
    if (/^ (In|List of) /.test(line)) { section = 'linked'; continue }
    m = line.match(/^ {2}(F\d+) \| ([^|]+?) \| ([^|]+?)( \||$)/)
    if (!m) continue
    cur.detailed = true
    const map = m[3] === 'a thing' ? cur.things : section === 'figures' ? cur.figures : cur.fields
    if (!map.has(m[2])) map.set(m[2], m[1])
  }
  return subjects
}

const usage = async () => (await sql`SELECT COALESCE(sum(units), 0)::int AS units, COALESCE(sum(requests), 0)::int AS requests FROM ai_usage WHERE tenant_id = ${ids.a}`)[0]

test.before(async () => {
  ids = await resetAndSeed()
  filled = await fillTenant(A.owner, ids.a, { reports: false })
  assert.deepEqual(filled.failed, [], 'fixtures: ' + JSON.stringify(filled.failed).slice(0, 600))
  await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc', reports: false })
  owner = as(A.owner, ids.a)
  admin = as(A.admin, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  ownerB = as(B.owner, ids.b)
  await sellTwoDays({ owner, tenantId: ids.a, filled })
})
test.after(async () => { await claude.close(); await closeApp() })
test.beforeEach(() => { forgetReportResults(); claude.script.length = 0 })

test('Pepper is shown refs, never names, and the answer runs as a report for the person', async () => {
  const before = await usage()
  let refs
  claude.script.push(body => {
    refs = shown(body)
    const checks = refs.get('Checks')
    return reply({
      subject: checks.ref,
      rows: [row(checks.things.get('Server'))],
      values: [value('v1', checks.figures.get('Net sales')), value('v2', checks.figures.get('Checks'))],
      period: { relative: 'today', n: 0, from: '', to: '' },
      venues: ['Ware'],
      sort: [{ by: 'v1', dir: 'desc' }],
      name: 'Sales by server today',
      assumed: ['Sales taken as net sales'],
    })()
  })
  const res = await owner.post(BUILD, { request: '  net sales by server today at Ware  ' })
  assert.equal(res.status, 200, res.body)
  assert.equal(claude.requests.length, 1, 'one call')

  const body = lastBody()
  assert.equal(body.model, env.AI_MODEL, 'the main model builds reports')
  assert.equal(body.thinking?.type, 'adaptive', 'it thinks first')
  assert.equal(body.output_config.format.type, 'json_schema')
  assert.equal(body.system.length, 2, 'the instructions, then what can be reported on')
  assert.ok(body.system.every(b => b.cache_control?.type === 'ephemeral'), 'both cached')
  assert.match(body.system[0].text, /You never see the data/)
  const slice = body.system[1].text
  assert.ok(!/\b(till|online|bookings|guests|menu)\.[a-z]/.test(slice), 'no subject keys')
  assert.ok(!/\b(net_sales|tenant_id|pos_checks|server_id)\b/.test(slice), 'no figure keys, columns or tables')
  assert.ok(refs.get('Checks').detailed, 'checks are listed in full')
  assert.match(userText(body), /The request: net sales by server today at Ware$/, 'the words as asked, trimmed')
  assert.match(userText(body), /Today at the venues: \w+day \d{1,2} \w{3} \d{4} \(\d{4}-\d{2}-\d{2}\)/)
  assert.match(userText(body), /The group's venues: .*Zqx Ware/)
  assert.ok(!/Yyc/.test(slice + userText(body)), 'nothing of the other group')

  const out = JSON.parse(res.body)
  assert.equal(out.problem, null)
  assert.equal(out.spec.subject, 'till.checks')
  assert.deepEqual(out.spec.rows.map(r => r.field), ['server.name'], 'a thing grouped by its name')
  assert.deepEqual(out.spec.values.map(v => v.measure), ['net_sales', 'checks'])
  assert.deepEqual(out.spec.params.find(p => p.key === 'venues').default, [filled.ids.venue], '"Ware" found among the group\'s venues')
  assert.deepEqual(out.spec.params.find(p => p.key === 'period').default, { relative: 'today' })
  assert.deepEqual(out.spec.sort, [{ by: 'net_sales', dir: 'desc' }])
  assert.equal(out.name, 'Sales by server today')
  assert.deepEqual(out.assumed, ['Sales taken as net sales'])
  assert.deepEqual(out.couldnt, [])
  assert.equal(out.about, 'Net sales and checks by server, for today (' + out.result.meta.period.text.replace(/^Today \((.*)\)$/, '$1') + ') at Zqx Ware.', 'said from the definition')
  assert.equal(out.result.kind, 'summary')
  const names = out.result.rows.filter(r => r.kind === 'row').map(r => r.k[0])
  assert.ok(names.includes('Zqx Jo Bloggs'), 'the till\'s sales, run as the owner: ' + names.join(', '))

  const after = await usage()
  assert.equal(after.requests, before.requests + 1, 'the call is counted for the group')
  assert.ok(after.units > before.units)
  const [person] = await sql`SELECT units FROM ai_usage_people WHERE tenant_id = ${ids.a} AND user_sub = ${A.owner}`
  assert.ok(person?.units > 0, 'and for the person')
  const [runs] = await sql`SELECT count(*)::int AS n FROM report_runs WHERE tenant_id = ${ids.a}`
  assert.equal(runs.n, 0, 'nothing recorded: a build is a preview')
})

test('venues and names in the data named loosely become questions, each choice a report ready to show', async () => {
  // Two venues start with "zqx": the first is used meanwhile, the question offers each and both.
  claude.script.push(body => {
    const checks = shown(body).get('Checks')
    return reply({ subject: checks.ref, values: [value('v1', checks.figures.get('Net sales'))], venues: ['zqx'] })()
  })
  const res = await owner.post(BUILD, { request: 'net sales at zqx' })
  assert.equal(res.status, 200, res.body)
  const out = JSON.parse(res.body)
  const venueQ = out.questions.find(q => /venue/.test(q.question))
  assert.ok(venueQ, 'a question about the venue: ' + JSON.stringify(out.questions))
  assert.equal(venueQ.question, 'Which venue did you mean by "zqx"?')
  assert.deepEqual(venueQ.choices.map(c => c.label), ['Zqx Hertford', 'Zqx Ware', 'All of them'])
  const venuesOf = spec => spec.params.find(p => p.key === 'venues').default
  assert.deepEqual(venuesOf(out.spec), [filled.ids.venue2], 'the first one meanwhile')
  assert.deepEqual(venuesOf(venueQ.choices[1].spec), [filled.ids.venue], 'each choice is that report')
  assert.deepEqual(venuesOf(venueQ.choices[2].spec).sort(), [filled.ids.venue, filled.ids.venue2].sort())
  assert.match(venueQ.choices[1].about, /at Zqx Ware\.$/, 'and says so')

  // Dish names are found among the dishes sold at the venue in the period.
  const dishes = (await sql`
    SELECT l.name, count(*)::int AS n FROM pos_check_lines l
    WHERE l.tenant_id = ${ids.a} AND l.venue_id = ${filled.ids.venue}
    GROUP BY l.name ORDER BY n DESC, l.name`).map(r => r.name)
  const named = dishes.filter(d => d.toLowerCase().includes('zqx'))
  assert.ok(named.length >= 2, 'the till sold several dishes: ' + dishes.join(', '))
  claude.script.push(body => {
    const lines = shown(body).get('Dishes sold')
    return reply({
      subject: lines.ref,
      rows: [row(lines.fields.get('Trading day'))],
      values: [value('v1', lines.figures.get('Quantity sold'))],
      filters: [filter(lines.fields.get('Dish'), 'is', ['zqx']), filter(lines.fields.get('Dish'), 'is_not', ['nothing like this'])],
      venues: ['Ware'],
      period: { relative: 'this_week', n: 0, from: '', to: '' },
    })()
  })
  const res2 = await owner.post(BUILD, { request: 'how many zqx a day this week at Ware' })
  assert.equal(res2.status, 200, res2.body)
  const out2 = JSON.parse(res2.body)
  assert.equal(out2.problem, null)
  const dishQ = out2.questions.find(q => /dish/i.test(q.question))
  assert.ok(dishQ, 'a question about the dish: ' + JSON.stringify(out2.questions))
  assert.deepEqual(dishQ.choices.slice(0, -1).map(c => c.label), named.slice(0, 4), 'the most sold first')
  assert.equal(dishQ.choices.at(-1).label, 'All of them')
  const dishFilter = spec => spec.filters.find(f => f.field === 'name' && f.op !== 'is_not')
  assert.equal(dishFilter(out2.spec).value, named[0], 'the most sold meanwhile')
  assert.deepEqual(dishFilter(dishQ.choices.at(-1).spec), { field: 'name', op: 'in', value: named })
  assert.ok(out2.couldnt.some(x => /"nothing like this" was found/.test(x)) || out2.couldnt.some(x => /nothing like this/.test(x)),
    'a name found nowhere is kept as typed, with a note: ' + JSON.stringify(out2.couldnt))
  assert.equal(out2.spec.filters.find(f => f.op === 'is_not').value, 'nothing like this')

  // A choice's report runs as it is: the page shows it with a preview.
  const chosen = await ok(owner.post('/api/reports/preview', { spec: dishQ.choices[1].spec }))
  assert.equal(chosen.kind, 'summary')
})

test('venue names are only ever the group\'s own', async () => {
  claude.script.push(body => {
    const checks = shown(body).get('Checks')
    return reply({ subject: checks.ref, values: [value('v1', checks.figures.get('Net sales'))], venues: ['Yyc Ware'] })()
  })
  const out = await ok(owner.post(BUILD, { request: 'net sales at Yyc Ware' }))
  assert.ok(out.couldnt.includes('There\'s no venue called "Yyc Ware"'), JSON.stringify(out.couldnt))
  assert.equal(out.spec.params.find(p => p.key === 'venues').default, 'all')
})

test('an answer that can\'t be used goes back once with the reasons', async () => {
  let first
  claude.script.push(body => {
    first = shown(body).get('Checks')
    // Nothing to show: a summary needs a value or a grouping.
    return reply({ subject: first.ref, values: [value('v1', 'F99999')] })()
  })
  claude.script.push(body => reply({ subject: first.ref, values: [value('v1', shown(body).get('Checks').figures.get('Checks'))] })())
  const out = await ok(owner.post(BUILD, { request: 'how many checks' }))
  assert.equal(claude.requests.length >= 2 && claude.requests.slice(-2).length, 2, 'asked twice')
  const again = userText(lastBody())
  assert.match(again, /Your last answer:\n\{/)
  assert.match(again, /It couldn't be used:\n- Add a value to add up, or something to group by/)
  assert.match(again, /The request: how many checks$/)
  assert.deepEqual(out.spec.values.map(v => v.measure), ['checks'])
  assert.equal(out.problem, null)
  assert.ok(out.result)
})

test('a second answer that still can\'t be used comes back with the problem, not a report', async () => {
  claude.script.push(body => reply({ subject: shown(body).get('Checks').ref })())
  claude.script.push(body => reply({ subject: shown(body).get('Checks').ref })())
  const out = await ok(owner.post(BUILD, { request: 'checks' }))
  assert.equal(out.result, null)
  assert.match(out.problem, /Add a value to add up, or something to group by/)
  assert.equal(out.spec.subject, 'till.checks', 'what was built is still given, to open in the builder')
})

test('a subject listed in a line only is shown in full on the second ask', async () => {
  const seen = []
  claude.script.push(body => {
    const b = shown(body).get('Bookings')
    seen.push(b)
    return reply({ subject: b.ref })()
  })
  claude.script.push(body => {
    const b = shown(body).get('Bookings')
    seen.push(b)
    return reply({ subject: b.ref, rows: [row(b.fields.get('Day'), 'weekday')], values: [value('v1', 'COUNT', { agg: 'count' })] })()
  })
  const out = await ok(owner.post(BUILD, { request: 'net sales by dish and server and tender' }))
  assert.ok(seen[0] && !seen[0].detailed, 'bookings are listed in a line for this request')
  assert.ok(seen[1]?.detailed, 'and in full the second time')
  assert.match(userText(lastBody()), /Build it from S\d+ \(Bookings\), now listed in full/)
  assert.equal(out.spec.subject, 'bookings.bookings')
  assert.deepEqual(out.spec.rows, [{ field: 'date', bucket: 'weekday' }])
  assert.deepEqual(out.spec.values.map(v => v.agg), ['count'])
})

test('a change starts from the report as it is, with the requests that made it', async () => {
  claude.script.push(body => {
    const checks = shown(body).get('Checks')
    return reply({ subject: checks.ref, rows: [row(checks.things.get('Server'))], values: [value('v1', checks.figures.get('Net sales'))], period: { relative: 'today', n: 0, from: '', to: '' } })()
  })
  const built = await ok(owner.post(BUILD, { request: 'net sales by server today' }))

  let current
  claude.script.push(body => {
    const text = userText(body)
    current = JSON.parse(text.split('The report as it is now:\n')[1].split('\n\n')[0])
    const checks = shown(body).get('Checks')
    return reply({ ...current, values: [...current.values, value('v2', checks.figures.get('Guests'))], compare: 'previous_period' })()
  })
  const out = await ok(owner.post(BUILD, { request: 'add guests and compare with the day before', previous: { spec: built.spec, requests: ['net sales by server today'] } }))
  const text = userText(lastBody())
  assert.match(text, /Earlier they asked:\n- net sales by server today/)
  assert.match(text, /Change it like this: add guests and compare with the day before$/)
  const checks = shown(lastBody()).get('Checks')
  assert.equal(current.subject, checks.ref, 'the report in refs')
  assert.deepEqual(current.values.map(v => [v.name, v.ref]), [['v1', checks.figures.get('Net sales')]])
  assert.deepEqual(current.period, { relative: 'today', n: 0, from: '', to: '' })
  assert.deepEqual(out.spec.values.map(v => v.measure), ['net_sales', 'guests'])
  assert.deepEqual(out.spec.compare, { with: 'previous_period' })
  assert.match(out.about, /compared with the period before/)
})

test('a photo or a PDF goes to Pepper with the request; anything else is refused', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
  claude.script.push(body => {
    const checks = shown(body).get('Checks')
    return reply({ subject: checks.ref, values: [value('v1', checks.figures.get('Net sales'))], couldnt: ['The photo\'s labour cost column isn\'t in the reports'] })()
  })
  const out = await ok(owner.post(BUILD, { request: 'make this report', files: [{ name: 'report.png', data: png.toString('base64') }] }))
  const content = lastBody().messages[0].content
  assert.equal(content[0].type, 'image')
  assert.equal(content[0].source.media_type, 'image/png')
  assert.equal(content.at(-1).type, 'text')
  assert.deepEqual(out.couldnt, ['The photo\'s labour cost column isn\'t in the reports'])

  const n = claude.requests.length
  const bad = await owner.post(BUILD, { request: 'make this report', files: [{ name: 'notes.txt', data: Buffer.from('hello there, a report please').toString('base64') }] })
  assert.equal(bad.status, 422)
  assert.match(JSON.parse(bad.body).error, /notes\.txt isn't a photo or a PDF/)
  assert.equal(claude.requests.length, n, 'nothing sent')
})

test('nothing listed fits: no report, and Pepper says why', async () => {
  claude.script.push(reply({ subject: '', couldnt: ['Stock levels aren\'t in the reports yet'], questions: [{ question: 'Did you mean what was ordered from suppliers?', choices: ['Yes', 'No'] }] }))
  const out = await ok(owner.post(BUILD, { request: 'stock levels by supplier' }))
  assert.equal(out.spec, null)
  assert.equal(out.result, null)
  assert.deepEqual(out.couldnt, ['Stock levels aren\'t in the reports yet'])
  assert.deepEqual(out.questions, [{ question: 'Did you mean what was ordered from suppliers?', choices: [{ label: 'Yes' }, { label: 'No' }] }])
})

test('refusals: roles, Pepper switched off, a refusal by Claude, another group\'s venue, an empty request', async () => {
  const n = claude.requests.length
  assert.equal((await operator.post(BUILD, { request: 'sales by day' })).status, 403, 'View on Reports can\'t build')
  assert.equal((await viewer.post(BUILD, { request: 'sales by day' })).status, 403)
  assert.equal((await owner.post(BUILD, { request: '   ' })).status, 400)
  const other = await owner.post(BUILD, {
    request: 'only this one',
    previous: { spec: { subject: 'till.checks', params: [{ key: 'venues', type: 'venues', default: [(await sql`SELECT id FROM venues WHERE tenant_id = ${ids.b} LIMIT 1`)[0].id] }], values: [{ measure: 'checks' }] } },
  })
  assert.equal(other.status, 404, 'another group\'s venue')
  assert.equal(claude.requests.length, n, 'none of these reached Claude')

  await ok(owner.patch('/api/ai/settings', { staff_enabled: false }))
  try {
    const off = await admin.post(BUILD, { request: 'sales by day' })
    assert.equal(off.status, 403)
    assert.match(JSON.parse(off.body).error, /switched off/)
  } finally {
    await ok(owner.patch('/api/ai/settings', { staff_enabled: true }))
  }

  claude.script.push(() => ({ stop_reason: 'refusal', content: [], usage: { input_tokens: 10, output_tokens: 1 } }))
  const refused = await owner.post(BUILD, { request: 'sales by day' })
  assert.equal(refused.status, 422)
  assert.match(JSON.parse(refused.body).error, /can't build this one/)

  // The other group's owner sees nothing of this group.
  claude.script.push(body => {
    const checks = shown(body).get('Checks')
    return reply({ subject: checks.ref, values: [value('v1', checks.figures.get('Checks'))], venues: ['Zqx Ware'] })()
  })
  const b = await ok(ownerB.post(BUILD, { request: 'checks at Zqx Ware' }))
  const venuesLine = userText(lastBody()).match(/The group's venues: (.*)\./)[1]
  assert.ok(/Yyc Ware/.test(venuesLine) && !/Zqx/.test(venuesLine), 'the group\'s own venues only: ' + venuesLine)
  assert.ok(b.couldnt.includes('There\'s no venue called "Zqx Ware"'))
})

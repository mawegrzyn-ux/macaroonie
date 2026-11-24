// The catalogue's context (Pepper-first step 8A2, the `ai_context` idea):
// synonyms, instructions and examples on fields and measures, counted by the
// matchers (the smart builder's rankSubjects(), the builder's searchTree(),
// Pepper's find_fields), shown with each figure to the model, and a topic no
// report holds answered "not covered" with the nearest fields, never a guess.
import test from 'node:test'
import assert from 'node:assert/strict'

const { getApp, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A } = await import('./support/seed.mjs')
const { makeContext } = await import('../src/ai/context.js')
const { audienceTools, parseInput } = await import('../src/ai/tools/index.js')
const { CATALOGUE, catalogueView } = await import('../src/reports/catalogue/index.js')
const { subject, sum } = await import('../src/reports/catalogue/define.js')
const { rankSubjects, topicCoverage, buildSlice, contextParts } = await import('../src/reports/smart.js')
const { dataTree, searchTree, treeNodes } = await import('../../shared/reports/build.js')
const { MODULE_KEYS } = await import('../src/config/modules.js')

const ALL = Object.fromEntries(MODULE_KEYS.map(k => [k, 'manage']))
const view = catalogueView(ALL)
let ids
const quiet = { info() {}, warn() {}, error() {}, debug() {} }
async function tool(name, input, sub = A.owner) {
  const app = await getApp()
  const ctx = makeContext({
    app, channel: 'staff_chat', tenantId: ids.a, log: quiet,
    auth: { authorization: 'Bearer test:' + sub }, principal: { sub, email: sub + '@test.local' }, actor: sub + '@test.local',
  })
  const t = audienceTools('staff').find(x => x.name === name)
  return t.run(ctx, parseInput(t, input))
}

test.before(async () => { ids = await resetAndSeed() })
test.after(async () => { await closeApp() })

test('at least 30 fields and figures people ask about carry their context, and the view passes it on', () => {
  const withContext = []
  for (const s of Object.values(CATALOGUE.subjects)) {
    for (const d of [...Object.values(s.fields), ...Object.values(s.measures)]) {
      if (d.synonyms?.length || d.instructions || d.examples?.length) withContext.push(s.key + '.' + d.key)
    }
  }
  assert.ok(withContext.length >= 30, withContext.length + ' with context')
  // The ones asked about most: sales, covers, tips, discounts, voids, no-shows,
  // dishes sold, wages, variance, food safety readings.
  for (const k of ['till.checks.net_sales', 'till.checks.guests', 'till.payments.tips', 'till.checks.discounts', 'till.voids.voids',
    'bookings.bookings.no_shows', 'till.lines.qty_sold', 'cash.wages.wages_total', 'cash.days.variance_total',
    'safety.fridge_checks.out_of_range', 'safety.fridge_checks.temperature']) {
    assert.ok(withContext.includes(k), k)
  }
  const g = view.subjects['till.checks'].measures.guests
  assert.ok(g.synonyms.includes('pax') && g.instructions && g.examples.length)
  assert.ok(view.subjects['till.checks'].fields.covers.synonyms.includes('pax'))
})

test('a synonym that isn\'t a list of words, or instructions that run on, stop the catalogue', () => {
  // subject() keeps the options; index.js's build checks them at start-up.
  const s = subject({ key: 'x.y', label: 'Y', from: 'pos_checks', measures: { n: sum('covers', { synonyms: 'pax' }) } })
  assert.equal(s.measures.n.synonyms, 'pax', 'kept as written for the start-up check to refuse')
})

test('the smart builder\'s ranking counts a figure\'s synonyms, and the slice shows them', () => {
  const top = rankSubjects(view, 'how many pax did we do last week').slice(0, 2).map(r => r.key).sort()
  assert.deepEqual(top, ['bookings.bookings', 'till.checks'])
  assert.ok(rankSubjects(view, 'pax')[0].score > 0)
  const slice = buildSlice(view, 'pax last week')
  assert.match(slice.text, /Guests \| number \| [^\n]*also: covers, heads, pax/)
  assert.match(slice.text, /note: Guests who ate/)
  assert.deepEqual(contextParts({ trail: ['Check'], synonyms: ['x'] }), [], 'a linked thing\'s line stays short')
})

test('the builder\'s search finds a figure by another word for it', () => {
  const tree = dataTree(view, 'till.checks', { depth: 2 })
  assert.ok(searchTree(tree, 'pax').some(n => n.path === 'guests'))
  assert.ok(searchTree(tree, 'comps').some(n => n.path === 'discounts'))
  assert.equal(treeNodes(tree).find(n => n.path === 'net_sales').instructions.startsWith('The usual meaning'), true)
})

test('topicCoverage: words found in some subject, words found nowhere', () => {
  assert.deepEqual(topicCoverage(view, 'carbon footprint last month'), { words: ['carbon', 'footprint'], found: [], missing: ['carbon', 'footprint'] })
  assert.deepEqual(topicCoverage(view, 'pax last week').found, ['pax'])
  const named = topicCoverage(view, 'sales at Oak Ware')
  assert.deepEqual([named.found, named.missing], [['sale'], ['oak', 'ware']])
})

test('find_fields: a question asked in other words finds its figure, with the note and examples', async () => {
  const out = await tool('find_fields', { topic: 'how many pax did we do last week' })
  const lines = out.subjects.flatMap(s => s.matching || [])
  assert.ok(lines.some(l => /^guests \| Guests \|.*also: .*pax/.test(l)), lines.join('\n'))
  assert.equal(out.not_found, undefined)
  const comps = await tool('find_fields', { topic: 'comps by server' })
  assert.ok(comps.subjects.flatMap(s => s.matching || []).some(l => /discount/i.test(l)))
  // Words no report has (a name, here) are listed for the model to judge.
  const named = await tool('find_fields', { topic: 'unicorn sales' })
  assert.deepEqual(named.not_found, ['unicorn'])
  assert.match(named.not_found_note, /never guess/)
})

test('find_fields: a topic no report holds is "not covered", with the nearest fields or what reports cover', async () => {
  const out = await tool('find_fields', { topic: 'carbon footprint last month' })
  assert.equal(out.covered, false)
  assert.match(out.answer, /not something reports cover yet/)
  assert.equal(out.subjects, undefined, 'no subject offered as if it fitted')
  assert.ok((out.nearest || []).length || out.reports_cover?.includes('Till sales'), JSON.stringify(out))
  const none = await tool('find_fields', { topic: 'xylophone' })
  assert.equal(none.covered, false)
  assert.ok(none.reports_cover.includes('Till sales'), JSON.stringify(none))
  const typo = await tool('find_fields', { topic: 'gratuties' })
  assert.equal(typo.covered, false)
  assert.ok(typo.nearest.some(l => / tips \|/.test(l)), typo.nearest.join('\n'))
})

test('ask_data gives the figures\' instructions with the answer', async () => {
  const out = await tool('ask_data', { plan: { subject: 'till.checks', figures: [{ figure: 'net_sales' }, { figure: 'checks' }], period: { relative: 'last_week' } } })
  assert.deepEqual(out.figure_notes, ['Net sales: ' + CATALOGUE.subjects['till.checks'].measures.net_sales.instructions])
})

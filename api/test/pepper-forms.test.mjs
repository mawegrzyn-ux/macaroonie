// Pepper opens forms (open_form, OUTSTANDING 44 item 3): the card comes from
// the server's own result (streamed as it happens and rebuilt from the stored
// conversation), never from the model's words; each form needs View on its
// module; a checklist is picked from the ones due; the staff connector gets a
// link instead of a card.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { as, getApp, ok, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A } = await import('./support/seed.mjs')
const { fillTenant } = await import('./support/fixtures.mjs')
const { makeContext } = await import('../src/ai/context.js')
const { audienceTools, parseInput } = await import('../src/ai/tools/index.js')
const { OPEN_FORMS } = await import('../src/ai/tools/forms.js')

let ids, owner, V, venueName, today

function parseSse(body) {
  return body.split('\n\n').filter(Boolean).flatMap(chunk => {
    const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n')
    return data ? [JSON.parse(data)] : []
  })
}
const quiet = { info() {}, warn() {}, error() {}, debug() {} }
async function tool(sub, input, channel = 'staff_chat') {
  const app = await getApp()
  const ctx = makeContext({
    app, channel, tenantId: ids.a, log: quiet,
    auth: { authorization: 'Bearer test:' + sub }, principal: { sub, email: sub + '@test.local' }, actor: sub + '@test.local',
  })
  const t = audienceTools('staff').find(x => x.name === 'open_form')
  return t.run(ctx, parseInput(t, input))
}

test.before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  const venues = await ok(owner.get('/api/venues'))
  venueName = venues.find(v => v.id === V).name
  today = (await ok(owner.get(`/api/ops/today?venue_id=${V}`))).date
})
test.after(async () => { await claude.close(); await closeApp() })

test('the forms match the sheet\'s: ten, each with its module', () => {
  assert.deepEqual(Object.keys(OPEN_FORMS).sort(),
    ['cash_up', 'checklist', 'cooking', 'delivery', 'expense', 'holds', 'rota_day', 'sold_out', 'temps', 'wages'])
})

test('a card per form: the day, the week, the venue', async () => {
  const cash = await tool(A.owner, { form: 'cash_up', venue: venueName })
  assert.deepEqual(cash.form_card.ref, { date: today })
  assert.equal(cash.form_card.venue_id, V)
  assert.match(cash.form_card.title, /^Cash-up for /)
  assert.equal(cash.form_card.read_only, false)
  const wages = await tool(A.owner, { form: 'wages', venue: venueName, date: '2026-11-19' })
  assert.deepEqual(wages.form_card.ref, { week: '2026-11-16' }, 'any day names its week')
  const sold = await tool(A.owner, { form: 'sold_out', venue: venueName })
  assert.deepEqual(sold.form_card.ref, {})
  for (const form of ['temps', 'holds', 'cooking', 'delivery', 'expense', 'rota_day']) {
    const r = await tool(A.owner, { form, venue: venueName, date: '2026-11-20' })
    assert.equal(r.form_card.form, form)
    assert.equal(r.form_card.ref.date, '2026-11-20', form)
  }
})

test('a checklist by name, or the one due; an unknown one lists what is due', async () => {
  const due = await ok(owner.get(`/api/checklists/due?venue_id=${V}&date=${today}`))
  const open = due.filter(d => !d.not_required)
  assert.ok(open.length, 'the fixtures have a checklist due')
  const named = await tool(A.owner, { form: 'checklist', venue: venueName, checklist: open[0].template.name })
  assert.equal(named.form_card.ref.template.id, open[0].template.id)
  assert.equal(named.form_card.title, open[0].template.name)
  await assert.rejects(tool(A.owner, { form: 'checklist', venue: venueName, checklist: 'No such list at all' }), /No checklist due called/)
})

test('each form needs View on its module; below the level that changes it, read only', async () => {
  // The viewer has no Cash Recon by default.
  await assert.rejects(tool(A.viewer, { form: 'cash_up', venue: venueName }), /don't have access to Cash/)
  // Viewers see the rota and the food safety logs without changing them.
  const rota = await tool(A.viewer, { form: 'rota_day', venue: venueName })
  assert.equal(rota.form_card.read_only, true)
  const temps = await tool(A.viewer, { form: 'temps', venue: venueName })
  assert.equal(temps.form_card.read_only, true)
  assert.equal((await tool(A.operator, { form: 'temps', venue: venueName })).form_card.read_only, false, 'operators log checks')
})

test('through the staff connector: a link to the page, no card', async () => {
  const r = await tool(A.owner, { form: 'cash_up', venue: venueName }, 'staff_mcp')
  assert.equal(r.form_card, undefined)
  assert.match(r.url, /\/cash-recon$/)
})

test('in the chat: the card streams and comes back with the conversation, from the server\'s result', async () => {
  claude.script.push(
    () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_f1', name: 'open_form', input: { form: 'cash_up', venue: venueName } }] }),
    () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here is today\'s cash-up.' }] }),
  )
  const res = await as(A.owner, ids.a).post('/api/ai/chat', { message: 'do today\'s cash-up' }, { accept: 'text/event-stream' })
  assert.equal(res.status, 200)
  const events = parseSse(res.body)
  const card = events.find(e => e.type === 'card')?.card
  assert.equal(card?.type, 'form')
  assert.equal(card.form.form, 'cash_up')
  assert.equal(card.form.venue_id, V)
  const done = events[events.length - 1]
  const item = done.items.find(i => i.type === 'form')
  assert.deepEqual(item, card, 'the stored conversation shows the same card')
  assert.ok(!done.items.some(i => i.type === 'step' && /form/i.test(i.text)), 'no step line for it')
})

// Rules made from a sentence (Pepper-first step 8B2, migration 286): Pepper
// reads the sentence with askForJson() (the stand-in Claude here), the answer
// is checked against the schema and the shared rules (refs back to ids, the
// never-list refused), the card shows the rule and it is saved only on
// Confirm; when its event happens it runs as a system action, as the person
// who confirmed it, named in the audit, at most per_day times a day; another
// group's rules, venues and events never meet this group's.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { as, getApp, ok, sql, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { fillTenant } = await import('./support/fixtures.mjs')
const { makeContext } = await import('../src/ai/context.js')
const { audienceTools, parseInput, classFor } = await import('../src/ai/tools/index.js')
const { toRule, ANSWER_SCHEMA } = await import('../src/services/rules.js')
const { fireRules } = await import('../src/ai/ruleRunner.js')
const { pushSenders } = await import('../src/services/notices.js')
const { RULE_ACTIONS, TRIGGERS, ruleProblem, matches, fillInput } = await import('../../shared/rules.js')

let ids, owner, operator, bOwner, V, venueName, fridge, VB
const quiet = { info() {}, warn() {}, error() {}, debug() {} }
const sent = []
const reply = obj => () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { input_tokens: 900, output_tokens: 200 } })
const COND = { above: '', below: '', out_of_range: '', equipment: '', over: '', supplier: '', area: '', title: '', stars_at_most: '', platform: '' }
const INPUT = { task: '', details: '', priority: '', assigned_to: '', to: '', title: '', text: '' }
const answer = o => ({
  understood: true, why_not: '', name: '', trigger: 'fridge_reading', venue: '', per_day: '', action: 'add_hs_action',
  ...o, conditions: { ...COND, ...(o.conditions || {}) }, action_input: { ...INPUT, ...(o.action_input || {}) },
})
const FRIDGE = answer({
  name: 'Warm fridge', venue: 'V1', conditions: { above: '8' },
  action_input: { task: 'Check {equipment}: it read {temperature}', assigned_to: 'the manager', priority: 'high' },
})

async function ctxOf(sub = A.owner) {
  const app = await getApp()
  return makeContext({
    app, channel: 'staff_chat', tenantId: ids.a, log: quiet,
    auth: { authorization: 'Bearer test:' + sub }, principal: { sub, email: sub + '@test.local' }, actor: sub + '@test.local',
  })
}
const tool = name => audienceTools('staff').find(t => t.name === name)
async function waitFor(fn, what) {
  for (let i = 0; i < 100; i++) {
    const v = await fn()
    if (v) return v
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error('Waited too long for ' + what)
}
const firings = ruleId => sql`SELECT status, day::text AS day, result FROM pepper_rule_firings WHERE rule_id = ${ruleId} ORDER BY fired_at, id`
const today = () => new Date().toISOString().slice(0, 10)

test.before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  bOwner = as(B.owner, ids.b)
  V = filled.ids.venue
  const venues = await ok(owner.get('/api/venues'))
  venueName = venues.find(v => v.id === V).name
  fridge = (await ok(owner.get('/api/food-safety/equipment?venue_id=' + V)))[0]
  VB = (await ok(bOwner.post('/api/venues', { name: 'Elsewhere', slug: 'elsewhere-rules', timezone: 'Europe/London' }))).id
  pushSenders.web = async (token, payload) => { sent.push(payload); return { ok: true } }
  pushSenders.app = async (token, payload) => { sent.push(payload); return { ok: true } }
})
test.after(async () => { await closeApp(); await claude.close?.() })

test('the shared rules: every action a rule may run is a reversible tool, and the shape is checked', () => {
  for (const name of Object.keys(RULE_ACTIONS)) {
    const t = tool(name)
    assert.ok(t, name + ' is one of Pepper\'s tools')
    assert.equal(classFor(t, {}), 'reversible', name + ': only "Done, with Undo" tools run unattended (decision 4)')
  }
  const ok1 = { name: 'x', trigger: 'fridge_reading', conditions: { above: 8 }, action_tool: 'add_hs_action', action_input: { task: 'Check {equipment}' } }
  assert.equal(ruleProblem(ok1), null)
  assert.match(ruleProblem({ ...ok1, action_tool: 'refund_online_order' }), /never money, pay, prices/)
  assert.match(ruleProblem({ ...ok1, action_input: { task: 'Pay {supplier}' } }), /\{supplier\} isn't known/)
  assert.match(ruleProblem({ ...ok1, conditions: { over: 5 } }), /isn't something to check/)
  assert.match(ruleProblem({ ...ok1, action_input: {} }), /needs its task/)
  assert.match(ruleProblem({ ...ok1, per_day: 99 }), /1 to 20 times/)
  const ev = { trigger: 'fridge_reading', venue_id: V, temperature: 9, equipment: 'Walk-in', in_range: false }
  assert.equal(matches(ok1, ev), true)
  assert.equal(matches(ok1, { ...ev, temperature: 8 }), false, 'above means above')
  assert.equal(matches({ ...ok1, venue_id: VB }, ev), false, 'another venue')
  assert.deepEqual(fillInput(ok1, ev), { task: 'Check Walk-in', venue_id: V })
  assert.ok(Object.keys(TRIGGERS).length >= 4)
})

test('the parser\'s output is validated: refs back to ids, numbers read, and anything off the schema refused', async () => {
  const venues = [{ id: V, name: venueName }]
  const rule = toRule(FRIDGE, venues)
  assert.deepEqual(rule, {
    name: 'Warm fridge', trigger: 'fridge_reading', conditions: { above: 8 }, venue_id: V, action_tool: 'add_hs_action',
    action_input: { task: 'Check {equipment}: it read {temperature}', priority: 'high', assigned_to: 'the manager' }, per_day: 5,
  })
  assert.equal(toRule(answer({ ...FRIDGE, venue: 'V9' }), venues).venue_id, null, 'an unknown ref is no venue, never a guess')
  assert.throws(() => toRule(answer({ understood: false, why_not: 'No action given' }), venues), /isn't a rule.*No action given/)
  assert.throws(() => toRule(answer({ ...FRIDGE, action: 'refund the order' }), venues), e => e.code === 'never_list' && /never change money, pay, prices/.test(e.message))
  assert.throws(() => toRule(answer({ ...FRIDGE, action: 'change_prices' }), venues), e => e.code === 'never_list')
  assert.throws(() => toRule(answer({ ...FRIDGE, action_input: { task: '' } }), venues), /needs its task/)
  assert.throws(() => toRule(answer({ ...FRIDGE, trigger: 'bookings' }), venues), /The rule|rule/)
  // The answer schema: every property required, nothing nullable (structured outputs).
  const walk = s => { if (s.type === 'object') { assert.deepEqual(s.required.sort(), Object.keys(s.properties).sort()); Object.values(s.properties).forEach(walk) } }
  walk(ANSWER_SCHEMA)
})

let ruleId
test('make_rule: the sentence read by the model as data, a Confirm card, saved only on Confirm', async () => {
  // The stand-in reads the venue's ref off the list it was sent, as the model would.
  claude.script.push(body => {
    const text = JSON.stringify(body.messages)
    const ref = new RegExp('(V\\d+): ' + venueName).exec(text)?.[1] || 'V1'
    return reply({ ...FRIDGE, venue: ref })()
  })
  const t = tool('make_rule')
  const sentence = 'when a fridge reads above 8 at ' + venueName + ', add an H&S action for the manager'
  const card = await t.describe(await ctxOf(), parseInput(t, { sentence }))
  const req = claude.requests.at(-1).body
  assert.match(JSON.stringify(req.messages), /<sentence>[^<]*fridge reads above 8/, 'the sentence goes in as data')
  assert.ok(!JSON.stringify(req).includes(V), 'venues go as refs, never ids')
  assert.equal(req.output_config.format.type, 'json_schema')
  assert.equal(t.class, 'consequential')
  assert.ok(card.lines.some(l => /^When a fridge or freezer reading is logged at /.test(l)), card.lines.join(' | '))
  assert.ok(card.lines.includes('If Reads above (°C) 8'))
  assert.ok(card.pin?.rule, 'the card pins the rule it showed')
  assert.equal((await sql`SELECT count(*)::int AS n FROM pepper_rules WHERE tenant_id = ${ids.a}`)[0].n, 0, 'nothing saved before Confirm')
  // Confirm runs the pinned rule: no second model call.
  const before = claude.requests.length
  const out = await t.run(await ctxOf(), parseInput(t, { sentence, ...card.pin }))
  assert.equal(claude.requests.length, before)
  assert.equal(out.rule, 'Warm fridge')
  const [row] = await sql`SELECT id, venue_id, created_by_sub, sentence, enabled FROM pepper_rules WHERE tenant_id = ${ids.a}`
  assert.deepEqual([row.venue_id, row.created_by_sub, row.sentence, row.enabled], [V, A.owner, sentence, true])
  ruleId = row.id
  const [usage] = await sql`SELECT use FROM ai_requests WHERE tenant_id = ${ids.a} ORDER BY created_at DESC LIMIT 1`
  assert.equal(usage.use, 'rule_parser', 'counted in Pepper\'s record of model requests')
})

test('the never-list is refused at creation: by the parser, by the route and by the tool\'s class', async () => {
  claude.script.push(reply(answer({ ...FRIDGE, action: 'refund_online_order', why_not: 'Refunds are money' })))
  const t = tool('make_rule')
  await assert.rejects(t.describe(await ctxOf(), parseInput(t, { sentence: 'when a review is below 2 stars refund their order' })), /never change money, pay, prices/)
  const base = { name: 'x', trigger: 'supplier_order', conditions: { over: 500 }, action_input: { task: 'x' } }
  assert.equal((await owner.post('/api/ai/rules', { rule: { ...base, action_tool: 'change_prices' } })).status, 422, 'not an action a rule may run')
  assert.equal((await owner.post('/api/ai/rules', { rule: { ...base, action_tool: 'add_pay_adjustment' } })).status, 422)
  // A person without the action themselves can't have a rule do it for them.
  const op = await operator.post('/api/ai/rules', { rule: { ...base, action_tool: 'add_hs_action', action_input: { task: 'Approve {supplier}' } } })
  assert.equal(op.status, 403, 'Manage on Pepper is needed to make a rule')
})

test('a rule fires on its event as a system action, named in the audit; below the line it doesn\'t', async () => {
  await ok(owner.post('/api/food-safety/temp-logs', { venue_id: V, equipment_id: fridge.id, temperature_c: 6 }))
  await ok(owner.post('/api/food-safety/temp-logs', { venue_id: V, equipment_id: fridge.id, temperature_c: 9.5 }))
  const [f] = await waitFor(async () => { const r = await firings(ruleId); return r.length && r[0].status !== 'running' ? r : null }, 'the rule to run')
  assert.equal(f.status, 'done', JSON.stringify(f.result))
  assert.equal((await firings(ruleId)).length, 1, '6 is not above 8: no run')
  const [entry] = await sql`SELECT task, assigned_to, priority, venue_id FROM hs_action_log WHERE tenant_id = ${ids.a} AND task LIKE 'Check %' ORDER BY created_at DESC LIMIT 1`
  assert.deepEqual([entry.task, entry.assigned_to, entry.priority, entry.venue_id], ['Check ' + fridge.name + ': it read 9.5', 'the manager', 'high', V])
  const [audit] = await sql`SELECT actor, tool, ok, rule_id, user_sub, channel FROM ai_actions WHERE tenant_id = ${ids.a} AND rule_id = ${ruleId}`
  assert.deepEqual([audit.actor, audit.tool, audit.ok, audit.user_sub], ['Rule: Warm fridge', 'add_hs_action', true, A.owner])
  const list = await ok(owner.get('/api/ai/rules'))
  assert.equal(list.rules[0].last_run.status, 'done')
  assert.equal(list.rules[0].runs_24h, 1)
})

test('the daily cap: at most per_day runs a day, the rest recorded as capped; a switched-off rule never runs', async () => {
  const saved = await ok(owner.post('/api/ai/rules', { rule: {
    name: 'Cold fridge', trigger: 'fridge_reading', conditions: { below: 0 }, venue_id: V, per_day: 2,
    action_tool: 'add_hs_action', action_input: { task: 'Cold {equipment}' },
  }, sentence: 'when a fridge reads below 0 add an action, twice a day at most' }))
  const app = await getApp()
  const ev = n => ({ trigger: 'fridge_reading', key: 'cap-' + n, day: today(), venue_id: V, venue: venueName, equipment: 'Walk-in', temperature: -2, in_range: false, date: today() })
  for (const n of [1, 2, 3]) await fireRules(app, ids.a, ev(n), quiet)
  const runs = await firings(saved.id)
  assert.deepEqual(runs.map(r => r.status), ['done', 'done', 'capped'])
  // The same event again (another process, a retry) never runs twice.
  assert.deepEqual(await fireRules(app, ids.a, ev(1), quiet), [{ rule: saved.id, status: 'already' }])
  // Another day starts again.
  await fireRules(app, ids.a, { ...ev(4), day: '2099-01-01' }, quiet)
  assert.equal((await firings(saved.id)).at(-1).status, 'done')
  // Switched off: nothing.
  await ok(owner.patch('/api/ai/rules/' + saved.id, { enabled: false }))
  assert.deepEqual(await fireRules(app, ids.a, ev(5), quiet), [])
})

test('ask the owner to approve: a supplier order over the amount sends a notice', async () => {
  await ok(owner.post('/api/notices/devices', { kind: 'web', token: { endpoint: 'https://push.example.invalid/owner', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } } }))
  const saved = await ok(owner.post('/api/ai/rules', { rule: {
    name: 'Big orders', trigger: 'supplier_order', conditions: { over: 500 },
    action_tool: 'send_notice', action_input: { to: 'owner', title: 'Approve {supplier} order {number}', text: '{total} at {venue}' },
  } }))
  const app = await getApp()
  const ev = (key, total) => ({ trigger: 'supplier_order', key, day: today(), venue_id: V, venue: venueName, supplier: 'Fresh Co', number: 'PO-7', total, delivery_date: today() })
  await fireRules(app, ids.a, ev('po-small', 120), quiet)
  assert.equal((await firings(saved.id)).length, 0, '120 is not over 500')
  sent.length = 0
  await fireRules(app, ids.a, ev('po-big', 640), quiet)
  assert.equal((await firings(saved.id))[0].status, 'done', JSON.stringify((await firings(saved.id))[0]?.result))
  assert.ok(sent.length >= 1, 'the owner\'s phones (the fixtures\' and this one)')
  for (const n of sent) {
    assert.equal(n.title, 'Approve Fresh Co order PO-7')
    assert.match(n.body, /640 at /)
  }
})

test('a low review and a late task fire their rules too', async () => {
  const review = await ok(owner.post('/api/ai/rules', { rule: {
    name: 'Bad reviews', trigger: 'review_low', conditions: { stars_at_most: 2 },
    action_tool: 'add_hs_action', action_input: { task: 'Reply to {reviewer}\'s {stars} star review' },
  } }))
  await ok(owner.post('/api/reviews', { venue_id: V, platform: 'google', reviewer_name: 'Sam', rating: 4, review_text: 'Nice' }))
  await ok(owner.post('/api/reviews', { venue_id: V, platform: 'google', reviewer_name: 'Kim', rating: 1, review_text: 'Cold food' }))
  const [f] = await waitFor(async () => { const r = await firings(review.id); return r.length && r[0].status !== 'running' ? r : null }, 'the review rule')
  assert.equal(f.status, 'done')
  assert.equal((await firings(review.id)).length, 1, 'four stars: no run')
  const late = await ok(owner.post('/api/ai/rules', { rule: {
    name: 'Late checks', trigger: 'task_late', conditions: { area: 'food_safety' },
    action_tool: 'add_hs_action', action_input: { task: '{task} was late (due {due})' },
  } }))
  const app = await getApp()
  await fireRules(app, ids.a, { trigger: 'task_late', key: 'x:cash', day: today(), venue_id: V, venue: venueName, task: 'Cash-up', due: '', area: 'Cash-ups', area_key: 'cash' }, quiet)
  await fireRules(app, ids.a, { trigger: 'task_late', key: 'x:temps', day: today(), venue_id: V, venue: venueName, task: 'Fridge checks', due: '09:00', area: 'Food safety checks', area_key: 'food_safety' }, quiet)
  const runs = await firings(late.id)
  assert.deepEqual(runs.map(r => r.status), ['done'])
  const [entry] = await sql`SELECT task FROM hs_action_log WHERE tenant_id = ${ids.a} AND task LIKE 'Fridge checks was late%'`
  assert.equal(entry.task, 'Fridge checks was late (due 09:00)')
})

test('cross-tenant: another group\'s rules, venues and events never meet this group\'s', async () => {
  assert.equal((await bOwner.patch('/api/ai/rules/' + ruleId, { enabled: false })).status, 404)
  assert.equal((await bOwner.delete('/api/ai/rules/' + ruleId)).status, 404)
  assert.deepEqual((await ok(bOwner.get('/api/ai/rules'))).rules, [])
  const foreign = await owner.post('/api/ai/rules', { rule: { name: 'x', trigger: 'fridge_reading', venue_id: VB, action_tool: 'add_hs_action', action_input: { task: 'x' } } })
  assert.equal(foreign.status, 404, 'another group\'s venue')
  // B's event, with A's venue in it, runs none of A's rules.
  const app = await getApp()
  const before = (await firings(ruleId)).length
  assert.deepEqual(await fireRules(app, ids.b, { trigger: 'fridge_reading', key: 'b-1', day: today(), venue_id: V, venue: 'x', equipment: 'x', temperature: 20, in_range: false }, quiet), [])
  assert.equal((await firings(ruleId)).length, before)
  // Deleting is A's own, with its runs; the changes it made stay.
  await ok(owner.delete('/api/ai/rules/' + ruleId))
  assert.equal((await firings(ruleId)).length, 0)
  const [audit] = await sql`SELECT count(*)::int AS n FROM ai_actions WHERE tenant_id = ${ids.a} AND actor = 'Rule: Warm fridge'`
  assert.equal(audit.n, 1, 'the audit keeps the change (its rule_id cleared)')
})

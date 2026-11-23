// Pepper reads the Today feed and changes a task's state (Pepper-first step
// 5e): my_tasks (read, no keys or ids to the model), snooze_task (reversible,
// with Undo), skip_task (consequential, a reason required), assign_task
// (consequential); tasks named in words; day_briefing has the late tasks.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { as, ok, closeApp, sql } = await import('./support/app.mjs')
const { resetAndSeed, A } = await import('./support/seed.mjs')
const { fillTenant } = await import('./support/fixtures.mjs')
const { matchTasks } = await import('../src/ai/tools/today.js')
const { audienceTools } = await import('../src/ai/tools/index.js')

let ids, owner, V, venueName
const text = s => [{ type: 'text', text: s }]

test.before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  venueName = (await ok(owner.get('/api/venues'))).find(v => v.id === V).name
})
test.after(async () => { await claude.close(); await closeApp() })

/** One tool call through the chat; returns { card, result } (the tool's result text when it made no card). */
async function call(tool, input) {
  claude.script.push(
    () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_t' + Math.random().toString(36).slice(2, 10), name: tool, input }] }),
    () => ({ stop_reason: 'end_turn', content: text('Done.') }),
  )
  const r = await ok(owner.post('/api/ai/chat', { message: 'go' }))
  const card = r.items.find(i => i.type === 'action' && i.status === 'pending')
  const sent = claude.requests.at(-1).body.messages.flatMap(m => Array.isArray(m.content) ? m.content : []).filter(b => b.type === 'tool_result').at(-1)
  return { card, result: sent?.content?.[0]?.text ?? '', error: !!sent?.is_error }
}
const feed = () => ok(owner.get(`/api/ops/today?venue_id=${V}`))
const confirm = id => ok(owner.post(`/api/ai/actions/${id}/confirm`, {}))

test('the tools and their classes: a read, a reversible snooze with Undo, consequential skip and assign', () => {
  const tools = Object.fromEntries(audienceTools('staff').map(t => [t.name, t]))
  assert.equal(tools.my_tasks.class, 'read')
  assert.equal(tools.snooze_task.class, 'reversible')
  assert.equal(typeof tools.snooze_task.inverse, 'function')
  assert.equal(tools.skip_task.class, 'consequential')
  assert.equal(tools.assign_task.class, 'consequential')
})

test('tasks are named in words: several of one kind together, different kinds ask which', () => {
  const list = [
    { key: 'f1', kind: 'fridge_check', title: 'Fridge and freezer check: Morning', detail: '0 of 1 logged' },
    { key: 'f2', kind: 'fridge_check', title: 'Fridge and freezer check: Evening', detail: '0 of 1 logged' },
    { key: 'c1', kind: 'checklist', title: 'Oak Opening', detail: '0 of 1 ticked' },
    { key: 'c2', kind: 'checklist', title: 'Oak Deep clean', detail: '0 of 1 ticked · this week' },
    { key: 'p1', kind: 'po_to_send', title: 'Send the order to Oak Fresh Co', detail: 'PO-1' },
  ]
  assert.deepEqual(matchTasks(list, 'the fridge checks').map(t => t.key), ['f1', 'f2'])
  assert.deepEqual(matchTasks(list, 'temps').map(t => t.key), ['f1', 'f2'])
  assert.deepEqual(matchTasks(list, 'weekly checklist').map(t => t.key), ['c2'])
  assert.deepEqual(matchTasks(list, 'fresh co order').map(t => t.key), ['p1'])
  assert.throws(() => matchTasks(list, 'oak'), /More than one kind/)
  assert.throws(() => matchTasks(list, 'wages'), /No task on the list matches/)
})

test('my_tasks: the list with its state, no keys or ids for the model', async () => {
  const { result } = await call('my_tasks', { venue: venueName })
  const out = JSON.parse(result)
  assert.equal(out.venue, venueName)
  assert.ok(out.tasks.length >= 1)
  assert.ok(out.tasks.every(t => t.task && t.group))
  assert.ok(!/fridge_check:|checklist:|[0-9a-f]{8}-[0-9a-f]{4}-/.test(result), 'no task keys or ids')
})

test('snooze_task: a card, Confirm hides the tasks, Undo brings them back', async () => {
  const before = await feed()
  const fridges = before.tasks.filter(t => t.kind === 'fridge_check')
  assert.ok(fridges.length, 'a fridge check on the list')
  const { card } = await call('snooze_task', { venue: venueName, task: 'fridge checks', minutes: 60 })
  assert.ok(card, 'a card')
  assert.equal(card.class, 'reversible')
  assert.match(card.title, /for 1 hour/)
  const done = (await confirm(card.id)).items.find(i => i.id === card.id)
  assert.equal(done.status, 'done')
  assert.ok(done.undo_until, 'Undo open')
  const after = await feed()
  assert.ok(!after.tasks.some(t => t.kind === 'fridge_check'), 'off the list')
  assert.ok(after.aside.some(t => t.kind === 'fridge_check' && t.state === 'snoozed'))
  await ok(owner.post(`/api/ai/actions/${card.id}/undo`, {}))
  assert.equal((await feed()).tasks.filter(t => t.kind === 'fridge_check').length, fridges.length, 'back on the list')
  const [log] = await sql`SELECT action FROM ops_task_log WHERE tenant_id = ${ids.a} AND task_key = ${fridges[0].key} ORDER BY at DESC LIMIT 1`
  assert.equal(log.action, 'unsnoozed', 'in the task\'s history')
})

test('skip_task: a reason is required; Confirm skips with it; assign_task to me', async () => {
  const noReason = await call('skip_task', { venue: venueName, task: 'opening checklist' })
  assert.equal(noReason.card, undefined)
  assert.equal(noReason.error, true, 'refused without a reason')
  const { card } = await call('skip_task', { venue: venueName, task: 'opening checklist', reason: 'Closed for a private event' })
  assert.equal(card.class, 'consequential')
  assert.ok(card.lines.includes('Reason: Closed for a private event'))
  assert.equal(card.warningTitle, 'A compliance task')
  await confirm(card.id)
  const f = await feed()
  const skipped = f.aside.find(t => t.kind === 'checklist' && t.state === 'skipped')
  assert.equal(skipped.reason, 'Closed for a private event')
  // Assign: the person themselves.
  const po = f.tasks.find(t => t.kind === 'po_to_send')
  assert.ok(po, 'an order to send')
  const words = po.title.replace(/^Send the order to /, '') + ' order'
  const a = await call('assign_task', { venue: venueName, task: words, person: 'me' })
  assert.ok(a.card, 'a card: ' + a.result)
  await confirm(a.card.id)
  assert.equal((await feed()).tasks.find(t => t.key === po.key).owner.me, true)
})

test('day_briefing has the Today list: counts and the late tasks', async () => {
  const { result } = await call('day_briefing', { venue: venueName })
  const out = JSON.parse(result)
  assert.ok(out.tasks, 'a tasks part')
  assert.ok(out.tasks.counts, 'the counts')
})

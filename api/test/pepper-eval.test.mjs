// Pepper's evaluation set (api/eval/, Pepper-first step 0c) against the
// stand-in model: proves the harness, not the model. For every task the
// stand-in makes the task's reference tool calls (none for a task where
// Pepper must ask or refuse), the harness confirms the cards as a person
// would, and the task's check must pass on the end state. Before the
// message, a change task's check must not already pass (an empty check would
// pass everything). And a wrong end state (the right tool with a wrong
// value) must fail.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { closeApp } = await import('./support/app.mjs')
const { loadTasks, runTask, runTasks } = await import('../eval/harness.mjs')

let tasks
test.before(async () => { tasks = await loadTasks() })
test.after(async () => { await claude.close(); await closeApp() })

/**
 * The stand-in's replies for one trial: the calls in one turn, the answers of
 * the tools' own model calls (a task's `readers`: make_rule's reader, as JSON),
 * then a line of text.
 */
function scriptFor(calls, closing = 'Done.', readers = []) {
  claude.script.length = 0
  if (calls.length) {
    claude.script.push(() => ({
      stop_reason: 'tool_use',
      content: calls.map((c, i) => ({ type: 'tool_use', id: 'toolu_eval_' + i, name: c.tool, input: c.input })),
    }))
  }
  for (const r of readers) {
    claude.script.push(body => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(typeof r === 'function' ? r(body) : r) }] }))
  }
  claude.script.push(() => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: closing }] }))
}

test('the set: at least 20 tasks over the areas Pepper\'s tools cover, some where nothing may change', () => {
  assert.ok(tasks.length >= 20, tasks.length + ' tasks')
  const areas = new Set(tasks.map(t => t.area))
  for (const a of ['bookings', 'safety', 'rota', 'cash', 'menus', 'purchasing', 'venue', 'customers', 'website']) assert.ok(areas.has(a), a)
  assert.ok(tasks.filter(t => t.expect === 'nothing').length >= 5, 'tasks where Pepper must ask or refuse')
  assert.ok(tasks.some(t => t.as === 'operator'), 'a task for someone without the permission')
  for (const t of tasks) assert.ok(t.why && t.why.length > 20, t.id + ' says where it comes from')
})

test('every task passes when the model makes its reference calls, and no change task passes before', { timeout: 20 * 60_000 }, async () => {
  const early = []
  const run = await runTasks(tasks, {
    async before(task, ctx) {
      if (['change', 'answer'].includes(task.expect) && (await task.check(ctx, { calls: [] })) === true) early.push(task.id)
      scriptFor(await task.reference(ctx), task.expect === 'nothing' ? 'What time, and for how many?' : 'Done.', task.readers ? task.readers(ctx) : [])
    },
  })
  assert.deepEqual(early, [], 'checks that already pass before anything is asked (or with no tool called)')
  const failed = run.results.filter(r => !r.pass).map(r => r.id + ': ' + r.reason + ' ' + JSON.stringify(r.cards))
  assert.deepEqual(failed, [])
  // Each change task's cards were confirmed and went through.
  for (const r of run.results.filter(x => x.expect === 'change')) {
    assert.ok(r.cards.length >= 1, r.id + ' made a card')
    assert.ok(r.cards.every(c => c.pressed === 'confirm' && c.status === 'done'), r.id + ' ' + JSON.stringify(r.cards))
  }
  // Usage from the trial's own model requests (migration 271).
  assert.equal(run.totals.trials, tasks.length)
  assert.ok(run.results.every(r => r.requests >= 1 && r.input_tokens > 0 && r.ms > 0))
  assert.ok(run.totals.cost_usd > 0)
})

test('a wrong end state fails: the right tool, the wrong party size', async () => {
  const task = tasks.find(t => t.id === 'book_table')
  const r = await runTask(task, {
    async before(t, ctx) {
      const [call] = await t.reference(ctx)
      scriptFor([{ ...call, input: { ...call.input, party_size: 2 } }])
    },
  })
  assert.equal(r.pass, false)
  assert.match(r.reason, /for 2, not 4/)
})

test('a "nothing" task fails when Pepper changes something anyway, and a cancelled card changes nothing', async () => {
  const task = tasks.find(t => t.id === 'ask_for_reading')
  const madeUp = await runTask(task, {
    async before(t, ctx) { scriptFor([{ tool: 'log_temperature', input: { venue_id: ctx.venue.id, fridge: 'Walk-in', temperature_c: 4 } }]) },
  })
  assert.equal(madeUp.pass, false, 'a made-up reading that a person confirmed')
  assert.match(madeUp.reason, /changed: fs_temp_logs/)
  const cancelled = await runTask({ ...task, cards: 'cancel' }, {
    async before(t, ctx) { scriptFor([{ tool: 'log_temperature', input: { venue_id: ctx.venue.id, fridge: 'Walk-in', temperature_c: 4 } }]) },
  })
  assert.equal(cancelled.pass, true)
  assert.equal(cancelled.cards[0].status, 'cancelled')
})

test('an answer task is graded by what the tools returned: the wrong figure, or a guess where nothing is covered, fails', async () => {
  const covers = tasks.find(t => t.id === 'covers_by_slang')
  const wrong = await runTask(covers, {
    async before(t, ctx) {
      const [find, ask] = await t.reference(ctx)
      scriptFor([find, { ...ask, input: { plan: { ...ask.input.plan, figures: [{ figure: 'net_sales' }] } } }])
    },
  })
  assert.equal(wrong.pass, false)
  assert.match(wrong.reason, /counted \["net_sales"\], not covers/)
  const none = tasks.find(t => t.id === 'not_in_reports')
  const guessed = await runTask(none, {
    async before(t, ctx) {
      scriptFor([...(await t.reference(ctx)), { tool: 'ask_data', input: { plan: { subject: 'till.checks', figures: [{ figure: 'net_sales' }] } } }])
    },
  })
  assert.equal(guessed.pass, false)
  assert.match(guessed.reason, /worked a figure out anyway: ask_data/)
})

test('baseline: with no message sent, change and answer tasks fail and nothing tasks pass', async () => {
  const pick = ['petty_cash', 'rota_question', 'not_in_reports'].map(id => tasks.find(t => t.id === id))
  const run = await runTasks(pick, { baseline: true })
  assert.deepEqual(run.results.map(r => [r.id, r.pass]), [['petty_cash', false], ['rota_question', true], ['not_in_reports', false]])
  assert.equal(run.totals.requests, 0, 'no model call')
})

// Pepper's model requests (migration 271): every model call addUsage()
// counts is also kept on its own in ai_requests (when, where, what for, the
// model, tokens, units, the estimated cost from the same PRICES as the
// units, how long it took), reported by pepper.requests, kept 90 days.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { as, ok, sql, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A } = await import('./support/seed.mjs')
const { runner, rowsOf } = await import('./support/reports.mjs')
const { addUsage, usageUnits, usageCost, USES } = await import('../src/ai/context.js')
const { cleanUpAi } = await import('../src/ai/erase.js')
const { USE_LABELS } = await import('../../shared/pepperActions.js')
const { CATALOGUE } = await import('../src/reports/catalogue/index.js')

let ids
const text = s => [{ type: 'text', text: s }]
const rows = () => sql`SELECT * FROM ai_requests WHERE tenant_id = ${ids.a} ORDER BY created_at, id`

test.before(async () => { ids = await resetAndSeed() })
test.after(async () => { await claude.close(); await closeApp() })

test('the cost and the units come from one price list', () => {
  const t = { input: 1_000_000, output: 100_000, cacheRead: 2_000_000, cacheWrite: 10_000, searches: 2 }
  // Sonnet 5.5: $2 in, $10 out, $0.10 cache read, $2.50 cache write per million; $10 per 1,000 searches.
  assert.equal(usageCost(t, 'claude-sonnet-5-5'), 2 + 1 + 0.2 + 0.025 + 0.02)
  assert.equal(usageUnits(t, 'claude-sonnet-5-5'), Math.round(usageCost(t, 'claude-sonnet-5-5') * 1e6 / 4))
  // A model with no price row counts at the default ratios.
  assert.equal(usageCost({ input: 1_000_000 }, 'claude-unknown'), 4)
  for (const u of USES) assert.ok(USE_LABELS[u], u + ' has words')
  assert.deepEqual(Object.keys(USE_LABELS).sort(), [...USES].sort())
})

test('a chat turn keeps one row per model call: where, what for, model, tokens, cost and time', async () => {
  const owner = as(A.owner, ids.a)
  claude.script.push(
    () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_r1', name: 'list_venues', input: {} }], usage: { input_tokens: 5000, output_tokens: 120, cache_read_input_tokens: 3000 } }),
    () => ({ stop_reason: 'end_turn', content: text('You have no venues yet.'), usage: { input_tokens: 400, output_tokens: 30, cache_creation_input_tokens: 800 } }),
  )
  await ok(owner.post('/api/ai/chat', { message: 'Which venues do we have?' }))
  const got = await rows()
  assert.equal(got.length, 2)
  const [a, b] = got
  assert.equal(a.channel, 'staff_chat')
  assert.equal(a.use, 'chat')
  assert.equal(a.model, claude.requests[0].body.model)
  assert.deepEqual([a.input_tokens, a.output_tokens, a.cache_read_tokens, a.cache_write_tokens], [5000, 120, 3000, 0])
  assert.equal(b.cache_write_tokens, 800)
  for (const r of got) {
    const t = { input: r.input_tokens, output: r.output_tokens, cacheRead: r.cache_read_tokens, cacheWrite: r.cache_write_tokens }
    assert.equal(Number(r.units), usageUnits(t, r.model))
    assert.equal(Number(r.cost_usd), usageCost(t, r.model))
    assert.ok(Number.isInteger(r.ms) && r.ms >= 0, 'timed')
  }
  // The month's totals are counted as before.
  const [month] = await sql`SELECT requests, input_tokens FROM ai_usage WHERE tenant_id = ${ids.a} AND channel = 'staff_chat'`
  assert.deepEqual([Number(month.requests), Number(month.input_tokens)], [2, 5400])
})

test('the menu search is kept as what it was for', async () => {
  claude.script.push(() => ({ stop_reason: 'end_turn', content: text(JSON.stringify({ picks: [], note: 'Nothing fits.' })), usage: { input_tokens: 2400, output_tokens: 90 } }))
  await ok(as(A.owner, ids.a).post('/api/ai/nav-search', { query: 'where do I change pay' }))
  const last = (await rows()).at(-1)
  assert.equal(last.use, 'nav_search')
  assert.ok(last.ms >= 0)
})

test('only model calls are kept: a connector call with no model, or a use not in the list', async () => {
  const before = (await rows()).length
  await addUsage(ids.a, 'staff_mcp')
  assert.equal((await rows()).length, before, 'no model, no row')
  await addUsage(ids.a, 'staff_chat', { model: 'claude-sonnet-5-5', input: 10, use: 'nonsense' })
  assert.equal((await rows()).at(-1).use, 'other')
})

test('pepper.requests: cost a request by model, for View on Pepper, with no person', async () => {
  const s = CATALOGUE.subjects['pepper.requests']
  assert.equal(s.module, 'ai_assistant')
  assert.equal(s.level, 'view')
  assert.ok(!Object.values(s.fields).some(f => /user|email|person/.test(f.sql)))
  await addUsage(ids.a, 'staff_chat', { model: 'claude-opus-5-5', input: 1_000_000, output: 0, use: 'smart_builder', ms: 4000 })
  const res = await runner(ids.a)({ subject: 'pepper.requests', kind: 'summary', rows: ['model'], values: ['requests', 'total_cost', 'cost_a_request', 'average_time'].map(measure => ({ measure })) })
  const opus = rowsOf(res).find(r => r.model === 'claude-opus-5-5')
  assert.equal(opus.requests, 1)
  assert.ok(Math.abs(opus.total_cost - 4) < 1e-6, 'a million tokens in on Opus 5.5 is $4')
  assert.ok(Math.abs(opus.cost_a_request - 4) < 1e-6)
  assert.ok(Math.abs(opus.average_time - 4) < 1e-6, 'seconds')
  const op = await as(A.operator, ids.a).post('/api/reports/starter:pepper_cost_by_model/run', {})
  assert.equal(op.status, 200, 'an operator (View on Pepper) can run the starter')
})

test('requests are kept 90 days', async () => {
  await sql`UPDATE ai_requests SET created_at = now() - interval '91 days' WHERE tenant_id = ${ids.a} AND use = 'smart_builder'`
  await cleanUpAi(null)
  const left = await rows()
  assert.ok(left.length > 0)
  assert.ok(!left.some(r => r.use === 'smart_builder'))
})

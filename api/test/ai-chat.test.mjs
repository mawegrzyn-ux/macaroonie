// Pepper's chat loop against a stand-in Claude (support/fake-claude.mjs):
// streamed turns, the JSON reply, refusals, errors, and model routing.
// Runs with routing on (AI_MODEL_FAST at its default).
import test from 'node:test'
import assert from 'node:assert/strict'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { as, getApp, sql, ok, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A } = await import('./support/seed.mjs')
const { env } = await import('../src/config/env.js')

const MAIN = env.AI_MODEL, FAST = env.AI_MODEL_FAST
const text = s => [{ type: 'text', text: s }]
const lastModel = () => claude.requests[claude.requests.length - 1].body.model
const tierOf = async id => (await sql`SELECT model_tier FROM ai_conversations WHERE id = ${id}`)[0]?.model_tier
let ids, owner, venue

function parseSse(body) {
  return body.split('\n\n').filter(Boolean).flatMap(chunk => {
    const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n')
    return data ? [JSON.parse(data)] : []
  })
}
async function streamChat(body, { url = '/api/ai/chat', sub = A.owner, tenant = ids.a } = {}) {
  const res = await as(sub, tenant).post(url, body, { accept: 'text/event-stream' })
  const type = String(res.headers['content-type'] || '')
  return { ...res, type, events: type.includes('event-stream') ? parseSse(res.body) : null }
}

test.before(async () => {
  assert.ok(FAST && FAST !== MAIN, 'routing must be on for these tests')
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  venue = await ok(owner.post('/api/venues', { name: 'Ware', slug: 'ware', timezone: 'Europe/London' }))
  await ok(owner.patch('/api/rota/settings', { mode: 'day_parts' }))
  await ok(owner.post('/api/rota/shifts', { name: 'Lunch', start_time: '11:00', end_time: '15:00', points: 1 }))
  await ok(owner.post(`/api/rota/venues/${venue.id}/staff`, { name: 'Jo Bloggs', pay_type: 'hourly', default_rate: 11.5 }))
})
test.after(async () => { await claude.close(); await closeApp() })

let conv1
test('a streamed turn: start, activity, text, step, card, done', async () => {
  claude.script.push(
    () => ({ stop_reason: 'tool_use', content: [{ type: 'thinking', signature: 's' }, { type: 'text', text: 'Checking Monday.' },
      { type: 'tool_use', id: 'toolu_1', name: 'whos_working', input: { venue: 'Ware', date: '2026-10-19' } }] }),
    () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_2', name: 'set_rota',
      input: { venue: 'Ware', changes: [{ person: 'Jo', date: '2026-10-20', shift: 'Lunch' }] } }] }),
    () => ({ stop_reason: 'end_turn', content: text('Press Confirm on the card.') }),
  )
  const s = await streamChat({ message: 'Who is on Monday? Put Jo on Tuesday lunch.' })
  assert.equal(s.status, 200)
  assert.match(s.type, /text\/event-stream/)
  assert.equal(s.headers['x-accel-buffering'], 'no')
  const types = s.events.map(e => e.type)
  assert.equal(types[0], 'start')
  assert.equal(types[types.length - 1], 'done')
  const acts = s.events.filter(e => e.type === 'activity').map(e => e.text)
  for (const a of ['Thinking...', 'Looking it up...', 'Getting a card ready...']) assert.ok(acts.includes(a), a)
  const streamed = s.events.filter(e => e.type === 'text').reduce((m, e) => { m[e.key] = (m[e.key] || '') + e.delta; return m }, {})
  assert.equal(streamed['0-1'], 'Checking Monday.')
  assert.ok(s.events.some(e => e.type === 'step' && e.text === 'Looked at who is working'))
  const card = s.events.find(e => e.type === 'card')?.card
  assert.equal(card?.tool, 'set_rota')
  const done = s.events[s.events.length - 1]
  assert.equal(done.notice, null)
  assert.ok(done.items.some(i => i.type === 'action' && i.id === card.id))
  conv1 = s.events[0].conversation_id
  assert.ok(claude.requests.slice(-3).every(r => r.body.stream === true))
})

test('routing: a new chat runs on the everyday model, sent without server-side fallback', async () => {
  const reqs = claude.requests.slice(-3)
  assert.ok(reqs.every(r => r.body.model === FAST))
  assert.ok(reqs.every(r => r.body.fallbacks === undefined))
  assert.equal(await tierOf(conv1), 'fast')
})

test('without Accept: text/event-stream the reply is JSON, with stop_reason and notice', async () => {
  claude.script.push(() => ({ stop_reason: 'end_turn', content: text('Hello.') }))
  const r = await ok(owner.post('/api/ai/chat', { message: 'hi' }))
  assert.equal(r.stop_reason, 'end_turn')
  assert.equal(r.notice, null)
  assert.equal(r.items.length, 2)
})

test('a busy chat is a plain JSON 409, and the conversation says running', async () => {
  await sql`UPDATE ai_conversations SET running_until = now() + interval '1 minute' WHERE id = ${conv1}`
  const s = await streamChat({ conversation_id: conv1, message: 'another' })
  assert.equal(s.status, 409)
  assert.match(s.type, /json/)
  assert.equal((await ok(owner.get('/api/ai/conversations/' + conv1))).running, true)
  await sql`UPDATE ai_conversations SET running_until = NULL WHERE id = ${conv1}`
})

test('Claude overloaded after the stream started: an error event, the history kept', async () => {
  claude.script.push(
    () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_e1', name: 'whos_working', input: { venue: 'Ware', date: '2026-10-19' } }] }),
    ...[1, 2, 3].map(() => () => ({ status: 529, type: 'overloaded_error', message: 'Overloaded' })),
  )
  const s = await streamChat({ conversation_id: conv1, message: 'And Wednesday?' })
  const err = s.events[s.events.length - 1]
  assert.equal(err.type, 'error')
  assert.equal(err.status, 503)
  assert.equal(err.conversation_id, conv1)
  const rows = await sql`SELECT role, content FROM ai_messages WHERE conversation_id = ${conv1} ORDER BY seq`
  assert.equal(rows[rows.length - 1].content[0].type, 'tool_result')
})

test('Claude can\'t take the message: withdrawn', async () => {
  claude.script.push(() => ({ status: 400, message: 'bad message' }))
  const s = await streamChat({ conversation_id: conv1, message: 'Refused by Claude' })
  const err = s.events[s.events.length - 1]
  assert.equal(err.status, 422)
  assert.equal(err.withdrawn, true)
  const rows = await sql`SELECT content::text AS c FROM ai_messages WHERE conversation_id = ${conv1}`
  assert.ok(!rows.some(r => r.c.includes('Refused by Claude')))
})

test('a refusal on the everyday model: the main model takes the step, and the chat stays there', async () => {
  claude.script.push(() => ({ stop_reason: 'refusal', content: text('I can') }), () => ({ stop_reason: 'end_turn', content: text('Main model answer.') }))
  const s = await streamChat({ message: 'Something the everyday model declines' })
  const [r1, r2] = claude.requests.slice(-2)
  assert.equal(r1.body.model, FAST)
  assert.equal(r2.body.model, MAIN)
  assert.equal(r2.body.fallbacks, 'default')
  assert.ok(s.events.some(e => e.type === 'discard' && e.key === '0-'))
  const done = s.events[s.events.length - 1]
  assert.deepEqual(done.items.filter(i => i.type === 'assistant').map(i => i.text), ['Main model answer.'])
  assert.equal(await tierOf(done.conversation_id), 'main')
})

test('a message the main model refuses is left out of the chat; a new chat refused outright is removed', async () => {
  claude.script.push(() => ({ stop_reason: 'end_turn', content: text('Hi.') }))
  const chat = await ok(owner.post('/api/ai/chat', { message: 'hello' }))
  await sql`UPDATE ai_conversations SET model_tier = 'main' WHERE id = ${chat.conversation_id}`
  claude.script.push(() => ({ stop_reason: 'refusal', content: [] }))
  const r = await ok(owner.post('/api/ai/chat', { conversation_id: chat.conversation_id, message: 'Nobody answers this' }))
  assert.match(r.notice, /left that message out of the chat/)
  assert.ok(!r.items.some(i => i.text === 'Nobody answers this'))
  claude.script.push(() => ({ stop_reason: 'refusal', content: [] }), () => ({ stop_reason: 'refusal', content: [] }))
  const before = (await sql`SELECT count(*)::int AS n FROM ai_conversations`)[0].n
  const gone = await ok(owner.post('/api/ai/chat', { message: 'Refused from the start' }))
  assert.equal(gone.conversation_id, null)
  assert.equal((await sql`SELECT count(*)::int AS n FROM ai_conversations`)[0].n, before)
})

test('a file sends the chat to the main model from the first request', async () => {
  const [att] = await sql`INSERT INTO ai_attachments (tenant_id, user_sub, kind, media_type, filename, bytes, data)
    VALUES (${ids.a}, ${A.owner}, 'image', 'image/png', 'menu.png', 3, ${Buffer.from('abc')}) RETURNING id`
  claude.script.push(() => ({ stop_reason: 'end_turn', content: text('I see it.') }))
  const r = await ok(owner.post('/api/ai/chat', { message: 'What is on this?', attachments: [att.id] }))
  assert.equal(lastModel(), MAIN)
  assert.equal(await tierOf(r.conversation_id), 'main')
})

test('a big job on the everyday model is handed to the main model, which makes the card', async () => {
  const call = id => () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name: 'create_menu',
    input: { name: 'Lunch', sections: [{ section: 'Noodles', dishes: [{ name: 'Pad Thai', price: 12.5 }] }] } }] })
  claude.script.push(call('toolu_h1'), call('toolu_h2'), () => ({ stop_reason: 'end_turn', content: text('Ready to confirm.') }))
  const r = await ok(owner.post('/api/ai/chat', { message: 'Make a lunch menu' }))
  assert.deepEqual(claude.requests.slice(-3).map(q => q.body.model), [FAST, MAIN, MAIN])
  const handed = claude.requests[claude.requests.length - 2].body.messages.at(-1).content[0]
  assert.equal(handed.tool_use_id, 'toolu_h1')
  assert.equal(handed.is_error, true)
  const cards = await sql`SELECT tool_use_id FROM ai_pending_actions WHERE conversation_id = ${r.conversation_id}`
  assert.deepEqual(cards.map(c => c.tool_use_id), ['toolu_h2'])
})

test('a long chat moves to the main model for the steps after the long request', async () => {
  claude.script.push(
    () => ({ stop_reason: 'tool_use', usage: { input_tokens: 5000, cache_read_input_tokens: 60000 }, content: [{ type: 'tool_use', id: 'toolu_l1', name: 'whos_working', input: { venue: 'Ware', date: '2026-10-19' } }] }),
    () => ({ stop_reason: 'end_turn', content: text('Nobody.') }),
  )
  const r = await ok(owner.post('/api/ai/chat', { message: 'Who is on Monday?' }))
  assert.deepEqual(claude.requests.slice(-2).map(q => q.body.model), [FAST, MAIN])
  assert.equal(await tierOf(r.conversation_id), 'main')
})

test('usage is priced by the model that answered', async () => {
  const [u] = await sql`SELECT units FROM ai_usage WHERE tenant_id = ${ids.a} AND channel = 'staff_chat'`
  assert.ok(Number(u.units) > 0)
})

test('the website chat streams, and its start event carries the guest key', async () => {
  await ok(owner.patch('/api/ai/settings', { guest_chat_enabled: true }))
  claude.script.push(() => ({ stop_reason: 'end_turn', content: text('Open from noon.') }))
  const s = await streamChat({ tenant_id: ids.a, message: 'When are you open?' }, { url: '/ai-api/chat', sub: null, tenant: null })
  assert.equal(s.events[0].type, 'start')
  assert.ok(s.events[0].guest_key.length >= 40)
  const done = s.events[s.events.length - 1]
  assert.equal(done.guest_key, s.events[0].guest_key)
  assert.equal(lastModel(), FAST)
})

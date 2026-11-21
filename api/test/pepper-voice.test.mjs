// Voice for Pepper (migration 261, OUTSTANDING 44 item 12): a turn said aloud
// carries the spoken-answer note to the model (hidden in the chat); a spoken
// yes confirms only check cards and only when the group allows it; the
// switch is in Pepper's settings and its status.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { as, ok, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A } = await import('./support/seed.mjs')
const { fillTenant } = await import('./support/fixtures.mjs')
const { VOICE_CONFIRM_TOOLS } = await import('../src/ai/chat.js')

let ids, owner, V
const text = s => [{ type: 'text', text: s }]
const lastUserText = () => {
  const msgs = claude.requests[claude.requests.length - 1].body.messages
  const last = msgs[msgs.length - 1]
  return (Array.isArray(last.content) ? last.content : [{ type: 'text', text: last.content }])
    .filter(b => b.type === 'text').map(b => b.text).join('\n')
}

test.before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
})
test.after(async () => { await claude.close(); await closeApp() })

test('only checks can be confirmed by voice', () => {
  assert.deepEqual([...VOICE_CONFIRM_TOOLS].sort(), ['log_cooking_check', 'log_hold_check', 'log_temperature', 'tick_checklist'])
})

test('a turn said aloud tells the model to answer briefly; the note isn\'t shown', async () => {
  claude.script.push(() => ({ stop_reason: 'end_turn', content: text('Two people are on tonight.') }))
  const r = await ok(owner.post('/api/ai/chat', { message: 'who is on tonight', voice: true }))
  assert.match(lastUserText(), /Said aloud in talk mode/)
  assert.ok(!r.items.some(i => /Said aloud/.test(i.text || '')), 'not shown in the chat')
  claude.script.push(() => ({ stop_reason: 'end_turn', content: text('Fine.') }))
  await ok(owner.post('/api/ai/chat', { conversation_id: r.conversation_id, message: 'thanks' }))
  assert.doesNotMatch(lastUserText(), /Said aloud in talk mode/, 'a typed message gets no note')
})

async function cardFor(tool, input) {
  claude.script.push(
    () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_v' + Math.random().toString(36).slice(2, 8), name: tool, input }] }),
    () => ({ stop_reason: 'end_turn', content: text('Say yes to save it.') }),
  )
  const r = await ok(owner.post('/api/ai/chat', { message: 'log it', voice: true }))
  const card = r.items.find(i => i.type === 'action' && i.status === 'pending')
  assert.ok(card, 'a card for ' + tool)
  return card
}

test('a spoken yes: refused while the group has it off, then confirms a check', async () => {
  const status = await ok(owner.get('/api/ai/status'))
  assert.equal(status.voice_confirm, false, 'off until switched on')
  const card = await cardFor('log_temperature', { venue_id: V, fridge: 'Walk-in', check_time: 'Morning', temperature_c: 3.5 })
  assert.equal(card.voice_ok, true)
  const off = await owner.post(`/api/ai/actions/${card.id}/confirm`, { via: 'voice' })
  assert.equal(off.status, 403)
  assert.match(off.json.error, /switched off/)

  await ok(owner.patch('/api/ai/settings', { voice_confirm: true }))
  assert.equal((await ok(owner.get('/api/ai/status'))).voice_confirm, true)
  const done = await ok(owner.post(`/api/ai/actions/${card.id}/confirm`, { via: 'voice' }))
  const after = done.items.find(i => i.id === card.id)
  assert.equal(after.status, 'done')
})

test('a spoken yes never confirms anything but a check', async () => {
  const venues = await ok(owner.get('/api/venues'))
  const card = await cardFor('close_dates', { venue: venues.find(v => v.id === V).name, name: 'Christmas', from: '2026-12-25' })
  assert.equal(card.voice_ok, false)
  const res = await owner.post(`/api/ai/actions/${card.id}/confirm`, { via: 'voice' })
  assert.equal(res.status, 422)
  assert.match(res.json.error, /Only checks/)
  // A tap still works.
  await ok(owner.post(`/api/ai/actions/${card.id}/cancel`, {}))
})

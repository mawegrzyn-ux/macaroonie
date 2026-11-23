// Pepper-first step 4 (reports/AI first back office strategy.md, "The Confirm
// card" and "For review"; docs/PEPPER_FIRST.md 13, decisions 4, 8 and 9):
//   4b  Confirm cards by class: before and after, fields changed on the card
//       (checked by the tool's own schema and describe() again), a typed word
//       for a destructive card, which a spoken yes never confirms
//   4c  a confirmed card does its work once, however often it is confirmed
//   4d  Undo on a reversible change, for UNDO_MINUTES, by its own person
//   4e  the Done by Pepper log: the person's own changes, everyone's for a
//       manager of Pepper, by venue and day
import test from 'node:test'
import assert from 'node:assert/strict'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { as, ok, closeApp, sql } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { fillTenant } = await import('./support/fixtures.mjs')
const { MONDAY } = await import('./support/fixtures/parts.mjs')
const { VOICE_CONFIRM_TOOLS } = await import('../src/ai/chat.js')
const { audienceTools } = await import('../src/ai/tools/index.js')

let ids, owner, V, venueName, bob
const text = s => [{ type: 'text', text: s }]

test.before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  venueName = (await ok(owner.get('/api/venues'))).find(v => v.id === V).name
  const day = await ok(owner.get(`/api/bookings?venue_id=${V}&date=${MONDAY}&limit=200`))
  bob = day.find(b => /Bob$/.test(b.guest_name))
  assert.ok(bob, 'the fixtures\' booking')
})
test.after(async () => { await claude.close(); await closeApp() })

/** A card for one tool call, made through the chat as `who` (a new chat). */
async function cardFor(tool, input, who = owner, extra = {}) {
  claude.script.push(
    () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_a' + Math.random().toString(36).slice(2, 10), name: tool, input }] }),
    () => ({ stop_reason: 'end_turn', content: text('Check the card.') }),
  )
  const r = await ok(who.post('/api/ai/chat', { message: 'do it', ...extra }))
  const card = r.items.find(i => i.type === 'action' && i.status === 'pending')
  assert.ok(card, 'a card for ' + tool + ': ' + JSON.stringify(r.items.filter(i => i.type !== 'user')))
  return { card, conversation: r.conversation_id }
}
/** A day some days ahead on which the fixtures' schedule is open. */
function ahead(days = 5) {
  const d = new Date(Date.now() + days * 86400000)
  while (['12-24', '12-25', '12-26', '01-01', '01-02'].includes(d.toISOString().slice(5, 10))) d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
const itemOf = (res, id) => res.items.find(i => i.type === 'action' && i.id === id)

/** A dish on the venue's live menus that isn't sold out (the fixtures mark Pad Thai sold out). */
async function liveDish() {
  const av = await ok(owner.get(`/api/orders/availability/${V}`))
  return av.menus.flatMap(m => m.sections.flatMap(s => s.items)).find(i => !i.sold_out && !i.sold_out_until)
}

// ── 4b: cards by class ───────────────────────────────────────────────

test('only reversible checks can ever be confirmed by voice', () => {
  const tools = audienceTools('staff')
  for (const name of VOICE_CONFIRM_TOOLS) assert.equal(tools.find(t => t.name === name).class, 'reversible', name)
})

test('a card says its class and shows the record before and after', async () => {
  const dish = await liveDish()
  assert.ok(dish, 'a live dish')
  const { card } = await cardFor('set_sold_out', { venue: venueName, dishes: [dish.name], sold_out: 'until_back' })
  assert.equal(card.class, 'reversible')
  assert.deepEqual(card.before, [dish.name + ': on'])
  assert.deepEqual(card.after, [dish.name + ': sold out until put back'])
  assert.equal(card.confirm_word, undefined, 'one tap: no word')
  await ok(owner.post(`/api/ai/actions/${card.id}/cancel`, {}))

  const move = (await cardFor('change_booking', { booking: bob.id, date: ahead(), time: '20:00' })).card
  assert.equal(move.class, 'consequential')
  assert.equal(move.before.length, 1)
  assert.match(move.after[0], /at 20:00, 2 people/)
  assert.deepEqual(move.fields.map(f => f.key), ['time', 'party_size'])
  await ok(owner.post(`/api/ai/actions/${move.id}/cancel`, {}))
})

test('fields changed on the card go through the tool\'s own schema and checks again', async () => {
  const { card } = await cardFor('add_booking_note', { booking: bob.id, note: 'Window table please' })
  assert.deepEqual(card.fields, [{ key: 'note', label: 'Note', kind: 'note', value: 'Window table please' }])
  // Only the tool's editable fields can change.
  const other = await owner.post(`/api/ai/actions/${card.id}/confirm`, { values: { booking: 'ABCDEFGH' } })
  assert.equal(other.status, 422)
  assert.match(other.json.error, /can't be changed on this card/)
  // An empty note fails the tool's schema (min 1): nothing is saved, the card waits.
  const empty = await owner.post(`/api/ai/actions/${card.id}/confirm`, { values: { note: '' } })
  assert.equal(empty.status, 400)
  assert.match(empty.json.error, /note/)
  const tooLong = await owner.post(`/api/ai/actions/${card.id}/confirm`, { values: { note: 'x'.repeat(501) } })
  assert.equal(tooLong.status, 400)
  const still = await ok(owner.get(`/api/bookings/${bob.id}`))
  assert.doesNotMatch(still.operator_notes || '', /Window|Corner/)
  // A good change: the new card is what runs, and the model hears what changed.
  const done = await ok(owner.post(`/api/ai/actions/${card.id}/confirm`, { values: { note: 'Corner table please' } }))
  const after = itemOf(done, card.id)
  assert.equal(after.status, 'done')
  assert.ok(after.lines.includes('Corner table please'), 'the card shows the edited note')
  assert.deepEqual(after.edited, ['note'])
  const notes = (await ok(owner.get(`/api/bookings/${bob.id}`))).operator_notes
  assert.match(notes, /Corner table please/)
  assert.doesNotMatch(notes, /Window table please/)
  const [{ content }] = await sql`SELECT content FROM ai_messages WHERE tenant_id = ${ids.a} AND content::text LIKE '%changed on the card%' ORDER BY created_at DESC LIMIT 1`
  assert.match(content[0].text, /changed on the card: note Corner table please/)
})

test('a number field is checked as a number, and a changed reading is the one logged', async () => {
  const { card } = await cardFor('add_expense', { venue: venueName, description: 'Milk', amount: 12.4 })
  assert.equal(card.class, 'consequential')
  assert.deepEqual(card.fields.map(f => f.key), ['description', 'amount'])
  const bad = await owner.post(`/api/ai/actions/${card.id}/confirm`, { values: { amount: 'twelve' } })
  assert.equal(bad.status, 400)
  const neg = await owner.post(`/api/ai/actions/${card.id}/confirm`, { values: { amount: -3 } })
  assert.equal(neg.status, 400)
  const done = itemOf(await ok(owner.post(`/api/ai/actions/${card.id}/confirm`, { values: { amount: 14.2 } })), card.id)
  assert.equal(done.status, 'done')
  assert.ok(done.lines.some(l => /14\.20/.test(l)), 'the card was described again: ' + done.lines.join(' | '))
})

test('a destructive card needs its word typed, and never a spoken yes', async () => {
  const { card } = await cardFor('update_guest_details', { booking: bob.id, guest_phone: '07700900999' })
  assert.equal(card.class, 'destructive')
  assert.equal(card.confirm_word, 'Bob', 'the guest\'s surname')
  assert.equal(card.voice_ok, false)
  assert.deepEqual(card.before, ['Phone: 07700900222'])
  assert.deepEqual(card.after, ['Phone: 07700900999'])
  // Voice: refused even with the group's spoken yes on.
  await ok(owner.patch('/api/ai/settings', { voice_confirm: true }))
  const voice = await owner.post(`/api/ai/actions/${card.id}/confirm`, { via: 'voice', word: 'Bob' })
  assert.equal(voice.status, 422)
  assert.match(voice.json.error, /never be confirmed by voice/)
  // No word, or the wrong one: nothing changes.
  for (const body of [{}, { word: 'CONFIRM' }, { word: 'Bo' }]) {
    const res = await owner.post(`/api/ai/actions/${card.id}/confirm`, body)
    assert.equal(res.status, 422, JSON.stringify(body))
    assert.match(res.json.error, /Type Bob/)
  }
  assert.equal((await ok(owner.get(`/api/bookings/${bob.id}`))).guest_phone, '07700900222')
  // The word, in any case and with spaces round it.
  const done = itemOf(await ok(owner.post(`/api/ai/actions/${card.id}/confirm`, { word: ' bob ' })), card.id)
  assert.equal(done.status, 'done')
  assert.equal((await ok(owner.get(`/api/bookings/${bob.id}`))).guest_phone, '07700900999')
  await ok(owner.patch('/api/ai/settings', { voice_confirm: false }))
})

test('a destructive card with no name to type asks for CONFIRM; a dish change with allergens is destructive', async () => {
  const menus = await ok(owner.get('/api/menus'))
  const menu = menus.find(m => /Lunch/.test(m.name))
  const plain = (await cardFor('update_dish', { menu: menu.name, dish: 'Green Curry', price: 14 })).card
  assert.equal(plain.class, 'consequential')
  await ok(owner.post(`/api/ai/actions/${plain.id}/cancel`, {}))
  const { card } = await cardFor('update_dish', { menu: menu.name, dish: 'Green Curry', add_allergens: ['Peanuts'] })
  assert.equal(card.class, 'destructive')
  assert.equal(card.confirm_word, 'CONFIRM')
  assert.equal((await owner.post(`/api/ai/actions/${card.id}/confirm`, {})).status, 422)
  assert.equal(itemOf(await ok(owner.post(`/api/ai/actions/${card.id}/confirm`, { word: 'confirm' })), card.id).status, 'done')
})

// ── 4c: one card, one write ──────────────────────────────────────────

const eventsCalled = async title => (await sql`SELECT count(*)::int AS n FROM local_info_items WHERE tenant_id = ${ids.a} AND title = ${title}`)[0].n
const auditRows = async cardId => sql`SELECT * FROM ai_actions WHERE tenant_id = ${ids.a} AND action_id = ${cardId}`
// The notes the model reads about a card (the card's title holds the event's own title).
const notesFor = async (conversation, title) => (await sql`
  SELECT count(*)::int AS n FROM ai_messages
   WHERE conversation_id = ${conversation} AND content::text LIKE '%pressed Confirm on%' AND content::text LIKE ${'%' + title + '%'}`)[0].n

test('a card confirmed twice does its work once and answers with the first outcome', async () => {
  const title = 'Farmers market ' + Math.random().toString(36).slice(2, 6)
  const { card, conversation } = await cardFor('add_local_event', { venue: venueName, title, starts_on: ahead(9) })
  const first = itemOf(await ok(owner.post(`/api/ai/actions/${card.id}/confirm`, {})), card.id)
  assert.equal(first.status, 'done')
  // A retried request (the reply was lost): the same card, nothing new.
  const again = await ok(owner.post(`/api/ai/actions/${card.id}/confirm`, {}))
  const second = itemOf(again, card.id)
  assert.deepEqual({ status: second.status, result: second.result }, { status: first.status, result: first.result })
  assert.equal(await eventsCalled(title), 1, 'one event')
  const rows = await auditRows(card.id)
  assert.equal(rows.length, 1, 'one audit row for the card')
  assert.equal(rows[0].user_sub, A.owner)
  assert.equal(rows[0].venue_id, V, 'the venue it worked at')
  assert.equal(rows[0].ok, true)
  assert.equal(await notesFor(conversation, title), 1, 'the model hears it once')
})

test('two presses at once (two tabs, a double tap): one write, both answered with it', async () => {
  const title = 'Street fair ' + Math.random().toString(36).slice(2, 6)
  const { card, conversation } = await cardFor('add_local_event', { venue: venueName, title, starts_on: ahead(10) })
  const [a, b] = await Promise.all([
    owner.post(`/api/ai/actions/${card.id}/confirm`, {}),
    owner.post(`/api/ai/actions/${card.id}/confirm`, {}),
  ])
  assert.deepEqual([a.status, b.status], [200, 200], JSON.stringify([a.json, b.json]))
  assert.equal(itemOf(a.json, card.id).status, 'done')
  assert.equal(itemOf(b.json, card.id).status, 'done')
  assert.equal(itemOf(a.json, card.id).result, itemOf(b.json, card.id).result)
  assert.equal(await eventsCalled(title), 1, 'one event')
  assert.equal((await auditRows(card.id)).length, 1)
  assert.equal(await notesFor(conversation, title), 1)
})

test('a card that failed answers a second press with its failure, without running again', async () => {
  const title = 'Parade ' + Math.random().toString(36).slice(2, 6)
  const { card } = await cardFor('add_local_event', { venue: venueName, title, starts_on: ahead(11) })
  // The venue goes before Confirm: the tool fails when it runs.
  await sql`UPDATE ai_pending_actions SET input = input || ${sql.json({ venue: 'No such venue' })} WHERE id = ${card.id}`
  const failed = itemOf(await ok(owner.post(`/api/ai/actions/${card.id}/confirm`, {})), card.id)
  assert.equal(failed.status, 'failed')
  const again = itemOf(await ok(owner.post(`/api/ai/actions/${card.id}/confirm`, {})), card.id)
  assert.equal(again.status, 'failed')
  assert.equal(again.error, failed.error)
  assert.equal(await eventsCalled(title), 0)
  // A cancelled card stays cancelled.
  const other = (await cardFor('add_local_event', { venue: venueName, title: title + ' 2', starts_on: ahead(11) })).card
  await ok(owner.post(`/api/ai/actions/${other.id}/cancel`, {}))
  const late = await owner.post(`/api/ai/actions/${other.id}/confirm`, {})
  assert.equal(late.status, 409)
  assert.equal(await eventsCalled(title + ' 2'), 0)
})

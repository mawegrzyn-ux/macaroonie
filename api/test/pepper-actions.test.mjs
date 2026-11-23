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

// ── 4d: Undo ────────────────────────────────────────────────────────

const dishState = async id => {
  const av = await ok(owner.get(`/api/orders/availability/${V}`))
  const i = av.menus.flatMap(m => m.sections.flatMap(s => s.items)).find(x => x.id === id)
  return i.sold_out || i.sold_out_until ? 'sold out' : 'on'
}

test('a reversible change offers Undo for 10 minutes; Undo puts it back, once, and is recorded', async () => {
  const { UNDO_MINUTES } = await import('../src/ai/chat.js')
  assert.equal(UNDO_MINUTES, 10)
  const dish = await liveDish()
  const { card, conversation } = await cardFor('set_sold_out', { venue: venueName, dishes: [dish.name], sold_out: 'until_back' })
  assert.equal(card.undo_until, null, 'nothing to undo before it runs')
  const done = itemOf(await ok(owner.post(`/api/ai/actions/${card.id}/confirm`, {})), card.id)
  assert.equal(done.status, 'done')
  assert.equal(await dishState(dish.id), 'sold out')
  const left = new Date(done.undo_until).getTime() - Date.now()
  assert.ok(left > 9 * 60_000 && left <= 10 * 60_000, 'about 10 minutes: ' + left)
  // The undo data never reaches the model.
  const [{ n: leaked }] = await sql`SELECT count(*)::int AS n FROM ai_messages WHERE conversation_id = ${conversation} AND content::text LIKE '%_undo%'`
  assert.equal(leaked, 0)

  const undone = itemOf(await ok(owner.post(`/api/ai/actions/${card.id}/undo`, {})), card.id)
  assert.equal(undone.status, 'undone')
  assert.equal(undone.undo_until, null)
  assert.equal(await dishState(dish.id), 'on', 'back on')
  const [row] = await sql`SELECT * FROM ai_actions WHERE tenant_id = ${ids.a} AND undo_of = ${card.id}`
  assert.equal(row.ok, true)
  assert.equal(row.user_sub, A.owner)
  assert.equal(row.venue_id, V)
  const [{ n: notes }] = await sql`SELECT count(*)::int AS n FROM ai_messages WHERE conversation_id = ${conversation} AND content::text LIKE '%pressed Undo on%'`
  assert.equal(notes, 1, 'the model is told')
  // Pressed again: the same card, and nothing runs again.
  await ok(owner.post(`/api/ai/actions/${card.id}/undo`, {}))
  const [{ n: rows }] = await sql`SELECT count(*)::int AS n FROM ai_actions WHERE tenant_id = ${ids.a} AND undo_of = ${card.id}`
  assert.equal(rows, 1)
})

test('Undo closes after 10 minutes, and only a reversible change has it', async () => {
  const dish = await liveDish()
  const { card } = await cardFor('set_sold_out', { venue: venueName, dishes: [dish.name], sold_out: 'today' })
  await ok(owner.post(`/api/ai/actions/${card.id}/confirm`, {}))
  await sql`UPDATE ai_pending_actions SET decided_at = now() - interval '11 minutes' WHERE id = ${card.id}`
  const conv = await sql`SELECT conversation_id FROM ai_pending_actions WHERE id = ${card.id}`
  const view = (await ok(owner.get('/api/ai/conversations/' + conv[0].conversation_id))).items.find(i => i.id === card.id)
  assert.equal(view.undo_until, null, 'no Undo shown')
  const late = await owner.post(`/api/ai/actions/${card.id}/undo`, {})
  assert.equal(late.status, 410)
  assert.match(late.json.error, /10 minutes/)
  assert.equal(await dishState(dish.id), 'sold out', 'still sold out')
  await ok(owner.put(`/api/orders/availability/${V}/${dish.id}`, { sold_out: false }))
  // A consequential change (an expense: money) never offers Undo.
  const exp = (await cardFor('add_expense', { venue: venueName, description: 'Bread', amount: 3 })).card
  const spent = itemOf(await ok(owner.post(`/api/ai/actions/${exp.id}/confirm`, {})), exp.id)
  assert.equal(spent.status, 'done')
  assert.equal(spent.undo_until, null)
  const no = await owner.post(`/api/ai/actions/${exp.id}/undo`, {})
  assert.equal(no.status, 422)
})

test('someone else\'s change can\'t be undone, nor another group\'s', async () => {
  const title = 'Food festival ' + Math.random().toString(36).slice(2, 6)
  const { card } = await cardFor('add_local_event', { venue: venueName, title, starts_on: ahead(12) })
  assert.equal(itemOf(await ok(owner.post(`/api/ai/actions/${card.id}/confirm`, {})), card.id).status, 'done')
  assert.equal(await eventsCalled(title), 1)
  const admin = await as(A.admin, ids.a).post(`/api/ai/actions/${card.id}/undo`, {})
  assert.equal(admin.status, 404, 'another person\'s card is not found')
  const other = await as(B.owner, ids.b).post(`/api/ai/actions/${card.id}/undo`, {})
  assert.equal(other.status, 404, 'another group\'s card is not found')
  assert.equal(await eventsCalled(title), 1, 'still there')
  // Its own person: the entry comes off the calendar.
  assert.equal(itemOf(await ok(owner.post(`/api/ai/actions/${card.id}/undo`, {})), card.id).status, 'undone')
  assert.equal(await eventsCalled(title), 0)
})

test('Undo puts a pause, a banner and a checklist back as they were; a failed Undo leaves the change', async () => {
  // Online orders: paused, then Undo starts them again.
  const pause = (await cardFor('pause_online_orders', { venue: venueName, paused: true })).card
  assert.deepEqual([pause.before, pause.after], [['Taking online orders'], ['Online orders paused']])
  await ok(owner.post(`/api/ai/actions/${pause.id}/confirm`, {}))
  const paused = async () => (await sql`SELECT is_paused FROM ordering_settings WHERE venue_id = ${V}`)[0]?.is_paused
  assert.equal(await paused(), true)
  await ok(owner.post(`/api/ai/actions/${pause.id}/undo`, {}))
  assert.equal(await paused(), false)

  // The website banner: its words and switch as they were.
  const site = () => ok(owner.get('/api/website/tenant-site'))
  const was = await site()
  const banner = (await cardFor('set_website_banner', { on: true, text: 'Closed today: power cut' })).card
  await ok(owner.post(`/api/ai/actions/${banner.id}/confirm`, {}))
  assert.equal((await site()).banner_text, 'Closed today: power cut')
  await ok(owner.post(`/api/ai/actions/${banner.id}/undo`, {}))
  const back = await site()
  assert.deepEqual([back.banner_enabled, back.banner_text ?? null], [was.banner_enabled, was.banner_text ?? null])

  // A checklist's ticks: the tasks it ticked are unticked again.
  const listed = await ok(owner.get(`/api/checklists/templates?venue_id=${V}`))
  const template = (Array.isArray(listed) ? listed : listed.templates || []).find(t => /Opening$/.test(t.name))
  assert.ok(template, 'the fixtures\' checklist')
  {
    const { card: tick } = await cardFor('tick_checklist', { checklist_id: template.id, all: true })
    const ticked = itemOf(await ok(owner.post(`/api/ai/actions/${tick.id}/confirm`, {})), tick.id)
    assert.equal(ticked.status, 'done')
    assert.ok(ticked.undo_until)
    const undone = itemOf(await ok(owner.post(`/api/ai/actions/${tick.id}/undo`, {})), tick.id)
    assert.equal(undone.status, 'undone', JSON.stringify(undone))
  }

  // An Undo that fails (the entry is already gone) says why and leaves the card done.
  const title = 'Night market ' + Math.random().toString(36).slice(2, 6)
  const ev = (await cardFor('add_local_event', { venue: venueName, title, starts_on: ahead(13) })).card
  await ok(owner.post(`/api/ai/actions/${ev.id}/confirm`, {}))
  await sql`DELETE FROM local_info_items WHERE tenant_id = ${ids.a} AND title = ${title}`
  const failed = itemOf(await ok(owner.post(`/api/ai/actions/${ev.id}/undo`, {})), ev.id)
  assert.equal(failed.status, 'done')
  assert.match(failed.undo_error, /not found/i)
  const [r] = await sql`SELECT ok FROM ai_actions WHERE tenant_id = ${ids.a} AND undo_of = ${ev.id}`
  assert.equal(r.ok, false)
})

test('the stock of a supplier\'s price goes back to how it was on Undo', async () => {
  const [q] = await sql`
    SELECT q.id, i.name FROM inv_quotes q JOIN inv_items i ON i.id = q.item_id
     WHERE q.tenant_id = ${ids.a} AND q.out_of_stock_until IS NULL ORDER BY i.name LIMIT 1`
  assert.ok(q, 'a supplier price from the fixtures')
  const { card } = await cardFor('set_out_of_stock', { item: q.name, quote_id: q.id, until: ahead(20) })
  assert.equal(card.class, 'reversible')
  await ok(owner.post(`/api/ai/actions/${card.id}/confirm`, {}))
  const until = async () => (await sql`SELECT out_of_stock_until FROM inv_quotes WHERE id = ${q.id}`)[0].out_of_stock_until
  assert.ok(await until())
  assert.equal(itemOf(await ok(owner.post(`/api/ai/actions/${card.id}/undo`, {})), card.id).status, 'undone')
  assert.equal(await until(), null)
})

// ── 4e: Done by Pepper ───────────────────────────────────────────────

/** The venue-local day a row was written on (so the check holds at midnight). */
async function dayOf(auditId) {
  const [r] = await sql`SELECT a.created_at, v.timezone FROM ai_actions a JOIN venues v ON v.id = ${V} WHERE a.id = ${auditId}`
  return new Intl.DateTimeFormat('en-CA', { timeZone: r.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(r.created_at)
}

test('Done by Pepper lists the person\'s own changes by venue and day, with Undo while it is open', async () => {
  const dish = await liveDish()
  const { card } = await cardFor('set_sold_out', { venue: venueName, dishes: [dish.name], sold_out: 'today' })
  await ok(owner.post(`/api/ai/actions/${card.id}/confirm`, {}))
  const [row] = await auditRows(card.id)
  const day = await dayOf(row.id)
  const res = await ok(owner.get(`/api/ai/done?venue_id=${V}&day=${day}`))
  assert.equal(res.who, 'mine')
  assert.equal(res.can_see_all, true)
  const mine = res.rows.find(r => r.id === row.id)
  assert.ok(mine, 'the change is listed')
  assert.deepEqual(
    { label: mine.label, class: mine.class, mine: mine.mine, venue: mine.venue, ok: mine.ok, who: mine.who },
    { label: 'Changed sold out dishes', class: 'reversible', mine: true, venue: venueName, ok: true, who: null })
  assert.equal(mine.title, card.title)
  assert.deepEqual(mine.before, card.before)
  assert.deepEqual(mine.after, card.after)
  assert.equal(mine.card_id, card.id, 'Undo is offered')
  assert.ok(new Date(mine.undo_until) > new Date())
  assert.ok(res.rows.every(r => r.mine), 'only the person\'s own')
  // An earlier Undo shows as its own row, and the change it undid says Undone.
  const undid = res.rows.find(r => r.undo && /^Undid: /.test(r.label))
  assert.ok(undid, 'an Undo row')
  assert.ok(res.rows.some(r => r.undone), 'an undone change')
  // Undo from the log is the card's own Undo.
  await ok(owner.post(`/api/ai/actions/${mine.card_id}/undo`, {}))
  const after = (await ok(owner.get(`/api/ai/done?venue_id=${V}&day=${day}`))).rows.find(r => r.id === row.id)
  assert.deepEqual([after.undone, after.card_id, after.undo_until], [true, null, null])
  // Another day or another venue: not listed.
  const before = new Date(day + 'T12:00:00Z'); before.setUTCDate(before.getUTCDate() - 1)
  assert.ok(!(await ok(owner.get(`/api/ai/done?venue_id=${V}&day=${before.toISOString().slice(0, 10)}`))).rows.some(r => r.id === row.id))
  const venue2 = (await ok(owner.get('/api/venues'))).find(v => v.id !== V)
  if (venue2) assert.ok(!(await ok(owner.get(`/api/ai/done?venue_id=${venue2.id}`))).rows.some(r => r.id === row.id))
  // A consequential change has no Undo here either.
  const exp = (await ok(owner.get('/api/ai/done?who=mine'))).rows.find(r => r.tool === 'add_expense')
  assert.ok(exp)
  assert.deepEqual([exp.class, exp.card_id, exp.undo_until], ['consequential', null, null])
})

test('everyone\'s changes need Manage on Pepper; no ranking; other groups see nothing of them', async () => {
  // A change another person made (written as the audit writes it).
  await sql`INSERT INTO ai_actions (tenant_id, channel, actor, tool, input, ok, result, user_sub, venue_id)
            VALUES (${ids.a}, 'staff_chat', 'operator@a.test', 'log_temperature', ${sql.json({})}, true, ${sql.json({ message: 'Logged.' })}, ${A.operator}, ${V})`
  const operator = as(A.operator, ids.a)
  const own = await ok(operator.get('/api/ai/done'))
  assert.equal(own.can_see_all, false)
  assert.ok(own.rows.length >= 1 && own.rows.every(r => r.tool === 'log_temperature' && r.mine), 'only their own')
  const refused = await operator.get('/api/ai/done?who=all')
  assert.equal(refused.status, 403)
  // A manager sees everyone's, each with who did it; the reply holds rows, not counts per person.
  const all = await ok(owner.get('/api/ai/done?who=all'))
  const theirs = all.rows.find(r => r.tool === 'log_temperature' && !r.mine)
  assert.ok(theirs)
  assert.equal(theirs.who, 'operator@a.test')
  assert.equal(theirs.card_id, null, 'nobody undoes another person\'s change')
  assert.deepEqual(Object.keys(all).sort(), ['can_see_all', 'rows', 'who'])
  // No access to Pepper: nothing.
  assert.equal((await as(A.viewer, ids.a).get('/api/ai/done')).status, 403)
  // Another group: none of A's rows, and A's venue isn't found.
  const b = as(B.owner, ids.b)
  const bRows = await ok(b.get('/api/ai/done?who=all'))
  const aIds = new Set((await sql`SELECT id FROM ai_actions WHERE tenant_id = ${ids.a}`).map(r => r.id))
  assert.ok(bRows.rows.every(r => !aIds.has(r.id)))
  assert.equal((await b.get(`/api/ai/done?venue_id=${V}`)).status, 404)
  assert.equal((await owner.get('/api/ai/done?day=2026-02-31')).status, 422)
})

test('migration 277 puts Done by Pepper after Pepper in existing menus, once', async () => {
  const fs = await import('node:fs')
  const SQL = fs.readFileSync(new URL('../../migrations/277_pepper_done_menu.sql', import.meta.url), 'utf8')
  await sql`DELETE FROM nav_items WHERE tenant_id = ${ids.a} AND route = '/pepper/done'`
  const [ai] = await sql`SELECT parent_id, sort_order, hidden_role_ids FROM nav_items WHERE tenant_id = ${ids.a} AND route = '/ai'`
  assert.ok(ai, 'the Pepper link')
  await sql.unsafe(SQL)
  await sql.unsafe(SQL)
  const links = await sql`SELECT parent_id, sort_order, module, hidden_role_ids FROM nav_items WHERE tenant_id = ${ids.a} AND route = '/pepper/done'`
  assert.equal(links.length, 1, 'once')
  assert.equal(links[0].parent_id, ai.parent_id)
  assert.equal(links[0].sort_order, ai.sort_order + 1, 'straight after Pepper')
  assert.equal(links[0].module, 'ai_assistant')
  const siblings = await sql`SELECT route, sort_order FROM nav_items WHERE tenant_id = ${ids.a} AND parent_id IS NOT DISTINCT FROM ${ai.parent_id} ORDER BY sort_order`
  assert.equal(new Set(siblings.map(s => s.sort_order)).size, siblings.length, 'no two links share a place')
})

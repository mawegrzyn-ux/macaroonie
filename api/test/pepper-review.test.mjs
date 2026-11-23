// For review (Pepper-first step 5c; reports/AI first back office strategy.md
// "For review"): a Confirm card left unanswered waits WAIT_DAYS instead of
// vanishing after 30 minutes, and is approved later through its own Confirm
// (the typed word for a destructive one); supplier orders waiting for the
// person's approval and invoices read for a delivery not booked in are listed
// beside them; each part needs its own module.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { as, ok, closeApp, sql } = await import('./support/app.mjs')
const { resetAndSeed, A } = await import('./support/seed.mjs')
const { fillTenant } = await import('./support/fixtures.mjs')
const { MONDAY } = await import('./support/fixtures/parts.mjs')
const { WAIT_DAYS } = await import('../src/ai/chat.js')

let ids, owner, operator, viewer, V, venueName, bob
const text = s => [{ type: 'text', text: s }]

test.before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  V = filled.ids.venue
  venueName = (await ok(owner.get('/api/venues'))).find(v => v.id === V).name
  const day = await ok(owner.get(`/api/bookings?venue_id=${V}&date=${MONDAY}&limit=200`))
  bob = day.find(b => /Bob$/.test(b.guest_name))
})
test.after(async () => { await claude.close(); await closeApp() })

async function cardFor(tool, input, who = owner) {
  claude.script.push(
    () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_r' + Math.random().toString(36).slice(2, 10), name: tool, input }] }),
    () => ({ stop_reason: 'end_turn', content: text('Check the card.') }),
  )
  const r = await ok(who.post('/api/ai/chat', { message: 'do it' }))
  const card = r.items.find(i => i.type === 'action' && i.status === 'pending')
  assert.ok(card, 'a card for ' + tool)
  return card
}
const waiting = (who = owner) => ok(who.get('/api/ai/review'))
const liveDish = async () => (await ok(owner.get(`/api/orders/availability/${V}`)))
  .menus.flatMap(m => m.sections.flatMap(s => s.items)).find(i => !i.sold_out && !i.sold_out_until)

test('an unanswered card waits days, not 30 minutes, and is approved later through its own Confirm', async () => {
  const dish = await liveDish()
  const card = await cardFor('set_sold_out', { venue: venueName, dishes: [dish.name], sold_out: 'today' })
  const [row] = await sql`SELECT expires_at FROM ai_pending_actions WHERE id = ${card.id}`
  const days = (new Date(row.expires_at).getTime() - Date.now()) / 86400000
  assert.ok(days > WAIT_DAYS - 0.1 && days <= WAIT_DAYS, 'waits ' + WAIT_DAYS + ' days')
  // The model is told how long it waits.
  const told = claude.requests.at(-1).body.messages.flatMap(m => Array.isArray(m.content) ? m.content : []).find(b => b.type === 'tool_result')
  assert.match(told.content[0].text, new RegExp('valid for ' + WAIT_DAYS + ' days'))
  // Two days on (the card made then): still waiting, and approved from For review.
  await sql`UPDATE ai_pending_actions SET created_at = now() - interval '2 days', expires_at = expires_at - interval '2 days' WHERE id = ${card.id}`
  const list = await waiting()
  const item = list.items.find(i => i.kind === 'card' && i.id === card.id)
  assert.ok(item, 'listed')
  assert.equal(item.class, 'reversible')
  assert.equal(item.together, true, 'reversible: can be approved with others of its kind')
  assert.match(item.source, /Proposed by/)
  assert.equal((await ok(owner.get('/api/ai/review?count=1'))).count, list.count)
  const done = await ok(owner.post(`/api/ai/actions/${card.id}/confirm`, {}))
  assert.equal(done.items.find(i => i.type === 'action' && i.id === card.id).status, 'done')
  assert.ok(!(await waiting()).items.some(i => i.id === card.id), 'gone once answered')
  const av = await ok(owner.get(`/api/orders/availability/${V}`))
  assert.ok(av.menus.flatMap(m => m.sections.flatMap(s => s.items)).find(i => i.id === dish.id).sold_out_until, 'the change made')
})

test('a destructive card waits with its word; a card past its time is gone; another person sees only their own', async () => {
  const card = await cardFor('update_guest_details', { booking: bob.id, guest_phone: '07700900111' })
  const item = (await waiting()).items.find(i => i.id === card.id)
  assert.equal(item.class, 'destructive')
  assert.equal(item.confirm_word, 'Bob')
  assert.equal(item.together, false, 'never approved with others')
  assert.equal((await owner.post(`/api/ai/actions/${card.id}/confirm`, {})).status, 422, 'the word is still needed')
  assert.ok(!(await waiting(operator)).items.some(i => i.id === card.id), 'not another person\'s')
  // Rejected: Cancel, as on the card.
  await ok(owner.post(`/api/ai/actions/${card.id}/cancel`, {}))
  assert.ok(!(await waiting()).items.some(i => i.id === card.id))
  // Past its wait: off the list, and Confirm says so.
  const dish = await liveDish()
  const old = await cardFor('set_sold_out', { venue: venueName, dishes: [dish.name], sold_out: 'today' })
  await sql`UPDATE ai_pending_actions SET expires_at = now() - interval '1 minute' WHERE id = ${old.id}`
  assert.ok(!(await waiting()).items.some(i => i.id === old.id))
  assert.equal((await owner.post(`/api/ai/actions/${old.id}/confirm`, {})).status, 410)
})

test('supplier orders waiting for approval and invoices read for a delivery not booked in', async () => {
  const list = await waiting()
  const order = list.items.find(i => i.kind === 'supplier_order')
  assert.ok(order, 'the fixtures\' requested order')
  assert.match(order.open, /^\/purchasing\?order=/)
  assert.equal(order.can_reject, true)
  // An invoice Pepper read for a sent order, not applied yet.
  const [po] = await sql`SELECT id FROM purchase_orders WHERE tenant_id = ${ids.a} AND status IN ('to_send', 'sent') LIMIT 1`
  assert.ok(po, 'an order still to come')
  const [inv] = await sql`INSERT INTO purchase_invoices (tenant_id, po_id, supplier_name, invoice_number, lines, read_by)
                          VALUES (${ids.a}, ${po.id}, 'Test', 'INV-77', ${sql.json([{ description: 'Rice' }])}, 'owner') RETURNING id`
  const again = await waiting()
  const invoice = again.items.find(i => i.kind === 'invoice' && i.id === inv.id)
  assert.ok(invoice, 'listed')
  assert.equal(invoice.open, '/purchasing?po=' + po.id)
  assert.match(invoice.lines[0], /1 line read/)
  await sql`UPDATE purchase_invoices SET applied_at = now() WHERE id = ${inv.id}`
  assert.ok(!(await waiting()).items.some(i => i.id === inv.id), 'booked in: gone')
  // Send the order back with a note (Reject), through its own route.
  await ok(owner.post(`/api/purchasing/orders/${order.id}/return`, { note: 'Too much rice' }))
  assert.ok(!(await waiting()).items.some(i => i.id === order.id))
  // A viewer: no approvals, no invoices.
  const v = await waiting(viewer)
  assert.ok(v.not_included.includes('supplier_orders'))
  assert.ok(v.not_included.includes('invoices'))
  assert.ok(!v.items.some(i => i.kind !== 'card'))
})

test('migration 279 puts For review after Pepper in existing menus, once', async () => {
  const fs = await import('node:fs')
  const SQL = fs.readFileSync(new URL('../../migrations/279_pepper_review_menu.sql', import.meta.url), 'utf8')
  await sql`DELETE FROM nav_items WHERE tenant_id = ${ids.a} AND route = '/review'`
  const [ai] = await sql`SELECT parent_id, sort_order FROM nav_items WHERE tenant_id = ${ids.a} AND route = '/ai'`
  assert.ok(ai, 'the Pepper link')
  await sql.unsafe(SQL)
  await sql.unsafe(SQL)
  const links = await sql`SELECT parent_id, sort_order, module FROM nav_items WHERE tenant_id = ${ids.a} AND route = '/review'`
  assert.equal(links.length, 1, 'once')
  assert.equal(links[0].sort_order, ai.sort_order + 1, 'straight after Pepper')
  assert.equal(links[0].module, 'ai_assistant')
  const siblings = await sql`SELECT sort_order FROM nav_items WHERE tenant_id = ${ids.a} AND parent_id IS NOT DISTINCT FROM ${ai.parent_id}`
  assert.equal(new Set(siblings.map(s => s.sort_order)).size, siblings.length, 'no two links share a place')
})

// Stock phase 4a (inventory, migrations 305 to 307, 27 Nov 2026): the
// ledger and on hand from counts, deliveries and adjustments; storage areas
// and key-item lists; stocktakes as documents (draft, submitted, approved,
// cancelled) with lines typed in several units and written one at a time;
// full counts confirming zeros, key counts leaving the rest alone; approval
// (Manage, the second person setting); blind counts; old counts as approved
// full counts (migration 306); two people counting one count; Today's
// tasks; Pepper's count_stock with areas and units and stock_moves; the
// report subjects; cross-tenant ids and View / Use / Manage. Review fixes:
// Today's count day cleared only by the venue's kind of count, blind counts
// on Pepper's card, a reversal dated with what it reverses (a count between
// keeps its figure), a later approved count warned of, a delivery's price
// only with purchasing prices, the shared tablet's PIN person as who
// counted, and items stock recorded switched off rather than deleted.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const { as, ok, sql, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')

let ids, owner, admin, operator, viewer, bOwner, V, VB, sup, chicken, chickenQuote, rice, bItem, bArea, walkIn, dry, list

const DAY = 86400000
const ago = days => new Date(Date.now() - days * DAY).toISOString()
const venueRow = items => Object.fromEntries(items.map(i => [i.name, i]))

test.before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  admin = as(A.admin, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  bOwner = as(B.owner, ids.b)
  V = (await ok(owner.post('/api/venues', { name: 'Larder', slug: 'larder', timezone: 'Europe/London', currency: 'GBP' }))).id
  VB = (await ok(bOwner.post('/api/venues', { name: 'Away', slug: 'away-stock', timezone: 'Europe/London' }))).id
  sup = await ok(owner.post('/api/suppliers', { name: 'Poultry Co', send_method: 'print' }))
  chicken = await ok(owner.post('/api/inventory/items', { name: 'Chicken thighs', base_unit: 'g', code: 'CHK-1' }))
  await ok(owner.post(`/api/inventory/items/${chicken.id}/units`, { name: 'tray', base_qty: 2500 }))
  // A case of 4 x 2.5 kg at £40 (£0.004 a gram).
  chickenQuote = (await ok(owner.post(`/api/inventory/items/${chicken.id}/quotes`, { supplier_id: sup.id, pack_name: 'Case', pack_count: 4, pack_qty: 2.5, pack_unit: 'kg', price: 40 }))).quotes[0]
  rice = await ok(owner.post('/api/inventory/items', { name: 'Jasmine rice', base_unit: 'g' }))
  bItem = await ok(bOwner.post('/api/inventory/items', { name: 'B flour', base_unit: 'g' }))
  bArea = await ok(bOwner.post(`/api/stock/venues/${VB}/areas`, { name: 'B shelf' }))
  await ok(owner.put('/api/purchasing/settings', { receive_without_order: 'anyone' }))
})
test.after(async () => { await closeApp() })

test('the shared rules: moves to on hand and a running balance, units on a line, the review, approval', async () => {
  const { stockOnHand, runningBalance, countUnits, entriesToBase, countReview, notCounted, approvalProblem, countDueOn } = await import('../../shared/stock.js')
  const moves = [
    { kind: 'delivery', qty_base: 10000, at: '2026-11-01T09:00:00Z' },
    { kind: 'count', qty_base: 8000, at: '2026-11-02T22:00:00Z' },
    { kind: 'adjustment', qty_base: -500, at: '2026-11-03T10:00:00Z' },
    { kind: 'delivery', qty_base: 10000, at: '2026-11-04T09:00:00Z' },
  ]
  assert.equal(stockOnHand({ moves }).on_hand, 17500)
  assert.equal(stockOnHand({ moves, at: '2026-11-03T12:00:00Z' }).on_hand, 7500, 'as it stood at a moment')
  assert.deepEqual(runningBalance(moves).map(m => [m.change, m.balance]), [[10000, null], [null, 8000], [-500, 7500], [10000, 17500]])
  const units = countUnits({ base_unit: 'g', units: [{ name: 'tray', base_qty: 2500 }] }, [{ id: 'q1', pack_name: 'Case', pack_count: 4, pack_qty: 2.5, pack_unit: 'kg', pack_base_qty: 10000 }])
  const r = entriesToBase([{ qty: 2, unit: 'pack:q1' }, { qty: 3, unit: 'tray' }, { qty: 400, unit: 'g' }], units, { name: 'Chicken' })
  assert.equal(r.qty_base, 27900, '2 cases + 3 trays + 400 g')
  assert.equal(entriesToBase([{ qty: 1, unit: 'case' }], units).qty_base, 10000, 'a pack by its name')
  assert.match(entriesToBase([{ qty: 1, unit: 'slice' }], units, { name: 'Chicken' }).problem, /Chicken has no size for a slice/)
  const review = countReview([{ item_id: 'a', qty_base: 100 }, { item_id: 'a', qty_base: 50 }, { item_id: 'b', qty_base: 10 }], { expected: { a: 200, b: 10 }, cost: { a: 0.5 } })
  assert.deepEqual(review.rows.find(x => x.item_id === 'a'), { item_id: 'a', counted: 150, expected: 200, diff: -50, value: -25 })
  assert.deepEqual(review.totals, { gain: 0, loss: -25, net: -25, valued: 1, unvalued: 0 }, 'b matches what was expected: nothing to value')
  assert.deepEqual(notCounted(['a', 'b', 'c'], [{ item_id: 'a' }]), ['b', 'c'])
  const sub = { status: 'submitted', submitted_by: 'kim@x' }
  assert.equal(approvalProblem(sub, [{ counted_by: 'kim@x' }], 'kim@x', {}), null)
  assert.equal(approvalProblem(sub, [{ counted_by: 'lee@x' }], 'Kim@x', { second_person_approves: true }).code, 'second_person')
  assert.equal(approvalProblem(sub, [{ counted_by: 'lee@x' }], 'max@x', { second_person_approves: true }), null)
  assert.equal(countDueOn({ count_weekday: 1 }, 1), true)
  assert.equal(countDueOn({ count_weekday: null }, 1), false)
})

test('storage areas and key-item lists: set up by Manage, an item in two areas, drag order', async () => {
  walkIn = await ok(owner.post(`/api/stock/venues/${V}/areas`, { name: 'Walk-in' }))
  dry = await ok(owner.post(`/api/stock/venues/${V}/areas`, { name: 'Dry store' }))
  assert.equal((await owner.post(`/api/stock/venues/${V}/areas`, { name: 'walk-in ' })).status, 409, 'one name per venue')
  await ok(owner.put(`/api/stock/venues/${V}/areas/order`, { ids: [dry.id, walkIn.id] }))
  assert.equal((await owner.put(`/api/stock/venues/${V}/areas/order`, { ids: [dry.id] })).status, 422, 'every area, once')
  await ok(owner.put(`/api/stock/areas/${walkIn.id}/items`, { item_ids: [chicken.id] }))
  await ok(owner.put(`/api/stock/areas/${dry.id}/items`, { item_ids: [rice.id, chicken.id] }))
  const areas = await ok(viewer.get(`/api/stock/venues/${V}/areas`))
  assert.deepEqual(areas.map(a => [a.name, a.items.map(i => i.name)]), [['Dry store', ['Jasmine rice', 'Chicken thighs']], ['Walk-in', ['Chicken thighs']]])
  list = await ok(owner.post('/api/stock/key-lists', { name: 'Proteins', item_ids: [chicken.id] }))
  assert.deepEqual(list.items.map(i => i.name), ['Chicken thighs'])
  // Use and View can't set up.
  assert.equal((await operator.post(`/api/stock/venues/${V}/areas`, { name: 'Bar' })).status, 403)
  assert.equal((await operator.post('/api/stock/key-lists', { name: 'X', item_ids: [] })).status, 403)
  assert.equal((await viewer.put('/api/stock/settings', { second_person_approves: true, blind_count: true })).status, 403)
})

test('the ledger and on hand: a delivery, an approved count, an adjustment; a count waiting moves nothing', async () => {
  // A delivery of 2 cases (20 kg) at £40 a case, booked in without an order.
  await ok(owner.post(`/api/purchasing/venues/${V}/deliveries`, {
    supplier_id: sup.id, lines: [{ item_id: chicken.id, quote_id: chickenQuote.id, received_qty: 2 }],
    check: { packaging_ok: true, damage_ok: true, quality_ok: true, accepted: true },
  }))
  let st = venueRow((await ok(owner.get('/api/stock/venues/' + V))).items)
  assert.deepEqual([st['Chicken thighs'].on_hand, st['Chicken thighs'].received_since], [null, 20000], 'never counted: no figure yet')
  // A quick count by the operator (Use): submitted, not approved, so on hand stands.
  const waiting = await ok(operator.post(`/api/stock/venues/${V}/counts`, { lines: [{ item_id: chicken.id, entries: [{ qty: 7, unit: 'tray' }] }] }))
  assert.equal(waiting.status, 'submitted')
  st = venueRow((await ok(owner.get('/api/stock/venues/' + V))).items)
  assert.equal(st['Chicken thighs'].on_hand, null)
  assert.equal((await operator.post(`/api/stock/counts/${waiting.id}/approve`, {})).status, 403, 'approving is Manage')
  await ok(owner.post(`/api/stock/counts/${waiting.id}/approve`, {}))
  st = venueRow((await ok(owner.get('/api/stock/venues/' + V))).items)
  assert.equal(st['Chicken thighs'].on_hand, 17500, '7 trays of 2.5 kg')
  // An adjustment (Manage) with a reason, in the item's own unit.
  assert.equal((await operator.post(`/api/stock/venues/${V}/adjustments`, { item_id: chicken.id, qty: -1, unit: 'tray', reason: 'Dropped' })).status, 403)
  assert.equal((await owner.post(`/api/stock/venues/${V}/adjustments`, { item_id: chicken.id, qty: -1, unit: 'tray', reason: '' })).status, 400, 'a reason is needed')
  const adj = await ok(owner.post(`/api/stock/venues/${V}/adjustments`, { item_id: chicken.id, qty: -1, unit: 'tray', reason: 'Dropped a tray' }))
  assert.equal(adj.qty_base, -2500)
  st = venueRow((await ok(owner.get('/api/stock/venues/' + V))).items)
  assert.deepEqual([st['Chicken thighs'].on_hand, st['Chicken thighs'].adjusted_since], [15000, -2500])
  assert.ok(st['Chicken thighs'].value > 0, 'Costing view sees the stock value')
  // The item's ledger: every move with its change and the balance after it.
  const h = await ok(owner.get(`/api/stock/venues/${V}/items/${chicken.id}/moves`))
  assert.deepEqual(h.moves.map(m => [m.kind, m.change, m.balance]), [['adjustment', -2500, 15000], ['count', null, 17500], ['delivery', 20000, null]])
  assert.equal(h.moves.find(m => m.kind === 'delivery').value, 80, 'a delivery at the price paid')
  assert.equal(h.moves.find(m => m.kind === 'adjustment').value, -10, 'the rest at the average paid')
  // Without Costing view: the same quantities, no values.
  const vh = await ok(viewer.get(`/api/stock/venues/${V}/items/${chicken.id}/moves`))
  assert.deepEqual(vh.moves.map(m => m.balance), h.moves.map(m => m.balance))
  assert.ok(vh.moves.every(m => !('value' in m)) && !('value' in (await ok(viewer.get('/api/stock/venues/' + V))).items[0]))
  // A reversal puts it back, once.
  await ok(owner.post(`/api/stock/adjustments/${adj.id}/reverse`, {}))
  assert.equal((await owner.post(`/api/stock/adjustments/${adj.id}/reverse`, {})).status, 409)
  st = venueRow((await ok(owner.get('/api/stock/venues/' + V))).items)
  assert.equal(st['Chicken thighs'].on_hand, 17500)
})

test('a full count: area by area, several units on a line, what isn\'t counted confirmed as zero, the review, approval', async () => {
  const c = await ok(operator.post(`/api/stock/venues/${V}/counts`, { kind: 'full', note: 'Sunday close' }))
  assert.equal(c.status, 'draft')
  const again = await operator.post(`/api/stock/venues/${V}/counts`, { kind: 'full' })
  assert.equal(again.status, 409, 'one sheet a venue at a time')
  assert.equal(again.json.count_id, c.id)
  const sheet = await ok(operator.get('/api/stock/counts/' + c.id))
  assert.deepEqual(sheet.areas.map(a => a.name), ['Dry store', 'Walk-in'])
  assert.ok(sheet.items[chicken.id].units.some(u => u.label.startsWith('Case')), 'the item\'s supplier pack is a unit')
  assert.deepEqual([sheet.expected[chicken.id], sheet.expected[rice.id]], [17500, null], 'expected beside every line while counting (rice never counted)')
  // 1 case + 1 tray + 400 g in the walk-in, 1 tray in the dry store: the count adds them.
  const line = await ok(operator.put(`/api/stock/counts/${c.id}/lines`, {
    item_id: chicken.id, area_id: walkIn.id, entries: [{ qty: 1, unit: 'case' }, { qty: 1, unit: 'tray' }, { qty: 400, unit: 'g' }],
  }))
  assert.equal(line.line.qty_base, 12900)
  assert.deepEqual(line.line.entries.map(e => [e.qty, e.label]), [[1, 'Case · 4 × 2.5 kg'], [1, 'tray (2.5 kg)'], [400, 'g']], 'kept as typed')
  const second = await ok(operator.put(`/api/stock/counts/${c.id}/lines`, { item_id: chicken.id, area_id: dry.id, entries: [{ qty: 1, unit: 'tray' }] }))
  assert.equal(second.item_total, 15400)
  assert.equal((await operator.put(`/api/stock/counts/${c.id}/lines`, { item_id: chicken.id, area_id: dry.id, entries: [{ qty: 1, unit: 'slice' }] })).status, 422)
  await ok(operator.post(`/api/stock/counts/${c.id}/areas/${walkIn.id}`, { done: true }))
  // Rice wasn't counted: the submit names it; confirmed as zero it goes.
  const refused = await operator.post(`/api/stock/counts/${c.id}/submit`, {})
  assert.equal(refused.status, 422)
  assert.equal(refused.json.code, 'not_counted')
  assert.ok(refused.json.items.some(i => i.name === 'Jasmine rice'))
  const done = await ok(operator.post(`/api/stock/counts/${c.id}/submit`, { zero_item_ids: refused.json.items.map(i => i.id) }))
  assert.equal(done.status, 'submitted')
  assert.ok(done.areas.find(a => a.id === walkIn.id).done, 'the area\'s progress is kept')
  assert.equal(done.lines.find(l => l.item_id === rice.id).confirmed_zero, true)
  assert.equal((await operator.put(`/api/stock/counts/${c.id}/lines`, { item_id: chicken.id, area_id: null, entries: [{ qty: 1, unit: 'g' }] })).status, 409, 'lines are fixed once submitted')
  // The review: expected at the count's moment against counted, the value of the difference (Costing view).
  const review = await ok(owner.get('/api/stock/counts/' + c.id))
  const row = review.review.rows.find(r => r.item_id === chicken.id)
  assert.deepEqual([row.expected, row.counted, row.diff], [17500, 15400, -2100])
  assert.equal(row.value, -8.4, '2.1 kg at £0.004 a gram')
  assert.equal(review.review.totals.net, -8.4)
  const viewerReview = await ok(viewer.get('/api/stock/counts/' + c.id))
  assert.ok(!('value' in viewerReview.review.rows[0]) || viewerReview.review.rows[0].value === undefined, 'no values without Costing view')
  await ok(admin.post(`/api/stock/counts/${c.id}/approve`, {}))
  const st = venueRow((await ok(owner.get('/api/stock/venues/' + V))).items)
  assert.deepEqual([st['Chicken thighs'].on_hand, st['Jasmine rice'].on_hand], [15400, 0])
  // An approved count is replaced by a newer one, never changed or cancelled.
  assert.equal((await owner.post(`/api/stock/counts/${c.id}/cancel`, {})).status, 409)
})

test('a key-item count leaves every other item alone; reopening and cancelling', async () => {
  const c = await ok(operator.post(`/api/stock/venues/${V}/counts`, { kind: 'key', key_list_id: list.id }))
  assert.equal(c.key_list_name, 'Proteins')
  const sheet = await ok(operator.get('/api/stock/counts/' + c.id))
  assert.deepEqual(sheet.not_counted, [], 'a key count asks for no zeros')
  assert.deepEqual([...new Set(sheet.areas.flatMap(a => a.item_ids))], [chicken.id], 'only the list\'s items')
  await ok(operator.put(`/api/stock/counts/${c.id}/lines`, { item_id: chicken.id, area_id: null, entries: [{ qty: 4, unit: 'kg' }] }))
  await ok(operator.post(`/api/stock/counts/${c.id}/submit`, {}))
  // Sent back to counting (Manage), changed, submitted and approved.
  await ok(owner.post(`/api/stock/counts/${c.id}/reopen`, {}))
  await ok(operator.put(`/api/stock/counts/${c.id}/lines`, { item_id: chicken.id, area_id: null, entries: [{ qty: 5, unit: 'kg' }] }))
  await ok(operator.post(`/api/stock/counts/${c.id}/submit`, {}))
  await ok(owner.post(`/api/stock/counts/${c.id}/approve`, {}))
  const st = venueRow((await ok(owner.get('/api/stock/venues/' + V))).items)
  assert.deepEqual([st['Chicken thighs'].on_hand, st['Jasmine rice'].on_hand], [5000, 0], 'rice keeps its figure')
  // A draft is cancelled by whoever counts; a cancelled count moves nothing.
  const d = await ok(operator.post(`/api/stock/venues/${V}/counts`, { kind: 'full' }))
  await ok(operator.put(`/api/stock/counts/${d.id}/lines`, { item_id: rice.id, area_id: null, entries: [{ qty: 9, unit: 'kg' }] }))
  await ok(operator.post(`/api/stock/counts/${d.id}/cancel`, {}))
  assert.equal(venueRow((await ok(owner.get('/api/stock/venues/' + V))).items)['Jasmine rice'].on_hand, 0)
})

test('two people count two areas of one count at once; neither line is lost', async () => {
  const c = await ok(owner.post(`/api/stock/venues/${V}/counts`, { kind: 'key', key_list_id: list.id }))
  const [a, b] = await Promise.all([
    owner.put(`/api/stock/counts/${c.id}/lines`, { item_id: chicken.id, area_id: walkIn.id, entries: [{ qty: 2, unit: 'kg' }] }),
    operator.put(`/api/stock/counts/${c.id}/lines`, { item_id: chicken.id, area_id: dry.id, entries: [{ qty: 3, unit: 'kg' }] }),
    owner.post(`/api/stock/counts/${c.id}/areas/${walkIn.id}`, { done: true }),
    operator.post(`/api/stock/counts/${c.id}/areas/${dry.id}`, { done: true }),
  ])
  assert.deepEqual([a.status, b.status], [200, 200])
  const sheet = await ok(owner.get('/api/stock/counts/' + c.id))
  assert.deepEqual(sheet.lines.map(l => [l.area_id, l.qty_base, l.counted_by]).sort(), [
    [dry.id, 3000, A.operator + '@test.local'], [walkIn.id, 2000, A.owner + '@test.local'],
  ].sort())
  assert.deepEqual(Object.keys(sheet.areas_done).sort(), [walkIn.id, dry.id].sort(), 'both areas done')
  await ok(owner.post(`/api/stock/counts/${c.id}/cancel`, {}))
})

test('the second person setting and blind counts', async () => {
  await ok(owner.put('/api/stock/settings', { second_person_approves: true, blind_count: true }))
  const c = await ok(owner.post(`/api/stock/venues/${V}/counts`, { kind: 'key', key_list_id: list.id }))
  await ok(owner.put(`/api/stock/counts/${c.id}/lines`, { item_id: chicken.id, area_id: null, entries: [{ qty: 6, unit: 'kg' }] }))
  const blind = await ok(owner.get('/api/stock/counts/' + c.id))
  assert.equal(blind.blind, true)
  assert.deepEqual([blind.review, blind.expected], [null, null], 'nothing expected while counting blind')
  const submitted = await ok(owner.post(`/api/stock/counts/${c.id}/submit`, {}))
  assert.equal(submitted.review.rows[0].expected, 5000, 'expected shows once submitted')
  assert.equal(submitted.can_approve, false)
  const own = await owner.post(`/api/stock/counts/${c.id}/approve`, {})
  assert.equal(own.status, 403)
  assert.equal(own.json.code, 'second_person')
  await ok(admin.post(`/api/stock/counts/${c.id}/approve`, {}))
  // A quick count by a manager waits too, with the setting on.
  const quick = await ok(owner.post(`/api/stock/venues/${V}/counts`, { lines: [{ item_id: rice.id, qty: 1, unit: 'kg' }] }))
  assert.equal(quick.status, 'submitted')
  await ok(admin.post(`/api/stock/counts/${quick.id}/approve`, {}))
  await ok(owner.put('/api/stock/settings', { second_person_approves: false, blind_count: false }))
})

test('counts from before phase 4a become approved full counts (migration 306)', async () => {
  const text = fs.readFileSync(new URL('../../migrations/306_stock_counts.sql', import.meta.url), 'utf8')
  const part = text.slice(text.indexOf('ALTER TABLE stock_counts'), text.indexOf('-- Adjustments (6.4)'))
  // The migration's count changes run on copies of the old tables in a schema of their own.
  await sql.begin(async tx => {
    await tx`CREATE SCHEMA mig306`
    await tx.unsafe(`
      SET LOCAL search_path TO mig306;
      CREATE TABLE inv_items (id uuid PRIMARY KEY, tenant_id uuid, base_unit text);
      CREATE TABLE stock_key_lists (id uuid PRIMARY KEY);
      CREATE TABLE stock_areas (id uuid PRIMARY KEY);
      CREATE TABLE stock_counts (id uuid PRIMARY KEY, tenant_id uuid, venue_id uuid, counted_at timestamptz NOT NULL DEFAULT now(), counted_by text, note text, created_at timestamptz DEFAULT now());
      CREATE TABLE stock_count_lines (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, count_id uuid REFERENCES stock_counts(id), item_id uuid, qty_base numeric(16,4) NOT NULL, UNIQUE (count_id, item_id));
      INSERT INTO inv_items VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', 'g');
      INSERT INTO stock_counts (id, tenant_id, venue_id, counted_at, counted_by) VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', '2026-11-20T18:00:00Z', 'kim@test');
      INSERT INTO stock_count_lines (tenant_id, count_id, item_id, qty_base) VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 2500);
    `)
    await tx.unsafe('SET LOCAL search_path TO mig306;\n' + part)
    const [c] = await tx.unsafe('SELECT kind, status, approved_by, approved_at, submitted_by FROM mig306.stock_counts')
    assert.deepEqual([c.kind, c.status, c.approved_by, c.submitted_by], ['full', 'approved', 'kim@test', 'kim@test'])
    assert.equal(new Date(c.approved_at).toISOString(), '2026-11-20T18:00:00.000Z')
    const [l] = await tx.unsafe('SELECT entries, counted_by FROM mig306.stock_count_lines')
    assert.deepEqual([l.entries, l.counted_by], [[{ qty: 2500, unit: 'g', label: 'g', base_qty: 1 }], 'kim@test'])
    const [d] = await tx.unsafe("SELECT column_default FROM information_schema.columns WHERE table_schema = 'mig306' AND table_name = 'stock_counts' AND column_name = 'status'")
    assert.match(d.column_default, /draft/, 'new counts start as drafts')
    throw new Error('rollback')
  }).catch(err => { if (err.message !== 'rollback') throw err })
})

test('Today: a count due on the count day, and a count to approve for whoever may approve it', async () => {
  // 23 Nov 2026 is a Monday; the venue counts on Mondays.
  await ok(owner.put(`/api/stock/venues/${V}/settings`, { count_weekday: 1, count_kind: 'full', key_list_id: null }))
  assert.equal((await owner.put(`/api/stock/venues/${V}/settings`, { count_weekday: 1, count_kind: 'key', key_list_id: null })).status, 422)
  const feed = await ok(operator.get(`/api/ops/today?venue_id=${V}&date=2026-11-23&time=10:00`))
  const due = feed.tasks.find(t => t.kind === 'stock_count_due')
  assert.ok(due, feed.tasks.map(t => t.kind).join(', '))
  assert.equal(due.can_act, true, 'Use counts')
  assert.match(due.action.path, /^\/stock\?tab=counts&venue=/)
  assert.ok(!(await ok(operator.get(`/api/ops/today?venue_id=${V}&date=2026-11-24&time=10:00`))).tasks.some(t => t.kind === 'stock_count_due'), 'not on other days')
  // A submitted count: on the approver's feed, not the counter's.
  const c = await ok(operator.post(`/api/stock/venues/${V}/counts`, { lines: [{ item_id: rice.id, qty: 2, unit: 'kg' }] }))
  const mine = await ok(owner.get(`/api/ops/today?venue_id=${V}&date=2026-11-23&time=10:00`))
  assert.ok(mine.tasks.some(t => t.kind === 'stock_count_to_approve' && t.action.path.endsWith('count=' + c.id)))
  assert.ok(!(await ok(operator.get(`/api/ops/today?venue_id=${V}&date=2026-11-23&time=10:00`))).tasks.some(t => t.kind === 'stock_count_to_approve'))
  await ok(owner.post(`/api/stock/counts/${c.id}/approve`, {}))
  await ok(owner.put(`/api/stock/venues/${V}/settings`, { count_weekday: null, count_kind: 'full', key_list_id: null }))
})

test('Today: only the venue\'s own kind of count clears its count day, never a quick count of a few items', async () => {
  // A day ten days back, which no other count in this file is dated on (counts may be dated up to 14 days back).
  const at = ago(10)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at))
  const weekday = new Date(today + 'T12:00:00Z').getUTCDay()
  const due = async () => (await ok(operator.get(`/api/stock/venues/${V}/today?date=${today}`))).count_due
  await ok(owner.put(`/api/stock/venues/${V}/settings`, { count_weekday: weekday, count_kind: 'full', key_list_id: null }))
  assert.equal(await due(), true)
  // Pepper's count_stock and a quick count are a key count with no list: never the day's count.
  const quick = await ok(operator.post(`/api/stock/venues/${V}/counts`, { lines: [{ item_id: rice.id, qty: 1, unit: 'kg' }], counted_at: at }))
  assert.equal(quick.status, 'submitted')
  assert.equal(await due(), true, 'one item counted isn\'t the weekly full count')
  await ok(owner.put(`/api/stock/venues/${V}/settings`, { count_weekday: weekday, count_kind: 'key', key_list_id: list.id }))
  assert.equal(await due(), true, 'nor the key-item list\'s count')
  const k = await ok(operator.post(`/api/stock/venues/${V}/counts`, { kind: 'key', key_list_id: list.id, counted_at: at }))
  await ok(operator.put(`/api/stock/counts/${k.id}/lines`, { item_id: chicken.id, area_id: null, entries: [{ qty: 1, unit: 'kg' }] }))
  await ok(operator.post(`/api/stock/counts/${k.id}/submit`, {}))
  assert.equal(await due(), false, 'the list\'s own count, submitted, is the day\'s count')
  for (const id of [quick.id, k.id]) await ok(owner.post(`/api/stock/counts/${id}/cancel`, {}))
  assert.equal(await due(), true, 'a cancelled count isn\'t')
  await ok(owner.put(`/api/stock/venues/${V}/settings`, { count_weekday: null, count_kind: 'full', key_list_id: null }))
})

test('the report subjects: on hand, moves, counts, count lines with their value, adjustments; the starter', async () => {
  const run = spec => ok(owner.post('/api/reports/preview', { spec: { kind: 'list', ...spec } }))
  const onHand = await run({ subject: 'stock.on_hand', rows: ['item_name', 'on_hand', 'value'] })
  const tab = venueRow((await ok(owner.get('/api/stock/venues/' + V))).items)
  const byName = Object.fromEntries(onHand.rows.map(r => [r.cells[0], r.cells.slice(1)]))
  assert.equal(byName['Chicken thighs'][0], tab['Chicken thighs'].on_hand, 'the Stock tab\'s figure')
  const moves = await run({ subject: 'stock.moves', rows: ['item_name', 'kind', 'change', 'balance', 'value', 'paid'], params: [{ key: 'period', type: 'period', default: { relative: 'this_year' } }], filters: [{ field: 'date', op: 'in_period', param: 'period' }] })
  const delivery = moves.rows.find(r => r.cells[0] === 'Chicken thighs' && (r.cells[1] === 'Delivery' || r.cells[1] === 'delivery'))
  assert.ok(delivery, JSON.stringify(moves.rows.slice(0, 3)))
  assert.deepEqual(delivery.cells.slice(4), [null, 80], 'a delivery\'s money is Paid (its supplier\'s price), not Value')
  assert.ok(moves.rows.some(r => (r.cells[1] === 'Adjustment' || r.cells[1] === 'adjustment') && r.cells[4] != null && r.cells[5] == null), 'an adjustment\'s is Value')
  const lines = await run({ subject: 'stock.count_lines', rows: ['item_name', 'counted', 'expected', 'difference', 'value', 'latest'] })
  const full = lines.rows.find(r => r.cells[0] === 'Chicken thighs' && r.cells[1] === 15400)
  assert.deepEqual(full.cells.slice(1, 5), [15400, 17500, -2100, -8.4], 'the review\'s figures')
  const counts = await run({ subject: 'stock.counts', rows: ['kind', 'status', 'lines'] })
  assert.ok(counts.rows.some(r => r.cells[1] === 'Approved' || r.cells[1] === 'approved'))
  const adj = await run({ subject: 'stock.adjustments', rows: ['item_name', 'change', 'reason', 'reverses'] })
  assert.equal(adj.rows.length, 2, 'the adjustment and its reversal')
  // Without Costing view the values are left out.
  const vrun = await viewer.post('/api/reports/preview', { spec: { kind: 'list', subject: 'stock.count_lines', rows: ['item_name', 'value'] } })
  assert.ok(vrun.status >= 400 || !JSON.stringify(vrun.json.columns || []).includes('"value"'), vrun.body.slice(0, 200))
  const list = await ok(owner.get('/api/reports'))
  assert.ok(list.starters.some(s => s.id === 'starter:stock_last_count_differences' && s.runs), 'the starter is offered')
  const diffs = await ok(owner.post('/api/reports/starter:stock_last_count_differences/run', {}))
  assert.ok(diffs.rows.length >= 1, 'the latest count\'s differences')
})

test('cross-tenant: venue, item, area, key list, count, line and adjustment ids of another group are refused', async () => {
  const c = await ok(owner.post(`/api/stock/venues/${V}/counts`, { kind: 'full' }))
  await ok(owner.put(`/api/stock/counts/${c.id}/lines`, { item_id: chicken.id, area_id: walkIn.id, entries: [{ qty: 1, unit: 'kg' }] }))
  const [adj] = await ok(owner.get(`/api/stock/venues/${V}/adjustments`))
  const refusals = [
    await bOwner.get('/api/stock/venues/' + V),
    await bOwner.get(`/api/stock/venues/${V}/items/${chicken.id}/moves`),
    await bOwner.get(`/api/stock/venues/${VB}/items/${chicken.id}/moves`),
    await bOwner.post(`/api/stock/venues/${V}/counts`, { kind: 'full' }),
    await bOwner.get('/api/stock/counts/' + c.id),
    await bOwner.put(`/api/stock/counts/${c.id}/lines`, { item_id: bItem.id, area_id: null, entries: [{ qty: 1, unit: 'g' }] }),
    await bOwner.post(`/api/stock/counts/${c.id}/submit`, { all_zero: true }),
    await bOwner.post(`/api/stock/counts/${c.id}/cancel`, {}),
    await bOwner.post(`/api/stock/counts/${c.id}/areas/${walkIn.id}`, { done: true }),
    await bOwner.patch('/api/stock/areas/' + walkIn.id, { name: 'Mine' }),
    await bOwner.put(`/api/stock/areas/${walkIn.id}/items`, { item_ids: [] }),
    await bOwner.delete('/api/stock/areas/' + walkIn.id),
    await bOwner.put('/api/stock/key-lists/' + list.id, { name: 'Mine', item_ids: [] }),
    await bOwner.delete('/api/stock/key-lists/' + list.id),
    await bOwner.post(`/api/stock/venues/${VB}/counts`, { kind: 'key', key_list_id: list.id }),
    await bOwner.post(`/api/stock/adjustments/${adj.id}/reverse`, {}),
    await bOwner.post(`/api/stock/venues/${VB}/adjustments`, { item_id: chicken.id, qty: 1, unit: 'g', reason: 'x' }),
    await bOwner.put(`/api/stock/areas/${bArea.id}/items`, { item_ids: [chicken.id] }),
    await bOwner.put(`/api/stock/venues/${VB}/settings`, { count_weekday: 1, count_kind: 'key', key_list_id: list.id }),
  ]
  assert.deepEqual(refusals.map(r => r.status), refusals.map(() => 404), refusals.map(r => r.status + ' ' + r.body.slice(0, 80)).join(' | '))
  // B's own count can't take A's item or A's area.
  const bc = await ok(bOwner.post(`/api/stock/venues/${VB}/counts`, { kind: 'full' }))
  assert.equal((await bOwner.put(`/api/stock/counts/${bc.id}/lines`, { item_id: chicken.id, area_id: null, entries: [{ qty: 1, unit: 'g' }] })).status, 404)
  assert.equal((await bOwner.put(`/api/stock/counts/${bc.id}/lines`, { item_id: bItem.id, area_id: walkIn.id, entries: [{ qty: 1, unit: 'g' }] })).status, 404)
  assert.equal((await bOwner.post(`/api/stock/counts/${bc.id}/areas/${walkIn.id}`, { done: true })).status, 404)
  // A's own count can't take A's area of another venue's... (an area is the count's venue's).
  const V2 = (await ok(owner.post('/api/venues', { name: 'Second', slug: 'second-stock', timezone: 'Europe/London' }))).id
  const other = await ok(owner.post(`/api/stock/venues/${V2}/counts`, { kind: 'full' }))
  assert.equal((await owner.put(`/api/stock/counts/${other.id}/lines`, { item_id: chicken.id, area_id: walkIn.id, entries: [{ qty: 1, unit: 'g' }] })).status, 404)
  const [n] = await sql`SELECT count(*)::int AS n FROM stock_count_lines l JOIN stock_counts c ON c.id = l.count_id WHERE c.tenant_id = ${ids.a} AND l.item_id = ${bItem.id}`
  assert.equal(n.n, 0)
  await ok(owner.post(`/api/stock/counts/${c.id}/cancel`, {}))
  await ok(owner.post(`/api/stock/counts/${other.id}/cancel`, {}))
})

test('an area with lines in a count being taken can\'t go; a finished count keeps its lines', async () => {
  const bar = await ok(owner.post(`/api/stock/venues/${V}/areas`, { name: 'Bar' }))
  const c = await ok(owner.post(`/api/stock/venues/${V}/counts`, { kind: 'key', key_list_id: list.id }))
  await ok(owner.put(`/api/stock/counts/${c.id}/lines`, { item_id: chicken.id, area_id: bar.id, entries: [{ qty: 1, unit: 'kg' }] }))
  await ok(owner.put(`/api/stock/counts/${c.id}/lines`, { item_id: chicken.id, area_id: null, entries: [{ qty: 2, unit: 'kg' }] }))
  const busy = await owner.delete('/api/stock/areas/' + bar.id)
  assert.equal(busy.status, 409)
  assert.equal(busy.json.code, 'area_in_count')
  await ok(owner.post(`/api/stock/counts/${c.id}/submit`, {}))
  await ok(owner.post(`/api/stock/counts/${c.id}/approve`, {}))
  await ok(owner.delete('/api/stock/areas/' + bar.id))
  const after = await ok(owner.get('/api/stock/counts/' + c.id))
  assert.deepEqual(after.lines.map(l => [l.area_id, l.qty_base]), [[null, 3000]], 'its line joins the one counted outside an area')
  assert.equal(venueRow((await ok(owner.get('/api/stock/venues/' + V))).items)['Chicken thighs'].on_hand, 3000)
})

// ── Pepper ──

const quiet = { info() {}, warn() {}, error() {}, debug() {} }
async function pepper(sub, name, input, { run = true } = {}) {
  const { getApp } = await import('./support/app.mjs')
  const { makeContext } = await import('../src/ai/context.js')
  const { audienceTools, parseInput } = await import('../src/ai/tools/index.js')
  const app = await getApp()
  const ctx = makeContext({
    app, channel: 'staff_chat', tenantId: ids.a, log: quiet,
    auth: { authorization: 'Bearer test:' + sub }, principal: { sub, email: sub + '@test.local' }, actor: sub + '@test.local',
  })
  const tool = audienceTools('staff').find(t => t.name === name)
  assert.ok(tool, name)
  const parsed = parseInput(tool, input)
  const card = tool.describe ? await tool.describe(ctx, parsed) : null
  return { tool, card, out: run ? await tool.run(ctx, parsed) : null }
}

test('Pepper: count_stock in several units by area, waiting for approval from Use; stock_moves with the balance', async () => {
  const { tool, card } = await pepper(A.operator, 'count_stock', {
    venue: 'Larder', counts: [{ item: 'chicken', entries: [{ qty: 1, unit: 'case' }, { qty: 2, unit: 'tray' }], area: 'walk-in' }],
  }, { run: false })
  assert.equal(tool.class, 'consequential')
  assert.equal(tool.needs, 'use')
  assert.ok(card.lines.some(l => /^Chicken thighs: 1 Case · 4 × 2\.5 kg \+ 2 tray \(2\.5 kg\) = 15 kg in Walk-in \(was /.test(l)), card.lines.join(' | '))
  assert.equal(card.confirmLabel, 'Submit count', 'a Use count waits for approval')
  const { out } = await pepper(A.operator, 'count_stock', { venue: 'Larder', counts: [{ item: 'CHK-1', qty: 15, unit: 'kg', area: 'Walk-in' }] })
  assert.equal(out.status, 'submitted')
  assert.match(out.message, /waiting for someone who approves/)
  await assert.rejects(pepper(A.owner, 'count_stock', { venue: 'Larder', counts: [{ item: 'chicken', qty: 1, unit: 'slice' }] }), /no size for a slice/)
  await assert.rejects(pepper(A.owner, 'count_stock', { venue: 'Larder', counts: [{ item: 'chicken', qty: 1, area: 'Cellar' }] }), /storage area/)
  const moves = await pepper(A.viewer, 'stock_moves', { venue: 'Larder', item: 'chicken thighs', days: 30 })
  assert.equal(moves.tool.class, 'read')
  assert.equal(moves.out.item, 'Chicken thighs')
  assert.ok(moves.out.moves.some(m => /^Delivery/.test(m.what) && m.change === '+20 kg'), JSON.stringify(moves.out.moves.slice(-2)))
  assert.ok(moves.out.moves.every(m => !m.value), 'no values without Costing view')
  assert.doesNotMatch(JSON.stringify(moves.out), /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, 'names, never ids')
})

test('Pepper: with blind counts on, the count card shows no expected figure beside the counter\'s', async () => {
  await ok(owner.put('/api/stock/settings', { second_person_approves: false, blind_count: true }))
  const blind = await pepper(A.operator, 'count_stock', { venue: 'Larder', counts: [{ item: 'chicken', qty: 2, unit: 'kg' }] }, { run: false })
  assert.equal(blind.card.lines.length, 1)
  assert.doesNotMatch(blind.card.lines[0], /\(was /, blind.card.lines[0])
  await ok(owner.put('/api/stock/settings', { second_person_approves: false, blind_count: false }))
  const open = await pepper(A.operator, 'count_stock', { venue: 'Larder', counts: [{ item: 'chicken', qty: 2, unit: 'kg' }] }, { run: false })
  assert.match(open.card.lines[0], /\(was /, 'shown when counts aren\'t blind')
})

test('View, Use and Manage: who reads, counts, approves and sets up', async () => {
  const meta = async c => ok(c.get('/api/stock/meta'))
  const [o, op, v] = await Promise.all([meta(owner), meta(operator), meta(viewer)])
  assert.deepEqual([o.level, o.can_count, o.can_manage, o.sees_values], ['manage', true, true, true])
  assert.deepEqual([op.level, op.can_count, op.can_manage], ['use', true, false])
  assert.deepEqual([v.level, v.can_count, v.can_manage, v.sees_values], ['view', false, false, false])
  // A viewer reads everything (no values), changes nothing.
  for (const path of ['/api/stock/venues/' + V, `/api/stock/venues/${V}/counts`, `/api/stock/venues/${V}/areas`, '/api/stock/key-lists', '/api/stock/settings', `/api/stock/venues/${V}/adjustments`]) {
    assert.equal((await viewer.get(path)).status, 200, path)
  }
  assert.equal((await viewer.post(`/api/stock/venues/${V}/counts`, { kind: 'full' })).status, 403)
  // A draft opened by a viewer reads as not theirs to count (the sheet then shows it read only).
  const draft = await ok(operator.post(`/api/stock/venues/${V}/counts`, { kind: 'key', key_list_id: list.id }))
  assert.deepEqual([(await ok(viewer.get('/api/stock/counts/' + draft.id))).can_count, (await ok(operator.get('/api/stock/counts/' + draft.id))).can_count], [false, true])
  assert.equal((await viewer.put(`/api/stock/counts/${draft.id}/lines`, { item_id: chicken.id, area_id: null, entries: [{ qty: 1, unit: 'kg' }] })).status, 403)
  await ok(operator.post(`/api/stock/counts/${draft.id}/cancel`, {}))
  assert.equal((await viewer.post(`/api/stock/venues/${V}/counts`, { lines: [{ item_id: rice.id, qty: 1 }] })).status, 403)
  // A role with no stock level sees nothing.
  const [role] = await sql`INSERT INTO tenant_roles (tenant_id, key, label, permissions, is_builtin) VALUES (${ids.a}, 'no_stock', 'No stock', ${sql.json({ purchasing: 'manage' })}, false) RETURNING id`
  await sql`UPDATE users SET custom_role_id = ${role.id} WHERE auth0_user_id = ${A.viewer} AND tenant_id = ${ids.a}`
  assert.equal((await viewer.get('/api/stock/venues/' + V)).status, 403)
  await sql`UPDATE users SET custom_role_id = NULL WHERE auth0_user_id = ${A.viewer} AND tenant_id = ${ids.a}`
})

test('a reversal is dated at the adjustment it reverses: a count since keeps what it found', async () => {
  const beef = await ok(owner.post('/api/inventory/items', { name: 'Beef mince', base_unit: 'g' }))
  const onHand = async () => venueRow((await ok(owner.get('/api/stock/venues/' + V))).items)['Beef mince'].on_hand
  await ok(owner.post(`/api/stock/venues/${V}/counts`, { lines: [{ item_id: beef.id, qty: 20, unit: 'kg' }], counted_at: ago(3) }))
  // 2.5 kg taken off by mistake, then a count finds what is really there (17.5 kg): the count takes the mistake in.
  const adj = await ok(owner.post(`/api/stock/venues/${V}/adjustments`, { item_id: beef.id, qty: -2500, unit: 'g', reason: 'Typed against the wrong item', adjusted_at: ago(2) }))
  const later = await ok(owner.post(`/api/stock/venues/${V}/counts`, { lines: [{ item_id: beef.id, qty: 17500, unit: 'g' }], counted_at: ago(1) }))
  assert.equal(later.status, 'approved')
  assert.equal(await onHand(), 17500)
  const rev = await ok(owner.post(`/api/stock/adjustments/${adj.id}/reverse`, {}))
  assert.equal(new Date(rev.adjusted_at).toISOString(), new Date(adj.adjusted_at).toISOString(), 'dated with what it reverses')
  assert.ok(new Date(rev.created_at) > new Date(adj.adjusted_at), 'and says when it was done')
  assert.equal(await onHand(), 17500, 'the count since keeps its figure (dated now, the reversal read 20 kg)')
  const h = await ok(owner.get(`/api/stock/venues/${V}/items/${beef.id}/moves`))
  assert.deepEqual(h.moves.map(m => [m.kind, m.change, m.balance]), [
    ['count', -2500, 17500], ['adjustment', 2500, 20000], ['adjustment', -2500, 17500], ['count', null, 20000],
  ], 'the pair cancels out before the count, which then shows the 2.5 kg as missing')
  // A count dated before an approved one says so: what the later one counted keeps its figures.
  const early = await ok(operator.post(`/api/stock/venues/${V}/counts`, { lines: [{ item_id: beef.id, qty: 1, unit: 'kg' }], counted_at: ago(1.5) }))
  const view = await ok(owner.get('/api/stock/counts/' + early.id))
  assert.ok(view.later_count && new Date(view.later_count.counted_at) >= new Date(later.counted_at), JSON.stringify(view.later_count))
  assert.equal((await ok(owner.get('/api/stock/counts/' + later.id))).later_count, null, 'an approved count isn\'t warned about')
  await ok(owner.post(`/api/stock/counts/${early.id}/cancel`, {}))
})

test('a delivery\'s value is its supplier\'s price: Costing view without purchasing prices sees the averages only', async () => {
  const [role] = await sql`INSERT INTO tenant_roles (tenant_id, key, label, permissions, is_builtin)
    VALUES (${ids.a}, 'costs_no_prices', 'Costs, no prices', ${sql.json({ stock: 'view', costing: 'view', reports: 'use' })}, false) RETURNING id`
  await sql`UPDATE users SET custom_role_id = ${role.id} WHERE auth0_user_id = ${A.viewer} AND tenant_id = ${ids.a}`
  try {
    const meta = await ok(viewer.get('/api/stock/meta'))
    assert.deepEqual([meta.sees_values, meta.sees_prices], [true, false])
    const h = await ok(viewer.get(`/api/stock/venues/${V}/items/${chicken.id}/moves`))
    const delivery = h.moves.find(m => m.kind === 'delivery')
    assert.deepEqual([delivery.cost_per_base, delivery.value], [null, null], 'no supplier price, no line total')
    assert.equal(delivery.change, 20000, 'the quantity still shows')
    assert.ok(h.moves.some(m => m.kind !== 'delivery' && m.value != null), 'counts and adjustments keep their value at the average paid')
    assert.equal((await ok(owner.get(`/api/stock/venues/${V}/items/${chicken.id}/moves`))).moves.find(m => m.kind === 'delivery').value, 80, 'with purchasing prices')
    const period = { params: [{ key: 'period', type: 'period', default: { relative: 'this_year' } }], filters: [{ field: 'date', op: 'in_period', param: 'period' }] }
    const paid = await ok(viewer.post('/api/reports/preview', { spec: { kind: 'list', subject: 'stock.moves', rows: ['item_name', 'kind', 'paid'], ...period } }))
    assert.match(JSON.stringify(paid.notes || paid), /Paid is left out/, 'Paid needs purchasing prices')
    assert.ok(paid.rows.every(r => r.cells.length === 2), 'the column isn\'t there')
    const received = await viewer.post('/api/reports/preview', { spec: { subject: 'stock.moves', rows: ['kind'], values: [{ measure: 'received_value' }], ...period } })
    assert.ok(received.status >= 400, received.body.slice(0, 200))
    const valued = await ok(viewer.post('/api/reports/preview', { spec: { kind: 'list', subject: 'stock.moves', rows: ['item_name', 'kind', 'value'], ...period } }))
    assert.ok(valued.rows.length > 0)
  } finally {
    await sql`UPDATE users SET custom_role_id = NULL WHERE auth0_user_id = ${A.viewer} AND tenant_id = ${ids.a}`
  }
})

test('on a shared tablet the person who switched in is who counted: the second person rule follows them, not the account', async () => {
  const { DEVICE_HEADER, ACT_HEADER } = await import('../src/middleware/sharedDevice.js')
  await ok(owner.put('/api/stock/settings', { second_person_approves: true, blind_count: false }))
  await ok(admin.put('/api/shared-devices/my-pin', { pin: '5928' }))
  await ok(owner.put('/api/shared-devices/my-pin', { pin: '6274' }))
  // The venue's tablet is signed in as the owner.
  const device = await ok(owner.post('/api/shared-devices', { venue_id: V, name: 'Walk-in tablet' }))
  const [adminRow] = await sql`SELECT id, email FROM users WHERE tenant_id = ${ids.a} AND auth0_user_id = ${A.admin}`
  const [ownerRow] = await sql`SELECT id, email FROM users WHERE tenant_id = ${ids.a} AND auth0_user_id = ${A.owner}`
  const on = act => ({ [DEVICE_HEADER]: device.token, ...(act ? { [ACT_HEADER]: act } : {}) })
  const switchIn = async (row, pin) => on((await ok(owner.post('/api/shared-devices/act', { person: 'user:' + row.id, pin }, on()))).token)
  try {
    // The admin switches in with their PIN, counts and submits.
    const asAdmin = await switchIn(adminRow, '5928')
    const c = await ok(owner.post(`/api/stock/venues/${V}/counts`, { kind: 'key', key_list_id: list.id }, asAdmin))
    await ok(owner.put(`/api/stock/counts/${c.id}/lines`, { item_id: chicken.id, area_id: null, entries: [{ qty: 3, unit: 'kg' }] }, asAdmin))
    const sent = await ok(owner.post(`/api/stock/counts/${c.id}/submit`, {}, asAdmin))
    assert.deepEqual([sent.started_by, sent.submitted_by, sent.lines.map(l => l.counted_by)], [adminRow.email, adminRow.email, [adminRow.email]], 'the person, not the tablet\'s account')
    assert.equal(sent.can_approve, false, 'the counter, on the tablet')
    // From their own login the admin is still the one who counted.
    const own = await admin.post(`/api/stock/counts/${c.id}/approve`, {})
    assert.equal(own.status, 403)
    assert.equal(own.json.code, 'second_person')
    // The owner, switched in on the same tablet, is a second person.
    const asOwner = await switchIn(ownerRow, '6274')
    assert.equal((await ok(owner.get('/api/stock/counts/' + c.id, undefined, asOwner))).can_approve, true)
    const done = await ok(owner.post(`/api/stock/counts/${c.id}/approve`, {}, asOwner))
    assert.deepEqual([done.status, done.approved_by], ['approved', ownerRow.email])
    // An adjustment on the tablet is the person's too.
    const adj = await ok(owner.post(`/api/stock/venues/${V}/adjustments`, { item_id: rice.id, qty: 100, unit: 'g', reason: 'Found a bag' }, await switchIn(adminRow, '5928')))
    assert.equal(adj.adjusted_by, adminRow.email)
  } finally {
    await ok(owner.put('/api/stock/settings', { second_person_approves: false, blind_count: false }))
    await ok(owner.delete('/api/shared-devices/' + device.device.id))
  }
})

test('an item stock has counted or adjusted is switched off, not deleted, so its counts and adjustments stay', async () => {
  const salt = await ok(owner.post('/api/inventory/items', { name: 'Sea salt', base_unit: 'g' }))
  await ok(owner.post(`/api/stock/venues/${V}/counts`, { lines: [{ item_id: salt.id, qty: 2, unit: 'kg' }] }))
  assert.deepEqual(await ok(owner.delete('/api/inventory/items/' + salt.id)), { archived: true }, 'counted')
  const spice = await ok(owner.post('/api/inventory/items', { name: 'Black pepper', base_unit: 'g' }))
  await ok(owner.post(`/api/stock/venues/${V}/adjustments`, { item_id: spice.id, qty: 500, unit: 'g', reason: 'Found in the dry store' }))
  assert.deepEqual(await ok(owner.delete('/api/inventory/items/' + spice.id)), { archived: true }, 'adjusted')
  const [n] = await sql`SELECT (SELECT count(*) FROM stock_count_lines WHERE item_id = ${salt.id} AND tenant_id = ${ids.a})::int AS lines,
                               (SELECT count(*) FROM stock_adjustments WHERE item_id = ${spice.id} AND tenant_id = ${ids.a})::int AS adjustments`
  assert.deepEqual([n.lines, n.adjustments], [1, 1], 'nothing stock recorded went with it')
  const fresh = await ok(owner.post('/api/inventory/items', { name: 'Never stocked', base_unit: 'g' }))
  assert.deepEqual(await ok(owner.delete('/api/inventory/items/' + fresh.id)), { deleted: true }, 'an item nothing records still goes')
})

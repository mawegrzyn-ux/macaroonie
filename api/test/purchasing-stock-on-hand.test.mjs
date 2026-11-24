// Product codes and stock on hand (Pepper-first step 8B3, migration 287): a
// barcode (GTIN, check digit checked by the rule dishes use) on inventory
// items and supplier products, found by the order form's search and by a
// scan; stock on hand per item per venue = the last count plus what was
// received since (no recipes, so sales aren't taken off, and the answer says
// so), on the Stock tab and in the report subject purchasing.stock, by one
// rule (stockOnHand() in shared/procurement.js).
import test from 'node:test'
import assert from 'node:assert/strict'

const { as, ok, sql, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { stockOnHand, countToBase } = await import('../../shared/procurement.js')

let ids, owner, operator, viewer, bOwner, V, VB, sup, rice, riceQuote, flour

const GOOD = '5012345678917'
const BAD = '5012345678918'

test.before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  bOwner = as(B.owner, ids.b)
  V = (await ok(owner.post('/api/venues', { name: 'Stockton', slug: 'stockton', timezone: 'Europe/London', currency: 'GBP' }))).id
  VB = (await ok(bOwner.post('/api/venues', { name: 'Elsewhere', slug: 'elsewhere-stock', timezone: 'Europe/London' }))).id
  sup = await ok(owner.post('/api/suppliers', { name: 'Grain Co', send_method: 'print' }))
  rice = await ok(owner.post('/api/inventory/items', { name: 'Basmati rice', base_unit: 'g', code: 'RICE-1' }))
  const withQuote = await ok(owner.post(`/api/inventory/items/${rice.id}/quotes`, { supplier_id: sup.id, supplier_code: 'GC-20', barcode: '4006381333931', pack_name: 'Sack', pack_qty: 20, pack_unit: 'kg', price: 30 }))
  riceQuote = withQuote.quotes[0]
  flour = await ok(owner.post('/api/inventory/items', { name: 'Plain flour', base_unit: 'g' }))
  await ok(owner.put('/api/purchasing/settings', { receive_without_order: 'anyone' }))
})
test.after(async () => { await closeApp() })

test('the shared rule: last count plus received since; never counted is no figure; units fit or not', () => {
  const count = { qty_base: 2500, at: '2026-11-20T18:00:00Z' }
  const receipts = [{ qty_base: 20000, at: '2026-11-21T09:00:00Z' }, { qty_base: 5000, at: '2026-11-19T09:00:00Z' }]
  assert.deepEqual(stockOnHand({ count, receipts }), {
    on_hand: 22500, counted: 2500, counted_at: count.at, received_since: 20000, used_since: null, sales_counted: false,
  })
  assert.equal(stockOnHand({ count, receipts, usage: [{ qty_base: 1500, at: '2026-11-22T12:00:00Z' }] }).on_hand, 21000, 'usage, when recipes exist')
  const never = stockOnHand({ receipts })
  assert.equal(never.on_hand, null)
  assert.equal(never.received_since, 25000)
  assert.equal(countToBase(2.5, 'kg', 'g'), 2500)
  assert.equal(countToBase(75, 'cl', 'ml'), 750)
  assert.equal(countToBase(1, 'kg', 'each'), null)
  assert.equal(countToBase(-1, 'g', 'g'), null)
})

test('a barcode is a GTIN with a right check digit, on items and supplier products; blank clears', async () => {
  const bad = await owner.patch('/api/inventory/items/' + rice.id, { barcode: BAD })
  assert.equal(bad.status, 400)
  assert.match(bad.body, /check digit/)
  assert.equal((await owner.patch('/api/inventory/items/' + rice.id, { barcode: '12345' })).status, 400, 'a GTIN has 8, 12, 13 or 14 digits')
  const saved = await ok(owner.patch('/api/inventory/items/' + rice.id, { barcode: '50123 45678917' }))
  assert.equal(saved.barcode, GOOD, 'spaces as printed are taken out')
  assert.equal(saved.code, 'RICE-1', 'the group\'s own code stays free text beside it')
  assert.equal(saved.quotes[0].barcode, '4006381333931')
  assert.equal((await owner.patch('/api/inventory/quotes/' + riceQuote.id, { barcode: '4006381333932' })).status, 400)
  const cleared = await ok(owner.patch('/api/inventory/items/' + flour.id, { barcode: '' }))
  assert.equal(cleared.barcode, null)
})

test('the order form\'s search finds a scanned barcode: the item\'s own, or the supplier\'s product (its price picked)', async () => {
  const byItem = await ok(owner.get(`/api/purchasing/venues/${V}/catalog?search=${GOOD}`))
  assert.deepEqual(byItem.map(i => i.name), ['Basmati rice'])
  const byQuote = await ok(owner.get(`/api/purchasing/venues/${V}/catalog?search=4006381333931`))
  assert.equal(byQuote[0].name, 'Basmati rice')
  assert.equal(byQuote[0].matched_quote_id, riceQuote.id, 'a supplier\'s barcode names that product\'s price')
  assert.deepEqual(await ok(owner.get(`/api/purchasing/venues/${V}/catalog?search=40063813`)), [], 'a barcode matches whole only')
  // Another group's barcode finds nothing here.
  assert.deepEqual(await ok(bOwner.get(`/api/purchasing/venues/${VB}/catalog?search=${GOOD}`)), [])
})

test('stock on hand: a count in kilograms, a delivery after it, nothing for sales (no recipes), and the report agrees', async () => {
  const before = await ok(owner.get('/api/stock/venues/' + V))
  assert.equal(before.sales_counted, false)
  assert.match(before.note, /no recipes/)
  const r0 = before.items.find(i => i.item_id === rice.id)
  assert.deepEqual([r0.on_hand, r0.counted, r0.received_since], [null, null, 0], 'never counted, nothing received')
  // A count: 2.5 kg of rice (kept as 2500 g), 0 flour.
  const count = await ok(owner.post(`/api/stock/venues/${V}/counts`, { lines: [{ item_id: rice.id, qty: 2.5, unit: 'kg' }, { item_id: flour.id, qty: 0 }], note: 'Close' }))
  assert.equal(count.lines, 2)
  // A delivery after it: one 20 kg sack.
  await ok(owner.post(`/api/purchasing/venues/${V}/deliveries`, {
    supplier_id: sup.id, lines: [{ item_id: rice.id, quote_id: riceQuote.id, received_qty: 1 }],
    check: { packaging_ok: true, damage_ok: true, quality_ok: true, accepted: true },
  }))
  const after = await ok(owner.get('/api/stock/venues/' + V))
  const r = after.items.find(i => i.item_id === rice.id)
  assert.deepEqual([r.counted, r.received_since, r.on_hand], [2500, 20000, 22500])
  assert.equal(after.items.find(i => i.item_id === flour.id).on_hand, 0)
  // A new count starts again from itself.
  await ok(owner.post(`/api/stock/venues/${V}/counts`, { lines: [{ item_id: rice.id, qty: 18000 }] }))
  assert.equal((await ok(owner.get('/api/stock/venues/' + V))).items.find(i => i.item_id === rice.id).on_hand, 18000)
  // The report subject reads the same rule.
  const rep = await ok(owner.post('/api/reports/preview', { spec: { subject: 'purchasing.stock', kind: 'list', rows: ['item.name', 'on_hand', 'received_since', 'never_counted'] } }))
  const byName = Object.fromEntries(rep.rows.map(x => [x.cells[0], x.cells.slice(1)]))
  assert.deepEqual(byName['Basmati rice'], [18000, 0, false])
  assert.deepEqual(byName['Plain flour'], [0, 0, false])
  const counts = await ok(owner.get(`/api/stock/venues/${V}/counts`))
  assert.equal(counts.length, 2)
  const one = await ok(owner.get('/api/stock/counts/' + counts[1].id))
  assert.deepEqual(one.lines.map(l => [l.name, l.qty_base]), [['Basmati rice', 2500], ['Plain flour', 0]])
})

test('counts are checked: units that fit, the group\'s own items and venue, no item twice, not in the future; who may count', async () => {
  const bad = await owner.post(`/api/stock/venues/${V}/counts`, { lines: [{ item_id: rice.id, qty: 2, unit: 'l' }] })
  assert.equal(bad.status, 422)
  assert.match(bad.json.error, /counted in g/)
  assert.equal((await owner.post(`/api/stock/venues/${V}/counts`, { lines: [{ item_id: rice.id, qty: 1 }, { item_id: rice.id, qty: 2 }] })).status, 422)
  const future = new Date(Date.now() + 3600_000).toISOString()
  assert.equal((await owner.post(`/api/stock/venues/${V}/counts`, { lines: [{ item_id: rice.id, qty: 1 }], counted_at: future })).status, 422)
  // Another group's venue and items.
  const bItem = await ok(bOwner.post('/api/inventory/items', { name: 'B rice', base_unit: 'g' }))
  assert.equal((await owner.post(`/api/stock/venues/${V}/counts`, { lines: [{ item_id: bItem.id, qty: 1 }] })).status, 404)
  assert.equal((await bOwner.post(`/api/stock/venues/${V}/counts`, { lines: [{ item_id: bItem.id, qty: 1 }] })).status, 404)
  assert.equal((await bOwner.get('/api/stock/venues/' + V)).status, 404)
  const counts = await ok(owner.get(`/api/stock/venues/${V}/counts`))
  assert.equal((await bOwner.get('/api/stock/counts/' + counts[0].id)).status, 404)
  // An operator orders and receives (Purchasing Manage): they may count; a viewer reads stock (no prices in it) but can't count.
  await ok(operator.post(`/api/stock/venues/${V}/counts`, { lines: [{ item_id: flour.id, qty: 500 }] }))
  await ok(viewer.get('/api/stock/venues/' + V))
  assert.equal((await viewer.post(`/api/stock/venues/${V}/counts`, { lines: [{ item_id: flour.id, qty: 1 }] })).status, 403)
  const [row] = await sql`SELECT count(*)::int AS n FROM stock_counts WHERE tenant_id = ${ids.b}`
  assert.equal(row.n, 0, 'nothing written for the other group')
})

// ── Step 9b: Pepper's stock tools and barcodes on supplier prices ─────────

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

test('stock_on_hand: by name, code or barcode, or the low ones against the venue\'s pars; the same figures as the Stock tab', async () => {
  const list = await ok(owner.post('/api/purchasing/lists', { name: 'Dry store', venue_ids: [V], item_ids: [rice.id, flour.id] }))
  await ok(owner.put('/api/purchasing/lists/' + list.id + '/pars', { pars: [
    { item_id: rice.id, venue_id: V, par_base: 25000 }, { item_id: flour.id, venue_id: V, par_base: 100 },
  ] }))
  const tab = await ok(owner.get('/api/stock/venues/' + V))
  const tr = tab.items.find(i => i.item_id === rice.id)
  assert.equal(tr.par_base, 25000)
  assert.equal(tr.low, tr.on_hand < 25000, 'low is on hand below par (stockLow())')
  const { tool, out } = await pepper(A.owner, 'stock_on_hand', { venue: 'Stockton', items: ['basmati', 'RICE-1'] })
  assert.equal(tool.class, 'read')
  assert.equal(out.items.length, 1, 'one item named twice is one line')
  assert.equal(out.items[0].name, 'Basmati rice')
  assert.equal(out.items[0].on_hand, (tr.on_hand / 1000) + ' kg', 'in the item\'s units, from the route\'s figure')
  assert.equal(out.items[0].par, '25 kg')
  assert.match(out.note, /Sales aren't taken off/)
  const byScan = await pepper(A.owner, 'stock_on_hand', { venue: 'Stockton', items: ['4006381333931'] })
  assert.equal(byScan.out.items[0].name, 'Basmati rice', 'a supplier product\'s barcode finds its item')
  const low = await pepper(A.owner, 'stock_on_hand', { venue: 'Stockton', low: true })
  assert.deepEqual(low.out.items.map(i => i.name).sort(), tab.items.filter(i => i.low).map(i => i.name).sort())
  // A viewer reads purchasing (View) and gets stock too; another group's venue isn't found.
  await pepper(A.viewer, 'stock_on_hand', { venue: 'Stockton' })
  await assert.rejects(pepper(A.owner, 'stock_on_hand', { venue: 'Elsewhere' }), /No venue called/)
})

test('count_stock: a card in the item\'s units, then the Stock tab\'s count route; units that don\'t fit are refused', async () => {
  const { tool, card } = await pepper(A.owner, 'count_stock', { venue: 'Stockton', counts: [{ item: 'basmati', qty: 3, unit: 'kg' }, { item: 'plain flour', qty: 750 }] }, { run: false })
  assert.equal(tool.class, 'consequential')
  assert.ok(card.lines.some(l => /^Basmati rice: 3 kg \(was /.test(l)), card.lines.join(' | '))
  assert.ok(card.lines.includes('Plain flour: 750 g (was 500 g)'), card.lines.join(' | '))
  const before = (await ok(owner.get(`/api/stock/venues/${V}/counts`))).length
  const { out } = await pepper(A.owner, 'count_stock', { venue: 'Stockton', counts: [{ item: 'basmati', qty: 3, unit: 'kg' }, { item: 'plain flour', qty: 750 }] })
  assert.equal(out.counted, 2)
  const tab = await ok(owner.get('/api/stock/venues/' + V))
  assert.equal(tab.items.find(i => i.item_id === rice.id).on_hand, 3000)
  assert.equal(tab.items.find(i => i.item_id === flour.id).on_hand, 750)
  assert.equal((await ok(owner.get(`/api/stock/venues/${V}/counts`))).length, before + 1, 'one count, the route\'s own')
  await assert.rejects(pepper(A.owner, 'count_stock', { venue: 'Stockton', counts: [{ item: 'basmati', qty: 2, unit: 'l' }] }), /counted by weight/)
  await assert.rejects(pepper(A.owner, 'count_stock', { venue: 'Stockton', counts: [{ item: 'basmati', qty: 2 }, { item: 'RICE-1', qty: 1 }] }), /twice/)
  await assert.rejects(pepper(A.viewer, 'count_stock', { venue: 'Stockton', counts: [{ item: 'basmati', qty: 2 }] }), /permission to count/)
})

test('a barcode on a supplier price through Pepper: added, changed and cleared, checked with barcodeProblem()', async () => {
  const added = await pepper(A.owner, 'add_supplier_price', {
    item: 'Plain flour', supplier: 'Grain Co', pack_name: 'Bag', pack_size: 16, pack_unit: 'kg', price: 12, supplier_code: 'GC-FL', barcode: '96385074',
  })
  assert.ok(added.card.lines.includes('Barcode: 96385074'), added.card.lines.join(' | '))
  const item = (await ok(owner.get('/api/inventory/items'))).find(i => i.id === flour.id)
  assert.equal(item.quotes.find(q => q.supplier_code === 'GC-FL').barcode, '96385074')
  await assert.rejects(pepper(A.owner, 'update_supplier_price', { item: 'Plain flour', supplier: 'Grain Co', barcode: '96385075' }), /check digit/)
  const changed = await pepper(A.owner, 'update_supplier_price', { item: 'Plain flour', supplier: 'Grain Co', barcode: GOOD })
  assert.ok(changed.card.lines.includes('Barcode: 96385074 to ' + GOOD), changed.card.lines.join(' | '))
  const found = await pepper(A.owner, 'find_inventory_items', { search: GOOD })
  assert.ok(found.out.items.some(i => i.name === 'Plain flour' && i.prices.some(p => p.barcode === GOOD)))
  await pepper(A.owner, 'update_supplier_price', { item: 'Plain flour', supplier: 'Grain Co', barcode: null })
  const after = (await ok(owner.get('/api/inventory/items'))).find(i => i.id === flour.id)
  assert.equal(after.quotes.find(q => q.supplier_code === 'GC-FL').barcode, null)
})

// ── Step 9c: barcodes in the import and the price list update ─────────

const b64 = text => Buffer.from(text, 'utf8').toString('base64')

test('the inventory import takes a barcode column (GTIN, EAN, UPC...); a bad one is noted per row, not a failed import', async () => {
  const csv = [
    'Item,Base unit,Supplier,Supplier code,Pack,Pack size,Pack unit,Price,EAN,Item barcode',
    'Jasmine rice,g,Grain Co,GC-30,Sack,10,kg,22,96385074,',
    'Sea salt,g,Grain Co,GC-31,Tub,1,kg,3,12345678,',
    'Paper towel,each,,,,,,,,5012345678900',
  ].join('\n')
  const dry = await ok(owner.post('/api/inventory/import', { file: b64(csv), dry_run: true }))
  assert.deepEqual(dry.errors, [], 'no row fails for a barcode')
  assert.equal(dry.items_created, 3)
  assert.equal(dry.barcodes_set, 2, 'the rice\'s price and the towel\'s item')
  assert.equal(dry.notes.length, 1)
  assert.match(dry.notes[0].note, /Barcode 12345678 left out: .*check digit/)
  await ok(owner.post('/api/inventory/import', { file: b64(csv) }))
  const items = await ok(owner.get('/api/inventory/items'))
  const jas = items.find(i => i.name === 'Jasmine rice')
  assert.equal(jas.quotes[0].barcode, '96385074', 'with a supplier: the supplier product\'s barcode')
  assert.equal(jas.barcode, null)
  assert.equal(items.find(i => i.name === 'Sea salt').quotes[0].barcode, null)
  assert.equal(items.find(i => i.name === 'Paper towel').barcode, '5012345678900', 'Item barcode: the item\'s')
  const tpl = await owner.get('/api/inventory/import-template')
  assert.match(tpl.body.split('\n')[0], /,Barcode$/)
})

test('the price list update takes a barcode beside the price; Pepper passes it through', async () => {
  const csv = ['Code,Price,GTIN', 'GC-30,23.50,4006381333931', 'GC-31,3,bad'].join('\n')
  const dry = await ok(owner.post('/api/inventory/price-update', { supplier_id: sup.id, file: b64(csv), dry_run: true }))
  assert.equal(dry.changes.length, 1)
  assert.deepEqual(dry.barcodes.map(b => [b.code, b.old, b.new]), [['GC-30', '96385074', '4006381333931']])
  assert.equal(dry.notes.length, 1, 'a bad barcode is noted; its price still goes in')
  assert.equal(dry.errors.length, 0)
  await ok(owner.post('/api/inventory/price-update', { supplier_id: sup.id, file: b64(csv) }))
  const jas = (await ok(owner.get('/api/inventory/items'))).find(i => i.name === 'Jasmine rice')
  assert.deepEqual([jas.quotes[0].barcode, Number(jas.quotes[0].price)], ['4006381333931', 23.5])
  // Pepper: rows with a barcode only (no price change) still make a card.
  const { card } = await pepper(A.owner, 'update_prices_by_code', { supplier: 'Grain Co', rows: [{ code: 'GC-31', price: 3, barcode: '96385074' }] }, { run: false })
  assert.ok(card.lines.some(l => /GC-31 Sea salt: barcode none to 96385074/.test(l)), card.lines.join(' | '))
  const imp = await pepper(A.owner, 'import_price_list', { rows: [{ item: 'Basmati rice', supplier: 'Grain Co', supplier_code: 'GC-20', pack: 'Sack', pack_size: 20, pack_unit: 'kg', price: 30, barcode: '12345678' }] }, { run: false })
  assert.ok(imp.card.warnings.some(w => /Barcode 12345678 left out/.test(w)), JSON.stringify(imp.card.warnings))
})

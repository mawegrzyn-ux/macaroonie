// Print designs (migration 190): company-wide kitchen ticket and receipt
// designs, which design prints where (company, or one location), and what a
// location changes (its words, hidden parts). Checked here: making, copying
// and saving designs (tidied by shared/pos/ticketLayout.js), the choices and
// their refusals, a location's changes, what a till and a kiosk get in their
// config, deleting a design, and who may do what.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'

let ids, owner, other, V, V2, BV, till, kiosk

async function device(d, method, url) {
  const app = await getApp()
  const res = await app.inject({ method, url, headers: { authorization: `Device ${d.device_id}.${d.secret}`, [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET } })
  return { status: res.statusCode, json: res.json() }
}

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  other = as(B.owner, ids.b)
  V = filled.ids.venue
  V2 = (await sql`SELECT id FROM venues WHERE tenant_id = ${ids.a} AND id <> ${V} ORDER BY created_at LIMIT 1`)[0].id
  BV = (await ok(other.post('/api/venues', { name: 'Other place', slug: 'other-place-print', timezone: 'Europe/London' }))).id
  // The fixtures chose a kitchen design for Ware; start from nothing chosen.
  await sql`DELETE FROM print_design_uses WHERE tenant_id = ${ids.a}`
  await sql`DELETE FROM print_designs WHERE tenant_id = ${ids.a}`
  till = await linkDevice(owner, V, { kind: 'terminal', name: 'Print till', settings: { mode: 'counter' } })
  kiosk = await linkDevice(owner, V, { kind: 'kiosk', name: 'Print kiosk' })
})
after(closeApp)

test('designs are made, tidied, copied and listed', async () => {
  const k = await ok(owner.post('/api/pos/print-designs', { kind: 'kitchen', name: 'Kitchen big tents' }))
  assert.equal(k.kind, 'kitchen')
  assert.deepEqual(k.layout.blocks.map(b => b.type), ['station', 'title', 'details', 'details', 'details', 'items'], 'starts from the built-in layout')
  const saved = await ok(owner.put(`/api/pos/print-designs/${k.id}`, { name: 'Kitchen big tents', layout: { blocks: [
    { id: 'tt', type: 'title', opts: { main: 'tent', size: 'huge' } },
    { id: 'tx', type: 'text', opts: { text: 'Hello kitchen' } },
    { id: 'vx', type: 'venue', opts: {} },
    { id: 'tx', type: 'rule', opts: { char: '#' } },
  ] } }))
  assert.deepEqual(saved.layout.blocks.map(b => b.id + ':' + b.type), ['tt:title', 'tx:text', 'b3:rule', 'b4:items'],
    'receipt-only parts dropped, a repeated id renamed, the dishes added back')
  assert.equal(saved.layout.blocks[0].opts.size, 'big', 'an unknown size is the default')
  assert.equal(saved.layout.blocks[2].opts.char, '-')

  const copy = await ok(owner.post('/api/pos/print-designs', { kind: 'kitchen', name: 'Copy', copy_from: k.id }))
  assert.deepEqual(copy.layout, saved.layout)
  assert.equal((await owner.post('/api/pos/print-designs', { kind: 'receipt', name: 'Wrong', copy_from: k.id })).status, 422)
  assert.equal((await other.post('/api/pos/print-designs', { kind: 'kitchen', name: 'Steal', copy_from: k.id })).status, 404, 'another company\'s design')
  await ok(owner.delete('/api/pos/print-designs/' + copy.id))

  const list = await ok(owner.get('/api/pos/print-designs?venue_id=' + V))
  assert.deepEqual(list.designs.map(d => d.name), ['Kitchen big tents'])
  assert.equal((await other.get('/api/pos/print-designs')).json.designs.length, 0, 'other companies don\'t see them')
  assert.equal((await other.get('/api/pos/print-designs/' + k.id)).status, 404)
  assert.equal((await other.put(`/api/pos/print-designs/${k.id}`, { name: 'x', layout: { blocks: [] } })).status, 404)
})

test('which design prints where, and a location\'s own words', async () => {
  const k = (await ok(owner.get('/api/pos/print-designs'))).designs.find(d => d.kind === 'kitchen')
  const r = await ok(owner.post('/api/pos/print-designs', { kind: 'receipt', name: 'Receipt with tent' }))
  await ok(owner.put(`/api/pos/print-designs/${r.id}`, { name: 'Receipt with tent', layout: { blocks: [
    { id: 'v', type: 'venue', opts: {} }, { id: 'ti', type: 'title', opts: { main: 'tent' } }, { id: 'it', type: 'items', opts: {} },
    { id: 'to', type: 'totals', opts: {} }, { id: 'ft', type: 'footer', opts: { receipt_text: 'Thanks from us', bill_text: '' } },
  ] } }))

  assert.equal((await owner.put('/api/pos/print-design-uses', { venue_id: null, use: 'receipt', design_id: k.id })).status, 422, 'a kitchen design can\'t print receipts')
  await ok(owner.put('/api/pos/print-design-uses', { venue_id: null, use: 'receipt', design_id: r.id }))
  const uses = await ok(owner.put('/api/pos/print-design-uses', { venue_id: V, use: 'kitchen', design_id: k.id }))
  assert.deepEqual(uses, { company: { receipt: r.id }, venue: { kitchen: k.id } })
  assert.equal((await owner.put('/api/pos/print-design-uses', { venue_id: BV, use: 'kitchen', design_id: k.id })).status, 404, 'another company\'s venue')
  assert.equal((await other.put('/api/pos/print-design-uses', { venue_id: null, use: 'kitchen', design_id: k.id })).status, 404, 'another company\'s design')

  const words = await ok(owner.put(`/api/pos/print-designs/${k.id}/variations/${V}`, {
    texts: { tx: { text: 'Ware kitchen', align: 'left' }, nope: { text: 'x' }, tt: { text: 'not words' } },
    hidden: ['b3', 'b4', 'nope'],
  }))
  assert.deepEqual(words, { texts: { tx: { text: 'Ware kitchen' } }, hidden: ['b3'] }, 'only words of word parts, never the dishes, no unknown parts')
  assert.equal((await owner.put(`/api/pos/print-designs/${k.id}/variations/${BV}`, { texts: {}, hidden: [] })).status, 404)

  // A till gets its venue's kitchen design with Ware's words, and the company receipt.
  const cfg = await device(till, 'GET', '/pos-api/config')
  assert.equal(cfg.status, 200)
  const kl = cfg.json.print_layouts.kitchen
  assert.deepEqual(kl.blocks.map(b => b.type), ['title', 'text', 'items'], 'the hidden line left out')
  assert.equal(kl.blocks[1].opts.text, 'Ware kitchen')
  assert.equal(cfg.json.print_layouts.receipt.blocks.find(b => b.type === 'footer').opts.receipt_text, 'Thanks from us')

  // Kiosk receipts follow till receipts until the company picks a kiosk design.
  let kc = await device(kiosk, 'GET', '/pos-api/config')
  assert.equal(kc.json.print_layouts.receipt.blocks.find(b => b.type === 'title').opts.main, 'tent')
  const kr = await ok(owner.post('/api/pos/print-designs', { kind: 'receipt', name: 'Kiosk receipt', copy_from: r.id }))
  await ok(owner.put('/api/pos/print-design-uses', { venue_id: null, use: 'kiosk_receipt', design_id: kr.id }))
  await ok(owner.put(`/api/pos/print-designs/${kr.id}/variations/${V}`, { texts: { ft: { receipt_text: 'Kiosk thanks' } } }))
  kc = await device(kiosk, 'GET', '/pos-api/config')
  assert.equal(kc.json.print_layouts.receipt.blocks.find(b => b.type === 'footer').opts.receipt_text, 'Kiosk thanks')

  // Another location of the company prints the company's choices, without Ware's words.
  const t2 = await linkDevice(owner, V2, { kind: 'terminal', name: 'Hertford till', settings: { mode: 'counter' } })
  const c2 = await device(t2, 'GET', '/pos-api/config')
  assert.equal(c2.json.print_layouts.kitchen, null, 'no kitchen design chosen there: built-in')
  assert.equal(c2.json.print_layouts.receipt.blocks.find(b => b.type === 'footer').opts.receipt_text, 'Thanks from us')

  // Ware's words are listed on the design; a design change drops words for parts that went.
  const one = await ok(owner.get('/api/pos/print-designs/' + k.id))
  assert.deepEqual(one.variations[V].texts, { tx: { text: 'Ware kitchen' } })
  assert.deepEqual(one.used_at, [{ venue_id: V, use: 'kitchen' }])
  await ok(owner.put(`/api/pos/print-designs/${k.id}`, { name: 'Kitchen big tents', layout: { blocks: [{ id: 'tt', type: 'title', opts: { main: 'tent' } }, { id: 'b4', type: 'items', opts: {} }] } }))
  const [row] = await sql`SELECT texts, hidden FROM print_design_variations WHERE design_id = ${k.id} AND venue_id = ${V}`
  assert.deepEqual(row.texts, {})
  assert.deepEqual(row.hidden, [])

  // Deleting a design: places using it go back.
  await ok(owner.delete('/api/pos/print-designs/' + kr.id))
  kc = await device(kiosk, 'GET', '/pos-api/config')
  assert.equal(kc.json.print_layouts.receipt.blocks.find(b => b.type === 'footer').opts.receipt_text, 'Thanks from us', 'back to the till receipt design')
  assert.equal((await sql`SELECT count(*)::int AS n FROM print_design_variations WHERE design_id = ${kr.id}`)[0].n, 0)
})

test('Till setup view reads, manage changes; others neither', async () => {
  const k = (await ok(owner.get('/api/pos/print-designs'))).designs.find(d => d.kind === 'kitchen')
  const operator = as(A.operator, ids.a)
  assert.equal((await operator.get('/api/pos/print-designs')).status, 403, 'operators have no Till setup access by default')
  await sql`UPDATE tenant_roles SET permissions = permissions || '{"pos_setup": "view"}'::jsonb WHERE tenant_id = ${ids.a} AND key = 'operator'`
  assert.equal((await operator.get('/api/pos/print-designs')).status, 200)
  assert.equal((await operator.get('/api/pos/print-designs/' + k.id)).status, 200)
  assert.equal((await operator.put(`/api/pos/print-designs/${k.id}`, { name: 'x', layout: { blocks: [] } })).status, 403)
  assert.equal((await operator.post('/api/pos/print-designs', { kind: 'kitchen', name: 'x' })).status, 403)
  assert.equal((await operator.put('/api/pos/print-design-uses', { venue_id: null, use: 'kitchen', design_id: null })).status, 403)
  assert.equal((await operator.put(`/api/pos/print-designs/${k.id}/variations/${V}`, { texts: {}, hidden: [] })).status, 403)
  assert.equal((await operator.delete('/api/pos/print-designs/' + k.id)).status, 403)
})

// Print designs (shared/pos/ticketLayout.js) and the tickets drawn from them
// (shared/pos/tickets.js): the built-in layouts, each block's options, a
// location's words and hidden parts, kiosks printing their own receipt
// design, and the designer's column-exact preview.
// Run: node --test shared/pos/test/

import test from 'node:test'
import assert from 'node:assert/strict'
import { kitchenTicket, receipt, toText } from '../tickets.js'
import { jobsForEvent } from '../printing.js'
import { previewHtml } from '../ticketHtml.js'
import {
  defaultLayout, normaliseLayout, normaliseVariation, applyVariation, sampleTicket, canRemove, blockSummary,
} from '../ticketLayout.js'

const AT = new Date('2026-10-19T12:30:00')
const counter = sampleTicket('kitchen', 'counter', {}, AT)
const table = sampleTicket('kitchen', 'table', {}, AT)
const lines = ops => toText(ops).split('\n').map(l => l.trim()).filter(Boolean)

test('no design prints the built-in layout', () => {
  assert.deepEqual(kitchenTicket(table), kitchenTicket(table, defaultLayout('kitchen')))
  assert.deepEqual(normaliseLayout('kitchen', null), defaultLayout('kitchen'))
  assert.deepEqual(normaliseLayout('receipt', { nothing: true }), defaultLayout('receipt'))
  const t = lines(kitchenTicket(counter))
  assert.equal(t[0], 'GRILL')
  assert.equal(t[1], 'O R D E R   5 7', 'the counter order number, double width')
  assert.equal(t[2], 'Sam')
  assert.equal(t[3], 'TAKE OUT  TENT 12')
  const r = lines(receipt(sampleTicket('receipt', 'receipt', { name: 'Thai House' }, AT)))
  assert.equal(r[0], 'T h a i   H o u s e')
  assert.ok(r.includes('Thank you'))
  assert.ok(!r.some(l => l.includes('BILL - NOT A RECEIPT')))
  assert.ok(lines(receipt(sampleTicket('receipt', 'bill', {}, AT))).includes('BILL - NOT A RECEIPT'))
})

test('a layout is tidied: unknown parts out, ids unique, the dishes always there', () => {
  const l = normaliseLayout('kitchen', { blocks: [
    { id: 'a', type: 'title', opts: { main: 'tent', size: 'giant', invert: 'yes' } },
    { id: 'a', type: 'text', opts: { text: 'x'.repeat(400), align: 'middle' } },
    { id: 'z', type: 'totals' },
    { type: 'space', opts: { lines: 9 } },
  ] })
  assert.deepEqual(l.blocks.map(b => b.id + ':' + b.type), ['a:title', 'b2:text', 'b3:space', 'b4:items'])
  assert.deepEqual(l.blocks[0].opts, { main: 'tent', size: 'big', invert: false })
  assert.equal(l.blocks[1].opts.text.length, 300)
  assert.equal(l.blocks[1].opts.align, 'center')
  assert.equal(l.blocks[2].opts.lines, 5)
  const r = normaliseLayout('receipt', { blocks: [{ id: 'f', type: 'footer', opts: { receipt_text: 'Bye' } }] })
  assert.deepEqual(r.blocks.map(b => b.type), ['footer', 'items', 'totals'], 'a receipt keeps its dishes and total')
  assert.equal(canRemove('receipt', r.blocks[1]), false)
  assert.equal(canRemove('receipt', r.blocks[0]), true)
  assert.throws(() => normaliseLayout('menu', {}))
})

test('the title shows the tent, table, number or name picked, else the usual one', () => {
  const tent = normaliseLayout('kitchen', { blocks: [{ id: 't', type: 'title', opts: { main: 'tent', size: 'tall', invert: true } }] })
  const ops = kitchenTicket(counter, tent)
  assert.deepEqual(ops[0], { t: 'text', text: 'TENT 12', align: 'center', bold: true, tall: true, invert: true })
  // A table order has no tent: the usual title (the table).
  assert.equal(lines(kitchenTicket(table, tent))[0], 'TABLE 4')
  const name = normaliseLayout('kitchen', { blocks: [{ id: 't', type: 'title', opts: { main: 'name', size: 'normal' } }] })
  assert.equal(kitchenTicket(counter, name)[0].text, 'Sam')
  const num = normaliseLayout('kitchen', { blocks: [{ id: 't', type: 'title', opts: { main: 'number' } }] })
  assert.equal(kitchenTicket(counter, num)[0].text, 'ORDER 57')
  // Receipts: the order number big for counter orders, the table for table orders.
  const rt = normaliseLayout('receipt', { blocks: [{ id: 't', type: 'title', opts: {} }] })
  assert.equal(receipt(sampleTicket('receipt', 'counter', {}, AT), rt)[0].text, 'ORDER 57')
  assert.equal(receipt(sampleTicket('receipt', 'receipt', {}, AT), rt)[0].text, 'TABLE 4')
})

test('details, dishes, words, lines and space follow their options', () => {
  const l = normaliseLayout('kitchen', { blocks: [
    { id: 'd', type: 'details', opts: { fields: ['server', 'name', 'tent', 'covers'], style: 'plain', size: 'normal' } },
    { id: 'w', type: 'text', opts: { text: 'Line one\nLine two', align: 'left', size: 'big', bold: true } },
    { id: 'r', type: 'rule', opts: { char: '=' } },
    { id: 's', type: 'space', opts: { lines: 2 } },
    { id: 'i', type: 'items', opts: { size: 'normal', seats: false } },
  ] })
  const ops = kitchenTicket(table, l)
  assert.equal(ops[0].text, '2 covers  Jo', 'only what the order has, in field order')
  assert.deepEqual(ops.slice(1, 3).map(o => [o.text, o.align, o.wide, o.bold]), [['Line one', 'left', true, true], ['Line two', 'left', true, true]])
  assert.deepEqual(ops[3], { t: 'rule', char: '=' })
  assert.deepEqual(ops[4], { t: 'feed', lines: 2 })
  const dish = ops.find(o => o.text?.startsWith('1 x Chicken wings'))
  assert.equal(dish.text, '1 x Chicken wings', 'no seat number')
  assert.equal(dish.tall, false)
  const r = normaliseLayout('receipt', { blocks: [
    { id: 'i', type: 'items', opts: { extras: false } },
    { id: 't', type: 'totals', opts: { subtotal: false, size: 'normal' } },
    { id: 'h', type: 'heading', opts: { receipt_text: 'VAT RECEIPT', bill_text: 'YOUR BILL' } },
    { id: 'f', type: 'footer', opts: { receipt_text: 'Thanks', bill_text: 'Service not included' } },
  ] })
  const paid = lines(receipt(sampleTicket('receipt', 'receipt', {}, AT), r))
  assert.ok(paid.some(x => /^1 Chicken wings\s+£8\.00$/.test(x)), 'the extra folded into the dish price')
  assert.ok(!paid.some(x => x.startsWith('Hot sauce')))
  assert.ok(!paid.some(x => x.startsWith('Subtotal')))
  assert.ok(paid.includes('VAT RECEIPT') && paid.includes('Thanks'))
  const bill = lines(receipt(sampleTicket('receipt', 'bill', {}, AT), r))
  assert.ok(bill.includes('YOUR BILL') && bill.includes('Service not included') && !bill.includes('Thanks'))
})

test('a location changes words and hides parts, never the dishes or total', () => {
  const l = normaliseLayout('receipt', { blocks: [
    { id: 'v', type: 'venue' }, { id: 'h', type: 'heading', opts: { receipt_text: 'RECEIPT' } }, { id: 'w', type: 'text', opts: { text: 'Company words' } },
    { id: 'i', type: 'items' }, { id: 't', type: 'totals' }, { id: 'f', type: 'footer', opts: { receipt_text: 'Thanks' } },
  ] })
  const v = normaliseVariation(l, {
    texts: { w: { text: 'Ware words', align: 'left' }, f: { bill_text: 'Ware bill' }, i: { text: 'x' }, gone: { text: 'y' } },
    hidden: ['v', 'i', 't', 'gone', 'v'],
  })
  assert.deepEqual(v, { texts: { w: { text: 'Ware words' }, f: { bill_text: 'Ware bill' } }, hidden: ['v'] })
  const here = applyVariation(l, v)
  assert.deepEqual(here.blocks.map(b => b.id), ['h', 'w', 'i', 't', 'f'])
  assert.equal(here.blocks[1].opts.text, 'Ware words')
  assert.equal(here.blocks[4].opts.receipt_text, 'Thanks', 'words not changed stay')
  assert.equal(here.blocks[4].opts.bill_text, 'Ware bill')
  assert.equal(blockSummary('receipt', here.blocks[4]), 'Receipt: Thanks · Bill: Ware bill')
  assert.deepEqual(applyVariation(l, null), l)
})

test('a kiosk\'s receipts print in the kiosk receipt design; tills in theirs', () => {
  const check = {
    id: 'c1', status: 'closed', mode: 'counter', number: 3, order_no: 41, tab_name: 'Kim', tent: '9', order_type_id: null,
    lines: [], payments: [], discounts: [], promotions: [],
  }
  const till = normaliseLayout('receipt', { blocks: [{ id: 'f', type: 'footer', opts: { receipt_text: 'Till thanks' } }] })
  const kiosk = normaliseLayout('receipt', { blocks: [{ id: 'f', type: 'footer', opts: { receipt_text: 'Kiosk thanks' } }, { id: 't', type: 'title', opts: { main: 'tent' } }] })
  const cfg = {
    printers: { p1: { name: 'Receipts' } }, routes: [], tables: {}, staff: {}, courses: {}, order_types: {}, settings: {},
    devices: { kd: { receipt_printer_id: 'p1', kiosk: true }, td: { receipt_printer_id: 'p1' } },
    layouts: { receipt: till, kiosk_receipt: kiosk },
  }
  const e = d => ({ id: 'e', type: 'check.closed', device_id: d, check_id: 'c1', client_at: AT.toISOString(), payload: { print_receipt: true } })
  const fromKiosk = jobsForEvent(e('kd'), {}, { c1: check }, cfg)
  assert.equal(fromKiosk.length, 1)
  assert.ok(lines(fromKiosk[0].ops).includes('Kiosk thanks'))
  assert.ok(fromKiosk[0].ops.some(o => o.text === 'TENT 9'), 'the kiosk design\'s tent title')
  assert.ok(lines(jobsForEvent(e('td'), {}, { c1: check }, cfg)[0].ops).includes('Till thanks'))
})

test('the preview lays a ticket out in the printer\'s columns', () => {
  const html = previewHtml(kitchenTicket(counter), 32)
  assert.match(html, /tk-wide/)
  assert.match(html, /transform:scale\(2,2\)/)
  assert.match(html, /margin-left:\d+ch/)
  assert.match(html, /class="tk-cut"/)
  assert.doesNotMatch(previewHtml([{ t: 'text', text: '<b>x</b>' }]), /<b>/, 'text is escaped')
  // 32 columns: a double-width 'ORDER 57' (16 columns) is centred with 8 spaces.
  assert.match(previewHtml([{ t: 'text', text: 'ORDER 57', align: 'center', wide: true, tall: true }], 32), /margin-left:8ch/)
})

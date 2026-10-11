#!/usr/bin/env node
// hub/bin/test-print.js
//
// Phase 0 printing trial: prints a sample kitchen ticket and a receipt to an
// Epson network printer, cuts, and (with --drawer) opens the cash drawer.
//
//   node hub/bin/test-print.js 192.168.1.50
//   node hub/bin/test-print.js 192.168.1.50 --cols 48 --drawer
//   node hub/bin/test-print.js --preview            no printer: show the tickets as text
//
// Options: --port 9100, --cols 42 (TM-T88) / 48 (TM-m30), --only kitchen|receipt,
//          --drawer, --preview, --status (just ask the printer how it is)

import { kitchenTicket, receipt, toText, billSubtotal, DEFAULT_COLS } from '../../shared/pos/tickets.js'
import { render } from '../src/escpos.js'
import { print, printerStatus } from '../src/printer.js'

const args = process.argv.slice(2)
const flag = name => args.includes('--' + name)
const option = (name, fallback) => {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const host = args.find(a => !a.startsWith('--') && !/^\d+$/.test(a) && !['kitchen', 'receipt'].includes(a))
const port = Number(option('port', 9100))
const cols = Number(option('cols', DEFAULT_COLS))
const only = option('only', null)

const now = new Date()
const kitchen = kitchenTicket({
  station: 'Kitchen', table: '12', covers: 4, server: 'Anna', checkNo: '1042', sentAt: now,
  courses: [
    { name: 'Starters', lines: [
      { qty: 2, name: 'Chicken Satay', modifiers: [{ kind: 'add', text: 'Extra peanut sauce' }] },
      { qty: 1, name: 'Vegetable Spring Rolls', seat: 3, allergies: ['Peanuts'] },
    ] },
    { name: 'Mains', hold: true, lines: [
      { qty: 2, name: 'Pad Thai', modifiers: [{ kind: 'remove', text: 'No egg' }], note: 'One of them mild' },
      { qty: 1, name: 'Green Curry Chicken', modifiers: [{ kind: 'add', text: 'Jasmine rice' }] },
    ] },
  ],
})

// Prices include VAT at 20% (eat in). VAT = gross x 20 / 120. Line totals exclude add-ons.
const lines = [
  { qty: 2, name: 'Chicken Satay', total: 1390, modifiers: [{ text: 'Extra peanut sauce', price: 100 }] },
  { qty: 1, name: 'Vegetable Spring Rolls', total: 595 },
  { qty: 2, name: 'Pad Thai', total: 2590 },
  { qty: 1, name: 'Green Curry Chicken', total: 1495, modifiers: [{ text: 'Jasmine rice', price: 350 }] },
  { qty: 4, name: 'Singha 330ml', total: 2200 },
]
const subtotal = billSubtotal(lines)
const service = Math.round(subtotal * 0.125)
const total = subtotal + service
const vat = Math.round(total * 20 / 120)
const bill = receipt({
  venue: { name: 'One Thai Cafe', address: ['12 High Street', 'Ware SG12 9AA'], vatNumber: 'GB 123 4567 89' },
  table: '12', checkNo: '1042', server: 'Anna', covers: 4, at: now,
  lines,
  serviceCharge: { label: 'Service charge 12.5%', amount: service },
  total,
  vat: [{ rate: 20, net: total - vat, vat }],
  payments: [{ tender: 'Cash', amount: 10000 }],
  change: 10000 - total,
  footer: 'Thank you - test print from Macaroonie',
  drawer: flag('drawer'),
})

const jobs = [['Kitchen ticket', kitchen], ['Receipt', bill]]
  .filter(([name]) => !only || name.toLowerCase().startsWith(only))

if (flag('preview') || !host) {
  if (!host && !flag('preview')) console.log('No printer address given, showing a preview. Usage: node hub/bin/test-print.js <printer-ip>\n')
  for (const [name, ops] of jobs) console.log(`--- ${name} (${cols} columns) ---\n${toText(ops, cols)}\n`)
  process.exit(0)
}

try {
  const status = await printerStatus({ host, port })
  if (!status) console.log(`Printer ${host}:${port} is reachable but didn't send a status (fine for some models).`)
  else {
    console.log(`Printer ${host}:${port}: ${status.online ? 'online' : 'OFFLINE'}`
      + (status.coverOpen ? ', cover open' : '') + (status.paperOut ? ', OUT OF PAPER' : status.paperNearEnd ? ', paper running low' : ', paper OK'))
  }
  if (flag('status')) process.exit(0)
  for (const [name, ops] of jobs) {
    const data = render(ops, { cols })
    const { attempts } = await print({ host, port, data })
    console.log(`${name}: sent (${data.length} bytes${attempts > 1 ? `, after ${attempts} tries` : ''})`)
  }
  console.log('Done. Check the printout: £ signs, bold and large text, white-on-black HOLD / ALLERGY bars, and the cut.')
} catch (e) {
  console.error('Print failed: ' + e.message)
  console.error('Check the printer is on, the IP address (print the printer\'s network status sheet), and that this computer is on the same network.')
  process.exit(1)
}

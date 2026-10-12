// Phase 0 printing trial tests: ESC/POS bytes, the print queue and printer
// status, against a fake network printer. Run: cd hub && npm test

import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { render, encode, CMD } from '../src/escpos.js'
import { print, printerStatus } from '../src/printer.js'
import { kitchenTicket, receipt, toText, pairLines, billSubtotal } from '../../shared/pos/tickets.js'

const includes = (buf, bytes) => buf.indexOf(Buffer.from(bytes)) >= 0

/** A fake printer: records what each connection sent; optional status reply. */
function fakePrinter({ reply } = {}) {
  const jobs = []
  const server = net.createServer(socket => {
    const chunks = []
    socket.on('data', c => {
      chunks.push(c)
      if (reply && c[0] === 0x10) socket.write(Buffer.from(reply))
    })
    socket.on('end', () => { jobs.push(Buffer.concat(chunks)); socket.end() })
    socket.on('error', () => {})
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, jobs, port: server.address().port })))
}

test('encode: code page 1252 for £, € and accents, ? for the rest', () => {
  assert.deepEqual(encode('£€é—'), [0xa3, 0x80, 0xe9, 0x97])
  assert.deepEqual(encode('a🍜'), [0x61, 0x3f])
})

test('render: init, code page, styles, cut and drawer', () => {
  const buf = render([
    { t: 'text', text: 'Pad Thai £9.50', bold: true, tall: true },
    { t: 'drawer' },
    { t: 'cut' },
  ])
  assert.ok(buf.subarray(0, 5).equals(Buffer.from([...CMD.init, ...CMD.codePage])))
  assert.ok(includes(buf, CMD.bold(true)))
  assert.ok(includes(buf, CMD.size(false, true)))
  assert.ok(includes(buf, [0x50, 0x61, 0x64]))            // "Pad"
  assert.ok(includes(buf, [0xa3, 0x39, 0x2e, 0x35, 0x30])) // "£9.50"
  assert.ok(includes(buf, CMD.drawer))
  assert.ok(includes(buf, CMD.cut))
})

test('render: wide text wraps at half the columns', () => {
  const buf = render([{ t: 'text', text: 'ABCDEFGHIJ KLMNOPQRST', wide: true }], { cols: 20 })
  const text = buf.toString('latin1')
  assert.ok(text.includes('ABCDEFGHIJ\n'))
  assert.ok(text.includes('KLMNOPQRST\n'))
})

test('pairLines: right side flush right, long left side wraps', () => {
  assert.deepEqual(pairLines('Total', '£9.50', 20), ['Total          £9.50'])
  const lines = pairLines('Green curry with jasmine rice', '£14.95', 20)
  assert.ok(lines.every(l => l.length <= 20))
  assert.ok(lines.at(-1).endsWith('£14.95'))
})

test('tickets: kitchen shows hold, seat and allergy; receipt subtotal includes add-ons', () => {
  const k = toText(kitchenTicket({
    table: '5', covers: 2, server: 'Ben', sentAt: new Date('2026-10-11T19:30:00'),
    courses: [{ name: 'Mains', hold: true, lines: [{ qty: 1, name: 'Pad Thai', seat: 2, allergies: ['peanuts'] }] }],
  }))
  assert.match(k, /MAINS {2}- HOLD/)
  assert.match(k, /1 x Pad Thai {2}S2/)
  assert.match(k, /ALLERGY: PEANUTS/)
  const lines = [{ qty: 1, name: 'Satay', total: 695, modifiers: [{ text: 'Extra sauce', price: 100 }] }]
  assert.equal(billSubtotal(lines), 795)
  assert.match(toText(receipt({ lines, total: 795 })), /Subtotal\s+£7\.95/)
})

test('print: the printer receives the exact bytes, jobs in order', async () => {
  const p = await fakePrinter()
  const a = render([{ t: 'text', text: 'first' }, { t: 'cut' }])
  const b = render([{ t: 'text', text: 'second' }, { t: 'cut' }])
  await Promise.all([print({ host: '127.0.0.1', port: p.port, data: a }), print({ host: '127.0.0.1', port: p.port, data: b })])
  await new Promise(r => setTimeout(r, 50))
  assert.equal(p.jobs.length, 2)
  assert.ok(p.jobs[0].equals(a))
  assert.ok(p.jobs[1].equals(b))
  p.server.close()
})

test('print: retries until the printer comes back', async () => {
  // Find a free port, then start listening on it only after the first try failed.
  const probe = await fakePrinter()
  const port = probe.port
  await new Promise(r => probe.server.close(r))
  const data = render([{ t: 'text', text: 'retry' }, { t: 'cut' }])
  let late
  setTimeout(async () => {
    late = { jobs: [] }
    late.server = net.createServer(s => {
      const chunks = []
      s.on('data', c => chunks.push(c))
      s.on('end', () => { late.jobs.push(Buffer.concat(chunks)); s.end() })
    }).listen(port, '127.0.0.1')
  }, 300)
  const result = await print({ host: '127.0.0.1', port, data, attempts: 3, timeoutMs: 1000 })
  assert.equal(result.attempts, 2)
  await new Promise(r => setTimeout(r, 50))
  assert.ok(late.jobs[0].equals(data))
  late.server.close()
})

test('print: gives up with a clear message when nothing answers', async () => {
  const probe = await fakePrinter()
  const port = probe.port
  await new Promise(r => probe.server.close(r))
  await assert.rejects(
    print({ host: '127.0.0.1', port, data: Buffer.from('x'), attempts: 1, timeoutMs: 500 }),
    /Printer 127\.0\.0\.1:\d+: ECONNREFUSED/,
  )
})

test('printerStatus: decodes online, paper and cover; null when the printer says nothing', async () => {
  const ok = await fakePrinter({ reply: [0x16, 0x12, 0x12] })
  assert.deepEqual(await printerStatus({ host: '127.0.0.1', port: ok.port, timeoutMs: 500 }),
    { online: true, coverOpen: false, paperNearEnd: false, paperOut: false })
  ok.server.close()

  const low = await fakePrinter({ reply: [0x1e, 0x12, 0x1e] }) // offline, paper near its end
  const s = await printerStatus({ host: '127.0.0.1', port: low.port, timeoutMs: 500 })
  assert.equal(s.online, false)
  assert.equal(s.paperNearEnd, true)
  low.server.close()

  const silent = await fakePrinter()
  assert.equal(await printerStatus({ host: '127.0.0.1', port: silent.port, timeoutMs: 300 }), null)
  silent.server.close()
})

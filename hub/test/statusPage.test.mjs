// The hub's own page on the venue's network (src/statusPage.js): the link
// code and its QR code while not linked, then the cloud, version, printers
// and last tickets; never the hub's secret or what was on a ticket; read only.
// Run: cd hub && npm test

import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { startStatusPage, renderPage, publicState } from '../src/statusPage.js'
import { newState } from '../src/service.js'
import { qrSvg } from '../../shared/qr.js'

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })

test('linking: the code and a QR code of the link address, no secret', async () => {
  const state = newState({ phase: 'linking', version: '1.1.0+abc', secret: 'never-show-this-secret' })
  state.link = { code: 'KQ7-M2D', link_url: 'https://installer.macaroonie.com/link/KQ7-M2D', expires_at: new Date(Date.now() + 15 * 60000).toISOString(), secret: 'pairing-secret-xyz' }
  const port = await freePort()
  const page = await startStatusPage({ port, host: '127.0.0.1', getState: () => state })
  assert.equal(page.port, port)
  const res = await fetch(`http://127.0.0.1:${port}/`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-security-policy'), /default-src 'none'/)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  const html = await res.text()
  assert.ok(html.includes('KQ7-M2D'))
  assert.ok(html.includes('<svg') && html.includes('Link code KQ7-M2D'), 'a QR code')
  assert.ok(!html.includes('never-show-this-secret') && !html.includes('pairing-secret-xyz'))
  // The QR code is the link address.
  assert.ok(html.includes(qrSvg(state.link.link_url, { title: 'Link code KQ7-M2D' })))

  const json = await (await fetch(`http://127.0.0.1:${port}/status.json`)).json()
  assert.equal(json.link.code, 'KQ7-M2D')
  assert.ok(!JSON.stringify(json).includes('secret'))
  assert.equal((await fetch(`http://127.0.0.1:${port}/nope`)).status, 404)
  assert.equal((await fetch(`http://127.0.0.1:${port}/`, { method: 'POST' })).status, 405, 'read only')

  // The port taken: the hub carries on without a page.
  const again = await startStatusPage({ port, host: '127.0.0.1', getState: () => state })
  assert.equal(again, null)
  assert.equal(await startStatusPage({ port: 0, getState: () => state }), null, 'port 0 = no page')
  await page.close()
})

test('running: cloud, version and updates, printers in words, USB printers found, last tickets without their contents', () => {
  const s = newState({ phase: 'running', version: '1.1.0+aaa', name: 'Kitchen hub', venue_name: 'Ware' })
  s.cloud = { ok: true, at: new Date().toISOString(), error: null }
  s.update = { updates: 'auto', available: '1.1.0+bbb', state: 'failed', error: 'The download doesn\'t match its checksum' }
  s.printers = [
    { id: 'a', name: 'Grill', interface: 'network', address: '192.168.1.50:9100', state: { online: true, paperNearEnd: true }, error: null, checked_at: 'x' },
    { id: 'b', name: 'Receipts', interface: 'usb', address: null, state: null, error: 'Printer lp0 isn\'t plugged in', checked_at: 'x' },
    { id: 'c', name: 'Bar <b>', interface: 'network', address: '192.168.1.51:9100', state: { online: true }, error: null, checked_at: 'x' },
  ]
  s.local_printers = [{ id: 'usb:04b8:0e28:X', name: 'EPSON TM-T20III', path: '/dev/usb/lp0', escpos: true }, { id: 'usb:1:2:p', name: 'Odd thing', path: '/dev/usb/lp1', escpos: false }]
  s.recent = [{ at: new Date().toISOString(), kind: 'kitchen', printer: 'Grill', ok: true }, { at: new Date().toISOString(), kind: 'receipt', printer: 'Receipts', ok: false, error: 'Not plugged into the hub' }]
  const html = renderPage(s)
  assert.ok(html.includes('Kitchen hub') && html.includes('Ware'))
  assert.ok(html.includes('Connected'))
  assert.ok(html.includes('The update failed (1.1.0+bbb)') && html.includes('checksum'))
  assert.ok(html.includes('Paper running low'))
  assert.ok(html.includes('USB on this hub') && html.includes('Not answering: Printer lp0'))
  assert.ok(html.includes('Bar &lt;b&gt;') && !html.includes('Bar <b>'), 'names escaped')
  assert.ok(html.includes('EPSON TM-T20III') && html.includes('may not be a receipt printer'))
  assert.ok(html.includes('Kitchen ticket · Grill') && html.includes('Didn\'t print: Not plugged into the hub'))
  assert.equal(html.includes('KQ7'), false, 'no code once linked')

  s.cloud = { ok: false, at: null, error: 'fetch failed' }
  assert.ok(renderPage(s).includes('Can\'t reach it: fetch failed'))
  assert.deepEqual(Object.keys(publicState({ ...s, secret: 'x' })).includes('secret'), false)
})

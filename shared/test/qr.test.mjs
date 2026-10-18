// QR codes (shared/qr.js): the version each length needs at each level (the
// standard's byte-mode capacities), the fixed patterns, the format bits, and
// one known code (checked with a QR reader when it was written).
// Run: node --test shared/test/

import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { qrMatrix, qrSvg } from '../qr.js'

// Byte-mode capacity per version (1-10) at each level, from the standard's table.
const CAPACITY = {
  L: [17, 32, 53, 78, 106, 134, 154, 192, 230, 271],
  M: [14, 26, 42, 62, 84, 106, 122, 152, 180, 213],
  Q: [11, 20, 32, 46, 60, 74, 86, 108, 130, 151],
  H: [7, 14, 24, 34, 44, 58, 64, 84, 98, 119],
}

test('qr: each length takes the smallest version that holds it', () => {
  for (const [ecc, caps] of Object.entries(CAPACITY)) {
    caps.forEach((cap, i) => {
      assert.equal(qrMatrix('x'.repeat(cap), { ecc }).version, i + 1, `${ecc} ${cap} bytes`)
      if (i < 9) assert.equal(qrMatrix('x'.repeat(cap + 1), { ecc }).version, i + 2, `${ecc} ${cap + 1} bytes`)
    })
    assert.throws(() => qrMatrix('x'.repeat(caps[9] + 1), { ecc }), /Too long/)
  }
  // Characters outside ASCII take their UTF-8 bytes.
  assert.equal(qrMatrix('£'.repeat(7)).version, 1)
  assert.equal(qrMatrix('£'.repeat(8)).version, 2)
})

test('qr: finder, timing and format patterns are in place', () => {
  for (const ecc of ['L', 'M', 'Q', 'H']) {
    const { size, modules: m } = qrMatrix('https://installer.example.com/link/ABC-DEF', { ecc })
    // Finder centres and their light ring.
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
      assert.equal(m[cy][cx], true)
      assert.equal(m[cy - 2][cx], false)
      assert.equal(m[cy][cx + 3], true)
    }
    // Timing patterns alternate.
    for (let i = 8; i < size - 8; i++) {
      assert.equal(m[6][i], i % 2 === 0)
      assert.equal(m[i][6], i % 2 === 0)
    }
    assert.equal(m[size - 8][8], true, 'the dark module')
    // Format bits: both copies agree and decode to the level asked for.
    const a = [], b = []
    for (let i = 0; i <= 5; i++) a.push(m[i][8])
    a.push(m[7][8], m[8][8], m[8][7])
    for (let i = 9; i < 15; i++) a.push(m[8][14 - i])
    for (let i = 0; i < 8; i++) b.push(m[8][size - 1 - i])
    for (let i = 8; i < 15; i++) b.push(m[size - 15 + i][8])
    assert.deepEqual(a, b)
    const bits = a.reduce((v, on, i) => v | ((on ? 1 : 0) << i), 0) ^ 0x5412
    assert.equal(bits >> 13, { L: 1, M: 0, Q: 3, H: 2 }[ecc])
    let rem = bits >> 10
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    assert.equal(rem & 0x3ff, bits & 0x3ff, 'BCH check bits')
  }
})

test('qr: a known code stays the same, and the svg draws it', () => {
  const text = 'https://installer.macaroonie.com/link/ABC-DEF'
  const m = qrMatrix(text)
  assert.equal(m.version, 4)
  const s = m.modules.map(r => r.map(v => (v ? 1 : 0)).join('')).join('\n')
  assert.equal(crypto.createHash('sha256').update(s).digest('hex').slice(0, 16), '3c835981e8238bae')
  const svg = qrSvg(text, { margin: 2, title: 'Link "this"' })
  assert.match(svg, /^<svg[^>]+viewBox="0 0 37 37"/)
  assert.match(svg, /aria-label="Link &quot;this&quot;"/)
  const dark = m.modules.flat().filter(Boolean).length
  assert.equal((svg.match(/h1v1h-1z/g) || []).length, dark)
  assert.throws(() => qrMatrix('x', { ecc: 'Z' }), /Unknown error correction/)
})

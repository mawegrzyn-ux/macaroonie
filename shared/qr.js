// QR codes (Model 2, byte mode), no dependencies: devices show their link
// code as one so an installer's phone camera can open it (the installer app,
// installer.<root>/link/<code>). Used by the till app (pos/), the menu screen
// player (screen/, served as /lib/qr.js) and the admin.
//
//   qrMatrix(text, { ecc })  { version, size, modules: [[bool]] }  row by row, true = dark
//   qrSvg(text, opts)        an <svg> string (margin in modules, colours)
//
// Versions 1 to 10 (up to 213 bytes at level M), which covers any link we
// make. Error correction L, M (default), Q or H. The mask is the one with the
// lowest penalty, as the standard asks.

const MAX_VERSION = 10
const ECC_FORMAT = { L: 1, M: 0, Q: 3, H: 2 }
// Error correction codewords per block and number of blocks, versions 0 (unused) to 10.
const ECC_PER_BLOCK = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
  Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
  H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28],
}
const BLOCKS = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
  Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
  H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8],
}

/** Modules left for data and error correction in a version. */
function rawModules(ver) {
  let n = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2
    n -= (25 * align - 10) * align - 55
    if (ver >= 7) n -= 36
  }
  return n
}

const dataCodewords = (ver, ecc) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ecc][ver] * BLOCKS[ecc][ver]

function alignmentPositions(ver, size) {
  if (ver === 1) return []
  const count = Math.floor(ver / 7) + 2
  const step = Math.ceil((ver * 4 + 4) / (count * 2 - 2)) * 2
  const out = [6]
  for (let pos = size - 7; out.length < count; pos -= step) out.splice(1, 0, pos)
  return out
}

// ── Reed-Solomon over GF(256), polynomial 0x11D ─────────────────

function gfMul(x, y) {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}

function rsDivisor(degree) {
  const out = new Array(degree).fill(0)
  out[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < out.length; j++) {
      out[j] = gfMul(out[j], root)
      if (j + 1 < out.length) out[j] ^= out[j + 1]
    }
    root = gfMul(root, 2)
  }
  return out
}

function rsRemainder(data, divisor) {
  const out = divisor.map(() => 0)
  for (const b of data) {
    const factor = b ^ out.shift()
    out.push(0)
    divisor.forEach((c, i) => { out[i] ^= gfMul(c, factor) })
  }
  return out
}

// ── Building the code ───────────────────────────────────────────

function utf8(text) {
  if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(String(text)))
  return Array.from(unescape(encodeURIComponent(String(text))), c => c.charCodeAt(0))
}

/** The data codewords (mode, count, bytes, padding) for a version. */
function dataBytes(bytes, ver, ecc) {
  const bits = []
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1) }
  put(4, 4)                                    // byte mode
  put(bytes.length, ver < 10 ? 8 : 16)
  for (const b of bytes) put(b, 8)
  const cap = dataCodewords(ver, ecc) * 8
  put(0, Math.min(4, cap - bits.length))       // terminator
  while (bits.length % 8) bits.push(0)
  const out = []
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))
  for (let pad = 0xec; out.length < cap / 8; pad ^= 0xec ^ 0x11) out.push(pad)
  return out
}

/** Split into blocks, add error correction, interleave. */
function withEcc(data, ver, ecc) {
  const blocks = BLOCKS[ecc][ver]
  const eccLen = ECC_PER_BLOCK[ecc][ver]
  const raw = Math.floor(rawModules(ver) / 8)
  const shortBlocks = blocks - (raw % blocks)
  const shortLen = Math.floor(raw / blocks)
  const divisor = rsDivisor(eccLen)
  const all = []
  for (let i = 0, k = 0; i < blocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1))
    k += dat.length
    const ecw = rsRemainder(dat, divisor)
    if (i < shortBlocks) dat.push(0)
    all.push(dat.concat(ecw))
  }
  const out = []
  for (let i = 0; i < all[0].length; i++) {
    all.forEach((b, j) => { if (i !== shortLen - eccLen || j >= shortBlocks) out.push(b[i]) })
  }
  return out
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  x => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

function build(codewords, ver, ecc, mask) {
  const size = ver * 4 + 17
  const mod = Array.from({ length: size }, () => new Array(size).fill(false))
  const fn = Array.from({ length: size }, () => new Array(size).fill(false))
  const set = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true }

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0) }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy
        if (x < 0 || y < 0 || x >= size || y >= size) continue
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        set(x, y, d !== 2 && d !== 4)
      }
    }
  }
  const al = alignmentPositions(ver, size)
  al.forEach((ax, i) => al.forEach((ay, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  }))

  // Format bits: error correction level and mask, BCH protected, both copies.
  const fmt = (ECC_FORMAT[ecc] << 3) | mask
  let rem = fmt
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  const fbits = ((fmt << 10) | rem) ^ 0x5412
  const fb = i => ((fbits >>> i) & 1) === 1
  for (let i = 0; i <= 5; i++) set(8, i, fb(i))
  set(8, 7, fb(6)); set(8, 8, fb(7)); set(7, 8, fb(8))
  for (let i = 9; i < 15; i++) set(14 - i, 8, fb(i))
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, fb(i))
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, fb(i))
  set(8, size - 8, true)

  if (ver >= 7) {
    let r = ver
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25)
    const vbits = (ver << 12) | r
    for (let i = 0; i < 18; i++) {
      const bit = ((vbits >>> i) & 1) === 1
      const a = size - 11 + (i % 3), b = Math.floor(i / 3)
      set(a, b, bit); set(b, a, bit)
    }
  }

  // Data in the zigzag, then the mask on everything that isn't a pattern.
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const up = ((right + 1) & 2) === 0
        const y = up ? size - 1 - vert : vert
        if (!fn[y][x] && i < codewords.length * 8) {
          mod[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1
          i++
        }
      }
    }
  }
  const m = MASKS[mask]
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && m(x, y)) mod[y][x] = !mod[y][x]
  return mod
}

/** The standard's penalty for a finished symbol (lower is easier to read). */
function penalty(mod) {
  const size = mod.length
  let score = 0
  const runs = line => {
    let s = 0, len = 1
    for (let i = 1; i <= line.length; i++) {
      if (i < line.length && line[i] === line[i - 1]) { len++; continue }
      if (len >= 5) s += 3 + (len - 5)
      len = 1
    }
    return s
  }
  const finderLike = line => {
    let s = 0
    const str = line.map(v => (v ? '1' : '0')).join('')
    for (const pat of ['10111010000', '00001011101']) {
      let at = str.indexOf(pat)
      while (at >= 0) { s += 40; at = str.indexOf(pat, at + 1) }
    }
    return s
  }
  for (let y = 0; y < size; y++) { score += runs(mod[y]) + finderLike(mod[y]) }
  for (let x = 0; x < size; x++) {
    const col = mod.map(r => r[x])
    score += runs(col) + finderLike(col)
  }
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = mod[y][x]
      if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) score += 3
    }
  }
  const dark = mod.reduce((n, r) => n + r.filter(Boolean).length, 0)
  const total = size * size
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10
  return score
}

/** A QR code for `text`: { version, size, modules } (modules[y][x], true = dark). */
export function qrMatrix(text, { ecc = 'M' } = {}) {
  if (!ECC_FORMAT.hasOwnProperty(ecc)) throw new Error('Unknown error correction level ' + ecc)
  const bytes = utf8(text)
  let ver = 1
  while (ver <= MAX_VERSION && 4 + (ver < 10 ? 8 : 16) + bytes.length * 8 > dataCodewords(ver, ecc) * 8) ver++
  if (ver > MAX_VERSION) throw new Error('Too long for a QR code here (' + bytes.length + ' bytes)')
  const codewords = withEcc(dataBytes(bytes, ver, ecc), ver, ecc)
  let best = null
  for (let mask = 0; mask < 8; mask++) {
    const mod = build(codewords, ver, ecc, mask)
    const p = penalty(mod)
    if (!best || p < best.p) best = { mod, p }
  }
  return { version: ver, size: ver * 4 + 17, modules: best.mod }
}

/** The code as an SVG string, one path, crisp at any size. */
export function qrSvg(text, { ecc = 'M', margin = 4, dark = '#000000', light = '#ffffff', title = '' } = {}) {
  const { size, modules } = qrMatrix(text, { ecc })
  const full = size + margin * 2
  let d = ''
  modules.forEach((row, y) => row.forEach((on, x) => { if (on) d += 'M' + (x + margin) + ' ' + (y + margin) + 'h1v1h-1z' }))
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + full + ' ' + full + '" shape-rendering="crispEdges" role="img"' +
    (title ? ' aria-label="' + esc(title) + '"' : '') + '>' +
    '<rect width="' + full + '" height="' + full + '" fill="' + esc(light) + '"/>' +
    '<path d="' + d + '" fill="' + esc(dark) + '"/></svg>'
}

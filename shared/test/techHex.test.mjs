import { test } from 'node:test'
import assert from 'node:assert/strict'
import { techModel, TONES, TONE_MARKS, TECH_KINDS } from '../techBoard.js'
import {
  hexSpiral, hexCentre, honeycomb, fitSize, honeycombHtml, honeycombParts, styleText, legendHtml, attentionHtml, sampleTechTiles,
  MARKS, HEX_COLOURS, HEALTH_SCALE, TECH_ICONS, TECH_HEX_CSS, HUB_COPY_KEY,
} from '../techHex.js'

const now = Date.parse('2026-11-28T12:00:00Z')
const SQ3 = Math.sqrt(3)

test('a spiral is compact: the centre, then ring by ring, each cell a neighbour of one before it', () => {
  assert.deepEqual(hexSpiral(0), [])
  assert.deepEqual(hexSpiral(1), [[0, 0]])
  const s = hexSpiral(19)
  assert.equal(new Set(s.map(c => c.join(','))).size, 19)
  const ring = ([q, r]) => Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r))
  assert.deepEqual(s.map(ring), [0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2])
  for (let i = 1; i < s.length; i++) {
    const near = s.slice(0, i).some(([q, r]) => ring([s[i][0] - q, s[i][1] - r]) === 1)
    assert.ok(near, 'cell ' + i + ' touches the cluster')
  }
})

function model(n = 14) {
  return techModel(sampleTechTiles(now).slice(0, n), { light: 'up' })
}

// Two flat-topped hexagons (centres, circumradii) overlap unless one of their
// edge normals separates them (the separating axis test: both have the same
// three edge directions, at 90, 30 and -30 degrees, and each reaches its
// inradius, sqrt(3)/2 x its radius, along every one). Touching is not overlapping.
const NORMALS = [[0, 1], [SQ3 / 2, 0.5], [SQ3 / 2, -0.5]]
function hexesOverlap(a, b) {
  const reach = (a.scale + b.scale) * SQ3 / 2
  return NORMALS.every(([nx, ny]) => Math.abs((b.x - a.x) * nx + (b.y - a.y) * ny) < reach - 1e-6)
}

test('the overlap test catches hexagons that only a centre distance would pass', () => {
  const c = (x, y, scale = 1) => ({ x, y, scale })
  assert.ok(hexesOverlap(c(0, 0), c(1.8, 0)), 'side by side 1.8 apart: each reaches 1 along x')
  assert.ok(!hexesOverlap(c(0, 0), c(2, 0)), 'side by side 2 apart: touching corners')
  const grid = (q, r) => ({ ...hexCentre(q, r), scale: 1 })
  for (const [q, r] of [[1, 0], [0, 1], [1, -1], [-1, 1], [2, -1]]) assert.ok(!hexesOverlap(c(0, 0), grid(q, r)), 'grid cells ' + q + ',' + r + ' touch or are apart')
  assert.ok(hexesOverlap(c(0, 0), c(1.4, 0.5)), 'a little closer than a neighbour')
  assert.ok(hexesOverlap(c(0, 0, HEALTH_SCALE), grid(1, 0)), 'the bigger health hexagon reaches further')
})

function noOverlap(layout) {
  const cells = layout.cells
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i], b = cells[j]
      assert.ok(!hexesOverlap(a, b), a.key + ' and ' + b.key + ' overlap (' + a.x.toFixed(2) + ',' + a.y.toFixed(2) + ' / ' + b.x.toFixed(2) + ',' + b.y.toFixed(2) + ')')
    }
  }
  for (const c of cells) {
    assert.ok(c.x - c.scale >= -1e-6 && c.x + c.scale <= layout.width + 1e-6, c.key + ' inside the width')
    assert.ok(c.y - c.scale * SQ3 / 2 >= -1e-6 && c.y + c.scale * SQ3 / 2 <= layout.height + 1e-6, c.key + ' inside the height')
  }
}

test('positions: every tile once, nothing overlaps, groups side by side, the health hexagon first', () => {
  const m = model()
  for (const aspect of [16 / 9, 4 / 3, 1, 0.6, 3]) {
    const l = honeycomb(m, { aspect })
    assert.equal(l.cells.length, m.tiles.length + 1)
    assert.deepEqual(new Set(l.cells.map(c => c.key)), new Set(['health', ...m.tiles.map(t => t.key)]))
    noOverlap(l)
    const h = l.cells.find(c => c.key === 'health')
    assert.equal(h.scale, HEALTH_SCALE)
    assert.ok(l.cells.filter(c => c.key !== 'health').every(c => c.scale === 1))
    assert.deepEqual(l.labels.map(x => x.group), m.groups.map(g => g.key), 'a name over each group')
  }
  // Wide boxes get a wide honeycomb, tall boxes a tall one.
  const wide = honeycomb(m, { aspect: 16 / 9 })
  const tall = honeycomb(m, { aspect: 9 / 16 })
  assert.ok(wide.width / wide.height > tall.width / tall.height)
  // A page that scrolls wraps at its width.
  const narrow = honeycomb(m, { maxWidth: 7 })
  noOverlap(narrow)
  assert.ok(narrow.width <= 7 + 1e-6 && narrow.height > wide.height)
  // Each group's tiles sit together, the worst in the middle of its cluster.
  const tills = m.groups.find(g => g.key === 'till')
  const cells = l => tills.tiles.map(t => l.cells.find(c => c.key === t.key))
  const [first, ...rest] = cells(wide)
  const cx = rest.reduce((s, c) => s + c.x, first.x) / tills.tiles.length
  assert.equal(tills.tiles[0].tone, 'bad', 'the worst till first')
  assert.ok(Math.abs(first.x - hexCentre(0, 0).x - cx) < 1.6, 'first one in the middle')
  assert.deepEqual(honeycomb(techModel([]), { health: false }), { width: 0, height: 0, cells: [], labels: [] })
})

test('the radius that fits a box', () => {
  const l = honeycomb(model(), { aspect: 16 / 9 })
  const s = fitSize(l, 1600, 900, 400)
  assert.ok(l.width * s <= 1600 + 1e-6 && l.height * s <= 900 + 1e-6)
  assert.ok(Math.abs(l.width * s - 1600) < 1e-6 || Math.abs(l.height * s - 900) < 1e-6, 'fills one side')
  assert.equal(fitSize(l, 1e6, 1e6, 90), 90, 'never bigger than the most')
})

test('every tone has a mark and every kind an icon; the words are readable on each fill', () => {
  for (const t of TONES) assert.ok(MARKS[TONE_MARKS[t]]?.length, 'a mark for ' + t)
  for (const k of ['hub', 'till', 'kitchen', 'kiosk', 'printer', 'card', 'screen', 'health']) assert.ok(TECH_ICONS[k]?.length, k)
  const lum = hex => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  for (const theme of ['light', 'dark']) {
    for (const t of TONES) {
      const [fill, ink] = HEX_COLOURS[theme][t]
      assert.ok(contrast(fill, ink) >= 4.5, theme + ' ' + t + ': ' + contrast(fill, ink).toFixed(2))
    }
  }
  // Each kind's ring is a graphic that has to be seen: 3 : 1 at least on the
  // light page and on the dark boards (the page's dark card, full screen).
  for (const k of TECH_KINDS) {
    for (const bg of ['#ffffff', '#0f172a', '#0b1220']) {
      assert.ok(contrast(k.colour, bg) >= 3, k.key + ' ring on ' + bg + ': ' + contrast(k.colour, bg).toFixed(2))
    }
  }
})

test('the HTML: a tile per piece of kit with its tone, kind, mark and words; names stay text', () => {
  const tiles = sampleTechTiles(now)
  tiles[1] = { ...tiles[1], name: '<script>alert("x")</script> & "Till"' }
  const m = techModel(tiles, { light: 'up' })
  const l = honeycomb(m, { aspect: 16 / 9 })
  const html = honeycombHtml(m, l, { size: 50, now, interactive: true })
  assert.ok(!html.includes('<script'), 'no tag from a name')
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;Till&quot;'))
  assert.equal((html.match(/data-tile="/g) || []).length, tiles.length + 1)
  assert.equal((html.match(/<button type="button"/g) || []).length, tiles.length + 1, 'tiles are buttons on the page')
  assert.ok(html.includes('data-tone="bad" data-kind="till"'))
  assert.ok(html.includes('Drive thru, Till: Offline, seen 6 min ago'), 'an offline tile\'s label says when it was last seen')
  assert.ok(html.includes('<span class="hx-seen">6 min ago</span>'), 'the line on the hexagon is the short form, to fit')
  assert.ok(html.includes('2 failed'))
  assert.ok(html.includes('pathLength="100" stroke-dasharray="90 100"'), 'the hub\'s copy ring')
  assert.ok(html.includes('1 of 3 up') || html.includes('2 of 3 up'), 'a group badge')
  const still = honeycombHtml(m, l, { size: 50, now, names: false })
  assert.ok(!still.includes('<button') && !still.includes('hx-name'), 'plain tiles, no names')
  assert.ok(!legendHtml(m).includes('<script') && legendHtml(m).includes('Kitchen screens'))
  const strip = attentionHtml(m, now)
  assert.ok(strip.includes('Needs attention') && strip.includes('Drive thru') && strip.indexOf('Drive thru') < strip.indexOf('Kiosk 2'), 'worst first')
  assert.ok(!strip.includes('<script'))
  assert.ok(attentionHtml(techModel(tiles.filter(t => t.tone === 'ok'), { light: 'up' }), now).includes('Everything is working'))
  assert.ok(strip.includes('seen 6 min ago'), 'the strip keeps the long words')
  assert.match(TECH_HEX_CSS, /prefers-reduced-motion: reduce/)
})

test('the parts: the same hexagons as the HTML, each with its key, for a page that keeps each one', () => {
  const m = model()
  const l = honeycomb(m, { aspect: 16 / 9 })
  const opts = { size: 50, now, selected: 'health' }
  const p = honeycombParts(m, l, opts)
  assert.deepEqual(p.tiles.map(t => t.key), l.cells.map(c => c.key), 'in the layout\'s order')
  assert.deepEqual(p.labels.map(x => x.key), m.groups.map(g => g.key))
  assert.ok(p.tiles.every(t => t.label && t.html.startsWith('<svg class="hx-shape"') && !t.html.includes('<button')))
  assert.deepEqual([p.tiles[0].key, p.tiles[0].selected, p.tiles[0].cls], ['health', true, 'hx-tile hx-health is-on'])
  // Only what is inside a hexagon changes as the clock ticks: its box, key and kind stay.
  const later = honeycombParts(m, l, { ...opts, now: now + 3 * 60_000 })
  assert.deepEqual(later.tiles.map(t => [t.key, t.cls, t.tone, t.kind, styleText(t.style)]), p.tiles.map(t => [t.key, t.cls, t.tone, t.kind, styleText(t.style)]))
  const drive = (x) => x.tiles.find(t => t.key.startsWith('till:') && t.tone === 'bad')
  assert.notEqual(drive(later).html, drive(p).html, 'its "6 min ago" moved on')
  // The HTML is the parts put together.
  const html = honeycombHtml(m, l, { ...opts, interactive: true })
  for (const t of p.tiles) assert.ok(html.includes('data-tile="' + t.key + '"') && html.includes(t.html))
  assert.ok(html.startsWith('<div class="' + p.cls + '" style="' + styleText(p.style) + '">'))
})

test('only the hexagon takes a tap, not the corners of its box', () => {
  // Diagonal neighbours' boxes overlap by half a radius: the button lets taps
  // through and the hexagon (.hx-focus, inside it) takes them.
  assert.match(TECH_HEX_CSS, /button\.hx-tile \{[^}]*pointer-events: none/)
  assert.match(TECH_HEX_CSS, /button\.hx-tile \.hx-focus \{[^}]*pointer-events: fill/)
  // The down glow is a drop shadow outside the hexagon: nothing clips the tile.
  assert.doesNotMatch(TECH_HEX_CSS, /\.hx-tile \{[^}]*clip-path/)
  // The bottom line keeps inside the hexagon's narrow part.
  assert.match(TECH_HEX_CSS, /\.hx-seen \{[^}]*max-width: 70%; overflow: hidden; text-overflow: ellipsis/)
})

test('the key explains the hub\'s inner ring when a hub has one', () => {
  const m = model()
  assert.ok(m.tiles.some(t => t.ring))
  const words = HUB_COPY_KEY.replace(/'/g, '&#39;')
  assert.ok(legendHtml(m).includes(words) && legendHtml(m).includes('class="hx-copy"'))
  const noHub = techModel(sampleTechTiles(now).filter(t => t.kind !== 'hub'), { light: 'up' })
  assert.ok(!legendHtml(noHub).includes(words))
})

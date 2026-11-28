// shared/techHex.js
//
// The honeycomb store status board (28 Nov 2026): the tile model of
// shared/techBoard.js (techModel()) drawn as hexagons. One drawing for every
// place that shows it: Store tech's Tech board and its full screen view
// (admin/src/components/pos/TechHoneycomb.jsx puts the HTML in the page) and
// the menu screen Store status block (shared/screenLayout.js, a string
// renderer the player and the board designer share). Plain ESM, no DOM.
//
//   honeycomb(model, { aspect | maxWidth })   where each hexagon goes, in
//       units of a hexagon's radius: one compact spiral per kind of kit (the
//       first tile, the worst, in the middle), the clusters side by side in
//       rows that fill a box of that shape (aspect) or wrap at a width
//       (maxWidth), the health hexagon first. -> { width, height, cells, labels }
//   fitSize(layout, w, h, max)   the radius in px that fits a box
//   honeycombHtml(model, layout, opts)   the hexagons as HTML (each an SVG
//       hexagon: the fill is the state, the ring the kind of kit, a mark
//       for the state so it never reads by colour alone)
//   legendHtml(model), attentionHtml(model, now)   the key and the strip
//   TECH_HEX_CSS   the look (custom properties --hx-* for the colours)
//
// Flat-topped hexagons with axial coordinates (q, r): centre x = 1.5 q,
// y = sqrt(3) (r + q / 2), radius 1.

import { TECH_KIND, TONE_MARKS, TONE_LABELS, TONES, seenText } from './techBoard.js'

const SQ3 = Math.sqrt(3)
// Axial neighbours, in the order a ring is walked.
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]
/** The health hexagon's size against the others. */
export const HEALTH_SCALE = 1.3
// Room above a cluster for its name and badge, the space between clusters
// and the narrowest a cluster's box may be (for its name), in radii.
const LABEL_H = 0.78
const GAP = 0.55
const MIN_BOX = 2.6

/** n cells in a compact spiral around (0, 0): the centre, then ring by ring. */
export function hexSpiral(n) {
  const out = n > 0 ? [[0, 0]] : []
  for (let radius = 1; out.length < n; radius++) {
    let q = DIRS[4][0] * radius
    let r = DIRS[4][1] * radius
    for (let side = 0; side < 6 && out.length < n; side++) {
      for (let step = 0; step < radius && out.length < n; step++) {
        out.push([q, r])
        q += DIRS[side][0]
        r += DIRS[side][1]
      }
    }
  }
  return out
}

/** A hexagon's centre from its axial coordinates (radius 1). */
export const hexCentre = (q, r) => ({ x: 1.5 * q, y: SQ3 * (r + q / 2) })

function cluster(key, items, scale = 1, label = true) {
  const cells = hexSpiral(items.length).map(([q, r], i) => ({ key: items[i], ...hexCentre(q, r), scale }))
  const minX = Math.min(...cells.map(c => c.x)) - scale
  const maxX = Math.max(...cells.map(c => c.x)) + scale
  const minY = Math.min(...cells.map(c => c.y)) - scale * SQ3 / 2
  const maxY = Math.max(...cells.map(c => c.y)) + scale * SQ3 / 2
  const w = Math.max(maxX - minX, label ? MIN_BOX : 0)
  const hexH = maxY - minY
  return { key, cells, minX, minY, hexW: maxX - minX, hexH, w, h: hexH + (label ? LABEL_H : 0), label }
}

// Clusters in rows no wider than rowW: { rows, width, height }.
function pack(clusters, rowW) {
  const rows = []
  let row = null
  for (const c of clusters) {
    if (!row || (row.items.length && row.w + GAP + c.w > rowW + 1e-9)) { row = { items: [], w: 0, h: 0 }; rows.push(row) }
    row.w += (row.items.length ? GAP : 0) + c.w
    row.h = Math.max(row.h, c.h)
    row.items.push(c)
  }
  const width = Math.max(0, ...rows.map(r => r.w))
  const height = rows.reduce((s, r) => s + r.h, 0) + Math.max(0, rows.length - 1) * GAP
  return { rows, width, height }
}

/**
 * Where each hexagon goes. model: techModel(). aspect: the box's width over
 * its height (fill it as well as can be); maxWidth: wrap at this width in
 * radii instead (a page that scrolls). health: draw the health hexagon.
 * -> { width, height, cells: [{ key, group, x, y, scale }], labels: [{ group,
 * x, y, w }] } with x, y each hexagon's centre (labels: top left), in radii.
 */
export function honeycomb(model, { aspect = 16 / 9, maxWidth = null, health = true, labels = true } = {}) {
  const clusters = []
  if (health) clusters.push(cluster('health', ['health'], HEALTH_SCALE, false))
  for (const g of model?.groups || []) clusters.push(cluster(g.key, g.tiles.map(t => t.key), 1, labels))
  if (!clusters.length) return { width: 0, height: 0, cells: [], labels: [] }
  let best
  if (maxWidth != null) {
    best = pack(clusters, Math.max(maxWidth, ...clusters.map(c => c.w)))
  } else {
    // Try every row width a first row could have; keep the one that lets
    // the hexagons be biggest in the box, then the one with fewer rows.
    const widest = Math.max(...clusters.map(c => c.w))
    const tries = new Set([widest])
    let run = 0
    clusters.forEach((c, i) => { run += (i ? GAP : 0) + c.w; tries.add(Math.max(run, widest)) })
    let bestScale = -1
    for (const w of [...tries].sort((a, b) => b - a)) {
      const p = pack(clusters, w)
      const scale = Math.min(aspect / p.width, 1 / p.height)
      if (scale > bestScale + 1e-9) { best = p; bestScale = scale }
    }
  }
  const cells = []
  const labelsOut = []
  let y = 0
  for (const row of best.rows) {
    let x = (best.width - row.w) / 2
    for (const c of row.items) {
      // Names on one line; a cluster without a name (health) sits in the middle of its row.
      const top = y + (c.label ? 0 : (row.h - c.h) / 2)
      const hexTop = top + (c.label ? LABEL_H : 0)
      const dx = x + (c.w - c.hexW) / 2 - c.minX
      const dy = hexTop - c.minY
      for (const cell of c.cells) cells.push({ key: cell.key, group: c.key, x: cell.x + dx, y: cell.y + dy, scale: cell.scale })
      if (c.label) labelsOut.push({ group: c.key, x, y: top, w: c.w })
      x += c.w + GAP
    }
    y += row.h + GAP
  }
  return { width: best.width, height: best.height, cells, labels: labelsOut }
}

/** The radius in px that fits a layout into w x h, at most max. */
export function fitSize(layout, w, h, max = 160) {
  if (!layout?.width || !layout?.height) return max
  return Math.max(4, Math.min(max, w / layout.width, h / layout.height))
}

// ── Drawing ────────────────────────────────────────────────

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/**
 * The kit's icons (Lucide, ISC licence: server, monitor-smartphone,
 * cooking-pot, tablet-smartphone, printer, credit-card, monitor, activity,
 * cloud), as [tag, attributes] on a 24 x 24 grid, drawn with the line colour.
 */
export const TECH_ICONS = {
  hub: [['rect', { width: 20, height: 8, x: 2, y: 2, rx: 2 }], ['rect', { width: 20, height: 8, x: 2, y: 14, rx: 2 }], ['path', { d: 'M6 6h.01M6 18h.01' }]],
  till: [['path', { d: 'M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8' }], ['path', { d: 'M10 19v-3.96 3.15' }], ['path', { d: 'M7 19h5' }], ['rect', { width: 6, height: 10, x: 16, y: 12, rx: 2 }]],
  kitchen: [['path', { d: 'M2 12h20' }], ['path', { d: 'M20 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8' }], ['path', { d: 'm4 8 16-4' }], ['path', { d: 'm8.86 6.78-.45-1.81a2 2 0 0 1 1.45-2.43l1.94-.48a2 2 0 0 1 2.43 1.46l.45 1.8' }]],
  kiosk: [['rect', { width: 10, height: 14, x: 3, y: 8, rx: 2 }], ['path', { d: 'M5 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2h-2.4' }], ['path', { d: 'M8 18h.01' }]],
  printer: [['path', { d: 'M6 9V2h12v7' }], ['path', { d: 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2' }], ['rect', { width: 12, height: 8, x: 6, y: 14 }]],
  card: [['rect', { width: 20, height: 14, x: 2, y: 5, rx: 2 }], ['path', { d: 'M2 10h20' }]],
  screen: [['rect', { width: 20, height: 14, x: 2, y: 3, rx: 2 }], ['path', { d: 'M8 21h8M12 17v4' }]],
  health: [['path', { d: 'M22 12h-4l-3 9L9 3l-3 9H2' }]],
  platform: [['path', { d: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z' }]],
}

/** Each tone's mark: a tick, an exclamation, a cross, a dash (24 x 24, line colour). */
export const MARKS = {
  tick: [['path', { d: 'M19 7 10 16l-4.5-4.5' }]],
  bang: [['path', { d: 'M12 6.5v6.5' }], ['path', { d: 'M12 17.5h.01' }]],
  cross: [['path', { d: 'M17 7 7 17M7 7l10 10' }]],
  dash: [['path', { d: 'M7 12h10' }]],
}

const attrs = a => Object.entries(a).map(([k, v]) => ' ' + k + '="' + esc(v) + '"').join('')
const nodes = list => (list || []).map(([tag, a]) => '<' + tag + attrs(a) + '/>').join('')
const svg = (cls, list) => '<svg class="' + cls + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + nodes(list) + '</svg>'
export const iconSvg = (key, cls = 'hx-icon') => svg(cls, TECH_ICONS[key] || TECH_ICONS.health)
export const markSvg = (tone, cls = 'hx-mark') => svg(cls, MARKS[TONE_MARKS[tone] || 'dash'])

// A flat-topped hexagon's corners at radius r (the SVG is 200 x 173.2 around 0, 0).
const R = 100
const H = R * SQ3 / 2
export const hexPoints = r => [[r, 0], [r / 2, r * SQ3 / 2], [-r / 2, r * SQ3 / 2], [-r, 0], [-r / 2, -r * SQ3 / 2], [r / 2, -r * SQ3 / 2]]
  .map(([x, y]) => x.toFixed(1) + ',' + y.toFixed(1)).join(' ')
const poly = (cls, r, extra = '') => '<polygon class="' + cls + '" points="' + hexPoints(r) + '"' + extra + '/>'

/**
 * The ring that says which kind of kit a hexagon is (TECH_KINDS line). k:
 * how much thicker to draw it (the legend's small swatches).
 */
export function ringSvg(line, k = 1) {
  const n = v => Math.round(v * k * 10) / 10
  if (line === 'double') return poly('hx-ring', 100 - n(3), ' stroke-width="' + n(3.5) + '"') + poly('hx-ring', 100 - n(10.5), ' stroke-width="' + n(3.5) + '"')
  const dash = { dash: [24, 11], dot: [0.1, 12], dashdot: [22, 8, 2, 8], short: [9, 8] }[line]
  const width = line === 'thick' ? 10 : line === 'dot' ? 8 : 6
  return poly('hx-ring', 100 - n(line === 'thick' ? 7 : 6), ' stroke-width="' + n(width) + '"' + (dash ? ' stroke-dasharray="' + dash.map(n).join(' ') + '"' : '') +
    (line === 'dot' ? ' stroke-linecap="round"' : ''))
}

function shapeSvg(kind, { health = false, ring = null } = {}) {
  const k = TECH_KIND[kind]
  let h = '<svg class="hx-shape" viewBox="' + -R + ' ' + (-H).toFixed(1) + ' ' + 2 * R + ' ' + (2 * H).toFixed(1) + '" aria-hidden="true" focusable="false">'
  h += poly('hx-focus', 99, ' stroke-width="5"')
  h += health ? poly('hx-ring hx-ring-health', 94, ' stroke-width="6"') : ringSvg(k?.line)
  h += poly('hx-fill', health ? 86 : 84)
  // The hub's copy for trading offline: a thin ring inside, as full as the copy is current.
  if (ring) h += poly('hx-copy', 76, ' pathLength="100" stroke-dasharray="' + Math.round(ring.fresh * 100) + ' 100"')
  return h + '</svg>'
}

const px = n => Math.round(n * 10) / 10 + 'px'

/**
 * The honeycomb as HTML. size: a hexagon's radius in px. interactive: each
 * tile a button (data-tile = its key) for the page to open; else plain.
 * names: show each tile's name. selected: the key of the open tile.
 */
export function honeycombHtml(model, layout, { size = 60, now = Date.now(), interactive = false, names = true, selected = null, anim = true, dark = false } = {}) {
  const s = size
  const byKey = Object.fromEntries((model?.tiles || []).map(t => [t.key, t]))
  const groups = Object.fromEntries((model?.groups || []).map(g => [g.key, g]))
  let h = '<div class="hx' + (anim ? ' hx-anim' : '') + (dark ? ' is-dark' : '') + '" style="--hx-s:' + px(s) + ';width:' + px(layout.width * s) + ';height:' + px(layout.height * s) + '">'
  for (const l of layout.labels) {
    const g = groups[l.group]
    if (!g) continue
    h += '<div class="hx-label" data-group="' + esc(g.key) + '" style="left:' + px(l.x * s) + ';top:' + px(l.y * s) + ';width:' + px(l.w * s) + '">' +
      '<span class="hx-gname">' + esc(g.label) + '</span> <span class="hx-badge" data-tone="' + g.tone + '">' + esc(g.badge) + '</span></div>'
  }
  for (const c of layout.cells) {
    const box = 'left:' + px((c.x - c.scale) * s) + ';top:' + px((c.y - c.scale * SQ3 / 2) * s) + ';width:' + px(2 * c.scale * s) + ';height:' + px(SQ3 * c.scale * s)
    const open = interactive ? '<button type="button"' : '<div'
    const close = interactive ? '</button>' : '</div>'
    if (c.key === 'health') {
      const hl = model.health
      const label = 'Overall: ' + hl.title + '. ' + hl.words + (hl.platform ? '. ' + hl.platform.text : '')
      h += open + ' class="hx-tile hx-health" data-tile="health" data-tone="' + hl.tone + '" style="' + box + '" aria-label="' + esc(label) + '">' +
        shapeSvg(null, { health: true }) + '<span class="hx-in" style="font-size:' + px(s * c.scale) + '">' + iconSvg('health') +
        '<span class="hx-title">' + markSvg(hl.tone) + esc(hl.title) + '</span><span class="hx-counts">' + esc(hl.words) + '</span>' +
        (hl.platform ? '<span class="hx-plat" data-tone="' + hl.platform.tone + '">' + iconSvg('platform', 'hx-picon') + 'Macaroonie ' + esc(hl.platform.word.toLowerCase()) + '</span>' : '') +
        '</span>' + close
      continue
    }
    const t = byKey[c.key]
    if (!t) continue
    const seen = seenText(t, now)
    const kind = TECH_KIND[t.kind]
    const label = t.name + ', ' + kind.one + ': ' + t.word + (seen ? ', ' + seen : '')
    h += open + ' class="hx-tile' + (selected === t.key ? ' is-on' : '') + '" data-tile="' + esc(t.key) + '" data-tone="' + t.tone + '" data-kind="' + t.kind + '" style="' + box + '"' +
      (interactive ? ' aria-label="' + esc(label) + '"' + (selected === t.key ? ' aria-pressed="true"' : ' aria-pressed="false"') : ' title="' + esc(label) + '"') + '>' +
      shapeSvg(t.kind, { ring: t.ring }) + '<span class="hx-in">' + iconSvg(t.icon || kind.icon) +
      (names ? '<span class="hx-name">' + esc(t.name) + '</span>' : '') +
      '<span class="hx-word">' + markSvg(t.tone) + '<span>' + esc(t.word) + '</span></span>' +
      (seen ? '<span class="hx-seen">' + esc(seen) + '</span>' : '') + '</span>' + close
  }
  return h + '</div>'
}

/** The key: each kind of kit's ring, each state's fill and mark. Only the kinds the board has. */
export function legendHtml(model, { tones = true } = {}) {
  let h = '<div class="hx-legend">'
  for (const g of model?.groups || []) {
    h += '<span class="hx-key" data-kind="' + esc(g.key) + '"><svg class="hx-swatch" viewBox="-100 -86.6 200 173.2" aria-hidden="true" focusable="false">' + ringSvg(g.line, 2.6) +
      '</svg><span>' + esc(g.label) + '</span></span>'
  }
  if (tones) {
    for (const tone of ['ok', 'warn', 'bad', 'muted']) {
      h += '<span class="hx-key hx-tkey" data-tone="' + tone + '">' + markSvg(tone, 'hx-mark hx-kmark') + esc(TONE_LABELS[tone]) + '</span>'
    }
  }
  return h + '</div>'
}

/** The strip of what needs someone, worst first (at most max), or that all is well. */
export function attentionHtml(model, now = Date.now(), { max = 6 } = {}) {
  const list = model?.attention || []
  if (!list.length) {
    const ok = model?.health?.tone === 'ok'
    return '<div class="hx-attn" data-tone="' + (ok ? 'ok' : 'muted') + '">' + markSvg(ok ? 'ok' : 'muted', 'hx-mark hx-kmark') +
      '<span>' + (ok ? 'Everything is working' : esc(model?.health?.words || '')) + '</span></div>'
  }
  const shown = list.slice(0, max).map(t => {
    const seen = seenText(t, now)
    return '<span class="hx-aitem" data-tone="' + t.tone + '">' + markSvg(t.tone, 'hx-mark hx-kmark') + '<strong>' + esc(t.name) + '</strong> ' +
      esc(t.word) + (seen ? ' · ' + esc(seen) : '') + '</span>'
  })
  const more = list.length > max ? '<span class="hx-aitem">and ' + (list.length - max) + ' more</span>' : ''
  return '<div class="hx-attn" data-tone="' + list[0].tone + '"><span class="hx-ahead">Needs attention</span>' + shown.join('') + more + '</div>'
}

/** Example kit for the board designer (as the Order status block shows example numbers). */
export function sampleTechTiles(now = Date.now()) {
  const ago = m => new Date(now - m * 60_000).toISOString()
  const t = (kind, name, tone, word, extra = {}) => ({ kind, name, tone, word, seen_at: ago(1), count: 0, ring: null, ...extra })
  return [
    t('hub', 'Back office hub', 'ok', 'Online', { ring: { fresh: 0.9 } }),
    t('till', 'Counter 1', 'ok', 'Online'), t('till', 'Counter 2', 'ok', 'Online'), t('till', 'Drive thru', 'bad', 'Offline', { seen_at: ago(6) }),
    t('kitchen', 'Grill', 'ok', 'Online'), t('kitchen', 'Pass', 'ok', 'Online'),
    t('kiosk', 'Kiosk 1', 'ok', 'Online'), t('kiosk', 'Kiosk 2', 'warn', 'Waiting'),
    t('printer', 'Kitchen printer', 'warn', '2 failed', { count: 2 }), t('printer', 'Receipts', 'ok', 'Ready'),
    t('card', 'Card machine', 'ok', 'Working'),
    t('screen', 'Menu left', 'ok', 'Online'), t('screen', 'Menu right', 'ok', 'Online'), t('screen', 'Order board', 'muted', 'Not linked'),
  ]
}

/** Only these tones exist; every one has a mark (the tests check). */
export const HEX_TONES = TONES

/**
 * Each state's fill and the colour of its words (the same in light and
 * dark, but for Not linked), and the words' contrast is checked in the
 * tests (at least 4.5 : 1).
 */
export const HEX_COLOURS = {
  light: { ok: ['#15803d', '#ffffff'], warn: ['#fbbf24', '#1c1917'], bad: ['#b91c1c', '#ffffff'], muted: ['#cbd5e1', '#1e293b'] },
  dark: { ok: ['#15803d', '#ffffff'], warn: ['#fbbf24', '#1c1917'], bad: ['#b91c1c', '#ffffff'], muted: ['#475569', '#f1f5f9'] },
}

const toneVars = (pal) => Object.entries(pal).map(([tone, [fill, ink]]) => '--hx-' + tone + ':' + fill + ';--hx-' + tone + '-ink:' + ink).join(';')
const kindRules = Object.values(TECH_KIND).map(k => '.hx-tile[data-kind="' + k.key + '"], .hx-key[data-kind="' + k.key + '"] { --hx-kc: ' + k.colour + '; }').join('\n')

/** The honeycomb's look. Colours: --hx-text, --hx-sub (labels), --hx-focus; .is-dark for a dark page. */
export const TECH_HEX_CSS = `
.hx { position: relative; font-size: var(--hx-s); line-height: 1.15; color: var(--hx-text, inherit); ${toneVars(HEX_COLOURS.light)}; }
.hx.is-dark, .is-dark .hx { ${toneVars(HEX_COLOURS.dark)}; }
.hx *, .hx-legend *, .hx-attn * { box-sizing: border-box; }
.hx-label { position: absolute; display: flex; flex-wrap: wrap; align-items: baseline; justify-content: center; gap: 0 0.3em;
  font-size: calc(var(--hx-s) * 0.24); line-height: 1.2; text-align: center; color: var(--hx-text, inherit); overflow: hidden; max-height: calc(var(--hx-s) * 0.74); }
.hx-gname { font-weight: 700; }
.hx-badge { font-size: 0.82em; font-weight: 600; color: var(--hx-sub, #6b7280); white-space: nowrap; }
.hx-badge[data-tone="bad"] { color: var(--hx-bad-text, #b91c1c); }
.is-dark .hx-badge[data-tone="bad"], .hx.is-dark .hx-badge[data-tone="bad"] { color: #fca5a5; }
.hx-tile { position: absolute; display: block; margin: 0; padding: 0; border: 0; background: none; color: var(--hx-i); font: inherit; font-size: var(--hx-s);
  text-align: center; -webkit-tap-highlight-color: transparent; outline: none; }
button.hx-tile { cursor: pointer; touch-action: manipulation; }
.hx-tile[data-tone="ok"] { --hx-f: var(--hx-ok); --hx-i: var(--hx-ok-ink); }
.hx-tile[data-tone="warn"] { --hx-f: var(--hx-warn); --hx-i: var(--hx-warn-ink); }
.hx-tile[data-tone="bad"] { --hx-f: var(--hx-bad); --hx-i: var(--hx-bad-ink); }
.hx-tile[data-tone="muted"] { --hx-f: var(--hx-muted); --hx-i: var(--hx-muted-ink); }
${kindRules}
.hx-shape { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.hx-fill { fill: var(--hx-f); }
.hx-ring { fill: none; stroke: var(--hx-kc, #64748b); stroke-linejoin: round; }
.hx-health .hx-ring-health { stroke: var(--hx-text, currentColor); opacity: 0.55; }
.hx-focus { fill: none; stroke: transparent; stroke-linejoin: round; }
.hx-tile:focus-visible .hx-focus, .hx-tile.is-on .hx-focus { stroke: var(--hx-focus, #2563eb); }
.hx-copy { fill: none; stroke: var(--hx-i); stroke-opacity: 0.55; stroke-width: 4; stroke-linecap: round; }
.hx-in { position: absolute; inset: 13% 15%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.035em; min-width: 0; }
.hx-icon { width: 0.34em; height: 0.34em; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.hx-name { font-size: 0.21em; font-weight: 700; max-width: 100%; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.hx-word { display: inline-flex; align-items: center; gap: 0.25em; font-size: 0.18em; font-weight: 700; max-width: 100%; white-space: nowrap; }
.hx-word > span { overflow: hidden; text-overflow: ellipsis; }
.hx-mark { width: 1.2em; height: 1.2em; flex: none; fill: none; stroke: currentColor; stroke-width: 3.2; stroke-linecap: round; stroke-linejoin: round;
  border-radius: 50%; background: rgba(255,255,255,0.24); box-shadow: 0 0 0 1px currentColor inset; }
.hx-seen { font-size: 0.15em; font-weight: 600; opacity: 0.95; white-space: nowrap; }
.hx-health .hx-in { inset: 12% 14%; font-size: inherit; }
.hx-health .hx-icon { width: 0.3em; height: 0.3em; }
.hx-title { display: inline-flex; align-items: center; gap: 0.25em; font-size: 0.2em; font-weight: 800; }
.hx-counts { font-size: 0.13em; font-weight: 600; max-width: 100%; }
.hx-plat { display: inline-flex; align-items: center; gap: 0.25em; font-size: 0.12em; font-weight: 600; margin-top: 0.1em; opacity: 0.95; }
.hx-picon { width: 1.2em; height: 1.2em; fill: none; stroke: currentColor; stroke-width: 2; }
.hx-anim .hx-tile[data-tone="bad"] .hx-shape { animation: hx-glow 2.2s ease-in-out infinite; }
@keyframes hx-glow { 0%, 100% { filter: drop-shadow(0 0 0 rgba(220, 38, 38, 0)); } 50% { filter: drop-shadow(0 0 calc(var(--hx-s) * 0.14) rgba(239, 68, 68, 0.85)); } }
@media (prefers-reduced-motion: reduce) { .hx-anim .hx-tile .hx-shape { animation: none !important; } }
.hx-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35em 1.1em; color: var(--hx-sub, #6b7280); }
.hx-key { display: inline-flex; align-items: center; gap: 0.4em; white-space: nowrap; }
.hx-swatch { width: 1.9em; height: 1.65em; flex: none; overflow: visible; }
.hx-swatch .hx-ring { stroke: var(--hx-kc, #64748b); }
.hx-key > span { color: var(--hx-text, inherit); }
.hx-tkey { color: var(--hx-text, inherit); }
.hx-kmark { width: 1.35em; height: 1.35em; color: var(--hx-i); background: var(--hx-f); box-shadow: none; stroke-width: 3.4; padding: 0.12em; }
.hx-tkey[data-tone="ok"], .hx-aitem[data-tone="ok"], .hx-attn[data-tone="ok"] { --hx-f: var(--hx-ok); --hx-i: var(--hx-ok-ink); }
.hx-tkey[data-tone="warn"], .hx-aitem[data-tone="warn"] { --hx-f: var(--hx-warn); --hx-i: var(--hx-warn-ink); }
.hx-tkey[data-tone="bad"], .hx-aitem[data-tone="bad"] { --hx-f: var(--hx-bad); --hx-i: var(--hx-bad-ink); }
.hx-tkey[data-tone="muted"], .hx-attn[data-tone="muted"] { --hx-f: var(--hx-muted); --hx-i: var(--hx-muted-ink); }
.hx-attn { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3em 1.2em; color: var(--hx-text, inherit); }
.hx-ahead { font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; }
.hx-aitem { display: inline-flex; align-items: center; gap: 0.4em; white-space: nowrap; }
.hx-legend, .hx-attn { ${toneVars(HEX_COLOURS.light)}; }
.is-dark .hx-legend, .is-dark .hx-attn, .hx-legend.is-dark, .hx-attn.is-dark { ${toneVars(HEX_COLOURS.dark)}; }
`

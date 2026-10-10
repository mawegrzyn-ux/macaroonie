// shared/menuLayout.js
//
// Designed print layouts for structured menus (menu_print_designs.layout,
// migrations 121 + 135). ONE renderer used in two places:
//
//   - api/src/views/menu_print_designed.eta (the printable page), through
//     renderPageHtml(), called by GET /api/menus/:id/print
//   - admin/src/pages/MenuDesigner.jsx (the designer canvas), which draws
//     its own draggable block wrappers but fills each one with
//     renderBlockInner() and positions it with blockStyle()
//
// So what the operator sees while designing is exactly what prints. Plain
// ESM, no dependencies, no DOM: it only builds strings.
//
// Layout shape:
//   {
//     paper_size: 'A4' | 'A3', orientation: 'landscape' | 'portrait',
//     margin_mm: 0-25, cols: 6 | 12 | 24, row_mm: 2.5 | 5 | 10,
//     font_scale: 70-150,
//     variant_columns: 1-3,          default for dishes' variant lists
//     fold: 'none' | 'vertical' | 'horizontal', fold_gap_mm: 0-40,
//     fold_line: bool                a folded sheet: the grid is split in
//                                    two halves with a gap at the fold
//     font_body, font_heading, font_script: Google Font names (shared/fonts.js)
//     master: [block],               shown on every page
//     pages: [{ id, hide_master, blocks: [block] }],
//   }
//   block = { id, type, ref, x, y, w, h, opts }
//     x/w in grid columns, y/h in grid rows, all integers
//     ref = menu_sections.id (section) or menu_items.id (item), else null
//
// Blocks stay linked to the menu: names, prices and allergens are read
// from the live menu every time. A block whose section or dish has been
// deleted renders nothing (renderBlockInner returns null).

import { FONT_WEIGHTS, fontStack, googleFontsUrl } from './fonts.js'
import { allergenKey, isRemovable } from './menuTags.js'

export const BLOCK_TYPES = [
  'header', 'intro', 'section', 'item', 'text', 'image',
  'divider', 'callouts', 'key', 'footer', 'page_number',
]
export const PAPER_MM   = { A4: [210, 297], A3: [297, 420] }
export const GRID_COLS  = [6, 12, 24]
export const ROW_MM     = [2.5, 5, 10]
export const MAX_PAGES  = 20
export const MAX_BLOCKS = 400

export const BLOCK_LABELS = {
  header: 'Menu header', intro: 'Intro line', section: 'Section',
  item: 'Dish', text: 'Text', image: 'Image', divider: 'Divider line',
  callouts: 'Footer notes', key: 'Allergen key', footer: 'Footer line',
  page_number: 'Page number',
}

// Text-bearing blocks whose height can be fitted to their content.
/**
 * The footer notes a callouts block shows, in the menu's order. No
 * `opts.callout_ids` = every note (new ones included); a list = only
 * those notes (ids of deleted notes are ignored).
 */
export function pickedCallouts(menu, opts) {
  const all = menu?.callouts || []
  const ids = opts?.callout_ids
  if (!Array.isArray(ids)) return all
  const want = new Set(ids)
  return all.filter(c => want.has(c.id))
}

export const FITTABLE = new Set(['header', 'intro', 'section', 'item', 'text', 'callouts', 'key', 'footer', 'page_number'])

function num(v, lo, hi, dflt) {
  const n = Number(v)
  if (v == null || v === '' || !Number.isFinite(n)) return dflt
  return Math.min(hi, Math.max(lo, n))
}

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function safeUrl(u) {
  const s = String(u || '').trim()
  if (/^https?:\/\//i.test(s) || (s.startsWith('/') && !s.startsWith('//'))) return s
  return ''
}

// ── Layout + geometry ───────────────────────────────────────

// The three font roles every block's text uses: body text, headings and
// prices, and the handwritten script (taglines, script text).
export const DEFAULT_FONTS = { body: 'Inter', heading: 'Fraunces', script: 'Caveat' }

function knownFont(v, dflt) { return FONT_WEIGHTS[v] ? v : dflt }

// Every font a layout uses, for its Google Fonts stylesheet.
export function layoutFonts(layout) {
  const l = normalizeLayout(layout)
  const out = new Set([l.font_body, l.font_heading, l.font_script])
  for (const b of [...l.master, ...l.pages.flatMap(p => p.blocks || [])]) {
    if (b.opts && FONT_WEIGHTS[b.opts.font]) out.add(b.opts.font)
  }
  return [...out]
}

export function layoutFontsUrl(layout) { return googleFontsUrl(layoutFonts(layout)) }

export function normalizeLayout(layout) {
  const l = layout || {}
  return {
    paper_size:  l.paper_size === 'A3' ? 'A3' : 'A4',
    orientation: l.orientation === 'portrait' ? 'portrait' : 'landscape',
    margin_mm:   num(l.margin_mm, 0, 25, 10),
    cols:        GRID_COLS.includes(Number(l.cols)) ? Number(l.cols) : 12,
    row_mm:      ROW_MM.includes(Number(l.row_mm)) ? Number(l.row_mm) : 5,
    font_scale:  num(l.font_scale, 70, 150, 100),
    variant_columns: num(l.variant_columns, 1, 3, 1),
    fold:        l.fold === 'vertical' || l.fold === 'horizontal' ? l.fold : 'none',
    fold_gap_mm: num(l.fold_gap_mm, 0, 40, 10),
    fold_line:   !!l.fold_line,
    font_body:    knownFont(l.font_body, DEFAULT_FONTS.body),
    font_heading: knownFont(l.font_heading, DEFAULT_FONTS.heading),
    font_script:  knownFont(l.font_script, DEFAULT_FONTS.script),
    master:      Array.isArray(l.master) ? l.master : [],
    pages:       Array.isArray(l.pages) && l.pages.length ? l.pages : [{ id: 'p1', blocks: [] }],
  }
}

export function layoutGeometry(layout) {
  const l = normalizeLayout(layout)
  const paper = PAPER_MM[l.paper_size]
  const land = l.orientation === 'landscape'
  const pageW = land ? paper[1] : paper[0]
  const pageH = land ? paper[0] : paper[1]
  const margin = l.margin_mm
  const contentW = pageW - 2 * margin
  /* Fold: the grid keeps the same number of columns (or an even number of
     rows) but they split into two halves with the gap between them, so
     the fold lands in the middle of the sheet. */
  const foldV = l.fold === 'vertical'
  const foldH = l.fold === 'horizontal'
  const gapV = foldV ? l.fold_gap_mm : 0
  const gapH = foldH ? l.fold_gap_mm : 0
  let rows = Math.max(1, Math.floor((pageH - 2 * margin - gapH) / l.row_mm + 1e-6))
  if (foldH) rows = Math.max(2, rows - (rows % 2))
  const contentH = rows * l.row_mm + gapH
  return {
    pageW, pageH, margin, contentW, contentH,
    contentLeft: margin,
    contentTop: foldH ? (pageH - contentH) / 2 : margin,
    cols: l.cols, rows, rowMm: l.row_mm, colMm: (contentW - gapV) / l.cols,
    foldV, foldH, gapV, gapH, halfCol: l.cols / 2, halfRow: rows / 2,
    fontScale: l.font_scale / 100,
  }
}

/* Grid lines to mm inside the content area. A block's left / top edge on
   the fold line sits after the gap, its right / bottom edge before it. */
function colStart(i, g) { return i * g.colMm + (g.foldV && i >= g.halfCol ? g.gapV : 0) }
function colEnd(i, g)   { return i * g.colMm + (g.foldV && i > g.halfCol ? g.gapV : 0) }
function rowStart(i, g) { return i * g.rowMm + (g.foldH && i >= g.halfRow ? g.gapH : 0) }
function rowEnd(i, g)   { return i * g.rowMm + (g.foldH && i > g.halfRow ? g.gapH : 0) }

// mm inside the content area to a fractional grid column / row, skipping
// the fold gap (a point in the gap counts as the fold line). The designer
// turns pointer positions into grid cells with these.
export function colAtMm(x, g) {
  if (!g.foldV) return x / g.colMm
  const half = g.halfCol * g.colMm
  if (x <= half) return x / g.colMm
  if (x < half + g.gapV) return g.halfCol
  return (x - g.gapV) / g.colMm
}
export function rowAtMm(y, g) {
  if (!g.foldH) return y / g.rowMm
  const half = g.halfRow * g.rowMm
  if (y <= half) return y / g.rowMm
  if (y < half + g.gapH) return g.halfRow
  return (y - g.gapH) / g.rowMm
}

// Does a block of this size and position run across the fold?
export function crossesFold(b, g) {
  return (g.foldV && b.x < g.halfCol && b.x + b.w > g.halfCol) ||
         (g.foldH && b.y < g.halfRow && b.y + b.h > g.halfRow)
}

// The fold gap as a box inside the content area (null without a fold).
export function foldGapBox(layout) {
  const g = layoutGeometry(layout)
  if (g.foldV) return { left: mm(g.halfCol * g.colMm), top: '0mm', width: mm(g.gapV), height: mm(g.contentH), dir: 'v' }
  if (g.foldH) return { left: '0mm', top: mm(g.halfRow * g.rowMm), width: mm(g.contentW), height: mm(g.gapH), dir: 'h' }
  return null
}

// Blocks drawn on a page: the repeated (master) blocks first, so a page's
// own blocks sit on top of them, unless the page hides them.
export function pageBlocks(layout, page) {
  const l = normalizeLayout(layout)
  return [...(page.hide_master ? [] : l.master), ...(page.blocks || [])]
}

function mm(n) { return (Math.round(n * 1000) / 1000) + 'mm' }

export function pageStyle(layout, menu) {
  const l = normalizeLayout(layout)
  const g = layoutGeometry(l)
  return {
    width: mm(g.pageW), height: mm(g.pageH),
    '--plum': (menu && menu.primary_colour) || '#630812',
    '--fs': String(g.fontScale),
    '--ml-body': fontStack(l.font_body),
    '--ml-heading': fontStack(l.font_heading),
    '--ml-script': fontStack(l.font_script),
  }
}

export function contentStyle(layout) {
  const g = layoutGeometry(layout)
  return { left: mm(g.contentLeft), top: mm(g.contentTop), width: mm(g.contentW), height: mm(g.contentH) }
}

export function blockStyle(block, layout) {
  const g = layoutGeometry(layout)
  const o = block.opts || {}
  const s = {
    left: mm(colStart(block.x, g)), top: mm(rowStart(block.y, g)),
    width: mm(colEnd(block.x + block.w, g) - colStart(block.x, g)),
    height: mm(rowEnd(block.y + block.h, g) - rowStart(block.y, g)),
    '--bfs': String(num(o.font_scale, 50, 300, 100) / 100),
  }
  // A block's own font replaces all three roles inside it.
  if (FONT_WEIGHTS[o.font]) {
    const stack = fontStack(o.font)
    s['--ml-body'] = stack; s['--ml-heading'] = stack; s['--ml-script'] = stack
  }
  const align = o.align || DEFAULT_ALIGN[block.type]
  if (align === 'left' || align === 'center' || align === 'right') s['text-align'] = align
  return s
}

const DEFAULT_ALIGN = { footer: 'center', page_number: 'right' }

export function blockClass(block) {
  const o = block.opts || {}
  const box = o.box === 'tint' || o.box === 'outline' ? ' ml-box-' + o.box : ''
  return 'ml-block ml-t-' + block.type + box
}

export function styleToString(style) {
  return Object.entries(style).map(([k, v]) => k + ':' + v).join(';')
}

// React style objects want camelCase names; custom properties stay as is.
export function toReactStyle(style) {
  const out = {}
  for (const [k, v] of Object.entries(style)) {
    out[k.startsWith('--') ? k : k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v
  }
  return out
}

// ── Menu context ────────────────────────────────────────────

export function buildContext(menu, layout) {
  const m = menu || {}
  const l = normalizeLayout(layout)
  const sections = m.sections || []
  const sectionsById = {}
  const itemsById = {}
  const sectionIdOfItem = {}
  for (const s of sections) {
    if (s.visibility === 'hidden') continue   // hidden everywhere: never printed (migration 136)
    sectionsById[s.id] = s
    for (const it of (s.items || [])) { itemsById[it.id] = it; sectionIdOfItem[it.id] = s.id }
  }
  const all = [...l.master, ...l.pages.flatMap(p => p.blocks || [])]
  const placedItemIds = new Set(all.filter(b => b.type === 'item' && b.ref).map(b => b.ref))
  return {
    menu: m,
    tagsByCode: Object.fromEntries((m.dietary_tags || []).map(t => [t.code, t])),
    // The tenant's allergen notice and the tags its key lists for the
    // printed dishes (migration 147).
    key: allergenKey(m.dietary_tags, Object.values(sectionsById), m.allergen_notice),
    sectionsById, itemsById, sectionIdOfItem, placedItemIds,
    pageCount: l.pages.length,
    variantColumns: l.variant_columns,
  }
}

// What still needs placing, for the designer's tray. A dish counts as
// placed when it has its own block, or when its section is placed as a
// whole ("Title and dishes"). A section counts as placed once it has any
// section block.
export function placementSummary(menu, layout) {
  const l = normalizeLayout(layout)
  const all = [...l.master, ...l.pages.flatMap(p => p.blocks || [])]
  const itemPlaced = new Set()
  const sectionPlaced = new Set()
  const sectionFull = new Set()
  for (const b of all) {
    if (b.type === 'item' && b.ref) itemPlaced.add(b.ref)
    if (b.type === 'section' && b.ref) {
      sectionPlaced.add(b.ref)
      if ((b.opts || {}).mode === 'full') sectionFull.add(b.ref)
    }
  }
  return (menu.sections || []).filter(s => s.visibility !== 'hidden').map(s => ({
    section: s,
    placed: sectionPlaced.has(s.id),
    full: sectionFull.has(s.id),
    items: (s.items || []).map(it => ({
      item: it,
      placed: itemPlaced.has(it.id) || sectionFull.has(s.id),
      own: itemPlaced.has(it.id),
    })),
  }))
}

// ── Block content ───────────────────────────────────────────

function fmtPrice(p) {
  if (p == null) return ''
  return '£' + (Number(p) / 100).toFixed(2)
}

function itemHtml(item, ctx, opts) {
  const m = ctx.menu
  const o = opts || {}
  const hideGroupHeaders = !!m.print_hide_variant_group_headers
  const hideZero = !!m.hide_zero_priced_variants
  const hideUnpriced = !!m.hide_unpriced_variants
  const isUnpriced = p => p == null || Number(p) === 0
  const vPrice = p => (hideZero && Number(p) === 0) ? '' : fmtPrice(p)

  const groups = (item.variant_groups || [])
    .map(g => hideUnpriced ? { ...g, options: (g.options || []).filter(v => !isUnpriced(v.price_pence)) } : g)
    .filter(g => !hideUnpriced || (g.options && g.options.length))
  const adhoc = hideUnpriced
    ? (item.variants || []).filter(v => !isUnpriced(v.price_pence))
    : (item.variants || [])
  const hasVar = adhoc.length > 0 || groups.some(g => g.options && g.options.length)

  const tags = (item.dietary || []).map(code => ctx.tagsByCode[code]).filter(Boolean)
    .map(t => tagChipHtml(t, isRemovable(item, t.code), ctx.key.removable_note))
    .join('')
  // Variant options: a block's own column count, else the layout's default.
  // Each option is one label + price pair; pairs fill the columns row by row.
  const vCols = Math.round(num(o.variant_columns, 1, 3, ctx.variantColumns || 1))
  const variantRows = list => '<div class="ml-variants" style="grid-template-columns:repeat(' + vCols + ',minmax(0,1fr))">' +
    list.map(v => '<span class="ml-v"><span class="ml-v-label">' + esc(v.label) + '</span><span class="ml-v-price">' +
      vPrice(v.price_pence) + '</span></span>').join('') + '</div>'

  let body = '<div class="ml-item-row"><div><span class="ml-item-name">' + esc(item.name)
  if (item.native_name) body += '<span class="ml-native">' + esc(item.native_name) + '</span>'
  body += '</span>'
  if (tags) body += '<span class="ml-tags">' + tags + '</span>'
  body += '</div>'
  if (item.price_pence != null && !hasVar) body += '<span class="ml-price">' + fmtPrice(item.price_pence) + '</span>'
  body += '</div>'
  if (item.description && o.show_description !== false) body += '<div class="ml-desc">' + esc(item.description) + '</div>'
  if (item.notes) body += '<div class="ml-notes">' + esc(item.notes) + '</div>'
  if (item.calories != null) body += '<div class="ml-notes">' + esc(item.calories) + ' kcal</div>'
  for (const g of groups) {
    if (g.name && !hideGroupHeaders) body += '<div class="ml-group">' + esc(g.name) + '</div>'
    if (g.options && g.options.length) body += variantRows(g.options)
  }
  if (adhoc.length) body += variantRows(adhoc)

  const img = o.show_image !== false && safeUrl(item.image_url)
  return '<div class="ml-item' + (item.is_featured ? ' featured' : '') + '">' +
    (img ? '<div class="ml-item-flex"><img class="ml-thumb" src="' + esc(img) + '" alt="" /><div class="ml-item-body">' + body + '</div></div>' : body) +
    '</div>'
}

function sectionHeadHtml(s, o) {
  const img = o.show_image !== false && safeUrl(s.image_url)
  let h = '<div class="ml-sec-head' + (o.show_rule === false ? ' no-rule' : '') + '"><h2>'
  if (img) h += '<img class="ml-sec-img" src="' + esc(img) + '" alt="" />'
  h += esc(s.title)
  if (o.suffix) h += ' ' + esc(o.suffix)
  if (s.subtitle && o.show_subtitle !== false) h += '<span class="ml-sub">' + esc(s.subtitle) + '</span>'
  return h + '</h2></div>'
}

// Inner HTML of one block. null = its section / dish no longer exists;
// '' = nothing to show (an empty intro line, say).
export function renderBlockInner(block, ctx, pageIndex) {
  const m = ctx.menu
  const o = block.opts || {}
  switch (block.type) {
    case 'header': {
      if (o.variant === 'compact') {
        return '<div class="ml-head compact"><span class="ml-compact-name">' + esc(m.name) + '</span>' +
          '<span class="ml-compact-right">' + esc(m.tenant_name) + '</span></div>'
      }
      const logo = o.show_logo !== false && safeUrl(m.logo_url)
      let right = '<strong>' + esc(m.tenant_name) + '</strong>'
      if (m.address_line1) right += '<div>' + esc(m.address_line1) + (m.postcode ? ', ' + esc(m.postcode) : '') + '</div>'
      if (m.phone) right += '<div>' + esc(m.phone) + '</div>'
      if (m.service_times) right += '<div>' + esc(m.service_times) + '</div>'
      return '<div class="ml-head' + (o.show_rule === false ? ' no-rule' : '') + '"><div><h1>' + esc(m.name) + '</h1>' +
        (m.tagline ? '<div class="ml-tagline">' + esc(m.tagline) + '</div>' : '') + '</div>' +
        (logo ? '<img class="ml-logo" src="' + esc(logo) + '" alt="" />' : '') +
        '<div class="ml-head-right">' + right + '</div></div>'
    }
    case 'intro':
      return m.intro_line ? '<div class="ml-intro">' + m.intro_line + '</div>' : ''
    case 'section': {
      const s = ctx.sectionsById[block.ref]
      if (!s) return null
      let h = sectionHeadHtml(s, o)
      if (o.mode === 'full') {
        const cols = num(o.columns, 1, 6, 1)
        const items = (s.items || []).filter(it => !ctx.placedItemIds.has(it.id))
        h += '<div class="ml-items" style="column-count:' + cols + '">' +
          items.map(it => itemHtml(it, ctx, o)).join('') + '</div>'
      }
      return h
    }
    case 'item': {
      const it = ctx.itemsById[block.ref]
      if (!it) return null
      return itemHtml(it, ctx, o)
    }
    case 'text': {
      const style = ['heading', 'subheading', 'body', 'script', 'small'].includes(o.style) ? o.style : 'body'
      return o.text ? '<div class="ml-text ml-text-' + style + '">' + esc(o.text).replace(/\n/g, '<br>') + '</div>' : ''
    }
    case 'image': {
      const url = safeUrl(o.url)
      return url ? '<img class="ml-img" style="object-fit:' + (o.fit === 'cover' ? 'cover' : 'contain') + '" src="' + esc(url) + '" alt="" />' : ''
    }
    case 'divider': {
      const style = ['thin', 'thick', 'dotted', 'double'].includes(o.style) ? o.style : 'thin'
      return '<div class="ml-rule ml-rule-' + style + '"></div>'
    }
    case 'callouts': {
      const callouts = pickedCallouts(m, o)
      if (!callouts.length) return ''
      const cols = num(o.columns, 1, 4, Math.min(4, callouts.length))
      return '<div class="ml-callouts" style="grid-template-columns:repeat(' + cols + ',1fr)">' +
        callouts.map(c => {
          // An "Allergies & Diet" note shows the allergen notice, not its own words.
          const k = ctx.key
          const title = c.kind === 'allergens' ? k.title : c.title
          const body = c.kind === 'allergens' ? k.body : c.body
          let h = '<div class="ml-callout">' + (title ? '<strong>' + esc(title) + '</strong>' : '')
          if (body) h += '<p>' + esc(body) + '</p>'
          if (c.kind === 'allergens') h += keyHtml(ctx)
          return h + '</div>'
        }).join('') + '</div>'
    }
    case 'key':
      return keyHtml(ctx)
    case 'footer':
      return '<div class="ml-foot">' + esc(o.text || m.footer_motto || '— honest cooking, made fresh in our kitchen —') + '</div>'
    case 'page_number':
      return '<div class="ml-page-num">Page ' + (pageIndex + 1) + ' of ' + ctx.pageCount + '</div>'
    default:
      return ''
  }
}

// A dish's tag badge; an allergen that can be removed gets a small
// asterisk (shared/menuTags.js).
function tagChipHtml(t, removable, note) {
  return '<span class="ml-tag" style="background:' + esc(t.colour) + '" title="' +
    esc(t.label + (removable ? ' (' + note.toLowerCase() + ')' : '')) + '">' + esc(t.glyph) +
    (removable ? '<span class="ml-star">*</span>' : '') + '</span>'
}

// The notice's key: the tags it lists, then the asterisk note when a
// printed dish has an allergen that can be removed. Empty when neither.
function keyHtml(ctx) {
  const k = ctx.key
  if (!k.tags.length && !k.removable) return ''
  return '<div class="ml-key">' + k.tags.map(t =>
    '<span class="ml-pair"><span class="ml-tag" style="background:' + esc(t.colour) + '">' + esc(t.glyph) + '</span>' + esc(t.label) + '</span>'
  ).join('') +
    (k.removable ? '<span class="ml-pair ml-star-note">* ' + esc(k.removable_note) + '</span>' : '') + '</div>'
}

// Whole printed page, for the Eta print view.
export function renderPageHtml(layout, ctx, pageIndex) {
  const l = normalizeLayout(layout)
  const page = l.pages[pageIndex]
  const g = layoutGeometry(l)
  let blocks = ''
  for (const b of pageBlocks(l, page)) {
    const inner = renderBlockInner(b, ctx, pageIndex)
    if (inner == null) continue
    blocks += '<div class="' + blockClass(b) + '" style="' + styleToString(blockStyle(b, l)) + '">' +
      '<div class="ml-inner">' + inner + '</div></div>'
  }
  const fold = l.fold_line && foldGapBox(l)
  if (fold) {
    const { dir, ...box } = fold
    blocks += '<div class="ml-fold-line ml-fold-' + dir + '" style="' + styleToString(box) + '"></div>'
  }
  return '<div class="ml-page" data-page="' + (pageIndex + 1) + '" data-w="' + g.pageW + '" data-h="' + g.pageH + '" style="' +
    styleToString(pageStyle(l, ctx.menu)) + '"><div class="ml-content" style="' + styleToString(contentStyle(l)) + '">' +
    blocks + '</div></div>'
}

// ── Styles (shared by the print view and the designer canvas) ──

const f = px => 'calc(' + px + 'px * var(--fs, 1) * var(--bfs, 1))'

export const MENU_LAYOUT_CSS = `
.ml-page { position: relative; overflow: hidden; background: #faf6ef; color: #2a1c1a;
  font-family: var(--ml-body); font-weight: 400; line-height: 1.45; -webkit-font-smoothing: antialiased;
  --paper-warm: #f3ead8; --line: rgba(99, 8, 18, 0.18); --ink: #2a1c1a; --muted: #7a6b62; --plum-soft: rgba(99, 8, 18, 0.6); }
.ml-page *, .ml-page *::before, .ml-page *::after { box-sizing: border-box; margin: 0; padding: 0; }
.ml-content { position: absolute; }
.ml-block { position: absolute; overflow: hidden; font-family: var(--ml-body); }
.ml-block > .ml-inner { padding: 0 1.5mm; }
.ml-fold-line { position: absolute; pointer-events: none; }
.ml-fold-line::after { content: ''; position: absolute; }
.ml-fold-v::after { left: 50%; top: 0; bottom: 0; border-left: 0.3mm dashed rgba(0, 0, 0, 0.3); }
.ml-fold-h::after { top: 50%; left: 0; right: 0; border-top: 0.3mm dashed rgba(0, 0, 0, 0.3); }
.ml-block.ml-box-tint { background: var(--paper-warm); border-radius: 3px; }
.ml-block.ml-box-outline { border: 1px solid var(--line); border-radius: 3px; }
.ml-block.ml-box-tint > .ml-inner, .ml-block.ml-box-outline > .ml-inner { padding: 2mm 3mm; }
.ml-t-image > .ml-inner, .ml-t-divider > .ml-inner { height: 100%; }
.ml-page img { display: inline-block; max-width: none; }

.ml-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8mm; padding-bottom: 3mm; border-bottom: 1px solid var(--line); text-align: left; }
.ml-head.no-rule { border-bottom: 0; }
.ml-head h1 { font-family: var(--ml-heading); font-size: ${f(28)}; font-weight: 500; color: var(--ink); letter-spacing: -0.01em; line-height: 1; }
.ml-tagline { font-family: var(--ml-script); font-size: ${f(18)}; color: var(--plum); margin-top: 2px; }
.ml-head-right { text-align: right; font-size: ${f(11)}; color: var(--muted); line-height: 1.5; }
.ml-head-right strong { color: var(--ink); display: block; font-size: ${f(11)}; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 600; }
.ml-logo { width: 18mm; height: 18mm; object-fit: contain; flex-shrink: 0; }
.ml-head.compact { align-items: baseline; padding-bottom: 1.5mm; }
.ml-compact-name { font-family: var(--ml-heading); font-size: ${f(14)}; font-weight: 500; color: var(--ink); }
.ml-compact-right { font-size: ${f(10)}; color: var(--muted); letter-spacing: 0.12em; text-transform: uppercase; }
.ml-intro { background: var(--paper-warm); padding: 6px 10px; font-size: ${f(11)}; color: var(--muted); border-radius: 3px; }
.ml-intro strong { color: var(--ink); margin-right: 4px; text-transform: uppercase; letter-spacing: 0.08em; font-size: ${f(10)}; }

.ml-sec-head { padding-bottom: 1.5mm; border-bottom: 1px solid var(--line); }
.ml-sec-head.no-rule { border-bottom: 0; }
.ml-sec-head h2 { font-family: var(--ml-body); font-size: ${f(12)}; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; color: var(--ink); }
.ml-sec-img { width: 1.6em; height: 1.6em; object-fit: cover; border-radius: 3px; vertical-align: middle; margin-right: 4px; }
.ml-sub { font-size: ${f(10)}; font-weight: 400; color: var(--muted); margin-left: 6px; text-transform: none; letter-spacing: 0; }
.ml-items { column-gap: 5mm; margin-top: 2mm; }

.ml-item { padding: 1.2mm 0; break-inside: avoid; text-align: left; }
.ml-item.featured { background: var(--paper-warm); padding: 2mm 3mm; border-radius: 3px; }
.ml-tag, .ml-item.featured, .ml-block.ml-box-tint, .ml-intro { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.ml-item-flex { display: flex; align-items: flex-start; gap: 2mm; }
.ml-item-body { flex: 1; min-width: 0; }
.ml-thumb { width: 9mm; height: 9mm; object-fit: cover; border-radius: 2px; flex-shrink: 0; }
.ml-item-row { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; }
.ml-item-name { font-size: ${f(11.5)}; font-weight: 500; color: var(--ink); }
.ml-native { font-style: italic; font-weight: 300; color: var(--muted); font-size: ${f(10)}; margin-left: 4px; }
.ml-price { font-family: var(--ml-heading); font-size: ${f(11.5)}; font-weight: 500; color: var(--plum); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ml-desc { font-size: ${f(10.5)}; color: var(--muted); margin-top: 1px; line-height: 1.4; }
.ml-notes { font-size: ${f(9.5)}; color: var(--plum-soft); font-style: italic; margin-top: 1px; }
.ml-tags { display: inline-flex; gap: 3px; margin-left: 4px; vertical-align: middle; }
.ml-tag { display: inline-flex; align-items: center; justify-content: center; min-width: 14px; height: 14px; padding: 0 4px; border-radius: 3px; color: #fff; font-size: ${f(9)}; font-weight: 700; line-height: 1; }
.ml-star { align-self: flex-start; font-size: .85em; margin-left: 1px; }
.ml-group { font-size: ${f(9)}; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin-top: 1.5mm; }
.ml-variants { display: grid; gap: 0 4mm; margin-top: 1mm; }
.ml-v { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; min-width: 0; }
.ml-v-label { font-size: ${f(10.5)}; color: var(--ink); }
.ml-v-price { font-family: var(--ml-heading); font-size: ${f(10.5)}; color: var(--plum); font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }

.ml-text-heading { font-family: var(--ml-heading); font-size: ${f(22)}; font-weight: 500; line-height: 1.15; color: var(--ink); }
.ml-text-subheading { font-size: ${f(12)}; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; color: var(--ink); }
.ml-text-body { font-size: ${f(11)}; color: var(--ink); }
.ml-text-script { font-family: var(--ml-script); font-size: ${f(20)}; color: var(--plum); line-height: 1.2; }
.ml-text-small { font-size: ${f(9.5)}; color: var(--muted); }
.ml-page .ml-img { display: block; width: 100%; height: 100%; }
.ml-rule { width: 100%; position: relative; top: 50%; }
.ml-rule-thin { border-top: 1px solid var(--line); }
.ml-rule-thick { border-top: 2px solid var(--plum); }
.ml-rule-dotted { border-top: 1.5px dotted var(--plum-soft); }
.ml-rule-double { border-top: 3px double var(--plum-soft); }

.ml-callouts { display: grid; gap: 6mm; font-size: ${f(10)}; text-align: left; }
.ml-callout strong { display: block; font-size: ${f(10)}; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink); margin-bottom: 2px; font-weight: 600; }
.ml-callout p { color: var(--muted); white-space: pre-line; line-height: 1.45; }
.ml-callout .ml-key { margin-top: 2mm; }
.ml-key { display: flex; gap: 6px; flex-wrap: wrap; }
.ml-pair { display: inline-flex; align-items: center; gap: 4px; font-size: ${f(9.5)}; }
.ml-foot { font-family: var(--ml-heading); font-style: italic; color: var(--muted); font-size: ${f(10)}; }
.ml-page-num { font-size: ${f(9)}; color: var(--muted); }
`

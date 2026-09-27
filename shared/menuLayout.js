// shared/menuLayout.js
//
// Designed print layouts for structured menus (menus.print_layout,
// migration 121). ONE renderer used in two places:
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

export function normalizeLayout(layout) {
  const l = layout || {}
  return {
    paper_size:  l.paper_size === 'A3' ? 'A3' : 'A4',
    orientation: l.orientation === 'portrait' ? 'portrait' : 'landscape',
    margin_mm:   num(l.margin_mm, 0, 25, 10),
    cols:        GRID_COLS.includes(Number(l.cols)) ? Number(l.cols) : 12,
    row_mm:      ROW_MM.includes(Number(l.row_mm)) ? Number(l.row_mm) : 5,
    font_scale:  num(l.font_scale, 70, 150, 100),
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
  const rows = Math.max(1, Math.floor((pageH - 2 * margin) / l.row_mm + 1e-6))
  return {
    pageW, pageH, margin, contentW,
    contentH: rows * l.row_mm,
    cols: l.cols, rows, rowMm: l.row_mm, colMm: contentW / l.cols,
    fontScale: l.font_scale / 100,
  }
}

// Blocks drawn on a page: the repeated (master) blocks first, so a page's
// own blocks sit on top of them, unless the page hides them.
export function pageBlocks(layout, page) {
  const l = normalizeLayout(layout)
  return [...(page.hide_master ? [] : l.master), ...(page.blocks || [])]
}

function mm(n) { return (Math.round(n * 1000) / 1000) + 'mm' }

export function pageStyle(layout, menu) {
  const g = layoutGeometry(layout)
  return {
    width: mm(g.pageW), height: mm(g.pageH),
    '--plum': (menu && menu.primary_colour) || '#630812',
    '--fs': String(g.fontScale),
  }
}

export function contentStyle(layout) {
  const g = layoutGeometry(layout)
  return { left: mm(g.margin), top: mm(g.margin), width: mm(g.contentW), height: mm(g.contentH) }
}

export function blockStyle(block, layout) {
  const g = layoutGeometry(layout)
  const o = block.opts || {}
  const s = {
    left: mm(block.x * g.colMm), top: mm(block.y * g.rowMm),
    width: mm(block.w * g.colMm), height: mm(block.h * g.rowMm),
    '--bfs': String(num(o.font_scale, 50, 300, 100) / 100),
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
    sectionsById[s.id] = s
    for (const it of (s.items || [])) { itemsById[it.id] = it; sectionIdOfItem[it.id] = s.id }
  }
  const all = [...l.master, ...l.pages.flatMap(p => p.blocks || [])]
  const placedItemIds = new Set(all.filter(b => b.type === 'item' && b.ref).map(b => b.ref))
  return {
    menu: m,
    tagsByCode: Object.fromEntries((m.dietary_tags || []).map(t => [t.code, t])),
    sectionsById, itemsById, sectionIdOfItem, placedItemIds,
    pageCount: l.pages.length,
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
  return (menu.sections || []).map(s => ({
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
    .map(t => '<span class="ml-tag" style="background:' + esc(t.colour) + '" title="' + esc(t.label) + '">' + esc(t.glyph) + '</span>')
    .join('')
  const variantRows = list => '<div class="ml-variants">' + list.map(v =>
    '<span class="ml-v-label">' + esc(v.label) + '</span><span class="ml-v-price">' + vPrice(v.price_pence) + '</span>').join('') + '</div>'

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
      const callouts = m.callouts || []
      if (!callouts.length) return ''
      const cols = num(o.columns, 1, 4, Math.min(4, callouts.length))
      return '<div class="ml-callouts" style="grid-template-columns:repeat(' + cols + ',1fr)">' +
        callouts.map(c => {
          let h = '<div class="ml-callout"><strong>' + esc(c.title) + '</strong>'
          if (c.body) h += '<p>' + esc(c.body) + '</p>'
          if (c.kind === 'allergens' && (m.dietary_tags || []).length) h += keyHtml(m)
          return h + '</div>'
        }).join('') + '</div>'
    }
    case 'key':
      return (m.dietary_tags || []).length ? keyHtml(m) : ''
    case 'footer':
      return '<div class="ml-foot">' + esc(o.text || m.footer_motto || '— honest cooking, made fresh in our kitchen —') + '</div>'
    case 'page_number':
      return '<div class="ml-page-num">Page ' + (pageIndex + 1) + ' of ' + ctx.pageCount + '</div>'
    default:
      return ''
  }
}

function keyHtml(m) {
  return '<div class="ml-key">' + (m.dietary_tags || []).map(t =>
    '<span class="ml-pair"><span class="ml-tag" style="background:' + esc(t.colour) + '">' + esc(t.glyph) + '</span>' + esc(t.label) + '</span>'
  ).join('') + '</div>'
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
  return '<div class="ml-page" data-page="' + (pageIndex + 1) + '" data-w="' + g.pageW + '" data-h="' + g.pageH + '" style="' +
    styleToString(pageStyle(l, ctx.menu)) + '"><div class="ml-content" style="' + styleToString(contentStyle(l)) + '">' +
    blocks + '</div></div>'
}

// ── Styles (shared by the print view and the designer canvas) ──

const f = px => 'calc(' + px + 'px * var(--fs, 1) * var(--bfs, 1))'

export const MENU_LAYOUT_CSS = `
.ml-page { position: relative; overflow: hidden; background: #faf6ef; color: #2a1c1a;
  font-family: 'Inter', sans-serif; font-weight: 400; line-height: 1.45; -webkit-font-smoothing: antialiased;
  --paper-warm: #f3ead8; --line: rgba(99, 8, 18, 0.18); --ink: #2a1c1a; --muted: #7a6b62; --plum-soft: rgba(99, 8, 18, 0.6); }
.ml-page *, .ml-page *::before, .ml-page *::after { box-sizing: border-box; margin: 0; padding: 0; }
.ml-content { position: absolute; }
.ml-block { position: absolute; overflow: hidden; }
.ml-block > .ml-inner { padding: 0 1.5mm; }
.ml-block.ml-box-tint { background: var(--paper-warm); border-radius: 3px; }
.ml-block.ml-box-outline { border: 1px solid var(--line); border-radius: 3px; }
.ml-block.ml-box-tint > .ml-inner, .ml-block.ml-box-outline > .ml-inner { padding: 2mm 3mm; }
.ml-t-image > .ml-inner, .ml-t-divider > .ml-inner { height: 100%; }
.ml-page img { display: inline-block; max-width: none; }

.ml-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8mm; padding-bottom: 3mm; border-bottom: 1px solid var(--line); text-align: left; }
.ml-head.no-rule { border-bottom: 0; }
.ml-head h1 { font-family: 'Fraunces', serif; font-size: ${f(28)}; font-weight: 500; color: var(--ink); letter-spacing: -0.01em; line-height: 1; }
.ml-tagline { font-family: 'Caveat', cursive; font-size: ${f(18)}; color: var(--plum); margin-top: 2px; }
.ml-head-right { text-align: right; font-size: ${f(11)}; color: var(--muted); line-height: 1.5; }
.ml-head-right strong { color: var(--ink); display: block; font-size: ${f(11)}; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 600; }
.ml-logo { width: 18mm; height: 18mm; object-fit: contain; flex-shrink: 0; }
.ml-head.compact { align-items: baseline; padding-bottom: 1.5mm; }
.ml-compact-name { font-family: 'Fraunces', serif; font-size: ${f(14)}; font-weight: 500; color: var(--ink); }
.ml-compact-right { font-size: ${f(10)}; color: var(--muted); letter-spacing: 0.12em; text-transform: uppercase; }
.ml-intro { background: var(--paper-warm); padding: 6px 10px; font-size: ${f(11)}; color: var(--muted); border-radius: 3px; }
.ml-intro strong { color: var(--ink); margin-right: 4px; text-transform: uppercase; letter-spacing: 0.08em; font-size: ${f(10)}; }

.ml-sec-head { padding-bottom: 1.5mm; border-bottom: 1px solid var(--line); }
.ml-sec-head.no-rule { border-bottom: 0; }
.ml-sec-head h2 { font-family: 'Inter', sans-serif; font-size: ${f(12)}; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; color: var(--ink); }
.ml-sec-img { width: 1.6em; height: 1.6em; object-fit: cover; border-radius: 3px; vertical-align: middle; margin-right: 4px; }
.ml-sub { font-size: ${f(10)}; font-weight: 400; color: var(--muted); margin-left: 6px; text-transform: none; letter-spacing: 0; }
.ml-items { column-gap: 5mm; margin-top: 2mm; }

.ml-item { padding: 1.2mm 0; break-inside: avoid; text-align: left; }
.ml-item.featured { background: var(--paper-warm); padding: 2mm 3mm; border-radius: 3px; }
.ml-item-flex { display: flex; align-items: flex-start; gap: 2mm; }
.ml-item-body { flex: 1; min-width: 0; }
.ml-thumb { width: 9mm; height: 9mm; object-fit: cover; border-radius: 2px; flex-shrink: 0; }
.ml-item-row { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; }
.ml-item-name { font-size: ${f(11.5)}; font-weight: 500; color: var(--ink); }
.ml-native { font-style: italic; font-weight: 300; color: var(--muted); font-size: ${f(10)}; margin-left: 4px; }
.ml-price { font-family: 'Fraunces', serif; font-size: ${f(11.5)}; font-weight: 500; color: var(--plum); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ml-desc { font-size: ${f(10.5)}; color: var(--muted); margin-top: 1px; line-height: 1.4; }
.ml-notes { font-size: ${f(9.5)}; color: var(--plum-soft); font-style: italic; margin-top: 1px; }
.ml-tags { display: inline-flex; gap: 3px; margin-left: 4px; vertical-align: middle; }
.ml-tag { display: inline-flex; align-items: center; justify-content: center; min-width: 14px; height: 14px; padding: 0 4px; border-radius: 3px; color: #fff; font-size: ${f(9)}; font-weight: 700; line-height: 1; }
.ml-group { font-size: ${f(9)}; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin-top: 1.5mm; }
.ml-variants { display: grid; grid-template-columns: 1fr auto; gap: 0 8px; margin-top: 1mm; }
.ml-v-label { font-size: ${f(10.5)}; color: var(--ink); }
.ml-v-price { font-family: 'Fraunces', serif; font-size: ${f(10.5)}; color: var(--plum); font-variant-numeric: tabular-nums; text-align: right; }

.ml-text-heading { font-family: 'Fraunces', serif; font-size: ${f(22)}; font-weight: 500; line-height: 1.15; color: var(--ink); }
.ml-text-subheading { font-size: ${f(12)}; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; color: var(--ink); }
.ml-text-body { font-size: ${f(11)}; color: var(--ink); }
.ml-text-script { font-family: 'Caveat', cursive; font-size: ${f(20)}; color: var(--plum); line-height: 1.2; }
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
.ml-foot { font-family: 'Fraunces', serif; font-style: italic; color: var(--muted); font-size: ${f(10)}; }
.ml-page-num { font-size: ${f(9)}; color: var(--muted); }
`

export const MENU_LAYOUT_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Caveat:wght@400;600;700&family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@300;400;500;600;700&display=swap'

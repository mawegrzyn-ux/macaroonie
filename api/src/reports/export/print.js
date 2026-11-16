// src/reports/export/print.js
//
// A report as a page to print (docs/REPORTS.md 13). Plain HTML made here,
// every word escaped: who it is for, the report's name, what it was run for,
// its chart and its table. The chart is shared/reports/chart.js and the
// table's words shared/reports/table.js, the rules the screen draws by, so
// the paper says what the screen says.
//
//   printLayout(model)     how a table goes on paper: upright or on its side,
//                          its text size, and its columns in parts when one
//                          page isn't wide enough
//   printHtml(page)        the whole page: one report, or a Page report's
//                          blocks in order, drawn by a layout template
//                          (shared/reports/layout.js; none = the built-in one)
//   messageHtml(title, t)  a page that only says something (a link that ran out)
//
// What the page learnt from the menu print pages:
//   - the browser's print dialog can replace @page margins (Margins: Minimum
//     or None), so the body keeps a little padding of its own in print
//   - backgrounds only print with print-color-adjust: exact
//   - on screen the paper keeps its own width whatever the screen's (the
//     sheet scrolls sideways inside itself on a phone): a table squeezed to
//     the screen wraps its names a letter at a time and isn't how it prints
//   - headings repeat on every page (thead as a header group) and a row is
//     never cut in two; the Total is the table's last row, not a tfoot, which
//     browsers repeat on every page
//
// The print dialog opens by itself only with ?print=1 in the address (the
// viewer's Print button adds it), so the same page can be opened and read,
// or turned into a file by a browser on the server (page.pdf: no bar, no
// script, nothing fetched but pictures given as data).

import { renderChart, textWidth, inkOn, brandColour } from '../../../../shared/reports/chart.js'
import { tableModel } from '../../../../shared/reports/table.js'
import { normaliseLayout, BUILT_IN, paperBox, pageRule, negativeText, isNegative, cssString } from '../../../../shared/reports/layout.js'

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ESC[ch])
const sum = list => list.reduce((a, b) => a + b, 0)
const count = n => Number(n || 0).toLocaleString('en-GB')

// How wide the paper is inside its margins, in CSS pixels (96 to the inch):
// the narrower of A4 and US Letter each way, since the paper is the print
// dialog's choice. A4 upright is 190 mm, Letter on its side 259 mm.
// These are the built-in layout's; a layout template has its own (paperBox()).
export const PAGE_WIDTH = { portrait: 718, landscape: 979 }
// The widths are estimates: there is no font to measure with on a server.
const SLACK = 0.96
const TEXT = { normal: 12, small: 10.5 }
const CELL = 15                              // a cell's padding and border, both sides
const WRAP = { first: 240, other: 200 }      // a name wraps rather than push the figures off the paper
const SAMPLE = 500                           // rows looked at to size the columns
// A chart is a little narrower than the room a table has (700 upright and 950 on its side, built in).
const CHART_INSET = { portrait: 18, landscape: 29 }
const PADDING = { compact: 2, normal: 4, roomy: 7 }   // a cell's padding above and below

// How wide each column wants to be at a text size.
function columnWidths(model, size) {
  const w = model.align.map(() => 0)
  const see = (i, text, bold = false) => {
    const x = textWidth(text, size) * (bold ? 1.06 : 1) + CELL
    if (x > w[i]) w[i] = x
  }
  for (const row of model.head) for (const h of row) if (!h.banner) see(h.i, h.label, true)
  for (const r of model.rows.slice(0, SAMPLE)) r.cells.forEach((t, i) => see(i, t, r.kind === 'subtotal'))
  if (model.total) model.total.forEach((t, i) => see(i, t, true))
  return w.map((x, i) => (model.align[i] === 'left' ? Math.min(x, i === 0 ? WRAP.first : WRAP.other) : x))
}

// A table's columns in parts no wider than `room`: the columns that say which
// row it is (a list's first column) lead every part, and the others follow a
// page's width at a time. The values under one heading of a table across are
// never split between two parts. A table that fits is one part.
function partsOf(model, size, room) {
  const n = model.align.length
  const all = [...Array(n).keys()]
  const w = columnWidths(model, size)
  if (sum(w) <= room) return [all]
  const keep = Math.min(Math.max(0, n - 1), model.groupings || (model.count != null ? 1 : 0))
  const banner = new Map()
  if (model.head.length > 1) {
    for (const h of model.head[0]) if (h.banner) for (let i = h.i; i < h.i + h.span; i++) banner.set(i, h)
  }
  const units = []
  for (let i = keep; i < n;) {
    const b = banner.get(i)
    const end = b ? b.i + b.span : i + 1
    units.push(all.slice(i, end))
    i = end
  }
  // Leading columns wider than half the page wrap: they don't crowd the figures out.
  const left = room - Math.min(sum(w.slice(0, keep)), room / 2)
  const parts = []
  let cur = [], used = 0
  for (const u of units) {
    const uw = sum(u.map(i => w[i]))
    if (cur.length && used + uw > left) { parts.push(cur); cur = []; used = 0 }
    cur.push(...u)
    used += uw
  }
  if (cur.length) parts.push(cur)
  return parts.map(p => [...all.slice(0, keep), ...p])
}

// How a document's tables go on paper, one way round for all of them (a
// document has one @page rule): { way, small, room, parts: [per table] }.
// Whichever fits: upright, else on its side, else on its side in smaller
// text. A layout that fixes the way round tries smaller text that way.
// Tables still too wide are printed in parts.
function planTables(models, pg) {
  const box = paperBox(pg)
  const tries = pg.way === 'portrait' ? [['normal', 'portrait'], ['small', 'portrait']]
    : pg.way === 'landscape' ? [['normal', 'landscape'], ['small', 'landscape']]
      : [['normal', 'portrait'], ['normal', 'landscape'], ['small', 'landscape']]
  for (const [size, way] of tries) {
    const room = box[way].fit * SLACK
    if (models.every(m => sum(columnWidths(m, TEXT[size])) <= room)) {
      return { way, small: size === 'small', room, box, parts: models.map(m => [[...Array(m.align.length).keys()]]) }
    }
  }
  const way = pg.way === 'portrait' ? 'portrait' : 'landscape'
  const room = box[way].fit * SLACK
  return { way, small: true, room, box, parts: models.map(m => partsOf(m, TEXT.small, room)) }
}

/**
 * How a table goes on paper: { landscape, small, parts: [[column indexes]] }.
 * Upright when it fits, else on its side, else on its side in smaller text.
 * A table still too wide is printed in parts: the columns that say which row
 * it is (a list's first column) lead every part, and the others follow a
 * page's width at a time. The values under one heading of a table across are
 * never split between two parts. `page` is a layout's page (the built-in one
 * when left out).
 */
export function printLayout(model, page = BUILT_IN.page) {
  const plan = planTables([model], page)
  return { landscape: plan.way === 'landscape', small: plan.small, parts: plan.parts[0] }
}

// The heading rows for some of the columns: a heading over several values
// spans the ones that are there.
function headFor(model, cols) {
  const has = new Set(cols)
  return model.head.map(row => row.map(h => {
    if (!h.banner) return has.has(h.i) ? h : null
    let span = 0
    for (let i = h.i; i < h.i + h.span; i++) if (has.has(i)) span++
    return span ? { ...h, span } : null
  }).filter(Boolean)).filter(row => row.length)
}

function tableHtml(result, model, cols, negatives = 'minus') {
  const dim = result.columns.map(c => c.role === 'compare' || c.role === 'change')
  const cls = (i, extra = '') => {
    const c = [model.align[i] === 'right' ? 'r' : '', dim[i] ? 'dim' : '', extra].filter(Boolean).join(' ')
    return c ? ' class="' + c + '"' : ''
  }
  const head = headFor(model, cols).map(row => '<tr>' + row.map(h => '<th scope="col"'
    + (h.span > 1 ? ' colspan="' + h.span + '"' : '') + (h.depth > 1 ? ' rowspan="' + h.depth + '"' : '')
    + (h.banner ? ' class="c"' : cls(h.i)) + '>' + esc(h.label) + '</th>').join('') + '</tr>').join('')
  // A negative figure as the layout writes it (figures sit on the right).
  const cell = (i, text) => {
    const neg = negatives !== 'minus' && model.align[i] === 'right' && isNegative(text)
    return '<td' + cls(i, neg && negatives === 'red' ? 'neg' : '') + '>' + esc(neg ? negativeText(text, negatives) : text) + '</td>'
  }
  const line = (cells, kind) => '<tr' + (kind ? ' class="' + kind + '"' : '') + '>' + cols.map(i => cell(i, cells[i])).join('') + '</tr>'
  let body = ''
  for (const r of model.rows) body += line(r.cells, r.kind === 'subtotal' ? 'sub' : r.kind === 'rest' ? 'rest' : '')
  if (!model.rows.length) body = '<tr><td class="none" colspan="' + cols.length + '">Nothing to show for these choices.</td></tr>'
  if (model.total) body += line(model.total, 'total')
  return '<table><thead>' + head + '</thead><tbody>' + body + '</tbody></table>'
}

/** A day and time as the group reads it: "Fri, 13 Nov 2026, 14:22". */
export function whenText(iso, tz, { time = false } = {}) {
  const d = iso ? new Date(iso) : new Date()
  if (Number.isNaN(d.getTime())) return ''
  const how = time ? { hour: '2-digit', minute: '2-digit', hour12: false }
    : { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'Europe/London', ...how }).format(d) }
  catch { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', ...how }).format(d) }
}

// A logo's address: one of ours (/uploads/...) or an https one. Anything else is left out.
const pictureUrl = v => (typeof v === 'string' && (/^\/(?!\/)[^\s"'<>]*$/.test(v) || /^https:\/\/[^\s"'<>]+$/.test(v)) ? v : null)
// In a file made on the server nothing is fetched: a logo is there only as data.
const pictureData = v => (typeof v === 'string' && /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(v) ? v : null)

const CSS = `
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#eeeeea;color:#0b0b0b;font:12px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.bar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding:8px 16px;background:#fff;border-bottom:1px solid #d9d8d0}
.bar button{min-height:48px;min-width:48px;padding:0 22px;border:0;border-radius:8px;font:600 15px/1 inherit;cursor:pointer;touch-action:manipulation}
.bar p{margin:0;flex:1;min-width:12rem;color:#55544f;font-size:13px}
.sheet{max-width:100%;margin:16px auto;padding:12mm;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.18);overflow-x:auto}
.top{display:flex;align-items:flex-start;gap:14px;padding-bottom:8px;margin-bottom:10px;border-bottom:2px solid #0b0b0b}
.top img{max-height:46px;max-width:150px;object-fit:contain;flex:none}
.top div{flex:1;min-width:0}
.who{margin:0 0 2px;font-size:11px;color:#55544f}
h1{margin:0;font-size:20px;line-height:1.2;overflow-wrap:anywhere}
.about{margin:4px 0 0;color:#55544f;overflow-wrap:anywhere}
.facts{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:2px 14px;margin:0 0 10px}
.facts dt{color:#55544f}
.facts dd{margin:0;font-weight:600;overflow-wrap:anywhere}
.notes{list-style:none;margin:0 0 10px;padding:6px 10px;border:1px solid #d9d8d0;border-radius:6px;color:#55544f;font-size:11px}
.notes li+li{margin-top:2px}
.chart{margin:0 0 10px;break-inside:avoid}
.part{margin:0 0 4px;font-size:11px;font-weight:600;color:#55544f}
table{width:100%;margin:0 0 12px;border-collapse:collapse;font-size:12px}
.small table{font-size:10.5px}
thead{display:table-header-group}
tr{break-inside:avoid}
th,td{padding:4px 7px;border-bottom:1px solid #d9d8d0;text-align:left;vertical-align:top;overflow-wrap:break-word}
th{vertical-align:bottom;white-space:nowrap;font-weight:600;color:#3c3b37;background:#f1f1ee;border-bottom-color:#a9a89f}
th.c{text-align:center;border-left:1px solid #d9d8d0}
.r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.dim{color:#55544f;font-weight:400}
.neg{color:#b42318}
tr.sub td{background:#f1f1ee;font-weight:600}
tr.rest td{font-style:italic}
tr.total td{border-top:2px solid #0b0b0b;border-bottom:0;background:#f1f1ee;font-weight:700}
td.none{padding:28px 7px;text-align:center;color:#55544f}
.foot{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 16px;margin-top:14px;padding-top:6px;border-top:1px solid #d9d8d0;font-size:10px;color:#55544f}
.footwords{margin:10px 0 0;font-size:9px;color:#55544f;overflow-wrap:anywhere}
.block{margin:0 0 16px}
h2{margin:0 0 4px;font-size:15px;line-height:1.25;overflow-wrap:anywhere;break-after:avoid}
.block .about{margin:0 0 4px}
.blockfacts{margin:0 0 8px;font-size:11px;color:#55544f;overflow-wrap:anywhere}
.words{margin:0 0 10px;white-space:pre-line;overflow-wrap:anywhere}
.gone{margin:0 0 10px;padding:8px 10px;border:1px dashed #a9a89f;border-radius:6px;color:#55544f}
.break{margin:4px 0 16px;border-top:1px dashed #a9a89f;break-after:page}
.break::after{content:"Page break";display:block;margin-top:2px;font-size:9px;color:#55544f}
.front{display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:10px;min-height:120mm;margin:0 0 14px;padding:0 0 14px;border-bottom:1px dashed #a9a89f;break-after:page}
.front img{max-height:80px;max-width:240px;object-fit:contain}
.fronttitle{margin:0;font-size:30px;font-weight:700;line-height:1.15;overflow-wrap:anywhere}
.frontfact{margin:0;font-size:14px;color:#55544f}
.front .words{margin:6px 0 0;font-size:13px}
.bar button,th,tr.sub td,tr.total td{print-color-adjust:exact;-webkit-print-color-adjust:exact}
@media print{
  body{background:#fff;padding:0 2mm}
  .bar{display:none}
  .sheet{width:auto!important;max-width:none;margin:0;padding:0;box-shadow:none;overflow:visible}
  .paper{width:auto!important}
  .footwords{display:none}
  .break{margin:0;border:0}
  .break::after{display:none}
  .front{margin:0;padding:0;border:0}
}
`

const noteList = items => (items.length ? '<ul class="notes">' + items.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '')

// The facts a layout's header shows: the period (and what it is compared
// with), and the choices (venues, other choices, the rows opened up, how many
// rows). A fact is [label, words, kind]; no kind counts as a choice.
const factsFor = (facts, header) => (facts || []).filter(f => (f[2] === 'period' ? header.period : header.choices))

// One report's own part of the paper: its notes, its chart and its table.
// `parts` are its columns as the document's plan cut them; a table the plan
// didn't count on (its chart was to stand in for it) is cut to fit here.
function reportBody(sec, plan, parts, lay, brand) {
  const { result, model } = sec
  const meta = result.meta || {}
  const view = result.spec?.view
  const charted = sec.chart !== false && !!view && view.kind !== 'table' && result.kind !== 'list'
  const chart = charted
    ? renderChart(result, { width: plan.box[plan.way].fit - CHART_INSET[plan.way], brand, legend: 'inside', hidden: sec.hidden || [] })
    : null
  // The table always prints when there is no chart to print instead.
  const withTable = !chart?.ok || (sec.table ?? (view.table_below !== false))
  const cut = !withTable ? [] : parts || partsOf(model, plan.small ? TEXT.small : TEXT.normal, plan.room)

  const notes = [...(meta.notes || [])]
  if (result.kind === 'list' && meta.truncated) {
    notes.push('The first ' + count(result.rows.length) + ' of ' + count(meta.row_count ?? result.rows.length) + ' rows are printed.')
  }
  if (chart && !chart.ok && chart.why) notes.push('No chart: ' + chart.why + '.')
  if (cut.length > 1) notes.push('The table is too wide for one page, so its columns are printed in ' + cut.length + ' parts.')

  let tables = ''
  cut.forEach((cols, i) => {
    if (cut.length > 1) tables += '<p class="part">Part ' + (i + 1) + ' of ' + cut.length + '</p>'
    tables += tableHtml(result, model, cols, lay.style.negatives)
  })
  return {
    html: noteList(notes)
      + (chart?.ok ? '<figure class="chart">' + chart.svg + '</figure>' + noteList(chart.model.notes || []) : '')
      + tables,
    parts: cut.length,
  }
}

const MARGIN_BOX = 'font-size:9px;font-family:system-ui,sans-serif;color:#55544f'

/**
 * The page. `page`:
 *
 *   group        the restaurant group's name
 *   logo         its logo's address (left out unless ours or https)
 *   brand        its main colour (one series of a chart wears it)
 *   name, description   the report's (or the Page report's)
 *   facts        [[label, words, kind]]: the period (kind 'period'), the
 *                venues and the other choices (no kind), how many rows
 *   result       what the engine returned (one report)
 *   table        false: the chart alone, when it can be drawn (the screen
 *                had the table closed); anything else: as the report says
 *   hidden       keys of the series switched off in the chart's legend on
 *                screen: they stay off on paper (one series always draws)
 *   sections     instead of `result`, a Page report's blocks in order:
 *                { type: 'report', title, about, facts, result, hidden,
 *                  chart: false (the table alone), table: false (the chart
 *                  alone, when it can be drawn) } or, for a report that
 *                couldn't be run, { type: 'report', title, error }
 *                { type: 'text', title, text }
 *                { type: 'break' }
 *   asOf, tz     when the figures were read and the group's time zone, for a
 *                page of several reports (one report says its own)
 *   layout       a layout template (shared/reports/layout.js), as stored or
 *                normalised; none: the built-in one
 *   by           who pressed Print (their email)
 *   byLabel      the words before it ('Printed by' unless given)
 *   expires      when the link stops working (the bar on screen says so)
 *   nonce        for the page's one script
 *   preview      true: the layout editor's preview (no bar, no script)
 *   pdf          true: for a browser on the server to make a file from (no
 *                bar, no script, nothing fetched: the logo only as data, and
 *                the printer's own paper is A4)
 */
export function printHtml(page) {
  const lay = normaliseLayout(page.layout)
  const pdf = !!page.pdf
  const bare = pdf || !!page.preview
  const single = !Array.isArray(page.sections)
  const sections = (single ? [{ type: 'report', result: page.result, table: page.table, hidden: page.hidden }] : page.sections)
    .map(s => (s.type === 'report' && s.result ? { ...s, model: tableModel(s.result) } : s))
  // The tables sure to be drawn choose the paper (one report's always does,
  // as before layouts). A table its chart stands in for is cut to fit it.
  const planned = sections.filter(s => s.model && (single || s.table !== false))
  const plan = planTables(planned.map(s => s.model), lay.page)
  const way = plan.way
  const meta = (single && page.result.meta) || {}
  const tz = page.tz || meta.tz || 'Europe/London'

  const logo = !lay.header.logo ? null : pdf ? pictureData(page.logo) : pictureUrl(page.logo)
  const brand = brandColour(page.brand)
  const colour = brand || '#0b0b0b'
  const title = [page.name, page.group].filter(Boolean).join(' · ')
  const asOf = whenText(page.asOf || meta.cached_at || meta.generated_at, tz)
  const who = page.group && lay.header.group ? '<p class="who">' + esc(page.group) + '</p>' : ''
  const picture = logo ? '<img src="' + esc(logo) + '" alt="">' : ''

  let rows = 0, parts = 0
  const body = sections.map(sec => {
    if (sec.type === 'break') return '<div class="break"></div>'
    const head = sec.title ? '<h2>' + esc(sec.title) + '</h2>' : ''
    if (sec.type === 'text') {
      return '<section class="block text">' + head + (sec.text ? '<p class="words">' + esc(sec.text) + '</p>' : '') + '</section>'
    }
    if (!sec.model) {
      return '<section class="block">' + head + '<p class="gone">' + esc(sec.error || 'This report can\'t be shown.') + '</p></section>'
    }
    const at = planned.indexOf(sec)
    const drawn = reportBody(sec, plan, at < 0 ? null : plan.parts[at], lay, page.brand)
    rows += sec.model.rows.length
    parts += drawn.parts
    if (single) return drawn.html
    const said = factsFor(sec.facts, lay.header)
    return '<section class="block">' + head
      + (sec.about && lay.header.about ? '<p class="about">' + esc(sec.about) + '</p>' : '')
      + (said.length ? '<p class="blockfacts">' + said.map(([k, v]) => esc(k) + ': ' + esc(v)).join(' · ') + '</p>' : '')
      + drawn.html + '</section>'
  }).join('')

  // A front page: the title by itself, before the report starts on the next sheet.
  const period = (page.facts || []).find(f => f[2] === 'period')
  const front = !lay.front.on ? '' : '<section class="front">' + picture + who
    + '<p class="fronttitle">' + esc(page.name || 'Report') + '</p>'
    + (period ? '<p class="frontfact">' + esc(period[1]) + '</p>' : '')
    + (lay.front.text ? '<p class="words">' + esc(lay.front.text) + '</p>' : '')
    + '</section>'

  const pad = PADDING[lay.style.density]
  const rule = pageRule(pdf && lay.page.size === 'auto' ? { ...lay.page, size: 'a4' } : lay.page, way)
  const style = '.sheet{width:calc(' + plan.box[way].mm + 'mm + 24mm)}'
    + '.paper{width:' + plan.box[way].mm + 'mm}'
    + '.bar button{background:' + colour + ';color:' + inkOn(colour) + '}'
    + (lay.style.density === 'normal' ? '' : 'th,td{padding-top:' + pad + 'px;padding-bottom:' + pad + 'px}')
    + (lay.style.stripes ? 'tbody tr:nth-child(even):not(.sub):not(.total) td{background:#f6f6f2;print-color-adjust:exact;-webkit-print-color-adjust:exact}' : '')
    + (lay.style.brand && brand
      ? '.top{border-bottom-color:' + brand + '}th,th.dim{background:' + brand + ';color:' + inkOn(brand) + ';border-bottom-color:' + brand + '}tr.total td{border-top-color:' + brand + '}'
      : '')
    + '@page{size:' + rule.size + ';margin:' + rule.margin + ';'
    + (lay.footer.text ? '@bottom-left{content:' + cssString(lay.footer.text) + ';' + MARGIN_BOX + '}' : '')
    + (lay.footer.numbers ? '@bottom-right{content:"Page " counter(page) " of " counter(pages);' + MARGIN_BOX + '}' : '')
    + '}'

  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
    + (pdf ? '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">' : '')
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta name="robots" content="noindex, nofollow">'
    + '<title>' + esc(title) + '</title>'
    + '<style>' + CSS + style + '</style></head>'
    + '<body class="' + way + (plan.small ? ' small' : '') + (page.preview ? ' preview' : '') + '" data-rows="' + rows + '" data-parts="' + parts + '">'
    + (bare ? '' : '<div class="bar"><button type="button" id="print">Print</button><p>This is how the report prints'
      + (page.expires ? '. The page works until ' + esc(whenText(page.expires, tz, { time: true })) + ': after that, press Print on the report again' : '') + '.</p></div>')
    + '<main class="sheet"><div class="paper">'
    + front
    + '<header class="top">' + picture
    + '<div>' + who
    + '<h1>' + esc(page.name || 'Report') + '</h1>'
    + (page.description && lay.header.about ? '<p class="about">' + esc(page.description) + '</p>' : '') + '</div></header>'
    + '<dl class="facts">' + factsFor(page.facts, lay.header).map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl>'
    + body
    + (lay.header.run
      ? '<footer class="foot"><span>' + (asOf ? 'Figures as of ' + esc(asOf) : '') + '</span>'
        + '<span>' + (page.by ? esc(page.byLabel || 'Printed by') + ' ' + esc(page.by) : '') + '</span></footer>'
      : '')
    + (lay.footer.text ? '<p class="footwords">' + esc(lay.footer.text) + '</p>' : '')
    + '</div></main>'
    + (bare ? '' : '<script' + (page.nonce ? ' nonce="' + esc(page.nonce) + '"' : '') + '>'
      + 'document.getElementById("print").addEventListener("click",function(){window.print()});'
      + 'if(/[?&]print=1(&|$)/.test(location.search))window.addEventListener("load",function(){setTimeout(function(){window.print()},250)});'
      + '</script>')
    + '</body></html>'
}

/** A page that only says something: a link that isn't there or has run out, a report that can't be printed. */
export function messageHtml(title, text) {
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta name="robots" content="noindex, nofollow">'
    + '<title>' + esc(title) + '</title>'
    + '<style>body{margin:0;padding:48px 20px;background:#eeeeea;color:#0b0b0b;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}'
    + 'main{max-width:30rem;margin:0 auto;padding:24px;background:#fff;border-radius:12px;box-shadow:0 1px 6px rgba(0,0,0,.18)}'
    + 'h1{margin:0 0 8px;font-size:18px}p{margin:0;color:#55544f}</style></head>'
    + '<body><main><h1>' + esc(title) + '</h1><p>' + esc(text) + '</p></main></body></html>'
}

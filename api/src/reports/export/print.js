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
//   printHtml(page)        the whole page
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
// or turned into a file by a browser on the server later.

import { renderChart, textWidth, inkOn, brandColour } from '../../../../shared/reports/chart.js'
import { tableModel } from '../../../../shared/reports/table.js'

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ESC[ch])
const sum = list => list.reduce((a, b) => a + b, 0)
const count = n => Number(n || 0).toLocaleString('en-GB')

// How wide the paper is inside its margins, in CSS pixels (96 to the inch):
// the narrower of A4 and US Letter each way, since the paper is the print
// dialog's choice. A4 upright is 190 mm, Letter on its side 259 mm.
export const PAGE_WIDTH = { portrait: 718, landscape: 979 }
const PAGE_MM = { portrait: 190, landscape: 277 }
// The widths are estimates: there is no font to measure with on a server.
const SLACK = 0.96
const TEXT = { normal: 12, small: 10.5 }
const CELL = 15                              // a cell's padding and border, both sides
const WRAP = { first: 240, other: 200 }      // a name wraps rather than push the figures off the paper
const SAMPLE = 500                           // rows looked at to size the columns
const CHART_WIDTH = { portrait: 700, landscape: 950 }

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

/**
 * How a table goes on paper: { landscape, small, parts: [[column indexes]] }.
 * Upright when it fits, else on its side, else on its side in smaller text.
 * A table still too wide is printed in parts: the columns that say which row
 * it is (a list's first column) lead every part, and the others follow a
 * page's width at a time. The values under one heading of a table across are
 * never split between two parts.
 */
export function printLayout(model) {
  const n = model.align.length
  const all = [...Array(n).keys()]
  for (const [size, way] of [['normal', 'portrait'], ['normal', 'landscape'], ['small', 'landscape']]) {
    if (sum(columnWidths(model, TEXT[size])) <= PAGE_WIDTH[way] * SLACK) return { landscape: way === 'landscape', small: size === 'small', parts: [all] }
  }
  const w = columnWidths(model, TEXT.small)
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
  const page = PAGE_WIDTH.landscape * SLACK
  // Leading columns wider than half the page wrap: they don't crowd the figures out.
  const room = page - Math.min(sum(w.slice(0, keep)), page / 2)
  const parts = []
  let cur = [], used = 0
  for (const u of units) {
    const uw = sum(u.map(i => w[i]))
    if (cur.length && used + uw > room) { parts.push(cur); cur = []; used = 0 }
    cur.push(...u)
    used += uw
  }
  if (cur.length) parts.push(cur)
  return { landscape: true, small: true, parts: parts.map(p => [...all.slice(0, keep), ...p]) }
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

function tableHtml(result, model, cols) {
  const dim = result.columns.map(c => c.role === 'compare' || c.role === 'change')
  const cls = (i, extra = '') => {
    const c = [model.align[i] === 'right' ? 'r' : '', dim[i] ? 'dim' : '', extra].filter(Boolean).join(' ')
    return c ? ' class="' + c + '"' : ''
  }
  const head = headFor(model, cols).map(row => '<tr>' + row.map(h => '<th scope="col"'
    + (h.span > 1 ? ' colspan="' + h.span + '"' : '') + (h.depth > 1 ? ' rowspan="' + h.depth + '"' : '')
    + (h.banner ? ' class="c"' : cls(h.i)) + '>' + esc(h.label) + '</th>').join('') + '</tr>').join('')
  const line = (cells, kind) => '<tr' + (kind ? ' class="' + kind + '"' : '') + '>'
    + cols.map(i => '<td' + cls(i) + '>' + esc(cells[i]) + '</td>').join('') + '</tr>'
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
tr.sub td{background:#f1f1ee;font-weight:600}
tr.rest td{font-style:italic}
tr.total td{border-top:2px solid #0b0b0b;border-bottom:0;background:#f1f1ee;font-weight:700}
td.none{padding:28px 7px;text-align:center;color:#55544f}
.foot{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 16px;margin-top:14px;padding-top:6px;border-top:1px solid #d9d8d0;font-size:10px;color:#55544f}
.bar button,th,tr.sub td,tr.total td{print-color-adjust:exact;-webkit-print-color-adjust:exact}
@media print{
  body{background:#fff;padding:0 2mm}
  .bar{display:none}
  .sheet{width:auto!important;max-width:none;margin:0;padding:0;box-shadow:none;overflow:visible}
  .paper{width:auto!important}
}
`

/**
 * The page. `page`:
 *
 *   group        the restaurant group's name
 *   logo         its logo's address (left out unless ours or https)
 *   brand        its main colour (one series of a chart wears it)
 *   name, description   the report's
 *   facts        [[label, words]]: the period, the venues, the other choices
 *   result       what the engine returned
 *   table        false: the chart alone, when it can be drawn (the screen
 *                had the table closed); anything else: as the report says
 *   hidden       keys of the series switched off in the chart's legend on
 *                screen: they stay off on paper (one series always draws)
 *   by           who pressed Print (their email)
 *   expires      when the link stops working (the bar on screen says so)
 *   nonce        for the page's one script
 */
export function printHtml(page) {
  const { result } = page
  const meta = result.meta || {}
  const tz = meta.tz || 'Europe/London'
  const model = tableModel(result)
  const layout = printLayout(model)
  const way = layout.landscape ? 'landscape' : 'portrait'

  const view = result.spec?.view
  const charted = !!view && view.kind !== 'table' && result.kind !== 'list'
  const chart = charted ? renderChart(result, { width: CHART_WIDTH[way], brand: page.brand, legend: 'inside', hidden: page.hidden || [] }) : null
  // The table always prints when there is no chart to print instead.
  const withTable = !chart?.ok || (page.table ?? (view.table_below !== false))

  const notes = [...(meta.notes || [])]
  if (result.kind === 'list' && meta.truncated) {
    notes.push('The first ' + count(result.rows.length) + ' of ' + count(meta.row_count ?? result.rows.length) + ' rows are printed.')
  }
  if (chart && !chart.ok && chart.why) notes.push('No chart: ' + chart.why + '.')
  const chartNotes = chart?.ok ? chart.model.notes || [] : []
  if (withTable && layout.parts.length > 1) {
    notes.push('The table is too wide for one page, so its columns are printed in ' + layout.parts.length + ' parts.')
  }
  const list = items => (items.length ? '<ul class="notes">' + items.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '')

  const logo = pictureUrl(page.logo)
  const colour = brandColour(page.brand) || '#0b0b0b'
  const title = [page.name, page.group].filter(Boolean).join(' · ')
  const asOf = whenText(meta.cached_at || meta.generated_at, tz)

  let tables = ''
  if (withTable) {
    layout.parts.forEach((cols, i) => {
      if (layout.parts.length > 1) tables += '<p class="part">Part ' + (i + 1) + ' of ' + layout.parts.length + '</p>'
      tables += tableHtml(result, model, cols)
    })
  }

  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta name="robots" content="noindex, nofollow">'
    + '<title>' + esc(title) + '</title>'
    + '<style>' + CSS
    + '.sheet{width:calc(' + PAGE_MM[way] + 'mm + 24mm)}'
    + '.paper{width:' + PAGE_MM[way] + 'mm}'
    + '.bar button{background:' + colour + ';color:' + inkOn(colour) + '}'
    + '@page{size:' + way + ';margin:12mm 10mm 14mm;@bottom-right{content:"Page " counter(page) " of " counter(pages);font-size:9px;font-family:system-ui,sans-serif;color:#55544f}}'
    + '</style></head>'
    + '<body class="' + way + (layout.small ? ' small' : '') + '" data-rows="' + model.rows.length + '" data-parts="' + (withTable ? layout.parts.length : 0) + '">'
    + '<div class="bar"><button type="button" id="print">Print</button><p>This is how the report prints'
    + (page.expires ? '. The page works until ' + esc(whenText(page.expires, tz, { time: true })) + ': after that, press Print on the report again' : '') + '.</p></div>'
    + '<main class="sheet"><div class="paper">'
    + '<header class="top">' + (logo ? '<img src="' + esc(logo) + '" alt="">' : '')
    + '<div>' + (page.group ? '<p class="who">' + esc(page.group) + '</p>' : '')
    + '<h1>' + esc(page.name || 'Report') + '</h1>'
    + (page.description ? '<p class="about">' + esc(page.description) + '</p>' : '') + '</div></header>'
    + '<dl class="facts">' + (page.facts || []).map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl>'
    + list(notes)
    + (chart?.ok ? '<figure class="chart">' + chart.svg + '</figure>' + list(chartNotes) : '')
    + tables
    + '<footer class="foot"><span>' + (asOf ? 'Figures as of ' + esc(asOf) : '') + '</span>'
    + '<span>' + (page.by ? 'Printed by ' + esc(page.by) : '') + '</span></footer>'
    + '</div></main>'
    + '<script' + (page.nonce ? ' nonce="' + esc(page.nonce) + '"' : '') + '>'
    + 'document.getElementById("print").addEventListener("click",function(){window.print()});'
    + 'if(/[?&]print=1(&|$)/.test(location.search))window.addEventListener("load",function(){setTimeout(function(){window.print()},250)});'
    + '</script></body></html>'
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

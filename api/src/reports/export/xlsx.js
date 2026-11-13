// src/reports/export/xlsx.js
//
// A report as an Excel workbook (docs/REPORTS.md 15): real numbers,
// percentages and dates with their formats, column widths, and an About
// sheet saying what was run. SheetJS writes values and number formats,
// little styling: subtotal and total rows are labelled, not coloured.
//
// A workbook is built in memory, so it has a ceiling: 200,000 cells. A
// longer list is cut there and says so on the About sheet (a CSV has no
// such ceiling).

import XLSX from 'xlsx'
import { safeText } from '../../../../shared/reports/format.js'
import { runReport } from '../run.js'
import { resultTable } from './table.js'

export const XLSX_CELLS = 200000

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/
const MOMENT = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/
// Days from Excel's day 0 (30 Dec 1899) to 1 Jan 1970.
const EXCEL_EPOCH = 25569

// A day or a moment as Excel's own number, worked out from the wall time as
// written: the server's time zone never comes into it.
const serial = (y, mo, d, h = 0, mi = 0, s = 0) => Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) / 86400000 + EXCEL_EPOCH

const decimalsFormat = d => '#,##0' + (d > 0 ? '.' + '0'.repeat(Math.min(6, d)) : '')

// A SheetJS cell from a file value (see plainValue()) and its column.
function cellOf(v, col) {
  if (v === '' || v == null) return null
  const type = col.format || col.type
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null
    if (type === 'money') return { t: 'n', v, z: '#,##0.00' }
    // A file value is percent points (15.3); a spreadsheet's own percentage is the fraction.
    if (type === 'percent') return { t: 'n', v: v / 100, z: '0' + ((col.decimals ?? 1) > 0 ? '.' + '0'.repeat(Math.min(6, col.decimals ?? 1)) : '') + '%' }
    if (type === 'number' && col.decimals != null) return { t: 'n', v, z: decimalsFormat(col.decimals) }
    return { t: 'n', v }
  }
  const s = String(v)
  // A day or a moment as a real date (grouped into weeks, months or hours it is words).
  if ((type === 'date' || type === 'moment') && (!col.bucket || col.bucket === 'day')) {
    let m = YMD.exec(s)
    if (m) return { t: 'n', v: serial(m[1], m[2], m[3]), z: 'dd/mm/yyyy' }
    m = MOMENT.exec(s)
    if (m) return { t: 'n', v: serial(m[1], m[2], m[3], m[4], m[5], m[6] || 0), z: 'dd/mm/yyyy hh:mm' }
  }
  return { t: 's', v: safeText(s) }
}

function width(head, rows, cols, i) {
  let w = String(head[i] ?? '').length
  const type = cols[i].format || cols[i].type
  if ((type === 'date' || type === 'moment') && (!cols[i].bucket || cols[i].bucket === 'day')) w = Math.max(w, type === 'moment' ? 16 : 10)
  for (let r = 0; r < rows.length && r < 500; r++) {
    const v = rows[r][i]
    const len = typeof v === 'number' ? v.toFixed(2).length + 1 : String(v ?? '').length
    if (len > w) w = len
  }
  return Math.max(8, Math.min(48, w + 2))
}

/**
 * A shaped result as a workbook (a Buffer). `about`: { name, description,
 * venues, by, notes } for the About sheet.
 */
export function xlsxOf(result, about = {}) {
  const t = resultTable(result)
  const cols = result.columns
  const ws = {}
  const put = (r, c, cell) => { if (cell) ws[XLSX.utils.encode_cell({ r, c })] = cell }
  t.head.forEach((h, c) => put(0, c, { t: 's', v: safeText(h) }))
  t.rows.forEach((row, r) => row.forEach((v, c) => put(r + 1, c, cellOf(v, cols[c]))))
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: t.rows.length, c: Math.max(0, cols.length - 1) } })
  ws['!cols'] = cols.map((_, i) => ({ wch: width(t.head, t.rows, cols, i) }))

  const meta = result.meta || {}
  const lines = [
    ['Report', about.name || ''],
    ...(about.description ? [['About', about.description]] : []),
    ...(meta.period ? [['Period', meta.period.text || (meta.period.from + ' to ' + meta.period.to)]] : []),
    ...(meta.compare ? [['Compared with', meta.compare.text || (meta.compare.from + ' to ' + meta.compare.to)]] : []),
    ...(about.venues ? [['Venues', about.venues]] : []),
    ['Rows', meta.row_count ?? t.rows.length],
    ['Run', (meta.generated_at || new Date().toISOString()).replace('T', ' ').slice(0, 16) + ' UTC'],
    ...(about.by ? [['By', about.by]] : []),
    ...(meta.currency ? [['Money in', meta.currency]] : []),
    ...[...(meta.notes || []), ...(about.notes || [])].map((n, i) => [i ? '' : 'Notes', n]),
  ].map(row => row.map(v => (typeof v === 'string' ? safeText(v) : v)))
  const aboutSheet = XLSX.utils.aoa_to_sheet(lines)
  aboutSheet['!cols'] = [{ wch: 16 }, { wch: 90 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Report')
  XLSX.utils.book_append_sheet(wb, aboutSheet, 'About')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

/**
 * A definition as a workbook: { buffer, rows, truncated, notes }. A list is
 * run with a cap that keeps the workbook under XLSX_CELLS.
 */
export async function xlsxExport(ctx, spec, given, about = {}) {
  const cap = spec.kind === 'list' ? Math.max(1000, Math.floor(XLSX_CELLS / Math.max(1, spec.rows.length + 1))) : null
  const result = await runReport(ctx, spec, given, { mode: 'export', ...(cap ? { cap } : {}) })
  if (result.rows.length * Math.max(1, result.columns.length) > XLSX_CELLS * 2) {
    const err = new Error('This report is too big for an Excel file. Download it as CSV, or narrow it down')
    err.statusCode = 422
    throw err
  }
  const notes = result.meta.truncated && result.kind === 'list'
    ? ['An Excel file holds the first ' + result.rows.length.toLocaleString('en-GB') + ' rows of this report. A CSV holds them all']
    : []
  return {
    buffer: xlsxOf(result, { ...about, notes: [...(about.notes || []), ...notes] }),
    rows: result.meta.row_count,
    truncated: result.meta.truncated,
    notes: result.meta.notes,
  }
}

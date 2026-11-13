// shared/reports/table.js
//
// A report's result as the table people read (docs/REPORTS.md 9): the words
// in each cell, the heading rows and which columns sit on the right. One set
// of rules for the page (admin components/reports/ResultTable.jsx) and the
// print page (api/src/reports/export/print.js), so a printed table says what
// the screen says. A file's table is api/src/reports/export/table.js: numbers
// stay numbers there.
//
//   rightAligned(col, kind)       numbers sit on the right
//   cellText(v, col, currency)    a cell's words (formatValue(); a change as +12.4%)
//   tableHeadings(columns)        { rows: [[{ i, col, label, span, depth, banner? }]] }
//   rowText(result, row, i)       what a row shows in column i
//   totalText(result, i)          what the Total row shows in column i
//   tableModel(result)            all of it at once, as words:
//                                 { head, align, rows: [{ kind, level, cells }],
//                                   total: [text] | null, first_is_row,
//                                   groupings, count }

import { formatValue, changeText, NUMERIC_TYPES } from './format.js'

const typeOf = c => c.format || c.type

// Numbers sit on the right. A grouping that happens to be a number (a party
// of 4) stays with the other groupings on the left.
export function rightAligned(col, kind) {
  if (!NUMERIC_TYPES.includes(typeOf(col))) return false
  return kind === 'list' || col.role !== 'row'
}

export function cellText(v, col, currency = null) {
  if (col.role === 'change') return changeText(v)
  return formatValue(v, col, { currency })
}

/**
 * The heading rows. A table across with several values gets the column
 * values on one row and the values' names under them; with one value, just
 * the column values. Anything else is one row.
 */
export function tableHeadings(columns) {
  const grouped = columns.some(c => (c.role === 'value' || c.role === 'total') && c.group)
  if (!grouped) return { rows: [columns.map((c, i) => ({ i, col: c, label: c.label, span: 1, depth: 1 }))] }
  const perGroup = new Map()
  for (const c of columns) if (c.group) perGroup.set(c.group, (perGroup.get(c.group) || 0) + 1)
  const single = [...perGroup.values()].every(n => n === 1)
  if (single) return { rows: [columns.map((c, i) => ({ i, col: c, label: c.group || c.label, span: 1, depth: 1 }))] }
  const top = []
  const under = []
  columns.forEach((c, i) => {
    if (!c.group) { top.push({ i, col: c, label: c.label, span: 1, depth: 2 }); return }
    const last = top[top.length - 1]
    if (last && last.group === c.group) last.span += 1
    else top.push({ i, col: c, label: c.group, span: 1, depth: 1, group: c.group, banner: true })
    under.push({ i, col: c, label: c.label, span: 1, depth: 1 })
  })
  return { rows: [top, under] }
}

/**
 * What a row shows in a column: a subtotal says so in the first grouping it
 * leaves empty, "everything else" is its own words.
 */
export function rowText(result, row, i) {
  const col = result.columns[i]
  if (row.kind === 'subtotal' && col.role === 'row' && i === (row.level || 0)) return 'Subtotal'
  if (row.kind === 'rest' && i === 0) return row.cells[0] == null ? '' : String(row.cells[0])
  return cellText(row.cells[i], col, result.meta?.currency || null)
}

/** How many rows a list has in all (it may show fewer). Null for anything else. */
export const listCount = result => (result.kind === 'list' ? (result.totals?.count ?? result.meta?.row_count ?? result.rows?.length ?? 0) : null)

/**
 * What the Total row shows in a column. A list's says how many rows there
 * are and the sums that add up; a summary's and a table across's say Total.
 */
export function totalText(result, i) {
  const { columns, totals, kind } = result
  if (!totals?.cells) return ''
  const currency = result.meta?.currency || null
  if (kind === 'list') {
    const v = totals.cells[i]
    const count = listCount(result)
    if (i === 0 && v == null) return count.toLocaleString('en-GB') + (count === 1 ? ' row' : ' rows')
    return v == null ? '' : cellText(v, columns[i], currency)
  }
  if (i === 0 && columns[0]?.role === 'row') return 'Total'
  return columns[i].role === 'row' ? '' : cellText(totals.cells[i], columns[i], currency)
}

/** The whole table as words, in the order shown. */
export function tableModel(result) {
  const { columns = [], rows = [], totals, kind } = result || {}
  return {
    head: tableHeadings(columns).rows,
    align: columns.map(c => (rightAligned(c, kind) ? 'right' : 'left')),
    rows: rows.map(row => ({ kind: row.kind, level: row.level || 0, cells: columns.map((_, i) => rowText(result, row, i)) })),
    total: totals?.cells && rows.length ? columns.map((_, i) => totalText(result, i)) : null,
    first_is_row: columns[0]?.role === 'row',
    // How many columns say which row it is (they come first).
    groupings: columns.filter(c => c.role === 'row').length,
    count: result ? listCount(result) : null,
  }
}

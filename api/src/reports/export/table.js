// src/reports/export/table.js
//
// A report's result as a plain table for a file (docs/REPORTS.md 15): one
// heading row and rows of cells, the same for CSV and Excel.
//
//   numbers stay numbers       money in pounds, a percentage as percent
//                              points (15.3 for 15.3%), a duration in seconds
//   days and moments           ISO text a spreadsheet reads as a date
//   a subtotal                 "Subtotal" in its first empty grouping column
//   "everything else"          its words in the first column
//   the total                  "Total" in the first column (summaries and
//                              matrices; a list is its rows and nothing else)
//
// The headings say what a number is: "Net sales (GBP)", "No-show rate (%)".

import { plainValue, plainHeading } from '../../../../shared/reports/format.js'

/** The heading of each column. `meta.currency` is null when money comes in more than one currency. */
export function headings(columns, meta = {}) {
  return columns.map(c => plainHeading(c, { currency: meta.currency || null }))
}

/** One row's cells for a file. */
export const plainCells = (columns, cells) => columns.map((c, i) => plainValue(cells[i], c))

// The grouping columns come first. A subtotal's or total's label goes in the
// first grouping column it leaves empty (`from`: how many it fills).
function labelled(columns, cells, label, from = 0) {
  const out = plainCells(columns, cells)
  if (columns[from]?.role === 'row') out[from] = label
  return out
}

/**
 * A shaped result as { head: [text], rows: [[cell]], kinds: ['row' |
 * 'subtotal' | 'rest' | 'total'] }, in the order shown on screen.
 */
export function resultTable(result) {
  const { columns } = result
  const head = headings(columns, result.meta)
  const rows = []
  const kinds = []
  for (const r of result.rows) {
    if (r.kind === 'subtotal') {
      // A subtotal's label goes after the groupings it is a subtotal of.
      rows.push(labelled(columns, r.cells, 'Subtotal', r.level || 0))
    } else if (r.kind === 'rest') {
      // "Everything else" is words in the first column, whatever that column
      // holds for the other rows (a party size, a weekday, an hour).
      const out = plainCells(columns, r.cells)
      out[0] = r.cells[0] == null ? '' : String(r.cells[0])
      rows.push(out)
    } else {
      rows.push(plainCells(columns, r.cells))
    }
    kinds.push(r.kind)
  }
  if (result.kind !== 'list' && result.totals?.cells) {
    rows.push(labelled(columns, result.totals.cells, 'Total'))
    kinds.push('total')
  }
  return { head, rows, kinds }
}

/** A file name from a report's name: letters, digits and dashes. */
export function fileName(name, ext, when = new Date()) {
  const base = String(name || 'report').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'report'
  return base + '-' + when.toISOString().slice(0, 10) + '.' + ext
}

// src/components/reports/ResultTable.jsx
//
// A report's result as a table (docs/REPORTS.md 9): one drawing for the
// viewer and, later, the builder's preview. Every cell goes through
// formatValue() (shared/reports/format.js), the same words the files' About
// sheet and the print page use.
//
//   result   what POST /api/reports/:id/run answers: { kind, columns, rows,
//            totals, meta }
//
// A list shows its rows and, under them, the sums that add up and how many
// rows there are. A summary shows subtotals and a total. A matrix shows the
// column values across the top, the report's values under each when it has
// more than one.

import { formatValue, NUMERIC_TYPES } from '@shared/reports/format.js'
import { cn } from '@/lib/utils'

const typeOf = c => c.format || c.type

// Numbers sit on the right. A grouping that happens to be a number (a party
// of 4) stays with the other groupings on the left.
function rightAligned(col, kind) {
  if (!NUMERIC_TYPES.includes(typeOf(col))) return false
  return kind === 'list' || col.role !== 'row'
}

// A change with its sign: +12.4%, -3.0%. No colours: whether more is better
// depends on the figure (sales up, voids up).
function changeText(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return ''
  const s = (Math.abs(v) * 100).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'
  return (v > 0 ? '+' : v < 0 ? '−' : '') + s
}

function cellText(v, col, currency) {
  if (col.role === 'change') return changeText(v)
  return formatValue(v, col, { currency })
}

// The heading rows. A matrix with several values gets the column values on
// one row and the values' names under them; with one value, just the column
// values. Anything else is one row.
function headings(columns) {
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

export default function ResultTable({ result, className }) {
  const { columns = [], rows = [], totals, kind, meta = {} } = result || {}
  const currency = meta.currency || null
  const head = headings(columns)
  const firstIsRow = columns[0]?.role === 'row'
  // The first column stays put as the table scrolls sideways, so a long name
  // (a dish, a reason) wraps rather than take the phone's width. A date, a
  // time or a number is short and reads badly broken in two: it stays whole.
  const firstWraps = firstIsRow && ['text', 'choice'].includes(typeOf(columns[0]))
  const align = columns.map(c => rightAligned(c, kind))

  // What a row shows in each column: a subtotal says so in the first
  // grouping it leaves empty, "everything else" is its own words.
  const textOf = (row, i) => {
    const col = columns[i]
    if (row.kind === 'subtotal' && col.role === 'row' && i === (row.level || 0)) return 'Subtotal'
    if (row.kind === 'rest' && i === 0) return row.cells[0] == null ? '' : String(row.cells[0])
    return cellText(row.cells[i], col, currency)
  }

  const count = kind === 'list' ? (totals?.count ?? meta.row_count ?? rows.length) : null
  const totalText = i => {
    if (!totals?.cells) return ''
    if (kind === 'list') {
      const v = totals.cells[i]
      if (i === 0 && v == null) return count.toLocaleString('en-GB') + (count === 1 ? ' row' : ' rows')
      return v == null ? '' : cellText(v, columns[i], currency)
    }
    if (i === 0 && firstIsRow) return 'Total'
    return columns[i].role === 'row' ? '' : cellText(totals.cells[i], columns[i], currency)
  }
  const showTotals = !!totals?.cells && rows.length > 0

  if (!columns.length) return null

  return (
    <div className={cn('overflow-auto max-h-[72vh] rounded-b-xl', className)} data-testid="report-table-scroll">
      <table className="w-full text-sm border-separate border-spacing-0" data-testid="report-table">
        {/* The headings stay put as the rows scroll under them; the first
            column stays put as the others scroll sideways. Opaque fills: a
            see-through one lets the rows show through. */}
        <thead className="sticky top-0 z-20">
          {head.rows.map((cells, r) => (
            <tr key={r}>
              {cells.map(h => (
                <th key={h.i + ':' + r} scope="col" colSpan={h.span} rowSpan={h.depth}
                  title={h.col.group && !h.banner && h.label !== h.col.group ? h.col.group + ': ' + h.label : undefined}
                  className={cn(
                    'bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground border-b whitespace-nowrap align-bottom',
                    h.banner ? 'text-center border-l' : align[h.i] ? 'text-right' : 'text-left',
                    h.i === 0 && firstIsRow && !h.banner && 'sticky left-0 z-10',
                    (h.col.role === 'compare' || h.col.role === 'change') && 'font-normal',
                  )}>
                  {h.label}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.map((row, r) => {
            const strong = row.kind === 'subtotal'
            return (
              <tr key={r} data-kind={row.kind} className={cn(strong && 'font-semibold')}>
                {columns.map((col, i) => (
                  <td key={i}
                    className={cn(
                      'px-3 py-2 border-b align-top',
                      strong ? 'bg-muted' : 'bg-background',
                      align[i] ? 'text-right tabular-nums whitespace-nowrap' : 'text-left',
                      i === 0 && firstIsRow && 'sticky left-0 z-10',
                      i === 0 && firstWraps ? 'min-w-[7rem] max-w-[45vw] sm:max-w-[16rem] break-words' : !align[i] && 'whitespace-nowrap',
                      (col.role === 'compare' || col.role === 'change') && 'text-muted-foreground',
                      row.kind === 'rest' && 'italic',
                    )}>
                    {textOf(row, i)}
                  </td>
                ))}
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-10 text-center text-sm text-muted-foreground bg-background" data-testid="report-empty">
                Nothing to show for these choices.
              </td>
            </tr>
          )}
        </tbody>
        {showTotals && (
          <tfoot className="sticky bottom-0 z-20">
            <tr data-kind="total" className="font-semibold">
              {columns.map((col, i) => (
                <td key={i}
                  className={cn(
                    'bg-muted px-3 py-2 border-t-2',
                    align[i] ? 'text-right tabular-nums whitespace-nowrap' : 'text-left whitespace-nowrap',
                    i === 0 && firstIsRow && 'sticky left-0 z-10',
                    (col.role === 'compare' || col.role === 'change') && 'font-normal text-muted-foreground',
                  )}>
                  {totalText(i)}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

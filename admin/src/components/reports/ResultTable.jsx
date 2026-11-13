// src/components/reports/ResultTable.jsx
//
// A report's result as a table (docs/REPORTS.md 9): one drawing for the
// viewer and, later, the builder's preview. Every cell goes through
// formatValue() (shared/reports/format.js), the same words the files' About
// sheet and the print page use.
//
//   result   what POST /api/reports/:id/run answers: { kind, columns, rows,
//            totals, meta }
//   onTap    (target) a row, or a figure of a table across, was tapped to be
//            opened up (components/reports/drill.jsx). Rows are only tappable
//            when this is given and the result says it has something to open.
//            The whole row is the target; a tap that lands on one of its
//            figures means that figure (the rows behind it are the ones it
//            counts), a tap anywhere else the row as a whole.
//
// A list shows its rows and, under them, the sums that add up and how many
// rows there are. A summary shows subtotals and a total. A matrix shows the
// column values across the top, the report's values under each when it has
// more than one. What each cell says, the heading rows and which columns sit
// on the right are shared/reports/table.js: the print page draws from the
// same rules.

import { useLayoutEffect, useRef } from 'react'
import { rightAligned, tableHeadings, rowText, totalText } from '@shared/reports/table.js'
import { tapTarget, totalTarget } from '@/components/reports/drill'
import { cn } from '@/lib/utils'

const typeOf = c => c.format || c.type

// The column a tap on a row landed in. Body and total rows have one cell for
// each column, so a cell's place in its row is the column's.
const colAt = e => { const td = e.target.closest?.('td'); return td ? td.cellIndex : null }

// A cell's words as the way in: for the keyboard, a screen reader, and so
// that a row that opens looks like it does without a pointer over it.
const openCls = 'underline decoration-dotted decoration-muted-foreground underline-offset-4 rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60'

export default function ResultTable({ result, className, onTap = null }) {
  const { columns = [], rows = [], totals, kind, meta = {} } = result || {}
  const head = tableHeadings(columns)
  const firstIsRow = columns[0]?.role === 'row'
  const canTap = !!onTap && !!meta.drill && kind !== 'list'
  const matrix = kind === 'matrix'
  const groupings = columns.filter(c => c.role === 'row').length
  // The cell that carries a row's button: its own name (the last grouping it
  // sits in), "Subtotal" on a subtotal, else the first cell.
  const openAt = row => (row.kind === 'subtotal' ? Math.min(row.level || 0, columns.length - 1) : Math.max(0, groupings - 1))
  // The first column stays put as the table scrolls sideways, so a long name
  // (a dish, a reason) wraps rather than take the phone's width. A date, a
  // time or a number is short and reads badly broken in two: it stays whole.
  const firstWraps = firstIsRow && ['text', 'choice'].includes(typeOf(columns[0]))
  const align = columns.map(c => rightAligned(c, kind))

  // What a row shows in each column: a subtotal says so in the first
  // grouping it leaves empty, "everything else" is its own words.
  const textOf = (row, i) => rowText(result, row, i)

  // Another table (a row opened up, the way back): it starts at its top left.
  // The same table worked out again stays where it was scrolled to.
  const scroller = useRef(null)
  const shape = columns.map(c => c.key).join('|')
  useLayoutEffect(() => {
    if (scroller.current) { scroller.current.scrollTop = 0; scroller.current.scrollLeft = 0 }
  }, [shape])

  const showTotals = !!totals?.cells && rows.length > 0

  if (!columns.length) return null

  return (
    <div ref={scroller} className={cn('overflow-auto max-h-[72vh] rounded-b-xl', className)} data-testid="report-table-scroll">
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
            const tap = canTap && row.kind !== 'rest'
            const at = tap ? openAt(row) : -1
            return (
              <tr key={r} data-kind={row.kind} data-drill={tap ? '1' : undefined}
                onClick={tap ? e => onTap(tapTarget(result, row, colAt(e))) : undefined}
                className={cn(strong && 'font-semibold', tap && 'group cursor-pointer touch:h-12')}>
                {columns.map((col, i) => {
                  const text = textOf(row, i)
                  // In a table across, a figure under one of the columns is its own way in.
                  const figure = tap && matrix && !!col.at && row.cells[i] != null
                  return (
                    <td key={i}
                      className={cn(
                        'border-b', figure ? 'p-0' : 'px-3 py-2', tap ? 'align-top touch:align-middle' : 'align-top',
                        strong ? 'bg-muted' : 'bg-background', tap && !strong && 'group-hover:bg-muted',
                        align[i] ? 'text-right tabular-nums whitespace-nowrap' : 'text-left',
                        i === 0 && firstIsRow && 'sticky left-0 z-10',
                        i === 0 && firstWraps ? 'min-w-[7rem] max-w-[45vw] sm:max-w-[16rem] break-words' : !align[i] && 'whitespace-nowrap',
                        (col.role === 'compare' || col.role === 'change') && 'text-muted-foreground',
                        row.kind === 'rest' && 'italic',
                      )}>
                      {figure ? (
                        <button type="button" data-testid="report-cell-open"
                          onClick={e => { e.stopPropagation(); onTap(tapTarget(result, row, i)) }}
                          className={cn(openCls, 'w-full inline-flex items-center px-3 py-2 touch:min-h-[48px] touch:min-w-[48px] touch-manipulation hover:bg-muted', align[i] ? 'justify-end' : 'justify-start')}>
                          {text}
                        </button>
                      ) : i === at ? (
                        <button type="button" data-testid="report-row-open" className={cn(openCls, 'touch-manipulation', align[i] ? 'text-right' : 'text-left')}>
                          {text || '(none)'}
                        </button>
                      ) : text}
                    </td>
                  )
                })}
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
            <tr data-kind="total" data-drill={canTap ? '1' : undefined}
              onClick={canTap ? e => onTap(totalTarget(result, colAt(e))) : undefined}
              className={cn('font-semibold', canTap && 'cursor-pointer touch:h-12')}>
              {columns.map((col, i) => {
                const text = totalText(result, i)
                const figure = canTap && matrix && !!col.at && totals.cells[i] != null
                return (
                  <td key={i}
                    className={cn(
                      'bg-muted border-t-2', figure ? 'p-0' : 'px-3 py-2', canTap && 'touch:align-middle',
                      align[i] ? 'text-right tabular-nums whitespace-nowrap' : 'text-left whitespace-nowrap',
                      i === 0 && firstIsRow && 'sticky left-0 z-10',
                      (col.role === 'compare' || col.role === 'change') && 'font-normal text-muted-foreground',
                    )}>
                    {figure ? (
                      <button type="button" data-testid="report-cell-open"
                        onClick={e => { e.stopPropagation(); onTap(totalTarget(result, i)) }}
                        className={cn(openCls, 'w-full inline-flex items-center px-3 py-2 touch:min-h-[48px] touch:min-w-[48px] touch-manipulation', align[i] ? 'justify-end' : 'justify-start')}>
                        {text}
                      </button>
                    ) : canTap && i === 0 ? (
                      <button type="button" data-testid="report-row-open" className={cn(openCls, 'touch-manipulation', align[i] ? 'text-right' : 'text-left')}>{text || 'Total'}</button>
                    ) : text}
                  </td>
                )
              })}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

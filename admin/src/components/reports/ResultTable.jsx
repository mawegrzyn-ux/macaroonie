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
//   onOpen   (row, href) a row of a list was tapped to open the record itself
//            on its page in the app (docs/REPORTS.md 8; components/reports/
//            open.js). Only rows the result says open (row.open) can be; the
//            first cell is the link, so a click with Ctrl or Cmd, or the
//            middle button, opens it in a new tab as any link does.
//   startAt  { top, left } where the table was scrolled to when the person
//            left it (back from a record): put back once, when it first draws
//   scrollerRef  a ref the table keeps pointing at its scrolling box
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
import { recordHref } from '@/components/reports/open'
import { cn } from '@/lib/utils'

const typeOf = c => c.format || c.type

// The column a tap on a row landed in. Body and total rows have one cell for
// each column, so a cell's place in its row is the column's.
const colAt = e => { const td = e.target.closest?.('td'); return td ? td.cellIndex : null }

// A cell's words as the way in: for the keyboard, a screen reader, and so
// that a row that opens looks like it does without a pointer over it.
const openCls = 'underline decoration-dotted decoration-muted-foreground underline-offset-4 rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60'

// A plain click: a click with a key held, or another button, is the
// browser's (a new tab or window from the link).
const plainClick = e => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey

export default function ResultTable({ result, className, onTap = null, onOpen = null, startAt = null, scrollerRef = null }) {
  const { columns = [], rows = [], totals, kind, meta = {} } = result || {}
  const head = tableHeadings(columns)
  const firstIsRow = columns[0]?.role === 'row'
  const canTap = !!onTap && !!meta.drill && kind !== 'list'
  // A list's rows that open the record itself (each says so: row.open).
  const opens = !!onOpen && kind === 'list' && !!meta.open
  const openLabel = meta.open?.label || 'Open'
  const openRow = (e, row, href) => {
    if (!plainClick(e)) return
    // Words being picked out of the row (to copy them) aren't a tap.
    if (window.getSelection?.().toString()) return
    onOpen(row, href)
  }
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
  // The same table worked out again stays where it was scrolled to. Back
  // from a record it opened, it starts where it was left (startAt), once.
  // Run once per shape: React's strict mode runs a layout effect twice on
  // mount, and a second run must not undo the first (putting the table back
  // at its top).
  const scroller = useRef(null)
  const drawn = useRef(null)   // the shape the table last started on
  const shape = columns.map(c => c.key).join('|')
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || drawn.current === shape) return
    const at = drawn.current === null && startAt ? startAt : null
    drawn.current = shape
    el.scrollTop = at?.top || 0
    el.scrollLeft = at?.left || 0
  }, [shape])
  const setScroller = el => {
    scroller.current = el
    if (scrollerRef) scrollerRef.current = el
  }

  const showTotals = !!totals?.cells && rows.length > 0

  if (!columns.length) return null

  return (
    <div ref={setScroller} className={cn('overflow-auto max-h-[72vh] rounded-b-xl', className)} data-testid="report-table-scroll">
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
            // A list's row that opens its record: the whole row, the first cell its link.
            const href = opens && row.kind === 'row' ? recordHref(result, row) : null
            const live = tap || !!href
            return (
              <tr key={r} data-kind={row.kind} data-drill={tap ? '1' : undefined} data-open={href ? '1' : undefined}
                onClick={tap ? e => onTap(tapTarget(result, row, colAt(e))) : href ? e => openRow(e, row, href) : undefined}
                className={cn(strong && 'font-semibold', live && 'group cursor-pointer touch:h-12')}>
                {columns.map((col, i) => {
                  const text = textOf(row, i)
                  // In a table across, a figure under one of the columns is its own way in.
                  const figure = tap && matrix && !!col.at && row.cells[i] != null
                  return (
                    <td key={i}
                      className={cn(
                        'border-b', figure ? 'p-0' : 'px-3 py-2', live ? 'align-top touch:align-middle' : 'align-top',
                        strong ? 'bg-muted' : 'bg-background', live && !strong && 'group-hover:bg-muted',
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
                      ) : href && i === 0 ? (
                        // A real link: the row's own click opens it here (with the
                        // way back); a click with a key held is the browser's.
                        <a href={href} data-testid="report-record-open" title={openLabel}
                          onClick={e => { if (plainClick(e)) e.preventDefault(); else e.stopPropagation() }}
                          className={cn(openCls, 'touch-manipulation', align[i] ? 'text-right' : 'text-left')}>
                          {text || openLabel}
                        </a>
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

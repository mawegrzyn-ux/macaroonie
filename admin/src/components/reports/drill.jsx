// src/components/reports/drill.jsx
//
// Drill-downs on the page (docs/REPORTS.md 8). A row of a summary, or a
// figure of a table across, stands for the rows behind it. Tapping it opens
// the same figures broken down by another field, or the rows themselves.
//
// Nothing here decides what is allowed. The server makes each drilled report
// from the saved one (shared/reports/drill.js) and says, with every result,
// what a row of it can open into (result.meta.drill):
//
//   { down: [{ field, bucket?, label }], rows: true | false, of: 'Checks',
//     per_figure: true }   (only when its figures count different rows)
//
// The page keeps where it is as steps, each one tap made on the result of
// the steps before it:
//
//   { at: [{ field, bucket?, value }], to: 'rows' | { field, bucket? },
//     value: 'net_sales', label: 'Mains', by: 'Dish', of: 'Net sales' }
//
// `at` says which row was tapped (each grouping it sits in, held to its
// value), `to` what it was opened into, and `value` which figure of the row
// the tap was on. The rows behind a figure are the ones that figure counts,
// so `value` is only kept where the report's figures count different rows
// (per_figure): everywhere else a tap means the row, wherever in it the
// finger lands. `label`, `by` and `of` are only words for the trail;
// drillBody() leaves them out of what is sent.

import { ChevronRight, Rows3, ListTree } from 'lucide-react'
import { formatValue } from '@shared/reports/format.js'
import { rowId } from '@shared/reports/spec.js'
import { Modal } from '@/components/staff/shared'
import { cn } from '@/lib/utils'

const lowerFirst = s => (s && /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)
const MAX_FIGURES = 6

/** What the run and file routes take: the steps without their words. */
export const drillBody = steps => (steps || []).map(s => ({ at: s.at, to: s.to, ...(s.to === 'rows' && s.value ? { value: s.value } : {}) }))

/**
 * What a row of this result can be opened into: [{ key, to, label, sub, by }].
 * Empty when nothing. `target` (what was tapped) only changes the words: the
 * rows behind one figure are that figure's.
 */
export function drillChoices(result, target = null) {
  const offers = result?.meta?.drill
  if (!offers) return []
  const out = (offers.down || []).map(level => ({
    key: rowId(level),
    to: { field: level.field, ...(level.bucket ? { bucket: level.bucket } : {}) },
    label: 'By ' + lowerFirst(level.label),
    sub: 'The same figures, for each ' + lowerFirst(level.label),
    by: level.label,
  }))
  if (offers.rows) {
    out.push({
      key: 'rows', to: 'rows', label: 'Show the rows',
      sub: 'The ' + (offers.of ? lowerFirst(offers.of) : 'rows') + ' behind ' + (target?.value ? target.value.label : 'these figures'),
      by: offers.of || 'Rows',
    })
  }
  return out
}

/** The line that says rows can be tapped. Null when they can't. */
export function drillHint(result) {
  const offers = result?.meta?.drill
  if (!offers) return null
  const what = result.kind === 'matrix' ? 'a row or a figure' : 'a row'
  if (offers.down?.length && offers.rows) return 'Tap ' + what + ' to break it down, or to list what is behind it.'
  if (offers.down?.length) return 'Tap ' + what + ' to break it down.'
  return 'Tap ' + what + ' to list what is behind it.'
}

const groupingsOf = result => result.columns.filter(c => c.role === 'row')
const cellWords = (v, col, currency) => (v == null || v === '' ? (col.empty || 'None') : formatValue(v, col, { currency }))

// The figures a row shows, as words, for the window: its values; in a table
// across, the ones under the column that was tapped (else its totals).
function figuresOf(result, cells, colIndex) {
  const currency = result.meta?.currency || null
  const tapped = colIndex != null ? result.columns[colIndex] : null
  const out = []
  result.columns.forEach((col, i) => {
    if (out.length >= MAX_FIGURES || cells[i] == null) return
    if (result.kind === 'matrix') {
      if (tapped?.at ? col.group !== tapped.group || col.role !== 'value' : col.role !== 'total') return
    } else if (col.role !== 'value') return
    out.push({ label: col.label, text: formatValue(cells[i], col, { currency }) })
  })
  return out
}

// The figure a column shows, when it shows one of the report's values as it
// is and the figures of this report count different rows: { key, label }. A
// comparison or a change beside a figure isn't one.
function figureOf(result, col) {
  if (!result?.meta?.drill?.per_figure) return null
  if (!col || (col.role !== 'value' && col.role !== 'total')) return null
  const key = col.of || col.key
  return typeof key === 'string' && key ? { key, label: col.label } : null
}

/**
 * What a tap on a row stands for: { at, label, figures, value }. `colIndex`
 * is the column the tap was on: a figure there is the one whose rows are
 * meant (`value`), and in a table across a figure under one of the columns
 * across the top holds that column's values too. Null for a row that stands
 * for nothing in particular ("everything else") and for a result with
 * nothing to open.
 */
export function tapTarget(result, row, colIndex = null) {
  if (!result?.meta?.drill || !row || row.kind === 'rest') return null
  const currency = result.meta.currency || null
  const groupings = groupingsOf(result)
  const at = []
  const words = []
  ;(row.k || []).forEach((value, i) => {
    const col = groupings[i]
    if (!col) return
    at.push({ field: col.field, ...(col.bucket ? { bucket: col.bucket } : {}), value: value ?? null })
    words.push(cellWords(value, col, currency))
  })
  const col = colIndex != null ? result.columns[colIndex] : null
  if (col?.at) {
    for (const a of col.at) at.push({ field: a.field, ...(a.bucket ? { bucket: a.bucket } : {}), value: a.value ?? null })
    words.push(col.group)
  }
  return { at, label: words.join(' · ') || 'Everything', figures: figuresOf(result, row.cells, col?.at ? colIndex : null), value: figureOf(result, col) }
}

/** The same for the Total row: everything, or everything under one column of a table across. */
export function totalTarget(result, colIndex = null) {
  if (!result?.meta?.drill || !result.totals?.cells) return null
  const col = colIndex != null ? result.columns[colIndex] : null
  const at = col?.at ? col.at.map(a => ({ field: a.field, ...(a.bucket ? { bucket: a.bucket } : {}), value: a.value ?? null })) : []
  return { at, label: col?.at ? col.group : 'Total', figures: figuresOf(result, result.totals.cells, col?.at ? colIndex : null), value: figureOf(result, col) }
}

/**
 * What a mark of a chart stands for, as a tapped row does: `mark` is what
 * chartMark() says of it ({ at, label, value }), `tip` what chartTip() says
 * (its figures in words). Null for a mark that stands for nothing in
 * particular and for a result with nothing to open.
 */
export function markTarget(result, mark, tip = null) {
  if (!result?.meta?.drill || !mark?.at) return null
  return {
    at: mark.at.map(a => ({ field: a.field, ...(a.bucket ? { bucket: a.bucket } : {}), value: a.value ?? null })),
    label: mark.label || 'Everything',
    figures: (tip?.lines || []).slice(0, MAX_FIGURES).map(l => ({ label: l.label, text: l.value })),
    // The rows behind one figure are that figure's, where the report's figures count different rows.
    value: result.meta.drill.per_figure && mark.value?.key ? { key: mark.value.key, label: mark.value.label } : null,
  }
}

/** The step a choice makes of a tapped row. */
export const stepOf = (target, choice) => ({
  at: target.at, to: choice.to, label: target.label, by: choice.by,
  ...(choice.to === 'rows' && target.value ? { value: target.value.key, of: target.value.label } : {}),
})

/**
 * The window a tapped row opens when there is more than one thing it can be
 * opened into: the row's own figures, then a button for each.
 */
export function DrillWindow({ result, target, onPick, onClose }) {
  const choices = drillChoices(result, target)
  return (
    <Modal title={target.label} onClose={onClose}>
      <div data-testid="drill-window">
        {target.figures?.length > 0 && (
          <dl className="rounded-lg border bg-muted/40 px-3 py-2 mb-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm" data-testid="drill-figures">
            {target.figures.map((f, i) => (
              <div key={i} className="contents">
                <dt className="text-muted-foreground min-w-0 break-words">{f.label}</dt>
                <dd className="text-right tabular-nums font-medium">{f.text}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="space-y-2">
          {choices.map(c => (
            <button key={c.key} type="button" onClick={() => onPick(c)} data-testid="drill-choice" data-to={c.key}
              className="w-full min-h-[56px] flex items-center gap-3 px-3 py-2 rounded-lg border bg-background text-left touch-manipulation hover:bg-muted">
              {c.to === 'rows' ? <Rows3 className="w-4 h-4 text-muted-foreground shrink-0" /> : <ListTree className="w-4 h-4 text-muted-foreground shrink-0" />}
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium leading-tight">{c.label}</span>
                <span className="block text-xs text-muted-foreground leading-tight mt-0.5">{c.sub}</span>
              </span>
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}

/**
 * Where the page is, with a way back to each step: All, then each row that
 * was opened and what it was opened into. The last one is where the page is
 * now.
 *
 *   onGo(n)  keep the first n steps (0 = the report as it is)
 */
export function DrillTrail({ steps, onGo, disabled = false, className }) {
  if (!steps?.length) return null
  const crumb = 'min-h-[48px] min-w-[48px] px-3 py-1.5 rounded-lg text-left touch-manipulation'
  return (
    <nav aria-label="Where you are in the report" className={cn('flex flex-wrap items-center gap-1 rounded-xl border bg-background px-1.5 py-1', className)} data-testid="drill-trail">
      <button type="button" onClick={() => onGo(0)} disabled={disabled} data-testid="drill-crumb" data-step="0"
        className={cn(crumb, 'text-sm font-medium text-primary text-center hover:bg-muted disabled:opacity-50')}>
        All
      </button>
      {steps.map((s, i) => {
        const last = i === steps.length - 1
        const words = (
          <>
            <span className="block text-sm font-medium leading-tight break-words">{s.label}</span>
            <span className="block text-[11px] text-muted-foreground leading-tight mt-0.5">
              {s.to === 'rows' ? lowerFirst(s.by) + (s.of ? ' behind ' + s.of : '') : 'by ' + lowerFirst(s.by)}
            </span>
          </>
        )
        return (
          <span key={i} className="flex items-center gap-1 min-w-0">
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
            {last ? (
              <span className={crumb} aria-current="step" data-testid="drill-crumb" data-step={i + 1} data-current="1">{words}</span>
            ) : (
              <button type="button" onClick={() => onGo(i + 1)} disabled={disabled} data-testid="drill-crumb" data-step={i + 1}
                className={cn(crumb, 'hover:bg-muted disabled:opacity-50 [&>span:first-child]:text-primary')}>
                {words}
              </button>
            )}
          </span>
        )
      })}
    </nav>
  )
}

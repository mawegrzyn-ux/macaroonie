// src/components/reports/ResultCard.jsx
//
// A report's result as the viewer and the builder's preview show it: the
// period it covers, how many rows, when it was worked out, Refresh, the
// engine's notes, then the chart (when the report has one) and the table.
//
// A report's view says whether it is drawn as a chart (result.spec.view,
// docs/REPORTS.md 12) and whether the table shows under it to begin with.
// The table is always one tap away, and always shows when the chart can't
// be drawn.
//
//   result     what the run or preview route returned
//   fetching   a request is on its way (Refresh spins, the card is busy)
//   stale      the result shown is the one before (dimmed until the new one lands)
//   onRefresh  work it out again now
//   more       how a list cut short ends its note ("Download the file for all of them.")
//   onTap      a row, a figure or a mark of the chart was asked to be opened
//              up (see drill.jsx); left out, or while `stale`, nothing opens
//   onOpen     (row, href) a list's row was tapped to open the record itself
//              on its page in the app (see open.js); the same rules
//   startAt    where the table was scrolled to, put back when it first draws
//   scrollerRef a ref kept pointing at the table's scrolling box
//   tableRef   a ref the card keeps up to date with whether the table is
//              showing under a chart (true / false; null when there is no
//              chart drawn), so Print can print what is on screen
//   hiddenRef  a ref the chart keeps up to date with the series switched off
//              in its legend (their keys), for the same reason

import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Info, MousePointerClick, Table2, ChevronDown, ChevronUp } from 'lucide-react'
import { chartModel } from '@shared/reports/chart.js'
import ResultTable from '@/components/reports/ResultTable'
import ReportChart from '@/components/reports/ReportChart'
import { drillHint } from '@/components/reports/drill'
import { openHint } from '@/components/reports/open'
import { cn } from '@/lib/utils'

const hhmm = iso => {
  const d = iso ? new Date(iso) : null
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''
}

export default function ResultCard({ result, fetching = false, stale = false, onRefresh, more = '', onTap = null, onOpen = null, startAt = null, scrollerRef = null, tableRef = null, hiddenRef = null, className }) {
  // What the chart draws, when the report has one (null: a table only).
  const view = result?.spec?.view
  const charted = !!view && view.kind !== 'table' && result.kind !== 'list'
  const model = useMemo(() => (charted ? chartModel(result) : null), [result, charted])
  // The table under a chart: as the report says, until the person says otherwise
  // (their choice belongs to that view: another kind of chart starts again).
  const viewKey = charted ? view.kind + ':' + (view.table_below !== false) : ''
  const [tableFor, setTableFor] = useState(null)
  const drawn = !!model?.ok
  const tableOpen = !drawn || (tableFor?.key === viewKey ? tableFor.open : view.table_below !== false)
  useEffect(() => { if (tableRef) tableRef.current = drawn ? tableOpen : null })
  if (!result) return null
  const meta = result.meta || {}
  // A result on its way out stands for other steps than the page is at: its rows wait.
  const tap = onTap && !stale ? onTap : null
  const open = onOpen && !stale ? onOpen : null
  const hint = onTap ? drillHint(result) : null
  const openWords = onOpen ? openHint(result) : null
  const shownRows = result.rows?.length ?? 0
  const allRows = meta.row_count ?? shownRows
  const asOf = hhmm(meta.cached_at || meta.generated_at)
  const cut = result.kind === 'list' && meta.truncated
  return (
    <div className={cn('rounded-xl border bg-background', stale && 'opacity-60', className)} data-testid="report-result" aria-busy={fetching}>
      <div className="px-4 py-2 section-head rounded-t-xl flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="flex-1 min-w-[10rem]">
          <p className="text-sm font-semibold leading-tight" data-testid="report-period">{meta.period?.text || 'Every date'}</p>
          <p className="text-[11px] text-muted-foreground leading-tight mt-0.5" data-testid="report-count">
            {allRows.toLocaleString('en-GB')} {allRows === 1 ? 'row' : 'rows'}
            {meta.compare?.text ? ' · compared with ' + meta.compare.text : ''}
            {asOf ? ' · as of ' + asOf : ''}
          </p>
        </div>
        {onRefresh && (
          <button type="button" onClick={onRefresh} disabled={fetching} data-testid="report-refresh"
            className="inline-flex items-center gap-2 h-12 px-3 rounded-lg border bg-background text-sm touch-manipulation hover:bg-muted disabled:opacity-50">
            <RefreshCw className={cn('w-4 h-4', fetching && 'animate-spin')} />
            Refresh
          </button>
        )}
      </div>

      {(meta.notes?.length > 0 || cut) && (
        <ul className="px-4 py-2 border-b space-y-1" data-testid="report-notes">
          {(meta.notes || []).map((n, i) => (
            <li key={i} className="flex gap-2 text-xs text-muted-foreground"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />{n}</li>
          ))}
          {cut && (
            <li className="flex gap-2 text-xs text-muted-foreground">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              The first {shownRows.toLocaleString('en-GB')} of {allRows.toLocaleString('en-GB')} rows are shown.{more ? ' ' + more : ''}
            </li>
          )}
        </ul>
      )}

      {model && <ReportChart result={result} model={model} onOpen={tap} hiddenRef={hiddenRef} />}

      {drawn && (
        <button type="button" onClick={() => setTableFor({ key: viewKey, open: !tableOpen })} aria-expanded={tableOpen} data-testid="report-table-toggle"
          className={cn('w-full min-h-[48px] px-4 flex items-center gap-2 text-sm text-left touch-manipulation hover:bg-muted', tableOpen ? 'border-b' : 'rounded-b-xl')}>
          <Table2 className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="flex-1">{tableOpen ? 'Hide the table' : 'Show the table'}</span>
          {tableOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
        </button>
      )}

      {tableOpen && hint && (
        <p className="px-4 py-2 border-b flex gap-2 text-xs text-muted-foreground" data-testid="report-drill-hint">
          <MousePointerClick className="w-3.5 h-3.5 mt-0.5 shrink-0" />{hint}
        </p>
      )}

      {tableOpen && openWords && (
        <p className="px-4 py-2 border-b flex gap-2 text-xs text-muted-foreground" data-testid="report-open-hint">
          <MousePointerClick className="w-3.5 h-3.5 mt-0.5 shrink-0" />{openWords}
        </p>
      )}

      {tableOpen && <ResultTable result={result} onTap={tap} onOpen={open} startAt={startAt} scrollerRef={scrollerRef} />}
    </div>
  )
}

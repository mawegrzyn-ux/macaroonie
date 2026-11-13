// src/components/reports/ResultCard.jsx
//
// A report's result as the viewer and the builder's preview show it: the
// period it covers, how many rows, when it was worked out, Refresh, the
// engine's notes, then the table.
//
//   result     what the run or preview route returned
//   fetching   a request is on its way (Refresh spins, the card is busy)
//   stale      the result shown is the one before (dimmed until the new one lands)
//   onRefresh  work it out again now
//   more       how a list cut short ends its note ("Download the file for all of them.")

import { RefreshCw, Info } from 'lucide-react'
import ResultTable from '@/components/reports/ResultTable'
import { cn } from '@/lib/utils'

const hhmm = iso => {
  const d = iso ? new Date(iso) : null
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''
}

export default function ResultCard({ result, fetching = false, stale = false, onRefresh, more = '', className }) {
  if (!result) return null
  const meta = result.meta || {}
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

      <ResultTable result={result} />
    </div>
  )
}

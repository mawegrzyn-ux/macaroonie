// src/components/reports/ReportWidget.jsx
//
// A report shown outside the Reports pages (docs/REPORTS.md 15): the
// dashboard widget `report` (any dashboard kind; the report picked in Edit
// layout, saved as the widget's settings.report) and the phone's report page
// (/mobile/reports/:ref). Both run the report through the same route as the
// viewer, as the person looking, with its own choices or those picked here.
//
//   useRunnableReports()   saved reports and starters the person can run
//   ReportPicker           a select of them
//   ReportPeek             runs one and shows its chart and table
//   ReportWidget           the dashboard widget

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { shownResult } from '@shared/reports/page.js'
import { useApi } from '@/lib/api'
import ResultCard from '@/components/reports/ResultCard'
import { Problems, retryUnlessRefused, reportPath } from '@/components/reports/shared'
import { cn } from '@/lib/utils'

export function useRunnableReports() {
  const api = useApi()
  const q = useQuery({ queryKey: ['reports'], queryFn: () => api.get('/reports'), retry: retryUnlessRefused, staleTime: 30_000 })
  const list = useMemo(() => {
    const d = q.data
    if (!d) return []
    const own = (d.reports || []).filter(r => r.runs && r.report_kind !== 'page')
    const starters = (d.starters || []).filter(r => r.runs)
    return [...own, ...starters]
  }, [q.data])
  return { ...q, list }
}

export function ReportPicker({ value, onChange, testid = 'report-pick' }) {
  const { list, isLoading } = useRunnableReports()
  const own = list.filter(r => r.kind !== 'starter')
  const starters = list.filter(r => r.kind === 'starter')
  return (
    <select value={value || ''} onChange={e => onChange(e.target.value || null)} disabled={isLoading} data-testid={testid}
      aria-label="Which report"
      className="h-12 w-full rounded-lg border bg-background px-3 text-sm touch-manipulation">
      <option value="">{isLoading ? 'Loading reports…' : 'Pick a report…'}</option>
      {own.length > 0 && (
        <optgroup label="Saved reports">{own.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</optgroup>
      )}
      {starters.length > 0 && (
        <optgroup label="Starter reports">{starters.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</optgroup>
      )}
    </select>
  )
}

/** Runs a report (a saved id or `starter:<key>`) and shows it. */
export function ReportPeek({ reportRef, params = {}, show = 'both', queryKey, className, linkTo }) {
  const api = useApi()
  const q = useQuery({
    queryKey: queryKey || ['report-peek', reportRef, params],
    queryFn: () => api.post('/reports/' + encodeURIComponent(reportRef) + '/run', { params }),
    enabled: !!reportRef,
    placeholderData: keepPreviousData,
    retry: retryUnlessRefused,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  })
  return (
    <div className={cn('space-y-2', className)} data-testid="report-peek">
      <Problems error={q.error} title="This report can't be shown" />
      {q.isLoading && <p className="text-sm text-muted-foreground">Working it out…</p>}
      {q.data && !q.error && (
        <ResultCard result={shownResult(q.data, show)} fetching={q.isFetching} stale={q.isPlaceholderData}
          onRefresh={() => q.refetch()} more="Open the report for all of them." />
      )}
      {linkTo !== false && reportRef && (
        <Link to={linkTo || reportPath(reportRef)} data-testid="report-peek-open"
          className="inline-flex items-center gap-1.5 h-12 px-3 rounded-lg text-sm text-muted-foreground hover:bg-muted touch-manipulation">
          <ExternalLink className="w-4 h-4" /> Open the report
        </Link>
      )}
    </div>
  )
}

const showOf = s => (s?.chart_only ? 'chart' : s?.table_only ? 'table' : 'both')

export function ReportWidget({ widget, editing, onSetting, phone = false }) {
  const ref = typeof widget.settings?.report === 'string' ? widget.settings.report : null
  const linkTo = ref && phone ? '/mobile/reports/' + encodeURIComponent(ref) : undefined
  if (!ref) {
    return editing && onSetting ? (
      <div className="space-y-2" data-testid="report-widget-pick">
        <p className="text-sm text-muted-foreground">Which report should this show?</p>
        <ReportPicker value={null} onChange={v => v && onSetting('report', v)} />
      </div>
    ) : (
      <p className="text-sm text-muted-foreground" data-testid="report-widget-none">No report picked yet. Pick one in Edit layout.</p>
    )
  }
  return (
    <div className="space-y-2" data-testid="report-widget" data-report={ref}>
      {editing && onSetting && <ReportPicker value={ref} onChange={v => v && onSetting('report', v)} testid="report-widget-change" />}
      <ReportPeek reportRef={ref} show={showOf(widget.settings)} queryKey={['report-widget', widget.id, ref]} linkTo={linkTo} />
    </div>
  )
}

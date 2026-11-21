// src/pages/mobile/MobileReports.jsx
//
// Reports on a phone (/mobile/reports, docs/REPORTS.md 15): the reports the
// person can run (starred first), and one report (/mobile/reports/:ref) with
// its period, chart and table. Read only: building, sharing and schedules
// stay on the office pages. Runs through the same routes as the viewer.

import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Star, Search, ChevronLeft } from 'lucide-react'
import { normaliseReport } from '@shared/reports/spec.js'
import { useApi } from '@/lib/api'
import PeriodPicker from '@/components/reports/PeriodPicker'
import { Problems, retryUnlessRefused } from '@/components/reports/shared'
import { ReportPeek, useRunnableReports } from '@/components/reports/ReportWidget'

const rowCls = 'flex items-center gap-3 min-h-[56px] px-3 py-2 rounded-lg border bg-background touch-manipulation hover:bg-muted'

function Row({ r }) {
  return (
    <li>
      <Link to={'/mobile/reports/' + encodeURIComponent(r.id)} className={rowCls} data-testid="m-report-row" data-id={r.id}>
        {r.starred && <Star className="w-4 h-4 text-amber-500 shrink-0" fill="currentColor" />}
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium break-words">{r.name}</span>
          {r.description && <span className="block text-[11px] text-muted-foreground line-clamp-2">{r.description}</span>}
        </span>
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
      </Link>
    </li>
  )
}

function Group({ title, list, testid }) {
  if (!list.length) return null
  return (
    <section className="space-y-2" data-testid={testid}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      <ul className="space-y-2">{list.map(r => <Row key={r.id} r={r} />)}</ul>
    </section>
  )
}

export function MobileReportList() {
  const { list, isLoading, error } = useRunnableReports()
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return list.filter(r => words.every(w => (r.name + ' ' + (r.description || '')).toLowerCase().includes(w)))
  }, [list, q])
  const starred = shown.filter(r => r.starred)
  const own = shown.filter(r => !r.starred && r.kind !== 'starter')
  const starters = shown.filter(r => !r.starred && r.kind === 'starter')
  return (
    <div className="p-4 space-y-4" data-testid="m-reports">
      <label className="relative block">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Find a report" data-testid="m-reports-search"
          className="h-12 w-full rounded-lg border bg-background pl-9 pr-3 text-sm" />
      </label>
      <Problems error={error} title="Reports can't be shown" />
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && !error && !shown.length && <p className="text-sm text-muted-foreground" data-testid="m-reports-none">No reports match.</p>}
      <Group title="Starred" list={starred} testid="m-reports-starred" />
      <Group title="Your reports and your team's" list={own} testid="m-reports-own" />
      <Group title="Starter reports" list={starters} testid="m-reports-starters" />
      <p className="text-[11px] text-muted-foreground">Build, share and schedule reports on the office pages.</p>
    </div>
  )
}

export function MobileReport() {
  const { ref } = useParams()
  const api = useApi()
  const reportQ = useQuery({ queryKey: ['report', ref], queryFn: () => api.get('/reports/' + encodeURIComponent(ref)), retry: retryUnlessRefused })
  const report = reportQ.data?.report
  const spec = useMemo(() => (report?.spec && report.report_kind !== 'page' ? normaliseReport(report.spec) : null), [report])
  const periodParam = spec?.params.find(p => p.type === 'period') || null
  const [period, setPeriod] = useState(null)
  const params = periodParam && period ? { [periodParam.key]: period } : {}
  return (
    <div className="p-4 space-y-3" data-testid="m-report">
      <Link to="/mobile/reports" className="inline-flex items-center gap-1 h-12 -ml-2 px-2 rounded-lg text-sm text-muted-foreground hover:bg-muted touch-manipulation" data-testid="m-report-back">
        <ChevronLeft className="w-4 h-4" /> Reports
      </Link>
      <h1 className="text-base font-semibold break-words" data-testid="m-report-name">{report?.name || (reportQ.isLoading ? 'Loading…' : 'Report')}</h1>
      <Problems error={reportQ.error} title="This report can't be opened" />
      {report && !report.runs && <p className="text-sm text-amber-900" data-testid="m-report-needs">{report.needs ? 'This report needs ' + report.needs + ', which your role doesn\'t have.' : 'Your role can\'t run this report.'}</p>}
      {report?.report_kind === 'page' && <p className="text-sm text-muted-foreground">A page of reports opens on the office pages.</p>}
      {spec && report.runs && (
        <>
          {periodParam && (
            <PeriodPicker value={period ?? periodParam.default} onChange={setPeriod} label={periodParam.label || 'Period'} />
          )}
          <ReportPeek reportRef={ref} params={params} linkTo={false} />
        </>
      )}
    </div>
  )
}

// src/pages/ReportView.jsx
//
// One report (/reports/:id): its period and venues, its result as a table,
// and its file (CSV or Excel). `:id` is a saved report's id or a starter's
// ("starter:till_sales_by_day").
//
// Changing the period or the venues here changes this visit only: the report
// keeps its own usual choices, and nothing is saved.

import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { ChevronLeft, Download, RefreshCw, Lock, Info } from 'lucide-react'
import { useApi } from '@/lib/api'
import { usePermission } from '@/hooks/usePermission'
import { useVenues, ConfirmDelete } from '@/components/staff/shared'
import ResultTable from '@/components/reports/ResultTable'
import PeriodPicker from '@/components/reports/PeriodPicker'
import VenuesPicker from '@/components/reports/VenuesPicker'
import { StarButton, retryUnlessRefused } from '@/components/reports/shared'
import { cn } from '@/lib/utils'

// The API's reasons for a refusal: a list (a definition's problems) or one line.
function reasons(error) {
  if (!error) return []
  const list = error.body?.problems
  if (Array.isArray(list) && list.length) return list.map(String)
  return [error.message || 'That didn\'t work. Try again.']
}

function Problems({ error, title }) {
  const lines = reasons(error)
  if (!lines.length) return null
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert" data-testid="report-problems">
      {title && <p className="font-medium">{title}</p>}
      <ul className={cn(lines.length > 1 && 'list-disc pl-5', title && 'mt-1')}>
        {lines.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
    </div>
  )
}

const hhmm = iso => {
  const d = iso ? new Date(iso) : null
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''
}

export default function ReportView() {
  const { id } = useParams()
  const ref = encodeURIComponent(id)
  const api = useApi()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { canUse } = usePermission('reports')
  const { data: venues = [] } = useVenues()

  const reportQ = useQuery({ queryKey: ['report', id], queryFn: () => api.get('/reports/' + ref), retry: retryUnlessRefused })
  const report = reportQ.data?.report

  // Only what the person changed here; anything else is the report's own.
  const [given, setGiven] = useState({})
  const fresh = useRef(false)
  const runQ = useQuery({
    queryKey: ['report-run', id, given],
    queryFn: () => api.post('/reports/' + ref + '/run', { params: given, ...(fresh.current ? { fresh: true } : {}) }),
    enabled: !!report?.runs,
    placeholderData: keepPreviousData,
    retry: false,
    gcTime: 60_000,
  })
  const result = runQ.data
  const meta = result?.meta
  const refresh = () => {
    fresh.current = true
    runQ.refetch().finally(() => { fresh.current = false })
  }

  const [file, setFile] = useState({ busy: null, error: null })
  const download = async format => {
    setFile({ busy: format, error: null })
    try {
      await api.postDownload('/reports/' + ref + '/export', { format, params: given }, 'report.' + format)
      setFile({ busy: null, error: null })
    } catch (error) {
      setFile({ busy: null, error })
    }
  }

  const [removing, setRemoving] = useState(null)
  const remove = async () => {
    try {
      await api.delete('/reports/' + ref)
      qc.invalidateQueries({ queryKey: ['reports'] })
      navigate('/reports')
    } catch (error) {
      setRemoving(error)
    }
  }

  const params = report?.spec?.params || []
  const changed = Object.keys(given).length > 0
  const set = (key, value) => setGiven(g => ({ ...g, [key]: value }))
  const shownRows = result?.rows?.length ?? 0
  const allRows = meta?.row_count ?? shownRows
  const asOf = hhmm(meta?.cached_at || meta?.generated_at)

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="report-view">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 max-lg:notouch:pl-14 border-b shrink-0 min-h-[56px] bg-background">
        <Link to="/reports" aria-label="Back to Reports" title="Back to Reports"
          className="w-12 h-12 -ml-2 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted touch-manipulation shrink-0">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="font-semibold text-sm flex-1 min-w-[8rem] leading-tight line-clamp-2 break-words" title={report?.name} data-testid="report-name">
          {report?.name || (reportQ.isLoading ? 'Loading…' : 'Report')}
        </h1>
        {report && <StarButton report={report} />}
        {report?.runs && canUse && (
          <>
            {['csv', 'xlsx'].map(format => (
              <button key={format} type="button" onClick={() => download(format)} disabled={!!file.busy} data-testid={'report-download-' + format}
                className="inline-flex items-center gap-2 h-12 px-3 rounded-lg border bg-background text-sm font-medium touch-manipulation hover:bg-muted disabled:opacity-50 shrink-0">
                <Download className="w-4 h-4" />
                {file.busy === format ? 'Making the file…' : format === 'csv' ? 'CSV' : 'Excel'}
              </button>
            ))}
          </>
        )}
        {report?.kind === 'saved' && report.can_delete && <ConfirmDelete onConfirm={remove} label="Delete this report" big />}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4 sm:p-6 space-y-4">
          <Problems error={reportQ.error} />
          <Problems error={file.error} title="The file wasn't made" />
          <Problems error={removing} title="The report wasn't deleted" />

          {report && (
            <>
              <div className="max-w-4xl">
                {report.description && <p className="text-sm text-muted-foreground" data-testid="report-about">{report.description}</p>}
                <p className="text-[11px] text-muted-foreground mt-1">
                  {report.kind === 'starter' ? 'Starter report. It comes with Macaroonie and stays as it is.'
                    : report.mine ? 'Your report.' : 'By ' + (report.owner_email || 'someone in your team') + '.'}
                </p>
              </div>

              {!report.runs && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex gap-2" data-testid="report-needs">
                  <Lock className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    {report.needs ? 'This report needs ' + report.needs + ', which your role doesn\'t have.' : 'Your role can\'t run this report.'}
                    {' '}An owner or admin can give access on the Access page.
                  </span>
                </div>
              )}

              {report.runs && (
                <>
                  {params.some(p => p.type === 'period' || (p.type === 'venues' && venues.length > 1)) && (
                    <div className="flex flex-wrap items-center gap-2" data-testid="report-choices">
                      {params.map(p => {
                        const value = given[p.key] ?? p.default
                        if (p.type === 'period') {
                          return <PeriodPicker key={p.key} label={p.label || 'Period'} value={value} today={meta?.today} onChange={v => set(p.key, v)} />
                        }
                        if (p.type === 'venues' && venues.length > 1) {
                          return <VenuesPicker key={p.key} label={p.label || 'Venues'} venues={venues} value={value} onChange={v => set(p.key, v)} />
                        }
                        return null
                      })}
                      {changed && (
                        <button type="button" onClick={() => setGiven({})} data-testid="report-choices-reset"
                          className="h-12 px-3 rounded-lg text-sm text-muted-foreground touch-manipulation hover:bg-muted">
                          Back to the report's usual choices
                        </button>
                      )}
                    </div>
                  )}

                  <Problems error={runQ.error} title="This report can't be shown" />

                  {runQ.isLoading && !result && <p className="text-sm text-muted-foreground" data-testid="report-loading">Working it out…</p>}

                  {result && !runQ.error && (
                    <div className={cn('rounded-xl border bg-background', runQ.isPlaceholderData && 'opacity-60')} data-testid="report-result" aria-busy={runQ.isFetching}>
                      <div className="px-4 py-2 section-head rounded-t-xl flex flex-wrap items-center gap-x-4 gap-y-1">
                        <div className="flex-1 min-w-[10rem]">
                          <p className="text-sm font-semibold leading-tight" data-testid="report-period">{meta?.period?.text || 'Every date'}</p>
                          <p className="text-[11px] text-muted-foreground leading-tight mt-0.5" data-testid="report-count">
                            {allRows.toLocaleString('en-GB')} {allRows === 1 ? 'row' : 'rows'}
                            {meta?.compare?.text ? ' · compared with ' + meta.compare.text : ''}
                            {asOf ? ' · as of ' + asOf : ''}
                          </p>
                        </div>
                        <button type="button" onClick={refresh} disabled={runQ.isFetching} data-testid="report-refresh"
                          className="inline-flex items-center gap-2 h-12 px-3 rounded-lg border bg-background text-sm touch-manipulation hover:bg-muted disabled:opacity-50">
                          <RefreshCw className={cn('w-4 h-4', runQ.isFetching && 'animate-spin')} />
                          Refresh
                        </button>
                      </div>

                      {(meta?.notes?.length > 0 || (result.kind === 'list' && meta?.truncated)) && (
                        <ul className="px-4 py-2 border-b space-y-1" data-testid="report-notes">
                          {(meta.notes || []).map((n, i) => (
                            <li key={i} className="flex gap-2 text-xs text-muted-foreground"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />{n}</li>
                          ))}
                          {result.kind === 'list' && meta.truncated && (
                            <li className="flex gap-2 text-xs text-muted-foreground">
                              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                              The first {shownRows.toLocaleString('en-GB')} of {allRows.toLocaleString('en-GB')} rows are shown.
                              {canUse ? ' Download the file for all of them.' : ' Pick a shorter period to see fewer.'}
                            </li>
                          )}
                        </ul>
                      )}

                      <ResultTable result={result} />
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

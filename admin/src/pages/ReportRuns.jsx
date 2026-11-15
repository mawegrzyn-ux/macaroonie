// src/pages/ReportRuns.jsx
//
// Past runs (/reports/runs): the reports the person ran on screen,
// downloaded, printed, kept a file of or emailed, and what their schedules
// sent, newest first, with the files they kept (api src/reports/runs.js,
// GET /reports/runs). Someone with Manage on Reports can switch to everyone's
// runs. An email's record holds how many it went to and how it went, with
// the addresses masked: never who got it in full.
//
// A kept file (Keep a file on a report's page, or Pepper's export_report)
// is downloaded here, and only by the person who made it: someone else's
// file is listed without a way to download it. The maker can take a file off
// before its time. Files are kept 30 days, 7 if they hold people's details.
//
// The page reads its choices from the address, so a link can open it on one
// report's runs (?report=<id>), on one schedule's (?schedule=<id>, from the
// Schedules page), on one kept file (?file=<id>, the link Pepper gives), on
// kept files only (?files=1) or on everyone's (?scope=all).

import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { History, ChevronLeft, Download, FileSpreadsheet, Sparkles, AlertTriangle, X, Mail, CalendarClock, CalendarDays } from 'lucide-react'
import { useApi } from '@/lib/api'
import { usePermission } from '@/hooks/usePermission'
import { PageHeader, ConfirmDelete } from '@/components/staff/shared'
import { Problems, reportPath, retryUnlessRefused } from '@/components/reports/shared'
import { cn } from '@/lib/utils'

const PAGE = 50
const btn = 'inline-flex items-center gap-2 h-12 px-3 rounded-lg border bg-background text-sm font-medium touch-manipulation hover:bg-muted disabled:opacity-50 shrink-0'
const chip = on => cn('h-12 px-4 rounded-lg border text-sm font-medium touch-manipulation',
  on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')

const FORMATS = { csv: 'CSV', xlsx: 'Excel', print: 'Print' }
const whatText = r => {
  if (r.what === 'ran') return 'Ran on screen'
  if (r.what === 'printed') return 'Printed'
  if (r.what === 'scheduled') return 'Sent by a schedule'
  if (r.what === 'skipped') return 'Skipped by a schedule'
  if (r.what === 'emailed') return 'Emailed'
  const f = FORMATS[r.format] || 'a file'
  return r.what === 'kept' ? 'Kept a file (' + f + ')' : 'Downloaded (' + f + ')'
}
const SENDS = new Set(['scheduled', 'skipped', 'emailed'])

const when = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const atText = v => { try { return when.format(new Date(v)) } catch { return '' } }
const dayText = v => { try { return day.format(new Date(v)) } catch { return '' } }

function sizeText(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return n + ' bytes'
  if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB'
  return (Math.round(n / (1024 * 1024) * 10) / 10) + ' MB'
}
const rowsText = n => (n == null ? null : n === 1 ? '1 row' : Number(n).toLocaleString('en-GB') + ' rows')
const plural = (n, one, many) => (n === 1 ? '1 ' + one : Number(n).toLocaleString('en-GB') + ' ' + many)
const ATTACH = { csv: 'a CSV file', xlsx: 'an Excel file' }
const secondsText = ms => (ms == null ? null : ms < 1000 ? 'under a second' : (Math.round(ms / 100) / 10) + ' s')

// A kept file: its name and what it holds, and Download / Remove for its maker.
function FileBlock({ file, onDownload, onRemove, busy }) {
  const gone = file.removed
  return (
    <div className={cn('mt-3 rounded-lg border px-3 py-2', gone ? 'bg-muted/40' : 'bg-muted/20')} data-testid="run-file" data-id={file.id} data-removed={gone ? '1' : '0'}>
      <div className="flex flex-wrap items-center gap-2">
        <FileSpreadsheet className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className={cn('text-sm font-medium break-all flex-1 min-w-[10rem]', gone && 'text-muted-foreground')} data-testid="run-file-name">{file.name}</span>
        {file.mine && !gone && (
          <>
            <button type="button" onClick={onDownload} disabled={busy === 'download'} data-testid="run-file-download" className={btn}>
              <Download className="w-4 h-4" /> {busy === 'download' ? 'Downloading…' : 'Download'}
            </button>
            <ConfirmDelete big label="Remove this file" confirmLabel="Yes, remove it" disabled={busy === 'remove'} onConfirm={onRemove} />
          </>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground" data-testid="run-file-about">
        {[
          sizeText(file.bytes),
          rowsText(file.rows),
          gone ? (file.removed_at ? 'No longer kept since ' + dayText(file.removed_at) : 'No longer kept') : 'Kept until ' + dayText(file.expires_at),
          file.downloads ? 'downloaded ' + (file.downloads === 1 ? 'once' : file.downloads + ' times') : null,
        ].filter(Boolean).join(' · ')}
      </p>
      {file.personal && !gone && (
        <p className="mt-1 text-xs text-muted-foreground" data-testid="run-file-personal">It holds people's details, so it is kept 7 days.</p>
      )}
      {file.truncated && (
        <p className="mt-1 text-xs text-amber-800" data-testid="run-file-cut">The report had more rows than one file holds: the file has the first of them.</p>
      )}
      {!file.mine && !gone && (
        <p className="mt-1 text-xs text-muted-foreground" data-testid="run-file-theirs">Only {file.by || 'the person who made it'} can download it.</p>
      )}
    </div>
  )
}

// What an email carried and how it went: how many it went to, the addresses
// masked as the record keeps them (never who got it in full), who it failed
// for, and the notes the send made.
function SentBlock({ r }) {
  const d = r.sent
  const notMet = r.what === 'skipped' || d.not_met
  const status = notMet ? 'not_met'
    : d.not_run ? 'not_run'
      : !d.sent ? 'failed'
        : (d.failed || d.held) ? 'partly' : 'sent'
  const head = status === 'not_met' ? 'Nothing was sent: its condition wasn\'t met.' + (d.why ? ' ' + d.why + '.' : '')
    : status === 'not_run' ? 'Nothing was sent: the report couldn\'t be run.'
      : status === 'failed' ? 'Nothing was sent.'
        : status === 'partly' ? 'Sent to ' + d.sent + ' of ' + d.to + '.'
          : 'Sent to ' + plural(d.sent, 'person', 'people') + '.'
  const carried = notMet || d.not_run ? null : [
    d.in_message ? 'the report in the email' : null,
    ATTACH[d.attach] || null,
  ].filter(Boolean)
  const more = d.to - d.to_hint.length
  return (
    <div className={cn('mt-3 rounded-lg border px-3 py-2 space-y-1', status === 'failed' || status === 'not_run' ? 'border-red-200 bg-red-50/60' : 'bg-muted/20')}
      data-testid="run-sent" data-status={status}>
      <p className="text-sm flex gap-2">
        <Mail className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
        <span data-testid="run-sent-head">{head}</span>
      </p>
      {d.forced && (
        <p className="text-xs text-muted-foreground" data-testid="run-sent-forced">Sent with Send now, whatever its condition says.</p>
      )}
      {carried?.length > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="run-sent-carried">
          It carried {carried.join(' and ')}{d.kept ? ', and the file was kept for you below' : ''}.
        </p>
      )}
      {!notMet && d.to_hint.length > 0 && (
        <p className="text-xs text-muted-foreground break-words" data-testid="run-sent-to">
          To {d.to_hint.join(', ')}{more > 0 ? ' and ' + more + ' more' : ''}
          {d.outside > 0 ? ' (' + plural(d.outside, 'address', 'addresses') + ' outside the team)' : ''}
        </p>
      )}
      {d.failed > 0 && (
        <p className="text-xs text-red-700 break-words" data-testid="run-sent-failed">
          It didn't reach {d.failed_to.length ? d.failed_to.join(', ') : plural(d.failed, 'address', 'addresses')}
          {d.failed > d.failed_to.length && d.failed_to.length ? ' and ' + (d.failed - d.failed_to.length) + ' more' : ''}.
        </p>
      )}
      {d.notes.length > 0 && (
        <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-0.5" data-testid="run-sent-notes">
          {d.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
    </div>
  )
}

function RunRow({ r, everyone, bySchedule }) {
  const api = useApi()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(null)
  const [failed, setFailed] = useState(null)   // { error, title }
  const act = async (what, fn) => {
    setBusy(what)
    setFailed(null)
    try {
      await fn()
      qc.invalidateQueries({ queryKey: ['report-runs'] })
    } catch (error) {
      setFailed({ error, title: what === 'remove' ? 'The file wasn\'t removed' : 'The file can\'t be downloaded' })
    }
    setBusy(null)
  }
  const download = () => act('download', () => api.download('/reports/files/' + encodeURIComponent(r.file.id), r.file.name))
  const remove = () => act('remove', () => api.delete('/reports/files/' + encodeURIComponent(r.file.id)))
  const facts = [rowsText(r.rows), r.ms != null ? 'took ' + secondsText(r.ms) : null].filter(Boolean)
  return (
    <li className="rounded-xl border bg-background p-4" data-testid="run-row" data-id={r.id} data-what={r.what}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-semibold" data-testid="run-what">{whatText(r)}</span>
        <span className="text-xs text-muted-foreground" data-testid="run-at">{atText(r.at)}</span>
        {r.via === 'pepper' && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary bg-primary/10 rounded-md px-2 py-0.5" data-testid="run-pepper">
            <Sparkles className="w-3 h-3" /> By Pepper
          </span>
        )}
        {everyone && (
          <span className="text-xs text-muted-foreground" data-testid="run-who">{r.person?.mine ? 'You' : (r.person?.email || 'Someone')}</span>
        )}
      </div>
      <div className="mt-1 text-sm break-words" data-testid="run-report">
        {r.report?.open && r.report.ref
          ? <Link to={reportPath(r.report.ref)} className="font-medium underline underline-offset-2 hover:text-primary">{r.report.name || 'Not named'}</Link>
          : <span className="font-medium">{r.report?.name || 'Not named'}</span>}
        {r.report?.subject_label && <span className="text-xs text-muted-foreground"> · {r.report.subject_label}</span>}
      </div>
      {r.schedule && (
        <p className="mt-1 text-xs text-muted-foreground flex items-center gap-1.5" data-testid="run-schedule">
          <CalendarClock className="w-3.5 h-3.5 shrink-0" />
          <span>
            By the schedule{' '}
            {bySchedule
              ? <span className="font-medium">{r.schedule.name ? '“' + r.schedule.name + '”' : 'of this report'}</span>
              : <Link to={'/reports/runs?schedule=' + encodeURIComponent(r.schedule.id)} data-testid="run-schedule-link"
                  className="font-medium underline underline-offset-2 hover:text-primary">{r.schedule.name ? '“' + r.schedule.name + '”' : 'of this report'}</Link>}
          </span>
        </p>
      )}
      {r.choices?.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground" data-testid="run-choices">
          {r.choices.map(c => c.label + ': ' + c.text).join(' · ')}
        </p>
      )}
      {(facts.length > 0 || r.opened_up) && (
        <p className="mt-1 text-xs text-muted-foreground" data-testid="run-facts">
          {[...facts, r.opened_up ? 'with rows opened up' : null].filter(Boolean).join(' · ')}
        </p>
      )}
      {r.sent && SENDS.has(r.what) && <SentBlock r={r} />}
      {r.error && (
        <p className="mt-2 text-xs text-red-700 flex gap-1.5" data-testid="run-error">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{SENDS.has(r.what) ? 'Why: ' : 'It failed: '}{r.error}</span>
        </p>
      )}
      {r.file && <FileBlock file={r.file} busy={busy} onDownload={download} onRemove={remove} />}
      <Problems error={failed?.error} title={failed?.title} className="mt-2" />
    </li>
  )
}

export default function ReportRuns() {
  const api = useApi()
  const { canManage } = usePermission('reports')
  const [search, setSearch] = useSearchParams()
  const report = search.get('report') || ''
  const schedule = search.get('schedule') || ''
  const file = search.get('file') || ''
  const filesOnly = search.get('files') === '1'
  // Everyone's runs need Manage: a link to them opens on the person's own otherwise.
  const everyone = search.get('scope') === 'all' && canManage
  const change = patch => {
    const next = new URLSearchParams(search)
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '' || v === false) next.delete(k)
      else next.set(k, v === true ? '1' : String(v))
    }
    setSearch(next, { replace: true })
  }

  const query = useMemo(() => {
    const q = new URLSearchParams({ limit: String(PAGE) })
    if (everyone) q.set('scope', 'all')
    if (report) q.set('report', report)
    if (schedule) q.set('schedule', schedule)
    if (file) q.set('file', file)
    if (filesOnly) q.set('files', '1')
    return q.toString()
  }, [everyone, report, schedule, file, filesOnly])

  const runsQ = useInfiniteQuery({
    queryKey: ['report-runs', query],
    queryFn: ({ pageParam }) => api.get('/reports/runs?' + query + (pageParam ? '&before=' + encodeURIComponent(pageParam) : '')),
    initialPageParam: null,
    getNextPageParam: last => last.next || undefined,
    retry: retryUnlessRefused,
    staleTime: 0,
  })
  const runs = useMemo(() => runsQ.data?.pages.flatMap(p => p.runs) ?? [], [runsQ.data])

  // The report these runs are of, for its name (the report page's own query, so
  // it is there already when the person comes from it).
  const reportQ = useQuery({
    queryKey: ['report', report],
    queryFn: () => api.get('/reports/' + encodeURIComponent(report)),
    enabled: !!report,
    retry: retryUnlessRefused,
  })
  const reportName = reportQ.data?.report?.name || runs.find(r => r.report?.name)?.report.name || null
  // The schedule these runs are of, for its name: the schedule itself, else
  // the name its runs carry (a schedule someone else made can't be read).
  const scheduleQ = useQuery({
    queryKey: ['report-schedule', schedule],
    queryFn: () => api.get('/reports/schedules/' + encodeURIComponent(schedule)),
    enabled: !!schedule,
    retry: false,
    staleTime: 0,
  })
  const scheduleName = scheduleQ.data?.schedule?.name || runs.find(r => r.schedule?.name)?.schedule.name || null

  const narrowed = !!(report || file || schedule)
  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="report-runs-page">
      <PageHeader icon={History} title="Past runs">
        <Link to="/reports" data-testid="report-runs-back" className={btn}>
          <ChevronLeft className="w-4 h-4" /> Reports
        </Link>
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
          <p className="text-sm text-muted-foreground" data-testid="report-runs-about">
            The reports {everyone ? 'everyone in your group' : 'you'} ran, downloaded, printed, kept a file of or emailed, and what {everyone ? 'their' : 'your'} schedules sent, newest first. A kept file is here to download for 30 days, 7 if it holds people's details. Only the person who made a file can download it. An email's addresses are shown masked.
          </p>

          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Which runs">
            {canManage && (
              <>
                <button type="button" onClick={() => change({ scope: null })} aria-pressed={!everyone} data-testid="runs-mine" className={chip(!everyone)}>Mine</button>
                <button type="button" onClick={() => change({ scope: 'all' })} aria-pressed={everyone} data-testid="runs-everyone" className={chip(everyone)}>Everyone's</button>
                <span className="w-px h-8 bg-border mx-1" aria-hidden="true" />
              </>
            )}
            <button type="button" onClick={() => change({ files: null })} aria-pressed={!filesOnly} data-testid="runs-all" className={chip(!filesOnly)}>Every run</button>
            <button type="button" onClick={() => change({ files: true })} aria-pressed={filesOnly} data-testid="runs-files" className={chip(filesOnly)}>Kept files</button>
          </div>

          {narrowed && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2" data-testid="runs-narrowed">
              <span className="text-sm flex-1 min-w-[12rem]">
                {file ? 'One kept file'
                  : schedule ? 'Runs of the schedule ' + (scheduleName ? '“' + scheduleName + '”' : 'you picked')
                    : 'Runs of ' + (reportName ? '“' + reportName + '”' : 'one report')}
                {file && reportName ? ' of “' + reportName + '”' : ''}
              </span>
              {schedule && (
                <Link to="/reports/schedules" data-testid="runs-schedules-link"
                  className="inline-flex items-center gap-1.5 h-12 px-3 rounded-lg text-sm text-muted-foreground hover:bg-muted touch-manipulation">
                  <CalendarDays className="w-4 h-4" /> Schedules
                </Link>
              )}
              <button type="button" onClick={() => change({ report: null, file: null, schedule: null })} data-testid="runs-show-all"
                className="inline-flex items-center gap-1.5 h-12 px-3 rounded-lg text-sm text-muted-foreground hover:bg-muted touch-manipulation">
                <X className="w-4 h-4" /> {schedule ? 'Show every run' : 'Show every report'}
              </button>
            </div>
          )}

          <Problems error={runsQ.error} title="Past runs can't be shown" />
          {runsQ.isLoading && <p className="text-sm text-muted-foreground" data-testid="runs-loading">Loading past runs…</p>}

          {runsQ.data && !runs.length && (
            <p className="text-sm text-muted-foreground" data-testid="runs-none">
              {file ? 'That file isn\'t one of yours, or it was never kept.'
                : filesOnly ? 'No kept files yet. Keep a file of a report from its page (More, then Keep a file).'
                  : schedule ? 'This schedule hasn\'t sent anything yet.'
                    : 'Nothing has been run yet.'}
            </p>
          )}

          {runs.length > 0 && (
            <ul className="space-y-3" data-testid="runs-list">
              {runs.map(r => <RunRow key={r.id} r={r} everyone={everyone} bySchedule={!!schedule} />)}
            </ul>
          )}

          {runsQ.hasNextPage && (
            <button type="button" onClick={() => runsQ.fetchNextPage()} disabled={runsQ.isFetchingNextPage} data-testid="runs-more" className={btn}>
              {runsQ.isFetchingNextPage ? 'Loading…' : 'Show older runs'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

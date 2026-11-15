// src/pages/ReportSchedules.jsx
//
// Schedules (/reports/schedules): the reports emailed by themselves (api
// routes/reportSchedules.js). Each person sees their own; Manage on Reports
// adds Everyone's. `?report=<id>` narrows the list to one report's schedules
// (a report's More: Schedules of this report) and offers a new one for it.
//
// A schedule sends as its owner, with what the owner's role sees, checked at
// every run. Changing someone else's schedule (Manage) makes it the person's
// own: the window says so before Save. Pausing stops it (its owner, or
// Manage); Resume checks it again as its owner first. Send now sends it once,
// whatever its condition, without moving its next email. Each send is on Past
// runs (/reports/runs?schedule=<id>).

import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarDays, ChevronLeft, Pause, Play, Send, Pencil, History, Plus, AlertTriangle, CheckCircle2, Loader2, Mail, Users,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { usePermission } from '@/hooks/usePermission'
import { PageHeader, ConfirmDelete } from '@/components/staff/shared'
import { Problems, reportPath, retryUnlessRefused } from '@/components/reports/shared'
import { ScheduleWindow, whenText } from '@/components/reports/ScheduleWindow'
import { cn } from '@/lib/utils'

const btn = 'inline-flex items-center gap-2 h-12 px-3 rounded-lg border bg-background text-sm font-medium touch-manipulation hover:bg-muted disabled:opacity-50 shrink-0'
const primaryBtn = 'inline-flex items-center gap-2 h-12 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation hover:opacity-90 disabled:opacity-50 shrink-0'
const chip = on => cn('h-12 px-4 rounded-lg border text-sm font-medium touch-manipulation',
  on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')

const STATUS_WORDS = {
  sent: 'Sent',
  partly: 'Sent to some of them',
  failed: 'Not sent',
  not_met: 'Skipped: its condition wasn\'t met',
  skipped: 'Skipped',
}

const plural = (n, one, many) => (n === 1 ? '1 ' + one : n + ' ' + many)

// Who it goes to, in a line: names first, then how many more.
function recipientsText(list) {
  const names = list.map(r => r.name || r.email || 'Someone who left the team')
  if (names.length <= 3) return names.join(', ')
  return names.slice(0, 3).join(', ') + ' and ' + plural(names.length - 3, 'other', 'others')
}

function ScheduleCard({ s, everyone, onEdit, onChanged }) {
  const api = useApi()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(null)       // 'pause' | 'resume' | 'send' | 'delete'
  const [error, setError] = useState(null)     // { title, error }
  const [asking, setAsking] = useState(false)  // Send now: are you sure?
  const [sent, setSent] = useState(null)       // what Send now answered
  const ref = '/reports/schedules/' + encodeURIComponent(s.id)

  const act = async (what, path, title) => {
    setBusy(what)
    setError(null)
    setSent(null)
    try {
      const out = await api.post(ref + path, {})
      setBusy(null)
      onChanged(out.schedule)
      return out
    } catch (e) {
      setBusy(null)
      setError({ title, error: e })
      // A send that failed still changed its last status: show it.
      qc.invalidateQueries({ queryKey: ['report-schedules'] })
      return null
    }
  }
  const send = async () => {
    setAsking(false)
    const out = await act('send', '/send', 'It wasn\'t sent')
    if (out) {
      setSent(out)
      qc.invalidateQueries({ queryKey: ['report-runs'] })
    }
  }
  const remove = async () => {
    setBusy('delete')
    setError(null)
    try {
      await api.delete(ref)
      qc.invalidateQueries({ queryKey: ['report-schedules'] })
    } catch (e) {
      setBusy(null)
      setError({ title: 'The schedule wasn\'t deleted', error: e })
    }
  }

  const outside = s.recipients.filter(r => r.outside).length
  const gone = s.recipients.filter(r => !r.outside && !r.on_team).length
  const status = s.last_status ? STATUS_WORDS[s.last_status] || s.last_status : null

  return (
    <li className={cn('rounded-xl border bg-background', !s.enabled && 'bg-muted/30')} data-testid="schedule-card" data-id={s.id}
      data-enabled={s.enabled ? '1' : '0'}>
      <div className="p-4 space-y-2">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
          <div className="flex-1 min-w-[12rem]">
            <h2 className="text-sm font-semibold leading-snug break-words" data-testid="schedule-name">{s.name || s.report.name}</h2>
            {s.name && <p className="text-xs text-muted-foreground break-words">Emails {s.report.name}</p>}
          </div>
          {s.sending && (
            <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 border border-blue-200 px-2 py-1 text-[11px] font-medium text-blue-800" data-testid="schedule-sending">
              <Loader2 className="w-3 h-3 animate-spin" /> Sending now
            </span>
          )}
          {!s.enabled && (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 border border-amber-200 px-2 py-1 text-[11px] font-medium text-amber-900" data-testid="schedule-paused">
              <Pause className="w-3 h-3" /> Paused
            </span>
          )}
        </div>

        <p className="text-sm" data-testid="schedule-timing">
          {s.timing_text}.{' '}
          {s.enabled
            ? s.next_run_at ? <span data-testid="schedule-next">Next email {whenText(s.next_run_at, s.time_zone)}.</span> : 'It never comes round.'
            : <span data-testid="schedule-paused-why">{s.paused_reason ? s.paused_reason + '.' : 'Nothing is sent until it is resumed.'}</span>}
        </p>

        <dl className="grid grid-cols-1 sm:grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Sends</dt>
          <dd data-testid="schedule-condition">{s.condition_text}</dd>
          <dt className="text-muted-foreground">The email holds</dt>
          <dd data-testid="schedule-delivery">{s.delivery_text}</dd>
          <dt className="text-muted-foreground">Goes to</dt>
          <dd data-testid="schedule-recipients">
            {recipientsText(s.recipients) || 'Nobody'}
            {outside > 0 && <span className="text-muted-foreground"> ({plural(outside, 'address', 'addresses')} outside the team{s.personal_outside ? ', with people\'s details' : ''})</span>}
          </dd>
          {s.choices.length > 0 && (
            <>
              <dt className="text-muted-foreground">Choices</dt>
              <dd data-testid="schedule-choices">{s.choices.map(c => c.label + ': ' + c.text).join(' · ')}</dd>
            </>
          )}
          {everyone && (
            <>
              <dt className="text-muted-foreground">Sends as</dt>
              <dd data-testid="schedule-owner">{s.mine ? 'You' : s.owner_email || 'Someone on the team'}</dd>
            </>
          )}
          {status && (
            <>
              <dt className="text-muted-foreground">Last time</dt>
              <dd data-testid="schedule-last" data-status={s.last_status}>
                {status}{s.last_run_at ? ', ' + whenText(s.last_run_at, s.time_zone) : ''}.
                {s.failures > 1 && <span className="text-red-700"> Not sent the last {s.failures} times.</span>}
              </dd>
            </>
          )}
        </dl>

        {s.last_error && (s.last_status === 'failed' || s.last_status === 'partly' || !s.enabled) && (
          <p className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" data-testid="schedule-error">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> <span className="break-words">{s.last_error}</span>
          </p>
        )}
        {gone > 0 && (
          <p className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="schedule-gone">
            <Users className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{plural(gone, 'person', 'people')} it goes to {gone === 1 ? 'isn\'t' : 'aren\'t'} on the team any more, so they get nothing.</span>
          </p>
        )}

        {sent && (
          <p className="flex flex-wrap items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900" role="status" data-testid="schedule-sent" data-status={sent.status}>
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1 min-w-[10rem]">
              {sent.status === 'partly' ? 'Sent to ' + sent.sent + ' of ' + sent.to + '. ' + (sent.error || '') : 'Sent to ' + plural(sent.sent, 'person', 'people') + '.'}
              {sent.kept ? ' The file is kept for you on Past runs.' : ''}
            </span>
          </p>
        )}
        {error && <Problems error={error.error} title={error.title} />}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {s.can_change && (
            <button type="button" onClick={() => onEdit(s)} disabled={!!busy} data-testid="schedule-edit" className={btn}>
              <Pencil className="w-4 h-4" /> Change
            </button>
          )}
          {s.can_pause && s.enabled && (
            <button type="button" onClick={() => act('pause', '/pause', 'It wasn\'t paused')} disabled={!!busy} data-testid="schedule-pause" className={btn}>
              <Pause className="w-4 h-4" /> {busy === 'pause' ? 'Pausing…' : 'Pause'}
            </button>
          )}
          {s.can_change && !s.enabled && (
            <button type="button" onClick={() => act('resume', '/resume', 'It wasn\'t resumed')} disabled={!!busy} data-testid="schedule-resume" className={btn}>
              <Play className="w-4 h-4" /> {busy === 'resume' ? 'Resuming…' : 'Resume'}
            </button>
          )}
          {s.can_send && !asking && (
            <button type="button" onClick={() => setAsking(true)} disabled={!!busy || s.sending} data-testid="schedule-send" className={btn}>
              <Send className="w-4 h-4" /> {busy === 'send' ? 'Sending…' : 'Send now'}
            </button>
          )}
          {s.can_send && asking && (
            <span className="inline-flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-2 py-1" data-testid="schedule-send-ask">
              <span className="text-xs">Send it now{s.condition.when !== 'always' ? ', whatever its condition' : ''}?</span>
              <button type="button" onClick={send} data-testid="schedule-send-yes" className={primaryBtn}>
                <Mail className="w-4 h-4" /> Yes, send it
              </button>
              <button type="button" onClick={() => setAsking(false)} data-testid="schedule-send-no" className={btn}>Not now</button>
            </span>
          )}
          <Link to={'/reports/runs?schedule=' + encodeURIComponent(s.id)} data-testid="schedule-runs" className={btn}>
            <History className="w-4 h-4" /> Past runs
          </Link>
          {s.report.id && (
            <Link to={reportPath(s.report.id)} data-testid="schedule-report" className={btn}>Open the report</Link>
          )}
          {s.can_delete && (
            <span className="ml-auto" data-testid="schedule-delete">
              <ConfirmDelete onConfirm={remove} disabled={!!busy || s.sending} label="Delete this schedule" confirmLabel="Yes, delete it" big />
            </span>
          )}
        </div>
      </div>
    </li>
  )
}

export default function ReportSchedules() {
  const api = useApi()
  const qc = useQueryClient()
  const [search, setSearch] = useSearchParams()
  const { canUse, canManage } = usePermission('reports')
  const report = search.get('report') || ''
  const everyone = search.get('scope') === 'all' && canManage
  const change = patch => {
    const next = new URLSearchParams(search)
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '') next.delete(k)
      else next.set(k, v)
    }
    setSearch(next, { replace: true })
  }

  const query = new URLSearchParams()
  if (everyone) query.set('scope', 'all')
  if (report) query.set('report', report)
  const listQ = useQuery({
    queryKey: ['report-schedules', query.toString()],
    queryFn: () => api.get('/reports/schedules' + (query.toString() ? '?' + query : '')),
    retry: retryUnlessRefused,
    staleTime: 0,
    // A send in progress: look again in a moment.
    refetchInterval: q => (q.state.data?.schedules || []).some(s => s.sending) ? 5000 : false,
  })
  const reportQ = useQuery({
    queryKey: ['report', report],
    queryFn: () => api.get('/reports/' + encodeURIComponent(report)),
    enabled: !!report,
    retry: retryUnlessRefused,
  })
  const schedules = listQ.data?.schedules || []
  const [editing, setEditing] = useState(null)   // a schedule, or 'new'
  const [saved, setSaved] = useState(null)        // the schedule just saved

  const changed = next => {
    if (next) {
      qc.setQueryData(['report-schedules', query.toString()], old => old
        ? { ...old, schedules: old.schedules.map(x => (x.id === next.id ? next : x)) }
        : old)
    }
    qc.invalidateQueries({ queryKey: ['report-schedules'] })
  }
  const reportName = reportQ.data?.report?.name
  const canNew = !!report && canUse && !!reportQ.data?.report?.runs

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="report-schedules-page">
      <PageHeader icon={CalendarDays} title="Schedules">
        <Link to="/reports" data-testid="report-schedules-back" className={btn}>
          <ChevronLeft className="w-4 h-4" /> Reports
        </Link>
        {canNew && (
          <button type="button" onClick={() => { setSaved(null); setEditing('new') }} data-testid="schedules-new" className={primaryBtn}>
            <Plus className="w-4 h-4" /> New schedule
          </button>
        )}
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
          <p className="text-sm text-muted-foreground" data-testid="report-schedules-about">
            Reports emailed by themselves. Each sends as the person it belongs to, with what their role sees at the time it sends.
            {canUse ? ' To schedule a report, open it and choose More, then Schedule this report.' : ''}
          </p>

          {canManage && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Whose schedules">
              <button type="button" onClick={() => change({ scope: null })} aria-pressed={!everyone} data-testid="schedules-mine" className={chip(!everyone)}>Mine</button>
              <button type="button" onClick={() => change({ scope: 'all' })} aria-pressed={everyone} data-testid="schedules-everyone" className={chip(everyone)}>Everyone's</button>
            </div>
          )}

          {report && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/30 px-3 py-2 text-sm" data-testid="schedules-narrowed">
              <span className="flex-1 min-w-[12rem]">
                Schedules of <span className="font-medium">{reportName || 'one report'}</span>.
              </span>
              <button type="button" onClick={() => change({ report: null })} data-testid="schedules-show-all" className={btn}>Show every schedule</button>
            </div>
          )}

          {saved && (
            <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900 flex items-start gap-2" role="status" data-testid="schedules-saved">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Saved: {saved.timing_text}.{' '}
                {saved.enabled && saved.next_run_at ? 'Next email ' + whenText(saved.next_run_at, saved.time_zone) + '.' : saved.enabled ? '' : 'It is paused, so nothing is sent until it is resumed.'}
              </span>
            </div>
          )}

          <Problems error={listQ.error} title="The schedules can't be shown" />
          {listQ.isLoading && <p className="text-sm text-muted-foreground" data-testid="schedules-loading">Loading…</p>}

          {listQ.data && !schedules.length && (
            <div className="rounded-xl border bg-background px-4 py-6 text-center text-sm text-muted-foreground" data-testid="schedules-none">
              {report ? 'This report isn\'t scheduled' + (everyone ? '' : ' by you') + '.' : everyone ? 'No report is scheduled yet.' : 'You haven\'t scheduled a report yet.'}
              {canNew && (
                <span className="block mt-3">
                  <button type="button" onClick={() => setEditing('new')} data-testid="schedules-none-new" className={primaryBtn}>
                    <Plus className="w-4 h-4" /> Schedule it
                  </button>
                </span>
              )}
            </div>
          )}

          {schedules.length > 0 && (
            <ul className="space-y-3" data-testid="schedules-list">
              {schedules.map(s => (
                <ScheduleCard key={s.id} s={s} everyone={everyone} onChanged={changed}
                  onEdit={x => { setSaved(null); setEditing(x) }} />
              ))}
            </ul>
          )}
        </div>
      </div>

      {editing && (
        <ScheduleWindow
          reportId={editing === 'new' ? report : editing.report.id}
          schedule={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={s => { setEditing(null); setSaved(s); changed(s) }} />
      )}
    </div>
  )
}

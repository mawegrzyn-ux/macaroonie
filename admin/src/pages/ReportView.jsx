// src/pages/ReportView.jsx
//
// One report (/reports/:id): what it asks for (its period, its venues, any
// filter set to "ask each time"), its result as a table, and its file (CSV
// or Excel). `:id` is a saved report's id or a starter's
// ("starter:till_sales_by_day").
//
// Changing a choice here changes this visit only: the report keeps its own
// usual choices, and nothing is saved. Changing the report itself is the
// builder's job: Edit opens it on a report the person may change, Customise
// starts a new report from a copy of any other.

import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { ChevronLeft, Download, Lock, Pencil, Copy, Share2, Trash2, MoreHorizontal, Type } from 'lucide-react'
import { paramInputs } from '@shared/reports/build.js'
import { normaliseReport, LIMITS } from '@shared/reports/spec.js'
import { useApi } from '@/lib/api'
import { usePermission } from '@/hooks/usePermission'
import { useVenues, Modal, Field, inputCls } from '@/components/staff/shared'
import ResultCard from '@/components/reports/ResultCard'
import ParamInputs, { showsInputs } from '@/components/reports/ParamInputs'
import { StarButton, Problems, retryUnlessRefused, reportPath, editPath, customisePath } from '@/components/reports/shared'
import { cn } from '@/lib/utils'

const btn = 'inline-flex items-center gap-2 h-12 px-3 rounded-lg border bg-background text-sm font-medium touch-manipulation hover:bg-muted disabled:opacity-50 shrink-0'
const primaryBtn = 'inline-flex items-center gap-2 h-12 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50 shrink-0'
const rowBtn = 'w-full flex items-center gap-3 min-h-[56px] px-3 py-2 rounded-lg border bg-background text-left touch-manipulation hover:bg-muted disabled:opacity-50'

// ── The report's name and what it is for ─────────────────────

function RenameWindow({ report, onSaved, onClose }) {
  const api = useApi()
  const [name, setName] = useState(report.name)
  const [description, setDescription] = useState(report.description || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const out = await api.put('/reports/' + encodeURIComponent(report.id), { name: name.trim(), description: description.trim() || null })
      onSaved(out.report)
    } catch (e) {
      setError(e)
      setBusy(false)
    }
  }
  return (
    <Modal title="Name and details" onClose={onClose}
      footer={<button type="button" onClick={save} disabled={busy || !name.trim()} data-testid="rename-save" className={primaryBtn}>{busy ? 'Saving…' : 'Save'}</button>}>
      <Field label="Name">
        <input type="text" value={name} onChange={e => setName(e.target.value)} maxLength={LIMITS.name} data-testid="rename-name" className={cn(inputCls, 'h-12')} />
      </Field>
      <Field label="What the report is for" hint="Shown under its name on the Reports page and when it is opened.">
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} maxLength={1000} data-testid="rename-description"
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40" />
      </Field>
      <Problems error={error} title="The report wasn't saved" />
    </Modal>
  )
}

// ── Who can open it ──────────────────────────────────────────

function ShareWindow({ report, onSaved, onClose }) {
  const api = useApi()
  const { data: roles = [] } = useQuery({ queryKey: ['access-roles'], queryFn: () => api.get('/access/roles') })
  const [shared, setShared] = useState(report.shared || 'private')
  const [roleIds, setRoleIds] = useState(report.shared_role_ids || [])
  const [starter, setStarter] = useState(!!report.is_starter)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const active = roles.filter(r => r.is_active !== false)
  const picked = roleIds.filter(id => active.some(r => r.id === id))
  const needsRole = shared === 'roles' && !picked.length

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const out = await api.patch('/reports/' + encodeURIComponent(report.id) + '/sharing',
        { shared, ...(shared === 'roles' ? { role_ids: picked } : {}), is_starter: starter })
      onSaved(out.report)
    } catch (e) {
      setError(e)
      setBusy(false)
    }
  }
  const choice = (value, label, hint) => (
    <button key={value} type="button" onClick={() => setShared(value)} aria-pressed={shared === value} data-testid="share-choice" data-value={value}
      className={cn('w-full text-left min-h-[56px] px-3 py-2 rounded-lg border touch-manipulation', shared === value ? 'border-primary bg-primary/5' : 'bg-background hover:bg-muted')}>
      <span className="block text-sm font-medium">{label}</span>
      <span className="block text-[11px] text-muted-foreground mt-0.5">{hint}</span>
    </button>
  )
  return (
    <Modal title="Share this report" onClose={onClose}
      footer={<button type="button" onClick={save} disabled={busy || needsRole} data-testid="share-save" className={primaryBtn}>{busy ? 'Saving…' : 'Save'}</button>}>
      <div className="space-y-2" role="group" aria-label="Who can open it">
        {choice('private', report.mine ? 'Only me' : 'Only the person who made it', 'People with Manage on Reports can open every report.')}
        {choice('roles', 'Some roles', 'Everyone whose role is ticked below.')}
        {choice('everyone', 'Everyone', 'Everyone whose role has Reports.')}
      </div>

      {shared === 'roles' && (
        <div className="rounded-lg border divide-y" data-testid="share-roles">
          {active.map(r => {
            const none = r.permissions?.reports === 'none'
            return (
              <label key={r.id} className="flex items-center gap-3 min-h-[48px] px-3 py-1.5 cursor-pointer touch-manipulation" data-testid="share-role" data-role-id={r.id}>
                <input type="checkbox" className="w-5 h-5 shrink-0" checked={roleIds.includes(r.id)}
                  onChange={e => setRoleIds(ids => (e.target.checked ? [...ids, r.id] : ids.filter(x => x !== r.id)))} />
                <span className="min-w-0">
                  <span className="block text-sm">{r.label}</span>
                  {none && <span className="block text-[11px] text-amber-800">This role has no access to Reports yet, so it won't see it.</span>}
                </span>
              </label>
            )
          })}
          {!active.length && <p className="px-3 py-3 text-sm text-muted-foreground">Loading the roles…</p>}
        </div>
      )}
      {needsRole && <p className="text-xs text-red-700" role="alert">Tick at least one role.</p>}

      <label className="flex items-start gap-3 min-h-[48px] py-1.5 cursor-pointer touch-manipulation">
        <input type="checkbox" className="w-5 h-5 mt-0.5 shrink-0" checked={starter} onChange={e => setStarter(e.target.checked)} data-testid="share-starter" />
        <span>
          <span className="block text-sm">Offer it to the team as a starter report</span>
          <span className="block text-[11px] text-muted-foreground mt-0.5">Everyone with Reports can open it, whatever is picked above, and make their own from it.</span>
        </span>
      </label>

      <p className="text-[11px] text-muted-foreground">
        Sharing a report shares how it is set up, never figures: each person sees what their own role may see when they open it.
      </p>
      <Problems error={error} title="The sharing wasn't saved" />
    </Modal>
  )
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
  const spec = useMemo(() => (report?.spec ? normaliseReport(report.spec) : null), [report])

  // The catalogue says how a filter that asks each time is typed in; a
  // report that only asks for its period and venues doesn't need it.
  const asksValue = !!spec?.params.some(p => p.type === 'value')
  const catQ = useQuery({ queryKey: ['report-catalogue'], queryFn: () => api.get('/reports/catalogue'), enabled: asksValue, staleTime: 5 * 60_000, retry: retryUnlessRefused })
  const inputs = useMemo(() => (spec ? paramInputs(catQ.data || null, spec) : []), [spec, catQ.data])

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

  // ── More: copy, rename, share, delete ──
  const [win, setWin] = useState(null)          // 'more' | 'rename' | 'share'
  const [asking, setAsking] = useState(false)   // delete: are you sure?
  const [busy, setBusy] = useState(null)
  const [failed, setFailed] = useState(null)    // { title, error }
  const closeWin = () => { setWin(null); setAsking(false) }
  const remove = async () => {
    setBusy('delete')
    try {
      await api.delete('/reports/' + ref)
      qc.invalidateQueries({ queryKey: ['reports'] })
      navigate('/reports')
    } catch (error) {
      setBusy(null)
      closeWin()
      setFailed({ title: 'The report wasn\'t deleted', error })
    }
  }
  const copy = async () => {
    setBusy('copy')
    try {
      const out = await api.post('/reports/' + ref + '/copy', {})
      qc.setQueryData(['report', out.report.id], { report: out.report })
      qc.invalidateQueries({ queryKey: ['reports'] })
      setBusy(null)
      closeWin()
      navigate(reportPath(out.report.id))
    } catch (error) {
      setBusy(null)
      closeWin()
      setFailed({ title: 'The copy wasn\'t made', error })
    }
  }
  const changed = next => {
    qc.setQueryData(['report', id], { report: next })
    qc.invalidateQueries({ queryKey: ['reports'] })
    closeWin()
  }

  const saved = report?.kind === 'saved'
  const canEdit = saved && report.can_edit && canUse
  const canCustomise = !!report?.runs && canUse && !canEdit
  const canCopy = saved && report.runs && canUse
  const canShare = saved && report.can_share
  const canDelete = saved && report.can_delete
  const hasMore = canCopy || canEdit || canShare || canDelete

  const values = Object.fromEntries((spec?.params || []).map(p => [p.key, p.key in given ? given[p.key] : p.default]))
  const set = (key, value) => setGiven(g => ({ ...g, [key]: value }))
  const picked = Object.keys(given).length > 0

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
        {canEdit && (
          <Link to={editPath(id)} data-testid="report-edit" className={btn} title="Change this report in the builder">
            <Pencil className="w-4 h-4" /> Edit
          </Link>
        )}
        {canCustomise && (
          <Link to={customisePath(id)} data-testid="report-customise" className={btn} title="Make a report of your own that starts as this one">
            <Pencil className="w-4 h-4" /> Customise
          </Link>
        )}
        {report?.runs && canUse && (
          <>
            {['csv', 'xlsx'].map(format => (
              <button key={format} type="button" onClick={() => download(format)} disabled={!!file.busy} data-testid={'report-download-' + format} className={btn}>
                <Download className="w-4 h-4" />
                {file.busy === format ? 'Making the file…' : format === 'csv' ? 'CSV' : 'Excel'}
              </button>
            ))}
          </>
        )}
        {hasMore && (
          <button type="button" onClick={() => setWin('more')} aria-label="More: copy, rename, share, delete" title="More" data-testid="report-more"
            className="w-12 h-12 flex items-center justify-center rounded-lg border bg-background text-muted-foreground touch-manipulation hover:bg-muted shrink-0">
            <MoreHorizontal className="w-5 h-5" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4 sm:p-6 space-y-4">
          <Problems error={reportQ.error} />
          <Problems error={file.error} title="The file wasn't made" />
          <Problems error={failed?.error} title={failed?.title} />

          {report && (
            <>
              <div className="max-w-4xl">
                {report.description && <p className="text-sm text-muted-foreground" data-testid="report-about">{report.description}</p>}
                <p className="text-[11px] text-muted-foreground mt-1" data-testid="report-whose">
                  {report.kind === 'starter' ? 'Starter report. It comes with Macaroonie and stays as it is.'
                    : report.mine ? 'Your report.' : 'By ' + (report.owner_email || 'someone in your team') + '.'}
                  {canCustomise ? ' Customise makes a report of your own from it.' : ''}
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
                  {showsInputs(inputs, venues) && (
                    <div className="flex flex-wrap items-center gap-2" data-testid="report-choices">
                      <ParamInputs catalogue={catQ.data || null} inputs={inputs} values={values} venues={venues} today={meta?.today} currency={meta?.currency} onChange={set} />
                      {picked && (
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
                    <ResultCard result={result} fetching={runQ.isFetching} stale={runQ.isPlaceholderData} onRefresh={refresh}
                      more={canUse ? 'Download the file for all of them.' : 'Pick a shorter period to see fewer.'} />
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {win === 'more' && report && (
        <Modal title={report.name} onClose={closeWin}>
          <div className="space-y-2" data-testid="report-more-list">
            {canCopy && (
              <button type="button" onClick={copy} disabled={!!busy} data-testid="more-copy" className={rowBtn}>
                <Copy className="w-4 h-4 text-muted-foreground shrink-0" />
                <span>
                  <span className="block text-sm font-medium">{busy === 'copy' ? 'Making the copy…' : 'Make a copy'}</span>
                  <span className="block text-[11px] text-muted-foreground">A report of your own, set up the same way.</span>
                </span>
              </button>
            )}
            {canEdit && (
              <button type="button" onClick={() => { setAsking(false); setWin('rename') }} data-testid="more-rename" className={rowBtn}>
                <Type className="w-4 h-4 text-muted-foreground shrink-0" />
                <span>
                  <span className="block text-sm font-medium">Name and details</span>
                  <span className="block text-[11px] text-muted-foreground">What it is called and what it is for.</span>
                </span>
              </button>
            )}
            {canShare && (
              <button type="button" onClick={() => { setAsking(false); setWin('share') }} data-testid="more-share" className={rowBtn}>
                <Share2 className="w-4 h-4 text-muted-foreground shrink-0" />
                <span>
                  <span className="block text-sm font-medium">Share</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {report.is_starter ? 'Offered to the team as a starter report.'
                      : report.shared === 'everyone' ? 'Everyone with Reports can open it.'
                        : report.shared === 'roles' ? 'Some roles can open it.'
                          : report.mine ? 'Only you can open it.' : 'Not shared.'}
                  </span>
                </span>
              </button>
            )}
            {canDelete && !asking && (
              <button type="button" onClick={() => setAsking(true)} data-testid="more-delete" className={cn(rowBtn, 'text-red-700')}>
                <Trash2 className="w-4 h-4 shrink-0" />
                <span className="block text-sm font-medium">Delete this report</span>
              </button>
            )}
            {canDelete && asking && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 space-y-2" role="alert" data-testid="more-delete-ask">
                <p className="text-sm text-red-800">Delete “{report.name}”? It goes for everyone it is shared with, and can't be brought back.</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={remove} disabled={!!busy} data-testid="more-delete-yes"
                    className="h-12 px-4 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium touch-manipulation disabled:opacity-50">
                    {busy === 'delete' ? 'Deleting…' : 'Yes, delete it'}
                  </button>
                  <button type="button" onClick={() => setAsking(false)} data-testid="more-delete-no" className="h-12 px-4 rounded-lg border bg-background text-sm touch-manipulation">Keep it</button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
      {win === 'rename' && report && <RenameWindow report={report} onSaved={changed} onClose={closeWin} />}
      {win === 'share' && report && <ShareWindow report={report} onSaved={changed} onClose={closeWin} />}
    </div>
  )
}

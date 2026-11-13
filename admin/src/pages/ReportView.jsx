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
//
// A row of a summary can be opened up (components/reports/drill.jsx): into
// the same figures by another field, or into the rows behind it. The steps
// taken are kept here for the visit, shown as a trail, and sent with every
// run and file, so what is downloaded is what is on screen.
//
// Print opens the report's print page in a new tab (api reports/export/
// print.js): the report with these choices, the rows opened up and the chart,
// laid out for paper. A new tab can't send the login, so the page is reached
// by a link that works for a few minutes (POST /reports/:id/print-link).
//
// A list's row can open the record itself on its page in the app (the check,
// the order, the booking: docs/REPORTS.md 8, components/reports/open.js).
// The visit (the choices, the rows opened up, where the page and the table
// were scrolled to) is kept on this page's place in the browser's history
// first, so Back (the browser's, or the bar above the record:
// components/reports/FromReport.jsx) comes back to the report as it was left.

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { ChevronLeft, Download, Lock, Pencil, Copy, Share2, Trash2, MoreHorizontal, Type, Printer } from 'lucide-react'
import { paramInputs } from '@shared/reports/build.js'
import { normaliseReport, LIMITS } from '@shared/reports/spec.js'
import { useApi } from '@/lib/api'
import { usePermission } from '@/hooks/usePermission'
import { usePepperPage } from '@/lib/pepperPage'
import { useVenues, Modal, Field, inputCls } from '@/components/staff/shared'
import ResultCard from '@/components/reports/ResultCard'
import ParamInputs, { showsInputs } from '@/components/reports/ParamInputs'
import { DrillTrail, DrillWindow, drillBody, drillChoices, stepOf } from '@/components/reports/drill'
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
  const location = useLocation()
  const { canUse } = usePermission('reports')
  const { data: venues = [] } = useVenues()
  // Back from a record a row opened: the visit as it was left (openRecord()).
  const visit = location.state?.visit?.id === id ? location.state.visit : null

  const reportQ = useQuery({ queryKey: ['report', id], queryFn: () => api.get('/reports/' + ref), retry: retryUnlessRefused })
  const report = reportQ.data?.report
  const spec = useMemo(() => (report?.spec ? normaliseReport(report.spec) : null), [report])

  // The catalogue says how a filter that asks each time is typed in; a
  // report that only asks for its period and venues doesn't need it.
  const asksValue = !!spec?.params.some(p => p.type === 'value')
  const catQ = useQuery({ queryKey: ['report-catalogue'], queryFn: () => api.get('/reports/catalogue'), enabled: asksValue, staleTime: 5 * 60_000, retry: retryUnlessRefused })
  const inputs = useMemo(() => (spec ? paramInputs(catQ.data || null, spec) : []), [spec, catQ.data])

  // Only what the person changed here; anything else is the report's own.
  const [given, setGiven] = useState(() => (visit?.given && typeof visit.given === 'object' ? visit.given : {}))
  // Where the person has drilled to: each step a tap on the result of the ones before.
  const [steps, setSteps] = useState(() => (Array.isArray(visit?.steps) ? visit.steps : []))
  const [tapped, setTapped] = useState(null)   // a row waiting for what to open it into
  const drill = useMemo(() => drillBody(steps), [steps])
  const fresh = useRef(false)
  const runQ = useQuery({
    queryKey: ['report-run', id, given, drill],
    queryFn: () => api.post('/reports/' + ref + '/run', { params: given, ...(drill.length ? { drill } : {}), ...(fresh.current ? { fresh: true } : {}) }),
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

  // One thing a row can open into: a tap goes there. More: the window asks.
  const openInto = (target, choice) => { setSteps(list => [...list, stepOf(target, choice)]); setTapped(null) }
  const onTap = target => {
    if (!target) return
    const choices = drillChoices(result)
    if (choices.length === 1) openInto(target, choices[0])
    else if (choices.length) setTapped(target)
  }
  const backTo = n => { setSteps(list => list.slice(0, n)); setTapped(null) }

  // ── A row that opens its record on its own page ──
  const pageRef = useRef(null)      // the page's scrolling box
  const tableScroll = useRef(null)  // the table's (ResultTable keeps it)
  const openRecord = (row, href) => {
    const path = location.pathname + location.search
    const here = {
      id, given, steps,
      page: pageRef.current?.scrollTop || 0,
      table: tableScroll.current ? { top: tableScroll.current.scrollTop, left: tableScroll.current.scrollLeft } : null,
    }
    // This page's place in the history keeps the visit, so Back returns to it ...
    navigate(path, { replace: true, state: { ...(location.state || {}), visit: here } })
    // ... and the record's page knows where it was opened from (and how far back that is).
    navigate(href, { state: { fromReport: { id, name: report?.name || '', path, idx: window.history.state?.idx, visit: here } } })
  }
  // Back from a record: where the page was scrolled to, once the result is in.
  const restored = useRef(!visit)
  useLayoutEffect(() => {
    if (restored.current || !result || runQ.isPlaceholderData) return
    restored.current = true
    if (pageRef.current) pageRef.current.scrollTop = visit?.page || 0
  })

  const [file, setFile] = useState({ busy: null, error: null })
  const download = async format => {
    setFile({ busy: format, error: null })
    try {
      await api.postDownload('/reports/' + ref + '/export', { format, params: given, ...(drill.length ? { drill } : {}) }, 'report.' + format)
      setFile({ busy: null, error: null })
    } catch (error) {
      setFile({ busy: null, error })
    }
  }

  // ── Print: what is on screen, on a page made for paper ──
  const tableShown = useRef(null)   // the table under a chart: showing or not (ResultCard keeps it)
  const seriesOff = useRef([])      // the series switched off in the chart's legend (the chart keeps it)
  const [printing, setPrinting] = useState({ busy: false, error: null })
  const print = async () => {
    // The tab is opened now, while the tap still counts: one opened after the
    // wait is a pop-up most browsers block.
    const tab = window.open('', '_blank')
    setPrinting({ busy: true, error: null })
    try {
      const out = await api.post('/reports/' + ref + '/print-link', {
        params: given,
        // The trail's words (a row's name can be long: the page says the start of it).
        ...(drill.length ? { drill, trail: steps.map(s => ({ label: String(s.label ?? '').slice(0, 200), by: String(s.by ?? '').slice(0, 80), ...(s.of ? { of: String(s.of).slice(0, 80) } : {}) })) } : {}),
        ...(tableShown.current == null ? {} : { table: tableShown.current }),
        ...(seriesOff.current?.length ? { hidden: seriesOff.current } : {}),
      })
      const url = out.path + '?print=1'
      if (tab) tab.location.href = url
      else window.location.href = url
      setPrinting({ busy: false, error: null })
    } catch (error) {
      tab?.close()
      setPrinting({ busy: false, error })
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

  // Pepper's "ask about this page": the report open here, the period the
  // result shows and the venues picked (every venue sends none). The server
  // names the report only when the person may open it.
  const venuesParam = (spec?.params || []).find(p => p.type === 'venues')
  const pickedVenues = venuesParam && Array.isArray(values[venuesParam.key]) ? values[venuesParam.key] : undefined
  usePepperPage({
    report: report ? { id: report.id, from: meta?.period?.from, to: meta?.period?.to, venue_ids: pickedVenues } : undefined,
    label: report?.name,
  })

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
        {report?.runs && (
          <button type="button" onClick={print} disabled={printing.busy || !result || !!runQ.error || runQ.isPlaceholderData} data-testid="report-print" className={btn}
            title="Open this report as a page to print, as it is shown here">
            <Printer className="w-4 h-4" />
            {printing.busy ? 'Opening…' : 'Print'}
          </button>
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

      <div ref={pageRef} className="flex-1 overflow-y-auto" data-testid="report-page-scroll">
        <div className="p-4 sm:p-6 space-y-4">
          <Problems error={reportQ.error} />
          <Problems error={file.error} title="The file wasn't made" />
          <Problems error={printing.error} title="The print page wasn't made" />
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

                  <DrillTrail steps={steps} onGo={backTo} />

                  <Problems error={runQ.error} title={steps.length ? 'That can\'t be shown' : 'This report can\'t be shown'} />

                  {runQ.isLoading && !result && <p className="text-sm text-muted-foreground" data-testid="report-loading">Working it out…</p>}

                  {result && !runQ.error && (
                    <ResultCard result={result} fetching={runQ.isFetching} stale={runQ.isPlaceholderData} onRefresh={refresh} onTap={onTap} tableRef={tableShown} hiddenRef={seriesOff}
                      onOpen={openRecord} startAt={restored.current ? null : visit?.table || null} scrollerRef={tableScroll}
                      more={canUse ? 'Download the file for all of them.' : 'Pick a shorter period to see fewer.'} />
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {tapped && result && !runQ.isPlaceholderData && (
        <DrillWindow result={result} target={tapped} onPick={choice => openInto(tapped, choice)} onClose={() => setTapped(null)} />
      )}

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

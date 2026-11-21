// src/pages/ReportPageEditor.jsx
//
// Making or changing a Page report (docs/REPORTS.md 6, 11): several reports
// in order, with words and page breaks between them, read and printed as one.
// /reports/new-page starts one, /reports/:id/page changes a saved one (its
// owner with Use, or Manage). The rules are shared/reports/page.js; the
// server checks every report on it is one the person can open.
//
// The page holds references, never copies: each report on it runs as the
// person looking at the page, so a page shows nobody more than its reports.

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Plus, FileText, Type, SeparatorHorizontal, Search, X } from 'lucide-react'
import { normalisePage, newPage, PAGE_LIMITS, SHOWS, SHOW_LABELS } from '@shared/reports/page.js'
import { useApi } from '@/lib/api'
import { usePermission } from '@/hooks/usePermission'
import { useVenues, Modal, Field, Segmented, SortableRows, inputCls } from '@/components/staff/shared'
import PeriodPicker from '@/components/reports/PeriodPicker'
import VenuesPicker from '@/components/reports/VenuesPicker'
import { Problems, retryUnlessRefused, reportPath } from '@/components/reports/shared'
import { cn } from '@/lib/utils'

const btn = 'inline-flex items-center gap-2 h-12 px-3 rounded-lg border bg-background text-sm font-medium touch-manipulation hover:bg-muted disabled:opacity-50 shrink-0'
const primaryBtn = 'inline-flex items-center gap-2 h-12 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50 shrink-0'
let seq = 0
const freshId = () => 'n' + Date.now().toString(36).slice(-4) + (seq++ % 100)

/** Picking a report for the page: the person's reports and the starters, with a search. */
function ReportPicker({ reports, onPick, onClose }) {
  const [q, setQ] = useState('')
  const words = q.trim().toLowerCase()
  const shown = reports.filter(r => !words || r.name.toLowerCase().includes(words))
  return (
    <Modal title="Add a report" onClose={onClose}>
      <label className="relative block">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a report" autoFocus
          className={cn(inputCls, 'h-12 pl-9')} data-testid="page-pick-search" />
      </label>
      <div className="space-y-1" data-testid="page-pick-list">
        {shown.slice(0, 80).map(r => (
          <button key={r.id} type="button" onClick={() => onPick(r)} disabled={!r.runs} data-testid="page-pick" data-ref={r.id}
            className="w-full text-left min-h-[56px] px-3 py-2 rounded-lg border bg-background hover:bg-muted touch-manipulation disabled:opacity-50">
            <span className="block text-sm font-medium">{r.name}</span>
            <span className="block text-[11px] text-muted-foreground">
              {r.kind === 'starter' ? 'Starter report' : r.mine ? 'Your report' : 'By ' + (r.owner_email || 'your team')}
              {!r.runs ? ' · your role can\'t run it' : ''}
            </span>
          </button>
        ))}
        {!shown.length && <p className="text-sm text-muted-foreground">No report has those words in its name.</p>}
      </div>
    </Modal>
  )
}

export default function ReportPageEditor() {
  const { id } = useParams()
  const editing = !!id
  const api = useApi()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { canUse } = usePermission('reports')
  const { data: venues = [] } = useVenues()

  const pageQ = useQuery({ queryKey: ['report', id], queryFn: () => api.get('/reports/' + encodeURIComponent(id)), enabled: editing, retry: retryUnlessRefused })
  const listQ = useQuery({ queryKey: ['reports'], queryFn: () => api.get('/reports'), retry: retryUnlessRefused })
  const reports = useMemo(() => [...(listQ.data?.reports || []).filter(r => r.report_kind !== 'page'), ...(listQ.data?.starters || [])], [listQ.data])
  const nameOf = ref => reports.find(r => r.id === ref)?.name || pageQ.data?.report?.reports?.[ref]?.name || 'A report'

  const [draft, setDraft] = useState(() => (editing ? null : { name: '', description: '', spec: newPage() }))
  const [saved, setSaved] = useState(null)
  useEffect(() => {
    const r = pageQ.data?.report
    if (!editing || !r || draft) return
    const d = { name: r.name, description: r.description || '', spec: normalisePage(r.spec) }
    setDraft(d)
    setSaved(JSON.stringify(d))
  }, [pageQ.data, editing, draft])
  const dirty = !!draft && JSON.stringify(draft) !== (saved ?? JSON.stringify({ name: '', description: '', spec: newPage() }))
  useEffect(() => {
    if (!dirty) return
    const stop = e => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', stop)
    return () => window.removeEventListener('beforeunload', stop)
  }, [dirty])

  const [picking, setPicking] = useState(false)
  const [state, setState] = useState({ busy: false, error: null })
  const spec = draft?.spec
  const setSpec = patch => setDraft(d => ({ ...d, spec: { ...d.spec, ...patch } }))
  const setBlock = (bid, patch) => setSpec({ blocks: spec.blocks.map(b => (b.id === bid ? { ...b, ...patch } : b)) })
  const remove = bid => setSpec({ blocks: spec.blocks.filter(b => b.id !== bid) })
  const add = block => setSpec({ blocks: [...spec.blocks, { id: freshId(), ...block }] })
  const reportCount = spec ? spec.blocks.filter(b => b.type === 'report').length : 0
  const full = spec && spec.blocks.length >= PAGE_LIMITS.blocks

  const save = async () => {
    setState({ busy: true, error: null })
    try {
      const body = { name: draft.name.trim(), description: draft.description.trim() || null, spec: normalisePage(draft.spec) }
      const out = editing ? await api.put('/reports/' + encodeURIComponent(id), body) : await api.post('/reports', body)
      qc.setQueryData(['report', out.report.id], { report: out.report })
      qc.invalidateQueries({ queryKey: ['reports'] })
      setSaved(JSON.stringify(draft))
      setState({ busy: false, error: null })
      navigate(reportPath(out.report.id), { replace: !editing })
    } catch (error) {
      setState({ busy: false, error })
    }
  }

  if (!canUse) return <div className="p-6"><Problems error={{ status: 403, message: 'Making a page of reports needs Use on Reports.' }} /></div>

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="page-editor">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 max-lg:notouch:pl-14 border-b shrink-0 min-h-[56px] bg-background">
        <Link to={editing ? reportPath(id) : '/reports'} aria-label="Back" title="Back"
          className="w-12 h-12 -ml-2 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted touch-manipulation shrink-0">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="font-semibold text-sm flex-1 min-w-[8rem]">{editing ? 'Change the page' : 'New page of reports'}</h1>
        <span className="text-[11px] text-muted-foreground" data-testid="page-save-state">{dirty ? 'Changes not saved' : editing ? 'Saved' : ''}</span>
        <button type="button" onClick={save} disabled={!draft || state.busy || !draft.name.trim() || !reportCount || (editing && !dirty)} data-testid="page-save" className={primaryBtn}>
          {state.busy ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4 sm:p-6 space-y-5 max-w-3xl">
          <Problems error={pageQ.error || listQ.error} />
          <Problems error={state.error} title="The page wasn't saved" />
          {draft && (
            <>
              <div className="rounded-xl border bg-background p-4 space-y-3">
                <Field label="Name">
                  <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} maxLength={120}
                    placeholder="Monday board pack" className={cn(inputCls, 'h-12')} data-testid="page-name" />
                </Field>
                <Field label="What it is for (optional)">
                  <input value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} maxLength={500}
                    className={cn(inputCls, 'h-12')} data-testid="page-description" />
                </Field>
                <Field label="Period" group>
                  <div className="flex flex-wrap items-center gap-2">
                    <Segmented value={spec.period ? 'page' : 'own'} testid="page-period-mode"
                      onChange={v => setSpec({ period: v === 'page' ? (spec.period || { relative: 'last_week' }) : null })}
                      options={[{ value: 'own', label: 'Each report\'s own' }, { value: 'page', label: 'One for the page' }]} />
                    {spec.period && <PeriodPicker value={spec.period} onChange={v => setSpec({ period: v })} />}
                  </div>
                </Field>
                {venues.length > 1 && (
                  <Field label="Venues" group>
                    <div className="flex flex-wrap items-center gap-2">
                      <Segmented value={spec.venues != null ? 'page' : 'own'} testid="page-venues-mode"
                        onChange={v => setSpec({ venues: v === 'page' ? (spec.venues ?? 'all') : null })}
                        options={[{ value: 'own', label: 'Each report\'s own' }, { value: 'page', label: 'One for the page' }]} />
                      {spec.venues != null && <VenuesPicker venues={venues} value={spec.venues} onChange={v => setSpec({ venues: v })} />}
                    </div>
                  </Field>
                )}
                <p className="text-[11px] text-muted-foreground">A period or venues for the page go on each report's own choice of them; people looking at the page can change them for their visit.</p>
              </div>

              <div className="space-y-2">
                <h2 className="text-sm font-semibold">On the page</h2>
                {!spec.blocks.length && <p className="text-sm text-muted-foreground" data-testid="page-empty">Nothing yet. Add a report to start.</p>}
                {spec.blocks.length > 0 && (
                  <SortableRows items={spec.blocks} onReorder={ids => setSpec({ blocks: ids.map(x => spec.blocks.find(b => b.id === x)) })}
                    renderItem={b => (
                      <div className="flex flex-wrap items-start gap-2 py-1" data-testid="page-block" data-type={b.type}>
                        <div className="flex-1 min-w-[12rem] space-y-2">
                          {b.type === 'report' && (
                            <>
                              <p className="text-sm font-medium flex items-center gap-2"><FileText className="w-4 h-4 text-muted-foreground" />{nameOf(b.ref)}</p>
                              <input value={b.title} onChange={e => setBlock(b.id, { title: e.target.value })} maxLength={PAGE_LIMITS.title}
                                placeholder="Heading (the report's name)" className={cn(inputCls, 'h-12')} data-testid="page-block-title" />
                              <Segmented value={b.show} testid="page-block-show" onChange={v => setBlock(b.id, { show: v })}
                                options={SHOWS.map(s => ({ value: s, label: SHOW_LABELS[s] }))} />
                            </>
                          )}
                          {b.type === 'text' && (
                            <>
                              <input value={b.title} onChange={e => setBlock(b.id, { title: e.target.value })} maxLength={PAGE_LIMITS.title}
                                placeholder="Heading (optional)" className={cn(inputCls, 'h-12')} data-testid="page-text-title" />
                              <textarea value={b.text} onChange={e => setBlock(b.id, { text: e.target.value })} maxLength={PAGE_LIMITS.text} rows={3}
                                placeholder="Words for the page" className={cn(inputCls, 'h-auto py-2')} data-testid="page-text-words" />
                            </>
                          )}
                          {b.type === 'break' && (
                            <p className="text-sm text-muted-foreground flex items-center gap-2 min-h-[48px]" data-testid="page-break-row">
                              <SeparatorHorizontal className="w-4 h-4 shrink-0" />
                              {spec.blocks[spec.blocks.length - 1]?.id === b.id
                                ? 'Page break: nothing follows it yet, so it is left off when saved'
                                : 'Page break: what follows starts a new sheet'}
                            </p>
                          )}
                        </div>
                        <button type="button" onClick={() => remove(b.id)} aria-label="Take it off the page" title="Take it off the page" data-testid="page-block-remove"
                          className="w-12 h-12 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted touch-manipulation shrink-0">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )} />
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button type="button" onClick={() => setPicking(true)} disabled={full || reportCount >= PAGE_LIMITS.reports} data-testid="page-add-report" className={btn}>
                    <Plus className="w-4 h-4" /> Add a report
                  </button>
                  <button type="button" onClick={() => add({ type: 'text', title: '', text: '' })} disabled={full} data-testid="page-add-text" className={btn}>
                    <Type className="w-4 h-4" /> Add words
                  </button>
                  <button type="button" onClick={() => add({ type: 'break' })} disabled={full || !spec.blocks.length} data-testid="page-add-break" className={btn}>
                    <SeparatorHorizontal className="w-4 h-4" /> Add a page break
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground">Up to {PAGE_LIMITS.reports} reports. Words left empty and page breaks at the start, the end or two in a row are left out when saved.</p>
              </div>
            </>
          )}
        </div>
      </div>
      {picking && <ReportPicker reports={reports} onClose={() => setPicking(false)}
        onPick={r => { add({ type: 'report', ref: r.id, show: 'both', title: '' }); setPicking(false) }} />}
    </div>
  )
}
